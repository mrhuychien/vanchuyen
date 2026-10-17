from frappe.model.document import Document


class LoThuHoiHang(Document):
	"""Child row CŨ: một mã hàng siêu thị KHAI trả trên phiếu xuất trả.

	KHÔNG CÒN DÙNG: chi tiết hàng chuyển sang kế toán (phiếu kiểm hàng bên ketoan), lô
	thu hồi chỉ giữ bản dán nguyên văn từ mail (`Lo Thu Hoi.chi_tiet_hang`). DocType giữ
	lại vì các lô tạo trước đó vẫn có dòng ở đây và ketoan đọc mềm chúng để so khai /
	kiểm. Không thêm field cha trỏ lại bảng này."""

	pass
