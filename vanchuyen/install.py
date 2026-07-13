"""after_install: cấp DocPerm cho role Điều Phối (KHÔNG ship DocPerm qua fixtures —
Custom DocPerm đặt tên bằng hash, đổi giữa site). Mọi seed bọc try/except + log_error
để lỗi seed không làm chết `bench install-app`."""

import frappe
from frappe.permissions import add_permission, update_permission_property

DIEU_PHOI = "Điều Phối Vận Chuyển"
LAI_XE = "Lái Xe"

# read/write/create/submit/cancel/amend/print trên Chuyen Xe cho Điều Phối.
CHUYEN_XE_PERMS = ("read", "write", "create", "submit", "cancel", "amend", "print")


# Bảng giá cước mặc định theo ảnh (địa điểm → đơn giá). Điều phối sửa/thêm trên Desk sau.
# 'dia_diem' khớp giá trị trường Tỉnh (custom_tỉnh) trên đơn để tra cước gốc.
DEFAULT_RATES = {
	300000: ["Thái Bình", "Nam Định", "Bắc Ninh", "Bắc Giang", "Đông Anh", "Hải Phòng", "Hà Nội"],
	400000: ["Ninh Bình", "Bỉm Sơn", "Sơn Tây", "Hòa Bình", "Thái Nguyên", "Vĩnh Phúc", "Uông Bí", "Hạ Long"],
	500000: ["Thanh Hóa", "Phú Thọ", "Cẩm Phả", "Lạng Sơn"],
	600000: ["Diễn Châu", "Thái Hòa", "Yên Bái", "Tuyên Quang"],
	700000: ["Vinh", "Lào Cai"],
	800000: ["Hà Tĩnh"],
}


def seed_cuoc_chuyen():
	"""Seed bảng giá cước mặc định (chỉ thêm địa điểm CHƯA có → không đè giá điều phối đã sửa)."""
	if not frappe.db.table_exists("Cuoc Chuyen"):
		return
	for gia, dia_diems in DEFAULT_RATES.items():
		for dd in dia_diems:
			if not frappe.db.exists("Cuoc Chuyen", dd):
				try:
					frappe.get_doc(
						{"doctype": "Cuoc Chuyen", "dia_diem": dd, "gia": gia, "active": 1}
					).insert(ignore_permissions=True)
				except Exception:
					frappe.log_error(frappe.get_traceback(), f"vanchuyen seed Cuoc Chuyen {dd}")


def after_install():
	_ensure_roles()
	_grant_dieu_phoi()
	seed_cuoc_chuyen()
	frappe.db.commit()


def _ensure_roles():
	# after_install có thể chạy TRƯỚC sync_fixtures → tự tạo Role thay vì giả định
	# fixtures đã vào DB. Fixture import sau sẽ ghi đè (delete_doc for_reload).
	# desk_access=0 cho CẢ HAI role → tổ trưởng & lái xe KHÔNG vào được /app (desk),
	# chỉ dùng portal /vc. (Admin/System Manager vẫn có desk qua role riêng.)
	for role, desk in ((DIEU_PHOI, 0), (LAI_XE, 0)):
		try:
			if not frappe.db.exists("Role", role):
				frappe.get_doc(
					{"doctype": "Role", "role_name": role, "desk_access": desk, "is_custom": 1}
				).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"vanchuyen after_install: tạo Role {role}")


def _grant_dieu_phoi():
	try:
		# add_permission tạo Custom DocPerm (read=1) + setup_custom_perms (không mất quyền core).
		add_permission("Chuyen Xe", DIEU_PHOI, 0)
		for prop in CHUYEN_XE_PERMS:
			update_permission_property("Chuyen Xe", DIEU_PHOI, 0, prop, 1)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "vanchuyen after_install: cấp quyền Điều Phối trên Chuyen Xe")
