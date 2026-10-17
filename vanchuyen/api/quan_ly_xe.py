"""API màn QUẢN LÝ XE (#/quan-ly-xe): xe tải / xe con, lịch đăng kiểm, lịch thay
dầu, nhật ký bảo dưỡng & sửa chữa.

Mọi method guard require_quan_ly_xe() ở dòng đầu. Tổ trưởng là Website User, không
có DocType perm trên Vehicle / Nhat Ky Xe → ghi bằng ignore_permissions SAU guard.

Khái niệm lịch / cảnh báo / "trống = xe tải" KHÔNG khai ở đây — gọi lại
`nhat_ky_xe` (một chỗ duy nhất, có bộ kiểm docs/verified/quan_ly_xe_check.py)."""

import json
import re

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate

from vanchuyen.api.guards import require_quan_ly_xe
from vanchuyen.van_chuyen.doctype.nhat_ky_xe import nhat_ky_xe as nk

# Field Vehicle đọc cho portal — MỘT hằng để danh sách và chi tiết không lệch nhau.
_VEHICLE_FIELDS = ("name", "make", "model", "fuel_type", "custom_loai_xe", "custom_the_tich_kha_dung") + nk.TRUONG_LICH

_LOG_FIELDS = (
	"name", "xe", "loai", "ngay", "so_km", "chi_phi", "noi_thuc_hien", "noi_dung",
	"ghi_chu", "dinh_kem", "han_tiep", "km_tiep",
)

# ⚠ THÊM FIELD SỬA ĐƯỢC PHẢI THÊM VÀO ĐÂY. Field không có trong tuple này thì
# add_log / update_log BỎ QUA IM LẶNG — người dùng gõ xong bấm lưu rồi mất.
# (`xe`, `loai` là set_only_once: muốn đổi thì xoá rồi ghi lại.)
_LOG_UPDATABLE = ("ngay", "so_km", "chi_phi", "noi_thuc_hien", "noi_dung", "ghi_chu", "han_tiep", "km_tiep")

# Giá trị Select `fuel_type` chuẩn của ERPNext Vehicle (bắt buộc).
NHIEN_LIEU = ("Diesel", "Petrol", "Electric", "Natural Gas")


def _payload(p):
	if isinstance(p, str):
		p = json.loads(p or "{}")
	return frappe._dict(p or {})


def _require_schema():
	# Frappe BỎ QUA IM LẶNG key không có trong meta: chưa migrate mà ghi custom field
	# thì "lưu thành công" mà không lưu gì. Báo thẳng thay vì để mất dữ liệu.
	if not frappe.get_meta("Vehicle").has_field("custom_loai_xe"):
		frappe.throw(_("Chưa có các trường Quản lý xe trên Vehicle — chạy `bench --site <site> migrate` rồi thử lại."))


def _require_xe(name):
	if not name or not frappe.db.exists("Vehicle", name):
		frappe.throw(_("Không tìm thấy xe {0}.").format(name or ""))


def _hom_nay():
	return nk._d(nowdate())


def _khong_tuong_lai(ngay, nhan):
	d = nk._d(ngay)
	if d and d > _hom_nay():
		frappe.throw(_("{0} không được ở tương lai.").format(nhan))
	return d


def _chi_phi_nam(nam):
	"""{xe: tổng chi phí nhật ký trong năm}. SQL: SUM + GROUP BY; lọc bằng khoảng ngày."""
	rows = frappe.db.sql(
		"""SELECT xe, COALESCE(SUM(chi_phi), 0) AS tong FROM `tabNhat Ky Xe`
		   WHERE ngay BETWEEN %(tu)s AND %(den)s GROUP BY xe""",
		{"tu": f"{nam}-01-01", "den": f"{nam}-12-31"}, as_dict=True,
	)
	return {r.xe: flt(r.tong) for r in rows}


def _xe_dict(v, hom_nay, bao_duong=None, chi_phi_nam=0.0):
	ngay_km = nk._d(v.get("custom_ngay_cap_nhat_km"))
	out = {
		"name": v.name,
		"make": v.make,
		"model": v.model,
		"fuel_type": v.fuel_type,
		"loai_xe": nk.loai_xe(v.get("custom_loai_xe")),
		"the_tich": flt(v.get("custom_the_tich_kha_dung")),
		"km": cint(v.get("last_odometer")),
		"ngay_km": nk._iso(ngay_km),
		# Số km đọc đã bao lâu — cũ quá thì "còn X km nữa thay dầu" không còn đáng tin.
		"km_cu_ngay": (hom_nay - ngay_km).days if ngay_km else None,
		"chi_phi_nam": flt(chi_phi_nam),
	}
	out.update(nk.lich_cua_xe(v, hom_nay, bao_duong))
	return out


def _log_dict(r):
	d = {f: r.get(f) for f in _LOG_FIELDS}
	d["ngay"] = nk._iso(r.get("ngay"))
	d["han_tiep"] = nk._iso(r.get("han_tiep"))
	d["so_km"] = cint(r.get("so_km"))
	d["km_tiep"] = cint(r.get("km_tiep"))
	d["chi_phi"] = flt(r.get("chi_phi"))
	return d


def _logs(xe, loai=None, page=1, page_size=20):
	page = cint(page) or 1
	page_size = min(cint(page_size) or 20, 100)
	filters = {"xe": xe}
	if loai:
		filters["loai"] = loai
	rows = frappe.get_all(
		"Nhat Ky Xe", filters=filters, fields=list(_LOG_FIELDS),
		order_by="ngay desc, creation desc", limit=page_size, offset=(page - 1) * page_size,
	)
	total = frappe.db.count("Nhat Ky Xe", filters)
	return {
		"rows": [_log_dict(r) for r in rows],
		"total": cint(total),
		"page": page,
		"has_more": (page - 1) * page_size + len(rows) < cint(total),
	}


def _chi_tiet(name):
	"""Payload màn chi tiết: lịch + chi phí năm nay theo hạng mục + trang đầu nhật ký."""
	v = frappe.db.get_value("Vehicle", name, list(_VEHICLE_FIELDS), as_dict=True)
	if not v:
		frappe.throw(_("Không tìm thấy xe {0}.").format(name))
	hom_nay = _hom_nay()
	out = _xe_dict(v, hom_nay, nk.bao_duong_moi_nhat([name]).get(name))

	# SQL: SUM + GROUP BY theo hạng mục cho một xe (năm nay + từ trước tới nay).
	rows = frappe.db.sql(
		"""SELECT loai,
		          COALESCE(SUM(CASE WHEN ngay BETWEEN %(tu)s AND %(den)s THEN chi_phi ELSE 0 END), 0) AS nam,
		          COALESCE(SUM(chi_phi), 0) AS tong, COUNT(*) AS so
		   FROM `tabNhat Ky Xe` WHERE xe = %(xe)s GROUP BY loai""",
		{"xe": name, "tu": f"{hom_nay.year}-01-01", "den": f"{hom_nay.year}-12-31"},
		as_dict=True,
	)
	theo_loai = {r.loai: {"nam": flt(r.nam), "tong": flt(r.tong), "so": cint(r.so)} for r in rows}
	out["chi_phi"] = {
		"nam": hom_nay.year,
		"theo_loai": theo_loai,
		"tong_nam": sum(x["nam"] for x in theo_loai.values()),
		"tong": sum(x["tong"] for x in theo_loai.values()),
	}
	out["chi_phi_nam"] = out["chi_phi"]["tong_nam"]
	out["nhat_ky"] = _logs(name)
	return out


# ════════════════════════════════════════════════════════════════════════════
# ĐỌC
# ════════════════════════════════════════════════════════════════════════════
@frappe.whitelist()
def list_vehicles():
	"""Mọi xe (tải + con) kèm lịch đăng kiểm / thay dầu / hẹn bảo dưỡng, mức cảnh
	báo và chi phí năm nay. Xe tải trước, rồi theo biển số."""
	require_quan_ly_xe()
	_require_schema()
	rows = frappe.get_all("Vehicle", fields=list(_VEHICLE_FIELDS), order_by="name asc")
	hom_nay = _hom_nay()
	names = [r.name for r in rows]
	bd = nk.bao_duong_moi_nhat(names)
	cp = _chi_phi_nam(hom_nay.year)
	out = [_xe_dict(r, hom_nay, bd.get(r.name), cp.get(r.name, 0.0)) for r in rows]
	out.sort(key=lambda x: (0 if x["loai_xe"] == nk.XE_TAI else 1, x["name"]))
	return {"hom_nay": hom_nay.isoformat(), "nam": hom_nay.year, "xe": out}


@frappe.whitelist()
def get_vehicle(name):
	"""Chi tiết một xe: lịch + chi phí theo hạng mục + trang đầu nhật ký."""
	require_quan_ly_xe()
	_require_schema()
	return _chi_tiet(name)


@frappe.whitelist()
def list_logs(xe, loai=None, page=1, page_size=20):
	"""Nhật ký của một xe (mới nhất trước), lọc theo hạng mục, phân trang server."""
	require_quan_ly_xe()
	_require_xe(xe)
	if loai and loai not in nk.LOAI:
		frappe.throw(_("Hạng mục không hợp lệ."))
	return _logs(xe, loai or None, page, page_size)


# ════════════════════════════════════════════════════════════════════════════
# GHI — XE
# ════════════════════════════════════════════════════════════════════════════
def _chuan_bien_so(s):
	"""'  29c-123.45 ' → '29C-123.45' (bỏ khoảng trắng thừa, viết hoa)."""
	return re.sub(r"\s+", " ", (s or "").strip()).upper()


def _uom_nhien_lieu():
	"""Fuel UOM là field BẮT BUỘC của Vehicle nhưng app không dùng → lấy theo xe đã
	có, rồi tới đơn vị lít quen thuộc, cuối cùng UOM bất kỳ."""
	u = frappe.db.get_value("Vehicle", {"uom": ["is", "set"]}, "uom")
	if u:
		return u
	for c in ("Litre", "Lít", "Liter", "Lit"):
		if frappe.db.exists("UOM", c):
			return c
	return frappe.db.get_value("UOM", {}, "name")


def _luu_xe(doc):
	"""Lưu Vehicle sau guard. Bù `uom` (bắt buộc, app không dùng) cho xe cũ nhập thiếu —
	đừng để một field nhiên liệu chặn việc ghi lịch đăng kiểm."""
	if not doc.uom:
		doc.uom = _uom_nhien_lieu()
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)


@frappe.whitelist()
def save_vehicle(payload):
	"""Thêm xe mới hoặc sửa thông tin xe: loại (xe tải / xe con), hãng, dòng xe,
	nhiên liệu, thể tích khả dụng (xe tải).

	KHÔNG sửa ở đây: biển số (là `name` của Vehicle — đổi là rename, kéo theo mọi
	chuyến cũ), số km (dùng update_km: `last_odometer` set_only_once), phụ phí xe
	(cộng vào tiền cước của lái xe — giữ trên Desk cho điều hành / kế toán)."""
	require_quan_ly_xe()
	_require_schema()
	p = _payload(payload)

	loai = p.get("loai_xe")
	if loai not in (nk.XE_TAI, nk.XE_CON):
		frappe.throw(_("Chọn loại xe: Xe tải hoặc Xe con."))
	make = (p.get("make") or "").strip()
	model = (p.get("model") or "").strip()
	if not make or not model:
		frappe.throw(_("Nhập hãng xe và dòng xe."))
	fuel = p.get("fuel_type") or ("Diesel" if loai == nk.XE_TAI else "Petrol")
	if fuel not in NHIEN_LIEU:
		frappe.throw(_("Loại nhiên liệu không hợp lệ."))
	the_tich = flt(p.get("the_tich"))
	if the_tich < 0:
		frappe.throw(_("Thể tích không được âm."))

	if p.get("name"):
		_require_xe(p.name)
		doc = frappe.get_doc("Vehicle", p.name)
	else:
		bien_so = _chuan_bien_so(p.get("bien_so"))
		if not bien_so:
			frappe.throw(_("Nhập biển số xe."))
		if frappe.db.exists("Vehicle", bien_so):
			frappe.throw(_("Xe {0} đã có trong danh sách.").format(bien_so))
		km = cint(p.get("km"))
		if km < 0:
			frappe.throw(_("Số km không được âm."))
		doc = frappe.new_doc("Vehicle")
		doc.license_plate = bien_so
		doc.last_odometer = km
		doc.custom_ngay_cap_nhat_km = nowdate() if km else None

	doc.make = make
	doc.model = model
	doc.fuel_type = fuel
	doc.custom_loai_xe = loai
	# Thể tích chỉ có nghĩa với xe tải (cân tải ở Xếp chuyến). Đổi tải → con thì GIỮ
	# số cũ: đổi lại thành xe tải không phải nhập lại.
	if loai == nk.XE_TAI:
		doc.custom_the_tich_kha_dung = the_tich
	_luu_xe(doc)
	return _chi_tiet(doc.name)


@frappe.whitelist()
def update_km(xe, km):
	"""Ghi số km đồng hồ hiện tại (kể cả sửa LÙI khi lỡ gõ nhầm — portal hỏi lại trước).
	`last_odometer` là set_only_once → db.set_value (cùng cách HRMS Vehicle Log)."""
	require_quan_ly_xe()
	_require_schema()
	_require_xe(xe)
	km = cint(km)
	if km < 0:
		frappe.throw(_("Số km không được âm."))
	frappe.db.set_value("Vehicle", xe, {"last_odometer": km, "custom_ngay_cap_nhat_km": nowdate()})
	return _chi_tiet(xe)


@frappe.whitelist()
def save_lich(xe, hang_muc, payload):
	"""Cài / sửa TAY lịch của xe (khai báo ban đầu, hoặc chỉnh khi lệch).

	Đăng kiểm: chu_ky (6 tháng / 1 năm / 2 năm / Ngày cụ thể) + ngay (lần gần nhất);
	           'Ngày cụ thể' thì thêm han (theo giấy chứng nhận).
	Thay dầu:  moi_km và/hoặc moi_thang + ngay, km (lần thay gần nhất, tuỳ chọn).

	Lưu bằng doc.save → Vehicle giữ lịch sử thay đổi (Version) + hook tính lại hạn."""
	require_quan_ly_xe()
	_require_schema()
	_require_xe(xe)
	p = _payload(payload)
	doc = frappe.get_doc("Vehicle", xe)

	if hang_muc == nk.DANG_KIEM:
		chu_ky = p.get("chu_ky") or ""
		if chu_ky not in nk.CHU_KY_THANG and chu_ky != nk.NGAY_CU_THE:
			frappe.throw(_("Chọn chu kỳ đăng kiểm: 6 tháng, 1 năm, 2 năm hoặc Ngày cụ thể."))
		ngay = _khong_tuong_lai(p.get("ngay"), _("Ngày đăng kiểm gần nhất"))
		han = nk._d(p.get("han"))
		if chu_ky in nk.CHU_KY_THANG and not ngay:
			frappe.throw(_("Nhập ngày đăng kiểm gần nhất để tính hạn theo chu kỳ {0}.").format(chu_ky))
		if chu_ky == nk.NGAY_CU_THE and not han:
			frappe.throw(_("Nhập hạn đăng kiểm (ngày cụ thể)."))
		if chu_ky == nk.NGAY_CU_THE and ngay and han <= ngay:
			frappe.throw(_("Hạn đăng kiểm phải sau ngày đăng kiểm gần nhất."))
		doc.custom_chu_ky_dang_kiem = chu_ky
		doc.custom_ngay_dang_kiem = ngay
		if chu_ky == nk.NGAY_CU_THE:
			doc.custom_han_dang_kiem = han  # chu kỳ cố định: hook vehicle_validate tự tính
		km = 0
	elif hang_muc == nk.THAY_DAU:
		moi_km, moi_thang = cint(p.get("moi_km")), cint(p.get("moi_thang"))
		if moi_km < 0 or moi_thang < 0:
			frappe.throw(_("Chu kỳ thay dầu không được âm."))
		if not moi_km and not moi_thang:
			frappe.throw(_("Nhập chu kỳ thay dầu theo km và/hoặc theo tháng."))
		km = cint(p.get("km"))
		if km < 0:
			frappe.throw(_("Số km không được âm."))
		doc.custom_thay_dau_moi_km = moi_km
		doc.custom_thay_dau_moi_thang = moi_thang
		doc.custom_ngay_thay_dau = _khong_tuong_lai(p.get("ngay"), _("Ngày thay dầu gần nhất"))
		doc.custom_km_thay_dau = km
	else:
		frappe.throw(_("Hạng mục lịch không hợp lệ."))

	_luu_xe(doc)
	nk.cap_nhat_km(xe, km, doc.get("custom_ngay_thay_dau"))
	return _chi_tiet(xe)


# ════════════════════════════════════════════════════════════════════════════
# GHI — NHẬT KÝ
# ════════════════════════════════════════════════════════════════════════════
def _ap_cau_hinh(xe, loai, p):
	"""Form ghi nhận có thể kèm cấu hình lịch (lần đầu ghi chưa cài lịch). Lưu vào xe
	TRƯỚC khi tạo bản ghi để bản ghi tính hạn theo cấu hình mới. Chỉ lưu khi ĐỔI."""
	doc = None
	if loai == nk.DANG_KIEM and p.get("chu_ky") is not None:
		chu_ky = p.get("chu_ky") or ""
		if chu_ky not in nk.CHU_KY_THANG and chu_ky != nk.NGAY_CU_THE:
			frappe.throw(_("Chọn chu kỳ đăng kiểm: 6 tháng, 1 năm, 2 năm hoặc Ngày cụ thể."))
		if frappe.db.get_value("Vehicle", xe, "custom_chu_ky_dang_kiem") != chu_ky:
			doc = frappe.get_doc("Vehicle", xe)
			doc.custom_chu_ky_dang_kiem = chu_ky
	elif loai == nk.THAY_DAU and (p.get("moi_km") is not None or p.get("moi_thang") is not None):
		moi_km, moi_thang = cint(p.get("moi_km")), cint(p.get("moi_thang"))
		if moi_km < 0 or moi_thang < 0:
			frappe.throw(_("Chu kỳ thay dầu không được âm."))
		cur = frappe.db.get_value("Vehicle", xe, ["custom_thay_dau_moi_km", "custom_thay_dau_moi_thang"], as_dict=True)
		if (cint(cur.custom_thay_dau_moi_km), cint(cur.custom_thay_dau_moi_thang)) != (moi_km, moi_thang):
			doc = frappe.get_doc("Vehicle", xe)
			doc.custom_thay_dau_moi_km = moi_km
			doc.custom_thay_dau_moi_thang = moi_thang
	if doc is not None:
		_luu_xe(doc)


def _set_log_fields(doc, p, only_present):
	for f in _LOG_UPDATABLE:
		if f not in p:
			continue
		v = p.get(f)
		if only_present and v in (None, ""):
			continue
		doc.set(f, None if v == "" else v)


@frappe.whitelist()
def add_log(payload):
	"""Ghi nhận một việc ĐÃ làm (đăng kiểm / thay dầu / bảo dưỡng / sửa chữa).
	Bản ghi Đăng kiểm / Thay dầu mới nhất ĐẨY lịch xe tiến lên (controller)."""
	require_quan_ly_xe()
	_require_schema()
	p = _payload(payload)
	_require_xe(p.get("xe"))
	if p.get("loai") not in nk.LOAI:
		frappe.throw(_("Chọn hạng mục: Đăng kiểm, Thay dầu, Bảo dưỡng hoặc Sửa chữa."))
	_ap_cau_hinh(p.xe, p.loai, p)

	doc = frappe.new_doc("Nhat Ky Xe")
	doc.xe = p.xe
	doc.loai = p.loai
	_set_log_fields(doc, p, only_present=True)
	doc.insert(ignore_permissions=True)
	return {"log": doc.name, "xe": _chi_tiet(p.xe)}


@frappe.whitelist()
def update_log(name, payload):
	"""Sửa một bản ghi (ngày, km, chi phí, nội dung, hẹn…). Sửa đúng bản ghi đang
	làm mốc thì lịch xe tự tính lại (controller on_update)."""
	require_quan_ly_xe()
	if not frappe.db.exists("Nhat Ky Xe", name):
		frappe.throw(_("Không tìm thấy bản ghi."))
	doc = frappe.get_doc("Nhat Ky Xe", name)
	_set_log_fields(doc, _payload(payload), only_present=False)
	doc.save(ignore_permissions=True)
	return {"log": doc.name, "xe": _chi_tiet(doc.xe)}


@frappe.whitelist()
def delete_log(name):
	"""Xoá một bản ghi. Đang là mốc lịch thì lịch lùi về bản ghi liền trước (on_trash)."""
	require_quan_ly_xe()
	xe = frappe.db.get_value("Nhat Ky Xe", name, "xe")
	if not xe:
		frappe.throw(_("Không tìm thấy bản ghi."))
	frappe.delete_doc("Nhat Ky Xe", name, ignore_permissions=True)
	return {"xe": _chi_tiet(xe)}


@frappe.whitelist()
def upload_anh(name):
	"""Ảnh hoá đơn / giấy chứng nhận cho một bản ghi (multipart: field 'file').

	File PUBLIC (như ảnh sự cố): tổ trưởng là Website User, không có quyền đọc
	Nhat Ky Xe nên ảnh private sẽ không xem lại được. Tên file sinh ngẫu nhiên —
	không đoán được URL từ tên ảnh gốc của điện thoại."""
	require_quan_ly_xe()
	if not frappe.db.exists("Nhat Ky Xe", name):
		frappe.throw(_("Không tìm thấy bản ghi."))
	files = frappe.request.files if frappe.request else None
	f = files.get("file") if files else None
	if not f:
		frappe.throw(_("Thiếu file ảnh."))
	fdoc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{frappe.scrub(name)}-{frappe.generate_hash(length=10)}.jpg",
			"attached_to_doctype": "Nhat Ky Xe",
			"attached_to_name": name,
			"content": f.stream.read(),
			"is_private": 0,
		}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Nhat Ky Xe", name, "dinh_kem", fdoc.file_url, update_modified=False)
	return {"file_url": fdoc.file_url}
