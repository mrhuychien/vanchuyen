"""Guards dùng chung cho mọi whitelisted method. Gọi Ở DÒNG ĐẦU mỗi method.

Nguyên tắc: Lái Xe = zero DocType permission; mọi truy cập qua method có guard.
Chỉ Điều Phối tạo/submit/hoàn thành/hủy chuyến — guard cứng server, không chỉ ẩn nút."""

import frappe
from frappe import _

DIEU_PHOI_ROLE = "Điều Phối Vận Chuyển"
LAI_XE_ROLE = "Lái Xe"


def is_admin(user=None):
	"""Administrator hoặc System Manager = quản trị viên (được làm mọi thao tác quản lý)."""
	user = user or frappe.session.user
	return user == "Administrator" or "System Manager" in frappe.get_roles(user)


def require_admin():
	"""Chỉ quản trị viên (Administrator / System Manager)."""
	if not is_admin():
		frappe.throw(_("Chỉ quản trị viên được phép thao tác này."), frappe.PermissionError)


def require_dieu_phoi():
	"""Throw PermissionError nếu session user thiếu role Điều Phối (quản trị viên luôn được phép)."""
	if DIEU_PHOI_ROLE not in frappe.get_roles(frappe.session.user) and not is_admin():
		frappe.throw(_("Chỉ Điều Phối Vận Chuyển được phép thao tác này."), frappe.PermissionError)


def require_driver():
	"""Trả về Driver.name có custom_user == session user; throw nếu không map được."""
	driver = frappe.db.get_value("Driver", {"custom_user": frappe.session.user}, "name")
	if not driver:
		frappe.throw(
			_("Tài khoản của bạn chưa được gán cho lái xe nào. Liên hệ điều phối."),
			frappe.PermissionError,
		)
	return driver


def require_own_trip(trip_name):
	"""Driver của session phải là lái xe của chuyến. Trả về Driver.name."""
	driver = require_driver()
	lai_xe = frappe.db.get_value("Chuyen Xe", trip_name, "lai_xe")
	if not lai_xe or lai_xe != driver:
		frappe.throw(_("Chuyến này không thuộc về bạn."), frappe.PermissionError)
	return driver
