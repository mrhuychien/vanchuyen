"""Whitelisted API cho Lái Xe (mobile). Mọi method guard require_driver()/require_own_trip().
Lái Xe có ZERO DocType permission → thao tác doc dùng ignore_permissions=True SAU guard,
và chỉ trên chuyến đúng của tài xế. KHÔNG trả bất kỳ số tiền nào."""

import frappe
from frappe import _
from frappe.utils import cint, nowdate
from frappe.utils.file_manager import save_file

from vanchuyen.api.guards import require_driver, require_own_trip

VALID_STOP_STATUS = ("Chờ giao", "Đã giao", "Khách hẹn", "Hoàn")


@frappe.whitelist()
def get_my_trips():
	"""Chuyến của tôi: 'Đang giao' + 'Hoàn thành' hôm nay. Stops tối giản, không có tiền."""
	driver = require_driver()
	today = nowdate()
	trips = frappe.db.sql(
		"""
		SELECT name, ngay_giao, trang_thai, xe, ten_lai_xe, sdt_lai_xe
		FROM `tabChuyen Xe`
		WHERE docstatus = 1 AND lai_xe = %(d)s
		  AND (trang_thai = 'Đang giao' OR (trang_thai = 'Hoàn thành' AND ngay_giao = %(t)s))
		ORDER BY FIELD(trang_thai, 'Đang giao', 'Hoàn thành'), ngay_giao DESC, creation DESC
		""",
		{"d": driver, "t": today},
		as_dict=True,
	)

	names = [t.name for t in trips]
	stops_by = {}
	if names:
		for r in frappe.db.sql(
			"""
			SELECT parent, name AS row_name, sales_invoice, khach_hang, dia_chi, so_po,
			       so_kien, the_tich, hop_le, trang_thai_giao, so_chung_tu, ghi_chu
			FROM `tabChuyen Xe Don Hang`
			WHERE parent IN %(n)s
			ORDER BY idx ASC
			""",
			{"n": names},
			as_dict=True,
		):
			stops_by.setdefault(r.parent, []).append(
				{
					"row_name": r.row_name,
					"sales_invoice": r.sales_invoice,
					"khach_hang": r.khach_hang,
					"dia_chi": r.dia_chi,
					"so_po": r.so_po,
					"so_kien": r.so_kien,
					"the_tich": r.the_tich,
					"hop_le": r.hop_le,
					"trang_thai_giao": r.trang_thai_giao,
					"so_chung_tu": cint(r.so_chung_tu),
					"ghi_chu": r.ghi_chu,
				}
			)

	for t in trips:
		stops = stops_by.get(t.name, [])
		t["ngay_giao"] = str(t.ngay_giao) if t.ngay_giao else None
		t["stops"] = stops
		t["stops_total"] = len(stops)
		t["stops_giao"] = sum(1 for s in stops if s["trang_thai_giao"] == "Đã giao")
	return trips


@frappe.whitelist()
def update_stop_status(trip, row_name, trang_thai, ghi_chu=None):
	"""Cập nhật trạng thái một điểm giao. require_own_trip; chỉ 4 giá trị hợp lệ."""
	require_own_trip(trip)
	if trang_thai not in VALID_STOP_STATUS:
		frappe.throw(_("Trạng thái giao không hợp lệ."))

	doc = frappe.get_doc("Chuyen Xe", trip)
	row = next((r for r in doc.don_hang if r.name == row_name), None)
	if not row:
		frappe.throw(_("Không tìm thấy điểm giao trong chuyến."))

	row.trang_thai_giao = trang_thai
	if ghi_chu is not None:
		row.ghi_chu = ghi_chu
	# save() kích on_update_after_submit → reconcile stamp về SI. Guard đã kiểm quyền.
	doc.save(ignore_permissions=True)
	return {"row_name": row_name, "trang_thai_giao": trang_thai, "ghi_chu": row.ghi_chu}


@frappe.whitelist()
def upload_chung_tu(trip, row_name):
	"""Nhận file ảnh chứng từ, gắn PRIVATE vào đúng Sales Invoice của điểm giao,
	tăng đếm so_chung_tu. require_own_trip."""
	require_own_trip(trip)
	sales_invoice = frappe.db.get_value("Chuyen Xe Don Hang", {"name": row_name, "parent": trip}, "sales_invoice")
	if not sales_invoice:
		frappe.throw(_("Không tìm thấy điểm giao trong chuyến."))

	files = frappe.request.files if frappe.request else None
	upload = files.get("file") if files else None
	if not upload:
		frappe.throw(_("Thiếu file ảnh chứng từ."))

	saved = save_file(upload.filename, upload.stream.read(), "Sales Invoice", sales_invoice, is_private=1)

	new_count = cint(frappe.db.get_value("Chuyen Xe Don Hang", row_name, "so_chung_tu")) + 1
	# so_chung_tu là allow_on_submit read_only → set thẳng DB, không cần full save.
	frappe.db.set_value("Chuyen Xe Don Hang", row_name, "so_chung_tu", new_count)
	return {"file_url": saved.file_url, "so_chung_tu": new_count}
