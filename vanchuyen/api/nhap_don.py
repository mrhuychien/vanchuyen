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
import re
import time
import unicodedata

import frappe
from frappe import _
from frappe.utils import cstr, flt, nowdate

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
- Bắt buộc có mảng items với ít nhất 1 sản phẩm

RÀNG BUỘC ĐỊNH DẠNG — BẮT BUỘC, KHÔNG ĐƯỢC TỰ ĐỔI:
- `customer` phải là ĐÚNG MỘT trong các chuỗi sau, không thêm dấu chấm/khoảng
  trắng, không viết theo cách in trên phiếu:
  "Coopmart" | "BigC" | "Lotte Mart" | "Winmart" | "EMART" | "BRG Retail" |
  "Mega Market" | "AEON"
  (phiếu in "Co.opMart" thì vẫn trả "Coopmart")
- Tên key trong mỗi phần tử `items` phải ĐÚNG như quy định ở trên:
  `barcode` / `custom_macop` / `mamm` / `ou_qty` / `ou_qty_pcs`.
  KHÔNG đổi thành "sku", "sku_number", "ma_vach" hay tên nào khác.
- Mọi mã sản phẩm (`barcode`, `custom_macop`, `mamm`) phải là CHUỖI trong dấu
  nháy kép và GIỮ NGUYÊN số 0 ở đầu. Ví dụ: "0123456", KHÔNG phải 123456."""


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


# Field trên Item giữ mã riêng của chuỗi. App NÀY KHÔNG SỞ HỮU các field đó
# (app khác tạo — KHÔNG ship qua fixtures, xem hooks.py), nên dò theo danh
# sách ứng viên thay vì đoán cứng một tên.
#
# ⚠ ĐỪNG LẪN với key JSON trong SYSTEM_PROMPT: `custom_macop` ở trên là tên
# key app yêu cầu Gemini trả về; còn dưới đây là TÊN CỘT trên bảng Item. Hai
# thứ khác nhau, trùng tên là trùng ngẫu nhiên.
#
# TÊN ĐÃ XÁC NHẬN TỪ SITE (không còn là phỏng đoán — đừng "dọn" đi):
#   Coopmart     -> `custom_mã_coopmart`
#   Mega Market  -> `custom_mã_mm`
# Các ứng viên còn lại giữ làm đường lùi cho site khác, xem _item_field.
#
# ⚠ CỐ Ý KHÔNG CÓ Winmart (và BigC / Lotte Mart / EMART / BRG Retail / AEON):
# những chuỗi đó tra bằng BARCODE và đang chạy được. Site có cột
# `custom_mã_win`, nhưng thêm nó vào đây là đổi một đường đang chạy sang
# đường chưa ai kiểm — quyết định của chủ hệ thống là KHÔNG đụng. Thiếu ở đây
# không phải bỏ sót.
#
# FIELDNAME CÓ DẤU TIẾNG VIỆT.
# Ba hệ quả, mỗi cái đã làm chết luồng này một lần:
#   1. Không được so tên bằng `==` với chuỗi gõ trong mã: cùng chữ "ã" có hai
#      cách mã hoá Unicode (NFC U+00E3, hoặc "a" + U+0303 NFD). Field tạo từ
#      máy Mac ra NFD, mã nguồn này NFC — `has_column` trả False dù cột có
#      thật. Vì vậy so theo KHOÁ BỎ DẤU và dùng TÊN CỘT LẤY TỪ DB.
#   2. Không dùng `frappe.get_all` với fieldname phi-ASCII — tầng query
#      builder không đáng tin với tên có dấu. Cả app này đã dùng SQL thô +
#      backtick cho field có dấu (chuyen_xe.py, dieu_phoi.py, chi_cuoc.py).
#   3. Chữ "đ" KHÔNG tự rã dấu khi normalize NFD, phải đổi tay sang "d".
MA_CHUOI_FIELDS = {
	"coopmart": (
		"custom_mã_coopmart", "custom_ma_coopmart", "custom_mã_coop",
		"custom_macop", "custom_ma_coop", "macop",
	),
	"megamarket": ("custom_mã_mm", "custom_ma_mm", "mamm", "custom_mamm"),
}


def _ascii_key(s):
	"""Khoá so tên cột: bỏ dấu, hạ chữ, bỏ gạch dưới.

	Nhờ vậy `custom_mã_coopmart` (NFC), cùng chuỗi đó ở dạng NFD, và
	`custom_ma_coopmart` đều cho một khoá.
	"""
	t = unicodedata.normalize("NFD", cstr(s))
	t = "".join(c for c in t if not unicodedata.combining(c))
	return t.replace("đ", "d").replace("Đ", "d").lower().replace("_", "")


def _item_columns():
	try:
		return list(frappe.db.get_table_columns("Item") or [])
	except Exception:  # noqa: BLE001
		return []


def _item_field(lookup_type):
	"""Tên cột THẬT trên bảng Item giữ mã của chuỗi này, hoặc None.

	Trả về tên lấy từ chính DB (không phải chuỗi gõ trong mã) để mọi khác biệt
	NFC/NFD biến mất trước khi tên đó đi vào câu SQL.
	"""
	cands = MA_CHUOI_FIELDS.get(lookup_type, ())
	by_key = {}
	for c in _item_columns():
		by_key.setdefault(_ascii_key(c), c)
	if by_key:
		for f in cands:
			hit = by_key.get(_ascii_key(f))
			if hit:
				return hit
		return None
	# Không đọc được danh sách cột -> lùi về has_column, so tên đúng y.
	for f in cands:
		if frappe.db.has_column("Item", f):
			return f
	return None


def _ma_candidates(value):
	"""Các biến thể của một mã chuỗi, để so khớp không chết vì số 0 đầu.

	Gemini trả JSON; nếu mã ra dạng SỐ thì "0123456" đã mất số 0 ngay lúc parse
	— mắt người đọc vẫn thấy "mã đúng". Thử cả hai chiều: bỏ 0 đầu, và đệm 0
	lại cho tới độ dài thường gặp của mã Coopmart/MM.
	"""
	v = cstr(value).strip()
	out = [v]
	bare = v.lstrip("0")
	if bare and bare != v:
		out.append(bare)
	if v.isdigit():
		for width in (6, 7, 8, 9, 10, 13):
			if len(bare or v) < width:
				out.append((bare or v).zfill(width))
	seen, uniq = set(), []
	for x in out:
		if x and x not in seen:
			seen.add(x)
			uniq.append(x)
	return uniq


def _lookup_by_field(fieldname, value):
	"""Tra Item theo cột mã của chuỗi. `fieldname` LUÔN đến từ `_item_field`,
	tức là tên cột thật đọc từ DB — không phải dữ liệu người dùng gửi lên.

	SQL thô + backtick vì fieldname có dấu tiếng Việt (xem ghi chú ở
	MA_CHUOI_FIELDS). Việc này cũng bỏ luôn tầng lọc quyền của `get_all`: nếu
	role gọi API không có quyền read Item thì `get_all` trả [] IM LẶNG và lại
	ra "không tra được mã". Người gọi đã bị chặn bằng `_require_si_write()` —
	ai tạo được hoá đơn thì đọc được Item.
	"""
	cands = _ma_candidates(value)
	col = cstr(fieldname).replace("`", "")
	rows = frappe.db.sql(
		f"SELECT name, `{col}` AS ma FROM `tabItem` WHERE `{col}` IN %(v)s ORDER BY creation DESC",
		{"v": tuple(cands)}, as_dict=True,
	)
	if not rows:
		return None
	# Ưu tiên bản khớp ĐÚNG Y mã trên phiếu; chỉ dùng biến thể khi không có.
	exact = cstr(value).strip()
	for r in rows:
		if cstr(r.ma).strip() == exact:
			return r.name
	return rows[0].name


def _resolve_item_code(item_id, lookup_type):
	if not item_id:
		return None
	if lookup_type in MA_CHUOI_FIELDS:
		f = _item_field(lookup_type)
		if not f:
			# Cấu hình sai, KHÔNG phải mã sai. Phải kêu to: trước đây hàm này
			# trả None im lặng nên mọi đơn của chuỗi đó báo "không tra được mã"
			# và không ai lần ra được là do thiếu field.
			frappe.throw(
				_("Item chưa có field giữ mã {0} (đã thử: {1}). Đây là lỗi cấu hình, không phải mã sai.").format(
					lookup_type, ", ".join(MA_CHUOI_FIELDS[lookup_type])
				)
			)
		return _lookup_by_field(f, item_id)
	return _lookup_by_barcode(item_id)


def _item_price(item_code, uom):
	rows = frappe.get_all(
		"Item Price",
		filters={"item_code": item_code, "uom": uom, "selling": 1},
		fields=["price_list_rate"], limit_page_length=1,
	)
	return flt(rows[0].price_list_rate) if rows else 0.0


# ── Địa chỉ giao hàng ────────────────────────────────────────────────────────
#
# `shipping_address_name` là Link → Address, và nó là CÁI NEO của toàn bộ khối
# thông tin người mua trên hóa đơn: sáu ô MST / tên đơn vị / địa chỉ / tên
# người mua / hình thức thanh toán / email đều `fetch_from` ô này
# (docs/legacy/Fields.csv — cột Fetch From, cả sáu đều `shipping_address_name.*`).
#
# Nhồi chuỗi thô Gemini đọc từ phiếu ("EMART PHI", "FujiMart Lê Duẩn") vào đây
# sai theo HAI đường, và cả hai đã xảy ra thật:
#
#   - Chuỗi KHÔNG khớp docname Address → Frappe xóa trắng chính ô đó rồi throw
#     LinkValidationError (frappe/model/base_document.py:1146, :1153, :1159) ⇒
#     không tạo được đơn. Ồn ào, nhưng không mất gì.
#   - Ô để TRỐNG → base_document.py:1070 `if not docname: continue` ⇒ KHÔNG
#     fetch, IM LẶNG. Hóa đơn ra đời với sáu ô người mua trống, MISA không phát
#     hành được vì thiếu tên + MST người mua. Và sau khi ghi sổ thì
#     base_document.py:1155 (`not self.docstatus.is_submitted()`) không bao giờ
#     fetch lại — cả sáu ô đều không có `allow_on_submit` — nên KHÔNG CÒN đường
#     sửa tại chỗ. Đó chính là lý do phải HỦY hóa đơn rồi gửi lại.
#
# Vì vậy: tra Address THẬT, và khi không chắc thì TRẢ CẢNH BÁO cho người chọn
# tay, TUYỆT ĐỐI không đoán gần đúng. Ô này quyết định MST người mua trên một
# hóa đơn có giá trị pháp lý — khớp gần đúng ở đây là xuất sai mã số thuế.


def _ten_key(s):
	"""Khóa so tên điểm giao: bỏ dấu, hạ chữ, bỏ SẠCH ký tự phân cách.

	Bỏ cả khoảng trắng và dấu chấm, không chỉ chuẩn hoá chúng — nếu không thì
	"Co.opMart Hà Đông" ra "co opmart ha dong" còn "COOPMART HA DONG" ra
	"coopmart ha dong", HAI khoá khác nhau cho CÙNG một điểm. Đúng loại trượt
	âm thầm mà `_ascii_key` ở trên đã phải học một lần (xem MA_CHUOI_FIELDS).

	Bỏ hết phân cách thì về lý có thể gộp hai điểm thật sự khác nhau — nhưng
	`_resolve_address` chỉ nhận khi DUY NHẤT MỘT kết quả, nên gộp nhầm ra cảnh
	báo cho người chọn, không ra một lựa chọn sai im lặng.
	"""
	t = unicodedata.normalize("NFD", cstr(s))
	t = "".join(c for c in t if not unicodedata.combining(c))
	t = t.replace("đ", "d").replace("Đ", "d").lower()
	return re.sub(r"[^a-z0-9]+", "", t)


def _resolve_address(delivered_to, customer):
	"""(address, canh_bao) cho tên điểm Gemini đọc được.

	`address` là None khi KHÔNG CHẮC; `canh_bao` là câu đọc được để hiện cho
	người chọn tay. Mọi tầng khớp đều đòi DUY NHẤT MỘT kết quả — chuỗi siêu thị
	có nhiều điểm trùng tên ở các tỉnh khác nhau (ketoan central_retail.py:81
	liệt kê 59 tên điểm chỉ có tên viết hoa không dấu), đoán bừa là xuất hóa đơn
	sai mã số thuế chi nhánh.
	"""
	raw = cstr(delivered_to).strip()
	if not raw:
		return None, None
	# Tầng 1 — chính nó đã là docname Address.
	if frappe.db.exists("Address", raw):
		return raw, None

	key = _ten_key(raw)
	if not key:
		return None, _("Không đọc được tên điểm giao: {0}").format(raw)

	def _nhieu(n):
		return None, _(
			"Tên điểm “{0}” khớp {1} địa chỉ khác nhau — chọn tay địa chỉ đúng."
		).format(raw, n)

	# Tầng 2 — bảng điểm siêu thị của app kế toán. `MT Store.address` CHÍNH LÀ
	# `shipping_address_name` mà hóa đơn cần (ketoan mt_einv.py::_store_join).
	# CHỈ ĐỌC — app này không sở hữu bảng đó.
	if frappe.db.table_exists("MT Store"):
		flt = {"active": 1}
		if customer:
			flt["customer"] = customer
		rows = frappe.get_all(
			"MT Store", filters=flt,
			fields=["store_code", "store_name", "address"], limit_page_length=0,
		)
		hit = sorted({
			r.address for r in rows
			if r.address and (_ten_key(r.store_code) == key or _ten_key(r.store_name) == key)
		})
		if len(hit) == 1:
			return hit[0], None
		if len(hit) > 1:
			return _nhieu(len(hit))

	# Tầng 3 & 4 — tra theo `Address.address_title`, nhưng CHỈ TRONG các Address
	# của CHÍNH KHÁCH NÀY (Dynamic Link).
	#
	# ⚠ TUYỆT ĐỐI không tra `address_title` trên cả bảng Address. Hai khách khác
	# nhau hoàn toàn có thể có địa chỉ cùng tên ("FujiMart Lê Duẩn" của BRG và
	# một địa chỉ cùng tên của khách khác), và tra toàn bảng thì trúng DUY NHẤT
	# MỘT — nên không có cảnh báo nào — mà lại là địa chỉ của khách khác. Ô này
	# quyết định MST và tên người mua trên hóa đơn có giá trị pháp lý, nên trúng
	# sai ở đây là xuất hóa đơn cho sai người mua. Phép kiểm mục 5 canh đúng
	# chuyện này; bản đầu của hàm đã sa vào nó.
	#
	# Không biết khách thì DỪNG — thà hỏi người còn hơn đoán.
	if not customer:
		return None, _(
			"Chưa biết khách hàng nên không tra được Địa chỉ giao hàng cho “{0}” — chọn tay."
		).format(raw)

	links = frappe.get_all(
		"Dynamic Link",
		filters={"link_doctype": "Customer", "link_name": customer, "parenttype": "Address"},
		fields=["parent"], limit_page_length=0,
	)
	names = sorted({l.parent for l in links if l.parent})
	if names:
		cand = frappe.get_all(
			"Address", filters={"name": ["in", names]},
			fields=["name", "address_title"], limit_page_length=0)
		# Tầng 3 — trùng đúng y chữ.
		exact = sorted({a.name for a in cand if cstr(a.address_title).strip() == raw})
		if len(exact) == 1:
			return exact[0], None
		if len(exact) > 1:
			return _nhieu(len(exact))
		# Tầng 4 — trùng sau khi bỏ dấu.
		mo = sorted({a.name for a in cand if _ten_key(a.address_title) == key})
		if len(mo) == 1:
			return mo[0], None
		if len(mo) > 1:
			return _nhieu(len(mo))

	return None, _(
		"Không tìm ra Địa chỉ giao hàng cho điểm “{0}”. PHẢI chọn tay trên bản nháp "
		"TRƯỚC khi ghi sổ — ô này quyết định MST và tên người mua trên hóa đơn; "
		"để trống thì không đẩy được MISA, mà ghi sổ rồi thì phải hủy hóa đơn mới sửa được."
	).format(raw)


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

	# Chốt chống trùng theo (khách hàng, số PO). KHÔNG có nó thì bấm Tạo đơn hai
	# lần — hoặc chạy loạt rồi chạy lại sau một lỗi giữa loạt — ra HAI Sales
	# Invoice cho cùng một phiếu. Dữ liệu thật trên site đã có: PO
	# 260915-01006-1-0052 của Lotte Mart ra HD-06895 + HD-06896, tên liền số.
	#
	# Đây KHÔNG phải chuyện gọn sổ. Mỗi bản tự đẩy ra MỘT số hóa đơn thật, nên
	# hai bản là hai hóa đơn điện tử có giá trị pháp lý cho một lần bán ⇒ khai
	# gấp đôi doanh thu và thuế đầu ra, và một tờ nằm ngoài sổ.
	trung = frappe.get_all(
		"Sales Invoice",
		filters={"customer": customer, "custom_po_": so_po, "docstatus": ["<", 2]},
		fields=["name", "docstatus"], order_by="creation asc", limit_page_length=5,
	)
	if trung:
		frappe.throw(_(
			"Đã có hóa đơn cho khách {0}, số PO {1}: {2}.\n\n"
			"KHÔNG tạo thêm — hai hóa đơn cho một phiếu là hai số hóa đơn thật. "
			"Muốn làm lại thì hủy bản cũ trước; nếu đây thật là đơn khác thì sửa số PO."
		).format(customer, so_po, ", ".join(r.name for r in trung)))

	missing = []
	khong_co_ma = 0     # dòng Gemini KHÔNG đọc được mã (itemId rỗng)
	kieu_tra = set()    # các kiểu tra đã dùng — in ra khi thất bại
	si_items = []
	income_account = _cfg("nhap_don_income_account", "511 - Doanh thu bán hàng - HGC")
	cost_center = _cfg("nhap_don_cost_center", "Main - HGC")
	for it in items or []:
		item_id = (it.get("itemId") or "").strip()
		qty = flt(it.get("qty"))
		uom = (it.get("uom") or "").strip() or "Thùng"
		lookup_type = it.get("lookupType") or "barcode"
		kieu_tra.add(lookup_type)
		if not item_id:
			khong_co_ma += 1
			continue
		if qty <= 0:
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
		# TRƯỚC ĐÂY câu này không nói gì cả: field thiếu, mã không khớp, và
		# Gemini đọc trượt mã đều ra cùng một dòng chữ. Nói thẳng ra từng thứ,
		# kèm ĐÚNG các mã bị trượt và KIỂU TRA đã dùng — kiểu tra là chỗ lộ ra
		# khi tên khách hàng Gemini trả về lệch khỏi "Coopmart" và app âm thầm
		# rơi về tra theo barcode.
		ct = []
		if missing:
			ct.append(_("{0} mã không tìm thấy trong Item: {1}").format(
				len(missing), ", ".join(missing[:15]) + ("…" if len(missing) > 15 else "")))
		if khong_co_ma:
			ct.append(_("{0} dòng không đọc được mã từ phiếu").format(khong_co_ma))
		ct.append(_("kiểu tra: {0}").format(", ".join(sorted(kieu_tra)) or "—"))
		ct.append(_("khách hàng: {0}").format(customer))
		msg = _("Không tạo được đơn — không có sản phẩm hợp lệ.") + "\n• " + "\n• ".join(ct)
		# Ghi Error Log để còn dấu vết sau khi người dùng tắt thông báo.
		frappe.log_error(msg, "nhap_don: khong tra duoc ma")
		frappe.throw(msg)

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
	# Chỉ gán khi tra ra Address THẬT. Tra không ra thì để TRỐNG và trả cảnh báo
	# — hóa đơn vẫn là bản NHÁP nên người dùng còn chọn tay được, đó là đúng lúc
	# và đúng chỗ để sửa. Gán chuỗi thô vào ô Link là hoặc chết insert, hoặc ra
	# một hóa đơn trống thông tin người mua mà ghi sổ rồi thì phải hủy mới sửa.
	addr, canh_bao_dc = _resolve_address(delivered_to, customer)
	if addr:
		doc.shipping_address_name = addr
	doc.insert()

	# Kiểm NGAY trên bản nháp: thiếu khối người mua thì nói ra bây giờ, đừng để
	# vỡ lúc bấm xuất hóa đơn (lúc đó hóa đơn đã ghi sổ, không fetch lại được).
	thieu = [
		nhan for nhan, f in (
			(_("MST"), "custom_mã_số_thuế"),
			(_("tên đơn vị"), "custom_tên_đơn_vị"),
			(_("tên người mua"), "custom_tên_người_mua"),
		) if doc.meta.has_field(f) and not cstr(doc.get(f)).strip()
	]
	frappe.db.commit()
	return {
		"name": doc.name, "missing": missing, "created": len(si_items),
		"khong_co_ma": khong_co_ma, "kieu_tra": sorted(kieu_tra),
		"dia_chi": addr or "",
		"canh_bao_dia_chi": canh_bao_dc or "",
		"thieu_nguoi_mua": thieu,
	}
