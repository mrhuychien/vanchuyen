# Quản lý xe — tab `#/quan-ly-xe` trên portal `/vc`

Quản lý **xe tải / xe con**: lịch đăng kiểm, lịch thay dầu, nhật ký bảo dưỡng &
sửa chữa (kèm chi phí, ảnh hoá đơn / giấy chứng nhận). **Chỉ xe tải** hiện ở màn
Xếp chuyến — xe con ẩn cho đỡ rối.

## 1. Ai dùng

| Nhóm | Vào được | Ghi chú |
|---|---|---|
| Tổ trưởng (role `Điều Phối Vận Chuyển` / cờ Driver tổ trưởng) | ✅ | người dùng chính |
| Điều hành (có quyền ghi Sales Invoice) | ✅ | cùng cổng với các view điều hành |
| Quản trị viên | ✅ | |
| Lái xe thường | ❌ | không thấy tab, API chặn `PermissionError` |

Guard: `api/guards.py::require_quan_ly_xe` — dòng đầu mọi method của `api/quan_ly_xe.py`.

## 2. Data model

### 2.1 Custom Field trên `Vehicle` (ship qua fixtures, fieldname ASCII)

| fieldname | Loại | Ý nghĩa |
|---|---|---|
| `custom_loai_xe` | Select `Xe tải\nXe con`, mặc định `Xe tải` | **Trống = xe tải** (xe có trước trường này) |
| `custom_ngay_cap_nhat_km` | Date, read-only | ngày đọc số km (`last_odometer`) gần nhất |
| `custom_chu_ky_dang_kiem` | Select `6 tháng / 1 năm / 2 năm / Ngày cụ thể` | |
| `custom_ngay_dang_kiem` | Date | lần đăng kiểm gần nhất |
| `custom_han_dang_kiem` | Date | chu kỳ cố định → **máy tính** = gần nhất + chu kỳ; `Ngày cụ thể` → nhập tay |
| `custom_thay_dau_moi_km` / `_moi_thang` | Int | chu kỳ thay dầu — đặt cả hai thì mốc nào tới trước tính mốc đó |
| `custom_ngay_thay_dau` / `custom_km_thay_dau` | Date / Int | lần thay dầu gần nhất |

(+ 1 Section Break, 1 Column Break để form Vehicle trên Desk gọn.)

`doc_events["Vehicle"]["validate"]` → `nhat_ky_xe.vehicle_validate`: sửa chu kỳ / ngày
trên Desk thì hạn đăng kiểm vẫn tự tính lại. Hook **không throw** — nó chạy cho mọi
lần lưu Vehicle của mọi app.

### 2.2 DocType mới `Nhat Ky Xe` (`NKX-.YYYY.-.####`)

`xe` · `loai` (Đăng kiểm / Thay dầu / Bảo dưỡng / Sửa chữa) · `ngay` · `so_km` ·
`chi_phi` · `noi_thuc_hien` · `noi_dung` · `ghi_chu` · `dinh_kem` · `han_tiep` · `km_tiep`.
`xe`, `loai` set-only-once (muốn đổi: xoá rồi ghi lại).

## 3. Quy tắc lịch (khai ở ĐÚNG MỘT CHỖ: `nhat_ky_xe.py`)

- **Cộng tháng lịch, kẹp cuối tháng**: 31/08 + 6 tháng = 28/02 (29/02 năm nhuận). Không dùng `30 × n` ngày.
- **Mức cảnh báo**: hết hạn HÔM NAY vẫn là *sắp đến hạn* (giấy còn giá trị tới hết ngày);
  km chạm mốc là *quá hạn*. Ngưỡng *sắp đến hạn*: đăng kiểm 30 ngày, thay dầu / bảo dưỡng
  15 ngày hoặc 500 km — đổi qua `site_config`: `qlx_canh_bao_dang_kiem_ngay`,
  `qlx_canh_bao_ngay`, `qlx_canh_bao_km`.
- **Nhật ký đẩy lịch**: ghi Đăng kiểm / Thay dầu MỚI NHẤT → lịch xe tiến lên. Nhập bù một lần
  cũ hơn mốc đang có → lịch KHÔNG lùi. Xoá / sửa đúng bản ghi đang làm mốc → lịch lùi về bản
  liền trước; hết bản ghi → lịch **trống** (thà báo "chưa có dữ liệu" còn hơn giữ ngày của bản đã xoá).
- **Bảo dưỡng** không lưu lịch trên xe: "hẹn lần sau" (ngày / km) đọc thẳng từ bản ghi bảo dưỡng mới nhất.
- **Số km** chỉ tiến qua nhật ký (bản ghi có km lớn hơn số đang lưu). Sửa lùi khi gõ nhầm: nút
  "Cập nhật km" (portal hỏi lại). `last_odometer` là set-only-once nên ghi bằng `db.set_value`
  (cùng cách HRMS Vehicle Log).

## 4. Xếp chuyến

`dieu_phoi.get_vehicles` chỉ trả **xe tải** — lọc ở Python (`nhat_ky_xe.loai_xe`), KHÔNG lọc
`!= 'Xe con'` trong SQL (NULL rơi mất → xe cũ biến khỏi Xếp chuyến). Nút chọn xe kèm cảnh báo
**gấp**: đăng kiểm quá hạn / còn ≤ 7 ngày, quá hạn thay dầu. Nháp cũ mang xe nay là xe con vẫn
hiện chip xe đó ("không phải xe tải") để người dùng thấy xe đang chọn. Server **không chặn**
xe con trên chuyến — việc lọc là cho đỡ rối, không phải luật nghiệp vụ.

## 5. API (`vanchuyen/api/quan_ly_xe.py`)

| Method | Việc |
|---|---|
| `list_vehicles()` | mọi xe + lịch + mức cảnh báo + chi phí năm nay |
| `get_vehicle(name)` | chi tiết + chi phí theo hạng mục + trang đầu nhật ký |
| `list_logs(xe, loai, page, page_size)` | nhật ký, lọc hạng mục, phân trang server |
| `save_vehicle(payload)` | thêm / sửa xe (loại, hãng, dòng, nhiên liệu, thể tích). Không sửa biển số, km, phụ phí xe |
| `update_km(xe, km)` | ghi số km đồng hồ |
| `save_lich(xe, hang_muc, payload)` | cài / sửa tay lịch đăng kiểm hoặc thay dầu |
| `add_log / update_log / delete_log` | nhật ký (kèm cấu hình lịch khi ghi lần đầu) |
| `upload_anh(name)` | ảnh hoá đơn / giấy chứng nhận (public, tên file ngẫu nhiên) |

## 6. Deploy

```bash
bench --site <site> migrate          # tạo DocType Nhat Ky Xe + 11 custom field Vehicle
bench build --app vanchuyen
bench restart
```
Xe đang có tự thành **Xe tải** (cột mới có DEFAULT; kể cả NULL thì code vẫn coi là xe tải).
Sau deploy vào **Quản lý xe** → đổi các xe con sang "Xe con" → cài lịch đăng kiểm / thay dầu.

## 7. Nghiệm thu trên staging

1. Tab "Quản lý xe" hiện cho tổ trưởng / điều hành; lái xe thường không thấy, gọi API bị `PermissionError`.
2. Đổi một xe thành **Xe con** → biến khỏi Xếp chuyến; các xe cũ (chưa chọn loại) vẫn ở đó.
3. Cài đăng kiểm "1 năm", ngày gần nhất 20/10/2025 → hạn 20/10/2026; đổi sang "6 tháng" → hạn 20/04/2026 ngay.
4. "Ngày cụ thể" → phải nhập hạn; hạn đó hiện đúng.
5. Ghi nhận đăng kiểm mới → lịch tiến; xoá bản ghi đó → lịch lùi về lần trước.
6. Thay dầu mỗi 5.000 km, lần trước ở 120.000; cập nhật km 125.200 → "Quá 200 km", Xếp chuyến hiện "⚠ Quá hạn thay dầu".
7. Ảnh hoá đơn tải lên xem lại được; chi phí năm cộng đúng.
8. Sửa trên Desk (form Vehicle) chu kỳ đăng kiểm → hạn tự tính lại.

## 8. Kiểm không cần bench

```bash
python3 docs/verified/quan_ly_xe_check.py   # lịch, đồng bộ nhật ký, lọc xe tải, JS xem trước = server
```
