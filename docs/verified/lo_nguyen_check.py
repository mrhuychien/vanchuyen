#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lo_nguyen_check — LÔ KHÔNG ĐỊNH LƯỢNG ĐƯỢC BẰNG KIỆN phải xếp được chuyến.

════════════════════════════════════════════════════════════════════════════
CON BUG PHÉP KIỂM NÀY CANH
════════════════════════════════════════════════════════════════════════════

`custom_tổng_kiện` đếm THÙNG ĐẦY; phần dư không đủ một thùng nằm ở
`custom_hộp_lẻ`. Đơn nhỏ mà mọi mặt hàng đều đặt ít hơn một quy cách thùng
(trạm dừng nghỉ, cửa hàng lẻ) ra **0 kiện + 89 hộp lẻ** — vẫn là hàng thật,
vẫn chiếm chỗ trên xe, vẫn phải giao.

Mô hình xếp chuyến chỉ có MỘT đại lượng: `so_kien`. Với lô ấy nó rơi vào một
CATCH-22 ở SERVER, không chỉ ở nút bấm:

    _validate_structural      đòi  so_kien > 0
    _validate_pool_crosstrip  đòi  so_kien ≤ tổng = 0

Hai điều kiện loại trừ nhau ⇒ không giá trị nào hợp lệ. Mở nút "Thêm hết" ở
frontend thôi thì `save_trip` vẫn throw.

Và kể cả khi xếp được, hai guard `tong > 0` trong `_reconcile_one` khiến lô đó
VĨNH VIỄN mang "Chưa xếp" và không bao giờ tới "Đã giao hàng, chụp chứng từ" —
mà `get_pool` lọc đúng hai giá trị đó, nên lô nằm lại pool mãi mãi và mời điều
phối thêm lại lần nữa.

BA CẠM BẪY khi sửa, mỗi cái một mục kiểm dưới đây:

  1. Cho `so_kien = 0` mà không thêm chốt khác ⇒ cross-trip check MẤT TÁC DỤNG
     (`0 + 0 > 0 + EPS` không bao giờ đúng). Một lô 89 hộp lẻ gán được cho 3
     lái xe cùng ngày, không một cảnh báo nào.
  2. Không cho thể tích thật vào dòng ⇒ chuyến chở đầy hộp lẻ báo 0 m³, chốt
     chặn quá tải 110% MÙ HOÀN TOÀN. Đổi một lỗi chặn cứng lấy một lỗi âm thầm
     nguy hiểm hơn.
  3. Nới `_validate_structural` cho MỌI dòng 0 kiện ⇒ dòng rác trên lô thường
     lọt vào; mà hàm đó chạy cả khi LÁI XE cập nhật điểm giao
     (`lai_xe.update_stop_status` → `doc.save()`), nên một dòng hỏng khoá luôn
     việc cập nhật của CẢ CHUYẾN.

Chạy KHÔNG CẦN BENCH: bộ giả frappe tối thiểu ở `_stub_frappe`.
    python3 docs/verified/lo_nguyen_check.py   # exit 0 = đạt
"""

import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

ok_all = True


def check(label, cond, detail=""):
    global ok_all
    print(("  ✅ " if cond else "  ❌ ") + label + (f"  ({detail})" if detail else ""))
    if not cond:
        ok_all = False
    return cond


# ════════════════════════════════════════════════════════════════════════════
# BỘ GIẢ FRAPPE + BỘ GIẢ DB
# ════════════════════════════════════════════════════════════════════════════
class _D(dict):
    __getattr__ = dict.get

    def __setattr__(self, k, v):
        self[k] = v


class Throw(Exception):
    pass


# Kho dữ liệu giả: đơn hàng + các dòng chuyến đang giữ chỗ.
SI = {}      # name -> dict field Sales Invoice
ROWS = []    # dict(parent, sales_invoice, so_kien, trang_thai_giao, docstatus, trang_thai)
WROTE = {}   # name -> dict đã stamp ngược


def _reset():
    SI.clear()
    del ROWS[:]
    WROTE.clear()


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
    fr.log_error = lambda *a, **k: None
    fr.get_traceback = lambda *a, **k: ""
    fr._dict = _D
    fr.conf = {}
    fr.session = types.SimpleNamespace(user="check@local")
    fr.get_all = lambda *a, **k: []

    class _DB:
        def get_value(self, dt, name=None, fields=None, **k):
            if dt != "Sales Invoice":
                return None
            row = SI.get(name)
            if row is None:
                return None
            if isinstance(fields, (list, tuple)):
                d = _D({f: row.get(f) for f in fields})
                return d if k.get("as_dict") else [row.get(f) for f in fields]
            return row.get(fields)

        def set_value(self, dt, name, values, **k):
            WROTE.setdefault(name, {}).update(values)

        def exists(self, *a, **k):
            return True

        def sql(self, query, values=None, **k):
            q = " ".join(str(query).split())
            v = values or {}
            si = v.get("si")
            live = [
                r for r in ROWS
                if r["sales_invoice"] == si
                and r.get("docstatus", 0) < 2
                and not (r.get("trang_thai") == "Hoàn thành" and r.get("trang_thai_giao") != "Đã giao")
            ]
            if v.get("ex"):
                live = [r for r in live if r["parent"] != v["ex"]]

            if "SUM(cxd.so_kien)" in q and "trang_thai_giao = 'Đã giao'" in q:
                # da_giao: chỉ dòng Đã giao trên chuyến đã submit
                return [[sum(r["so_kien"] for r in ROWS
                             if r["sales_invoice"] == si
                             and r.get("trang_thai_giao") == "Đã giao"
                             and r.get("docstatus") == 1)]]
            if "SUM(cxd.so_kien)" in q:
                return [[sum(r["so_kien"] for r in live)]]
            if "COUNT(*)" in q and "trang_thai_giao = 'Đã giao'" in q:
                return [[len([r for r in ROWS
                              if r["sales_invoice"] == si
                              and r.get("trang_thai_giao") == "Đã giao"
                              and r.get("docstatus") == 1])]]
            if "SELECT cx.name" in q:
                seen, out = set(), []
                for r in live:
                    if r["parent"] in seen:
                        continue
                    seen.add(r["parent"])
                    out.append(_D(name=r["parent"], lai_xe="LX", ten_lai_xe="Lái xe",
                                  sdt_lai_xe="", xe="XE", trang_thai=r.get("trang_thai") or "Đang giao",
                                  creation=r["parent"]))
                return out
            return []

        def has_column(self, *a, **k):
            return True

    fr.db = _DB()
    sys.modules["frappe"] = fr

    fu = types.ModuleType("frappe.utils")
    fu.flt = lambda v, p=None: float(v or 0)
    fu.cint = lambda v: int(float(v or 0))
    fu.nowdate = lambda: "2026-09-12"
    fu.now = lambda: "2026-09-12 00:00:00"
    sys.modules["frappe.utils"] = fu

    fm = types.ModuleType("frappe.model")
    fmd = types.ModuleType("frappe.model.document")

    class Document:
        pass

    fmd.Document = Document
    sys.modules["frappe.model"] = fm
    sys.modules["frappe.model.document"] = fmd
    return fr


def main():
    _stub_frappe()
    sys.path.insert(0, REPO)
    import importlib

    cx = importlib.import_module("vanchuyen.van_chuyen.doctype.chuyen_xe.chuyen_xe")

    print("=" * 78)
    print("lo_nguyen_check — lô chỉ có hộp lẻ phải xếp được chuyến")
    print("=" * 78)

    LO = "SI-LE"        # 0 kiện, 89 hộp lẻ, 2.5 m³ (2.500.000 cm³)
    THUONG = "SI-10"    # 10 kiện, 5 m³
    TRONG = "SI-0"      # 0/0/0 — thiếu dữ liệu

    def seed():
        _reset()
        SI[LO] = {"custom_tổng_kiện": 0, "custom_hộp_lẻ": 89,
                  "custom_thể_tích_lô": 2_500_000, "docstatus": 1, "is_return": 0,
                  "custom_hình_thức_vận_chuyển": "Tự vận chuyển",
                  "customer_name": "Trạm dừng nghỉ", "shipping_address": None,
                  "custom_tỉnh": "Hải Phòng", "custom_po_": "PO1"}
        SI[THUONG] = {"custom_tổng_kiện": 10, "custom_hộp_lẻ": 3,
                      "custom_thể_tích_lô": 5_000_000, "docstatus": 1, "is_return": 0,
                      "custom_hình_thức_vận_chuyển": "Tự vận chuyển",
                      "customer_name": "NPP A", "shipping_address": None,
                      "custom_tỉnh": "Phú Thọ", "custom_po_": "PO2"}
        SI[TRONG] = dict(SI[LO], **{"custom_hộp_lẻ": 0, "custom_thể_tích_lô": 0,
                                    "customer_name": "ORION"})

    # ── 1. Khái niệm khai ĐÚNG MỘT CHỖ ─────────────────────────────────
    print("-" * 78)
    print("── 1. `la_lo_nguyen` — khái niệm, và thể tích không bị xoá ─────────")
    seed()
    check("đơn 0 kiện là LÔ NGUYÊN", cx.la_lo_nguyen(LO) is True)
    check("đơn có kiện thì KHÔNG", cx.la_lo_nguyen(THUONG) is False)
    check("lô nguyên giữ TRỌN thể tích lô, không bị guard chia-0 xoá thành 0",
          cx.the_tich_con_lai(LO) == 2.5, str(cx.the_tich_con_lai(LO)))
    check("lô thường vẫn pro-rata như cũ (chưa xếp gì -> trọn 5 m³)",
          cx.the_tich_con_lai(THUONG) == 5.0, str(cx.the_tich_con_lai(THUONG)))
    ROWS.append({"parent": "CX-1", "sales_invoice": THUONG, "so_kien": 4,
                 "trang_thai_giao": "Chờ giao", "docstatus": 1, "trang_thai": "Đang giao"})
    check("lô thường xếp 4/10 -> còn 3 m³ (hồi quy pro-rata)",
          abs(cx.the_tich_con_lai(THUONG) - 3.0) < 1e-9, str(cx.the_tich_con_lai(THUONG)))

    # ── 2. CẠM BẪY 1 — cross-trip không được mất tác dụng ──────────────
    print("-" * 78)
    print("── 2. Lô nguyên chỉ nằm trên MỘT chuyến (chốt thay cho bất đẳng thức) ")
    seed()
    check("chưa chuyến nào giữ -> False", cx.da_giu_nguyen_lo(LO) is False)
    ROWS.append({"parent": "CX-A", "sales_invoice": LO, "so_kien": 0,
                 "trang_thai_giao": "Chờ giao", "docstatus": 0, "trang_thai": "Nháp"})
    check("một chuyến NHÁP đang giữ -> True (so_kien = 0 vẫn tính là giữ chỗ)",
          cx.da_giu_nguyen_lo(LO) is True)
    check("nhưng loại trừ chính chuyến đó -> False (sửa lại nháp của mình vẫn được)",
          cx.da_giu_nguyen_lo(LO, exclude_trip="CX-A") is False)

    class FakeDoc(cx.ChuyenXe):
        def __init__(self, rows, name="CX-NEW"):
            self.name = name
            self.don_hang = [_D(r) for r in rows]
            for i, r in enumerate(self.don_hang, 1):
                r.idx = i
                r.setdefault("the_tich", 0)
                r.setdefault("so_kien", 0)

    def throws(doc, fn):
        try:
            getattr(doc, fn)()
            return None
        except Throw as e:
            return str(e)

    seed()
    ROWS.append({"parent": "CX-A", "sales_invoice": LO, "so_kien": 0,
                 "trang_thai_giao": "Chờ giao", "docstatus": 1, "trang_thai": "Đang giao"})
    msg = throws(FakeDoc([{"sales_invoice": LO, "so_kien": 0}], name="CX-B"),
                 "_validate_pool_and_crosstrip")
    check("xếp lô nguyên lên CHUYẾN THỨ HAI -> bị chặn", bool(msg), (msg or "KHÔNG CHẶN")[:70])
    check("và câu báo gọi đúng tên chuyến đang giữ", bool(msg) and "CX-A" in msg)
    msg = throws(FakeDoc([{"sales_invoice": LO, "so_kien": 0}], name="CX-A"),
                 "_validate_pool_and_crosstrip")
    check("sửa lại CHÍNH chuyến đang giữ thì KHÔNG chặn", msg is None, msg or "ok")
    msg = throws(FakeDoc([{"sales_invoice": LO, "so_kien": 5}], name="CX-A"),
                 "_validate_pool_and_crosstrip")
    check("nhập số kiện cho lô nguyên -> chặn kèm lý do đọc được",
          bool(msg) and "không nhập số kiện" in msg, (msg or "KHÔNG CHẶN")[:70])

    # ── 3. CẠM BẪY 3 — không nới bừa cho lô thường ─────────────────────
    print("-" * 78)
    print("── 3. `_validate_structural` — 0 kiện chỉ hợp lệ với lô nguyên ─────")
    seed()
    check("dòng 0 kiện trên LÔ NGUYÊN: hợp lệ",
          throws(FakeDoc([{"sales_invoice": LO, "so_kien": 0}]), "_validate_structural") is None)
    m = throws(FakeDoc([{"sales_invoice": THUONG, "so_kien": 0}]), "_validate_structural")
    check("dòng 0 kiện trên LÔ THƯỜNG: vẫn chặn cứng (hồi quy)", bool(m), (m or "LỌT")[:60])
    m = throws(FakeDoc([{"sales_invoice": LO, "so_kien": -1}]), "_validate_structural")
    check("số kiện ÂM: chặn kể cả trên lô nguyên", bool(m), (m or "LỌT")[:60])
    m = throws(FakeDoc([{"sales_invoice": LO, "so_kien": 0},
                        {"sales_invoice": LO, "so_kien": 0}]), "_validate_structural")
    check("cùng một đơn 2 dòng trong một chuyến: vẫn chặn (hồi quy)", bool(m), (m or "LỌT")[:60])

    # ── 4. CẠM BẪY 2 — thể tích phải vào được dòng ─────────────────────
    print("-" * 78)
    print("── 4. `_enrich_rows` — chuyến chở hộp lẻ KHÔNG được báo 0 m³ ───────")
    seed()
    d = FakeDoc([{"sales_invoice": LO, "so_kien": 0}])
    d._enrich_rows()
    check("dòng lô nguyên mang TRỌN 2.5 m³", d.don_hang[0].the_tich == 2.5,
          str(d.don_hang[0].the_tich))
    check("và chép hộp lẻ để hiển thị", d.don_hang[0].hop_le == 89)
    d2 = FakeDoc([{"sales_invoice": THUONG, "so_kien": 4}])
    d2._enrich_rows()
    check("lô thường vẫn pro-rata 4/10 × 5 = 2 m³ (hồi quy)",
          abs(d2.don_hang[0].the_tich - 2.0) < 1e-9, str(d2.don_hang[0].the_tich))

    # ── 5. Vòng đời — lô nguyên phải RỜI ĐƯỢC pool ─────────────────────
    print("-" * 78)
    print("── 5. `_reconcile_one` — không còn zombie kẹt pool vĩnh viễn ───────")
    seed()
    cx._reconcile_one(LO)
    check("chưa chuyến nào -> 'Chưa xếp'", WROTE[LO]["custom_trang_thai_xep"] == "Chưa xếp",
          WROTE[LO]["custom_trang_thai_xep"])
    seed()
    ROWS.append({"parent": "CX-A", "sales_invoice": LO, "so_kien": 0,
                 "trang_thai_giao": "Chờ giao", "docstatus": 1, "trang_thai": "Đang giao"})
    cx._reconcile_one(LO)
    check("đã lên chuyến -> 'Đủ' (điều kiện RỜI POOL của get_pool)",
          WROTE[LO]["custom_trang_thai_xep"] == "Đủ", WROTE[LO]["custom_trang_thai_xep"])
    check("và đang giao -> 'Đang giao hàng'",
          WROTE[LO].get("custom_trạng_thái_vận_chuyển") == "Đang giao hàng",
          str(WROTE[LO].get("custom_trạng_thái_vận_chuyển")))
    seed()
    ROWS.append({"parent": "CX-A", "sales_invoice": LO, "so_kien": 0,
                 "trang_thai_giao": "Đã giao", "docstatus": 1, "trang_thai": "Hoàn thành"})
    cx._reconcile_one(LO)
    check("giao xong -> 'Đã giao hàng, chụp chứng từ' (lối thoát pool thứ hai)",
          WROTE[LO].get("custom_trạng_thái_vận_chuyển") == "Đã giao hàng, chụp chứng từ",
          str(WROTE[LO].get("custom_trạng_thái_vận_chuyển")))
    # Hồi quy lô thường
    seed()
    ROWS.append({"parent": "CX-A", "sales_invoice": THUONG, "so_kien": 4,
                 "trang_thai_giao": "Chờ giao", "docstatus": 1, "trang_thai": "Đang giao"})
    cx._reconcile_one(THUONG)
    check("lô thường xếp 4/10 -> 'Một phần' (hồi quy)",
          WROTE[THUONG]["custom_trang_thai_xep"] == "Một phần",
          WROTE[THUONG]["custom_trang_thai_xep"])
    seed()
    ROWS.append({"parent": "CX-A", "sales_invoice": THUONG, "so_kien": 10,
                 "trang_thai_giao": "Đã giao", "docstatus": 1, "trang_thai": "Hoàn thành"})
    cx._reconcile_one(THUONG)
    check("lô thường xếp đủ 10/10 -> 'Đủ' (hồi quy)",
          WROTE[THUONG]["custom_trang_thai_xep"] == "Đủ")

    # ── 6. Pool: cờ chế độ + thể tích thật ─────────────────────────────
    print("-" * 78)
    print("── 6. `get_pool` — cờ `nguyen_lo` và thể tích KHÔNG bị xoá về 0 ────")
    dp = importlib.import_module("vanchuyen.api.dieu_phoi")
    seed()
    import frappe as _fr

    pool_rows = [
        _D(name=LO, customer_name="Trạm dừng nghỉ", shipping_address=None,
           posting_date="2026-09-05", tinh="Hải Phòng", po="PO1",
           tong_kien=0, hop_le=89, the_tich_lo_cm3=2_500_000, gui_xe=0,
           ghi_chu_npp=None, ghi_chu_giao=None),
        _D(name=THUONG, customer_name="NPP A", shipping_address=None,
           posting_date="2026-09-05", tinh="Phú Thọ", po="PO2",
           tong_kien=10, hop_le=3, the_tich_lo_cm3=5_000_000, gui_xe=0,
           ghi_chu_npp=None, ghi_chu_giao=None),
    ]
    real_sql = _fr.db.sql

    def pool_sql(query, values=None, **k):
        q = " ".join(str(query).split())
        if q.startswith("SELECT COUNT(*) FROM `tabSales Invoice`"):
            return [[len(pool_rows)]]
        if "FROM `tabSales Invoice` si" in q and "LIMIT" in q:
            return list(pool_rows)
        return real_sql(query, values, **k)

    _fr.db.sql = pool_sql
    dp.require_dieu_phoi = lambda *a, **k: None
    res = dp.get_pool()
    _fr.db.sql = real_sql
    by = {r["name"]: r for r in res["rows"]}
    check("lô hộp lẻ được đánh dấu `nguyen_lo`", by[LO]["nguyen_lo"] == 1)
    check("và trả THỂ TÍCH THẬT 2.5 m³, không phải 0", by[LO]["the_tich_con_lai"] == 2.5,
          str(by[LO]["the_tich_con_lai"]))
    check("lô thường KHÔNG bị đánh dấu", by[THUONG]["nguyen_lo"] == 0)
    check("và giữ nguyên pro-rata 5 m³ (hồi quy)", by[THUONG]["the_tich_con_lai"] == 5.0)

    # ── 7. Màn hình: bốn tầng chặn cũ đã mở đúng chỗ ───────────────────
    print("-" * 78)
    print("── 7. `xep-chuyen.js` — nút mở, và không mở nhầm cho lô thường ─────")
    js = open(os.path.join(REPO, "vanchuyen/public/vanchuyen/views/xep-chuyen.js"),
              encoding="utf-8").read()

    def body(name):
        i = js.index(f"function {name}(")
        depth, j, started = 0, i, False
        while j < len(js):
            if js[j] == "{":
                depth += 1
                started = True
            elif js[j] == "}":
                depth -= 1
                if started and depth == 0:
                    return js[i:j + 1]
            j += 1
        return js[i:]

    # Đọc CHÍNH biểu thức, không quét cả thân hàm: chú thích ngay trên nó cũng
    # chứa những chữ này, nên `"nguyen_lo" in body` sẽ xanh cả khi code đã hỏng.
    pc = body("poolCard")
    m = re.search(r"const canAdd = ([^\n;]+)", pc)
    expr = m.group(1) if m else ""
    check("`canAdd` có nhánh cho lô nguyên", "nl ||" in expr or "nl||" in expr, expr[:70])
    check("và vẫn đòi `con_lai > 0` cho lô thường (không mở toang)",
          "con_lai" in expr and "> 0" in expr, expr[:70])
    check("lô nguyên đã bị chuyến khác giữ thì KHÔNG cho thêm", "giuOKhac" in expr)
    check("nút `Một phần` KHÔNG render cho lô nguyên",
          re.search(r"nl \?\s*\"\"\s*:.*vc-order-partial-btn", pc, re.S) is not None)
    af = body("addFull")
    check("`addFull` đẩy dòng 0 kiện cho lô nguyên",
          "mkRow(o, 0, o.the_tich_con_lai)" in af)
    check("và giữ nguyên chặn 'đã xếp đủ' cho lô thường (hồi quy)",
          "Đơn đã xếp đủ" in af)
    pr = body("proRata")
    check("`proRata` trả TRỌN thể tích cho lô nguyên",
          "if (row.nguyen_lo) return" in pr)
    op = body("openPartialDialog")
    check("`openPartialDialog` từ chối lô nguyên KÈM LÝ DO, không để ngõ cụt",
          "nguyenLo(o)" in op and "chỉ xếp được nguyên lô" in op)
    br = body("builderRow")
    check("dòng lô nguyên KHÔNG có ô nhập kiện (min=0.01 sẽ chặn giá trị 0)",
          "r.nguyen_lo" in br and 'min="0.01"' in br)
    ed = body("editDraft")
    check("nạp lại nháp giữ đúng chế độ", "nguyen_lo: Number(s.nguyen_lo)" in ed)
    st = body("saveTrip")
    # Đọc ĐÚNG câu BẬT LẠI (`= false`), không đếm cả thân hàm: câu TẮT ở đầu
    # hàm cũng chứa "#vc-cta-save", nên `count(...) >= 1` xanh cả khi câu bật
    # lại đã bị bẻ — đúng kiểu mục canh dối mà phép thử phá sinh ra để bắt.
    on = re.search(r'querySelectorAll\(([^)]*)\)\.forEach\(\(el\) => \(el\.disabled = false\)\)', st)
    check("bật lại ĐỦ 4 nút sau khi lưu lỗi (kể cả #vc-cta-save)",
          bool(on) and on.group(1).count("#vc-") == 4, (on.group(1) if on else "KHÔNG THẤY")[:70])

    # ── 8. CHẠY THẬT `poolCard` trong node — thấy đúng cái nút ─────────
    #
    # Bảy mục trên soi MÃ NGUỒN. Soi mã nguồn không bắt được một template
    # literal hỏng hay một nhánh tam phân lồng sai — thứ chỉ lộ khi HTML được
    # dựng thật. Mục này nạp chính `xep-chuyen.js` (thay import bằng bộ giả) rồi
    # gọi `poolCard` với ba ca: lô hộp lẻ · lô thường · lô đã bị chuyến khác giữ.
    print("-" * 78)
    print("── 8. Dựng thật `poolCard` — nút có bật đúng không ─────────────────")
    import json
    import subprocess
    import tempfile

    body_js = re.sub(r"^import .*?;\s*$", "", js, flags=re.M)
    harness = (
        "const call=async()=>({});const errText=(e)=>String(e);\n"
        "const skeleton=()=>'';const escapeHtml=(s)=>String(s==null?'':s);\n"
        "const formatQty=(n)=>String(Number(n)||0);const formatM3=(n)=>String(Number(n)||0);\n"
        "const formatDate=(s)=>String(s||'');const formatCurrency=(n)=>String(n);\n"
        "const showToast=()=>{};const showModal=()=>({querySelector:()=>({addEventListener(){}})});\n"
        "const closeModal=()=>{};const confirmDialog=async()=>true;\n"
        "const document={getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}};\n"
        "const window={};\n"
        + body_js
        + "\nconst LE={name:'SI-LE',khach_hang:'Trạm dừng nghỉ',con_lai:0,tong_kien:0,"
          "hop_le:89,the_tich_con_lai:2.5,nguyen_lo:1,dang_giu:0};\n"
          "const TH={name:'SI-10',khach_hang:'NPP A',con_lai:6,tong_kien:10,hop_le:3,"
          "the_tich_con_lai:3,nguyen_lo:0,dang_giu:0};\n"
          "const GIU={...LE,name:'SI-GIU',dang_giu:1};\n"
          "const HET={...TH,name:'SI-HET',con_lai:0};\n"
          "const TRONG={name:'SI-0',khach_hang:'ORION',con_lai:0,tong_kien:0,hop_le:0,"
          "the_tich_con_lai:0,nguyen_lo:1,dang_giu:0};\n"
          "console.log(JSON.stringify({le:poolCard(LE),th:poolCard(TH),giu:poolCard(GIU),"
          "het:poolCard(HET),trong:poolCard(TRONG)}));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(harness)
        tmp = f.name
    try:
        r = subprocess.run(["node", tmp], capture_output=True, text=True)
    finally:
        os.unlink(tmp)
    if r.returncode != 0:
        check("nạp và chạy được `poolCard`", False, (r.stderr or "").strip().splitlines()[-1][:90])
    else:
        html = json.loads(r.stdout)
        le, th, giu, het, trong = html["le"], html["th"], html["giu"], html["het"], html["trong"]
        check("LÔ HỘP LẺ: nút Thêm KHÔNG bị disabled — đúng triệu chứng đã báo",
              'data-add="SI-LE"' in le and "disabled" not in le)
        check("và nhãn nút nói đúng đơn vị (không phải 'Thêm hết (0 kiện)')",
              "Thêm cả lô (89 hộp lẻ)" in le, re.search(r"Thêm[^<]*", le).group(0)[:40])
        check("và KHÔNG hiện nút 'Một phần' (lô nguyên không tách được)",
              "vc-order-partial-btn" not in le)
        check("và hiện thể tích thật 2.5 m³, không phải 0", ">2.5 m³<" in le.replace("  ", " "),
              re.search(r"[\d.]+ m³", le).group(0))
        check("và KHÔNG còn câu 'còn 0/0 kiện' (câu đó nói dối)", "0/0 kiện" not in le)
        check("LÔ THƯỜNG: vẫn 'Thêm hết (6 kiện)' + nút Một phần (hồi quy)",
              "Thêm hết (6 kiện)" in th and "vc-order-partial-btn" in th and "disabled" not in th)
        check("LÔ THƯỜNG ĐÃ XẾP ĐỦ: nút vẫn disabled (hồi quy)",
              'data-add="SI-HET"' in het and "disabled" in het)
        check("LÔ NGUYÊN ĐANG Ở CHUYẾN KHÁC: không cho thêm, nói rõ vì sao",
              "disabled" in giu or ("đã nằm trên một chuyến khác" in giu and "data-add" not in giu))
        check("LÔ THIẾU DỮ LIỆU (0/0/0): xếp được NHƯNG cảnh báo không tính vào tải",
              "disabled" not in trong and "không tính vào tải xe" in trong)

    print("=" * 78)
    if ok_all:
        print("KẾT QUẢ: ĐẠT — lô chỉ có hộp lẻ xếp được, đi đúng một chuyến, "
              "mang đúng thể tích, và rời được pool sau khi giao.")
        return 0
    print("KẾT QUẢ: CÓ MỤC KHÔNG ĐẠT ❌")
    return 1


if __name__ == "__main__":
    sys.exit(main())
