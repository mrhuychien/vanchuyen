#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nhap_don_coopmart_check — đơn Coopmart phải tra được mã, và khi KHÔNG tra
được thì app phải NÓI RA vì sao.

════════════════════════════════════════════════════════════════════════════
CON BUG PHÉP KIỂM NÀY CANH
════════════════════════════════════════════════════════════════════════════

Luồng nhập đơn tự động dựa vào MỘT MÔ HÌNH ĐẶT NGOÀI (`gemini-2.5-flash`).
Mã app đứng im nhưng chữ mô hình trả về đổi theo bản Google roll — nên đây là
loại hỏng "đang chạy tự dưng lỗi" mà `git log` không giải thích được.

Coopmart là chuỗi mong manh nhất, vì nó là chuỗi DUY NHẤT:

  * tra Item bằng MỘT CUSTOM FIELD (`custom_macop`) thay vì barcode,
  * dùng key JSON do app TỰ ĐẶT (`custom_macop`) — không phải từ thông dụng
    như "barcode", nên mô hình dễ đổi cách gọi nhất,
  * cần `data.customer` khớp ĐÚNG Y chữ "Coopmart" để chọn kiểu tra.

BỐN ĐƯỜNG VỠ, cả bốn trước đây ra CÙNG MỘT câu "Không có sản phẩm hợp lệ nào":

  1. Mô hình trả "Co.opMart" (đúng y cách in trên phiếu, và chính là chuỗi
     nằm trong prompt nhận diện) ⇒ `=== "Coopmart"` sai ⇒ app âm thầm rơi về
     tra BARCODE ⇒ mã SKU Coopmart không bao giờ khớp. Mã trên phiếu ĐÚNG,
     modal hiện ĐÚNG mã, mà vẫn trượt sạch.
  2. Mô hình đổi key JSON (`sku_number` thay `custom_macop`) ⇒ itemId rỗng ⇒
     server bỏ qua hết dòng.
  3. Mã ra dạng SỐ trong JSON ⇒ "0123456" mất số 0 ngay lúc parse ⇒ so khớp
     chính xác trượt, mắt người vẫn thấy mã đúng.
  4. Field `custom_macop` không tồn tại trên Item (app KHÁC sở hữu field này)
     ⇒ `has_column` sai ⇒ hàm tra trả None IM LẶNG.

VÀ CÁI BẪY khiến không ai lần ra được: `lookupType` bị đóng băng vào
`dataset.lt` lúc render modal. Người dùng sửa tay ô "Khách hàng" thành
"Coopmart" — cách chữa hiển nhiên nhất — KHÔNG hề làm các dòng đổi sang tra
mã Coopmart.

Chạy KHÔNG CẦN BENCH (frappe giả + DOM giả, nạp JS bằng node):
    python3 docs/verified/nhap_don_coopmart_check.py   # exit 0 = đạt
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import types
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
JS = os.path.join(REPO, "vanchuyen/public/vanchuyen/views/nhap-don.js")

ok_all = True


def check(label, cond, detail=""):
    global ok_all
    print(("  ✅ " if cond else "  ❌ ") + label + (f"  ({detail})" if detail else ""))
    if not cond:
        ok_all = False
    return cond


# ════════════════════════════════════════════════════════════════════════════
# PHẦN JS — nạp nhap-don.js trong node, thay import bằng bộ giả
# ════════════════════════════════════════════════════════════════════════════
def run_js(extra_js, prelude=""):
    src = open(JS, encoding="utf-8").read()
    src = re.sub(r"^import .*?;\s*$", "", src, flags=re.M)
    src = re.sub(r"^export ", "", src, flags=re.M)
    harness = (
        "const call=async()=>({});const errText=(e)=>String(e);\n"
        "const escapeHtml=(s)=>String(s==null?'':s)"
        ".replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');\n"
        "const showToast=()=>{};const showModal=()=>null;const closeModal=()=>{};\n"
        "const document={getElementById:()=>null,"
        "createElement:()=>({style:{},addEventListener(){},appendChild(){}}),"
        "head:{appendChild(){}},body:{appendChild(){}}};\n"
        "const window={};\n"
        + src
        + "\n" + prelude
        + "\nconsole.log(JSON.stringify((" + extra_js + ")()));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(harness)
        tmp = f.name
    try:
        r = subprocess.run(["node", tmp], capture_output=True, text=True)
    finally:
        os.unlink(tmp)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "").strip().splitlines()[-1] if r.stderr else "node lỗi")
    return json.loads(r.stdout)


# DOM giả vừa đủ cho `collectModal` — phải canh ĐÚNG CHỖ DÙNG, không canh
# định nghĩa: khẳng định "có hàm lookupTypeFor" vẫn đúng y nguyên kể cả khi
# collectModal vẫn đọc dataset.lt như cũ.
FAKE_DOM = """
function fakeContent(customer, rows) {
  const F = {
    '#nd-r-customer': { value: customer },
    '#nd-r-po':       { value: 'PO123' },
    '#nd-r-podate':   { value: '2026-10-07' },
    '#nd-r-deliver':  { value: 'Co.opMart Ha Dong' },
  };
  const trs = rows.map((r) => ({
    querySelector: (sel) => {
      if (sel === '.nd-it-id')  return { value: r.itemId, dataset: { lt: r.lt } };
      if (sel === '.nd-it-qty') return { value: String(r.qty) };
      if (sel === '.nd-it-uom') return { value: r.uom };
      return null;
    },
  }));
  return {
    querySelector: (sel) => F[sel] || null,
    querySelectorAll: (sel) => (sel === '#nd-it-body tr' ? trs : []),
  };
}
"""


# ════════════════════════════════════════════════════════════════════════════
# PHẦN PYTHON — frappe giả cho nhap_don.py
# ════════════════════════════════════════════════════════════════════════════
class _D(dict):
    __getattr__ = dict.get

    def __setattr__(self, k, v):
        self[k] = v


class Throw(Exception):
    pass


COLS = set()        # cột có thật trên Item
ITEMS = []          # [{"name":..., "<field>":...}]
LOGGED = []
SQL_COLS_USED = []  # tên cột thực sự đi vào câu SQL
BARCODES = {}       # barcode -> tên Item (bảng `Item Barcode` giả)


def _stub_frappe():
    fr = types.ModuleType("frappe")
    fr.ValidationError = Throw
    fr.PermissionError = type("PermissionError_", (Exception,), {})

    def _throw(msg, exc=None):
        raise Throw(str(msg))

    fr.throw = _throw
    fr._ = lambda s, *a, **k: s
    fr.whitelist = lambda *a, **k: (lambda f: f)
    fr.msgprint = lambda *a, **k: None
    fr.log_error = lambda msg, title=None: LOGGED.append((title, str(msg)))
    fr.get_traceback = lambda *a, **k: ""
    fr._dict = _D
    fr.conf = {}
    fr.has_permission = lambda *a, **k: True

    def get_all(dt, filters=None, fields=None, **k):
        # `_lookup_by_barcode` lọc dạng [["Item Barcode", "barcode", "=", bc]].
        if dt != "Item" or not isinstance(filters, (list, tuple)):
            return []
        for f in filters:
            if len(f) == 4 and f[0] == "Item Barcode" and f[1] == "barcode":
                hit = BARCODES.get(str(f[3]))
                return [_D(name=hit)] if hit else []
        return []

    fr.get_all = get_all

    class _DB:
        def get_table_columns(self, dt):
            return sorted(COLS) if dt == "Item" else []

        def has_column(self, dt, col):
            return dt == "Item" and col in COLS

        def get_value(self, *a, **k):
            return None

        def sql(self, query, values=None, **k):
            # Bắt đúng câu tra Item theo cột mã, và LẤY TÊN CỘT TỪ CHÍNH CÂU
            # SQL — nhờ vậy phép kiểm chốt được rằng tên cột đi vào SQL là tên
            # thật trên DB, không phải chuỗi gõ trong mã (bẫy NFC/NFD).
            q = " ".join(str(query).split())
            m = re.search(r"SELECT name, `(.+?)` AS ma FROM `tabItem`", q)
            if not m:
                return []
            col = m.group(1)
            SQL_COLS_USED.append(col)
            want = [str(x) for x in (values or {}).get("v", ())]
            return [
                _D(name=it["name"], ma=it.get(col))
                for it in ITEMS
                if str(it.get(col, "\0")) in want
            ]

        def commit(self):
            pass

    fr.db = _DB()
    sys.modules["frappe"] = fr

    fu = types.ModuleType("frappe.utils")
    fu.flt = lambda v, p=None: float(v or 0)
    fu.cint = lambda v: int(float(v or 0))
    fu.cstr = lambda v: "" if v is None else str(v)
    fu.nowdate = lambda: "2026-10-07"
    sys.modules["frappe.utils"] = fu
    return fr


def main():
    print("=" * 78)
    print("nhap_don_coopmart_check — đơn Coopmart tra được mã, lỗi thì nói ra vì sao")
    print("=" * 78)

    # ── 1. Tên chuỗi Gemini trôi chữ vẫn phải về đúng Coopmart ─────────
    print("-" * 78)
    print("── 1. Chữ mô hình trả về trôi -> vẫn nhận ra Coopmart ──────────────")
    drift = ["Coopmart", "Co.opMart", "Co.op Mart", "CoopMart", "CO.OPMART", "  coopmart  "]
    try:
        d = run_js("() => ({ canon: %s.map(canonCustomer), lt: %s.map((c) => lookupTypeFor(canonCustomer(c))) })"
                   % (json.dumps(drift), json.dumps(drift)))
        check("mọi cách viết đều về “Coopmart”",
              d["canon"] == ["Coopmart"] * len(drift), str(d["canon"]))
        check("và đều chọn kiểu tra “coopmart”",
              d["lt"] == ["coopmart"] * len(drift), str(d["lt"]))
        d2 = run_js("() => ({ bc: lookupTypeFor(canonCustomer('BigC')),"
                    " mm: lookupTypeFor(canonCustomer('MM Mega Market')),"
                    " la: canonCustomer('Khach le ABC') })")
        check("BigC vẫn tra theo barcode (không kéo cả nhà sang coopmart)",
              d2["bc"] == "barcode", d2["bc"])
        check("Mega Market vẫn ra megamarket", d2["mm"] == "megamarket", d2["mm"])
        check("tên lạ thì GIỮ NGUYÊN để người sửa, không tự bịa",
              d2["la"] == "Khach le ABC", d2["la"])
    except Exception as e:  # noqa: BLE001
        check("nạp và chạy được nhap-don.js", False, str(e)[:90])

    # ── 2. Key JSON trôi vẫn lấy được mã ──────────────────────────────
    print("-" * 78)
    print("── 2. Mô hình đổi tên key JSON -> vẫn lấy được mã Coopmart ─────────")
    try:
        d = run_js("""() => {
          const keys = ['custom_macop', 'macop', 'sku_number', 'sku'];
          const out = {};
          for (const k of keys) {
            const data = { customer: 'Co.opMart', items: [{ [k]: '123456', ou_qty: 3 }] };
            const n = normalizeItems(data)[0];
            out[k] = [n.itemId, n.lookupType, n.qty, n.uom];
          }
          const trong = normalizeItems({ customer: 'Coopmart', items: [{ ou_qty: 2 }] })[0];
          out.__trong = [trong.itemId, trong.lookupType];
          // Phiếu Coopmart CÓ cột EAN. Đơn Coopmart tra Item bằng `custom_macop`,
          // nên mã Coopmart phải THẮNG barcode — kể cả khi key của nó đã trôi.
          out.__uutien = normalizeItems({
            customer: 'Coopmart',
            items: [{ barcode: '8936110891189', sku_number: '123456', ou_qty: 3 }],
          })[0].itemId;
          out.__uutien_goc = normalizeItems({
            customer: 'Coopmart',
            items: [{ barcode: '8936110891189', custom_macop: '123456', ou_qty: 3 }],
          })[0].itemId;
          // Ngược lại: đơn BigC thì barcode mới là mã, không được lấy sku.
          out.__bigc = normalizeItems({
            customer: 'BigC',
            items: [{ barcode: '8936110891189', sku: '999', ou_qty: 3 }],
          })[0].itemId;
          return out;
        }""")
        for k in ("custom_macop", "macop", "sku_number", "sku"):
            check(f"key “{k}” -> lấy đúng mã + kiểu tra coopmart",
                  d[k] == ["123456", "coopmart", 3, "Thùng"], str(d[k]))
        check("không có key nào -> itemId rỗng (để modal cảnh báo, không bịa mã)",
              d["__trong"] == ["", "coopmart"], str(d["__trong"]))
        check("dòng có CẢ barcode lẫn mã Coopmart (key gốc) -> lấy mã Coopmart",
              d["__uutien_goc"] == "123456", str(d["__uutien_goc"]))
        check("có cả barcode lẫn mã Coopmart KEY ĐÃ TRÔI -> vẫn lấy mã Coopmart",
              d["__uutien"] == "123456", str(d["__uutien"]))
        check("đơn BigC thì barcode mới là mã, không vơ lấy sku",
              d["__bigc"] == "8936110891189", str(d["__bigc"]))
    except Exception as e:  # noqa: BLE001
        check("chạy được normalizeItems", False, str(e)[:90])

    # ── 3. CÁI BẪY: sửa tay ô Khách hàng phải có tác dụng ──────────────
    print("-" * 78)
    print("── 3. Sửa tay ô Khách hàng -> các dòng PHẢI đổi sang tra Coopmart ──")
    try:
        d = run_js("""() => {
          // Hàng được render khi mô hình còn trả "Co.opMart": dataset.lt đóng
          // băng ở 'barcode'. Người dùng sửa ô Khách hàng thành 'Coopmart'.
          const rows = [{ itemId: '123456', qty: 3, uom: 'Thùng', lt: 'barcode' }];
          const sua  = collectModal(fakeContent('Coopmart', rows));
          const nguyen = collectModal(fakeContent('Co.opMart', rows));
          const bigc = collectModal(fakeContent('BigC', rows));
          return {
            sua: [sua.header.customer, sua.items[0].lookupType],
            nguyen: [nguyen.header.customer, nguyen.items[0].lookupType],
            bigc: [bigc.header.customer, bigc.items[0].lookupType],
          };
        }""", prelude=FAKE_DOM)
        check("sửa tay thành “Coopmart” -> dòng chuyển sang coopmart",
              d["sua"] == ["Coopmart", "coopmart"], str(d["sua"]))
        check("để nguyên “Co.opMart” -> cũng tự về Coopmart, không cần sửa tay",
              d["nguyen"] == ["Coopmart", "coopmart"], str(d["nguyen"]))
        check("đơn BigC vẫn barcode (không suy bừa từ ô Khách hàng)",
              d["bigc"] == ["BigC", "barcode"], str(d["bigc"]))
    except Exception as e:  # noqa: BLE001
        check("chạy được collectModal với DOM giả", False, str(e)[:90])

    # ── 4. Modal phải CẢNH BÁO khi có dòng thiếu mã ────────────────────
    print("-" * 78)
    print("── 4. Dòng không đọc được mã -> modal nói ra, không để lọt êm ──────")
    src = open(JS, encoding="utf-8").read()
    check("thân modal có chèn khối cảnh báo thiếu mã",
          "${canhBao}" in src and 'class="nd-warn"' in src)
    check("`.nd-warn` có định nghĩa CSS (không phải class trống)",
          ".nd-warn {" in src)
    check("toast in ĐÚNG mã bị bỏ, không chỉ đếm",
          "res.missing.slice(0, 5).join" in src)

    # ── 5. Server: thiếu field thì KÊU, không trả None im lặng ─────────
    print("-" * 78)
    print("── 5. Server — thiếu field mã là lỗi CẤU HÌNH, phải kêu to ─────────")
    _stub_frappe()
    sys.path.insert(0, REPO)
    import importlib

    nd = importlib.import_module("vanchuyen.api.nhap_don")

    COLS.clear()
    try:
        nd._resolve_item_code("123456", "coopmart")
        check("Item không có field nào -> throw (không trả None im lặng)", False, "không throw")
    except Throw as e:
        check("Item không có field nào -> throw", True)
        check("và câu lỗi NÓI RÕ là lỗi cấu hình, không phải mã sai",
              "cấu hình" in str(e), str(e)[:70])
        check("và liệt kê các tên field đã thử",
              "custom_macop" in str(e), str(e)[:70])

    # Dò theo danh sách ứng viên: tên nào có cột thật thì dùng tên đó.
    COLS.clear()
    COLS.add("custom_ma_coop")
    check("dò được field thay thế khi tên chính không tồn tại",
          nd._item_field("coopmart") == "custom_ma_coop", str(nd._item_field("coopmart")))

    # ── 5b. FIELDNAME CÓ DẤU TIẾNG VIỆT ───────────────────────────────
    #
    # Tên thật trên site là `custom_mã_coopmart`. Chữ "ã" có HAI cách mã hoá
    # Unicode; field tạo từ máy Mac ra NFD còn mã nguồn này NFC, nên so tên
    # bằng `==` là trả False dù cột có thật — đúng kiểu hỏng không ai nghĩ ra.
    print("-" * 78)
    print("── 5b. Fieldname tiếng Việt có dấu — NFC/NFD và tên không dấu ──────")
    THAT = "custom_mã_coopmart"
    NFD = unicodedata.normalize("NFD", THAT)
    check("hai dạng Unicode của cùng tên KHÔNG bằng nhau theo `==` (bẫy có thật)",
          THAT != NFD and len(THAT) != len(NFD), f"NFC {len(THAT)} ký tự vs NFD {len(NFD)}")
    for nhan, col in [("NFC (đúng như gõ trong mã)", THAT),
                      ("NFD (field tạo từ máy Mac)", NFD),
                      ("không dấu `custom_ma_coopmart`", "custom_ma_coopmart")]:
        COLS.clear()
        COLS.add(col)
        got = nd._item_field("coopmart")
        check(f"cột {nhan} -> dò ra", got == col, repr(got))

    # Và tên đi vào SQL phải là TÊN LẤY TỪ DB, không phải chuỗi gõ trong mã.
    COLS.clear()
    COLS.add(NFD)
    del ITEMS[:]
    del SQL_COLS_USED[:]
    ITEMS.append({"name": "SP-NFD", NFD: "123456"})
    check("cột dạng NFD -> vẫn tra ra Item",
          nd._resolve_item_code("123456", "coopmart") == "SP-NFD",
          str(nd._resolve_item_code("123456", "coopmart")))
    check("và tên cột đi vào SQL là tên LẤY TỪ DB (dạng NFD), không phải NFC",
          SQL_COLS_USED and SQL_COLS_USED[0] == NFD,
          repr(SQL_COLS_USED[:1]))

    # ── 5c. Tên field ĐÃ XÁC NHẬN, và chuỗi nào CỐ Ý vẫn dùng barcode ──
    #
    # Hai tên dưới đây là tên thật trên site, không phải phỏng đoán. Ghim lại
    # để ai dọn danh sách ứng viên cũng không gỡ mất chúng.
    print("-" * 78)
    print("── 5c. Tên field đã xác nhận · chuỗi dùng barcode thì để yên ───────")
    COLS.clear()
    COLS.update({"custom_mã_coopmart", "custom_mã_mm"})
    for lt, ten in [("coopmart", "custom_mã_coopmart"), ("megamarket", "custom_mã_mm")]:
        check(f"dò ra tên thật của {lt}: `{ten}`",
              nd._item_field(lt) == ten, str(nd._item_field(lt)))

    # Quyết định của chủ hệ thống: chuỗi nào đang tra bằng BARCODE thì không
    # đổi sang cột mã riêng, dù site có cột đó (`custom_mã_win` là một ví dụ).
    # Chốt ở CẢ HAI tầng, vì chỉ chốt một tầng thì tầng kia lệch vẫn lọt.
    check("server KHÔNG có cấu hình cột mã cho winmart",
          "winmart" not in nd.MA_CHUOI_FIELDS, str(sorted(nd.MA_CHUOI_FIELDS)))
    # Đơn winmart phải đi đường barcode: ra Item nếu barcode khớp, và KHÔNG
    # throw "thiếu cột" (cột mã Win không nằm trong cấu hình nên không ai đòi).
    del ITEMS[:]
    BARCODES.clear()
    BARCODES["8936110891189"] = "SP-WIN-BC"
    try:
        got = nd._resolve_item_code("8936110891189", "winmart")
        check("đơn winmart tra ĐƯỢC bằng barcode", got == "SP-WIN-BC", str(got))
        check("và mã lạ thì trả None, không throw thiếu cột",
              nd._resolve_item_code("W12345", "winmart") is None,
              str(nd._resolve_item_code("W12345", "winmart")))
    except Throw as e:
        check("đơn winmart đi đường barcode, không throw", False, str(e)[:70])

    try:
        d = run_js("""() => ['Winmart', 'WINMART', 'WinCommerce', 'BigC', 'Lotte Mart',
          'EMART', 'BRG Retail', 'AEON'].map((c) => lookupTypeFor(canonCustomer(c)))""")
        check("frontend: các chuỗi còn lại đều giữ kiểu tra “barcode”",
              d == ["barcode"] * 8, str(d))
    except Exception as e:  # noqa: BLE001
        check("chạy được lookupTypeFor cho các chuỗi barcode", False, str(e)[:90])

    # Không đọc được danh sách cột -> phải lùi về has_column, đừng mù luôn.
    # Đường lùi so tên ĐÚNG Y (không có `_ascii_key` đỡ), nên TÊN THẬT CÓ DẤU
    # phải nằm trong danh sách ứng viên. Trên đường chính nó là dư thừa —
    # `custom_ma_coopmart` cho cùng một khoá — nên chỉ mục này gánh được việc
    # chốt rằng tên thật không bị gỡ khỏi danh sách.
    COLS.clear()
    COLS.add(THAT)
    _real_db = nd.frappe.db

    class _NoCols:
        # Giữ tham chiếu tới db THẬT trong biến đóng — `nd.frappe.db` lúc này
        # đã trỏ vào chính instance này, lấy qua đó là đệ quy vô tận.
        def __getattr__(self, k):
            return getattr(_real_db, k)

        def get_table_columns(self, dt):
            raise RuntimeError("không đọc được")

    nd.frappe.db = _NoCols()
    try:
        # Đường lùi so tên ĐÚNG Y nên CẢ HAI tên thật có dấu phải nằm trong
        # danh sách ứng viên. Trên đường chính chúng dư thừa — `_ascii_key` bỏ
        # cả dấu lẫn gạch dưới, nên `custom_ma_coopmart`/`custom_mamm` cho
        # cùng khoá — nên chỉ mục này gánh được việc chốt rằng không ai gỡ
        # mất chúng khi "dọn" danh sách.
        for lt, ten in [("coopmart", THAT), ("megamarket", "custom_mã_mm")]:
            COLS.clear()
            COLS.add(ten)
            check(f"không đọc được danh sách cột -> lùi về has_column với `{ten}`",
                  nd._item_field(lt) == ten, str(nd._item_field(lt)))
    finally:
        nd.frappe.db = _real_db

    # ── 6. Mã mất số 0 đầu (Gemini trả JSON số) vẫn tra ra ─────────────
    print("-" * 78)
    print("── 6. Mã mất số 0 đầu lúc parse JSON -> vẫn tra ra đúng Item ───────")
    COLS.clear()
    COLS.add("custom_mã_coopmart")
    del ITEMS[:]
    ITEMS.append({"name": "SP-COOP-A", "custom_mã_coopmart": "0123456"})
    check("mã trên phiếu 123456, Item lưu 0123456 -> vẫn ra Item",
          nd._resolve_item_code("123456", "coopmart") == "SP-COOP-A",
          str(nd._resolve_item_code("123456", "coopmart")))
    check("mã đúng y thì cũng ra Item ấy",
          nd._resolve_item_code("0123456", "coopmart") == "SP-COOP-A")
    check("mã khác hẳn thì KHÔNG ra Item nào (không khớp bừa)",
          nd._resolve_item_code("999999", "coopmart") is None,
          str(nd._resolve_item_code("999999", "coopmart")))

    # Có cả hai bản -> phải ưu tiên bản khớp ĐÚNG Y mã trên phiếu.
    del ITEMS[:]
    ITEMS.append({"name": "SP-DEM-0", "custom_mã_coopmart": "0123456"})
    ITEMS.append({"name": "SP-DUNG-Y", "custom_mã_coopmart": "123456"})
    check("có cả 2 bản -> lấy bản khớp ĐÚNG Y mã trên phiếu",
          nd._resolve_item_code("123456", "coopmart") == "SP-DUNG-Y",
          str(nd._resolve_item_code("123456", "coopmart")))

    # ── 7. Câu lỗi phải chỉ ra nguyên nhân thật ────────────────────────
    print("-" * 78)
    print("── 7. Không tra được -> câu lỗi phải chỉ ra NGUYÊN NHÂN ────────────")
    del ITEMS[:]
    del LOGGED[:]
    try:
        nd.create_sales_invoice(
            {"customer": "Coopmart", "so_po": "96122286"},
            [{"itemId": "123456", "qty": 3, "uom": "Thùng", "lookupType": "coopmart"},
             {"itemId": "", "qty": 2, "uom": "Thùng", "lookupType": "coopmart"}],
        )
        check("si_items rỗng -> throw", False, "không throw")
    except Throw as e:
        m = str(e)
        check("si_items rỗng -> throw", True)
        check("câu lỗi in ĐÚNG mã bị trượt", "123456" in m, m[:80])
        check("câu lỗi đếm dòng không đọc được mã", "1 dòng không đọc được mã" in m, m[:120])
        check("câu lỗi in KIỂU TRA đã dùng (chỗ lộ ra khi rơi về barcode)",
              "kiểu tra: coopmart" in m, m[:140])
        check("câu lỗi in tên khách hàng", "Coopmart" in m)
        check("và ghi Error Log để còn dấu vết sau khi tắt thông báo",
              any("nhap_don" in (t or "") for t, _ in LOGGED), str([t for t, _ in LOGGED]))

    # Đơn Coopmart bị rơi về tra barcode -> câu lỗi phải TỐ CÁO chuyện đó.
    del LOGGED[:]
    try:
        nd.create_sales_invoice(
            {"customer": "Coopmart", "so_po": "96122286"},
            [{"itemId": "123456", "qty": 3, "uom": "Thùng", "lookupType": "barcode"}],
        )
        check("đơn Coopmart tra theo barcode -> throw", False, "không throw")
    except Throw as e:
        check("đơn Coopmart mà kiểu tra là barcode -> câu lỗi tố cáo rõ",
              "kiểu tra: barcode" in str(e) and "Coopmart" in str(e), str(e)[:140])

    print("=" * 78)
    if ok_all:
        print("KẾT QUẢ: ĐẠT — Coopmart chịu được chữ/key trôi, mã mất số 0 vẫn tra ra, "
              "và khi trượt thì câu lỗi chỉ đúng nguyên nhân.")
        return 0
    print("KẾT QUẢ: CÓ MỤC KHÔNG ĐẠT ❌")
    return 1


if __name__ == "__main__":
    sys.exit(main())
