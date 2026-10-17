"""API THU HỒI HÀNG — portal /vc#/thu-hoi (điều hành + tổ trưởng).

Một LÔ THU HỒI (`Lo Thu Hoi`) = một lần siêu thị gọi trả hàng. Hàng do ĐƠN VỊ VẬN CHUYỂN
NGOÀI vào lấy (Viettel Post / Nhất Tín) — lô giữ đơn vị, mã vận đơn, ngày thu, số kiện; chi
tiết hàng là bản dán nguyên văn từ mail siêu thị. App này giữ ba chặng đầu (Tạo yêu cầu →
Đã lấy hàng → Đã nhận hàng); kế toán tiếp nối bằng phiếu kiểm hàng bên ketoan (mã + số
lượng chính xác ở đó), và mọi danh sách ở đây hiện TRẠNG THÁI TỔNG bằng cách đọc mềm phiếu.

Quyền: DocType chỉ cấp System Manager (như `Su Co Van Chuyen`). Mọi method gọi `_require()`
ở dòng đầu — điều hành (quyền ghi Sales Invoice), tổ trưởng, quản trị — rồi mới
`ignore_permissions` trên ĐÚNG bản ghi.

File đính kèm lưu PRIVATE. Không ai ngoài System Manager có quyền DocType `Lo Thu Hoi`,
nên file private không mở thẳng bằng /private/files được — xem qua `xem_dinh_kem`, nơi
guard thay cho DocPerm. Public thì ai có đường link cũng mở được phiếu xuất trả có giá.
Nhận ảnh / PDF / Excel / Word / mail…, KHÔNG nhận loại chạy được script (xem `DUOI_DINH_KEM`).
"""

import json
import os
from urllib.parse import quote

import frappe
from frappe import _
from frappe.utils import cint, cstr, date_diff, flt, getdate, now_datetime, nowdate

from vanchuyen.api.guards import is_admin, is_to_truong
from vanchuyen.api.nhap_don import _ten_key
from vanchuyen.van_chuyen.doctype.lo_thu_hoi.lo_thu_hoi import (
	CHANG,
	DANG_KIEM,
	KIEM_DT,
	TAO,
	TRANG_THAI,
	format_dia_chi,
	phieu_kiem,
)

DT = "Lo Thu Hoi"
XONG = CHANG[-1]

# ⚠ THÊM FIELD MỚI PHẢI THÊM VÀO ĐÂY (cùng bài học của `su_co._UPDATABLE`): field
# không có trong tuple thì `save_lo` BỎ QUA IM LẶNG — người dùng gõ, bấm lưu, mất.
_UPDATABLE = (
	"ngay_yeu_cau", "so_phieu_sieu_thi", "ly_do", "customer", "shipping_address_name",
	"nguoi_lien_he", "sdt_lien_he", "ghi_chu", "chi_tiet_hang",
	"don_vi_thu_hoi", "ma_van_don", "ngay_hen_lay",
	"so_kien_du_kien", "so_kien_nhan", "gia_tri_khai",
)
_SO = ("so_kien_du_kien", "so_kien_nhan", "gia_tri_khai")

# Cột đọc cho danh sách. Tách hằng để danh sách và chi tiết không lệch nhau.
_LIST_COLS = (
	"name", "trang_thai", "ngay_yeu_cau", "so_phieu_sieu_thi", "ly_do",
	"customer", "customer_name", "shipping_address_name", "ten_diem", "ma_diem", "dia_chi",
	"don_vi_thu_hoi", "ma_van_don", "ngay_hen_lay", "lay_luc", "nhan_luc",
	"so_kien_du_kien", "so_kien_nhan", "so_dinh_kem",
)
_DATE_COLS = ("ngay_yeu_cau", "ngay_hen_lay", "lay_luc", "nhan_luc")

# Đính kèm: ảnh, PDF, bảng tính, văn bản, mail, file nén. KHÔNG nhận loại trình duyệt chạy
# được script (html / svg / xml / js…) — proxy `xem_dinh_kem` phục vụ file trên CHÍNH tên miền
# của site, một .html có script là chạy với phiên đăng nhập của người bấm xem.
DUOI_DINH_KEM = frozenset((
	"jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "pdf",
	"xls", "xlsx", "xlsm", "csv", "ods", "doc", "docx", "odt", "rtf", "txt",
	"eml", "msg", "zip", "rar", "7z",
))
# Mở thẳng trong tab (ảnh hiện trong <img>, PDF xem được); còn lại TẢI VỀ — Excel / Word
# trình duyệt không hiển thị được, và tải về là chắc chắn không bị diễn giải thành trang.
DUOI_XEM_TRONG_TAB = frozenset(("jpg", "jpeg", "png", "webp", "gif", "pdf"))


def _duoi(ten):
	"""Phần mở rộng, chữ thường, không dấu chấm: "Phieu.XLSX" → "xlsx"."""
	return os.path.splitext(cstr(ten))[1].lstrip(".").lower()


def _van_ban_dan(v):
	"""Chữ dán từ mail: giữ NGUYÊN tab / xuống dòng / khoảng trắng đầu dòng — bảng hàng trong
	mail dán ra là các cột cách nhau bằng tab, cắt đi là lệch cột. Chỉ đổi CRLF → LF và bỏ
	dòng trống thừa ở hai đầu."""
	t = cstr(v).replace("\r\n", "\n").replace("\r", "\n").strip("\n").rstrip()
	return t or None


def _require():
	"""Điều hành (quyền ghi Sales Invoice) · tổ trưởng · quản trị viên."""
	if is_admin() or is_to_truong() or frappe.has_permission("Sales Invoice", "write"):
		return
	frappe.throw(_("Bạn không có quyền điều phối thu hồi hàng."), frappe.PermissionError)


def _str_dates(d):
	for f in _DATE_COLS:
		if d.get(f):
			d[f] = str(d[f])
	return d


def _join_kiem():
	"""(mệnh đề JOIN, biểu thức CHẶNG TỔNG). Site chưa có ketoan → chỉ chặng vận chuyển.

	Phiếu kiểm có mà trạng thái rỗng đọc là "Đang kiểm" — cùng luật `phieu_kiem()`.
	"""
	if not frappe.db.table_exists(KIEM_DT):
		return "", "l.trang_thai"
	return (
		f"LEFT JOIN `tab{KIEM_DT}` k ON k.lo_thu_hoi = l.name",
		"(CASE WHEN k.name IS NULL THEN l.trang_thai "
		"WHEN IFNULL(k.trang_thai, '') = '' THEN %(dang_kiem)s ELSE k.trang_thai END)",
	)


# ═══════════════════════════════════════════════════════════════════════════
# DANH SÁCH + CHI TIẾT
# ═══════════════════════════════════════════════════════════════════════════

@frappe.whitelist()
def list_lo(chang=None, tim=None, tu_ngay=None, den_ngay=None, page=1, page_size=30):
	"""Danh sách lô, lọc theo CHẶNG TỔNG (7 chặng) + tìm khách/điểm/số phiếu/vận đơn.

	`chang` = một trong 7 chặng · "dang_mo" (mặc định: chưa Xong) · "tat_ca".
	Lọc ở SERVER, đếm pill trên CÙNG bộ tìm/ngày — bài học của `su_co.list_issues`: lọc
	client trên một trang 30 dòng là cách chắc chắn nhất để giấu mất lô cũ nhất.

	SQL thô: JOIN mềm sang bảng của app khác + biểu thức chặng dùng chung cho WHERE /
	GROUP BY / ORDER BY — ORM không diễn được một lượt.
	"""
	_require()
	page = cint(page) or 1
	page_size = min(cint(page_size) or 30, 100)
	join, expr = _join_kiem()
	p = {"dang_kiem": DANG_KIEM, "xong": XONG}
	conds = ["1 = 1"]
	if cstr(tim).strip():
		p["q"] = "%" + cstr(tim).strip() + "%"
		conds.append(
			"(l.name LIKE %(q)s OR l.customer_name LIKE %(q)s OR l.ten_diem LIKE %(q)s "
			"OR l.ma_diem LIKE %(q)s OR l.so_phieu_sieu_thi LIKE %(q)s OR l.ma_van_don LIKE %(q)s "
			"OR l.don_vi_thu_hoi LIKE %(q)s)"
		)
	if tu_ngay:
		p["tu"] = getdate(tu_ngay)
		conds.append("l.ngay_yeu_cau >= %(tu)s")
	if den_ngay:
		p["den"] = getdate(den_ngay)
		conds.append("l.ngay_yeu_cau <= %(den)s")
	base = " AND ".join(conds)

	counts = {
		cstr(r.chang): cint(r.n)
		for r in frappe.db.sql(
			f"SELECT {expr} AS chang, COUNT(*) AS n FROM `tab{DT}` l {join} WHERE {base} GROUP BY chang",
			p,
			as_dict=True,
		)
	}

	where = base
	chang = cstr(chang).strip() or "dang_mo"
	if chang == "dang_mo":
		where += f" AND {expr} != %(xong)s"
	elif chang in CHANG:
		p["chang"] = chang
		where += f" AND {expr} = %(chang)s"

	total = cint(frappe.db.sql(f"SELECT COUNT(*) FROM `tab{DT}` l {join} WHERE {where}", p)[0][0])
	p["lim"], p["off"] = page_size, (page - 1) * page_size
	order = ", ".join(["%(c{0})s".format(i) for i in range(len(CHANG))])
	p.update({"c%d" % i: c for i, c in enumerate(CHANG)})
	cols = ", ".join("l.`%s`" % c for c in _LIST_COLS)
	rows = frappe.db.sql(
		f"""SELECT {cols}, {expr} AS chang
		FROM `tab{DT}` l {join}
		WHERE {where}
		ORDER BY FIELD({expr}, {order}), l.ngay_yeu_cau ASC, l.name ASC
		LIMIT %(lim)s OFFSET %(off)s""",
		p,
		as_dict=True,
	)
	today = nowdate()
	for r in rows:
		# Tuổi tính từ NGÀY YÊU CẦU — ngày siêu thị gọi, không phải ngày nhập phiếu.
		r["tuoi"] = date_diff(today, r.ngay_yeu_cau) if r.ngay_yeu_cau and r.chang != XONG else None
		_str_dates(r)
	return {
		"rows": rows,
		"total": total,
		"page": page,
		"page_size": page_size,
		"has_more": (page - 1) * page_size + len(rows) < total,
		"counts": counts,
		"chang_list": list(CHANG),
		"co_ke_toan": bool(frappe.db.table_exists(KIEM_DT)),
	}


def _files(name):
	rows = frappe.get_all(
		"File",
		filters={"attached_to_doctype": DT, "attached_to_name": name},
		fields=["name", "file_name", "file_size", "creation", "owner"],
		order_by="creation asc",
		limit_page_length=0,
	)
	for f in rows:
		f["url"] = "/api/method/vanchuyen.api.thu_hoi.xem_dinh_kem?file=" + quote(f.name)
		f["ext"] = _duoi(f.file_name)
		f["is_image"] = f["ext"] in ("jpg", "jpeg", "png", "webp", "gif")
		f["creation"] = str(f.creation)
	return rows


def _lo_dict(name):
	doc = frappe.get_doc(DT, name)
	d = {f: doc.get(f) for f in _LIST_COLS + _UPDATABLE + ("customer_name", "sdt_diem", "lay_boi", "nhan_boi")}
	d["name"] = doc.name
	_str_dates(d)
	d["files"] = _files(doc.name)
	kt = phieu_kiem([doc.name]).get(doc.name)
	d["chang"] = kt or doc.trang_thai
	d["khoa_ke_toan"] = bool(kt)
	d["co_ke_toan"] = bool(frappe.db.table_exists(KIEM_DT))
	d["chang_list"] = list(CHANG)
	d["modified"] = str(doc.modified)
	return d


@frappe.whitelist()
def get_lo(name):
	"""Chi tiết một lô: điều phối thu hồi, chi tiết hàng dán từ mail, file đính kèm, chặng tổng."""
	_require()
	if not frappe.db.exists(DT, name):
		frappe.throw(_("Không tìm thấy lô thu hồi {0}.").format(name))
	return _lo_dict(name)


@frappe.whitelist()
def get_lua_chon():
	"""Dữ liệu cho ô chọn: lý do trả, đơn vị thu hồi (đọc từ meta — sửa Select trên Desk là
	màn hình theo), hôm nay."""
	_require()
	meta = frappe.get_meta(DT)

	def tuy_chon(f):
		df = meta.get_field(f)
		return [o for o in cstr(df.options if df else "").split("\n") if o]

	return {"ly_do": tuy_chon("ly_do"), "don_vi": tuy_chon("don_vi_thu_hoi"), "today": nowdate()}


# ═══════════════════════════════════════════════════════════════════════════
# CHỌN KHÁCH · ĐIỂM
# ═══════════════════════════════════════════════════════════════════════════

@frappe.whitelist()
def search_customers(tim=None, page_size=20):
	"""Tìm khách theo mã/tên (khách còn hoạt động)."""
	_require()
	or_filters = None
	q = cstr(tim).strip()
	if q:
		or_filters = [["name", "like", f"%{q}%"], ["customer_name", "like", f"%{q}%"]]
	return frappe.get_all(
		"Customer", filters={"disabled": 0}, or_filters=or_filters,
		fields=["name", "customer_name", "customer_group"],
		order_by="customer_name asc", limit_page_length=min(cint(page_size) or 20, 50),
	)


@frappe.whitelist()
def get_dia_chi(customer, tim=None):
	"""Địa chỉ CỦA CHÍNH KHÁCH NÀY (Dynamic Link), kèm mã/tên điểm `MT Store` nếu có.

	Không bao giờ tra Address trên cả bảng (bài học `nhap_don._resolve_address`): hai
	khách khác nhau có địa chỉ cùng tên là chuyện có thật, và chọn nhầm ở đây là hóa
	đơn trả về dựng sai điểm. Tìm bỏ dấu (`_ten_key`) vì tên điểm gõ đủ kiểu.
	"""
	_require()
	if not customer:
		return []
	names = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Customer", "link_name": customer, "parenttype": "Address"},
		pluck="parent", limit_page_length=0,
	)
	if not names:
		return []
	cols = ["name", "address_title", "address_line1", "address_line2", "city", "county", "state", "phone"]
	addr_filters = {"name": ["in", list(set(names))]}
	if frappe.get_meta("Address").has_field("disabled"):
		addr_filters["disabled"] = 0
	addrs = frappe.get_all("Address", filters=addr_filters, fields=cols, limit_page_length=0)
	stores = {}
	if frappe.db.table_exists("MT Store"):
		for s in frappe.get_all(
			"MT Store", filters={"customer": customer},
			fields=["address", "store_code", "store_name"], limit_page_length=0,
		):
			if s.address:
				stores[s.address] = s
	key = _ten_key(tim) if cstr(tim).strip() else ""
	out = []
	for a in addrs:
		st = stores.get(a.name) or {}
		d = {
			"name": a.name,
			"ten": cstr(st.get("store_name")) or cstr(a.address_title) or a.name,
			"ma": cstr(st.get("store_code")),
			"dia_chi": format_dia_chi(a),
			"phone": cstr(a.phone),
		}
		if key and key not in _ten_key(" ".join([d["ten"], d["ma"], d["dia_chi"], a.name])):
			continue
		out.append(d)
	out.sort(key=lambda x: _ten_key(x["ten"]))
	return out[:100]


# ═══════════════════════════════════════════════════════════════════════════
# GHI
# ═══════════════════════════════════════════════════════════════════════════

def _dat_chang(doc, moi, so_kien_nhan=None):
	"""Đổi chặng + đóng dấu ai/lúc nào. Tiến được nhảy cóc; lùi thì xóa dấu của chặng bỏ.

	Nhảy cóc "Tạo yêu cầu → Đã nhận hàng" là thật: siêu thị tự chở hàng về, hay xe khác
	ghé lấy hộ. Đóng dấu cả chặng lấy hàng để dòng thời gian không thủng một mốc.
	Lùi thì `LoThuHoi._khoa_khi_ke_toan_da_kiem` chặn khi kế toán đã đếm hàng.
	"""
	if moi not in TRANG_THAI:
		frappe.throw(_("Chặng vận chuyển không hợp lệ: {0}").format(moi))
	cu = doc.trang_thai if doc.trang_thai in TRANG_THAI else TAO
	if moi == cu:
		return
	i_moi, i_cu = TRANG_THAI.index(moi), TRANG_THAI.index(cu)
	ai = frappe.utils.get_fullname(frappe.session.user) or frappe.session.user
	luc = now_datetime()
	if i_moi > i_cu:
		if i_moi >= 1 and not doc.lay_luc:
			doc.lay_luc, doc.lay_boi = luc, ai
		if i_moi >= 2:
			doc.nhan_luc, doc.nhan_boi = luc, ai
	else:
		if i_moi < 2:
			doc.nhan_luc = doc.nhan_boi = None
		if i_moi < 1:
			doc.lay_luc = doc.lay_boi = None
	if so_kien_nhan not in (None, ""):
		doc.so_kien_nhan = flt(so_kien_nhan)
	doc.trang_thai = moi


@frappe.whitelist()
def save_lo(payload, name=None):
	"""Tạo / sửa lô. Chỉ field trong `_UPDATABLE`; tên khách / điểm / địa chỉ do controller
	chép lại từ Customer + Address — không tin client.

	`chi_tiet_hang` (dán từ mail) đi qua `_van_ban_dan` — không `.strip()` như ô thường.
	"""
	_require()
	if isinstance(payload, str):
		payload = json.loads(payload or "{}")
	if name:
		if not frappe.db.exists(DT, name):
			frappe.throw(_("Không tìm thấy lô thu hồi {0}.").format(name))
		doc = frappe.get_doc(DT, name)
	else:
		doc = frappe.new_doc(DT)
		doc.trang_thai = TAO
	for f in _UPDATABLE:
		if f not in payload:
			continue
		v = payload.get(f)
		if f in _SO:
			doc.set(f, flt(v) if v not in (None, "") else None)
		elif f == "chi_tiet_hang":
			doc.set(f, _van_ban_dan(v))
		else:
			doc.set(f, cstr(v).strip() or None)
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return _lo_dict(doc.name)


@frappe.whitelist()
def chuyen_chang(name, trang_thai, so_kien_nhan=None):
	"""Điều phối / điều hành chuyển chặng vận chuyển (tiến hoặc lùi)."""
	_require()
	doc = frappe.get_doc(DT, name)
	_dat_chang(doc, trang_thai, so_kien_nhan)
	doc.save(ignore_permissions=True)
	return _lo_dict(doc.name)


@frappe.whitelist()
def xoa_lo(name):
	"""Xóa lô lập nhầm. CHỈ khi còn "Tạo yêu cầu" — hàng đã lấy thì lô là dấu vết."""
	_require()
	trang_thai = frappe.db.get_value(DT, name, "trang_thai")
	if trang_thai is None:
		frappe.throw(_("Không tìm thấy lô thu hồi {0}.").format(name))
	if trang_thai != TAO:
		frappe.throw(
			_("Lô {0} đã ở chặng '{1}'. Chỉ xóa được lô còn 'Tạo yêu cầu' — lùi chặng trước nếu "
			  "thật sự lập nhầm.").format(name, trang_thai)
		)
	# on_trash chặn tiếp khi kế toán đã mở phiếu kiểm. File đính kèm Frappe tự xóa theo.
	frappe.delete_doc(DT, name, ignore_permissions=True)
	return {"deleted": name}


# ── File đính kèm ───────────────────────────────────────────────────────────
def _nhan_file(name):
	"""Lưu MỌI file trong multipart (field 'file', gửi nhiều lần được) — PRIVATE.

	Soát đuôi file TRƯỚC khi lưu cái nào: một lượt nhiều file mà có một file bị từ chối thì
	không lưu nửa vời.
	"""
	files = frappe.request.files.getlist("file") if frappe.request and frappe.request.files else []
	if not files:
		frappe.throw(_("Thiếu file."))
	for f in files:
		if _duoi(f.filename) not in DUOI_DINH_KEM:
			frappe.throw(_(
				"Không đính kèm được '{0}'. Nhận: ảnh, PDF, Excel (xls/xlsx/csv), Word (doc/docx), "
				"txt, mail (eml/msg), file nén (zip/rar/7z)."
			).format(f.filename or "?"))
	for f in files:
		frappe.get_doc({
			"doctype": "File",
			"file_name": f.filename or "chung-tu.jpg",
			"attached_to_doctype": DT,
			"attached_to_name": name,
			"is_private": 1,
			"content": f.stream.read(),
		}).insert(ignore_permissions=True)
	n = frappe.db.count("File", {"attached_to_doctype": DT, "attached_to_name": name})
	frappe.db.set_value(DT, name, "so_dinh_kem", n, update_modified=False)
	return {"files": _files(name), "so_dinh_kem": n}


@frappe.whitelist()
def upload_dinh_kem(name):
	"""Đính kèm phiếu xuất trả / mail / file Excel hàng trả / ảnh hàng (multipart, nhiều file)."""
	_require()
	if not frappe.db.exists(DT, name):
		frappe.throw(_("Không tìm thấy lô thu hồi {0}.").format(name))
	return _nhan_file(name)


@frappe.whitelist()
def xoa_dinh_kem(name, file):
	"""Gỡ một file khỏi lô. Chỉ file ĐÚNG của lô này."""
	_require()
	f = frappe.db.get_value("File", file, ["attached_to_doctype", "attached_to_name"], as_dict=True)
	if not f or f.attached_to_doctype != DT or f.attached_to_name != name:
		frappe.throw(_("File không thuộc lô {0}.").format(name))
	frappe.delete_doc("File", file, ignore_permissions=True)
	n = frappe.db.count("File", {"attached_to_doctype": DT, "attached_to_name": name})
	frappe.db.set_value(DT, name, "so_dinh_kem", n, update_modified=False)
	return {"files": _files(name), "so_dinh_kem": n}


@frappe.whitelist(methods=["GET"])
def xem_dinh_kem(file):
	"""Trả nội dung file đính kèm của một lô — guard thay cho DocPerm.

	Ảnh / PDF `inline` (ảnh hiện trong <img>, PDF mở trong tab); loại khác TẢI VỀ. Không bao
	giờ inline một loại ngoài `DUOI_XEM_TRONG_TAB`: file cũ / file gắn bằng Desk có thể là
	.html / .svg, mà inline trên tên miền của site là script chạy bằng phiên của người xem
	(Frappe tự ép tải về các loại này ở /private/files — proxy này phải làm y vậy).
	"""
	_require()
	f = frappe.db.get_value("File", file, ["attached_to_doctype", "file_name"], as_dict=True)
	if not f or f.attached_to_doctype != DT:
		frappe.throw(_("Không tìm thấy file."), frappe.DoesNotExistError)
	frappe.local.response.filename = f.file_name or "dinh-kem"
	frappe.local.response.filecontent = frappe.get_doc("File", file).get_content()
	frappe.local.response.type = "download"
	frappe.local.response.display_content_as = (
		"inline" if _duoi(f.file_name) in DUOI_XEM_TRONG_TAB else "attachment"
	)
