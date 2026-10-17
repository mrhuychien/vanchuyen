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
- **Reconcile**: `frappe.db.set_value(update_modified=False)` stamp về Sales Invoice (không đụng timestamp kế toán).

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

## Thu hồi hàng — siêu thị xuất trả (`/vc#/thu-hoi`)

Một **lô thu hồi** (`Lo Thu Hoi`, `TH-.YYYY.-.####`) = một lần siêu thị gọi trả hàng:
khách + **điểm lấy hàng** (`shipping_address_name`, phải là Address của chính khách),
ngày yêu cầu, số phiếu xuất trả của siêu thị, hàng siêu thị **khai**, giao xe, và
**file đính kèm** (private — xem qua `thu_hoi.xem_dinh_kem` có guard).

| Chặng | Ai bấm | Ở đâu |
|---|---|---|
| Tạo yêu cầu → Đã lấy hàng → Đã nhận hàng | điều hành / tổ trưởng; lái xe bấm "Đã lấy hàng" cho lô của mình | `#/thu-hoi`, `#/chuyen` |
| Đang kiểm → Đã kiểm hàng → Đã nhập chứng từ → Xong | kế toán (app `ketoan`, phiếu `Kiem Hang Thu Hoi`) | portal `/ketoan#/thu-hoi` |

App này **chỉ đọc mềm** phiếu kiểm bên ketoan để hiện chặng tổng; khi kế toán đã mở
phiếu kiểm thì khách / điểm bị khóa, không lùi chặng hay xóa lô được nữa. Thiết kế
đầy đủ: [`docs/thu-hoi/blueprint-thu-hoi.md`](docs/thu-hoi/blueprint-thu-hoi.md).
Cài bản này cần `bench --site <site> migrate` (2 DocType mới).

## Verify trước khi ship

```bash
python3 -m py_compile vanchuyen/**/*.py
for f in vanchuyen/public/vanchuyen/**/*.js; do node --check "$f"; done
python3 .claude/skills/nextcode-build/references/validate_shipped_docs.py apps/vanchuyen/vanchuyen
python3 docs/verified/lo_nguyen_check.py     # lô nguyên (0 kiện + hộp lẻ) — chạy KHÔNG cần bench
python3 docs/verified/thu_hoi_check.py       # lô thu hồi: đúng điểm của khách, khóa khi kế toán đã kiểm
```

`docs/verified/` là bộ kiểm chạy độc lập bằng bộ giả `frappe`: mỗi script mở đầu
bằng docstring kể **đúng con bug nó canh**, exit 0/1. Sửa vùng xếp chuyến/tách
đơn thì chạy lại, và khi thêm mục kiểm mới thì **thử phá**: bẻ mã sản xuất cho
hỏng đúng chốt đó, mục kiểm phải ĐỎ. Mục nào phá mà vẫn xanh là mục canh dối.
