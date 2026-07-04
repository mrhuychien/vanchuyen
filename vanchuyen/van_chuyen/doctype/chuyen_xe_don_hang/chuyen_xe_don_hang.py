import frappe
from frappe.model.document import Document


class ChuyenXeDonHang(Document):
	"""Child row: một phần của đơn hàng được xếp lên một chuyến xe.

	Không chứa logic riêng — mọi ràng buộc/aggregate nằm ở controller cha
	`Chuyen Xe` (nguồn sự thật duy nhất)."""

	pass
