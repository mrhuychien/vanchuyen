"""API cho TỔ TRƯỞNG (role Điều Phối Vận Chuyển): tạo tài khoản lái xe + QR đăng nhập.
Mọi method guard require_dieu_phoi() ở dòng đầu.

Tài khoản lái xe = Website User (KHÔNG vào desk). Đăng nhập bằng QR (token) không cần mật khẩu:
QR mã hoá URL /vc?k=<token>; www/vc.py đọc token → login_as → vào thẳng portal.
Tạo User/Driver dùng ignore_permissions=True SAU guard (tổ trưởng không phải System Manager)."""

import re

import frappe
from frappe import _
from frappe.utils import cint, get_url

from vanchuyen.api.guards import require_admin, require_dieu_phoi

LAI_XE_ROLE = "Lái Xe"
TO_TRUONG_ROLE = "Điều Phối Vận Chuyển"  # tổ trưởng = role Điều Phối (được xếp chuyến)


def _set_user_role(email, role, on):
	"""Thêm / gỡ 1 role cho User (Website User vẫn không vào desk vì role desk_access=0).

	Sau khi gán, reload để chắc role THỰC SỰ dính — một số cấu hình Frappe hạn chế role
	của Website User; nếu bị bỏ thì báo lỗi rõ thay vì tạo tài khoản không đăng nhập được."""
	if not email or not frappe.db.exists("User", email):
		return
	user = frappe.get_doc("User", email)
	has = role in [r.role for r in user.get("roles", [])]
	if on and not has:
		user.append("roles", {"role": role})
		user.save(ignore_permissions=True)
		user.reload()
		if role not in [r.role for r in user.get("roles", [])]:
			frappe.throw(
				_(
					"Không gán được quyền '{0}' cho tài khoản {1}. Tài khoản Website User đang bị "
					"hạn chế role — vào Desk mở User Type 'Website User' và thêm role này vào danh sách."
				).format(role, email)
			)
	elif not on and has:
		user.set("roles", [r for r in user.get("roles", []) if r.role != role])
		user.save(ignore_permissions=True)


def _gen_token():
	return frappe.generate_hash(length=40)


def _login_url(token):
	# QR quét → mở /vc?k=token → www/vc.py login_as → vào portal luôn.
	return get_url("/vc") + "?k=" + token


def _digits(s):
	return re.sub(r"\D", "", s or "")


def _make_email(full_name, cell_number):
	d = _digits(cell_number)
	base = "lx" + d if d else "lx" + (re.sub(r"[^a-z0-9]", "", (full_name or "driver").lower())[:12] or "driver")
	email = base + "@vanchuyen.local"
	i = 1
	while frappe.db.exists("User", email):
		email = f"{base}.{i}@vanchuyen.local"
		i += 1
	return email


def _ensure_user(full_name, cell_number, existing_email=None):
	"""Tạo (hoặc dùng lại) Website User + role Lái Xe. Trả về email (User.name)."""
	email = existing_email or _make_email(full_name, cell_number)
	if not frappe.db.exists("User", email):
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": full_name or email,
				"mobile_no": cell_number,
				"user_type": "Website User",  # KHÔNG vào desk
				"send_welcome_email": 0,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)
	else:
		user = frappe.get_doc("User", email)
		user.enabled = 1
	if LAI_XE_ROLE not in [r.role for r in user.get("roles", [])]:
		user.append("roles", {"role": LAI_XE_ROLE})
	user.save(ignore_permissions=True)
	return email


def _driver_payload(driver_name):
	d = frappe.db.get_value(
		"Driver",
		driver_name,
		["name", "full_name", "cell_number", "custom_user", "custom_login_token"],
		as_dict=True,
	)
	enabled = frappe.db.get_value("User", d.custom_user, "enabled") if d.custom_user else 0
	is_tt = TO_TRUONG_ROLE in frappe.get_roles(d.custom_user) if d.custom_user else False
	return {
		"driver": d.name,
		"full_name": d.full_name,
		"cell_number": d.cell_number,
		"user": d.custom_user or "",
		"enabled": bool(enabled),
		"has_account": bool(d.custom_user),
		"is_to_truong": bool(is_tt),
		"login_url": _login_url(d.custom_login_token) if d.custom_login_token else "",
	}


@frappe.whitelist()
def list_driver_accounts():
	"""Danh sách lái xe + trạng thái tài khoản + link QR (nếu có)."""
	require_dieu_phoi()
	names = [d.name for d in frappe.get_all("Driver", fields=["name"], order_by="full_name asc")]
	return [_driver_payload(n) for n in names]


@frappe.whitelist()
def create_account_for_driver(driver):
	"""Cấp tài khoản + QR cho một Driver ĐÃ có sẵn."""
	require_dieu_phoi()
	d = frappe.db.get_value("Driver", driver, ["name", "full_name", "cell_number", "custom_user"], as_dict=True)
	if not d:
		frappe.throw(_("Không tìm thấy lái xe."))
	email = _ensure_user(d.full_name, d.cell_number, existing_email=d.custom_user or None)
	frappe.db.set_value("Driver", driver, {"custom_user": email, "custom_login_token": _gen_token()})
	frappe.db.commit()
	return _driver_payload(driver)


@frappe.whitelist()
def create_driver_account(full_name, cell_number):
	"""Tạo Driver MỚI + tài khoản Website User + token QR."""
	require_dieu_phoi()
	full_name = (full_name or "").strip()
	cell_number = (cell_number or "").strip()
	if not full_name or not cell_number:
		frappe.throw(_("Nhập họ tên và số điện thoại lái xe."))
	email = _ensure_user(full_name, cell_number)
	driver = frappe.get_doc(
		{
			"doctype": "Driver",
			"full_name": full_name,
			"cell_number": cell_number,
			"custom_user": email,
			"custom_login_token": _gen_token(),
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return _driver_payload(driver.name)


@frappe.whitelist()
def regenerate_driver_token(driver):
	"""Cấp lại token (QR cũ hết hiệu lực) — dùng khi lộ QR/đổi máy."""
	require_dieu_phoi()
	if not frappe.db.exists("Driver", driver):
		frappe.throw(_("Không tìm thấy lái xe."))
	frappe.db.set_value("Driver", driver, "custom_login_token", _gen_token())
	frappe.db.commit()
	return _driver_payload(driver)


@frappe.whitelist()
def set_driver_enabled(driver, enabled):
	"""Khoá / mở tài khoản lái xe."""
	require_dieu_phoi()
	user = frappe.db.get_value("Driver", driver, "custom_user")
	if not user:
		frappe.throw(_("Lái xe chưa có tài khoản."))
	frappe.db.set_value("User", user, "enabled", 1 if cint(enabled) else 0)
	frappe.db.commit()
	return _driver_payload(driver)


# ── ADMIN: quản lý tổ trưởng ──────────────────────────────────────────────────
@frappe.whitelist()
def set_driver_as_to_truong(driver, on):
	"""ADMIN: đặt / bỏ 1 lái xe làm tổ trưởng (thêm/gỡ role Điều Phối trên tài khoản)."""
	require_admin()
	d = frappe.db.get_value("Driver", driver, ["full_name", "cell_number", "custom_user"], as_dict=True)
	if not d:
		frappe.throw(_("Không tìm thấy lái xe."))
	email = d.custom_user
	if not email:
		# Chưa có tài khoản → cấp luôn (Website User + role Lái Xe) rồi mới gắn tổ trưởng.
		email = _ensure_user(d.full_name, d.cell_number)
		frappe.db.set_value("Driver", driver, {"custom_user": email, "custom_login_token": _gen_token()})
	_set_user_role(email, TO_TRUONG_ROLE, cint(on))
	frappe.db.commit()
	return _driver_payload(driver)


@frappe.whitelist()
def create_to_truong_account(full_name, cell_number):
	"""ADMIN: tạo tài khoản TỔ TRƯỞNG mới (Driver + Website User + role Lái Xe & Điều Phối + QR)."""
	require_admin()
	full_name = (full_name or "").strip()
	cell_number = (cell_number or "").strip()
	if not full_name or not cell_number:
		frappe.throw(_("Nhập họ tên và số điện thoại."))
	email = _ensure_user(full_name, cell_number)
	_set_user_role(email, TO_TRUONG_ROLE, 1)
	driver = frappe.get_doc(
		{
			"doctype": "Driver",
			"full_name": full_name,
			"cell_number": cell_number,
			"custom_user": email,
			"custom_login_token": _gen_token(),
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()
	return _driver_payload(driver.name)
