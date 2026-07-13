"""Bảng giá cước chuyến theo địa điểm (điều phối tự sửa trên Desk).
`dia_diem` khớp giá trị trường Tỉnh (custom_tỉnh) trên Sales Invoice để tra cước gốc."""

from frappe.model.document import Document


class CuocChuyen(Document):
	pass
