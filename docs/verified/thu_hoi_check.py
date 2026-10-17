#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""thu_hoi_check — LÔ THU HỒI: đúng khách, đúng điểm, và không đổi gốc sau lưng kế toán.

════════════════════════════════════════════════════════════════════════════
NĂM CÁI LỖ MÀ BỘ KIỂM NÀY CANH
════════════════════════════════════════════════════════════════════════════

1. **Điểm lấy hàng của khách khác.** Saigon Co.op chỉ có MỘT Customer cho mọi
   điểm, nên ô khách đúng mà ô điểm sai là chuyện dễ nhất — và nó trôi thẳng sang
   hóa đơn trả về bên kế toán. Chốt ở `LoThuHoi.validate` bằng Dynamic Link.
2. **Đổi khách / điểm / lùi chặng SAU KHI kế toán đã mở phiếu kiểm.** Phiếu kiểm
   chép khách + điểm lúc mở; đổi bên này là hai bảng nói về hai khách khác nhau.
   Xóa lô lúc đó là phiếu kiểm và hóa đơn trả về mất gốc.
3. **Field mới bị bỏ qua im lặng.** `save_lo` chỉ nhận field trong `_UPDATABLE`;
   màn hình gửi một field không có trong đó là người dùng gõ, bấm lưu, mất.
4. **Dòng thời gian thủng.** Nhảy cóc "Tạo yêu cầu → Đã nhận hàng" phải đóng dấu
   cả mốc lấy hàng; lùi chặng phải xóa dấu của chặng bỏ.
5. **Lái xe đụng lô của người khác / file của DocType khác qua proxy.**

Kèm hai luật vỏ portal: mọi module trong lib/ + components/ có trong import map
(Luật vàng #1 frappe-portal-spa), và BUILD của shell khớp SHELL_BUILD của server.

Chạy KHÔNG CẦN BENCH:
    python3 docs/verified/thu_hoi_check.py   # exit 0 = đạt
"""

import importlib
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PUB = os.path.join(REPO, "vanchuyen", "public", "vanchuyen")

ok_all = True


def check(label, cond, detail=""):
    global ok_all
    print(("  ✅ " if cond else "  ❌ ") + label + (f"  ({detail})" if detail else ""))
    if not cond:
        ok_all = False
    return cond


class _D(dict):
    __getattr__ = dict.get

    def __setattr__(self, k, v):
        self[k] = v


class Throw(Exception):
    pass


class PermErr(Exception):
    pass


# ── kho dữ liệu giả ─────────────────────────────────────────────────────────
ADDR_LINKS = set()      # (address, customer)
TABLES = set()          # bảng đang có trên "site"
KIEM = {}               # lô -> trạng thái phiếu kiểm bên ketoan
ITEMS = {}              # item -> {item_name, stock_uom}
UOM_CF = {}             # (item, uom) -> hệ số
LO_LAI_XE = {}          # lô -> driver
FILES = {}              # file -> {attached_to_doctype, attached_to_name, file_name}
STATE = {"driver": None, "roles": [], "si_write": False}


def _stub_frappe():
    fr = types.ModuleType("frappe")
    fr.ValidationError = Throw
    fr.PermissionError = PermErr
    fr.DoesNotExistError = type("DNE", (Throw,), {})

    def _throw(msg, exc=None):
        if exc is PermErr:
            raise PermErr(str(msg))
        raise Throw(str(msg))

    fr.throw = _throw
    fr._ = lambda s, *a, **k: s
    fr.whitelist = lambda *a, **k: (lambda f: f)
    fr._dict = _D
    fr.session = types.SimpleNamespace(user="dieuphoi@local")
    fr.get_roles = lambda user=None: list(STATE["roles"])
    fr.has_permission = lambda *a, **k: STATE["si_write"]
    fr.get_all = lambda *a, **k: []
    fr.local = types.SimpleNamespace(response=_D())

    class _DB:
        def get_value(self, dt, name=None, fields=None, **k):
            if dt == "Customer":
                return "Tên " + str(name)
            if dt == "Address":
                return _D(address_title="Co.opMart " + str(name), address_line1="1 Lê Lợi",
                          address_line2="", city="Hà Nội", county="", state="", phone="024")
            if dt == "Driver":
                if isinstance(name, dict):  # tra theo custom_user
                    return STATE["driver"] if "custom_is_to_truong" not in name else None
                return _D(full_name="Lái " + str(name), cell_number="09")
            if dt == "Item":
                it = ITEMS.get(name)
                return _D(it) if it else None
            if dt == "UOM Conversion Detail":
                return UOM_CF.get((name["parent"], name["uom"]))
            if dt == "Lo Thu Hoi":
                return LO_LAI_XE.get(name)
            if dt == "File":
                f = FILES.get(name)
                return _D(f) if f else None
            return None

        def exists(self, dt, flt=None, *a, **k):
            if dt == "Dynamic Link":
                return (flt["parent"], flt["link_name"]) in ADDR_LINKS
            return True

        def table_exists(self, dt):
            return dt in TABLES

        def sql(self, query, values=None, **k):
            if "tabKiem Hang Thu Hoi" in query:
                names = (values or {}).get("n") or ()
                return [_D(lo_thu_hoi=n, trang_thai=KIEM[n]) for n in names if n in KIEM]
            return []

        def count(self, *a, **k):
            return 0

        def set_value(self, *a, **k):
            pass

        def has_column(self, *a, **k):
            return True

    fr.db = _DB()
    sys.modules["frappe"] = fr

    fu = types.ModuleType("frappe.utils")
    fu.flt = lambda v, p=None: float(v or 0)
    fu.cint = lambda v: int(float(v or 0))
    fu.cstr = lambda v: "" if v is None else str(v)
    fu.nowdate = lambda: "2026-10-17"
    fu.getdate = lambda v=None: v
    fu.date_diff = lambda a, b: 0
    fu.now_datetime = lambda: "2026-10-17 10:00:00"
    fu.get_fullname = lambda u=None: "Người bấm"
    fr.utils = fu
    sys.modules["frappe.utils"] = fu

    fm = types.ModuleType("frappe.model")
    fmd = types.ModuleType("frappe.model.document")

    class Document:
        doctype = "Lo Thu Hoi"

        def __init__(self, **kw):
            self.__dict__.update(kw)

        def get(self, k, default=None):
            return self.__dict__.get(k, default)

        def is_new(self):
            return bool(self.__dict__.get("_new"))

        def get_doc_before_save(self):
            return self.__dict__.get("_before")

    fmd.Document = Document
    sys.modules["frappe.model"] = fm
    sys.modules["frappe.model.document"] = fmd
    return fr


def raises(fn, exc=Throw):
    try:
        fn()
        return None
    except exc as e:
        return str(e) or "throw"


def main():
    _stub_frappe()
    sys.path.insert(0, REPO)
    lo_mod = importlib.import_module("vanchuyen.van_chuyen.doctype.lo_thu_hoi.lo_thu_hoi")
    api = importlib.import_module("vanchuyen.api.thu_hoi")

    print("=" * 78)
    print("thu_hoi_check — lô thu hồi: đúng khách, đúng điểm, không đổi gốc sau lưng kế toán")
    print("=" * 78)

    ITEMS["BDX-170"] = {"item_name": "Bánh đậu xanh 170g", "stock_uom": "Hộp"}
    UOM_CF[("BDX-170", "Thùng")] = 24.0
    ADDR_LINKS.add(("ADDR-HD", "COOP"))

    def lo(**kw):
        base = dict(name="TH-2026-0001", trang_thai="Tạo yêu cầu", customer="COOP",
                    shipping_address_name="ADDR-HD", items=[], lai_xe=None, _new=False)
        base.update(kw)
        return lo_mod.LoThuHoi(**base)

    def row(**kw):
        r = _D(item_code="BDX-170", qty=1, uom=None, idx=1)
        r.update(kw)
        return r

    # ── 1 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 1. Điểm lấy hàng phải là Address CỦA CHÍNH KHÁCH (Dynamic Link) ─────")
    d = lo()
    d.before_validate()
    check("điểm của đúng khách -> qua", raises(d.validate) is None)
    check("tên điểm / địa chỉ chép SERVER-side từ Address",
          d.ten_diem == "Co.opMart ADDR-HD" and "Lê Lợi" in (d.dia_chi or ""), f"{d.ten_diem} · {d.dia_chi}")
    d = lo(shipping_address_name="ADDR-BIGC")
    d.before_validate()
    check("điểm của khách KHÁC -> chặn", raises(d.validate) is not None)

    # ── 2 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 2. Hàng khai: quy đổi ĐVT, một mã một dòng ────────────────────────")
    d = lo(items=[row(qty=2, uom="Thùng")])
    d.before_validate()
    check("2 thùng × 24 = 48 hộp (ĐVT kho)", d.items[0].stock_qty == 48.0 and d.tong_sl_khai == 48.0,
          f"{d.items[0].stock_qty}")
    check("hợp lệ -> qua", raises(d.validate) is None)
    d = lo(items=[row(qty=2, uom="Lốc")])
    d.before_validate()
    check("ĐVT chưa khai quy đổi -> chặn, KHÔNG tự lấy hệ số 1", raises(d.validate) is not None
          and d.items[0].stock_qty is None)
    d = lo(items=[row(idx=1), row(idx=2, qty=3)])
    d.before_validate()
    check("hai dòng cùng mã -> chặn", raises(d.validate) is not None)
    d = lo(items=[row(qty=0)])
    d.before_validate()
    check("số lượng 0 -> chặn", raises(d.validate) is not None)

    # ── 3 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 3. Kế toán đã mở phiếu kiểm -> khóa khách / điểm / chặng / xóa ──────")
    before = lo(trang_thai="Đã nhận hàng")
    d = lo(trang_thai="Đã nhận hàng", customer="BIGC", _before=before)
    ADDR_LINKS.add(("ADDR-HD", "BIGC"))
    d.before_validate()
    check("chưa có phiếu kiểm -> đổi khách được", raises(d.validate) is None)
    TABLES.add("Kiem Hang Thu Hoi")
    KIEM["TH-2026-0001"] = "Đang kiểm"
    check("có phiếu kiểm -> đổi khách bị chặn", raises(d.validate) is not None)
    d = lo(trang_thai="Đã lấy hàng", _before=before)
    d.before_validate()
    check("có phiếu kiểm -> lùi chặng bị chặn", raises(d.validate) is not None)
    d = lo(trang_thai="Đã nhận hàng", _before=before)
    d.before_validate()
    check("có phiếu kiểm, không đổi gì -> vẫn lưu được (ghi chú, đính kèm)", raises(d.validate) is None)
    check("có phiếu kiểm -> on_trash chặn", raises(lo().on_trash) is not None)
    check("phieu_kiem đọc MỀM: thiếu bảng -> {}",
          (TABLES.discard("Kiem Hang Thu Hoi") or lo_mod.phieu_kiem(["TH-2026-0001"])) == {})
    check("trạng thái rỗng bên ketoan đọc là 'Đang kiểm'",
          (TABLES.add("Kiem Hang Thu Hoi"), KIEM.update({"TH-X": ""}),
           lo_mod.phieu_kiem(["TH-X"]))[-1] == {"TH-X": "Đang kiểm"})
    KIEM.clear()

    # ── 4 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 4. Chuyển chặng: nhảy cóc đóng dấu đủ, lùi xóa dấu ─────────────────")
    d = lo(lay_luc=None, lay_boi=None, nhan_luc=None, nhan_boi=None, so_kien_nhan=None)
    api._dat_chang(d, "Đã nhận hàng", so_kien_nhan="7")
    check("Tạo yêu cầu -> Đã nhận hàng: có CẢ mốc lấy lẫn mốc nhận",
          d.trang_thai == "Đã nhận hàng" and d.lay_luc and d.nhan_luc and d.so_kien_nhan == 7.0)
    api._dat_chang(d, "Tạo yêu cầu")
    check("lùi về Tạo yêu cầu: xóa cả hai mốc", not d.lay_luc and not d.nhan_luc and not d.nhan_boi)
    check("chặng lạ -> chặn", raises(lambda: api._dat_chang(d, "Đã giao")) is not None)
    check("chặng kế toán KHÔNG ghi được từ vanchuyen", raises(lambda: api._dat_chang(d, "Xong")) is not None)

    # ── 5 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 5. Lái xe chỉ lô của mình; proxy chỉ file của Lo Thu Hoi ────────────")
    STATE["driver"] = "DRV-A"
    LO_LAI_XE["TH-1"] = "DRV-B"
    check("lô giao cho người khác -> PermissionError",
          raises(lambda: api._require_lo_cua_toi("TH-1"), PermErr) is not None)
    LO_LAI_XE["TH-1"] = "DRV-A"
    check("lô của mình -> qua", raises(lambda: api._require_lo_cua_toi("TH-1"), PermErr) is None)
    FILES["F-SI"] = {"attached_to_doctype": "Sales Invoice", "attached_to_name": "SI-1", "file_name": "x.pdf"}
    check("proxy từ chối file gắn vào DocType khác",
          raises(lambda: api.xem_dinh_kem("F-SI")) is not None)
    FILES["F-LO"] = {"attached_to_doctype": "Lo Thu Hoi", "attached_to_name": "TH-9", "file_name": "p.pdf"}
    LO_LAI_XE["TH-9"] = "DRV-B"
    check("lái xe xem file của lô KHÔNG giao cho mình -> chặn",
          raises(lambda: api.xem_dinh_kem("F-LO"), PermErr) is not None)

    # ── 6 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 6. Field màn hình gửi đều nằm trong _UPDATABLE ─────────────────────")
    js = open(os.path.join(PUB, "views", "thu-hoi-detail.js"), encoding="utf-8").read()
    m = re.search(r"function payload\(\) \{.*?\[(.*?)\]\.forEach", js, re.S)
    keys = re.findall(r'"([a-z_]+)"', m.group(1)) if m else []
    thieu = [k for k in keys if k not in api._UPDATABLE]
    check("tìm thấy danh sách field trong payload()", len(keys) >= 10, str(len(keys)))
    check("không field nào bị bỏ qua im lặng", not thieu, ", ".join(thieu))

    # ── 7 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 7. Vỏ portal: import map đủ module dùng chung, BUILD khớp ──────────")
    html = open(os.path.join(REPO, "vanchuyen", "www", "vc.html"), encoding="utf-8").read()
    for sub in ("lib", "components"):
        for fn in sorted(os.listdir(os.path.join(PUB, sub))):
            if fn.endswith(".js"):
                url = f"/assets/vanchuyen/vanchuyen/{sub}/{fn}"
                check(f"import map có {sub}/{fn}", f'"{url}": "{url}?v=' in html)
    shell = open(os.path.join(PUB, "shell.js"), encoding="utf-8").read()
    vcpy = open(os.path.join(REPO, "vanchuyen", "www", "vc.py"), encoding="utf-8").read()
    b1 = re.search(r'const BUILD = "([^"]+)"', shell)
    b2 = re.search(r'SHELL_BUILD = "([^"]+)"', vcpy)
    check("BUILD shell == SHELL_BUILD server", b1 and b2 and b1.group(1) == b2.group(1),
          f"{b1 and b1.group(1)} / {b2 and b2.group(1)}")
    for path, mod in (("/thu-hoi", "thu-hoi.js"), ("/thu-hoi/:id", "thu-hoi-detail.js")):
        check(f"route {path} khai trong shell + file view có thật",
              f'path: "{path}"' in shell and os.path.exists(os.path.join(PUB, "views", mod)))

    print("=" * 78)
    print("ĐẠT" if ok_all else "CÓ MỤC ĐỎ")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
