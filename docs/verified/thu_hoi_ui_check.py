#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""thu_hoi_ui_check — MÀN THU HỒI chạy thật trong Chromium (portal /vc thật, server giả).

`thu_hoi_check` canh server (địa chỉ của khách, khóa kế toán, đuôi file, proxy). Bộ này canh
cái người điều hành BẤM: shell.js + import map của vc.html + shell.css thật, chỉ
`frappe.call` là giả — trả đúng hình dạng JSON của `vanchuyen.api.thu_hoi.*`.

════════════════════════════════════════════════════════════════════════════
NHỮNG ĐIỀU MÀN HÌNH HỨA
════════════════════════════════════════════════════════════════════════════

1. **Chọn điểm xong thì danh sách THU LẠI** (như ô khách): còn thẻ điểm + nút "Đổi điểm";
   bấm "Đổi điểm" mở lại, "Giữ điểm cũ" đóng mà không đổi, chọn điểm khác thì thu lại.
2. **Chi tiết hàng dán từ mail đi NGUYÊN VĂN** lên server — tab giữa các cột còn nguyên.
3. **Điều phối thu hồi = đơn vị + mã vận đơn + ngày thu** (Viettel Post / Nhất Tín vào lấy);
   không còn lái xe / xe / chuyến / bảng hàng khai — ở form lẫn trong payload.
4. **Đính kèm nhận Excel / Word / mail**: ô chọn file mở cho .xlsx/.docx/.eml…, file .html bị
   gạt ngay ở máy (không tải lên), file Excel gửi NGUYÊN (không bị "nén ảnh"); thẻ file Excel
   có biểu tượng Excel và tải về (`download`), PDF mở tab mới.
5. **Màn lái xe #/chuyen không còn khối "Lấy hàng thu hồi"** — không gọi API thu hồi nào.
5b. **Hủy yêu cầu có lý do, lô giữ lại chỉ xem, Khôi phục về đúng chặng.** Không lý do thì
   không gọi server; lô hủy khóa ô nhập / nút Lưu / chuyển chặng nhưng ô mail dán vẫn đọc,
   cuộn, copy được (readonly) và vẫn đính kèm thêm được; danh sách: "Đang mở" không đếm lô
   hủy, pill "Đã hủy" riêng; lô kế toán đã kiểm không có nút Hủy.
6. Lô kế toán đã kiểm: không đổi khách / điểm. Máy tính 1280px không cuộn ngang. Không lỗi
   JS / console / HTTP.

Chạy KHÔNG cần bench (cần `pip install playwright`; Chromium có sẵn ở /opt/pw-browsers):
    python3 docs/verified/thu_hoi_ui_check.py [--shots THƯ_MỤC]
Không có trình duyệt thì BỎ QUA (thoát 0) như `table_width_check` bên ketoan.
"""

import glob
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(REPO, "vanchuyen", "public", "vanchuyen")
BASE = "/assets/vanchuyen/vanchuyen"
PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c63f8cfc0f01f0005000201e0e2a5b10000000049454e44ae426082"
)


def chromium_path():
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                "/opt/pw-browsers/chromium/chrome-linux/chrome"):
        hit = sorted(glob.glob(pat))
        if hit:
            return hit[-1]
    return None


def _bo_qua(msg):
    print("=" * 82)
    print("THU HỒI (vanchuyen) — MÀN HÌNH THẬT TRONG CHROMIUM")
    print("=" * 82)
    print(f"  ⚠ BỎ QUA — {msg}")
    print("    Cài: pip install playwright  (Chromium đã có sẵn ở /opt/pw-browsers)")
    print("=" * 82)
    print("KẾT QUẢ: BỎ QUA — không có trình duyệt, KHÔNG kết luận gì")
    return 0


def build_page_parts():
    """(import map, thân trang) lấy NGUYÊN từ vc.html — test đúng cái sẽ ship."""
    src = open(os.path.join(REPO, "vanchuyen", "www", "vc.html"), encoding="utf-8").read()
    v = "{{ vc_context.assetVersion }}"
    imap = re.search(r'<script type="importmap">(.*?)</script>', src, re.S).group(1).replace(v, "1")
    body = re.search(r"\{% else %\}(.*?)\{% endif %\}", src, re.S).group(1).replace(v, "1")
    return imap, body


def page_html(imap, body, ctx):
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">'
        f'<link rel="stylesheet" href="{BASE}/shell.css">'
        f'<script type="importmap">{imap}</script>'
        f"<script>window.VC_CONTEXT = {json.dumps(ctx, ensure_ascii=False)};</script>"
        '<script src="/mock.js"></script>'
        f"</head><body>{body}</body></html>"
    )


# frappe.call giả — giữ trạng thái trong trình duyệt để đi trọn luồng tạo → lưu → mở lại.
MOCK_JS = r"""
(function(){
  const LOG = window.__calls = [];
  const today = "2026-10-17";
  const CHANG = ["Tạo yêu cầu","Đã lấy hàng","Đã nhận hàng","Đang kiểm","Đã kiểm hàng","Đã nhập chứng từ","Xong"];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const ADDR = [{name:"ADDR-HD", ten:"Co.opMart Hà Đông", ma:"HD01", dia_chi:"1 Quang Trung, Hà Đông"},
                {name:"ADDR-TL", ten:"Co.opMart Thắng Lợi", ma:"TL", dia_chi:"2 Thái Hà, Đống Đa"}];
  const lots = {
    "TH-2026-0001": { name:"TH-2026-0001", trang_thai:"Tạo yêu cầu", chang:"Tạo yêu cầu", ngay_yeu_cau:"2026-10-10",
      so_phieu_sieu_thi:"XT-889", ly_do:"Hàng date / cận date", customer:"COOP", customer_name:"Saigon Co.op",
      shipping_address_name:"ADDR-HD", ten_diem:"Co.opMart Hà Đông", ma_diem:"HD01", dia_chi:"1 Quang Trung, Hà Đông",
      don_vi_thu_hoi:"Viettel Post", ma_van_don:"VTP123", ngay_hen_lay:"2026-10-18", so_kien_du_kien:3,
      chi_tiet_hang:"\tMã hàng\tSL\nBDX-170\t48", so_dinh_kem:2, khoa_ke_toan:false, co_ke_toan:true, tuoi:7,
      files:[{name:"F1", file_name:"phieu.pdf", ext:"pdf", is_image:false, url:"/api/method/vanchuyen.api.thu_hoi.xem_dinh_kem?file=F1"},
             {name:"F2", file_name:"ds-hang.xlsx", ext:"xlsx", is_image:false, url:"/api/method/vanchuyen.api.thu_hoi.xem_dinh_kem?file=F2"}] },
    "TH-2026-0009": { name:"TH-2026-0009", trang_thai:"Đã lấy hàng", chang:"Đã lấy hàng", ngay_yeu_cau:"2026-10-12",
      customer:"COOP", customer_name:"Saigon Co.op", shipping_address_name:"ADDR-TL", ten_diem:"Co.opMart Thắng Lợi",
      dia_chi:"2 Thái Hà, Đống Đa", don_vi_thu_hoi:"Nhất Tín", ma_van_don:"NT-555", lay_luc:"2026-10-13 09:00:00",
      lay_boi:"Điều hành", chi_tiet_hang:"\tMã hàng\tSL\nBDX-300\t12", so_dinh_kem:0, files:[], khoa_ke_toan:false,
      co_ke_toan:true, tuoi:5 },
    "TH-2026-0002": { name:"TH-2026-0002", trang_thai:"Đã nhận hàng", chang:"Đã kiểm hàng", ngay_yeu_cau:"2026-10-01",
      customer:"BIGC", customer_name:"Central Retail", shipping_address_name:"ADDR-BC", ten_diem:"GO! Thăng Long",
      dia_chi:"222 Trần Duy Hưng", don_vi_thu_hoi:"Nhất Tín", so_dinh_kem:0, files:[], khoa_ke_toan:true, co_ke_toan:true,
      lay_luc:"2026-10-02 08:10:00", lay_boi:"Điều hành", nhan_luc:"2026-10-02 15:00:00", nhan_boi:"Kho", tuoi:16 },
  };
  let seq = 3;
  const detail = (n) => Object.assign(clone(lots[n]), { chang_list: CHANG });
  const H = {
    "vanchuyen.api.thu_hoi.list_lo": (a) => {
      const rows = Object.values(lots).filter(l => a.chang === "tat_ca" || (a.chang === "dang_mo" ? !["Xong", "Đã hủy"].includes(l.chang) : l.chang === a.chang));
      const counts = {}; Object.values(lots).forEach(l => counts[l.chang] = (counts[l.chang]||0)+1);
      return { rows: clone(rows), total: rows.length, has_more:false, counts, chang_list: CHANG, co_ke_toan:true };
    },
    "vanchuyen.api.thu_hoi.get_lo": (a) => detail(a.name),
    "vanchuyen.api.thu_hoi.get_lua_chon": () => ({ ly_do:["Hàng date / cận date","Hàng thời vụ"], don_vi:["Viettel Post","Nhất Tín","Khác"], today }),
    "vanchuyen.api.thu_hoi.search_customers": () => [{name:"COOP", customer_name:"Saigon Co.op", customer_group:"MT"}],
    "vanchuyen.api.thu_hoi.get_dia_chi": (a) => ADDR.filter(x => !a.tim || x.ten.toLowerCase().includes(String(a.tim).toLowerCase())),
    "vanchuyen.api.thu_hoi.save_lo": (a) => {
      const p = JSON.parse(a.payload);
      const n = a.name || ("TH-2026-000" + (seq++));
      const d = ADDR.find(x => x.name === p.shipping_address_name) || {};
      lots[n] = Object.assign(lots[n] || { trang_thai:"Tạo yêu cầu", chang:"Tạo yêu cầu", files:[], khoa_ke_toan:false, co_ke_toan:true },
        p, { name:n, customer_name:"Saigon Co.op", ten_diem:d.ten, ma_diem:d.ma, dia_chi:d.dia_chi });
      return detail(n);
    },
    "vanchuyen.api.thu_hoi.chuyen_chang": (a) => { lots[a.name].trang_thai = lots[a.name].chang = a.trang_thai; return detail(a.name); },
    "vanchuyen.api.thu_hoi.huy_lo": (a) => {
      const l = lots[a.name];
      Object.assign(l, { huy_tu: l.trang_thai, trang_thai: "Đã hủy", chang: "Đã hủy", ly_do_huy: a.ly_do,
        huy_boi: "Điều hành", huy_luc: "2026-10-17 11:00:00" });
      return detail(a.name);
    },
    "vanchuyen.api.thu_hoi.khoi_phuc_lo": (a) => {
      const l = lots[a.name];
      Object.assign(l, { trang_thai: l.huy_tu, chang: l.huy_tu, ly_do_huy: null, huy_boi: null, huy_luc: null, huy_tu: null });
      return detail(a.name);
    },
    "vanchuyen.api.lai_xe.get_my_trips": () => [{name:"CX-1", ngay_giao:today, xe:"29C-555", trang_thai:"Đang giao", stops_giao:1, stops_total:3}],
  };
  window.__lots = lots;
  window.frappe = { csrf_token: "x", call({ method, args, callback, error }) {
    LOG.push({ method, args: clone(args || {}) });
    setTimeout(() => {
      const h = H[method];
      if (!h) { error && error({ message: "no mock " + method }); return; }
      try { callback({ message: h(args || {}) }); } catch (e) { error && error(e); }
    }, 5);
  } };
})();
"""

UPLOADS = []  # tên file nhận được ở upload_dinh_kem
CTYPE = {".js": "text/javascript", ".css": "text/css"}


def make_handler(imap, body):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_a):
            pass

        def _send(self, code, data, ctype):
            b = data if isinstance(data, bytes) else data.encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/page":
                ctx = json.loads(parse_qs(u.query)["ctx"][0])
                return self._send(200, page_html(imap, body, ctx), "text/html; charset=utf-8")
            if u.path == "/mock.js":
                return self._send(200, MOCK_JS, "text/javascript")
            if u.path == "/x.jpg":
                return self._send(200, PNG_1x1, "image/png")
            if u.path.startswith(BASE + "/"):
                f = os.path.normpath(os.path.join(PUB, u.path[len(BASE) + 1:]))
                if not f.startswith(PUB + os.sep) or not os.path.isfile(f):
                    return self._send(404, "404", "text/plain")
                with open(f, "rb") as fh:
                    return self._send(200, fh.read(), CTYPE.get(os.path.splitext(f)[1], "text/plain"))
            return self._send(404, "404", "text/plain")

        def do_POST(self):
            u = urlparse(self.path)
            n = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(n) if n else b""
            if u.path == "/api/method/vanchuyen.api.thu_hoi.upload_dinh_kem":
                ten = re.findall(rb'filename="([^"]*)"', raw)
                ten = ten[0].decode("utf-8", "replace") if ten else "?"
                UPLOADS.append(ten)
                ext = ten.rsplit(".", 1)[-1].lower() if "." in ten else ""
                files = [{"name": "F%d" % i, "file_name": t, "ext": t.rsplit(".", 1)[-1].lower(),
                          "is_image": False, "url": "/x.jpg"} for i, t in enumerate(UPLOADS)]
                return self._send(200, json.dumps({"message": {"files": files, "so_dinh_kem": len(files), "ext": ext}},
                                                  ensure_ascii=False), "application/json")
            return self._send(404, json.dumps({"exception": "no mock " + u.path}), "application/json")

    return Handler


DIEU_HANH = {"user": "dh@x", "full_name": "Điều hành", "is_dieu_hanh": True, "is_dieu_phoi": False,
             "is_lai_xe": False, "is_admin": False, "assetVersion": "1"}
LAI_XE = {"user": "lx@x", "full_name": "Hùng", "is_lai_xe": True, "driver_name": "DRV-A", "assetVersion": "1"}


def run(pw, exe, root, shots, ok, bad):
    """Ghi THẲNG vào `ok` / `bad` của người gọi: kịch bản có dừng giữa chừng thì các mục đã
    đỏ trước đó vẫn còn để in — chỉ in "dừng giữa chừng" là giấu mất mục nói đúng bệnh."""
    shell = open(os.path.join(PUB, "shell.js"), encoding="utf-8").read()
    build = re.search(r'const BUILD = "([^"]+)"', shell).group(1)

    def expect(label, cond, detail=""):
        (ok if cond else bad).append(label + (f"  ({detail})" if detail else ""))

    browser = pw.chromium.launch(executable_path=exe)
    errs = []

    def mo(ctx, hash_, mobile=True):
        if mobile:
            pg = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        else:
            pg = browser.new_page(viewport={"width": 1280, "height": 900})

        def on_console(msg):
            src = (msg.location or {}).get("url", "")
            if msg.type == "error" and not src.endswith("/favicon.ico"):
                errs.append(f"console: {msg.text} @ {src}")

        def on_response(r):
            if r.status >= 400 and not r.url.endswith("/favicon.ico"):
                errs.append(f"HTTP {r.status} {r.url}")

        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", on_console)
        pg.on("response", on_response)
        pg.on("dialog", lambda d: d.accept())
        pg.set_default_timeout(5000)  # thiếu phần tử thì đỏ sau 5 giây, không treo 30 giây
        c = dict(ctx, shellBuild=build)
        pg.goto(f"{root}/page?ctx={json.dumps(c)}{hash_}")
        pg.wait_for_timeout(700)
        return pg

    def calls(pg, m):
        return pg.evaluate("(m) => window.__calls.filter((c) => c.method === m)", m)

    # 1. Danh sách
    p = mo(DIEU_HANH, "#/thu-hoi")
    the = p.text_content(".vc-list")
    expect("list: thẻ lô hiện đơn vị thu hồi · vận đơn · ngày thu",
           "Viettel Post · VĐ VTP123 · thu 18/10/2026" in the, the[:120])
    expect("list: ô tìm nói tìm được mã vận đơn",
           "mã vận đơn" in (p.get_attribute("#th-search", "placeholder") or ""))
    expect("list: không còn chữ 'lái xe' / 'giao xe'", "lái xe" not in the.lower() and "giao xe" not in the.lower())
    if shots:
        p.screenshot(path=os.path.join(shots, "vc_list.png"), full_page=True)
    p.close()

    # 2. Tạo lô mới: khách → điểm (danh sách thu lại) → dán mail → đơn vị thu hồi → file
    p = mo(DIEU_HANH, "#/thu-hoi/new")
    p.fill("#th-cust-q", "co")
    p.wait_for_timeout(500)
    p.click('[data-cust="COOP"]')
    p.wait_for_timeout(300)
    expect("chọn khách xong: danh sách điểm mở sẵn", len(p.query_selector_all("[data-addr]")) == 2)
    p.click('[data-addr="ADDR-TL"]')
    p.wait_for_timeout(200)
    expect("chọn điểm xong: danh sách THU LẠI (không còn ô tìm / danh sách điểm)",
           p.query_selector("#th-diem-q") is None and not p.query_selector_all("[data-addr]"))
    expect("chọn điểm xong: còn thẻ điểm + nút 'Đổi điểm'",
           "Co.opMart Thắng Lợi" in p.text_content("#th-khach") and p.query_selector("#th-doi-diem") is not None)
    p.click("#th-doi-diem")
    p.wait_for_timeout(300)
    expect("bấm 'Đổi điểm': mở lại danh sách + nút giữ điểm cũ",
           len(p.query_selector_all("[data-addr]")) == 2 and p.query_selector("#th-giu-diem") is not None)
    p.click("#th-giu-diem")
    p.wait_for_timeout(150)
    expect("'Giữ điểm cũ': thu lại, vẫn điểm cũ",
           p.query_selector("#th-diem-q") is None and "Thắng Lợi" in p.text_content("#th-khach"))
    p.click("#th-doi-diem")
    p.wait_for_timeout(300)
    p.click('[data-addr="ADDR-HD"]')
    p.wait_for_timeout(150)
    expect("đổi sang điểm khác: thu lại với điểm mới",
           p.query_selector("#th-diem-q") is None and "Hà Đông" in p.text_content("#th-khach"))
    dan = "\tMã hàng\tTên hàng\tSL\nBDX-170\tBánh đậu xanh 170g\t48\nBDX-300\tBánh đậu xanh 300g\t12"
    p.fill('[data-f="chi_tiet_hang"]', dan)
    p.select_option('[data-f="don_vi_thu_hoi"]', "Nhất Tín")
    p.fill('[data-f="ma_van_don"]', "NT-999")
    p.fill('[data-f="ngay_hen_lay"]', "2026-10-19")
    form = p.text_content("main")
    expect("form không còn lái xe / xe / chuyến / bảng hàng khai",
           not p.query_selector('[data-f="lai_xe"], [data-f="xe"], [data-f="chuyen_xe"], #th-item-q, #th-items')
           and "Lái xe" not in form)
    accept = p.get_attribute("#th-file", "accept") or ""
    expect("ô chọn file mở cho Excel / Word / mail", all(x in accept for x in (".xlsx", ".xls", ".docx", ".eml", ".msg")),
           accept)
    p.set_input_files("#th-file", [
        {"name": "ds-hang.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "buffer": b"PK\x03\x04excel"},
        {"name": "xem-ngay.html", "mimeType": "text/html", "buffer": b"<script>alert(1)</script>"},
    ])
    p.wait_for_timeout(200)
    files_txt = p.text_content("#th-files")
    expect("file .html bị gạt ngay ở máy, Excel vào hàng chờ gửi",
           "ds-hang.xlsx" in files_txt and "xem-ngay.html" not in files_txt
           and "xem-ngay.html" in (p.text_content("#vc-toast-mount") or ""), files_txt)
    if shots:
        p.screenshot(path=os.path.join(shots, "vc_new.png"), full_page=True)
    p.click("#th-save")
    p.wait_for_timeout(900)
    sv = calls(p, "vanchuyen.api.thu_hoi.save_lo")
    pl = json.loads(sv[0]["args"]["payload"]) if sv else {}
    expect("lưu: chi tiết hàng đi NGUYÊN VĂN (còn tab giữa các cột)", pl.get("chi_tiet_hang") == dan,
           repr(pl.get("chi_tiet_hang"))[:80])
    expect("lưu: đơn vị thu hồi + mã vận đơn + ngày thu + điểm mới",
           (pl.get("don_vi_thu_hoi"), pl.get("ma_van_don"), pl.get("ngay_hen_lay"), pl.get("shipping_address_name"))
           == ("Nhất Tín", "NT-999", "2026-10-19", "ADDR-HD"), str({k: pl.get(k) for k in ("don_vi_thu_hoi", "ma_van_don")}))
    expect("lưu: payload không còn lái xe / xe / chuyến / items",
           not ({"lai_xe", "xe", "chuyen_xe", "items"} & set(pl)), str(sorted(pl)))
    expect("tạo xong: chỉ gửi file Excel, gửi NGUYÊN tên (không bị đổi thành .jpg)", UPLOADS == ["ds-hang.xlsx"],
           str(UPLOADS))
    expect("tạo xong: URL sang mã lô thật, điểm vẫn thu gọn",
           p.evaluate("location.hash").startswith("#/thu-hoi/TH-2026-0003") and p.query_selector("#th-doi-diem") is not None)
    p.close()

    # 3. Lô có sẵn: thẻ đầu, file, chi tiết hàng
    p = mo(DIEU_HANH, "#/thu-hoi/TH-2026-0001")
    head = p.text_content(".vc-detail-list")
    expect("lô: thẻ đầu ghi đơn vị thu hồi · vận đơn · ngày thu", "Viettel Post · VĐ VTP123 · thu 18/10/2026" in head, head)
    expect("lô: mở ra là điểm THU GỌN (chưa tải danh sách điểm)",
           p.query_selector("#th-doi-diem") is not None and not calls(p, "vanchuyen.api.thu_hoi.get_dia_chi"))
    expect("lô: ô dán giữ tab", p.input_value('[data-f="chi_tiet_hang"]') == "\tMã hàng\tSL\nBDX-170\t48")
    xl = p.query_selector('.vc-th-file a[href*="file=F2"]')
    pdf = p.query_selector('.vc-th-file a[href*="file=F1"]')
    expect("thẻ file Excel: biểu tượng Excel + tải về (download)",
           xl is not None and xl.get_attribute("download") == "ds-hang.xlsx"
           and xl.query_selector(".fa-file-excel") is not None)
    expect("thẻ file PDF: mở tab mới, biểu tượng PDF",
           pdf is not None and pdf.get_attribute("target") == "_blank" and pdf.query_selector(".fa-file-pdf") is not None)
    if shots:
        p.screenshot(path=os.path.join(shots, "vc_lo.png"), full_page=True)
    p.close()

    # 4. Lô kế toán đã kiểm: khóa khách / điểm
    p = mo(DIEU_HANH, "#/thu-hoi/TH-2026-0002")
    expect("lô kế toán đã kiểm: không đổi khách / điểm",
           not p.query_selector("#th-doi-khach, #th-doi-diem, #th-diem-q, #th-cust-q")
           and "Kế toán đã mở phiếu kiểm" in p.text_content("main"))
    expect("lô kế toán đã kiểm: KHÔNG có nút Hủy, chỉ đường nhờ kế toán xóa phiếu kiểm trước",
           p.query_selector("#th-huy") is None and "xóa phiếu kiểm trước" in p.text_content("main"))
    p.close()

    # 4b. Hủy yêu cầu → lô chỉ xem → Khôi phục; danh sách đếm đúng
    p = mo(DIEU_HANH, "#/thu-hoi/TH-2026-0009")
    expect("lô chưa kế toán kiểm: có nút 'Hủy yêu cầu'", p.query_selector("#th-huy") is not None)
    p.click("#th-huy")
    p.wait_for_timeout(200)
    p.click("#th-huy-ok")  # chưa ghi lý do
    p.wait_for_timeout(200)
    expect("hủy chưa ghi lý do: KHÔNG gọi server, nhắc ghi lý do",
           not calls(p, "vanchuyen.api.thu_hoi.huy_lo") and "lý do" in (p.text_content("#vc-toast-mount") or ""))
    p.click('[data-goi-y="Siêu thị rút yêu cầu trả hàng"]')
    expect("chạm gợi ý: điền sẵn lý do (sửa tiếp được)", p.input_value("#th-ly-do-huy") == "Siêu thị rút yêu cầu trả hàng")
    if shots:
        p.screenshot(path=os.path.join(shots, "vc_huy_hoi.png"))
    p.click("#th-huy-ok")
    p.wait_for_timeout(500)
    hc = calls(p, "vanchuyen.api.thu_hoi.huy_lo")
    expect("hủy: gửi lý do lên server", len(hc) == 1 and hc[0]["args"].get("ly_do") == "Siêu thị rút yêu cầu trả hàng",
           str(hc))
    m = p.text_content("main")
    expect("lô hủy: khung 'Đã hủy yêu cầu' + ai + lý do + nút 'Khôi phục về' đúng chặng cũ",
           "Đã hủy yêu cầu" in m and "Điều hành" in m and "Siêu thị rút yêu cầu trả hàng" in m
           and 'Khôi phục về "Đã lấy hàng"' in m)
    expect("lô hủy chỉ xem: ô nhập khóa, không nút Lưu / chuyển chặng / Hủy",
           p.is_disabled('[data-f="so_phieu_sieu_thi"]') and p.is_disabled('[data-f="don_vi_thu_hoi"]')
           and p.query_selector("#th-save") is None and not p.query_selector("[data-chang]")
           and p.query_selector("#th-huy") is None and p.query_selector("#th-doi-diem") is None)
    expect("lô hủy: ô mail dán vẫn đọc / cuộn / copy được (readonly, không disabled)",
           p.get_attribute('[data-f="chi_tiet_hang"]', "readonly") is not None and not p.is_disabled('[data-f="chi_tiet_hang"]'))
    expect("lô hủy: vẫn đính kèm thêm được (mail hủy của siêu thị đến sau)", not p.is_disabled("#th-file"))
    if shots:
        p.screenshot(path=os.path.join(shots, "vc_huy.png"), full_page=True)
    p.click("#th-khoiphuc")
    p.wait_for_timeout(200)
    p.click("[data-vc-ok]")
    p.wait_for_timeout(500)
    expect("khôi phục: về 'Đã lấy hàng', sửa được lại, có lại nút Hủy",
           len(calls(p, "vanchuyen.api.thu_hoi.khoi_phuc_lo")) == 1 and not p.is_disabled('[data-f="so_phieu_sieu_thi"]')
           and p.query_selector("#th-huy") is not None and "Đã lấy hàng" in p.text_content(".vc-order-head .vc-badge"))
    p.click("#th-huy")
    p.wait_for_timeout(200)
    p.fill("#th-ly-do-huy", "Lập trùng lô với TH-2026-0001")
    p.click("#th-huy-ok")
    p.wait_for_timeout(500)
    p.evaluate("location.hash = '#/thu-hoi'")
    p.wait_for_timeout(600)
    pills = p.text_content("#th-pills")
    expect("danh sách: 'Đang mở' KHÔNG đếm lô hủy, có pill 'Đã hủy (1)', 'Tất cả' đếm đủ",
           "Đang mở (2)" in pills and "Đã hủy (1)" in pills and "Tất cả (3)" in pills, pills)
    expect("danh sách 'Đang mở' không hiện lô hủy", "TH-2026-0009" not in p.text_content("#th-list"))
    p.click('#th-pills [data-f="Đã hủy"]')
    p.wait_for_timeout(500)
    ds = p.text_content("#th-list")
    expect("pill 'Đã hủy': thẻ lô có huy hiệu đỏ + 🚫 lý do, không nút chuyển chặng",
           "Lập trùng lô với TH-2026-0001" in ds and p.query_selector("#th-list .vc-badge-danger") is not None
           and not p.query_selector("#th-list [data-tien]"), ds[:160])
    if shots:
        p.screenshot(path=os.path.join(shots, "vc_list_huy.png"), full_page=True)
    p.close()

    # 5. Lái xe: không còn khối lấy hàng thu hồi
    p = mo(LAI_XE, "#/chuyen")
    expect("lái xe #/chuyen: không còn khối 'Lấy hàng thu hồi', không gọi API thu hồi",
           "Lấy hàng thu hồi" not in p.text_content("main")
           and not [c for c in p.evaluate("window.__calls") if ".thu_hoi." in c["method"]])
    p.close()

    # 6. Máy tính
    d = mo(DIEU_HANH, "#/thu-hoi/TH-2026-0001", mobile=False)
    sw = d.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    expect("máy tính 1280: màn lô không cuộn ngang", sw[0] <= sw[1], str(sw))
    if shots:
        d.screenshot(path=os.path.join(shots, "vc_lo_desk.png"), full_page=True)
    d.close()

    expect("không lỗi trang / console / HTTP", not errs, " | ".join(errs))
    browser.close()


def main():
    shots = None
    if "--shots" in sys.argv:
        shots = sys.argv[sys.argv.index("--shots") + 1]
        os.makedirs(shots, exist_ok=True)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return _bo_qua("chưa cài `playwright`")
    exe = chromium_path()
    if not exe:
        return _bo_qua("không tìm thấy Chromium ở /opt/pw-browsers")

    imap, body = build_page_parts()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(imap, body))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    root = "http://127.0.0.1:%d" % srv.server_address[1]
    ok, bad = [], []
    try:
        with sync_playwright() as pw:
            try:
                run(pw, exe, root, shots, ok, bad)
            except Exception as e:  # noqa: BLE001 — kẹt bước nào thì nói bước đó, không traceback trần
                bad.append(f"kịch bản dừng giữa chừng: {type(e).__name__}: {str(e).splitlines()[0]}")
    finally:
        srv.shutdown()

    print("=" * 82)
    print("THU HỒI (vanchuyen) — MÀN HÌNH THẬT TRONG CHROMIUM (portal thật, server giả)")
    print("=" * 82)
    for x in ok:
        print("  ✅ " + x)
    for x in bad:
        print("  ❌ " + x)
    print("=" * 82)
    if bad:
        print(f"KẾT QUẢ: ĐỎ — {len(bad)} mục")
        return 1
    print(f"KẾT QUẢ: ĐẠT {len(ok)}/{len(ok)} — điểm thu gọn sau khi chọn, dán mail nguyên văn, đơn vị thu hồi, "
          "đính kèm Excel/Word an toàn, lái xe không còn khối thu hồi")
    return 0


if __name__ == "__main__":
    sys.exit(main())
