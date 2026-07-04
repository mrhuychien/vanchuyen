# vanchuyen — Quản lý Chuyến Xe & Giao Hàng Tự Vận Chuyển

Frappe/ERPNext **v16** custom app. Xử lý nhánh **"Tự vận chuyển"** của Sales Invoice:
xếp đơn lên chuyến xe nội bộ, theo dõi giao hàng, stamp ngược kết quả về hóa đơn.

Build theo **kiểu NPP** (phương pháp nextcode + skills `frappe-*`). Brief đầy đủ:
[`docs/build-brief-vanchuyen.md`](docs/build-brief-vanchuyen.md).

## Kiến trúc

- **Backend** = file Python whitelisted method (`vanchuyen/api/*.py`), không Server/Client Script.
- **Data model**: DocType mới `Chuyen Xe` (+ child `Chuyen Xe Don Hang`) + 3 Custom Field ship qua fixtures.
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

## Verify trước khi ship

```bash
python3 -m py_compile vanchuyen/**/*.py
for f in vanchuyen/public/vanchuyen/**/*.js; do node --check "$f"; done
python3 .claude/skills/nextcode-build/references/validate_shipped_docs.py apps/vanchuyen/vanchuyen
```
