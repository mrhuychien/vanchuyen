"""after_install: cấp DocPerm cho role Điều Phối (KHÔNG ship DocPerm qua fixtures —
Custom DocPerm đặt tên bằng hash, đổi giữa site). Mọi seed bọc try/except + log_error
để lỗi seed không làm chết `bench install-app`."""

import frappe
from frappe.permissions import add_permission, update_permission_property

DIEU_PHOI = "Điều Phối Vận Chuyển"
LAI_XE = "Lái Xe"

# read/write/create/submit/cancel/amend/print trên Chuyen Xe cho Điều Phối.
CHUYEN_XE_PERMS = ("read", "write", "create", "submit", "cancel", "amend", "print")


def after_install():
	_ensure_roles()
	_grant_dieu_phoi()
	frappe.db.commit()


def _ensure_roles():
	# after_install có thể chạy TRƯỚC sync_fixtures → tự tạo Role thay vì giả định
	# fixtures đã vào DB. Fixture import sau sẽ ghi đè (delete_doc for_reload).
	for role, desk in ((DIEU_PHOI, 1), (LAI_XE, 0)):
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
