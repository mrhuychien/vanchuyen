#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""thu_hoi_check — LÔ THU HỒI: đúng khách, đúng điểm, và không đổi gốc sau lưng kế toán.

════════════════════════════════════════════════════════════════════════════
SÁU CÁI LỖ MÀ BỘ KIỂM NÀY CANH
════════════════════════════════════════════════════════════════════════════

1. **Điểm lấy hàng của khách khác.** Saigon Co.op chỉ có MỘT Customer cho mọi
   điểm, nên ô khách đúng mà ô điểm sai là chuyện dễ nhất — và nó trôi thẳng sang
   hóa đơn trả về bên kế toán. Chốt ở `LoThuHoi.validate` bằng Dynamic Link.
2. **Chi tiết hàng dán từ mail bị cắt méo.** Bảng hàng trong mail dán ra là các cột
   cách nhau bằng tab; `.strip()` như ô thường là mất khoảng trắng đầu dòng, lệch cột.
3. **Đổi khách / điểm / lùi chặng SAU KHI kế toán đã mở phiếu kiểm.** Phiếu kiểm
   chép khách + điểm lúc mở; đổi bên này là hai bảng nói về hai khách khác nhau.
   Xóa lô lúc đó là phiếu kiểm và hóa đơn trả về mất gốc.
4. **Dòng thời gian thủng.** Nhảy cóc "Tạo yêu cầu → Đã nhận hàng" phải đóng dấu
   cả mốc lấy hàng; lùi chặng phải xóa dấu của chặng bỏ.
5. **File đính kèm thành lỗ script.** Proxy `xem_dinh_kem` phục vụ file trên CHÍNH tên
   miền của site: upload phải từ chối html / svg / js…, proxy chỉ mở trong tab ảnh /
   PDF (còn lại tải về), guard ở dòng đầu, và chỉ file của `Lo Thu Hoi`.
6. **Field mới bị bỏ qua im lặng / field cũ còn sót.** `save_lo` chỉ nhận field trong
   `_UPDATABLE`; màn hình gửi một field không có trong đó là người dùng gõ, bấm lưu,
   mất. Lái xe / xe / chuyến / bảng hàng khai đã bỏ (đơn vị vận chuyển ngoài lấy hàng,
   kế toán lo chi tiết hàng) — không được sót ở DocType, API hay màn hình.
7. **Hủy mà mất dấu vết / hủy sau lưng kế toán.** Hủy yêu cầu GIỮ lô ở "Đã hủy" + lý do +
   ai + lúc nào + chặng trước khi hủy; lô hủy không sửa / không chuyển chặng / không xóa;
   Khôi phục về ĐÚNG chặng cũ. Kế toán đã mở phiếu kiểm thì không hủy được (cả trên Desk),
   và `huy_lo` đọc KHÓA để không chạy đua với "Bắt đầu kiểm" bên ketoan. Danh sách: "Đang
   mở" bỏ lô hủy, lô hủy xếp CUỐI (FIELD() trả 0 cho giá trị lạ = lên đầu).

Kèm hai luật vỏ portal: mọi module trong lib/ + components/ có trong import map
(Luật vàng #1 frappe-portal-spa), và BUILD của shell khớp SHELL_BUILD của server.

Chạy KHÔNG CẦN BENCH:
    python3 docs/verified/thu_hoi_check.py   # exit 0 = đạt
"""

import copy
import importlib
import json
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
FILES = {}              # file -> {attached_to_doctype, attached_to_name, file_name}
INSERTED = []           # File đã insert qua _nhan_file
DELETED = []            # (doctype, filters) đã db.delete
STATE = {"roles": [], "si_write": False, "upload": []}
LOTS = {}               # lô đọc bằng frappe.get_doc("Lo Thu Hoi", …) — API hủy / khôi phục
LOCKS = []              # (lô, for_update) mỗi lần get_doc lô
SQL_LOG = []            # (câu SQL, tham số) — soát mệnh đề list_lo, đọc khóa phiếu kiểm
LIST_ROWS = []          # dòng trả cho truy vấn trang của list_lo
META_OPTIONS = {"ly_do": "\nHàng date / cận date\nHàng lỗi", "don_vi_thu_hoi": "\nViettel Post\nNhất Tín\nKhác"}


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

    class _Meta:
        def get_field(self, f):
            return _D(options=META_OPTIONS[f]) if f in META_OPTIONS else None

    fr.get_meta = lambda dt: _Meta()

    def _get_doc(dt, name=None, for_update=False):
        if isinstance(dt, dict):  # File mới từ _nhan_file
            return _D(insert=lambda **k: INSERTED.append(dt["file_name"]))
        if dt == "Lo Thu Hoi" and name in LOTS:
            LOCKS.append((name, for_update))
            d = LOTS[name]
            d._before = copy.copy(d)  # như Frappe: bản trước khi lưu = bản vừa đọc
            return d
        return _D(get_content=lambda: b"noi-dung")

    fr.get_doc = _get_doc

    class _Files:
        def getlist(self, k):
            return [types.SimpleNamespace(filename=n, stream=types.SimpleNamespace(read=lambda: b"x"))
                    for n in STATE["upload"]]

    fr.request = types.SimpleNamespace(files=_Files())

    class _DB:
        def get_value(self, dt, name=None, fields=None, **k):
            if dt == "Customer":
                return "Tên " + str(name)
            if dt == "Address":
                return _D(address_title="Co.opMart " + str(name), address_line1="1 Lê Lợi",
                          address_line2="", city="Hà Nội", county="", state="", phone="024")
            if dt == "File":
                f = FILES.get(name)
                return _D(f) if f else None
            if dt == "Lo Thu Hoi" and name in LOTS:
                return LOTS[name].trang_thai
            return None

        def exists(self, dt, flt=None, *a, **k):
            if dt == "Dynamic Link":
                return (flt["parent"], flt["link_name"]) in ADDR_LINKS
            return True

        def table_exists(self, dt):
            return dt in TABLES

        def sql(self, query, values=None, **k):
            SQL_LOG.append((query, dict(values or {})))
            if "ORDER BY FIELD" in query:  # trang của list_lo (JOIN mềm sang phiếu kiểm)
                return [_D(r) for r in LIST_ROWS]
            if "SELECT COUNT(*)" in query and "GROUP BY" not in query:
                return [[len(LIST_ROWS)]]
            if "FROM `tabKiem Hang Thu Hoi`" in query:  # phieu_kiem / đọc khóa của huy_lo
                names = (values or {}).get("n") or ()
                names = (names,) if isinstance(names, str) else names
                return [_D(name=n, lo_thu_hoi=n, trang_thai=KIEM[n]) for n in names if n in KIEM]
            return []

        def count(self, *a, **k):
            return len(INSERTED)

        def set_value(self, *a, **k):
            pass

        def delete(self, dt, filters=None):
            DELETED.append((dt, filters))

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

        def set(self, k, v):
            setattr(self, k, v)

        def save(self, ignore_permissions=False):
            self.before_validate()
            self.validate()

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
    resp = sys.modules["frappe"].local.response

    print("=" * 78)
    print("thu_hoi_check — lô thu hồi: đúng khách, đúng điểm, không đổi gốc sau lưng kế toán")
    print("=" * 78)

    ADDR_LINKS.add(("ADDR-HD", "COOP"))

    def lo(**kw):
        base = dict(name="TH-2026-0001", trang_thai="Tạo yêu cầu", customer="COOP",
                    shipping_address_name="ADDR-HD", _new=False)
        base.update(kw)
        return lo_mod.LoThuHoi(**base)

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
    d = lo(ma_van_don="  VTP123456  ")
    d.before_validate()
    check("mã vận đơn bỏ khoảng trắng hai đầu", d.ma_van_don == "VTP123456", repr(d.ma_van_don))

    # ── 2 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 2. Chi tiết hàng dán từ mail: giữ nguyên cột ───────────────────────")
    # Bảng copy từ mail có ô đầu trống (cột STT bỏ trống) → dòng ĐẦU mở bằng tab: chính chỗ
    # `.strip()` ăn mất, cả bảng lệch một cột.
    dan = "\r\n\tMã hàng\tTên hàng\tSL\r\n  BDX-170\tBánh đậu xanh 170g\t48\r\n\tGhi chú dòng\t\r\n\r\n"
    out = api._van_ban_dan(dan)
    check("giữ tab + khoảng trắng đầu dòng, CRLF -> LF, bỏ dòng trống thừa hai đầu",
          out == "\tMã hàng\tTên hàng\tSL\n  BDX-170\tBánh đậu xanh 170g\t48\n\tGhi chú dòng", repr(out))
    check("chỉ khoảng trắng -> None (không lưu ô rỗng giả)", api._van_ban_dan(" \n\t\n ") is None)
    src = open(os.path.join(REPO, "vanchuyen", "api", "thu_hoi.py"), encoding="utf-8").read()
    check("save_lo dùng _van_ban_dan cho chi_tiet_hang (không .strip() như ô thường)",
          re.search(r'elif f == "chi_tiet_hang":\s*\n\s*doc\.set\(f, _van_ban_dan\(v\)\)', src) is not None)

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
    TABLES.add("Lo Thu Hoi Hang")
    DELETED.clear()
    lo(name="TH-CU").on_trash()
    check("xóa lô dọn luôn dòng hàng khai CŨ (không còn field cha, Frappe không tự xóa)",
          DELETED == [("Lo Thu Hoi Hang", {"parent": "TH-CU", "parenttype": "Lo Thu Hoi"})], str(DELETED))

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
    print("── 5. File đính kèm: không thành lỗ script ────────────────────────────")
    FILES["F-LO"] = {"attached_to_doctype": "Lo Thu Hoi", "attached_to_name": "TH-9", "file_name": "ds-hang.xlsx"}
    STATE.update(roles=[], si_write=False)
    check("proxy: guard ở dòng đầu — không quyền thì PermissionError",
          raises(lambda: api.xem_dinh_kem("F-LO"), PermErr) is not None)
    STATE.update(si_write=True)
    FILES["F-SI"] = {"attached_to_doctype": "Sales Invoice", "attached_to_name": "SI-1", "file_name": "x.pdf"}
    check("proxy từ chối file gắn vào DocType khác", raises(lambda: api.xem_dinh_kem("F-SI")) is not None)

    def kieu(ten):
        FILES["F-LO"]["file_name"] = ten
        resp.clear()
        api.xem_dinh_kem("F-LO")
        return resp.get("display_content_as")

    check("PDF / ảnh mở trong tab (inline)", kieu("phieu.pdf") == "inline" and kieu("anh.JPG") == "inline")
    check("Excel / Word TẢI VỀ (attachment)", kieu("ds-hang.xlsx") == "attachment" and kieu("bb.docx") == "attachment")
    check("file cũ .html / .svg gắn bằng Desk vẫn TẢI VỀ, không bao giờ inline",
          kieu("trang.html") == "attachment" and kieu("logo.svg") == "attachment")
    INSERTED.clear()
    STATE["upload"] = ["phieu.pdf", "danh-sach.XLSX", "bien-ban.docx", "mail.eml", "anh.heic"]
    r = raises(lambda: api._nhan_file("TH-9"))
    check("upload nhận PDF / Excel / Word / mail / ảnh", r is None and len(INSERTED) == 5, f"{r} · {INSERTED}")
    INSERTED.clear()
    STATE["upload"] = ["phieu.pdf", "xem-ngay.html"]
    r = raises(lambda: api._nhan_file("TH-9"))
    check("upload có file .html -> từ chối CẢ lượt, không lưu nửa vời",
          r is not None and "xem-ngay.html" in r and INSERTED == [], f"{r} · {INSERTED}")
    for bad in ("x.svg", "x.js", "x.exe", "khong-duoi"):
        STATE["upload"] = [bad]
        check(f"upload '{bad}' -> từ chối", raises(lambda: api._nhan_file("TH-9")) is not None)
    js = open(os.path.join(PUB, "views", "thu-hoi-detail.js"), encoding="utf-8").read()

    def bo_js(ten):
        m = re.search(rf"const {ten} = new Set\(\[(.*?)\]\)", js, re.S)
        return set(re.findall(r'"([a-z0-9]+)"', m.group(1))) if m else set()

    check("màn hình lọc trước ĐÚNG danh sách đuôi server nhận (DUOI == DUOI_DINH_KEM)",
          bo_js("DUOI") == set(api.DUOI_DINH_KEM), str(bo_js("DUOI") ^ set(api.DUOI_DINH_KEM)))
    check("màn hình biết loại nào mở trong tab (XEM_TRONG_TAB == DUOI_XEM_TRONG_TAB)",
          bo_js("XEM_TRONG_TAB") == set(api.DUOI_XEM_TRONG_TAB))

    # ── 6 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 6. Field: màn hình gửi đủ, field cũ không sót ──────────────────────")
    m = re.search(r"function payload\(\) \{.*?\[(.*?)\]\.forEach", js, re.S)
    keys = re.findall(r'"([a-z_]+)"', m.group(1)) if m else []
    thieu = [k for k in keys if k not in api._UPDATABLE]
    check("tìm thấy danh sách field trong payload()", len(keys) >= 10, str(len(keys)))
    check("không field nào bị bỏ qua im lặng", not thieu, ", ".join(thieu))
    moi = ("chi_tiet_hang", "don_vi_thu_hoi", "ma_van_don", "ngay_hen_lay")
    check("payload + _UPDATABLE có đủ field mới (chi tiết hàng, đơn vị, vận đơn, ngày thu)",
          all(k in keys and k in api._UPDATABLE for k in moi))
    dt = json.load(open(os.path.join(REPO, "vanchuyen", "van_chuyen", "doctype", "lo_thu_hoi", "lo_thu_hoi.json"),
                        encoding="utf-8"))
    fields = {f["fieldname"]: f for f in dt["fields"]}
    cu = ("lai_xe", "ten_lai_xe", "sdt_lai_xe", "xe", "chuyen_xe", "items", "tong_sl_khai")
    # Màn hình: soát CÁCH DÙNG field ("items", F.items, D.xe, data-f="xe") — không soát chữ trần:
    # "xe" là chữ thường trong câu tiếng Việt, "items" nằm trong class vc-items-center.
    con = [k for k in cu if k in fields or k in api._UPDATABLE or k in api._LIST_COLS
           or re.search(rf'["\']{k}["\']|\b[FDrp]\.{k}\b|data-f="{k}"', js)]
    check("lái xe / xe / chuyến / bảng hàng khai không sót ở DocType, API, màn hình", not con, str(con))
    check("đơn vị thu hồi: Select Viettel Post / Nhất Tín / Khác",
          fields.get("don_vi_thu_hoi", {}).get("options", "").split("\n")[1:] == ["Viettel Post", "Nhất Tín", "Khác"])
    check("chi_tiet_hang là Long Text (mail dài không bị cắt)",
          fields.get("chi_tiet_hang", {}).get("fieldtype") == "Long Text")
    check("field_order khớp danh sách field", dt.get("field_order") == [f["fieldname"] for f in dt["fields"]])
    STATE.update(si_write=True)
    lc = api.get_lua_chon()
    check("get_lua_chon trả đơn vị thu hồi đọc từ meta, không còn lái xe / xe / chuyến",
          lc.get("don_vi") == ["Viettel Post", "Nhất Tín", "Khác"] and not ({"drivers", "vehicles", "trips"} & set(lc)),
          str(sorted(lc)))
    chuyen = open(os.path.join(PUB, "views", "chuyen.js"), encoding="utf-8").read()
    check("màn lái xe #/chuyen không còn gọi API thu hồi; API không còn method lái xe",
          "thu_hoi" not in chuyen and not any(hasattr(api, f) for f in ("cua_toi", "lai_xe_da_lay", "lai_xe_upload")))

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

    # ── 8 ──────────────────────────────────────────────────────────────────
    print("-" * 78)
    print("── 8. Hủy yêu cầu: giữ dấu vết, chỉ khi kế toán chưa mở phiếu kiểm ─────")
    STATE.update(roles=[], si_write=True)
    TABLES.add("Kiem Hang Thu Hoi")
    KIEM.clear()
    LOTS["TH-H1"] = lo(name="TH-H1", trang_thai="Đã lấy hàng", lay_luc="2026-10-16 08:00:00", lay_boi="Điều hành",
                       nhan_luc=None, nhan_boi=None, modified="2026-10-16 08:00:00")
    check("hủy không lý do / lý do quá ngắn -> chặn, lô giữ nguyên",
          raises(lambda: api.huy_lo("TH-H1", "")) and raises(lambda: api.huy_lo("TH-H1", "  abc ")) and
          LOTS["TH-H1"].trang_thai == "Đã lấy hàng")
    KIEM["TH-H1"] = "Đang kiểm"
    r = raises(lambda: api.huy_lo("TH-H1", "Siêu thị rút yêu cầu"))
    check("kế toán đã mở phiếu kiểm -> không hủy, chỉ đường: nhờ kế toán xóa phiếu kiểm",
          r is not None and "xóa phiếu kiểm" in r and LOTS["TH-H1"].trang_thai == "Đã lấy hàng", r)
    KIEM.clear()
    LOCKS.clear()
    SQL_LOG.clear()
    d = api.huy_lo("TH-H1", "  Siêu thị rút yêu cầu  ")
    x = LOTS["TH-H1"]
    dau = tuple(x.get(f) for f in ("trang_thai", "ly_do_huy", "huy_boi", "huy_tu", "huy_luc"))
    check("hủy: lô GIỮ LẠI ở 'Đã hủy' + lý do + ai + lúc nào + chặng trước khi hủy",
          dau[:4] == ("Đã hủy", "Siêu thị rút yêu cầu", "Người bấm", "Đã lấy hàng") and bool(dau[4]), str(dau))
    check("hủy không xóa mốc lấy hàng (dòng thời gian còn nguyên)", x.lay_luc and x.lay_boi == "Điều hành")
    check("hủy: khóa hàng lô (for_update) + đọc KHÓA phiếu kiểm (FOR UPDATE) — không chạy đua với 'Bắt đầu kiểm'",
          ("TH-H1", True) in LOCKS and any("tabKiem Hang Thu Hoi" in q and q.rstrip().endswith("FOR UPDATE")
                                         for q, _p in SQL_LOG), str(LOCKS))
    check("trả về cho màn hình: chặng 'Đã hủy' + lý do + chặng trước khi hủy",
          d.get("chang") == "Đã hủy" and d.get("ly_do_huy") == "Siêu thị rút yêu cầu" and d.get("huy_tu") == "Đã lấy hàng")
    check("hủy lần nữa -> chặn", raises(lambda: api.huy_lo("TH-H1", "Lập trùng lô")) is not None)
    check("lô đã hủy: không sửa (save_lo)", "chỉ xem" in (raises(lambda: api.save_lo({"ghi_chu": "x"}, "TH-H1")) or ""))
    check("lô đã hủy: không chuyển chặng", "chỉ xem" in (raises(lambda: api.chuyen_chang("TH-H1", "Đã nhận hàng")) or ""))
    check("lô đã hủy: không xóa — giữ lại làm dấu vết",
          "dấu vết" in (raises(lambda: api.xoa_lo("TH-H1")) or ""))
    check("'Đã hủy' không đi đường chuyển chặng (chỉ qua huy_lo)", raises(lambda: api._dat_chang(lo(), "Đã hủy")) is not None)
    api.khoi_phuc_lo("TH-H1")
    x = LOTS["TH-H1"]
    check("khôi phục: về ĐÚNG chặng trước khi hủy, bỏ dấu hủy, giữ mốc lấy hàng",
          x.trang_thai == "Đã lấy hàng" and not any(x.get(f) for f in ("ly_do_huy", "huy_boi", "huy_luc", "huy_tu"))
          and x.lay_luc, str((x.trang_thai, x.get("ly_do_huy"), x.get("huy_tu"))))
    check("khôi phục lô KHÔNG hủy -> chặn", raises(lambda: api.khoi_phuc_lo("TH-H1")) is not None)
    d = lo(trang_thai="Đã hủy", ly_do_huy="   ")
    d.before_validate()
    check("controller: 'Đã hủy' không lý do -> chặn (kể cả sửa trên Desk)", raises(d.validate) is not None)
    KIEM["TH-2026-0001"] = "Đang kiểm"
    d = lo(trang_thai="Đã hủy", ly_do_huy="Hủy trên Desk", _before=lo(trang_thai="Đã nhận hàng"))
    d.before_validate()
    check("controller: kế toán đã mở phiếu kiểm -> không hủy được kể cả trên Desk", raises(d.validate) is not None)
    KIEM.clear()

    LIST_ROWS[:] = [dict(name="TH-H2", chang="Đã hủy", trang_thai="Đã hủy", ngay_yeu_cau="2026-10-01"),
                    dict(name="TH-H3", chang="Đã nhận hàng", trang_thai="Đã nhận hàng", ngay_yeu_cau="2026-10-01")]
    SQL_LOG.clear()
    res = api.list_lo()
    q, pr = next((q, pr) for q, pr in reversed(SQL_LOG) if "ORDER BY FIELD" in q)
    check("'Đang mở' bỏ cả 'Xong' lẫn 'Đã hủy'", "NOT IN (%(xong)s, %(huy)s)" in q and pr.get("huy") == "Đã hủy", q[-160:])
    thu_tu = [pr.get(f"c{i}") for i in range(9) if f"c{i}" in pr]
    check("xếp danh sách: lô 'Đã hủy' nằm CUỐI (có trong FIELD, sau 'Xong')",
          thu_tu[-2:] == ["Xong", "Đã hủy"] and f"%(c{len(thu_tu) - 1})s" in q, str(thu_tu))
    check("lô hủy không tính tuổi (không trôi lên thành 'lô treo lâu')",
          res["rows"][0]["tuoi"] is None and res["rows"][1]["tuoi"] == 0, str([r["tuoi"] for r in res["rows"]]))
    api.list_lo(chang="Đã hủy")
    q, pr = next((q, pr) for q, pr in reversed(SQL_LOG) if "ORDER BY FIELD" in q)
    check("lọc riêng pill 'Đã hủy' được", "= %(chang)s" in q and pr.get("chang") == "Đã hủy")
    LIST_ROWS.clear()
    ui = open(os.path.join(PUB, "components", "thu-hoi-ui.js"), encoding="utf-8").read()
    check("DocType: trạng thái có 'Đã hủy'; dấu hủy là field CHỈ ĐỌC (chỉ API ghi)",
          "Đã hủy" in fields["trang_thai"]["options"].split("\n")
          and all(fields.get(f, {}).get("read_only") for f in ("ly_do_huy", "huy_boi", "huy_luc", "huy_tu")))
    check("màn hình dùng ĐÚNG chữ 'Đã hủy' của server", lo_mod.DA_HUY == "Đã hủy" and 'export const DA_HUY = "Đã hủy";' in ui)

    print("=" * 78)
    print("ĐẠT" if ok_all else "CÓ MỤC ĐỎ")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
