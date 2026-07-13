"""API CHI TRẢ TIỀN CƯỚC cho lái xe (view #/tra-cuoc — điều hành/kế toán).

Danh sách chuyến theo ngày → sửa tay tiền cước → QR chuyển khoản → tạo Journal Entry.
Bút toán: Nợ 6412 (chi phí vận chuyển) / Có 141 (tạm ứng, party Employee) — đổi được qua
site_config. Đánh dấu da_tra_cuoc + cuoc_je để chống trả trùng.

site_config:
  cuoc_debit_account   (mặc định '6412 - Chi phí bán hàng GT - HGC')
  cuoc_credit_account  (mặc định '141 - Tạm ứng - HGC')
  cuoc_credit_party_type (mặc định 'Employee')
  cuoc_credit_party    (BẮT BUỘC — mã nhân viên giữ quỹ tạm ứng, VD HR-EMP-00001)
  nhap_don_company / vanchuyen_company (mặc định 'Công ty cổ phần Hoàng Giang')
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, formatdate, get_first_day, get_last_day, getdate

from vanchuyen.api.guards import is_admin


def _cfg(key, default):
	return frappe.conf.get(key) or default


def _require_view():
	if not (frappe.has_permission("Sales Invoice", "read") or is_admin()):
		frappe.throw(_("Bạn không có quyền xem chi trả cước."), frappe.PermissionError)


def _require_pay():
	if not (frappe.has_permission("Journal Entry", "create") or is_admin()):
		frappe.throw(_("Bạn không có quyền tạo bút toán trả cước."), frappe.PermissionError)


def _accounts():
	return {
		"company": _cfg("vanchuyen_company", None) or _cfg("nhap_don_company", "Công ty cổ phần Hoàng Giang"),
		"debit": _cfg("cuoc_debit_account", "6412 - Chi phí bán hàng GT - HGC"),
		"credit": _cfg("cuoc_credit_account", "141 - Tạm ứng - HGC"),
		"party_type": _cfg("cuoc_credit_party_type", "Employee"),
		"party": _cfg("cuoc_credit_party", "HR-EMP-00001"),
	}


# ── Chi tiền thủ công (giống trang quỹ dầu) ──────────────────────────────────
@frappe.whitelist()
def get_fund_summary():
	"""Số dư quỹ tạm ứng (141 + party) = SUM(debit - credit) trên GL Entry."""
	_require_view()
	acc = _accounts()
	bal = frappe.db.sql(
		"""SELECT COALESCE(SUM(debit - credit), 0) FROM `tabGL Entry`
		   WHERE account = %(a)s AND party = %(p)s AND is_cancelled = 0""",
		{"a": acc["credit"], "p": acc["party"]},
	)[0][0]
	return {"balance": flt(bal), "account": acc["credit"], "party": acc["party"]}


@frappe.whitelist()
def get_pay_drivers():
	"""Danh sách lái xe + TK ngân hàng cho chọn nhanh khi chi thủ công."""
	_require_view()
	out = []
	for d in frappe.get_all(
		"Driver",
		fields=["name", "full_name", "cell_number", "custom_nganhang", "custom_stk", "custom_tentk"],
		order_by="full_name asc",
	):
		out.append(
			{
				"name": d.name,
				"full_name": d.full_name or d.name,
				"phone": d.cell_number or "",
				"bank": {
					"nganhang": d.custom_nganhang or "",
					"stk": d.custom_stk or "",
					"tentk": d.custom_tentk or d.full_name or "",
				},
			}
		)
	return out


@frappe.whitelist()
def create_manual_je(posting_date, amount, content, debit_account, submit=1):
	"""Chi tiền thủ công: Nợ [TK chi phí chọn] / Có 141 (party). Không gắn chuyến nào."""
	_require_pay()
	amount = flt(amount)
	content = (content or "").strip()
	if amount <= 0:
		frappe.throw(_("Nhập số tiền > 0."))
	if not content:
		frappe.throw(_("Nhập nội dung chi."))
	if not frappe.db.exists("Account", debit_account):
		frappe.throw(_("Tài khoản chi phí '{0}' không tồn tại.").format(debit_account))
	je = _make_je(posting_date, [{"amount": amount, "remark": content}], content, submit, debit_account=debit_account)
	return {"journal_entry": je}


# ── Lịch: tổng cước theo ngày ────────────────────────────────────────────────
@frappe.whitelist()
def get_pay_calendar(nam, thang):
	"""Tổng cước + số chuyến + số chưa trả theo từng ngày trong tháng (cho heatmap lịch)."""
	_require_view()
	nam, thang = cint(nam), cint(thang)
	first = get_first_day(getdate(f"{nam}-{thang:02d}-01"))
	last = get_last_day(first)
	rows = frappe.db.sql(
		"""SELECT ngay_giao,
		          COUNT(*) AS tot,
		          COALESCE(SUM(tong_cuoc), 0) AS tong,
		          SUM(IF(COALESCE(da_tra_cuoc,0)=0 AND tong_cuoc>0, 1, 0)) AS chua_tra
		   FROM `tabChuyen Xe`
		   WHERE docstatus = 1 AND ngay_giao BETWEEN %(f)s AND %(l)s
		   GROUP BY ngay_giao""",
		{"f": first, "l": last}, as_dict=True,
	)
	return {
		str(r.ngay_giao): {"tot": cint(r.tot), "tong": flt(r.tong), "chua_tra": cint(r.chua_tra)}
		for r in rows
	}


# ── Danh sách chuyến của 1 ngày ──────────────────────────────────────────────
@frappe.whitelist()
def get_trips_for_pay(ngay):
	"""Chuyến đã xuất (docstatus=1) trong ngày, kèm đơn hàng + cước + TK ngân hàng lái xe."""
	_require_view()
	trips = frappe.get_all(
		"Chuyen Xe",
		filters={"docstatus": 1, "ngay_giao": getdate(ngay)},
		fields=[
			"name", "lai_xe", "ten_lai_xe", "sdt_lai_xe", "xe", "trang_thai",
			"tong_cuoc", "cuoc_thu_cong", "da_tra_cuoc", "cuoc_je",
		],
		order_by="creation asc",
	)
	if not trips:
		return []

	names = [t.name for t in trips]
	stops_by = {}
	for r in frappe.db.sql(
		"""SELECT parent, khach_hang, dia_chi, so_po, so_kien
		   FROM `tabChuyen Xe Don Hang` WHERE parent IN %(n)s ORDER BY parent, idx""",
		{"n": names}, as_dict=True,
	):
		stops_by.setdefault(r.parent, []).append(
			{"khach_hang": r.khach_hang, "dia_chi": r.dia_chi, "so_po": r.so_po, "so_kien": flt(r.so_kien)}
		)

	# TK ngân hàng lái xe (field đã có sẵn trên Driver).
	drivers = list({t.lai_xe for t in trips if t.lai_xe})
	bank_by = {}
	if drivers:
		for d in frappe.get_all(
			"Driver", filters={"name": ["in", drivers]},
			fields=["name", "full_name", "cell_number", "custom_nganhang", "custom_stk", "custom_tentk"],
		):
			bank_by[d.name] = d

	out = []
	for t in trips:
		d = bank_by.get(t.lai_xe) or {}
		out.append(
			{
				"name": t.name,
				"lai_xe": t.lai_xe,
				"ten_lai_xe": t.ten_lai_xe or (d.get("full_name") if d else ""),
				"sdt_lai_xe": t.sdt_lai_xe or (d.get("cell_number") if d else ""),
				"xe": t.xe,
				"trang_thai": t.trang_thai,
				"tong_cuoc": flt(t.tong_cuoc),
				"cuoc_thu_cong": cint(t.cuoc_thu_cong),
				"da_tra_cuoc": cint(t.da_tra_cuoc),
				"cuoc_je": t.cuoc_je,
				"stops": stops_by.get(t.name, []),
				"bank": {
					"nganhang": d.get("custom_nganhang") if d else "",
					"stk": d.get("custom_stk") if d else "",
					"tentk": (d.get("custom_tentk") or d.get("full_name")) if d else "",
				},
			}
		)
	return out


# ── Sửa tay tiền cước ────────────────────────────────────────────────────────
@frappe.whitelist()
def set_trip_cuoc(name, amount):
	"""Ghi đè tổng cước bằng tay (khoá tự tính). Không cho sửa nếu đã trả."""
	_require_pay()
	info = frappe.db.get_value("Chuyen Xe", name, ["da_tra_cuoc", "docstatus"], as_dict=True)
	if not info:
		frappe.throw(_("Không tìm thấy chuyến."))
	if cint(info.da_tra_cuoc):
		frappe.throw(_("Chuyến đã trả cước — không sửa được tiền."))
	amount = flt(amount)
	if amount < 0:
		frappe.throw(_("Số tiền không hợp lệ."))
	# set_value trực tiếp (KHÔNG qua validate) để không bị _compute_cuoc ghi đè; cuoc_thu_cong
	# khoá luôn cho các lần lưu/điều chỉnh sau.
	frappe.db.set_value(
		"Chuyen Xe", name, {"tong_cuoc": amount, "cuoc_thu_cong": 1}, update_modified=False
	)
	frappe.db.commit()
	return {"name": name, "tong_cuoc": amount, "cuoc_thu_cong": 1}


# ── Tạo Journal Entry ────────────────────────────────────────────────────────
def _make_je(posting_date, lines, remark, submit=True, debit_account=None):
	"""lines = [{trip, amount, remark}]. Nợ [debit_account|6412] mỗi dòng + Có 141 tổng (party)."""
	acc = _accounts()
	if not acc["party"]:
		frappe.throw(
			_("Chưa cấu hình nhân viên giữ quỹ (cuoc_credit_party trong site_config) — bút toán 141 cần party.")
		)
	debit = debit_account or acc["debit"]
	total = sum(flt(l["amount"]) for l in lines)
	if total <= 0:
		frappe.throw(_("Tổng cước phải > 0."))

	je_accounts = []
	for l in lines:
		je_accounts.append(
			{
				"account": debit,
				"debit_in_account_currency": flt(l["amount"]),
				"credit_in_account_currency": 0,
				"user_remark": l.get("remark"),
			}
		)
	je_accounts.append(
		{
			"account": acc["credit"],
			"party_type": acc["party_type"],
			"party": acc["party"],
			"debit_in_account_currency": 0,
			"credit_in_account_currency": total,
		}
	)
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"posting_date": getdate(posting_date),
			"company": acc["company"],
			"user_remark": remark,
			"accounts": je_accounts,
		}
	)
	je.insert()
	if cint(submit):
		je.submit()
	return je.name


@frappe.whitelist()
def pay_trip(name, submit=1):
	"""Tạo bút toán trả cước cho MỘT chuyến. Đánh dấu da_tra_cuoc + cuoc_je."""
	_require_pay()
	t = frappe.db.get_value(
		"Chuyen Xe", name, ["tong_cuoc", "da_tra_cuoc", "ten_lai_xe", "xe", "ngay_giao"], as_dict=True
	)
	if not t:
		frappe.throw(_("Không tìm thấy chuyến."))
	if cint(t.da_tra_cuoc):
		frappe.throw(_("Chuyến {0} đã tạo bút toán trả cước.").format(name))
	remark = _("Trả cước chuyến {0} - {1} - xe {2}").format(name, t.ten_lai_xe or "", t.xe or "")
	je = _make_je(t.ngay_giao, [{"trip": name, "amount": t.tong_cuoc, "remark": remark}], remark, submit)
	frappe.db.set_value("Chuyen Xe", name, {"da_tra_cuoc": 1, "cuoc_je": je}, update_modified=False)
	frappe.db.commit()
	return {"trip": name, "journal_entry": je}


@frappe.whitelist()
def pay_day(ngay, submit=1):
	"""Tạo 1 bút toán gom TẤT CẢ chuyến CHƯA trả (cước>0) của ngày. Mỗi chuyến 1 dòng Nợ."""
	_require_pay()
	trips = frappe.get_all(
		"Chuyen Xe",
		filters={"docstatus": 1, "ngay_giao": getdate(ngay), "da_tra_cuoc": 0, "tong_cuoc": [">", 0]},
		fields=["name", "tong_cuoc", "ten_lai_xe", "xe"],
		order_by="creation asc",
	)
	if not trips:
		frappe.throw(_("Không có chuyến nào chưa trả cước trong ngày."))
	lines = [
		{
			"trip": t.name,
			"amount": t.tong_cuoc,
			"remark": _("Cước {0} - {1} - xe {2}").format(t.name, t.ten_lai_xe or "", t.xe or ""),
		}
		for t in trips
	]
	remark = _("Trả cước ngày {0}: {1} chuyến").format(formatdate(ngay), len(trips))
	je = _make_je(ngay, lines, remark, submit)
	for t in trips:
		frappe.db.set_value("Chuyen Xe", t.name, {"da_tra_cuoc": 1, "cuoc_je": je}, update_modified=False)
	frappe.db.commit()
	return {"journal_entry": je, "count": len(trips)}
