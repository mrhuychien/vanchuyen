"""Sự cố vận chuyển cho đơn giao qua đơn vị VC (Viettel Post, Nhất Tín...).

Backlog NGƯỢC về Sales Invoice: gắn cờ custom_co_su_co (còn sự cố đang mở) +
custom_su_co_tom_tat (loại · trạng thái mới nhất) lên chính đơn lỗi để nổi bật
trong màn Điều hành. KHÔNG đụng 2 trường custom_hình_thức/_trạng_thái_vận_chuyển."""

import frappe
from frappe.model.document import Document
from frappe.utils import nowdate

DONG = ("Đã xử lý", "Đóng")


class SuCoVanChuyen(Document):
	def before_validate(self):
		# Lấy thông tin đơn (đọc từng field — fieldname có dấu, tránh get_value dạng list).
		si = self.sales_invoice
		if si:
			self.customer = frappe.db.get_value("Sales Invoice", si, "customer_name")
			self.hinh_thuc = frappe.db.get_value("Sales Invoice", si, "custom_hình_thức_vận_chuyển")
			self.po = frappe.db.get_value("Sales Invoice", si, "custom_po_")
			self.tinh = frappe.db.get_value("Sales Invoice", si, "custom_tỉnh")

	def validate(self):
		if self.trang_thai in DONG and not self.ngay_dong:
			self.ngay_dong = nowdate()
		elif self.trang_thai not in DONG:
			self.ngay_dong = None

	def on_update(self):
		_stamp_si(self.sales_invoice)

	def after_insert(self):
		_stamp_si(self.sales_invoice)

	def on_trash(self):
		# Bỏ chính bản ghi đang xoá khi tính lại cờ trên SI.
		_stamp_si(self.sales_invoice, exclude=self.name)


def _stamp_si(si, exclude=None):
	if not si:
		return
	open_filters = {"sales_invoice": si, "trang_thai": ["not in", DONG]}
	if exclude:
		open_filters["name"] = ["!=", exclude]
	con_su_co = 1 if frappe.db.exists("Su Co Van Chuyen", open_filters) else 0

	latest_filters = {"sales_invoice": si}
	if exclude:
		latest_filters["name"] = ["!=", exclude]
	latest = frappe.db.get_value(
		"Su Co Van Chuyen", latest_filters, ["loai_su_co", "trang_thai"],
		order_by="modified desc", as_dict=True,
	)
	tom_tat = f"{latest.loai_su_co} · {latest.trang_thai}" if latest else ""
	frappe.db.set_value(
		"Sales Invoice", si,
		{"custom_co_su_co": con_su_co, "custom_su_co_tom_tat": tom_tat},
		update_modified=False,
	)
