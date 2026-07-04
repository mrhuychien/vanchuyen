"""Controller www page /vc. Bơm VC_CONTEXT (role, driver, assetVersion, csrf) cho SPA.
Chưa login → redirect /login?redirect-to=/vc. Không role nào → trang 'không có quyền'."""

import frappe

SHELL_BUILD = "2026-07-04-p1"


def get_context(context):
	context.no_cache = 1

	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/vc"
		raise frappe.Redirect

	roles = set(frappe.get_roles(frappe.session.user))
	is_dieu_phoi = "Điều Phối Vận Chuyển" in roles
	is_lai_xe = "Lái Xe" in roles
	# Điều hành = admin logistics đã có quyền Sales Invoice (view Phase 2).
	is_dieu_hanh = bool(frappe.has_permission("Sales Invoice", "write"))
	driver_name = frappe.db.get_value("Driver", {"custom_user": frappe.session.user}, "name")

	try:
		csrf = frappe.sessions.get_csrf_token()
	except Exception:
		csrf = ""

	context.vc_context = {
		"user": frappe.session.user,
		"full_name": frappe.utils.get_fullname(frappe.session.user),
		"is_dieu_phoi": is_dieu_phoi,
		"is_lai_xe": is_lai_xe,
		"is_dieu_hanh": is_dieu_hanh,
		"driver_name": driver_name,
		"assetVersion": frappe.utils.now().replace(" ", "T").replace(":", "-"),
		"csrfToken": csrf,
		"shellBuild": SHELL_BUILD,
	}
	context.has_role = is_dieu_phoi or is_lai_xe or is_dieu_hanh
	return context
