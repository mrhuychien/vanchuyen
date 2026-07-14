"""Whitelisted API cho view #/dieu-phoi (admin logistics đã có quyền Sales Invoice).
Thay data layer của trang legacy: filter + paginate + batch items SERVER-SIDE, thay
frappe.client.get_list 1000 đơn + N+1 frappe.client.get. Guard = has_permission thật."""

import json
import re

import frappe
from frappe import _
from frappe.utils import cint, flt

# Chỉ 2 field được phép cập nhật hàng loạt.
ALLOWED_BULK = {"custom_hình_thức_vận_chuyển", "custom_trạng_thái_vận_chuyển"}


def _require_si_read():
	if not frappe.has_permission("Sales Invoice", "read"):
		frappe.throw(_("Bạn không có quyền xem hoá đơn."), frappe.PermissionError)


def _require_si_write():
	if not frappe.has_permission("Sales Invoice", "write"):
		frappe.throw(_("Bạn không có quyền sửa hoá đơn."), frappe.PermissionError)


@frappe.whitelist()
def get_invoices_dieu_phoi(filters=None, page=1, page_size=100):
	"""SI cho bảng điều hành: filter server-side, loại customer_group='Showroom', is_return=0,
	docstatus=1, sort posting_date desc. Trả kèm stats theo hình thức trên TOÀN tập filtered."""
	_require_si_read()
	if isinstance(filters, str):
		filters = json.loads(filters or "{}")
	f = filters or {}
	page = cint(page) or 1
	page_size = min(cint(page_size) or 100, 500)

	conds = ["si.docstatus = 1", "si.is_return = 0", "COALESCE(si.customer_group, '') != 'Showroom'"]
	p = {}
	if f.get("tu_ngay"):
		conds.append("si.posting_date >= %(tu)s")
		p["tu"] = f["tu_ngay"]
	if f.get("den_ngay"):
		conds.append("si.posting_date <= %(den)s")
		p["den"] = f["den_ngay"]
	if f.get("date"):
		conds.append("si.posting_date = %(d)s")
		p["d"] = f["date"]
	if f.get("hinh_thuc"):
		conds.append("COALESCE(NULLIF(si.`custom_hình_thức_vận_chuyển`, ''), 'Chưa phân công') = %(ht)s")
		p["ht"] = f["hinh_thuc"]
	if f.get("trang_thai"):
		conds.append("si.`custom_trạng_thái_vận_chuyển` = %(tt)s")
		p["tt"] = f["trang_thai"]
	if f.get("po"):
		conds.append("si.`custom_po_` LIKE %(po)s")
		p["po"] = "%" + f["po"] + "%"
	if f.get("customer"):
		conds.append("(si.customer LIKE %(c)s OR si.customer_name LIKE %(c)s)")
		p["c"] = "%" + f["customer"] + "%"
	if f.get("customer_group"):
		conds.append("si.customer_group = %(cg)s")
		p["cg"] = f["customer_group"]
	if f.get("address_name"):
		conds.append("si.shipping_address_name LIKE %(an)s")
		p["an"] = "%" + f["address_name"] + "%"
	where = " AND ".join(conds)

	total = frappe.db.sql(f"SELECT COUNT(*) FROM `tabSales Invoice` si WHERE {where}", p)[0][0]

	stats = {}
	for row in frappe.db.sql(
		f"""SELECT COALESCE(NULLIF(si.`custom_hình_thức_vận_chuyển`, ''), 'Chưa phân công') AS ht,
		           COUNT(*) AS c
		    FROM `tabSales Invoice` si WHERE {where} GROUP BY ht""",
		p,
		as_dict=True,
	):
		stats[row.ht] = cint(row.c)

	p2 = dict(p)
	p2["lim"] = page_size
	p2["off"] = (page - 1) * page_size
	rows = frappe.db.sql(
		f"""
		SELECT si.name, si.customer, si.customer_name, si.shipping_address, si.shipping_address_name,
		       si.posting_date, si.customer_group,
		       si.`custom_tỉnh` AS tinh, si.`custom_tổng_kiện` AS tong_kien,
		       si.`custom_thể_tích_lô` AS the_tich_lo,
		       si.`custom_hình_thức_vận_chuyển` AS hinh_thuc, si.`custom_xe` AS xe,
		       si.`custom_tên_lái_xe` AS ten_lai_xe,
		       si.`custom_trạng_thái_vận_chuyển` AS trang_thai_vc, si.`custom_po_` AS po,
		       COALESCE(si.`custom_co_su_co`, 0) AS custom_co_su_co,
		       si.`custom_su_co_tom_tat` AS su_co_tom_tat
		FROM `tabSales Invoice` si
		WHERE {where}
		ORDER BY si.posting_date DESC, si.creation DESC
		LIMIT %(lim)s OFFSET %(off)s
		""",
		p2,
		as_dict=True,
	)
	for r in rows:
		r["posting_date"] = str(r["posting_date"]) if r.get("posting_date") else None
		r["tong_kien"] = flt(r.get("tong_kien"))
		r["the_tich_lo"] = flt(r.get("the_tich_lo"))

	return {"rows": rows, "total": cint(total), "page": page, "page_size": page_size, "stats": stats}


@frappe.whitelist()
def bulk_update_van_chuyen(names, fieldname, value):
	"""Gán hình thức / trạng thái vận chuyển hàng loạt. Chỉ 2 field whitelist, check
	quyền write TỪNG doc."""
	_require_si_write()
	if fieldname not in ALLOWED_BULK:
		frappe.throw(_("Trường '{0}' không được phép cập nhật hàng loạt.").format(fieldname))
	if isinstance(names, str):
		names = json.loads(names)
	updated = 0
	for name in names or []:
		if not frappe.has_permission("Sales Invoice", "write", doc=name):
			continue
		frappe.db.set_value("Sales Invoice", name, fieldname, value, update_modified=False)
		updated += 1
	frappe.db.commit()
	return {"updated": updated, "total": len(names or [])}


@frappe.whitelist()
def get_items_for_export(names):
	"""Items (item_code/name/qty/uom) + custom_quycach batch-lookup — phục vụ Excel
	đơn tổng/đơn chia. Thay N+1 frappe.client.get của trang cũ."""
	_require_si_read()
	if isinstance(names, str):
		names = json.loads(names)
	if not names:
		return []

	items = frappe.db.sql(
		"""
		SELECT parent, item_code, item_name, qty, uom
		FROM `tabSales Invoice Item`
		WHERE parent IN %(n)s
		ORDER BY parent, idx
		""",
		{"n": names},
		as_dict=True,
	)

	codes = list({i.item_code for i in items if i.item_code})
	qc = {}
	if codes:
		# custom_quycach trên Item là fieldname ASCII (gotcha diacritics) — có thể là
		# "12", "12 hộp/thùng"... → trích số nguyên đầu tiên.
		for r in frappe.db.sql(
			"SELECT name, custom_quycach FROM `tabItem` WHERE name IN %(c)s", {"c": codes}, as_dict=True
		):
			m = re.search(r"\d+", str(r.custom_quycach or ""))
			qc[r.name] = int(m.group()) if m else 0

	by = {}
	for i in items:
		by.setdefault(i.parent, []).append(
			{
				"item_code": i.item_code,
				"item_name": i.item_name,
				"qty": flt(i.qty),
				"uom": i.uom,
				"quycach": qc.get(i.item_code, 0),
			}
		)
	return [{"name": n, "items": by.get(n, [])} for n in names]
