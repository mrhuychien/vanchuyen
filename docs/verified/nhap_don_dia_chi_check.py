#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nhap_don_dia_chi_check — ô Địa chỉ giao hàng, và chốt chống hóa đơn trùng.

════════════════════════════════════════════════════════════════════════════
HAI CON BUG BỘ KIỂM NÀY CANH
════════════════════════════════════════════════════════════════════════════

**(1) Nhồi chuỗi thô vào ô Link.** `shipping_address_name` là Link → Address,
và nó là CÁI NEO của toàn bộ khối thông tin người mua: sáu ô MST / tên đơn vị /
địa chỉ / tên người mua / hình thức thanh toán / email đều `fetch_from` ô đó
(docs/legacy/Fields.csv, cột Fetch From). Không ô nào có `allow_on_submit`.

`create_sales_invoice` từng gán thẳng chuỗi Gemini đọc từ phiếu ("EMART PHI",
"FujiMart Lê Duẩn") vào đấy. Hai đường vỡ, cả hai đã xảy ra thật:

  - Chuỗi KHÔNG khớp docname Address → frappe/model/base_document.py:1146 gán
    None cho mọi giá trị fetch, :1153 XÓA TRẮNG luôn ô Link, :1159 dồn vào
    invalid_links → LinkValidationError. Ồn ào, nhưng không mất gì.
  - Ô để TRỐNG → base_document.py:1070 `if not docname: continue` → BỎ QUA
    fetch, IM LẶNG. Hóa đơn ra đời với sáu ô người mua trống. MISA không phát
    hành được, mà lúc biết thì hóa đơn ĐÃ ghi sổ và base_document.py:1155
    (`not self.docstatus.is_submitted()`) không bao giờ fetch lại → KHÔNG CÒN
    đường sửa tại chỗ → phải HỦY hóa đơn.

Và hủy mới là chỗ mất tiền: hủy một hóa đơn CÓ THỂ đã tới MISA thì bản gốc rơi
khỏi cả hai vòng quét (ketoan misa_sync.py lọc `docstatus: 1`) và thành hóa đơn
MỒ CÔI bên MISA, trong khi bản sửa đổi mang RefID mới sinh ra hóa đơn thứ hai.
HAI hóa đơn pháp lý cho MỘT lần bán.

CẠM BẪY KHI SỬA: khớp "gần đúng" tên điểm. Ô này quyết định MST người mua trên
một hóa đơn có giá trị pháp lý, mà chuỗi siêu thị có nhiều điểm trùng tên ở các
tỉnh khác nhau (ketoan central_retail.py:81 — 59 tên điểm chỉ có tên viết hoa
không dấu). Mọi tầng khớp phải đòi DUY NHẤT MỘT kết quả, nhiều hơn thì TRẢ
CẢNH BÁO cho người chọn tay. Mục 3/4/5 canh đúng chuyện đó.

**(2) Không có chốt chống trùng.** Dữ liệu thật: PO 260915-01006-1-0052 của
Lotte Mart ra HD-06895 + HD-06896, tên liền số. Mỗi bản tự đẩy ra MỘT số hóa
đơn thật ⇒ hai hóa đơn pháp lý cho một phiếu ⇒ khai gấp đôi doanh thu.

Chạy KHÔNG cần bench (frappe giả + nạp JS bằng node):
    python3 docs/verified/nhap_don_dia_chi_check.py   # exit 0 = đạt
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
JS = os.path.join(REPO, "vanchuyen/public/vanchuyen/views/nhap-don.js")

ok_all = True

ADDR = {}      # docname -> {"address_title":..., "custom_mã_số_thuế":..., ...}
STORES = []    # [{"store_code","store_name","address","customer","active"}]
LINKS = []     # [{"parent": addr_docname, "link_name": customer}]
SI = []        # [{"name","customer","custom_po_","docstatus"}]
BARCODE = {}   # barcode -> ten Item
INSERTED = []  # các doc đã insert
HAS_MT_STORE = [True]


def check(label, cond, detail=""):
    global ok_all
    print(("  ✅ " if cond else "  ❌ ") + label + (f"  ({detail})" if detail else ""))
    if not cond:
        ok_all = False
    return cond


class _D(dict):
    def __getattr__(self, k):
        return self.get(k)

    def __setattr__(self, k, v):
        self[k] = v


class Throw(Exception):
    pass


class _Doc:
    """Sales Invoice giả: insert() mô phỏng đúng cổng fetch_from của Frappe."""

    FETCH = {
        "custom_mã_số_thuế": "custom_mã_số_thuế",
        "custom_tên_đơn_vị": "custom_tên_đơn_vị",
        "custom_tên_người_mua": "custom_tên_người_mua",
    }

    def __init__(self, d):
        self._d = dict(d)
        self.name = "HD-MOI"
        self.meta = types.SimpleNamespace(has_field=lambda f: f in self.FETCH or f in self._d)

    def __setattr__(self, k, v):
        if k in ("_d", "name", "meta"):
            object.__setattr__(self, k, v)
        else:
            self._d[k] = v

    def get(self, k, d=None):
        return self._d.get(k, d)

    def insert(self):
        # base_document.py:1070 — ô Link TRỐNG thì BỎ QUA fetch, im lặng.
        a = self._d.get("shipping_address_name")
        if not a:
            INSERTED.append(dict(self._d))
            return self
        # :1146/:1153/:1159 — tra không ra thì xóa trắng ô rồi throw.
        if a not in ADDR:
            self._d["shipping_address_name"] = None
            raise Throw(f"Could not find Address: {a}")
        for dest, src in self.FETCH.items():
            self._d[dest] = ADDR[a].get(src)
        INSERTED.append(dict(self._d))
        return self


def _stub_frappe():
    fr = types.ModuleType("frappe")
    fr.ValidationError = Throw
    fr.PermissionError = type("PermissionError_", (Exception,), {})
    fr.throw = lambda m, e=None: (_ for _ in ()).throw(Throw(str(m)))
    fr._ = lambda s, *a, **k: s
    fr.whitelist = lambda *a, **k: (lambda f: f)
    fr.msgprint = lambda *a, **k: None
    fr.log_error = lambda *a, **k: None
    fr.get_traceback = lambda *a, **k: ""
    fr._dict = _D
    fr.conf = {}
    fr.has_permission = lambda *a, **k: True
    fr.get_doc = lambda d: _Doc(d)

    def get_all(dt, filters=None, fields=None, **k):
        # Lọc dạng LIST (`[["Item Barcode","barcode","=",bc]]`) phải xử lý TRƯỚC
        # `dict(filters)` — dict() của list 4 phần tử là ValueError, mà
        # `_lookup_by_barcode` bọc try/except nên nó nuốt lỗi và trả None, làm
        # mọi mục kiểm phía sau tưởng "không tra được mã".
        if isinstance(filters, (list, tuple)):
            if dt == "Item":
                for ff in filters:
                    if len(ff) == 4 and ff[0] == "Item Barcode" and ff[1] == "barcode":
                        hit = BARCODE.get(str(ff[3]))
                        return [_D(name=hit)] if hit else []
            return []
        f = dict(filters or {})
        if dt == "MT Store":
            out = []
            for s in STORES:
                if f.get("active") is not None and int(s.get("active", 1)) != int(f["active"]):
                    continue
                if f.get("customer") and s.get("customer") != f["customer"]:
                    continue
                out.append(_D(**s))
            return out
        if dt == "Address":
            out = []
            for n, a in ADDR.items():
                if "address_title" in f and a.get("address_title") != f["address_title"]:
                    continue
                if "name" in f:
                    cond = f["name"]
                    want = cond[1] if isinstance(cond, (list, tuple)) else [cond]
                    if n not in want:
                        continue
                out.append(_D(name=n, address_title=a.get("address_title")))
            return out
        if dt == "Item Price":
            return [_D(price_list_rate=100000.0)]
        if dt == "Dynamic Link":
            return [_D(parent=l["parent"]) for l in LINKS
                    if l.get("link_name") == f.get("link_name")]
        if dt == "Sales Invoice":
            out = []
            for r in SI:
                if f.get("customer") and r["customer"] != f["customer"]:
                    continue
                if f.get("custom_po_") and r.get("custom_po_") != f["custom_po_"]:
                    continue
                ds = f.get("docstatus")
                if isinstance(ds, (list, tuple)) and ds[0] == "<" and not r["docstatus"] < ds[1]:
                    continue
                out.append(_D(**r))
            return out
        return []

    fr.get_all = get_all

    class _DB:
        def exists(self, dt, flt=None):
            if dt == "Address":
                return flt in ADDR
            return False

        def table_exists(self, dt):
            return dt == "MT Store" and HAS_MT_STORE[0]

        def has_column(self, *a, **k):
            return True

        def get_value(self, *a, **k):
            return None

        def commit(self):
            pass

        def sql(self, *a, **k):
            return []

    fr.db = _DB()
    sys.modules["frappe"] = fr

    fu = types.ModuleType("frappe.utils")
    fu.flt = lambda v, p=None: float(v or 0)
    fu.cint = lambda v: int(float(v or 0))
    fu.cstr = lambda v: "" if v is None else str(v)
    fu.nowdate = lambda: "2026-10-08"
    sys.modules["frappe.utils"] = fu
    fp = types.ModuleType("frappe.permissions")
    fp.add_permission = lambda *a, **k: None
    fp.update_permission_property = lambda *a, **k: None
    sys.modules["frappe.permissions"] = fp
    fm = types.ModuleType("frappe.model")
    fmd = types.ModuleType("frappe.model.document")
    fmd.Document = type("Document", (), {})
    fm.document = fmd
    sys.modules["frappe.model"] = fm
    sys.modules["frappe.model.document"] = fmd
    return fr


def run_js(expr):
    src = open(JS, encoding="utf-8").read()
    src = re.sub(r"^import .*?;\s*$", "", src, flags=re.M)
    src = re.sub(r"^export ", "", src, flags=re.M)
    harness = (
        "const call=async()=>({});const errText=(e)=>String(e);\n"
        "const escapeHtml=(s)=>String(s==null?'':s);\n"
        "const showToast=()=>{};const showModal=()=>null;const closeModal=()=>{};\n"
        "const document={getElementById:()=>null,"
        "createElement:()=>({style:{},addEventListener(){},appendChild(){}}),"
        "head:{appendChild(){}},body:{appendChild(){}}};\nconst window={};\n"
        + src + "\nconsole.log(JSON.stringify((" + expr + ")()));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(harness)
        tmp = f.name
    try:
        r = subprocess.run(["node", tmp], capture_output=True, text=True)
    finally:
        os.unlink(tmp)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "").strip().splitlines()[-1])
    return json.loads(r.stdout)


def _reset():
    ADDR.clear()
    del STORES[:]
    del LINKS[:]
    del SI[:]
    BARCODE.clear()
    del INSERTED[:]
    HAS_MT_STORE[0] = True


def main():
    _stub_frappe()
    sys.path.insert(0, REPO)
    import importlib

    nd = importlib.import_module("vanchuyen.api.nhap_don")

    print("=" * 78)
    print("nhap_don_dia_chi_check — ô Địa chỉ giao hàng + chốt hóa đơn trùng")
    print("=" * 78)

    # ── 1. Khóa so tên ────────────────────────────────────────────────
    print("-" * 78)
    print("── 1. Khóa so tên điểm: bỏ dấu, hạ chữ, bỏ ký tự lạ ────────────────")
    for a, b in [("Co.opMart Hà Đông", "coopmarthadong"),
                 ("CO.OPMART  HA  DONG", "coopmarthadong"),
                 ("go! PHU MY", "gophumy"),
                 ("Đoàn Thị Điểm", "doanthidiem")]:
        got = nd._ten_key(a)
        check(f"“{a}” -> “{b}”", got == b, got)
    check("hai cách viết cùng một điểm cho cùng khóa",
          nd._ten_key("Co.opMart Hà Đông") == nd._ten_key("COOPMART HA DONG"))
    check("và dấu chấm KHÔNG tách thành hai từ (bẫy đã trượt một lần)",
          nd._ten_key("Co.opMart") == nd._ten_key("Coopmart"),
          f"{nd._ten_key('Co.opMart')} vs {nd._ten_key('Coopmart')}")

    # ── 2. Tầng 1 — chính nó đã là docname Address ────────────────────
    print("-" * 78)
    print("── 2. Tầng 1: chuỗi chính là docname Address -> nhận ───────────────")
    _reset()
    ADDR["Co.opMart Ha Dong-Shipping"] = {"address_title": "Co.opMart Hà Đông",
                                          "custom_mã_số_thuế": "0301175691"}
    a, w = nd._resolve_address("Co.opMart Ha Dong-Shipping", "Coopmart")
    check("nhận đúng docname", a == "Co.opMart Ha Dong-Shipping", str(a))
    check("không cảnh báo", not w, str(w))

    # ── 3. Tầng 2 — MT Store, và phải DUY NHẤT MỘT ────────────────────
    print("-" * 78)
    print("── 3. Tầng 2: tra MT Store; trùng tên nhiều điểm -> KHÔNG đoán ─────")
    _reset()
    ADDR["COOP-HD-Shipping"] = {"address_title": "Co.op Hà Đông"}
    ADDR["COOP-VINH-Shipping"] = {"address_title": "Co.op Vinh"}
    STORES.append({"store_code": "POM343", "store_name": "Co.opMart Hà Đông",
                   "address": "COOP-HD-Shipping", "customer": "Coopmart", "active": 1})
    a, w = nd._resolve_address("Co.opMart Hà Đông", "Coopmart")
    check("khớp theo store_name -> ra address của điểm", a == "COOP-HD-Shipping", str(a))
    a, w = nd._resolve_address("POM343", "Coopmart")
    check("khớp theo store_code -> cũng ra", a == "COOP-HD-Shipping", str(a))
    a, w = nd._resolve_address("co opmart  ha dong", "Coopmart")
    check("khớp kể cả viết sai dấu/khoảng trắng", a == "COOP-HD-Shipping", str(a))

    # HAI điểm cùng tên, địa chỉ khác nhau -> KHÔNG được đoán.
    STORES.append({"store_code": "POM999", "store_name": "Co.opMart Hà Đông",
                   "address": "COOP-VINH-Shipping", "customer": "Coopmart", "active": 1})
    a, w = nd._resolve_address("Co.opMart Hà Đông", "Coopmart")
    check("2 điểm cùng tên khác địa chỉ -> KHÔNG gán, trả cảnh báo", a is None, str(a))
    check("cảnh báo nói ra số địa chỉ trùng", bool(w) and "2" in w, (w or "")[:70])

    # Điểm NGỪNG hoạt động không được tính.
    _reset()
    ADDR["COOP-HD-Shipping"] = {"address_title": "x"}
    STORES.append({"store_code": "POM343", "store_name": "Co.opMart Hà Đông",
                   "address": "COOP-HD-Shipping", "customer": "Coopmart", "active": 0})
    a, w = nd._resolve_address("Co.opMart Hà Đông", "Coopmart")
    check("điểm active=0 -> KHÔNG dùng", a is None, str(a))

    # ── 4. Tầng 3 — address_title đúng y ──────────────────────────────
    print("-" * 78)
    print("── 4. Tầng 3: Address.address_title trùng đúng y ───────────────────")
    _reset()
    HAS_MT_STORE[0] = False
    ADDR["EMART-PHI-Shipping"] = {"address_title": "EMART PHI"}
    LINKS.append({"parent": "EMART-PHI-Shipping", "link_name": "EMART"})
    a, w = nd._resolve_address("EMART PHI", "EMART")
    check("khớp address_title -> nhận", a == "EMART-PHI-Shipping", str(a))
    ADDR["EMART-PHI-2-Shipping"] = {"address_title": "EMART PHI"}
    LINKS.append({"parent": "EMART-PHI-2-Shipping", "link_name": "EMART"})
    a, w = nd._resolve_address("EMART PHI", "EMART")
    check("2 Address cùng title -> KHÔNG gán", a is None, str(a))
    # Địa chỉ KHÔNG thuộc khách này -> không được nhận, dù tên trùng đúng y.
    _reset()
    HAS_MT_STORE[0] = False
    ADDR["CUA-KHACH-KHAC"] = {"address_title": "EMART PHI"}
    LINKS.append({"parent": "CUA-KHACH-KHAC", "link_name": "Khach Khac"})
    a, w = nd._resolve_address("EMART PHI", "EMART")
    check("địa chỉ trùng tên nhưng của KHÁCH KHÁC -> KHÔNG nhận", a is None, str(a))

    # ── 5. Tầng 4 — bỏ dấu, CHỈ trong địa chỉ của chính khách này ─────
    print("-" * 78)
    print("── 5. Tầng 4: so bỏ dấu, KHÔNG vượt sang địa chỉ khách khác ────────")
    _reset()
    HAS_MT_STORE[0] = False
    ADDR["FUJI-LD-Shipping"] = {"address_title": "FujiMart Lê Duẩn"}
    ADDR["KHAC-Shipping"] = {"address_title": "FujiMart Le Duan"}
    LINKS.append({"parent": "FUJI-LD-Shipping", "link_name": "BRG Retail"})
    LINKS.append({"parent": "KHAC-Shipping", "link_name": "Khach Khac"})
    a, w = nd._resolve_address("FujiMart Le Duan", "BRG Retail")
    check("so bỏ dấu ra địa chỉ CỦA KHÁCH NÀY", a == "FUJI-LD-Shipping", str(a))
    check("và KHÔNG trúng địa chỉ cùng tên của khách khác", a != "KHAC-Shipping")
    a, w = nd._resolve_address("FujiMart Le Duan", None)
    check("không biết khách -> KHÔNG dò tầng 3/4", a is None, str(a))
    # Câu cảnh báo phải NÓI ĐÚNG lý do là chưa biết khách, không gộp vào câu
    # "không tìm ra địa chỉ" chung — hai nguyên nhân, hai việc phải làm khác nhau.
    check("và cảnh báo nói đúng lý do: chưa biết khách hàng",
          bool(w) and "khách hàng" in w, (w or "")[:80])

    # ── 6. Không tra ra -> cảnh báo PHẢI nói việc cần làm ─────────────
    print("-" * 78)
    print("── 6. Không tra ra -> cảnh báo nói ĐÚNG việc phải làm ──────────────")
    _reset()
    a, w = nd._resolve_address("Diem La Khong Co", "Coopmart")
    check("không gán gì", a is None, str(a))
    check("cảnh báo nhắc chọn tay trên bản NHÁP", bool(w) and "nháp" in (w or "").lower(), (w or "")[:80])
    check("và nói rõ ghi sổ rồi thì phải hủy hóa đơn", "hủy" in (w or "").lower(), (w or "")[:120])

    # ── 7. TUYỆT ĐỐI không nhồi chuỗi thô vào ô Link ──────────────────
    print("-" * 78)
    print("── 7. Chuỗi không tra ra -> ô Link để TRỐNG, không nhồi vào ────────")
    _reset()
    a, w = nd._resolve_address("Diem La Khong Co", "Coopmart")
    check("không trả về chính chuỗi Gemini", a != "Diem La Khong Co")
    src = open(os.path.join(REPO, "vanchuyen/api/nhap_don.py"), encoding="utf-8").read()
    check("mã KHÔNG còn gán thẳng `delivered_to` vào ô Link",
          "doc.shipping_address_name = delivered_to" not in src)
    check("và gán qua _resolve_address",
          "addr, canh_bao_dc = _resolve_address(delivered_to, customer)" in src)

    # ── 8. Chốt chống hóa đơn trùng ───────────────────────────────────
    print("-" * 78)
    print("── 8. Cùng (khách, số PO) -> KHÔNG tạo hóa đơn thứ hai ─────────────")
    _reset()
    BARCODE["123"] = "SP-A"
    SI.append({"name": "HD-06895", "customer": "Lotte Mart",
               "custom_po_": "260915-01006-1-0052", "docstatus": 1})
    try:
        nd.create_sales_invoice(
            {"customer": "Lotte Mart", "so_po": "260915-01006-1-0052"},
            [{"itemId": "123", "qty": 1, "uom": "Thùng", "lookupType": "barcode"}])
        check("trùng (khách, PO) -> throw", False, "không throw")
    except Throw as e:
        check("trùng (khách, PO) -> throw", True)
        check("nêu đích danh hóa đơn đã có", "HD-06895" in str(e), str(e)[:70])
        check("nói rõ hai hóa đơn là hai SỐ hóa đơn thật",
              "số hóa đơn thật" in str(e), str(e)[:140])

    # PO khác / khách khác thì KHÔNG chặn.
    for nhan, hdr in (("PO khác", {"customer": "Lotte Mart", "so_po": "PO-KHAC"}),
                      ("khách khác", {"customer": "BigC", "so_po": "260915-01006-1-0052"})):
        try:
            nd.create_sales_invoice(hdr, [{"itemId": "123", "qty": 1, "uom": "Thùng",
                                           "lookupType": "barcode"}])
            check(f"{nhan} -> tạo được, KHÔNG chặn", True)
        except Throw as e:
            check(f"{nhan} -> tạo được, KHÔNG chặn", False, str(e)[:70])

    # Bản ĐÃ HỦY (docstatus=2) không được tính là trùng.
    _reset()
    BARCODE["123"] = "SP-A"
    SI.append({"name": "HD-OLD", "customer": "Lotte Mart", "custom_po_": "PO-1", "docstatus": 2})
    try:
        nd.create_sales_invoice({"customer": "Lotte Mart", "so_po": "PO-1"},
                                [{"itemId": "123", "qty": 1, "uom": "Thùng",
                                  "lookupType": "barcode"}])
        check("bản đã HỦY không tính là trùng -> cho tạo lại", True)
    except Throw as e:
        check("bản đã HỦY không tính là trùng -> cho tạo lại", False, str(e)[:70])

    # ── 9. Trả về việc còn phải làm trên bản nháp ─────────────────────
    print("-" * 78)
    print("── 9. Thiếu khối người mua -> NÓI RA ngay lúc tạo nháp ─────────────")
    _reset()
    BARCODE["123"] = "SP-A"
    r = nd.create_sales_invoice(
        {"customer": "Coopmart", "so_po": "PO-X", "delivered_to": "Khong Tra Ra"},
        [{"itemId": "123", "qty": 1, "uom": "Thùng", "lookupType": "barcode"}])
    check("trả cảnh báo địa chỉ", bool(r.get("canh_bao_dia_chi")),
          (r.get("canh_bao_dia_chi") or "")[:60])
    check("liệt kê ĐÚNG các ô người mua còn thiếu",
          set(r.get("thieu_nguoi_mua") or []) == {"MST", "tên đơn vị", "tên người mua"},
          str(r.get("thieu_nguoi_mua")))
    check("ô Link để TRỐNG, không mang chuỗi thô",
          not INSERTED[-1].get("shipping_address_name"),
          repr(INSERTED[-1].get("shipping_address_name")))

    # Địa chỉ tra ra ĐƯỢC -> khối người mua đầy, không cảnh báo gì.
    _reset()
    ADDR["COOP-HD-Shipping"] = {"address_title": "Co.op Hà Đông",
                                "custom_mã_số_thuế": "0301175691",
                                "custom_tên_đơn_vị": "Co.opMart Hà Đông",
                                "custom_tên_người_mua": "Phòng mua"}
    STORES.append({"store_code": "POM343", "store_name": "Co.opMart Hà Đông",
                   "address": "COOP-HD-Shipping", "customer": "Coopmart", "active": 1})
    BARCODE["123"] = "SP-A"
    r = nd.create_sales_invoice(
        {"customer": "Coopmart", "so_po": "PO-Y", "delivered_to": "Co.opMart Hà Đông"},
        [{"itemId": "123", "qty": 1, "uom": "Thùng", "lookupType": "barcode"}])
    check("tra ra địa chỉ -> gán vào ô Link", r.get("dia_chi") == "COOP-HD-Shipping",
          str(r.get("dia_chi")))
    check("và khối người mua ĐẦY -> không còn việc phải làm",
          not r.get("thieu_nguoi_mua") and not r.get("canh_bao_dia_chi"),
          f"{r.get('thieu_nguoi_mua')} / {r.get('canh_bao_dia_chi')}")

    # ── 10. Không gộp pháp nhân khác nhau ─────────────────────────────
    # Hai dữ kiện đã xác minh: (1) MST lấy từ ĐỊA CHỈ, không từ Customer
    # (Fields.csv:79) nên gộp banner không đụng số thuế; (2) hệ thống có ĐÚNG
    # MỘT Customer dùng chung cho cả Saigon Co.op (chủ hệ thống xác nhận
    # 08/10/2026) — SOP "~8 pháp nhân" là chuyện ĐỐI SOÁT, không phải số
    # Customer record. Nên gộp mọi banner về "Coopmart" là ĐÚNG master.
    #
    # Việc CHỌN CỘT MÃ vẫn khớp theo họ chuỗi, để ô Khách hàng bị gõ tay thành
    # tên lạ mang chữ "Co.op" cũng không rơi về tra barcode.
    print("-" * 78)
    print("── 10. Banner Co.op: gộp ở tên Customer, và LUÔN tra cột mã Co.op ──")
    try:
        d = run_js("""() => {
          const ten = ['Co.opMart', 'Co.opXtra', 'Co.op Food', 'Co.opExtra', 'Saigon Co.op'];
          // Tên gõ tay lạ: KHÔNG có Customer nào như vậy, nên (A) phải giữ
          // nguyên cho Frappe báo lỗi, mà (B) vẫn phải tra cột mã Co.op.
          const dai = ['Co.opXtra Linh Trung', 'TNHH MTV Co.opMart Hà Nội',
                       'Chi nhánh Liên hiệp HTX Co.op Food'];
          const khac = ['Winmart', 'BigC', 'Lotte Mart', 'EMART', 'BRG Retail', 'AEON'];
          return {
            canon: ten.map(canonCustomer),
            lt: ten.map((c) => lookupTypeFor(canonCustomer(c))),
            ltDai: dai.map(lookupTypeFor),
            canonDai: dai.map(canonCustomer),
            ltKhac: khac.map((c) => lookupTypeFor(canonCustomer(c))),
            go: canonCustomer('GO!'), bigc: canonCustomer('Big C'),
            mm: lookupTypeFor(canonCustomer('MM Mega Market')),
          };
        }""")
        check("mọi banner Co.op về cùng tên Customer “Coopmart”",
              d["canon"] == ["Coopmart"] * 5, str(d["canon"]))
        check("và đều tra cột mã Co.opmart", d["lt"] == ["coopmart"] * 5, str(d["lt"]))
        # Đây là chốt QUAN TRỌNG NHẤT của mục này: kế toán sửa tay ô Khách hàng
        # thành TÊN PHÁP NHÂN DÀI thì vẫn phải tra cột mã Co.op, không rơi về
        # barcode. Bản trước gộp hai việc làm một nên chỗ này rơi lưới.
        check("tên gõ tay lạ mang chữ Co.op -> vẫn tra cột mã Co.op, không rơi barcode",
              d["ltDai"] == ["coopmart"] * 3, str(d["ltDai"]))
        check("tên gõ tay lạ thì GIỮ NGUYÊN ở ô Customer để Frappe báo lỗi",
              all(x != "Coopmart" for x in d["canonDai"]), str(d["canonDai"]))
        check("các chuỗi khác vẫn tra barcode (không kéo cả nhà sang coopmart)",
              d["ltKhac"] == ["barcode"] * 6, str(d["ltKhac"]))
        check("Mega Market vẫn ra megamarket", d["mm"] == "megamarket", d["mm"])
        # GO! và Big C là CÙNG pháp nhân EB — SOP_ke_toan_MT_RVHG.md:87.
        check("GO! vẫn gộp về BigC (cùng pháp nhân EB, SOP mục 2.1)",
              d["go"] == "BigC" and d["bigc"] == "BigC", f"{d['go']} / {d['bigc']}")
    except Exception as e:  # noqa: BLE001
        check("chạy được canonCustomer / lookupTypeFor", False, str(e)[:90])

    # ── 11. Giao diện phải NÓI RA việc còn phải làm ───────────────────
    #
    # Canh CHỖ DÙNG: khẳng định "có biến canhBao trong mã" vẫn đúng y nguyên kể
    # cả khi nó đã bị gỡ khỏi chuỗi HTML. Ở đây chạy thật `addResult` với DOM
    # giả rồi đọc HTML nó sinh ra.
    print("-" * 78)
    print("── 11. Thẻ kết quả hiện cảnh báo, KHÔNG để trôi như toast ──────────")
    try:
        d = run_js("""() => {
          const out = [];
          const fakeEl = () => ({ style: {}, appendChild(x) { out.push(x.innerHTML); },
                                  addEventListener() {} });
          globalThis.__g = fakeEl();
          const _old = document.getElementById;
          document.getElementById = () => globalThis.__g;
          document.createElement = () => ({ style: {}, className: '', innerHTML: '',
                                            addEventListener() {}, appendChild() {} });
          // Thẻ của hóa đơn THIẾU khối người mua
          addResult('phieu.pdf', 'HD-MOI', 3, true,
            { thieu_nguoi_mua: ['MST', 'tên đơn vị'], canh_bao_dia_chi: 'Khong tim ra dia chi' });
          const xau = out.join('|');
          out.length = 0;
          // Thẻ của hóa đơn ĐỦ -> không được kêu oan
          addResult('phieu2.pdf', 'HD-OK', 3, true,
            { thieu_nguoi_mua: [], canh_bao_dia_chi: '' });
          const dep = out.join('|');
          document.getElementById = _old;
          return { xau, dep };
        }""")
        check("thiếu khối người mua -> thẻ kết quả có khối cảnh báo",
              "nd-warn" in d["xau"], d["xau"][:90])
        check("và in ĐÚNG các ô còn thiếu", "MST" in d["xau"] and "tên đơn vị" in d["xau"])
        check("và in cảnh báo địa chỉ", "Khong tim ra dia chi" in d["xau"])
        check("và dặn chọn Địa chỉ giao hàng trước khi ghi sổ",
              "Địa chỉ giao hàng" in d["xau"] and "ghi sổ" in d["xau"])
        check("hóa đơn ĐỦ thông tin -> KHÔNG kêu oan",
              "nd-warn" not in d["dep"], d["dep"][:70])
    except Exception as e:  # noqa: BLE001
        check("chạy được addResult với DOM giả", False, str(e)[:90])

    print("=" * 78)
    if ok_all:
        print("KẾT QUẢ: ĐẠT — ô Địa chỉ chỉ nhận Address thật, mơ hồ thì hỏi người, "
              "và không tạo hóa đơn thứ hai cho một phiếu.")
        return 0
    print("KẾT QUẢ: CÓ MỤC KHÔNG ĐẠT ❌")
    return 1


if __name__ == "__main__":
    sys.exit(main())
