"""Whitelisted API cho Điều Phối Vận Chuyển: pool đơn, tạo/sửa/submit/hủy/hoàn thành/
điều chỉnh chuyến. Mọi method guard require_dieu_phoi() ở dòng đầu. SQL trực tiếp trên
Sales Invoice có comment vì sao không dùng ORM (join + field có dấu + bỏ qua perm SI sau guard)."""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from vanchuyen.api.guards import require_dieu_phoi
from vanchuyen.van_chuyen.doctype.chuyen_xe.chuyen_xe import _format_dia_chi, da_xep


@frappe.whitelist()
def get_pool(tu_ngay=None, den_ngay=None, tinh=None, tim=None, page=1, page_size=30):
	"""Pool đơn 'Tự vận chuyển' chưa xếp đủ. Filter + paginate SERVER-SIDE.

	Dùng SQL: cần đọc nhiều field production có dấu + COALESCE trên custom_trang_thai_xep,
	và Điều Phối không có DocType perm trên Sales Invoice (guard đã thay perm)."""
	require_dieu_phoi()
	page = cint(page) or 1
	page_size = min(cint(page_size) or 30, 100)

	conds = [
		"si.docstatus = 1",
		"si.is_return = 0",
		"si.`custom_hình_thức_vận_chuyển` = 'Tự vận chuyển'",
		"COALESCE(si.`custom_trang_thai_xep`, '') != 'Đủ'",
	]
	params = {}
	if tu_ngay:
		conds.append("si.posting_date >= %(tu)s")
		params["tu"] = tu_ngay
	if den_ngay:
		conds.append("si.posting_date <= %(den)s")
		params["den"] = den_ngay
	if tinh:
		conds.append("si.`custom_tỉnh` = %(tinh)s")
		params["tinh"] = tinh
	if tim:
		conds.append("(si.customer_name LIKE %(q)s OR si.`custom_po_` LIKE %(q)s OR si.name LIKE %(q)s)")
		params["q"] = "%" + tim + "%"
	where = " AND ".join(conds)

	total = frappe.db.sql(f"SELECT COUNT(*) FROM `tabSales Invoice` si WHERE {where}", params)[0][0]

	params["lim"] = page_size
	params["off"] = (page - 1) * page_size
	rows = frappe.db.sql(
		f"""
		SELECT si.name, si.customer_name, si.shipping_address, si.posting_date,
		       si.`custom_tỉnh` AS tinh, si.`custom_po_` AS po,
		       si.`custom_tổng_kiện` AS tong_kien, si.`custom_hộp_lẻ` AS hop_le,
		       si.`custom_thể_tích_lô` AS the_tich_lo_cm3,
		       si.`custom_ghi_chú_npp` AS ghi_chu_npp,
		       si.`custom_ghi_chú_giao_hàng` AS ghi_chu_giao
		FROM `tabSales Invoice` si
		WHERE {where}
		ORDER BY si.posting_date DESC, si.name DESC
		LIMIT %(lim)s OFFSET %(off)s
		""",
		params,
		as_dict=True,
	)

	out = []
	for r in rows:
		tong = flt(r.tong_kien)
		xep = da_xep(r.name)
		con = tong - xep
		the_tich_lo = flt(r.the_tich_lo_cm3) / 1_000_000.0
		out.append(
			{
				"name": r.name,
				"khach_hang": r.customer_name,
				"dia_chi": _format_dia_chi(r.shipping_address, r.tinh),
				"po": r.po,
				"tinh": r.tinh,
				"tong_kien": tong,
				"hop_le": flt(r.hop_le),
				"the_tich_lo": the_tich_lo,
				"da_xep": xep,
				"con_lai": con,
				"the_tich_con_lai": (the_tich_lo * con / tong) if tong > 0 else 0.0,
				"ghi_chu_npp": r.ghi_chu_npp,
				"ghi_chu_giao": r.ghi_chu_giao,
				"posting_date": str(r.posting_date) if r.posting_date else None,
			}
		)
	return {"rows": out, "total": cint(total), "page": page, "page_size": page_size}


@frappe.whitelist()
def get_drivers():
	"""Danh sách lái xe cho dropdown builder."""
	require_dieu_phoi()
	return frappe.get_all(
		"Driver",
		fields=["name", "full_name", "cell_number", "custom_user"],
		order_by="full_name asc",
	)


@frappe.whitelist()
def get_vehicles():
	"""Danh sách xe kèm thể tích khả dụng."""
	require_dieu_phoi()
	return frappe.get_all(
		"Vehicle",
		fields=["name", "make", "model", "custom_the_tich_kha_dung"],
		order_by="name asc",
	)


@frappe.whitelist()
def get_trips(trang_thai=None, tu_ngay=None, den_ngay=None):
	"""Danh sách chuyến (docstatus<2) kèm tiến độ giao + cờ có thể hoàn thành."""
	require_dieu_phoi()
	filters = {"docstatus": ["<", 2]}
	if trang_thai:
		filters["trang_thai"] = trang_thai
	if tu_ngay and den_ngay:
		filters["ngay_giao"] = ["between", [tu_ngay, den_ngay]]
	elif tu_ngay:
		filters["ngay_giao"] = [">=", tu_ngay]
	elif den_ngay:
		filters["ngay_giao"] = ["<=", den_ngay]

	trips = frappe.get_all(
		"Chuyen Xe",
		filters=filters,
		fields=[
			"name", "ngay_giao", "trang_thai", "docstatus", "lai_xe", "ten_lai_xe",
			"sdt_lai_xe", "xe", "the_tich_xe", "tong_don", "tong_kien", "tong_the_tich",
			"ti_le_tai", "ghi_chu",
		],
		order_by="ngay_giao desc, creation desc",
	)

	names = [t.name for t in trips]
	prog = {}
	if names:
		for row in frappe.db.sql(
			"""
			SELECT parent,
			       COUNT(*) AS tot,
			       SUM(trang_thai_giao = 'Đã giao') AS giao,
			       SUM(trang_thai_giao = 'Chờ giao') AS cho
			FROM `tabChuyen Xe Don Hang`
			WHERE parent IN %(n)s
			GROUP BY parent
			""",
			{"n": names},
			as_dict=True,
		):
			prog[row.parent] = row

	for t in trips:
		p = prog.get(t.name)
		tot = cint(p.tot) if p else 0
		giao = cint(p.giao) if p else 0
		cho = cint(p.cho) if p else 0
		t["ngay_giao"] = str(t.ngay_giao) if t.ngay_giao else None
		t["stops_total"] = tot
		t["stops_giao"] = giao
		# Nút Hoàn thành nổi bật khi đã submit + mọi điểm đã ở trạng thái kết thúc.
		t["can_complete"] = t.docstatus == 1 and t.trang_thai == "Đang giao" and tot > 0 and cho == 0
	return trips


def _trip_dict(doc):
	stops = []
	for r in doc.don_hang:
		si = r.sales_invoice
		# Cơ sở pro-rata cho client khi SỬA NHÁP: có tong_kien + the_tich_lo (m³) để đổi
		# số kiện không bị zero thể tích; con_lai = trần đơn có thể xếp cho dòng này.
		tong = flt(frappe.db.get_value("Sales Invoice", si, "custom_tổng_kiện")) if si else 0.0
		the_tich_lo = (flt(frappe.db.get_value("Sales Invoice", si, "custom_thể_tích_lô")) / 1_000_000.0) if si else 0.0
		con_lai_row = (tong - da_xep(si, exclude_trip=doc.name)) if si else 0.0
		stops.append(
			{
				"row_name": r.name,
				"sales_invoice": si,
				"khach_hang": r.khach_hang,
				"dia_chi": r.dia_chi,
				"so_po": r.so_po,
				"so_kien": flt(r.so_kien),
				"the_tich": flt(r.the_tich),
				"hop_le": flt(r.hop_le),
				"trang_thai_giao": r.trang_thai_giao,
				"so_chung_tu": cint(r.so_chung_tu),
				"ghi_chu": r.ghi_chu,
				"tong_kien": tong,
				"the_tich_lo": the_tich_lo,
				"con_lai": con_lai_row,
			}
		)
	return {
		"name": doc.name,
		"ngay_giao": str(doc.ngay_giao) if doc.ngay_giao else None,
		"trang_thai": doc.trang_thai,
		"docstatus": doc.docstatus,
		"lai_xe": doc.lai_xe,
		"ten_lai_xe": doc.ten_lai_xe,
		"sdt_lai_xe": doc.sdt_lai_xe,
		"xe": doc.xe,
		"the_tich_xe": flt(doc.the_tich_xe),
		"tong_don": cint(doc.tong_don),
		"tong_kien": flt(doc.tong_kien),
		"tong_the_tich": flt(doc.tong_the_tich),
		"ti_le_tai": flt(doc.ti_le_tai),
		"ghi_chu": doc.ghi_chu,
		"stops": stops,
	}


@frappe.whitelist()
def get_trip(name):
	"""Chi tiết một chuyến kèm các điểm giao."""
	require_dieu_phoi()
	return _trip_dict(frappe.get_doc("Chuyen Xe", name))


def _apply_rows(doc, rows):
	"""Chỉ nhận sales_invoice, so_kien, the_tich; server tự copy phần hiển thị (controller)."""
	doc.set("don_hang", [])
	for r in rows or []:
		doc.append(
			"don_hang",
			{
				"sales_invoice": r.get("sales_invoice"),
				"so_kien": flt(r.get("so_kien")),
				"the_tich": flt(r.get("the_tich")),
			},
		)


@frappe.whitelist()
def save_trip(payload):
	"""Tạo/sửa chuyến NHÁP. Trả về doc sau validate (client nhận luôn cảnh báo tải qua msgprint)."""
	require_dieu_phoi()
	if isinstance(payload, str):
		payload = json.loads(payload)

	name = payload.get("name")
	if name and frappe.db.exists("Chuyen Xe", name):
		doc = frappe.get_doc("Chuyen Xe", name)
		if doc.docstatus != 0:
			frappe.throw(_("Chuyến {0} đã submit — dùng Điều chỉnh, không sửa nháp.").format(name))
	else:
		doc = frappe.new_doc("Chuyen Xe")

	doc.ngay_giao = payload.get("ngay_giao")
	doc.lai_xe = payload.get("lai_xe")
	doc.xe = payload.get("xe")
	doc.ghi_chu = payload.get("ghi_chu")
	_apply_rows(doc, payload.get("don_hang"))
	# Tổ trưởng là Website User → ignore_permissions SAU guard require_dieu_phoi (đã kiểm role).
	doc.save(ignore_permissions=True)
	return _trip_dict(doc)


@frappe.whitelist()
def submit_trip(name):
	"""Submit chuyến nháp → trang_thai 'Đang giao' + reconcile về các SI."""
	require_dieu_phoi()
	doc = frappe.get_doc("Chuyen Xe", name)
	doc.flags.ignore_permissions = True
	doc.submit()
	return _trip_dict(doc)


@frappe.whitelist()
def cancel_trip(name):
	"""Hủy chuyến → nhả allocation về pool."""
	require_dieu_phoi()
	doc = frappe.get_doc("Chuyen Xe", name)
	doc.flags.ignore_permissions = True
	doc.cancel()
	return _trip_dict(doc)


@frappe.whitelist()
def complete_trip(name):
	"""Hoàn thành chuyến đã submit → phần chưa giao tự nhả về pool."""
	require_dieu_phoi()
	doc = frappe.get_doc("Chuyen Xe", name)
	doc.complete()
	return _trip_dict(doc)


@frappe.whitelist()
def adjust_trip(name, add_rows=None, remove_row_names=None):
	"""Điều chỉnh chuyến ĐÃ SUBMIT: sửa child table qua doc API + save() → kích
	on_update_after_submit → reconcile tự chạy (bắt cả đơn bị gỡ)."""
	require_dieu_phoi()
	doc = frappe.get_doc("Chuyen Xe", name)
	if doc.docstatus != 1:
		frappe.throw(_("Chỉ điều chỉnh chuyến đã submit."))
	if isinstance(add_rows, str):
		add_rows = json.loads(add_rows)
	if isinstance(remove_row_names, str):
		remove_row_names = json.loads(remove_row_names)

	remove = set(remove_row_names or [])
	if remove:
		doc.don_hang = [r for r in doc.don_hang if r.name not in remove]
	for r in add_rows or []:
		doc.append(
			"don_hang",
			{
				"sales_invoice": r.get("sales_invoice"),
				"so_kien": flt(r.get("so_kien")),
				"the_tich": flt(r.get("the_tich")),
			},
		)
	doc.save(ignore_permissions=True)
	return _trip_dict(doc)
