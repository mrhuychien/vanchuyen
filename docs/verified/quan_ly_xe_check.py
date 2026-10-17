#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""quan_ly_xe_check — LỊCH XE phải nói ĐÚNG ngày, và Xếp chuyến chỉ còn xe tải.

════════════════════════════════════════════════════════════════════════════
NHỮNG CON BUG PHÉP KIỂM NÀY CANH
════════════════════════════════════════════════════════════════════════════

Màn Quản lý xe chỉ có giá trị khi nó KHÔNG nói "còn hạn" sai. Một lịch báo dư
một ngày là xe chạy lố hạn đăng kiểm đúng một ngày — phạt, có khi giữ xe — mà
màn hình vẫn xanh. Các cạm bẫy, mỗi cái một mục dưới đây:

  1. CỘNG THÁNG bằng `timedelta(days=30*n)`: "2 năm" là 730 hay 731 ngày tuỳ
     năm nhuận, 31/08 + 6 tháng không có ngày 31/02. Phải cộng tháng LỊCH, kẹp
     cuối tháng — và bản xem trước trong form (JS) phải ra CÙNG ngày với server.
  2. "TRỐNG = XE CON": xe tạo trước khi có `custom_loai_xe` mang NULL. Lọc bằng
     SQL `!= 'Xe con'` thì NULL rơi mất (so với NULL ra NULL) — toàn bộ đội xe
     cũ biến khỏi Xếp chuyến ngay sau deploy, đúng màn dùng hằng ngày.
  3. HẠN TÍNH THEO CHU KỲ CŨ NẰM LẠI: đổi chu kỳ 1 năm → 6 tháng mà hạn lưu
     không tính lại thì xe báo còn nửa năm trong khi đã quá hạn.
  4. NHẬP BÙ KÉO LÙI LỊCH: ghi một lần thay dầu năm ngoái không được đè mốc
     đang chạy; ngược lại XOÁ đúng bản ghi đang làm mốc thì lịch phải lùi về bản
     liền trước — xoá hết thì lịch TRỐNG, không giữ ngày của bản ghi đã xoá.
  5. HẾT HẠN HÔM NAY ≠ QUÁ HẠN: giấy còn giá trị tới hết ngày; km chạm mốc là
     đến hạn.
  6. FIELD BỊ BỎ QUA IM LẶNG: form gửi một field mà API không có trong danh sách
     cho sửa → người dùng gõ xong bấm lưu rồi mất.

Chạy KHÔNG CẦN BENCH: bộ giả frappe tối thiểu ở `_stub_frappe`; phần JS chạy
thật bằng node (bỏ dòng import, thay bằng bộ giả).
    python3 docs/verified/quan_ly_xe_check.py   # exit 0 = đạt
"""

import datetime
import importlib
import json
import os
import re
import subprocess
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
HOM_NAY = "2026-10-17"
D = datetime.date.fromisoformat

ok_all = True


def check(label, cond, detail=""):
    global ok_all
    print(("  ✅ " if cond else "  ❌ ") + label + (f"  ({detail})" if detail else ""))
    if not cond:
        ok_all = False
    return cond


# ════════════════════════════════════════════════════════════════════════════
# BỘ GIẢ FRAPPE + KHO DỮ LIỆU GIẢ (Vehicle + Nhat Ky Xe)
# ════════════════════════════════════════════════════════════════════════════
class _D(dict):
    __getattr__ = dict.get

    def __setattr__(self, k, v):
        self[k] = v


class Throw(Exception):
    pass


VEH = {}     # name -> field Vehicle
LOGS = {}    # name -> bản ghi Nhat Ky Xe (dict)
SEQ = [0]
META_CO_FIELD = [True]


def _reset():
    VEH.clear()
    LOGS.clear()
    SEQ[0] = 0
    META_CO_FIELD[0] = True


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

    def get_all(dt, filters=None, fields=None, order_by=None, limit=None, **k):
        if dt == "Vehicle":
            rows = [_D(dict(v, name=n)) for n, v in sorted(VEH.items())]
            return [_D({f: r.get(f) for f in (fields or ["name"])}) for r in rows]
        if dt == "Nhat Ky Xe":
            rows = []
            for n, r in LOGS.items():
                ok = True
                for key, val in (filters or {}).items():
                    if isinstance(val, list) and val[0] == "!=":
                        ok = ok and (n if key == "name" else r.get(key)) != val[1]
                    else:
                        ok = ok and r.get(key) == val
                if ok:
                    rows.append(_D(dict(r, name=n)))
            # "ngay desc, creation desc"
            rows.sort(key=lambda r: (r["ngay"], r["creation"]), reverse=True)
            if limit:
                rows = rows[:limit]
            return [_D({f: r.get(f) for f in (fields or ["name"])}) for r in rows]
        return []

    fr.get_all = get_all

    class _Meta:
        def has_field(self, f):
            return META_CO_FIELD[0]

    fr.get_meta = lambda dt: _Meta()

    class _DB:
        def get_value(self, dt, name=None, fields=None, **k):
            if dt != "Vehicle":
                return None
            row = VEH.get(name)
            if row is None:
                return None
            if isinstance(fields, (list, tuple)):
                d = _D({f: row.get(f) for f in fields})
                return d if k.get("as_dict") else [row.get(f) for f in fields]
            return row.get(fields)

        def set_value(self, dt, name, values, val=None, **k):
            if dt == "Vehicle":
                VEH.setdefault(name, {}).update(values if isinstance(values, dict) else {values: val})

        def exists(self, *a, **k):
            return True

        def sql(self, *a, **k):
            return []

    fr.db = _DB()
    sys.modules["frappe"] = fr

    fu = types.ModuleType("frappe.utils")
    fu.flt = lambda v, p=None: float(v or 0)
    fu.cint = lambda v: int(float(v or 0))
    fu.nowdate = lambda: HOM_NAY
    fu.now = lambda: HOM_NAY + " 08:00:00"

    def getdate(v=None):
        if not v:
            return D(HOM_NAY)
        if isinstance(v, datetime.date):
            return v
        s = str(v)
        if re.match(r"^\d{2}-\d{2}-\d{4}$", s):   # dd-mm-yyyy
            return datetime.date(int(s[6:]), int(s[3:5]), int(s[:2]))
        raise ValueError("ngày không hợp lệ: " + s)

    fu.getdate = getdate
    sys.modules["frappe.utils"] = fu
    fr.utils = fu

    fm = types.ModuleType("frappe.model")
    fmd = types.ModuleType("frappe.model.document")

    class Document:
        def get(self, k, d=None):
            return getattr(self, k, d)

        def get_doc_before_save(self):
            return getattr(self, "_before", None)

    fmd.Document = Document
    sys.modules["frappe.model"] = fm
    sys.modules["frappe.model.document"] = fmd
    return fr


# ── Vòng đời bản ghi giả: insert / save / delete gọi đúng hook như Frappe ───
FIELDS = ("xe", "loai", "ngay", "so_km", "han_tiep", "km_tiep", "chi_phi")


def _doc(nk, data, name):
    doc = nk.NhatKyXe()
    doc.name = name
    for f in FIELDS:
        setattr(doc, f, data.get(f))
    return doc


def _luu(doc):
    LOGS[doc.name] = {f: (nk_d(getattr(doc, f)) if f in ("ngay", "han_tiep") else getattr(doc, f))
                      for f in FIELDS}
    LOGS[doc.name]["creation"] = LOGS.get(doc.name, {}).get("creation") or SEQ[0]


def nk_d(v):
    return NK._d(v)


def them(xe, loai, ngay, so_km=0, han_tiep=None, km_tiep=0):
    SEQ[0] += 1
    name = f"NKX-{SEQ[0]:04d}"
    doc = _doc(NK, {"xe": xe, "loai": loai, "ngay": ngay, "so_km": so_km,
                    "han_tiep": han_tiep, "km_tiep": km_tiep, "chi_phi": 0}, name)
    doc._before = None
    doc.validate()
    _luu(doc)
    LOGS[name]["creation"] = SEQ[0]
    doc.on_update()
    return name


def sua(name, **changes):
    before = _D(dict(LOGS[name], name=name))
    doc = _doc(NK, dict(LOGS[name], **changes), name)
    doc._before = before
    doc.validate()
    _luu(doc)
    doc.on_update()


def xoa(name):
    _doc(NK, LOGS[name], name).on_trash()
    del LOGS[name]


def throws(fn, *a, **k):
    try:
        fn(*a, **k)
        return None
    except Throw as e:
        return str(e) or "throw"


def run_node(src_rel, stubs, test_code):
    js = open(os.path.join(REPO, src_rel), encoding="utf-8").read()
    body = re.sub(r"^import .*?;\s*$", "", js, flags=re.M)
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(stubs + "\n" + body + "\n" + test_code)
        tmp = f.name
    try:
        r = subprocess.run(["node", tmp], capture_output=True, text=True)
    finally:
        os.unlink(tmp)
    if r.returncode != 0:
        return None, (r.stderr or "").strip().splitlines()[-1][:120]
    return json.loads(r.stdout), None


JS_STUBS = (
    "const call=async()=>({});const upload=async()=>({});const errText=(e)=>String(e);\n"
    "const skeleton=()=>'';const escapeHtml=(s)=>String(s==null?'':s);\n"
    "const formatNumber=(n)=>String(Number(n)||0);const formatQty=(n)=>String(Number(n)||0);\n"
    "const formatM3=(n)=>String(Number(n)||0);const formatCurrency=(n)=>String(n)+' đ';\n"
    "const formatDate=(s)=>String(s||'');const go=()=>{};\n"
    "const showToast=()=>{};const showModal=()=>null;const closeModal=()=>{};const confirmDialog=()=>{};\n"
    "const document={getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}};\n"
    "const window={};\n"
)


def main():
    global NK
    _stub_frappe()
    sys.path.insert(0, REPO)
    NK = importlib.import_module("vanchuyen.van_chuyen.doctype.nhat_ky_xe.nhat_ky_xe")
    nk = NK

    print("=" * 78)
    print("quan_ly_xe_check — lịch đăng kiểm / thay dầu nói đúng, Xếp chuyến chỉ xe tải")
    print("=" * 78)

    # ── 1. Cộng tháng LỊCH ─────────────────────────────────────────────
    print("-" * 78)
    print("── 1. `cong_thang` — tháng lịch, kẹp cuối tháng, năm nhuận ─────────")
    cases = [("2026-03-15", 12, "2027-03-15"), ("2026-08-31", 6, "2027-02-28"),
             ("2027-08-31", 6, "2028-02-29"), ("2028-02-29", 12, "2029-02-28"),
             ("2026-03-15", 24, "2028-03-15"), ("2026-12-31", 2, "2027-02-28"),
             ("2026-01-31", 1, "2026-02-28")]
    for src, n, want in cases:
        got = nk.cong_thang(D(src), n)
        check(f"{src} + {n} tháng = {want}", got == D(want), str(got))
    check("ngày trống → None (không ném lỗi)", nk.cong_thang(None, 6) is None)
    out, err = run_node(
        "vanchuyen/public/vanchuyen/views/quan-ly-xe.js", JS_STUBS,
        "console.log(JSON.stringify(%s.map(([s,n])=>congThang(s,n))));" % json.dumps([[c[0], c[1]] for c in cases]))
    if err:
        check("nạp được `congThang` (JS, bản xem trước trong form)", False, err)
    else:
        check("bản xem trước JS ra ĐÚNG ngày server tính, đủ 7 ca",
              out == [c[2] for c in cases], f"JS={out}")

    # ── 2. Mức cảnh báo + nhãn ─────────────────────────────────────────
    print("-" * 78)
    print("── 2. `muc_canh_bao` / `nhan_muc` — hôm nay chưa quá hạn, km chạm mốc là đến ")
    check("hết hạn HÔM NAY → 'sap_den' (giấy còn giá trị tới hết ngày)",
          nk.muc_canh_bao(con_ngay=0) == "sap_den")
    check("hôm qua → 'qua_han'", nk.muc_canh_bao(con_ngay=-1) == "qua_han")
    check("còn 30 ngày, ngưỡng 30 → 'sap_den'; còn 31 → 'ok'",
          nk.muc_canh_bao(30, nguong_ngay=30) == "sap_den" and nk.muc_canh_bao(31, nguong_ngay=30) == "ok")
    check("km chạm mốc (còn 0) → 'qua_han'", nk.muc_canh_bao(con_km=0) == "qua_han")
    check("còn 500 km → 'sap_den'; 501 → 'ok'",
          nk.muc_canh_bao(con_km=500) == "sap_den" and nk.muc_canh_bao(con_km=501) == "ok")
    check("mốc nào gấp hơn tính mốc đó: còn 200 ngày nhưng quá 1 km → 'qua_han'",
          nk.muc_canh_bao(200, -1) == "qua_han")
    t = nk.nhan_muc(107, -320)
    check("nhãn: phần QUÁ HẠN đứng trước", t == "Quá 320 km · còn 107 ngày", t)
    t = nk.nhan_muc(107, 1550)
    check("nhãn: không lặp chữ 'còn', số có dấu chấm ngăn nghìn", t == "Còn 1.550 km · 107 ngày", t)
    check("nhãn hôm nay", nk.nhan_muc(0) == "Đến hạn hôm nay", nk.nhan_muc(0))

    # ── 3. Lịch của xe ─────────────────────────────────────────────────
    print("-" * 78)
    print("── 3. `lich_cua_xe` — đăng kiểm theo chu kỳ, thay dầu theo km/tháng ─")
    L = nk.lich_cua_xe({"custom_chu_ky_dang_kiem": "1 năm", "custom_ngay_dang_kiem": "2025-10-20"}, HOM_NAY)
    check("1 năm từ 20/10/2025 → hạn 20/10/2026, còn 3 ngày → 'sap_den'",
          L["dang_kiem"]["han"] == "2026-10-20" and L["dang_kiem"]["con_ngay"] == 3
          and L["dang_kiem"]["muc"] == "sap_den", json.dumps(L["dang_kiem"], ensure_ascii=False)[:90])
    L = nk.lich_cua_xe({"custom_chu_ky_dang_kiem": "6 tháng", "custom_ngay_dang_kiem": "2026-01-10",
                        "custom_han_dang_kiem": "2030-01-01"}, HOM_NAY)
    check("chu kỳ cố định: BỎ QUA hạn lưu cũ (2030), tính lại = 10/07/2026 → quá hạn",
          L["dang_kiem"]["han"] == "2026-07-10" and L["dang_kiem"]["muc"] == "qua_han", L["dang_kiem"]["han"])
    L = nk.lich_cua_xe({"custom_chu_ky_dang_kiem": "Ngày cụ thể", "custom_han_dang_kiem": "2026-10-16"}, HOM_NAY)
    check("'Ngày cụ thể' dùng đúng hạn nhập tay (16/10) → quá hạn 1 ngày",
          L["dang_kiem"]["muc"] == "qua_han" and L["dang_kiem"]["nhan"] == "Quá hạn 1 ngày", L["dang_kiem"]["nhan"])
    check("chưa chọn chu kỳ → 'chua_cai'", nk.lich_cua_xe({}, HOM_NAY)["dang_kiem"]["muc"] == "chua_cai")
    check("có chu kỳ, chưa có ngày gần nhất → 'chua_co' (KHÔNG báo 'còn hạn')",
          nk.lich_cua_xe({"custom_chu_ky_dang_kiem": "2 năm"}, HOM_NAY)["dang_kiem"]["muc"] == "chua_co")
    V = {"last_odometer": 125200, "custom_thay_dau_moi_km": 5000, "custom_thay_dau_moi_thang": 6,
         "custom_ngay_thay_dau": "2026-08-01", "custom_km_thay_dau": 120000}
    td = nk.lich_cua_xe(V, HOM_NAY)["thay_dau"]
    check("thay dầu: mốc km 125.000 đã qua 200 km dù mốc tháng còn xa → 'qua_han'",
          td["km_tiep"] == 125000 and td["con_km"] == -200 and td["muc"] == "qua_han", td["nhan"])
    check("và lần tới theo tháng = 01/02/2027", td["han"] == "2027-02-01", td["han"])
    td = nk.lich_cua_xe(dict(V, last_odometer=0), HOM_NAY)["thay_dau"]
    check("chưa biết km hiện tại → chỉ tính theo tháng, không bịa số km",
          td["con_km"] is None and td["con_ngay"] == 107 and td["muc"] == "ok", td["nhan"])
    check("chưa cài chu kỳ thay dầu → 'chua_cai'",
          nk.lich_cua_xe({"custom_ngay_thay_dau": "2026-08-01"}, HOM_NAY)["thay_dau"]["muc"] == "chua_cai")
    bd = nk.lich_cua_xe({"last_odometer": 129800}, HOM_NAY,
                        {"ngay": "2026-06-01", "han_tiep": "2026-12-01", "km_tiep": 130000})["bao_duong"]
    check("bảo dưỡng: hẹn 130.000 km, đang 129.800 → còn 200 km → 'sap_den'",
          bd["con_km"] == 200 and bd["muc"] == "sap_den", bd["nhan"])
    bd = nk.lich_cua_xe({}, HOM_NAY, {"ngay": "2026-06-01"})["bao_duong"]
    check("bảo dưỡng không hẹn gì → không có mục cảnh báo (muc None)", bd["muc"] is None)

    # ── 4. Xếp chuyến chỉ còn xe tải ───────────────────────────────────
    print("-" * 78)
    print("── 4. `dieu_phoi.get_vehicles` — xe con ẩn, xe CŨ (loại trống) vẫn còn ─")
    _reset()
    VEH["29C-OLD"] = {"custom_loai_xe": None, "custom_the_tich_kha_dung": 12}
    VEH["29C-EMPTY"] = {"custom_loai_xe": "", "custom_the_tich_kha_dung": 9}
    VEH["29C-TAI"] = {"custom_loai_xe": "Xe tải", "custom_the_tich_kha_dung": 15,
                      "custom_chu_ky_dang_kiem": "Ngày cụ thể", "custom_han_dang_kiem": "2026-10-10"}
    VEH["30A-CON"] = {"custom_loai_xe": "Xe con"}
    dp = importlib.import_module("vanchuyen.api.dieu_phoi")
    dp.require_dieu_phoi = lambda *a, **k: None
    res = dp.get_vehicles()
    names = [r["name"] for r in res]
    check("xe con KHÔNG có trong danh sách", "30A-CON" not in names, str(names))
    check("xe tạo trước khi có trường loại xe (NULL) VẪN còn", "29C-OLD" in names, str(names))
    check("xe loại '' vẫn còn", "29C-EMPTY" in names)
    by = {r["name"]: r for r in res}
    check("thể tích khả dụng vẫn trả về (thanh tải không vỡ)", by["29C-OLD"]["custom_the_tich_kha_dung"] == 12)
    check("xe tải quá hạn đăng kiểm mang cảnh báo 'ĐK quá hạn'",
          [w["text"] for w in by["29C-TAI"]["canh_bao"]] == ["ĐK quá hạn"], str(by["29C-TAI"]["canh_bao"]))
    check("xe không có lịch → không cảnh báo gì (màn không rối thêm)", by["29C-OLD"]["canh_bao"] == [])
    META_CO_FIELD[0] = False
    try:
        old = dp.get_vehicles()
        check("chạy TRƯỚC `bench migrate` (chưa có field): không sập, trả đủ xe như cũ",
              len(old) == 4, str(len(old)))
    except Exception as e:  # noqa: BLE001
        check("chạy TRƯỚC `bench migrate` (chưa có field): không sập", False, repr(e)[:80])
    META_CO_FIELD[0] = True
    cb = nk.canh_bao_xep_chuyen
    check("ĐK còn 5 ngày → 'ĐK còn 5 ngày'",
          [w["text"] for w in cb({"dang_kiem": {"muc": "sap_den", "con_ngay": 5}})] == ["ĐK còn 5 ngày"])
    check("ĐK còn 20 ngày → KHÔNG nói ở Xếp chuyến (chưa gấp)",
          cb({"dang_kiem": {"muc": "sap_den", "con_ngay": 20}}) == [])
    check("quá hạn thay dầu → nói", [w["text"] for w in cb({"thay_dau": {"muc": "qua_han"}})] == ["Quá hạn thay dầu"])

    # ── 5. Đồng bộ lịch từ nhật ký ─────────────────────────────────────
    print("-" * 78)
    print("── 5. Nhật ký → lịch xe: tiến khi mới, lùi khi xoá mốc, trống khi hết ─")
    _reset()
    VEH["XE1"] = {"custom_chu_ky_dang_kiem": "1 năm", "last_odometer": 0}
    a = them("XE1", "Đăng kiểm", "2025-03-15")
    check("ghi đăng kiểm 15/03/2025 → lịch: gần nhất 15/03/2025, hạn 15/03/2026",
          VEH["XE1"].get("custom_ngay_dang_kiem") == D("2025-03-15")
          and VEH["XE1"].get("custom_han_dang_kiem") == D("2026-03-15"), str(VEH["XE1"].get("custom_han_dang_kiem")))
    check("và bản ghi lưu luôn hạn nó lập ra (lịch sử)", LOGS[a]["han_tiep"] == D("2026-03-15"))
    b = them("XE1", "Đăng kiểm", "2026-03-10")
    check("lần mới hơn 10/03/2026 → lịch tiến: hạn 10/03/2027",
          VEH["XE1"]["custom_han_dang_kiem"] == D("2027-03-10"), str(VEH["XE1"]["custom_han_dang_kiem"]))
    c = them("XE1", "Đăng kiểm", "2024-03-01")
    check("NHẬP BÙ lần cũ 01/03/2024 → lịch KHÔNG lùi",
          VEH["XE1"]["custom_ngay_dang_kiem"] == D("2026-03-10"), str(VEH["XE1"]["custom_ngay_dang_kiem"]))
    xoa(c)
    check("xoá bản ghi KHÔNG làm mốc → lịch giữ nguyên", VEH["XE1"]["custom_ngay_dang_kiem"] == D("2026-03-10"))
    xoa(b)
    check("xoá ĐÚNG bản ghi đang làm mốc → lịch lùi về lần liền trước (15/03/2025)",
          VEH["XE1"]["custom_ngay_dang_kiem"] == D("2025-03-15")
          and VEH["XE1"]["custom_han_dang_kiem"] == D("2026-03-15"), str(VEH["XE1"]["custom_ngay_dang_kiem"]))
    xoa(a)
    check("xoá nốt bản ghi cuối → lịch TRỐNG, không giữ ngày của bản đã xoá",
          VEH["XE1"]["custom_ngay_dang_kiem"] is None and VEH["XE1"]["custom_han_dang_kiem"] is None,
          str(VEH["XE1"].get("custom_ngay_dang_kiem")))

    VEH["XE1"]["custom_ngay_dang_kiem"] = D("2026-05-01")   # khai tay ở "Cài lịch"
    them("XE1", "Đăng kiểm", "2026-04-01")
    check("mốc khai tay 01/05 KHÔNG bị bản ghi cũ hơn (01/04) đè",
          VEH["XE1"]["custom_ngay_dang_kiem"] == D("2026-05-01"))

    _reset()
    VEH["XE2"] = {"custom_chu_ky_dang_kiem": "6 tháng"}
    e1 = them("XE2", "Đăng kiểm", "2026-01-10")
    e2 = them("XE2", "Đăng kiểm", "2026-06-10")
    sua(e2, ngay="2025-12-01")
    check("SỬA lùi ngày bản ghi mốc ra sau một bản khác → lịch theo bản mới nhất còn lại (10/01)",
          VEH["XE2"]["custom_ngay_dang_kiem"] == D("2026-01-10")
          and VEH["XE2"]["custom_han_dang_kiem"] == D("2026-07-10"), str(VEH["XE2"]["custom_ngay_dang_kiem"]))
    sua(e1, chi_phi=340000)
    check("sửa chi phí (không đụng ngày/km) → lịch không đổi", VEH["XE2"]["custom_ngay_dang_kiem"] == D("2026-01-10"))

    _reset()
    VEH["XE3"] = {"custom_chu_ky_dang_kiem": "Ngày cụ thể"}
    m = throws(them, "XE3", "Đăng kiểm", "2026-10-01")
    check("'Ngày cụ thể' mà không nhập hạn mới → chặn, nói rõ cần gì",
          bool(m) and "hạn đăng kiểm mới" in m, (m or "LỌT")[:70])
    them("XE3", "Đăng kiểm", "2026-10-01", han_tiep="2027-05-20")
    check("'Ngày cụ thể' → hạn xe = đúng ngày ghi trên giấy (20/05/2027)",
          VEH["XE3"]["custom_han_dang_kiem"] == D("2027-05-20"))
    m = throws(them, "XE3", "Đăng kiểm", "2026-10-02", han_tiep="2026-10-02")
    check("hạn mới không sau ngày đăng kiểm → chặn", bool(m), (m or "LỌT")[:60])
    m = throws(them, "XE3", "Sửa chữa", "2026-10-18")
    check("ngày thực hiện ở TƯƠNG LAI → chặn", bool(m) and "tương lai" in m, (m or "LỌT")[:60])
    VEH["XE4"] = {}
    m = throws(them, "XE4", "Đăng kiểm", "2026-10-01")
    check("xe chưa chọn chu kỳ, không nhập hạn → chặn kèm hướng dẫn chọn chu kỳ",
          bool(m) and "chu kỳ" in m, (m or "LỌT")[:70])

    _reset()
    VEH["XE5"] = {"custom_thay_dau_moi_km": 5000, "last_odometer": 100000}
    t1 = them("XE5", "Thay dầu", "2026-08-01", so_km=120000, han_tiep="2027-01-01", km_tiep=999)
    check("thay dầu → lịch: ngày + km lần thay gần nhất",
          VEH["XE5"]["custom_ngay_thay_dau"] == D("2026-08-01") and VEH["XE5"]["custom_km_thay_dau"] == 120000)
    check("km lúc thay lớn hơn đồng hồ đang lưu → đồng hồ tự tiến lên 120.000",
          VEH["XE5"]["last_odometer"] == 120000, str(VEH["XE5"]["last_odometer"]))
    check("ô hẹn gõ tay ở bản ghi thay dầu bị xoá (lần tới tính từ chu kỳ XE, không ai nhắc ô này)",
          LOGS[t1]["han_tiep"] is None and not LOGS[t1]["km_tiep"])
    them("XE5", "Thay dầu", "2026-09-01", so_km=110000)
    check("đồng hồ KHÔNG lùi khi bản ghi sau có km nhỏ hơn (gõ nhầm)", VEH["XE5"]["last_odometer"] == 120000)
    m = throws(them, "XE5", "Bảo dưỡng", "2026-09-01", so_km=120000, km_tiep=119000)
    check("bảo dưỡng: hẹn km nhỏ hơn km lúc làm → chặn", bool(m), (m or "LỌT")[:60])
    # Ca riêng cho SỬA NGÀY mà không đổi gì khác: ở đăng kiểm, đổi ngày kéo theo đổi
    # hạn nên đồng bộ vẫn chạy dù bỏ sót "ngay" — thay dầu không có hạn lưu trên bản
    # ghi, nên đây mới là ca lộ ra nếu on_update quên theo dõi ngày.
    _reset()
    VEH["XE6"] = {"custom_thay_dau_moi_km": 5000}
    them("XE6", "Thay dầu", "2026-01-10", so_km=100000)
    t2 = them("XE6", "Thay dầu", "2026-06-10", so_km=100000)
    sua(t2, ngay="2025-12-01")
    check("SỬA lùi ngày bản thay dầu mốc (km giữ nguyên) → lịch theo bản còn lại (10/01)",
          VEH["XE6"]["custom_ngay_thay_dau"] == D("2026-01-10"), str(VEH["XE6"]["custom_ngay_thay_dau"]))

    # ── 6. doc_events Vehicle.validate ─────────────────────────────────
    print("-" * 78)
    print("── 6. `vehicle_validate` — sửa trên Desk vẫn đúng hạn, và KHÔNG chặn ai ─")

    class FakeVehicle:
        meta = types.SimpleNamespace(has_field=lambda f: True)

        def __init__(self, **kw):
            self.__dict__.update(kw)

        def get(self, k, d=None):
            return self.__dict__.get(k, d)

    v = FakeVehicle(custom_chu_ky_dang_kiem="2 năm", custom_ngay_dang_kiem="2026-01-31", custom_han_dang_kiem="2026-02-01")
    nk.vehicle_validate(v)
    check("đổi chu kỳ trên Desk → hạn TÍNH LẠI = 31/01/2028 (không giữ hạn theo chu kỳ cũ)",
          v.custom_han_dang_kiem == D("2028-01-31"), str(v.custom_han_dang_kiem))
    v = FakeVehicle(custom_chu_ky_dang_kiem="Ngày cụ thể", custom_ngay_dang_kiem=None, custom_han_dang_kiem="2027-06-30")
    nk.vehicle_validate(v)
    check("'Ngày cụ thể' → giữ hạn nhập tay", v.custom_han_dang_kiem == D("2027-06-30"))
    v = FakeVehicle(custom_chu_ky_dang_kiem="1 năm", custom_ngay_dang_kiem="ngày-rác", custom_han_dang_kiem=None)
    try:
        nk.vehicle_validate(v)
        check("ngày rác KHÔNG làm hỏng việc lưu Vehicle của app khác (không ném lỗi)", True)
    except Exception as e:  # noqa: BLE001
        check("ngày rác KHÔNG làm hỏng việc lưu Vehicle của app khác (không ném lỗi)", False, repr(e)[:70])

    # ── 7. Field form gửi ↔ field API nhận ─────────────────────────────
    print("-" * 78)
    print("── 7. Form ghi nhận gửi field nào thì API phải NHẬN field đó ─────────")
    api_src = open(os.path.join(REPO, "vanchuyen/api/quan_ly_xe.py"), encoding="utf-8").read()
    upd = re.search(r"_LOG_UPDATABLE = \(([^)]*)\)", api_src)
    nhan = set(re.findall(r'"(\w+)"', upd.group(1))) if upd else set()
    nhan |= {"xe", "loai", "chu_ky", "moi_km", "moi_thang"}   # định danh + cấu hình lịch (_ap_cau_hinh)
    js = open(os.path.join(REPO, "vanchuyen/public/vanchuyen/views/quan-ly-xe.js"), encoding="utf-8").read()
    i = js.index("function openGhiNhan(")
    form = js[i:js.index("function xoaLog(", i)]
    gui = set(re.findall(r"payload\.(\w+)\s*=", form))
    gui |= set(re.findall(r"^\s*(\w+):", form[form.index("const payload = {"):form.index("};", form.index("const payload = {"))], re.M))
    thieu = sorted(gui - nhan)
    check("mọi field form gửi đều có trong _LOG_UPDATABLE / cấu hình lịch (không mất im lặng)",
          bool(gui) and not thieu, f"gửi={sorted(gui)} · thiếu={thieu}")

    # ── 8. Màn hình chạy thật trong node ───────────────────────────────
    print("-" * 78)
    print("── 8. Dựng thật thẻ xe + nút chọn xe — đúng cái người dùng nhìn thấy ─")
    xe_qua = {"name": "29C-111.11", "loai_xe": "Xe tải", "make": "Hyundai", "model": "HD72", "the_tich": 12, "km": 125200,
              "km_cu_ngay": 2, "chi_phi_nam": 0,
              "dang_kiem": {"muc": "qua_han", "nhan": "Quá hạn 3 ngày", "han": "2026-10-14", "con_ngay": -3, "con_km": None},
              "thay_dau": {"muc": "ok", "nhan": "Còn 1.550 km", "con_ngay": None, "con_km": 1550},
              "bao_duong": None}
    xe_sap = dict(xe_qua, name="29C-222.22",
                  dang_kiem={"muc": "sap_den", "nhan": "Còn 5 ngày", "han": "2026-10-22", "con_ngay": 5, "con_km": None})
    xe_con = dict(xe_qua, name="30A-333.33", loai_xe="Xe con",
                  dang_kiem={"muc": "ok", "nhan": "Còn 200 ngày", "han": "2027-05-05", "con_ngay": 200, "con_km": None})
    out, err = run_node(
        "vanchuyen/public/vanchuyen/views/quan-ly-xe.js", JS_STUBS,
        "const XS=%s;console.log(JSON.stringify({card:xeCard(XS[0]),con:xeCard(XS[2]),"
        "viec:canChuY([XS[2],XS[1],XS[0]]).map(v=>v.xe+'|'+v.hang_muc+'|'+v.muc),"
        "doc:logCard({name:'N1',loai:'Sửa chữa',ngay:'2026-10-01',dinh_kem:'javascript:alert(1)'}),"
        "anh:logCard({name:'N2',loai:'Sửa chữa',ngay:'2026-10-01',dinh_kem:'/files/a.jpg'})}));"
        % json.dumps([xe_qua, xe_sap, xe_con], ensure_ascii=False))
    if err:
        check("nạp và chạy được `xeCard` / `canChuY`", False, err)
    else:
        check("thẻ xe quá hạn: viền đỏ (class qua_han) + chữ 'Quá hạn 3 ngày'",
              "vc-xe-card qua_han" in out["card"] and "Quá hạn 3 ngày" in out["card"])
        check("thẻ xe con mang nhãn 'Xe con', không hiện thể tích",
              "Xe con" in out["con"] and "m³" not in out["con"])
        check("ảnh đính kèm `javascript:` KHÔNG thành link/ảnh (sửa được trên Desk → XSS khi bấm)",
              "javascript:" not in out["doc"] and "<img" not in out["doc"])
        check("ảnh /files/… vẫn hiện bình thường", 'src="/files/a.jpg"' in out["anh"])
        check("'Cần chú ý': việc QUÁ HẠN lên đầu, xe ổn không có mặt",
              out["viec"] == ["29C-111.11|Đăng kiểm|qua_han", "29C-222.22|Đăng kiểm|sap_den"], str(out["viec"]))
    out, err = run_node(
        "vanchuyen/public/vanchuyen/views/xep-chuyen.js", JS_STUBS,
        "const L=[{name:'A',custom_the_tich_kha_dung:10}];"
        "console.log(JSON.stringify({them:withDraftVehicle(L,'B',7).map(v=>v.name),"
        "giu:withDraftVehicle(L,'A',10).length,warn:vehicleWarn({canh_bao:[{muc:'qua_han',text:'ĐK quá hạn'},"
        "{muc:'qua_han',text:'Quá hạn thay dầu'}]}),khong:vehicleWarn({})}));")
    if err:
        check("nạp và chạy được `withDraftVehicle` / `vehicleWarn`", False, err)
    else:
        check("nháp mang xe nay KHÔNG còn trong DS xe tải → vẫn hiện để thấy xe đang chọn",
              out["them"] == ["A", "B"], str(out["them"]))
        check("xe đã có trong DS → không nhân đôi", out["giu"] == 1)
        check("nút chọn xe: hiện cảnh báo đầu + '+1', đủ cả trong tooltip",
              "⚠ ĐK quá hạn +1" in out["warn"] and "Quá hạn thay dầu" in out["warn"], out["warn"][:90])
        check("xe không cảnh báo → không chèn gì", out["khong"] == "")
    # Hai hàm trên chạy đúng chưa đủ — phải được GỌI ở đúng chỗ. Soi chính câu gọi
    # (không quét cả file: chú thích đầu file cũng chứa tên hàm, sẽ xanh cả khi hỏng).
    xjs = open(os.path.join(REPO, "vanchuyen/public/vanchuyen/views/xep-chuyen.js"), encoding="utf-8").read()
    ed = xjs[xjs.index("async function editDraft("):xjs.index("async function openAdjust(")]
    check("`editDraft` THẬT SỰ chèn lại xe của nháp",
          "S.vehicles = withDraftVehicle(S.vehicles, doc.xe" in ed)
    db = xjs[xjs.index("function drawBuilder("):xjs.index("function updateCta(")]
    check("nút chọn xe ở builder THẬT SỰ gắn cảnh báo", "${vehicleWarn(v)}" in db)

    # ── 9. Shell: route + build marker ─────────────────────────────────
    print("-" * 78)
    print("── 9. Route mới có trong shell, và BUILD khớp SHELL_BUILD (Luật vàng #2) ")
    shell = open(os.path.join(REPO, "vanchuyen/public/vanchuyen/shell.js"), encoding="utf-8").read()
    vcpy = open(os.path.join(REPO, "vanchuyen/www/vc.py"), encoding="utf-8").read()
    b1 = re.search(r'const BUILD = "([^"]+)"', shell)
    b2 = re.search(r'SHELL_BUILD = "([^"]+)"', vcpy)
    check("BUILD (shell.js) == SHELL_BUILD (vc.py) — lệch là mọi người thấy banner 'bản cũ'",
          bool(b1 and b2) and b1.group(1) == b2.group(1), f"{b1 and b1.group(1)} vs {b2 and b2.group(1)}")
    check("có route #/quan-ly-xe và #/quan-ly-xe/:id",
          'path: "/quan-ly-xe"' in shell and 'path: "/quan-ly-xe/:id"' in shell)
    r = re.search(r'path: "/quan-ly-xe",[^}]*roles: \[([^\]]*)\]', shell)
    roles = set(re.findall(r'"(\w+)"', r.group(1))) if r else set()
    check("nav mở cho đúng 3 nhóm server cho phép (tổ trưởng / điều hành / admin), KHÔNG cho lái xe",
          roles == {"dieu_phoi", "dieu_hanh", "admin"}, str(sorted(roles)))

    print("=" * 78)
    if ok_all:
        print("KẾT QUẢ: ĐẠT — lịch tính đúng ngày, tiến/lùi đúng theo nhật ký, "
              "và Xếp chuyến chỉ còn xe tải (kể cả xe cũ chưa có loại).")
        return 0
    print("KẾT QUẢ: CÓ MỤC KHÔNG ĐẠT ❌")
    return 1


if __name__ == "__main__":
    sys.exit(main())
