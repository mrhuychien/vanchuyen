"""Nhật ký xe — đăng kiểm / thay dầu / bảo dưỡng / sửa chữa — và LỊCH của xe.

Hai thứ khác nhau, đừng nhập làm một:

  LỊCH     (custom field trên Vehicle) = trạng thái HIỆN TẠI: chu kỳ, lần gần nhất,
           hạn kế tiếp. Màn Quản lý xe đọc ở đây để báo quá hạn / sắp đến hạn.
  NHẬT KÝ  (DocType này)               = lịch sử việc ĐÃ làm, kèm chi phí.

Bản ghi Đăng kiểm / Thay dầu MỚI NHẤT đẩy lịch tiến lên. Xoá hay sửa đúng bản
ghi đang làm MỐC thì lịch lùi về bản ghi liền trước — không còn bản ghi nào thì
lịch trống hẳn: thà màn hình nói "chưa có dữ liệu" còn hơn giữ một ngày đăng
kiểm của bản ghi đã xoá và báo xe "còn hạn" sai. Bảo dưỡng không lưu lịch trên
xe: "hẹn lần sau" đọc thẳng từ bản ghi bảo dưỡng mới nhất. Sửa chữa chỉ là lịch
sử + chi phí.

⚠ Các khái niệm khai ở ĐÚNG MỘT CHỖ này — chu kỳ, cộng tháng, "trống = xe tải",
mức cảnh báo. API portal (`api/quan_ly_xe.py`), màn Xếp chuyến
(`dieu_phoi.get_vehicles`) và doc_events của Vehicle đều gọi lại đây. Phần thuần
(không đụng DB) được `docs/verified/quan_ly_xe_check.py` chạy không cần bench.
"""

import calendar
import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate, nowdate

# ── Hằng số ────────────────────────────────────────────────────────────────
DANG_KIEM = "Đăng kiểm"
THAY_DAU = "Thay dầu"
BAO_DUONG = "Bảo dưỡng"
SUA_CHUA = "Sửa chữa"
LOAI = (DANG_KIEM, THAY_DAU, BAO_DUONG, SUA_CHUA)
# Hai hạng mục có lịch LƯU trên xe (bản ghi mới nhất đẩy lịch tiến lên).
CO_LICH = (DANG_KIEM, THAY_DAU)

XE_TAI = "Xe tải"
XE_CON = "Xe con"

# Chu kỳ đăng kiểm → số tháng lịch. "Ngày cụ thể" = nhập tay hạn theo giấy chứng nhận.
CHU_KY_THANG = {"6 tháng": 6, "1 năm": 12, "2 năm": 24}
NGAY_CU_THE = "Ngày cụ thể"

# Field Vehicle mà phần lịch cần đọc — dùng chung cho API portal và Xếp chuyến.
TRUONG_LICH = (
	"last_odometer",
	"custom_ngay_cap_nhat_km",
	"custom_chu_ky_dang_kiem",
	"custom_ngay_dang_kiem",
	"custom_han_dang_kiem",
	"custom_thay_dau_moi_km",
	"custom_thay_dau_moi_thang",
	"custom_ngay_thay_dau",
	"custom_km_thay_dau",
)


# Ngưỡng "sắp đến hạn" — mặc định theo dưới, đổi được qua site_config.
def _nguong(key, default):
	return cint(frappe.conf.get(key) or default)


NGUONG_DANG_KIEM_NGAY = "qlx_canh_bao_dang_kiem_ngay"  # mặc định 30: còn ≤ 30 ngày → sắp đến hạn
NGUONG_NGAY = "qlx_canh_bao_ngay"                      # mặc định 15 (thay dầu, bảo dưỡng)
NGUONG_KM = "qlx_canh_bao_km"                          # mặc định 500 km
NGUONG_GAP_XEP_CHUYEN = 7                              # màn Xếp chuyến chỉ nói khi ĐK còn ≤ 7 ngày


# ════════════════════════════════════════════════════════════════════════════
# PHẦN THUẦN — không đụng DB, kiểm được không cần bench.
# ════════════════════════════════════════════════════════════════════════════
def _d(v):
	"""date | datetime | 'YYYY-MM-DD…' | rỗng → date | None."""
	if not v:
		return None
	if isinstance(v, datetime.datetime):
		return v.date()
	if isinstance(v, datetime.date):
		return v
	try:
		return datetime.date.fromisoformat(str(v)[:10])
	except ValueError:
		return getdate(v)  # định dạng khác ISO (hiếm, vd nhập từ file) — để Frappe tự hiểu


def _iso(v):
	d = _d(v)
	return d.isoformat() if d else None


def loai_xe(v):
	"""Loại xe hiệu lực. TRỐNG = XE TẢI.

	Xe tạo trước khi có trường `custom_loai_xe` (hoặc chèn bằng code không qua
	default) mang NULL/''. Coi đó là xe con thì toàn bộ đội xe đang chạy biến
	mất khỏi Xếp chuyến ngay sau khi deploy — đúng màn dùng hằng ngày.
	"""
	return XE_CON if (v or "").strip() == XE_CON else XE_TAI


def cong_thang(d, so_thang):
	"""Ngày `d` + `so_thang` tháng LỊCH, kẹp cuối tháng: 31/08 + 6 tháng = 28/02
	(29/02 năm nhuận).

	Không dùng timedelta(days=30 * n): "2 năm" là 730 hoặc 731 ngày tuỳ năm
	nhuận, mà hạn đăng kiểm ghi theo ngày lịch — lệch một ngày là xe chạy lố hạn
	đúng một ngày mà màn hình vẫn báo "còn hạn".
	"""
	d = _d(d)
	if not d:
		return None
	m0 = d.month - 1 + cint(so_thang)
	y, m = d.year + m0 // 12, m0 % 12 + 1
	return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def han_dang_kiem(chu_ky, ngay_gan_nhat, han_nhap=None):
	"""Hạn đăng kiểm theo chu kỳ của xe.

	6 tháng / 1 năm / 2 năm → LUÔN = lần gần nhất + chu kỳ (chưa có lần gần nhất
	thì chưa có hạn). "Ngày cụ thể" (hoặc chưa chọn chu kỳ) → giữ hạn nhập tay.
	Chu kỳ đổi là hạn đổi theo — không để một hạn tính theo chu kỳ cũ nằm lại.
	"""
	thang = CHU_KY_THANG.get(chu_ky or "")
	if thang:
		return cong_thang(ngay_gan_nhat, thang)
	return _d(han_nhap)


def muc_canh_bao(con_ngay=None, con_km=None, nguong_ngay=15, nguong_km=500):
	"""'qua_han' | 'sap_den' | 'ok' — mốc nào gấp hơn thì tính mốc đó.

	Ngày: hết hạn HÔM NAY (còn 0 ngày) vẫn còn giá trị → 'sap_den'; sang hôm sau
	mới 'qua_han'. Km: đồng hồ đã chạm mốc (còn ≤ 0 km) là đến hạn → 'qua_han'.
	"""
	if (con_ngay is not None and con_ngay < 0) or (con_km is not None and con_km <= 0):
		return "qua_han"
	if (con_ngay is not None and con_ngay <= nguong_ngay) or (con_km is not None and con_km <= nguong_km):
		return "sap_den"
	return "ok"


def _so(n):
	"""12345 → '12.345' (dấu chấm ngăn nghìn kiểu Việt)."""
	return f"{int(n):,}".replace(",", ".")


def nhan_muc(con_ngay=None, con_km=None):
	"""Nhãn ngắn: 'Quá hạn 3 ngày', 'Đến hạn hôm nay', 'Còn 1.550 km · 107 ngày'.
	Phần đã quá hạn đứng TRƯỚC — người đọc lướt chỉ kịp thấy chữ đầu."""
	parts = []  # (đã quá hạn?, chữ)
	if con_km is not None:
		if con_km < 0:
			parts.append((True, f"Quá {_so(-con_km)} km"))
		elif con_km == 0:
			parts.append((True, "Đến mốc km"))
		else:
			parts.append((False, f"Còn {_so(con_km)} km"))
	if con_ngay is not None:
		if con_ngay < 0:
			parts.append((True, f"Quá hạn {_so(-con_ngay)} ngày"))
		elif con_ngay == 0:
			parts.append((False, "Đến hạn hôm nay"))
		else:
			parts.append((False, f"Còn {_so(con_ngay)} ngày"))
	parts.sort(key=lambda p: not p[0])  # sort ổn định: phần quá hạn lên đầu
	texts = [t for _q, t in parts]
	if len(texts) == 2:
		second = texts[1]
		if texts[0].startswith("Còn ") and second.startswith("Còn "):
			second = second[len("Còn "):]  # 'Còn 1.550 km · 107 ngày', không lặp 'còn'
		texts[1] = second[:1].lower() + second[1:]
	return " · ".join(texts)


def _muc(hom_nay, han=None, km_tiep=None, km_hien_tai=None, nguong_ngay=15, nguong_km=500):
	con_ngay = (han - hom_nay).days if han else None
	con_km = (km_tiep - km_hien_tai) if (km_tiep and km_hien_tai) else None
	if con_ngay is None and con_km is None:
		return {"con_ngay": None, "con_km": None, "muc": "chua_co", "nhan": ""}
	return {
		"con_ngay": con_ngay,
		"con_km": con_km,
		"muc": muc_canh_bao(con_ngay, con_km, nguong_ngay, nguong_km),
		"nhan": nhan_muc(con_ngay, con_km),
	}


def lich_cua_xe(v, hom_nay=None, bao_duong=None):
	"""Ba mục lịch của một xe kèm mức cảnh báo.

	`v`         dict field Vehicle (ít nhất TRUONG_LICH).
	`bao_duong` bản ghi Bảo dưỡng MỚI NHẤT của xe (dict) hoặc None.

	muc: 'qua_han' | 'sap_den' | 'ok' | 'chua_co' (đã có chu kỳ, thiếu mốc) |
	     'chua_cai' (chưa chọn chu kỳ). Bảo dưỡng không hẹn gì → None.
	"""
	v = v or {}
	hom_nay = _d(hom_nay) or _d(nowdate())
	km_now = cint(v.get("last_odometer")) or None

	# ── Đăng kiểm ──
	chu_ky = v.get("custom_chu_ky_dang_kiem") or ""
	ngay_dk = _d(v.get("custom_ngay_dang_kiem"))
	han = han_dang_kiem(chu_ky, ngay_dk, v.get("custom_han_dang_kiem"))
	dk = {"chu_ky": chu_ky, "ngay": _iso(ngay_dk), "han": _iso(han)}
	if not chu_ky and not han:
		dk.update(con_ngay=None, con_km=None, muc="chua_cai", nhan="")
	else:
		dk.update(_muc(hom_nay, han=han, nguong_ngay=_nguong(NGUONG_DANG_KIEM_NGAY, 30)))

	# ── Thay dầu: theo km và/hoặc theo tháng, mốc nào tới trước ──
	moi_km = cint(v.get("custom_thay_dau_moi_km"))
	moi_thang = cint(v.get("custom_thay_dau_moi_thang"))
	ngay_td = _d(v.get("custom_ngay_thay_dau"))
	km_td = cint(v.get("custom_km_thay_dau"))
	han_td = cong_thang(ngay_td, moi_thang) if (ngay_td and moi_thang > 0) else None
	km_tiep = (km_td + moi_km) if (km_td > 0 and moi_km > 0) else None
	td = {
		"moi_km": moi_km,
		"moi_thang": moi_thang,
		"ngay": _iso(ngay_td),
		"km": km_td,
		"han": _iso(han_td),
		"km_tiep": km_tiep,
	}
	if moi_km <= 0 and moi_thang <= 0:
		td.update(con_ngay=None, con_km=None, muc="chua_cai", nhan="")
	else:
		td.update(_muc(hom_nay, han=han_td, km_tiep=km_tiep, km_hien_tai=km_now,
			nguong_ngay=_nguong(NGUONG_NGAY, 15), nguong_km=_nguong(NGUONG_KM, 500)))

	# ── Bảo dưỡng: hẹn của bản ghi mới nhất (nếu có) ──
	bd = None
	if bao_duong:
		han_bd = _d(bao_duong.get("han_tiep"))
		km_bd = cint(bao_duong.get("km_tiep")) or None
		bd = {"ngay": _iso(bao_duong.get("ngay")), "han": _iso(han_bd), "km_tiep": km_bd}
		if han_bd or km_bd:
			bd.update(_muc(hom_nay, han=han_bd, km_tiep=km_bd, km_hien_tai=km_now,
				nguong_ngay=_nguong(NGUONG_NGAY, 15), nguong_km=_nguong(NGUONG_KM, 500)))
		else:
			bd.update(con_ngay=None, con_km=None, muc=None, nhan="")

	return {"dang_kiem": dk, "thay_dau": td, "bao_duong": bd}


def canh_bao_xep_chuyen(lich):
	"""Cảnh báo NGẮN cho nút chọn xe ở Xếp chuyến — chỉ việc GẤP (xe sắp không được
	phép chạy), để màn dùng hằng ngày không rối thêm."""
	out = []
	dk = lich.get("dang_kiem") or {}
	if dk.get("muc") == "qua_han":
		out.append({"muc": "qua_han", "text": "ĐK quá hạn"})
	elif dk.get("muc") == "sap_den" and dk.get("con_ngay") is not None and dk["con_ngay"] <= NGUONG_GAP_XEP_CHUYEN:
		n = dk["con_ngay"]
		out.append({"muc": "sap_den", "text": "ĐK hết hạn hôm nay" if n == 0 else f"ĐK còn {n} ngày"})
	if (lich.get("thay_dau") or {}).get("muc") == "qua_han":
		out.append({"muc": "qua_han", "text": "Quá hạn thay dầu"})
	return out


# ════════════════════════════════════════════════════════════════════════════
# ĐỒNG BỘ LỊCH TRÊN XE — ghi Vehicle bằng db.set_value (giữ cập nhật `modified`
# để form Vehicle đang mở trên Desk báo "đã bị sửa" thay vì lưu đè lịch cũ).
# ════════════════════════════════════════════════════════════════════════════
def _lich_hien_tai(xe):
	return frappe.db.get_value(
		"Vehicle", xe,
		["custom_chu_ky_dang_kiem", "custom_ngay_dang_kiem", "custom_han_dang_kiem",
		 "custom_ngay_thay_dau", "custom_km_thay_dau"],
		as_dict=True,
	) or frappe._dict()


def _la_moc(tt, ban_ghi):
	"""Bản ghi này có đang là MỐC của lịch xe không (lịch đang mang đúng số của nó)."""
	if ban_ghi.loai == DANG_KIEM:
		return _d(tt.get("custom_ngay_dang_kiem")) == _d(ban_ghi.ngay)
	return (_d(tt.get("custom_ngay_thay_dau")) == _d(ban_ghi.ngay)
		and cint(tt.get("custom_km_thay_dau")) == cint(ban_ghi.so_km))


def _moc_ngay(tt, loai):
	return _d(tt.get("custom_ngay_dang_kiem") if loai == DANG_KIEM else tt.get("custom_ngay_thay_dau"))


def _ban_ghi_moi_nhat(xe, loai, tru=None):
	filters = {"xe": xe, "loai": loai}
	if tru:
		filters["name"] = ["!=", tru]
	rows = frappe.get_all(
		"Nhat Ky Xe", filters=filters, fields=["name", "loai", "ngay", "so_km", "han_tiep"],
		order_by="ngay desc, creation desc", limit=1,
	)
	return rows[0] if rows else None


def _ap_dung(xe, ban_ghi, tt):
	if ban_ghi.loai == DANG_KIEM:
		ngay = _d(ban_ghi.ngay)
		vals = {
			"custom_ngay_dang_kiem": ngay,
			"custom_han_dang_kiem": han_dang_kiem(tt.get("custom_chu_ky_dang_kiem"), ngay, ban_ghi.han_tiep),
		}
	else:
		vals = {"custom_ngay_thay_dau": _d(ban_ghi.ngay), "custom_km_thay_dau": cint(ban_ghi.so_km)}
	frappe.db.set_value("Vehicle", xe, vals)


def _xoa_moc(xe, loai):
	if loai == DANG_KIEM:
		vals = {"custom_ngay_dang_kiem": None, "custom_han_dang_kiem": None}
	else:
		vals = {"custom_ngay_thay_dau": None, "custom_km_thay_dau": 0}
	frappe.db.set_value("Vehicle", xe, vals)


def dong_bo_lich(xe, loai, cu=None, moi=None):
	"""Đồng bộ lịch của xe sau khi nhật ký đổi.

	thêm  → (cu=None, moi=bản ghi) · sửa → (cu=bản trước khi lưu, moi=bản mới)
	xoá   → (cu=bản ghi, moi=None)

	Bản ghi CŨ đang là mốc → tính lại từ bản ghi mới nhất còn lại (lúc sửa: tính
	cả bản vừa lưu); hết bản ghi → xoá mốc. Ngược lại bản ghi MỚI chỉ đẩy lịch khi
	KHÔNG cũ hơn mốc đang lưu: nhập bù một lần thay dầu năm ngoái không được kéo
	lùi lịch đang chạy, và không đè mốc người dùng đã khai tay ở "Cài lịch".
	"""
	if loai not in CO_LICH or not xe:
		return
	tt = _lich_hien_tai(xe)
	if cu is not None and _la_moc(tt, cu):
		con_lai = _ban_ghi_moi_nhat(xe, loai, tru=cu.name if moi is None else None)
		if con_lai:
			_ap_dung(xe, con_lai, tt)
		else:
			_xoa_moc(xe, loai)
		return
	if moi is not None:
		moc = _moc_ngay(tt, loai)
		if moc is None or _d(moi.ngay) >= moc:
			_ap_dung(xe, moi, tt)


def bao_duong_moi_nhat(xe_list):
	"""{xe: bản ghi Bảo dưỡng MỚI NHẤT} — nguồn của "hẹn bảo dưỡng lần sau".

	SQL: "mới nhất MỖI xe" = JOIN với MAX(ngay) GROUP BY xe — get_all không diễn đạt
	được. Hai bản ghi cùng ngày thì bản tạo sau thắng (ORDER BY creation DESC +
	setdefault), khớp thứ tự `_ban_ghi_moi_nhat`.
	"""
	if not xe_list:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT n.xe, n.name, n.ngay, n.so_km, n.han_tiep, n.km_tiep
		FROM `tabNhat Ky Xe` n
		JOIN (
			SELECT xe, MAX(ngay) AS ngay FROM `tabNhat Ky Xe`
			WHERE loai = %(loai)s AND xe IN %(xe)s
			GROUP BY xe
		) m ON m.xe = n.xe AND m.ngay = n.ngay
		WHERE n.loai = %(loai)s
		ORDER BY n.creation DESC
		""",
		{"loai": BAO_DUONG, "xe": list(xe_list)},
		as_dict=True,
	)
	out = {}
	for r in rows:
		out.setdefault(r.xe, r)
	return out


def cap_nhat_km(xe, km, ngay=None):
	"""Số km đồng hồ CHỈ TIẾN qua nhật ký: bản ghi có km lớn hơn số đang lưu thì ghi.

	`last_odometer` là set_only_once trên Vehicle → ghi bằng db.set_value (cùng cách
	HRMS Vehicle Log làm). Muốn SỬA LÙI (gõ nhầm) thì dùng "Cập nhật km" ở portal.
	"""
	km = cint(km)
	if not xe or km <= 0:
		return
	if km > cint(frappe.db.get_value("Vehicle", xe, "last_odometer")):
		frappe.db.set_value(
			"Vehicle", xe, {"last_odometer": km, "custom_ngay_cap_nhat_km": _d(ngay) or _d(nowdate())}
		)


def vehicle_validate(doc, method=None):
	"""doc_events Vehicle.validate — giữ `custom_han_dang_kiem` khớp chu kỳ, kể cả
	khi sửa tay trên Desk (chu kỳ 6 tháng/1 năm/2 năm thì hạn luôn do máy tính).

	KHÔNG throw: hook chạy cho MỌI lần lưu Vehicle, kể cả của app khác — một ngày
	gõ lỗi trên lịch đăng kiểm không được chặn việc của họ.
	"""
	if not doc.meta.has_field("custom_han_dang_kiem"):
		return
	try:
		doc.custom_han_dang_kiem = han_dang_kiem(
			doc.get("custom_chu_ky_dang_kiem"), doc.get("custom_ngay_dang_kiem"), doc.get("custom_han_dang_kiem")
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "vanchuyen: tính hạn đăng kiểm khi lưu Vehicle")


def _khac(a, b):
	return str(a if a is not None else "") != str(b if b is not None else "")


# ════════════════════════════════════════════════════════════════════════════
class NhatKyXe(Document):
	def validate(self):
		self._kiem_so_lieu()
		self._dien_han_tiep()

	def on_update(self):
		# on_update chạy cả SAU insert (khi đó chưa có bản trước khi lưu).
		cu = self.get_doc_before_save()
		if cu is None:
			dong_bo_lich(self.xe, self.loai, moi=self)
		elif any(_khac(cu.get(f), self.get(f)) for f in ("ngay", "so_km", "han_tiep")):
			dong_bo_lich(self.xe, self.loai, cu=cu, moi=self)
		cap_nhat_km(self.xe, self.so_km, self.ngay)

	def on_trash(self):
		# Bản ghi vẫn còn trong DB lúc này → dong_bo_lich tự loại chính nó khi tìm bản còn lại.
		dong_bo_lich(self.xe, self.loai, cu=self)

	# ── internal ────────────────────────────────────────────────────────────
	def _kiem_so_lieu(self):
		ngay = _d(self.ngay)
		if ngay and ngay > _d(nowdate()):
			frappe.throw(
				_("Ngày thực hiện {0} ở tương lai — nhật ký chỉ ghi việc ĐÃ làm. "
				  "Hẹn lần sau thì nhập ở ô hẹn.").format(ngay.strftime("%d/%m/%Y"))
			)
		if cint(self.so_km) < 0 or cint(self.km_tiep) < 0:
			frappe.throw(_("Số km không được âm."))
		if flt(self.chi_phi) < 0:
			frappe.throw(_("Chi phí không được âm."))

	def _dien_han_tiep(self):
		ngay = _d(self.ngay)
		if self.loai == DANG_KIEM:
			chu_ky = frappe.db.get_value("Vehicle", self.xe, "custom_chu_ky_dang_kiem") or ""
			if chu_ky in CHU_KY_THANG:
				# Chu kỳ cố định → hạn do máy tính, không nhận số gõ tay (lệch lịch xe).
				self.han_tiep = cong_thang(ngay, CHU_KY_THANG[chu_ky])
			elif not self.han_tiep:
				if chu_ky == NGAY_CU_THE:
					frappe.throw(_("Nhập hạn đăng kiểm mới (ghi trên giấy chứng nhận / tem kiểm định)."))
				frappe.throw(
					_("Xe {0} chưa chọn chu kỳ đăng kiểm — chọn 6 tháng / 1 năm / 2 năm, "
					  "hoặc 'Ngày cụ thể' rồi nhập hạn mới.").format(self.xe)
				)
			if ngay and _d(self.han_tiep) <= ngay:
				frappe.throw(_("Hạn đăng kiểm mới phải sau ngày đăng kiểm."))
		elif self.loai == BAO_DUONG:
			if self.han_tiep and ngay and _d(self.han_tiep) <= ngay:
				frappe.throw(_("Ngày hẹn bảo dưỡng lần sau phải sau ngày làm."))
			if cint(self.km_tiep) and cint(self.so_km) and cint(self.km_tiep) <= cint(self.so_km):
				frappe.throw(_("Km hẹn bảo dưỡng lần sau phải lớn hơn số km lúc làm."))
		else:
			# Thay dầu tính "lần tới" từ chu kỳ của XE; Sửa chữa không có lịch. Ô hẹn gõ
			# tay ở hai loại này không nhắc ai cả — xoá đi để không ai tưởng đã có nhắc.
			self.han_tiep = None
			self.km_tiep = 0
