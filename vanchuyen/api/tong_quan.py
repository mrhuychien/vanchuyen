"""API TỔNG QUAN vận chuyển cho view #/tong-quan (Điều hành / quản trị).

Tổng hợp số liệu kiểm soát vận chuyển từ Sales Invoice + Chuyen Xe theo khoảng thời gian.
Guard = has_permission Sales Invoice read (giống dieu_hanh)."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, nowdate

STATUS_ORDER = ["Đang xử lý", "Đang giao hàng", "Đã giao hàng, chụp chứng từ", "Đã nộp chứng từ"]
TRIP_STATUS_ORDER = ["Nháp", "Đang giao", "Hoàn thành"]


def _require_si_read():
	if not frappe.has_permission("Sales Invoice", "read"):
		frappe.throw(_("Bạn không có quyền xem hoá đơn."), frappe.PermissionError)


def _start_date(period):
	"""period: 'today' | '7' | '30' | '90' | 'all' → ngày bắt đầu (None nếu all)."""
	if period == "today":
		return nowdate()
	if period == "all":
		return None
	try:
		n = int(period)
	except (TypeError, ValueError):
		n = 30
	return add_days(nowdate(), -n)


@frappe.whitelist()
def get_overview(period="30"):
	"""Trả về các chỉ số tổng quan vận chuyển trong khoảng thời gian."""
	_require_si_read()
	start = _start_date(period)

	conds = ["si.docstatus = 1", "si.is_return = 0", "COALESCE(si.customer_group, '') != 'Showroom'"]
	p = {}
	if start:
		conds.append("si.posting_date >= %(tu)s")
		p["tu"] = start
	where = " AND ".join(conds)

	# Tổng + tổng kiện + tổng thể tích
	agg = frappe.db.sql(
		f"""SELECT COUNT(*) AS total,
		           COALESCE(SUM(si.`custom_tổng_kiện`),0) AS tong_kien,
		           COALESCE(SUM(si.`custom_thể_tích_lô`),0) AS the_tich
		    FROM `tabSales Invoice` si WHERE {where}""",
		p, as_dict=True,
	)[0]
	total = cint(agg.total)

	# Theo trạng thái vận chuyển (NULL/'' → Đang xử lý)
	by_status = {s: 0 for s in STATUS_ORDER}
	for row in frappe.db.sql(
		f"""SELECT COALESCE(NULLIF(si.`custom_trạng_thái_vận_chuyển`, ''), 'Đang xử lý') AS st, COUNT(*) AS c
		    FROM `tabSales Invoice` si WHERE {where} GROUP BY st""",
		p, as_dict=True,
	):
		by_status[row.st] = by_status.get(row.st, 0) + cint(row.c)

	# Theo hình thức vận chuyển (NULL/'' → Chưa phân công)
	by_type = {}
	for row in frappe.db.sql(
		f"""SELECT COALESCE(NULLIF(si.`custom_hình_thức_vận_chuyển`, ''), 'Chưa phân công') AS ht, COUNT(*) AS c
		    FROM `tabSales Invoice` si WHERE {where} GROUP BY ht ORDER BY c DESC""",
		p, as_dict=True,
	):
		by_type[row.ht] = cint(row.c)

	chua_phan_cong = by_type.get("Chưa phân công", 0)
	dang_giao = by_status.get("Đang giao hàng", 0)
	da_giao = by_status.get("Đã giao hàng, chụp chứng từ", 0) + by_status.get("Đã nộp chứng từ", 0)
	da_nop = by_status.get("Đã nộp chứng từ", 0)
	ty_le_giao = round(da_giao * 100.0 / total, 1) if total else 0.0
	ty_le_phan_cong = round((total - chua_phan_cong) * 100.0 / total, 1) if total else 0.0

	# ── Chuyến xe ──
	tconds = ["cx.docstatus != 2"]
	tp = {}
	if start:
		tconds.append("cx.ngay_giao >= %(tu)s")
		tp["tu"] = start
	twhere = " AND ".join(tconds)

	trips_total = cint(
		frappe.db.sql(f"SELECT COUNT(*) FROM `tabChuyen Xe` cx WHERE {twhere}", tp)[0][0]
	)
	trips_by_status = {s: 0 for s in TRIP_STATUS_ORDER}
	for row in frappe.db.sql(
		f"SELECT COALESCE(NULLIF(cx.trang_thai,''),'Nháp') AS st, COUNT(*) AS c FROM `tabChuyen Xe` cx WHERE {twhere} GROUP BY st",
		tp, as_dict=True,
	):
		trips_by_status[row.st] = trips_by_status.get(row.st, 0) + cint(row.c)

	# Top lái xe theo số chuyến
	top_drivers = []
	for row in frappe.db.sql(
		f"""SELECT COALESCE(NULLIF(cx.ten_lai_xe,''), cx.lai_xe) AS ten,
		           COUNT(*) AS so_chuyen, COALESCE(SUM(cx.tong_don),0) AS so_don,
		           COALESCE(SUM(cx.tong_the_tich),0) AS the_tich
		    FROM `tabChuyen Xe` cx WHERE {twhere} AND cx.lai_xe IS NOT NULL
		    GROUP BY cx.lai_xe ORDER BY so_chuyen DESC LIMIT 5""",
		tp, as_dict=True,
	):
		top_drivers.append(
			{
				"ten": row.ten or "—",
				"so_chuyen": cint(row.so_chuyen),
				"so_don": cint(row.so_don),
				"the_tich": flt(row.the_tich),
			}
		)

	# ── Sự cố vận chuyển (đơn giao qua đơn vị VC) ──
	su_co_mo = 0
	su_co_loai = []
	if frappe.db.table_exists("Su Co Van Chuyen"):
		su_co_mo = cint(frappe.db.count("Su Co Van Chuyen", {"trang_thai": ["in", ["Mới", "Đang xử lý"]]}))
		for row in frappe.db.sql(
			"""SELECT loai_su_co AS l, COUNT(*) AS n FROM `tabSu Co Van Chuyen`
			   WHERE trang_thai IN ('Mới','Đang xử lý') GROUP BY loai_su_co ORDER BY n DESC""",
			as_dict=True,
		):
			su_co_loai.append({"label": row.l, "count": cint(row.n)})

	return {
		"period": period,
		"start": start,
		"total": total,
		"su_co_mo": su_co_mo,
		"su_co_loai": su_co_loai,
		"tong_kien": flt(agg.tong_kien),
		"the_tich": flt(agg.the_tich),
		"chua_phan_cong": chua_phan_cong,
		"dang_giao": dang_giao,
		"da_giao": da_giao,
		"da_nop": da_nop,
		"ty_le_giao": ty_le_giao,
		"ty_le_phan_cong": ty_le_phan_cong,
		"by_status": [{"label": s, "count": by_status.get(s, 0)} for s in STATUS_ORDER],
		"by_type": [{"label": k, "count": v} for k, v in by_type.items()],
		"trips_total": trips_total,
		"trips_by_status": [{"label": s, "count": trips_by_status.get(s, 0)} for s in TRIP_STATUS_ORDER],
		"top_drivers": top_drivers,
	}
