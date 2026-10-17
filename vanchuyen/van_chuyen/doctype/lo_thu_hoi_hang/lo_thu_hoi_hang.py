from frappe.model.document import Document


class LoThuHoiHang(Document):
	"""Child row: một mã hàng siêu thị KHAI trả trên phiếu xuất trả.

	Đây là số KHAI, không phải số đếm — số đếm thật nằm ở phiếu kiểm hàng bên
	ketoan (`Kiem Hang Thu Hoi Dong`). Quy đổi ĐVT do controller cha làm."""

	pass
