"""Sự cố vận chuyển cho đơn giao qua đơn vị VC (Viettel Post, Nhất Tín...).

Backlog NGƯỢC về Sales Invoice: gắn cờ custom_co_su_co (còn sự cố đang mở) +
custom_su_co_tom_tat (loại · trạng thái mới nhất) lên chính đơn lỗi để nổi bật
trong màn Điều hành. KHÔNG đụng 2 trường custom_hình_thức/_trạng_thái_vận_chuyển."""

import frappe
from frappe.model.document import Document
from frappe.utils import flt, nowdate

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
		self._roll_hang_ve()
		if self.trang_thai in DONG and not self.ngay_dong:
			self.ngay_dong = nowdate()
		elif self.trang_thai not in DONG:
			self.ngay_dong = None

	def _roll_hang_ve(self):
		"""Tiền mất trên đường = (SL siêu thị trả − SL thực về) × đơn giá.

		SUY TỪ LƯỢNG LỆCH, không cho gõ tay. Số đi đòi nhà xe mà gõ tay được thì
		nó là ý kiến; suy từ lượng đo được thì nó là bằng chứng.

		Chỉ tính phần DƯƠNG. SL về nhiều hơn SL trả không phải "nhà xe nợ mình số
		âm" — đó là gõ nhầm số, và để nó trừ ngược vào tổng là giấu một lỗi nhập
		liệu bằng một lỗi nhập liệu khác.
		"""
		tong = 0.0
		for r in (self.items or []):
			thieu = max(flt(r.sl_tra) - flt(r.sl_ve), 0.0)
			r.tien_mat_duong = round(thieu * flt(r.don_gia), 2)
			tong += r.tien_mat_duong
		self.tong_mat_duong = round(tong, 2)
		# Gợi ý số đòi = số đo được, nhưng CHO SỬA: nhà xe đền một phần theo thỏa
		# thuận thì con số thỏa thuận mới là số phải theo dõi.
		if not flt(self.boi_thuong_so_tien) and tong:
			self.boi_thuong_so_tien = self.tong_mat_duong

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
