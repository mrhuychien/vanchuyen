"""API SỰ CỐ VẬN CHUYỂN (view #/su-co — điều hành). Chỉ đơn giao qua ĐƠN VỊ VC.

Guard = quyền Sales Invoice write (như các view điều hành). Tạo/sửa Su Co dùng
ignore_permissions SAU guard (DocType chỉ cấp perm System Manager)."""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from vanchuyen.api.guards import is_admin

# Hình thức KHÔNG phải đơn vị VC (tự ship / bốc tại kho / chưa gán) → loại khỏi pool sự cố.
SELF_FORMS = ("Tự vận chuyển", "Xe vào bốc", "Chưa phân công")

# Trạng thái coi là ĐÃ ĐÓNG. Lấy từ controller để hai nơi không lệch nhau.
from vanchuyen.van_chuyen.doctype.su_co_van_chuyen.su_co_van_chuyen import DONG as DONG_TRANG_THAI

# ⚠ THÊM FIELD MỚI PHẢI THÊM VÀO ĐÂY. Field không có trong tuple này thì
# `create_issue`/`update_issue` BỎ QUA IM LẶNG — không lỗi, không cảnh báo, chỉ
# là dữ liệu người dùng gõ xong bấm lưu rồi biến mất.
_UPDATABLE = (
	"loai_su_co", "trang_thai", "ngay_phat_sinh", "so_kien_anh_huong", "gia_tri_anh_huong",
	"mo_ta", "huong_xu_ly", "nguoi_phu_trach", "ghi_chu_xu_ly",
	# hàng quay về
	"hang_ve_trang_thai", "ngay_du_kien_ve", "ngay_hang_ve", "stock_entry",
	# bồi thường nhà xe — CHỈ THỐNG KÊ, đòi riêng, không sinh bút toán
	"boi_thuong_trang_thai", "boi_thuong_so_tien", "boi_thuong_ghi_chu",
)

# Field đọc ra cho portal. Tách hằng để `_issue_dict` và `list_issues` không lệch
# nhau — lệch một field là màn danh sách thiếu cột mà màn chi tiết vẫn có.
_READ_FIELDS = (
	"name", "sales_invoice", "customer", "hinh_thuc", "po", "tinh", "ngay_phat_sinh",
	"loai_su_co", "trang_thai", "so_kien_anh_huong", "gia_tri_anh_huong", "mo_ta",
	"dinh_kem", "huong_xu_ly", "nguoi_phu_trach", "ngay_dong", "ghi_chu_xu_ly",
	"hang_ve_trang_thai", "ngay_du_kien_ve", "ngay_hang_ve", "stock_entry",
	"tong_mat_duong", "boi_thuong_trang_thai", "boi_thuong_so_tien", "boi_thuong_ghi_chu",
)

_DATE_FIELDS = ("ngay_phat_sinh", "ngay_dong", "ngay_du_kien_ve", "ngay_hang_ve")


def _require():
	if not (frappe.has_permission("Sales Invoice", "write") or is_admin()):
		frappe.throw(_("Bạn không có quyền theo dõi sự cố vận chuyển."), frappe.PermissionError)


def _issue_dict(name):
	d = frappe.db.get_value("Su Co Van Chuyen", name, list(_READ_FIELDS), as_dict=True)
	if d:
		for f in _DATE_FIELDS:
			d[f] = str(d[f]) if d.get(f) else None
		d["items"] = frappe.get_all(
			"Su Co Hang Ve", filters={"parent": name, "parenttype": "Su Co Van Chuyen"},
			fields=["name", "item_code", "item_name", "uom", "sl_tra", "sl_ve",
				"sl_nhap_lai", "sl_hong", "don_gia", "tien_mat_duong", "idx"],
			order_by="idx",
		)
	return d


@frappe.whitelist()
def list_issues(trang_thai=None, loai_su_co=None, hinh_thuc=None, tim=None, page=1, page_size=30,
		dang_mo=None):
	"""Danh sách sự cố, lọc theo trạng thái/loại/đơn vị VC + tìm theo đơn/khách/PO.

	`dang_mo=1` lọc NGAY TRÊN SERVER các phiếu chưa đóng.

	VÌ SAO phải lọc ở server: bản cũ trả 30 dòng mới nhất rồi để portal tự lọc
	"đang mở" trên đúng 30 dòng đó. Từ khi phiếu có thêm vòng đời hàng-về (Chưa
	về -> Đang về -> Đã về sân -> Đã lọc xong), một phiếu sống vài tuần chứ không
	vài ngày, nên số phiếu đang mở vượt 30 là chắc chắn. Khi đó ĐÚNG những phiếu
	CŨ NHẤT còn mở — nhóm đáng lo nhất, hàng đi lâu chưa về — rơi khỏi trang 1 và
	không ai mở tới được, trong khi pill vẫn hiện tổng đúng. Lọc client trên một
	trang là cách chắc chắn nhất để giấu mất việc.
	"""
	_require()
	page = cint(page) or 1
	page_size = min(cint(page_size) or 30, 100)
	filters = {}
	if cint(dang_mo):
		filters["trang_thai"] = ["not in", DONG_TRANG_THAI]
	elif trang_thai:
		filters["trang_thai"] = trang_thai
	if loai_su_co:
		filters["loai_su_co"] = loai_su_co
	if hinh_thuc:
		filters["hinh_thuc"] = hinh_thuc
	or_filters = None
	if tim:
		or_filters = [
			["sales_invoice", "like", f"%{tim}%"],
			["customer", "like", f"%{tim}%"],
			["po", "like", f"%{tim}%"],
		]
	rows = frappe.get_all(
		"Su Co Van Chuyen", filters=filters, or_filters=or_filters,
		fields=list(_READ_FIELDS),
		order_by="ngay_phat_sinh desc, modified desc",
		start=(page - 1) * page_size, page_length=page_size,
	)
	# Ưu tiên trạng thái Mới → Đang xử lý → Đã xử lý → Đóng (sort ổn định, giữ ngày desc).
	_rank = {"Mới": 0, "Đang xử lý": 1, "Đã xử lý": 2, "Đóng": 3}
	rows.sort(key=lambda r: _rank.get(r.get("trang_thai"), 9))
	for r in rows:
		for f in _DATE_FIELDS:
			r[f] = str(r[f]) if r.get(f) else None
	total = frappe.db.count("Su Co Van Chuyen", filters or None)
	has_more = (page - 1) * page_size + len(rows) < cint(total)
	# Đếm theo trạng thái (cho pill filter).
	counts = {c.trang_thai: cint(c.n) for c in frappe.db.sql(
		"SELECT trang_thai, COUNT(*) AS n FROM `tabSu Co Van Chuyen` GROUP BY trang_thai", as_dict=True)}
	return {"rows": rows, "total": cint(total), "page": page, "page_size": page_size,
		"has_more": has_more, "counts": counts}


@frappe.whitelist()
def search_carrier_invoices(tim=None, page_size=20):
	"""Tìm đơn GIAO QUA ĐƠN VỊ VC để tạo sự cố (loại tự ship/bốc/chưa gán)."""
	_require()
	conds = [
		"si.docstatus = 1", "si.is_return = 0",
		"COALESCE(si.`custom_hình_thức_vận_chuyển`, '') != ''",
		"si.`custom_hình_thức_vận_chuyển` NOT IN %(self)s",
	]
	p = {"self": SELF_FORMS, "lim": min(cint(page_size) or 20, 50)}
	if tim:
		conds.append("(si.name LIKE %(q)s OR si.customer_name LIKE %(q)s OR si.`custom_po_` LIKE %(q)s)")
		p["q"] = f"%{tim}%"
	where = " AND ".join(conds)
	rows = frappe.db.sql(
		f"""SELECT si.name, si.customer_name AS customer, si.`custom_hình_thức_vận_chuyển` AS hinh_thuc,
		          si.`custom_po_` AS po, si.`custom_tỉnh` AS tinh, COALESCE(si.`custom_co_su_co`,0) AS co_su_co
		   FROM `tabSales Invoice` si WHERE {where}
		   ORDER BY si.posting_date DESC, si.name DESC LIMIT %(lim)s""",
		p, as_dict=True,
	)
	return rows


@frappe.whitelist()
def create_issue(payload):
	"""Tạo sự cố mới cho 1 đơn."""
	_require()
	if isinstance(payload, str):
		payload = json.loads(payload)
	si = payload.get("sales_invoice")
	if not si or not frappe.db.exists("Sales Invoice", si):
		frappe.throw(_("Chọn đơn hàng hợp lệ."))
	if not payload.get("loai_su_co"):
		frappe.throw(_("Chọn loại sự cố."))
	doc = frappe.new_doc("Su Co Van Chuyen")
	doc.sales_invoice = si
	for f in _UPDATABLE:
		if f in payload and payload.get(f) not in (None, ""):
			doc.set(f, payload.get(f))
	if not doc.trang_thai:
		doc.trang_thai = "Mới"
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _issue_dict(doc.name)


@frappe.whitelist()
def update_issue(name, payload):
	"""Cập nhật sự cố (trạng thái, hướng xử lý, ghi chú...)."""
	_require()
	if isinstance(payload, str):
		payload = json.loads(payload)
	if not frappe.db.exists("Su Co Van Chuyen", name):
		frappe.throw(_("Không tìm thấy sự cố."))
	doc = frappe.get_doc("Su Co Van Chuyen", name)
	for f in _UPDATABLE:
		if f in payload:
			doc.set(f, payload.get(f))
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _issue_dict(doc.name)


@frappe.whitelist()
def get_issue(name):
	_require()
	return _issue_dict(name)


@frappe.whitelist()
def upload_dinh_kem(su_co):
	"""Đính kèm ảnh biên bản/chứng từ vào sự cố (multipart: field 'file')."""
	_require()
	if not frappe.db.exists("Su Co Van Chuyen", su_co):
		frappe.throw(_("Không tìm thấy sự cố."))
	files = frappe.request.files
	if not files or "file" not in files:
		frappe.throw(_("Thiếu file."))
	f = files["file"]
	content = f.stream.read()
	fdoc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f.filename or "su_co.jpg",
			"attached_to_doctype": "Su Co Van Chuyen",
			"attached_to_name": su_co,
			"content": content,
			"is_private": 0,
		}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Su Co Van Chuyen", su_co, "dinh_kem", fdoc.file_url, update_modified=False)
	frappe.db.commit()
	return {"file_url": fdoc.file_url}
