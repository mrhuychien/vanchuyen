# vanchuyen — Quản lý Chuyến Xe & Giao Hàng Tự Vận Chuyển

Frappe/ERPNext **v16** custom app. Xử lý nhánh **"Tự vận chuyển"** của Sales Invoice:
xếp đơn lên chuyến xe nội bộ, theo dõi giao hàng, stamp ngược kết quả về hóa đơn.

Build theo **kiểu NPP** (phương pháp nextcode + skills `frappe-*`). Brief đầy đủ:
[`docs/build-brief-vanchuyen.md`](docs/build-brief-vanchuyen.md).

## Kiến trúc

- **Backend** = file Python whitelisted method (`vanchuyen/api/*.py`), không Server/Client Script.
- **Data model**: DocType mới `Chuyen Xe` (+ child `Chuyen Xe Don Hang`) + 8 Custom Field ship qua fixtures
  (3 field app tự đặt: xếp chuyến / thể tích khả dụng / tài khoản portal; 5 field STAMP vận chuyển:
  chuyến xe, lái xe, tên + SĐT lái xe, xe — vanchuyen tạo & sở hữu khi cài).
- **Portal SPA** `/vc` (vanilla JS no-build, hash router, import map cache-bust) — cho Điều Phối & Lái Xe.
  Menu ngang trên máy tính gom Xếp chuyến · Tài khoản · Chuyến của tôi · Quản lý xe · Trả cước vào
  nhóm **Đội xe**: bấm để mở thành hàng thứ hai dưới header, bấm lại để thu; nhớ theo từng máy,
  mặc định thu lại. Thanh dưới trên điện thoại giữ nguyên.
- **Reconcile**: `frappe.db.set_value(update_modified=False)` stamp về Sales Invoice (không đụng timestamp kế toán).
- **Quản lý xe** (`/vc#/quan-ly-xe`): xe tải / xe con, lịch đăng kiểm (6 tháng / 1 năm / 2 năm / ngày cụ thể),
  lịch thay dầu (km và/hoặc tháng), nhật ký bảo dưỡng & sửa chữa (DocType `Nhat Ky Xe`), xe ngừng sử dụng
  (bán / nằm gara). Chỉ **xe tải còn sử dụng** hiện ở Xếp chuyến. Thiết kế + nghiệm thu:
  [`docs/quan-ly-xe.md`](docs/quan-ly-xe.md).

Quy tắc vàng của tách đơn: *phần còn lại KHÔNG phải là một record — nó là phép trừ.*
Không bao giờ clone/tách Sales Invoice.

## Cài đặt

```bash
bench get-app vanchuyen <repo-url>
bench --site <site> install-app vanchuyen
bench --site <site> migrate
bench build --app vanchuyen
bench restart
```

## Vai trò

| Role | Làm gì |
|---|---|
| `Điều Phối Vận Chuyển` | Tạo/submit/hoàn thành/hủy chuyến, xếp đơn — Desk + portal `/vc#/xep-chuyen` |
| `Lái Xe` | Xem chuyến của mình, cập nhật trạng thái điểm giao, chụp chứng từ — portal `/vc#/chuyen` |

Màn **Quản lý xe** mở cho tổ trưởng (Điều Phối), điều hành (có quyền ghi Sales Invoice) và quản trị viên;
lái xe thường không vào được.

## Thu hồi hàng — siêu thị xuất trả (`/vc#/thu-hoi`)

Một **lô thu hồi** (`Lo Thu Hoi`, `TH-.YYYY.-.####`) = một lần siêu thị gọi trả hàng:
khách + **điểm lấy hàng** (`shipping_address_name`, phải là Address của chính khách),
ngày yêu cầu, số phiếu xuất trả của siêu thị, **chi tiết hàng dán nguyên văn từ mail**
siêu thị gửi, **điều phối thu hồi** (đơn vị vận chuyển Viettel Post / Nhất Tín vào lấy:
đơn vị, mã vận đơn nếu có, ngày thu, số kiện) và **file đính kèm** — ảnh, PDF, Excel, Word,
mail (.eml/.msg), file nén; private, xem qua `thu_hoi.xem_dinh_kem` có guard (ảnh / PDF mở
trong tab, loại khác tải về). Mã hàng + số lượng chính xác do kế toán ghi lúc kiểm hàng.

| Chặng | Ai bấm | Ở đâu |
|---|---|---|
| Tạo yêu cầu → Đã lấy hàng → Đã nhận hàng | điều hành / tổ trưởng (theo tin của đơn vị thu hồi) | `#/thu-hoi` |
| Đang kiểm → Đã kiểm hàng → Đã nhập chứng từ → Xong | kế toán (app `ketoan`, phiếu `Kiem Hang Thu Hoi`) | portal `/ketoan#/thu-hoi` |

App này **chỉ đọc mềm** phiếu kiểm bên ketoan để hiện chặng tổng; khi kế toán đã mở
phiếu kiểm thì khách / điểm bị khóa, không lùi chặng, xóa hay hủy lô được nữa.

**Hủy yêu cầu** (siêu thị rút yêu cầu, lập trùng, không lấy được hàng…): lô GIỮ LẠI ở
**Đã hủy** kèm lý do (bắt buộc) · ai · lúc nào · chặng lúc hủy — không xóa. Lô hủy chỉ xem
(vẫn đính kèm thêm được), không tính vào "Đang mở"; **Khôi phục** đưa về đúng chặng cũ.

**Hủy tại chỗ** (lô hàng date báo về quá ít, siêu thị hủy luôn — không thu về): bấm **Hủy
tại chỗ (không thu)** khi lô còn *Tạo yêu cầu* → lô đi tắt sang chặng **Đã kiểm hàng**
(nhận đủ theo phiếu), không qua lấy / nhận hàng; kế toán nhập chứng từ theo phiếu / biên
bản hủy rồi lập hóa đơn trả về như thường. Bấm nhầm thì lùi về *Tạo yêu cầu* khi kế toán
chưa mở phiếu.
Thiết kế đầy đủ: [`docs/thu-hoi/blueprint-thu-hoi.md`](docs/thu-hoi/blueprint-thu-hoi.md).
Cài / cập nhật bản này cần `bench --site <site> migrate`.

## Verify trước khi ship

```bash
python3 -m py_compile vanchuyen/**/*.py
for f in vanchuyen/public/vanchuyen/**/*.js; do node --check "$f"; done
python3 .claude/skills/nextcode-build/references/validate_shipped_docs.py apps/vanchuyen/vanchuyen
python3 docs/verified/lo_nguyen_check.py     # lô nguyên (0 kiện + hộp lẻ) — chạy KHÔNG cần bench
python3 docs/verified/thu_hoi_check.py       # lô thu hồi: đúng điểm của khách, khóa khi kế toán đã kiểm
python3 docs/verified/thu_hoi_ui_check.py    # màn thu hồi trong Chromium (cần pip install playwright)
python3 docs/verified/quan_ly_xe_check.py    # lịch đăng kiểm/thay dầu + lọc xe tải còn dùng ở Xếp chuyến
python3 docs/verified/nav_nhom_check.py      # menu ngang: nhóm Đội xe thu/mở, nhớ trạng thái (Chromium)
```

`docs/verified/` là bộ kiểm chạy độc lập bằng bộ giả `frappe`: mỗi script mở đầu
bằng docstring kể **đúng con bug nó canh**, exit 0/1. Sửa vùng xếp chuyến/tách
đơn thì chạy lại, và khi thêm mục kiểm mới thì **thử phá**: bẻ mã sản xuất cho
hỏng đúng chốt đó, mục kiểm phải ĐỎ. Mục nào phá mà vẫn xanh là mục canh dối.
