"""API NHẬP ĐƠN TỰ ĐỘNG cho view #/nhap-don (Điều hành — có quyền Sales Invoice write).

Cổng phía server cho luồng: PDF/ảnh → Gemini trích xuất → tra cứu Item → tạo Sales Invoice.
KHÁC bản HTML standalone ở chỗ:
  - KHÓA API Gemini KHÔNG nằm ở trình duyệt (asset /assets là public) mà đọc từ site_config
    (`gemini_api_key`) — trình duyệt chỉ gửi base64 PDF/ảnh, server gọi Gemini.
  - Tra cứu Item (barcode / mã Coopmart / mã MM) + giá + tạo hoá đơn làm SERVER-SIDE, guard
    quyền thật, thay vì frappe.client.insert từ trình duyệt.

Cấu hình site_config (bench set-config ...):
  gemini_api_key           (bắt buộc)  — khoá Google Generative Language API
  gemini_model             (mặc định gemini-2.5-flash)
  nhap_don_company         (mặc định 'Công ty cổ phần Hoàng Giang')
  nhap_don_taxes_template  (mặc định 'VAT 8 - HGC')
  nhap_don_income_account  (mặc định '511 - Doanh thu bán hàng - HGC')
  nhap_don_cost_center     (mặc định 'Main - HGC')
"""

import json
import time

import frappe
from frappe import _
from frappe.utils import flt, nowdate

# Một số barcode in trên phiếu bị lệch — ánh xạ về barcode đúng trong hệ thống.
BARCODE_MAPPING = {
	"8936110981189": "8936110891189",
}

SYSTEM_PROMPT = """Trích xuất dữ liệu đơn hàng từ PDF và trả về JSON.

QUAN TRỌNG - COOPMART ĐA TRANG:
Nếu là đơn hàng Coopmart, CHỈ trích xuất dữ liệu từ TRANG HIỆN TẠI. Mỗi trang là một đơn hàng riêng biệt.

NHẬN DIỆN KHÁCH HÀNG:
- BigC: Có "Supplier Code: 3003172" hoặc "Ordered By CTY TNHH DV EB"
- Lotte Mart: Có "Ven cd 007466" hoặc "LOTTE MART" hoặc "Ord slip no"
- Coopmart: Có "Co.opMart" hoặc "POM343" hoặc "JDA Software"
- WinMart: Có "WINMART" hoặc "WINCOMMERCE"
- Emart: Có "EMART" hoặc "THISO RETAIL"
- BRG Retail: Có "FujiMart" hoặc "BRG" hoặc "phiếu đặt hàng"
- Mega Market: Có "MM Mega Market" hoặc "MEGA MARKET"
- AEON: Có "AEON Vietnam" hoặc "AEON HCM" hoặc "ĐƠN ĐẶT HÀNG PHÂN PHỐI"

---

TRÍCH XUẤT DỮ LIỆU CHO AEON:
NHẬN DIỆN: Có "AEON Vietnam" hoặc "AEON HCM" hoặc "ĐƠN ĐẶT HÀNG PHÂN PHỐI"
- customer: "AEON"
- so_po: Giá trị từ "Số đơn hàng"
- po_date: "Ngày Đặt Hàng" → YYYY-MM-DD
- delivered_to: cột "Tên cửa hàng" - phần mã viết hoa
- items: barcode (cột "Mã Vạch" 13 số), ou_qty (cột "SL Đặt")

---

TRÍCH XUẤT DỮ LIỆU CHO WINMART:
NHẬN DIỆN: Có "WINMART" hoặc "WINCOMMERCE"
- customer: "Winmart"
- so_po: từ "Số đơn hàng (PO No.)"
- po_date: "Ngày đặt hàng (PO date)" → YYYY-MM-DD
- delivered_to: dòng ĐẦU TIÊN sau "Địa chỉ giao hàng (Delivery Address)"
- items: barcode (cột "Mã vạch (Barcode)"), ou_qty (cột "Số lượng (Quantity)")

---

TRÍCH XUẤT DỮ LIỆU CHO EMART:
NHẬN DIỆN: Có "EMART" hoặc "THISO RETAIL"
- customer: "EMART"
- so_po: từ "PO No. : [số]"
- po_date: "Order By / Date" → YYYY-MM-DD
- delivered_to: chữ VIẾT HOA sau "Delivery to :" (chỉ phần mã, ví dụ "EMART PHI")
- items: barcode (cột "Unit Barcode"), ou_qty (cột "PO Qty.")

---

TRÍCH XUẤT DỮ LIỆU CHO MEGA MARKET:
NHẬN DIỆN: Có "MM Mega Market" hoặc "MEGA MARKET"
QUAN TRỌNG: Mega Market sử dụng "Mã sản phẩm người mua" (mamm) thay vì barcode!
- customer: "Mega Market"
- so_po: từ "Số thứ tự đơn đặt hàng" và BỎ "90072." ở đầu (VD: "90072.72130508" → "72130508")
- po_date: "Ngày đặt hàng" → YYYY-MM-DD
- delivered_to: dòng "Tên" trong "Địa điểm giao hàng"
- items: mamm (cột "Mã sản phẩm người mua" KHÔNG phải EAN), ou_qty (cột "Đơn đặt hàng số lượng")

---

TRÍCH XUẤT DỮ LIỆU CHO BRG RETAIL:
NHẬN DIỆN: Có "FujiMart" hoặc "BRG" hoặc "phiếu đặt hàng"
- customer: "BRG Retail"
- so_po: từ "Số Đơn:"
- po_date: "Ngày đặt:" → YYYY-MM-DD
- delivered_to: phần sau "Nơi nhận:" và BỎ HẾT SỐ ĐẰNG TRƯỚC (VD: "11011 FujiMart Lê Duẩn" → "FujiMart Lê Duẩn")
- items: barcode (cột "Mã vạch"), ou_qty (cột "Số lượng")

---

TRÍCH XUẤT DỮ LIỆU CHO COOPMART:
NHẬN DIỆN: Có "Co.opMart" hoặc "POM343" hoặc "JDA Software"
QUAN TRỌNG: MỖI TRANG LÀ MỘT ĐƠN HÀNG RIÊNG
- customer: "Coopmart"
- so_po: từ "P/O Number:" và BỎ "-00" ở cuối (VD: "96122286-00" → "96122286")
- po_date: ngày hiện tại YYYY-MM-DD
- delivered_to: dòng đầu tiên của "Ship To:"
- items: custom_macop (cột "SKU Number"), ou_qty (cột "Qty Ord/CS"), ou_qty_pcs (cột "Qty Ord/Pcs")

LOGIC SỐ LƯỢNG COOPMART:
- Nếu Qty Ord/CS là số nguyên → dùng ou_qty, UOM "Thùng"
- Nếu Qty Ord/CS không nguyên → dùng ou_qty_pcs, UOM "Hộp"

---

TRÍCH XUẤT DỮ LIỆU CHO BIGC:
QUAN TRỌNG - ĐỌC ĐÚNG CỘT:
- "Article": Barcode 13 số
- "SKU/OU": KHÔNG PHẢI số lượng đặt
- "OU Qty": ĐÂY MỚI LÀ số lượng thùng đặt hàng

- customer: "BigC"
- so_po: từ "Order No"
- po_date: "Order Date" → YYYY-MM-DD
- delivered_to: dòng đầu trong "Delivered To"
- items: barcode (cột "Article"), ou_qty (cột "OU Qty")

---

TRÍCH XUẤT DỮ LIỆU CHO LOTTE MART:
NHẬN DIỆN: Có "Ven cd 007466" hoặc "LOTTE MART" hoặc "Ord slip no"
- customer: "Lotte Mart"
- so_po: từ "Ord slip no"
- po_date: từ "Ord dt" → YYYY-MM-DD
- delivered_to: cột "Nm" PHÍA BÊN PHẢI (RECE)
- items: barcode (cột "Sale cd"), ou_qty (cột "Ord qty")

LƯU Ý: KHÔNG lấy cột "Uom" làm ou_qty!

---

OUTPUT:
- CHỈ trả về JSON thuần, KHÔNG có markdown, backticks
- so_po tối đa 50 ký tự
- Bắt buộc có mảng items với ít nhất 1 sản phẩm"""


def _require_si_write():
	if not frappe.has_permission("Sales Invoice", "write"):
		frappe.throw(_("Bạn không có quyền tạo hoá đơn."), frappe.PermissionError)


def _cfg(key, default):
	return frappe.conf.get(key) or default


def _fix_barcode(bc):
	return BARCODE_MAPPING.get(bc, bc)


# ── Gemini ───────────────────────────────────────────────────────────────────
@frappe.whitelist()
def extract_order(data_b64, mime_type="application/pdf"):
	"""Gọi Gemini trích xuất 1 đơn (1 file PDF hoặc 1 ảnh trang Coopmart). Trả về dict đã parse.
	Khoá API đọc từ site_config, KHÔNG lộ ra trình duyệt."""
	_require_si_write()
	api_key = frappe.conf.get("gemini_api_key")
	if not api_key:
		frappe.throw(_("Chưa cấu hình khoá Gemini (gemini_api_key trong site_config)."))
	if not data_b64:
		frappe.throw(_("Thiếu dữ liệu file."))
	mime_type = mime_type if mime_type in ("application/pdf", "image/png") else "application/pdf"

	model = _cfg("gemini_model", "gemini-2.5-flash")
	url = (
		"https://generativelanguage.googleapis.com/v1beta/models/"
		f"{model}:generateContent?key={api_key}"
	)
	payload = {
		"contents": [
			{
				"parts": [
					{"text": SYSTEM_PROMPT},
					{"inline_data": {"mime_type": mime_type, "data": data_b64}},
				]
			}
		]
	}

	import requests

	last_err = None
	for attempt in range(3):
		try:
			resp = requests.post(url, json=payload, timeout=60)
			if resp.status_code != 200:
				last_err = f"Gemini API {resp.status_code}: {resp.text[:300]}"
				raise ValueError(last_err)
			result = resp.json()
			text = result["candidates"][0]["content"]["parts"][0]["text"]
			cleaned = text.replace("```json", "").replace("```", "").strip()
			data = json.loads(cleaned)
			if not data.get("items"):
				raise ValueError(_("Không tìm thấy sản phẩm trong đơn hàng"))
			return data
		except Exception as e:  # noqa: BLE001
			last_err = str(e)
			if attempt < 2:
				time.sleep(1 * (attempt + 1))
			else:
				frappe.log_error(frappe.get_traceback(), "nhap_don.extract_order")
	frappe.throw(_("Trích xuất thất bại: {0}").format(last_err or ""))


# ── Tra cứu Item ─────────────────────────────────────────────────────────────
def _lookup_by_barcode(bc):
	bc = _fix_barcode(bc)
	try:
		rows = frappe.get_all(
			"Item", filters=[["Item Barcode", "barcode", "=", bc]], fields=["name"],
			order_by="creation desc", limit_page_length=1,
		)
		return rows[0].name if rows else None
	except Exception:  # noqa: BLE001
		return None


def _lookup_by_field(fieldname, value):
	if not frappe.db.has_column("Item", fieldname):
		return None
	rows = frappe.get_all(
		"Item", filters={fieldname: value}, fields=["name"],
		order_by="creation desc", limit_page_length=1,
	)
	return rows[0].name if rows else None


def _resolve_item_code(item_id, lookup_type):
	if not item_id:
		return None
	if lookup_type == "coopmart":
		return _lookup_by_field("custom_macop", item_id)
	if lookup_type == "megamarket":
		return _lookup_by_field("mamm", item_id)
	return _lookup_by_barcode(item_id)


def _item_price(item_code, uom):
	rows = frappe.get_all(
		"Item Price",
		filters={"item_code": item_code, "uom": uom, "selling": 1},
		fields=["price_list_rate"], limit_page_length=1,
	)
	return flt(rows[0].price_list_rate) if rows else 0.0


# ── Tạo hoá đơn ──────────────────────────────────────────────────────────────
@frappe.whitelist()
def create_sales_invoice(header, items):
	"""Tra cứu Item + giá rồi tạo Sales Invoice nháp (docstatus=0). Trả {name, missing, created}."""
	_require_si_write()
	if isinstance(header, str):
		header = json.loads(header or "{}")
	if isinstance(items, str):
		items = json.loads(items or "[]")

	customer = (header.get("customer") or "").strip()
	so_po = (header.get("so_po") or "").strip()[:50]
	po_date = header.get("po_date") or None
	delivered_to = (header.get("delivered_to") or "").strip()
	if not customer or not so_po:
		frappe.throw(_("Thiếu Khách hàng hoặc Số PO."))

	missing = []
	si_items = []
	income_account = _cfg("nhap_don_income_account", "511 - Doanh thu bán hàng - HGC")
	cost_center = _cfg("nhap_don_cost_center", "Main - HGC")
	for it in items or []:
		item_id = (it.get("itemId") or "").strip()
		qty = flt(it.get("qty"))
		uom = (it.get("uom") or "").strip() or "Thùng"
		lookup_type = it.get("lookupType") or "barcode"
		if not item_id or qty <= 0:
			continue
		item_code = _resolve_item_code(item_id, lookup_type)
		if not item_code:
			missing.append(item_id)
			continue
		si_items.append(
			{
				"item_code": item_code,
				"qty": qty,
				"uom": uom,
				"rate": _item_price(item_code, uom),
				"income_account": income_account,
				"cost_center": cost_center,
			}
		)

	if not si_items:
		frappe.throw(_("Không có sản phẩm hợp lệ nào (không tra cứu được mã)."))

	doc = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": customer,
			"company": _cfg("nhap_don_company", "Công ty cổ phần Hoàng Giang"),
			"posting_date": nowdate(),
			"custom_po_": so_po,
			"po_date": po_date,
			"taxes_and_charges": _cfg("nhap_don_taxes_template", "VAT 8 - HGC"),
			"items": si_items,
		}
	)
	if delivered_to:
		doc.shipping_address_name = delivered_to
	doc.insert()
	frappe.db.commit()
	return {"name": doc.name, "missing": missing, "created": len(si_items)}
