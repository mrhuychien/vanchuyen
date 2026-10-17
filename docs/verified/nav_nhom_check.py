#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nav_nhom_check — MENU NGANG TRÊN CÙNG: nhóm "Đội xe" thu / mở, chạy thật trong Chromium.

shell.js + import map của vc.html + shell.css thật, server giả mượn của `thu_hoi_ui_check`
(màn mở để thử là #/thu-hoi, đã có dữ liệu giả).

════════════════════════════════════════════════════════════════════════════
NHỮNG ĐIỀU MENU HỨA
════════════════════════════════════════════════════════════════════════════

1. **Gom 5 màn đội xe vào "Đội xe"**: Xếp chuyến, Tài khoản, Chuyến của tôi, Quản lý xe,
   Trả cước — đúng thứ tự đó; các mục khác (Tổng quan, Điều hành, Nhập đơn, Sự cố, Thu
   hồi) vẫn nằm ngoài nhóm.
2. **Mặc định THU LẠI.** Bấm thì mở rộng / bấm lại thì thu; trạng thái nhớ qua lần tải lại
   (theo từng máy). Trình duyệt chặn lưu trữ thì vẫn chạy, chỉ là không nhớ.
3. **Đang ở màn con mà nhóm thu lại → nút nhóm sáng** (biết mình đang ở đâu).
4. **Người chỉ thấy một mục của nhóm** (lái xe: "Chuyến của tôi") thì hiện thẳng mục đó,
   không bắt bấm mở nhóm.
5. **Mở nhóm = thêm HÀNG THỨ HAI dưới header** (5 mục con), hàng trên giữ nguyên độ dài nên
   không bao giờ tràn ở 1280 / 1024 / 820px; nội dung lùi xuống theo, không bị header che.
   Cửa sổ hẹp mà menu vẫn dài: cuộn ngang trong thanh (lăn chuột cũng cuộn), viên thuốc không
   bẻ chữ 2 dòng, nút làm mới / tài khoản luôn trong màn hình.
6. Thanh dưới trên điện thoại giữ nguyên (không nhóm). Không lỗi JS.

Thử phá (đã làm khi viết): đổi mặc định thành mở, bỏ lưu trạng thái, bỏ `white-space: nowrap`
/ `overflow-x: auto` của menu, bỏ đèn nút nhóm, bỏ biến cao header khi mở — mỗi lần đỏ ĐÚNG mục.

Chạy KHÔNG cần bench (cần `pip install playwright`; Chromium có sẵn ở /opt/pw-browsers):
    python3 docs/verified/nav_nhom_check.py [--shots THƯ_MỤC]
Không có trình duyệt thì BỎ QUA (thoát 0).
"""

import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thu_hoi_ui_check import build_page_parts, chromium_path, make_handler  # noqa: E402

NHOM = ["Xếp chuyến", "Tài khoản", "Chuyến của tôi", "Quản lý xe", "Trả cước"]
NGOAI = ["Tổng quan", "Điều hành", "Nhập đơn", "Sự cố", "Thu hồi"]
DU_VAI_TRO = {"user": "ad@x", "full_name": "Quản trị", "is_dieu_hanh": True, "is_dieu_phoi": True,
              "is_lai_xe": True, "is_admin": True, "assetVersion": "1"}
LAI_XE = {"user": "lx@x", "full_name": "Hùng", "is_lai_xe": True, "driver_name": "DRV-A", "assetVersion": "1"}
KHOA = "vc_nav_mo_doi_xe"

# Trạng thái menu đọc từ DOM: mục nào hiện, nhóm mở chưa, header cao bao nhiêu, nút tài khoản
# có trong màn hình không, nội dung có bị header che không.
DOC_JS = """(() => {
  const q = (s) => document.querySelector(s), hien = (e) => !!(e && e.offsetParent);
  const b = q('.vc-nav-group-btn'), nav = q('.vc-desktop-nav'), acc = q('#vc-account'), hd = q('.vc-header');
  const pills = [...document.querySelectorAll('.vc-desktop-nav a, .vc-nav-group-btn, .vc-subnav a')].filter(hien);
  return {
    co_nhom: !!b, mo: b ? b.getAttribute('aria-expanded') : null, sang: !!(b && b.classList.contains('vc-has-active')),
    trong_nhom: [...document.querySelectorAll('#vc-nhom-doi_xe a')].map((a) => a.textContent.trim()),
    hien_trong_nhom: [...document.querySelectorAll('#vc-nhom-doi_xe a')].filter(hien).length,
    ngoai_nhom: [...document.querySelectorAll('.vc-desktop-nav > a')].map((a) => a.textContent.trim()),
    cao: Math.max(0, ...pills.map((e) => e.getBoundingClientRect().height)),
    nav: [nav.scrollWidth, nav.clientWidth],
    header: hd.getBoundingClientRect().height,
    noi_dung_top: q('#vc-view').getBoundingClientRect().top + scrollY,
    acc_phai: acc.getBoundingClientRect().right, rong: innerWidth,
    luu: (() => { try { return localStorage.getItem('%s'); } catch (e) { return 'chặn'; } })(),
  };
})()""" % KHOA
# Trang thử không nạp Font Awesome (CDN) — giữ chỗ bề rộng icon như thật, đo menu mới đúng.
ICON_GIU_CHO = ".vc-app .fas { display: inline-block; width: 1.15em; }"


def _bo_qua(msg):
    print("=" * 82)
    print("MENU NGANG — NHÓM ĐỘI XE (Chromium)")
    print("=" * 82)
    print(f"  ⚠ BỎ QUA — {msg}")
    print("    Cài: pip install playwright  (Chromium đã có sẵn ở /opt/pw-browsers)")
    print("=" * 82)
    print("KẾT QUẢ: BỎ QUA — không có trình duyệt, KHÔNG kết luận gì")
    return 0


def run(pw, exe, root, shots, ok, bad):
    def expect(label, cond, detail=""):
        (ok if cond else bad).append(label + (f"  ({detail})" if detail else ""))

    browser = pw.chromium.launch(executable_path=exe)
    errs = []

    def trang(ctx, hash_="#/thu-hoi", w=1280, chan_luu=False, ctx_moi=None):
        c = ctx_moi or browser.new_context(viewport={"width": w, "height": 800})
        if chan_luu:
            c.add_init_script("""(() => { const no = () => { throw new DOMException('blocked', 'SecurityError'); };
              Storage.prototype.getItem = no; Storage.prototype.setItem = no; })();""")
        pg = c.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.set_default_timeout(5000)
        pg.goto(f"{root}/page?ctx={json.dumps(ctx)}{hash_}")
        pg.add_style_tag(content=ICON_GIU_CHO)
        pg.wait_for_timeout(600)
        return c, pg

    # 1–2. Người đủ vai trò, máy mới: thu lại; bấm mở; tải lại vẫn mở; bấm thu; tải lại vẫn thu
    c, p = trang(DU_VAI_TRO)
    d = p.evaluate(DOC_JS)
    expect("có nhóm 'Đội xe' gồm đúng 5 màn, đúng thứ tự", d["co_nhom"] and d["trong_nhom"] == NHOM, str(d["trong_nhom"]))
    expect("các mục còn lại nằm ngoài nhóm", d["ngoai_nhom"] == NGOAI, str(d["ngoai_nhom"]))
    expect("mặc định THU LẠI: 5 mục con ẩn", d["mo"] == "false" and d["hien_trong_nhom"] == 0, str(d["mo"]))
    expect("nút nhóm ghi 'Đội xe'", "Đội xe" in p.text_content(".vc-nav-group-btn"))
    if shots:
        p.screenshot(path=os.path.join(shots, "nav_thu.png"))
    expect("mặc định: header 1 hàng (56px)", abs(d["header"] - 56) < 1, "%.0f" % d["header"])
    p.click(".vc-nav-group-btn")
    d = p.evaluate(DOC_JS)
    expect("bấm 'Đội xe' -> mở rộng, hiện đủ 5 mục", d["mo"] == "true" and d["hien_trong_nhom"] == 5)
    expect("mở: 5 mục thành HÀNG THỨ HAI, header cao thêm, nội dung lùi xuống không bị che",
           abs(d["header"] - 104) < 1 and d["noi_dung_top"] >= d["header"] and len(d["ngoai_nhom"]) == 5,
           f"header {d['header']:.0f}px, nội dung từ {d['noi_dung_top']:.0f}px")
    expect("mở xong thì nhớ (localStorage = 1)", d["luu"] == "1", str(d["luu"]))
    p.click("#vc-account")
    top_menu = p.evaluate("document.querySelector('#vc-acct-menu').getBoundingClientRect().top")
    expect("mở nhóm: menu tài khoản bung DƯỚI header 2 hàng, không đè hàng mục con",
           top_menu >= d["header"], f"menu từ {top_menu:.0f}px, header {d['header']:.0f}px")
    p.click("#vc-account")
    if shots:
        p.screenshot(path=os.path.join(shots, "nav_mo.png"))
    p.reload()
    p.add_style_tag(content=ICON_GIU_CHO)
    p.wait_for_timeout(600)
    d = p.evaluate(DOC_JS)
    expect("tải lại trang: nhóm VẪN MỞ", d["mo"] == "true" and d["hien_trong_nhom"] == 5, str(d["mo"]))
    p.click("text=Trả cước")
    p.wait_for_timeout(500)
    d = p.evaluate(DOC_JS)
    expect("bấm mục con -> sang đúng màn, nhóm vẫn mở", p.evaluate("location.hash") == "#/tra-cuoc" and d["mo"] == "true")
    p.click(".vc-nav-group-btn")
    d = p.evaluate(DOC_JS)
    expect("bấm lại -> thu lại, nhớ (localStorage = 0)", d["mo"] == "false" and d["hien_trong_nhom"] == 0 and d["luu"] == "0",
           str(d["luu"]))
    expect("đang ở màn con (Trả cước) mà nhóm thu: nút nhóm SÁNG", d["sang"])
    p.reload()
    p.add_style_tag(content=ICON_GIU_CHO)
    p.wait_for_timeout(600)
    d = p.evaluate(DOC_JS)
    expect("tải lại trang: nhóm VẪN THU", d["mo"] == "false" and d["hien_trong_nhom"] == 0)
    p.evaluate("location.hash = '#/thu-hoi'")
    p.wait_for_timeout(500)
    d = p.evaluate(DOC_JS)
    expect("ra màn ngoài nhóm: nút nhóm hết sáng", not d["sang"])
    c.close()

    # 5. Mở nhóm ở người đủ vai trò (11 mục): header không vỡ ở 1280 / 1024 / 820
    for w in (1280, 1024, 820):
        c = browser.new_context(viewport={"width": w, "height": 800})
        c.add_init_script("try { localStorage.setItem('%s', '1'); } catch (e) {}" % KHOA)
        c, p = trang(DU_VAI_TRO, w=w, ctx_moi=c)
        d = p.evaluate(DOC_JS)
        expect(f"{w}px, nhóm mở: hàng trên VỪA thanh (không cuộn, không cắt), viên thuốc 1 dòng, tài khoản trong màn hình",
               d["mo"] == "true" and d["nav"][0] <= d["nav"][1] and d["cao"] <= 40 and d["acc_phai"] <= d["rong"],
               f"menu {d['nav']}, cao {d['cao']:.0f}px, tài khoản tới {d['acc_phai']:.0f}/{d['rong']}px")
        if shots:
            p.screenshot(path=os.path.join(shots, f"nav_mo_{w}.png"))
        c.close()

    # Cửa sổ hẹp nhất còn menu ngang (768px) mà menu vẫn dài: cuộn ngang trong thanh, không vỡ
    c = browser.new_context(viewport={"width": 768, "height": 800})
    c, p = trang(DU_VAI_TRO, w=768, ctx_moi=c)
    p.add_style_tag(content=".vc-desktop-nav a { padding: 7px 40px; }")  # ép menu dài hơn thanh
    p.wait_for_timeout(200)
    d = p.evaluate(DOC_JS)
    expect("menu dài hơn thanh: cuộn ngang TRONG thanh, viên thuốc 1 dòng, tài khoản vẫn trong màn hình",
           d["nav"][0] > d["nav"][1] and d["cao"] <= 40 and d["acc_phai"] <= d["rong"],
           f"menu {d['nav']}, cao {d['cao']:.0f}px, tài khoản tới {d['acc_phai']:.0f}/{d['rong']}px")
    p.hover(".vc-desktop-nav")
    p.mouse.wheel(0, 300)
    p.wait_for_timeout(200)
    sl = p.evaluate("document.querySelector('.vc-desktop-nav').scrollLeft")
    expect("menu dài hơn thanh: lăn chuột (dọc) trên menu thì menu cuộn ngang", sl > 0, str(sl))
    c.close()

    # 2b. Trình duyệt chặn lưu trữ: không lỗi, mặc định thu, bấm vẫn mở được
    c, p = trang(DU_VAI_TRO, chan_luu=True)
    d = p.evaluate(DOC_JS)
    expect("chặn lưu trữ: menu vẫn vẽ, mặc định thu", d["co_nhom"] and d["mo"] == "false")
    p.click(".vc-nav-group-btn")
    expect("chặn lưu trữ: bấm vẫn mở được (chỉ không nhớ)", p.evaluate(DOC_JS)["hien_trong_nhom"] == 5)
    c.close()

    # 4. Lái xe: chỉ một mục của nhóm -> hiện thẳng, không có nút nhóm
    c, p = trang(LAI_XE, "#/chuyen")
    d = p.evaluate(DOC_JS)
    expect("lái xe (một mục): không nhóm, 'Chuyến của tôi' hiện thẳng trên menu",
           not d["co_nhom"] and d["ngoai_nhom"] == ["Chuyến của tôi"], str(d["ngoai_nhom"]))
    c.close()

    # 6. Điện thoại: thanh dưới giữ nguyên, đủ mục, không nhóm
    c = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    c, p = trang(DU_VAI_TRO, ctx_moi=c)
    duoi = [x.strip() for x in p.eval_on_selector_all("#vc-bottom-nav .vc-nav-item", "els => els.map((e) => e.textContent)")]
    expect("điện thoại: thanh dưới giữ nguyên đủ 10 mục, không nhóm",
           len(duoi) == 10 and all(x in duoi for x in NHOM + NGOAI) and not p.is_visible(".vc-nav-group-btn"), str(duoi))
    c.close()

    expect("không lỗi JS trên trang", not errs, " | ".join(errs))
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
    print("MENU NGANG — NHÓM ĐỘI XE (portal thật, server giả)")
    print("=" * 82)
    for x in ok:
        print("  ✅ " + x)
    for x in bad:
        print("  ❌ " + x)
    print("=" * 82)
    if bad:
        print(f"KẾT QUẢ: ĐỎ — {len(bad)} mục")
        return 1
    print(f"KẾT QUẢ: ĐẠT {len(ok)}/{len(ok)} — gom đúng 5 màn, mặc định thu, nhớ trạng thái, "
          "nút nhóm sáng khi ở màn con, mở ra không vỡ header")
    return 0


if __name__ == "__main__":
    sys.exit(main())
