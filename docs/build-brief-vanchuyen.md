# Build Brief — App `vanchuyen` (Quản lý Chuyến Xe & Giao Hàng Tự Vận Chuyển)

> **Câu lệnh mở màn cho Claude Code** (paste nguyên văn):
> *"Build app `vanchuyen` theo kiểu NPP (phương pháp nextcode + skills frappe-*). Đọc trước: `.claude/skills/frappe-app-build-profile`, `nextcode-build`, `frappe-portal-spa`, `frappe-app-shipping-gotchas`. Brief đầy đủ ở `docs/build-brief-vanchuyen.md`. Làm theo đúng phase, dừng chờ tôi test sau mỗi phase."*

**Nền tảng:** Frappe/ERPNext **v16** custom app, cài lên site production `a.rongvanghoanggia.com` (test trên site staging trước). Repo mới `vanchuyen`, branch `main`. Toàn bộ label/UI **tiếng Việt**; DocType name, fieldname, tên file **ASCII**.

**Chuẩn bị repo trước khi build** (người dùng làm):
- Commit bộ skill vào `.claude/skills/` (nextcode-kit + 8 nextcode-* + frappe-portal-spa, frappe-sales-analytics, frappe-app-shipping-gotchas, frappe-app-build-profile).
- Đặt trang quản lý hiện có vào `docs/legacy/quan-ly-van-chuyen.html` (nguồn tham chiếu Phase 2).
- Đặt file này vào `docs/build-brief-vanchuyen.md`.

---

## 1. Domain & nghiệp vụ

**Bối cảnh:** Công ty SX bánh đậu xanh, đơn hàng là Sales Invoice đã submit. Bộ phận điều phối gán **hình thức vận chuyển** cho từng đơn qua field `custom_hình_thức_vận_chuyển` (Select: `Chưa phân công / Nhất Tín / Viettel Post / Tự vận chuyển / Xe vào bốc`). App này xử lý nhánh **"Tự vận chuyển"**: xếp đơn lên chuyến xe nội bộ và theo dõi giao hàng.

**Actors & roles:**

| Actor | Role ERPNext | Làm gì | Thiết bị |
|---|---|---|---|
| Đội trưởng lái xe | `Điều Phối Vận Chuyển` (+ `Lái Xe` vì cũng đi giao) | **Duy nhất người tạo chuyến**, phân bổ đơn, submit/hoàn thành/hủy chuyến | Desktop + mobile |
| Lái xe | `Lái Xe` | Xem chuyến của mình, cập nhật trạng thái từng điểm giao, chụp chứng từ | Mobile |
| Admin logistics | (đã có quyền Sales Invoice sẵn) | Gán hình thức VC, xuất Excel — view `#/dieu-phoi` Phase 2 | Desktop |

**Pipeline:** SI submit → điều phối gán hình thức VC → đơn `Tự vận chuyển` rơi vào **pool** → Điều Phối tạo `Chuyen Xe`, kéo đơn vào (được phép **tách một đơn ra nhiều chuyến**) → submit chuyến → Lái Xe giao, bấm trạng thái từng điểm + chụp chứng từ → hooks **stamp ngược** kết quả về Sales Invoice → chuyến Hoàn thành, phần chưa giao **tự nhả về pool**.

**Hai nghiệp vụ đặc thù (lý do tồn tại của app):**
1. **Ràng buộc tải trọng:** tổng thể tích các đơn trên chuyến so với thể tích khả dụng của xe — cảnh báo khi vượt 100%, chặn khi vượt 110%.
2. **Tách đơn:** một đơn có thể nằm trên nhiều chuyến, mỗi chuyến chở một phần (theo số kiện + thể tích).

**Quy tắc vàng của mô hình tách đơn:** *phần còn lại KHÔNG phải là một record — nó là phép trừ.* Tuyệt đối không clone/tách Sales Invoice (hóa đơn điện tử đã phát hành). Child row của chuyến mang `so_kien`/`the_tich` của phần lên chuyến đó; "còn lại" = tổng của đơn − tổng đã phân bổ trên các chuyến còn hiệu lực.

---

## 2. Data model

### 2.1 DocType mới: `Chuyen Xe` (label "Chuyến Xe")

`is_submittable=1`, `track_changes=1`, naming: `naming_series` = `CX-.YYYY.-.####`. Module: `Van Chuyen`.

| fieldname | Label | Type | Thuộc tính |
|---|---|---|---|
| naming_series | Series | Select | hidden, options `CX-.YYYY.-.####` |
| ngay_giao | Ngày giao | Date | reqd, default Today, in_list_view |
| trang_thai | Trạng thái | Select | options `Nháp\nĐang giao\nHoàn thành`, default `Nháp`, read_only, allow_on_submit, in_list_view, in_standard_filter — **chỉ code set** |
| lai_xe | Lái xe | Link → Driver | reqd, in_list_view |
| ten_lai_xe | Tên lái xe | Data | fetch_from `lai_xe.full_name`, read_only |
| sdt_lai_xe | SĐT lái xe | Data | fetch_from `lai_xe.cell_number`, read_only |
| xe | Xe | Link → Vehicle | reqd, in_list_view |
| the_tich_xe | Thể tích xe (m³) | Float | fetch_from `xe.custom_the_tich_kha_dung`, read_only |
| don_hang | Đơn hàng | Table → Chuyen Xe Don Hang | reqd, **allow_on_submit=1** |
| tong_don | Tổng số đơn | Int | read_only (code tính) |
| tong_kien | Tổng kiện | Float | read_only (code tính) |
| tong_the_tich | Tổng thể tích (m³) | Float | read_only, precision 3 (code tính) |
| ti_le_tai | Tỉ lệ tải (%) | Percent | read_only (code tính) |
| ghi_chu | Ghi chú | Small Text | |

### 2.2 Child DocType: `Chuyen Xe Don Hang` (istable=1)

| fieldname | Label | Type | Thuộc tính |
|---|---|---|---|
| sales_invoice | Đơn hàng | Link → Sales Invoice | reqd, in_list_view |
| khach_hang | Khách hàng | Data | read_only, in_list_view — **server copy** từ SI.customer_name khi add |
| dia_chi | Địa chỉ giao | Small Text | read_only — server copy: dòng đầu `shipping_address` (strip `<br>`) + `custom_tỉnh` |
| so_po | Số PO | Data | read_only — copy từ `custom_po_` |
| so_kien | Số kiện | Float | reqd, in_list_view — phần lên chuyến này |
| the_tich | Thể tích (m³) | Float | reqd, precision 3, in_list_view |
| hop_le | Hộp lẻ (tham khảo) | Float | read_only — copy `custom_hộp_lẻ` của cả đơn, chỉ hiển thị |
| trang_thai_giao | Trạng thái giao | Select | options `Chờ giao\nĐã giao\nKhách hẹn\nHoàn`, default `Chờ giao`, **allow_on_submit=1**, in_list_view |
| so_chung_tu | Số ảnh CT | Int | default 0, read_only, **allow_on_submit=1** |
| ghi_chu | Ghi chú | Small Text | **allow_on_submit=1** |

> Copy dữ liệu hiển thị (khach_hang, dia_chi, so_po, hop_le) làm **server-side trong API/controller khi thêm row** — KHÔNG dùng fetch_from cho các field nguồn có dấu, và snapshot là chủ đích (lịch sử giao hàng không đổi theo master).

### 2.3 Custom Field app SHIP qua fixtures — CHỈ 3 field, fieldname ASCII

| DocType | fieldname | Label | Type | Thuộc tính |
|---|---|---|---|---|
| Sales Invoice | `custom_trang_thai_xep` | Trạng thái xếp chuyến | Select | options `Chưa xếp\nMột phần\nĐủ` (không default), read_only, allow_on_submit, in_standard_filter, insert_after `custom_chuyến_xe` — chỉ reconcile ghi |
| Vehicle | `custom_the_tich_kha_dung` | Thể tích khả dụng (m³) | Float | precision 2, description: "Thể tích xếp hàng thực tế, thường 85–90% thể tích hình học thùng xe" |
| Driver | `custom_user` | Tài khoản portal | Link → User | unique=1, description: "User đăng nhập /vc của lái xe" |

Fixtures: `bench export-fixtures` (không viết tay); nếu buộc viết tay → chạy `validate_shipped_docs.py`, 0 ERROR mới cài. `hooks.py` fixtures filter đúng **3 field này theo name** — không quét cả DocType.

### 2.4 Field production trên Sales Invoice — CHỈ ĐỌC / GHI RUNTIME, **CẤM đưa vào fixtures**

Các field sau **đã tồn tại** trên site (fieldname có dấu — dùng nguyên văn, đã xác minh từ Customize Form export):

| fieldname (chính xác) | Type | Ghi chú |
|---|---|---|
| `custom_hình_thức_vận_chuyển` | Select `Chưa phân công\nNhất Tín\nViettel Post\nTự vận chuyển\nXe vào bốc` | App **đọc** (pool filter). Phase 2 view dieu-phoi **ghi** |
| `custom_trạng_thái_vận_chuyển` | Select `Chờ xử lý\nĐang xử lý\nĐang giao hàng\nĐã giao hàng, chụp chứng từ\nĐã nộp chứng từ`, default `Chờ xử lý` | Reconcile **chỉ ghi 2 giá trị**: `Đang giao hàng`, `Đã giao hàng, chụp chứng từ`. **Không bao giờ ghi đè khi đang là `Đã nộp chứng từ`**, không bao giờ hạ cấp |
| `custom_chuyến_xe` | Data, in_standard_filter | Reconcile ghi chuỗi tổng hợp `"CX-2026-0012, CX-2026-0015"` hoặc `""` |
| `custom_lái_xe` | **Link → Driver** | Reconcile ghi **driver của chuyến mới nhất còn hiệu lực** (Link chỉ chứa 1 giá trị) |
| `custom_tên_lái_xe` | Data | Reconcile ghi tổng hợp `"Hùng / Nam"` |
| `custom_điện_thoại_lái_xe` | Data | Reconcile ghi tổng hợp tương ứng |
| `custom_xe` | Data "Xe (biển số)" | Reconcile ghi tổng hợp biển số |
| `custom_tổng_kiện` | **Float** | Nguồn tổng kiện của đơn |
| `custom_hộp_lẻ` | Float | Hiển thị tham khảo |
| `custom_thể_tích_lô` | Float, đơn vị **cm³** | Quy đổi m³ = ÷ 1.000.000 **một lần khi add row**; toàn app sống bằng m³ |
| `custom_po_` | Data (có underscore cuối) | Hiển thị + search |
| `custom_tỉnh` | Link → Territory | Hiển thị + filter |
| `custom_ghi_chú_npp`, `custom_ghi_chú_giao_hàng` | Small Text | Hiển thị trong pool/stop |

**Ràng buộc cứng:** không export field nào ở bảng trên vào fixtures, không tạo Property Setter cho chúng (kể cả để "thêm allow_on_submit" — stamp dùng `frappe.db.set_value` nên không cần; Property Setter asymmetry từng gây sự cố production). App khác đang sở hữu các field này.

---

## 3. Business logic (controller `chuyen_xe.py`)

### 3.1 Aggregate chuẩn (nguồn sự thật duy nhất — viết thành helper dùng chung)

`EPS = 0.001` (custom_tổng_kiện là Float → mọi so sánh dùng epsilon).

```
da_xep(si, exclude_trip=None) =
  SUM(row.so_kien) trên `tabChuyen Xe Don Hang` JOIN `tabChuyen Xe`
  WHERE row.sales_invoice = si
    AND trip.docstatus < 2
    AND NOT (trip.trang_thai = 'Hoàn thành' AND row.trang_thai_giao != 'Đã giao')
    AND trip.name != exclude_trip (nếu có)
```
→ Chuyến nháp/đang giao **giữ chỗ** allocation; chuyến Hoàn thành chỉ giữ phần **đã giao thật** — phần Khách hẹn/Hoàn tự nhả về pool.

```
con_lai(si)  = custom_tổng_kiện − da_xep(si)
da_giao(si)  = SUM(row.so_kien) WHERE trang_thai_giao='Đã giao' AND trip.docstatus=1
the_tich_con_lai(si) = (custom_thể_tích_lô/1e6) × con_lai/custom_tổng_kiện   (pro-rata)
```

### 3.2 `validate()` — 5 bước

1. Mỗi row: `so_kien > 0`, `the_tich >= 0`; **một SI không xuất hiện 2 row trong cùng chuyến** (throw: "sửa số kiện ở dòng đã có").
2. Mỗi SI: `docstatus=1`, `is_return=0`, `custom_hình_thức_vận_chuyển == 'Tự vận chuyển'` — sai thì throw (pool integrity).
3. Cross-trip: `da_xep(si, exclude_trip=self.name) + row.so_kien ≤ custom_tổng_kiện + EPS`, throw kèm số liệu: *"HD-xxx: đã xếp 8/12 kiện ở CX-yyy, chỉ còn 4 kiện"*.
4. Tính `tong_don, tong_kien, tong_the_tich, ti_le_tai`. Tải trọng (khi `the_tich_xe > 0`): `> 100%` → `frappe.msgprint(..., indicator='orange')`; `> OVERLOAD_HARD = 1.10` (hằng số, có comment) → `frappe.throw`.
5. Server tự refresh khach_hang/dia_chi/so_po/hop_le cho row mới (đừng tin client).

### 3.3 Lifecycle & reconcile

- `on_submit` → `db_set('trang_thai', 'Đang giao')` + `reconcile(rows hiện tại)`
- `on_update_after_submit` → `reconcile(rows hiện tại ∪ rows trong get_doc_before_save())` — bắt cả đơn bị gỡ khỏi chuyến, **không** query LIKE trên chuỗi
- `on_cancel` → `reconcile(rows hiện tại)`
- `complete_trip` (chỉ qua API, Điều Phối): doc docstatus=1 → `db_set('trang_thai','Hoàn thành')` + reconcile (nhả phần chưa giao)

**`reconcile(si_list)`** — với từng SI, tính lại từ aggregate rồi ghi **`frappe.db.set_value(..., update_modified=False)`** (không doc.save — đơn đã submit, không đụng timestamp của kế toán):

| Field đích | Giá trị |
|---|---|
| `custom_chuyến_xe` | `", ".join` các chuyến đang giữ allocation (docstatus<2, theo quy tắc 3.1), rỗng nếu không còn |
| `custom_lái_xe` | driver của chuyến **mới nhất** trong danh sách trên (hoặc None) |
| `custom_tên_lái_xe` / `custom_điện_thoại_lái_xe` / `custom_xe` | chuỗi tổng hợp `" / "` theo thứ tự chuyến |
| `custom_trang_thai_xep` | `Đủ` nếu `da_xep ≥ tổng − EPS`; `Một phần` nếu `0 < da_xep`; `Chưa xếp` nếu về 0 |
| `custom_trạng_thái_vận_chuyển` | ghi `Đang giao hàng` khi có chuyến trạng thái Đang giao chứa đơn; ghi `Đã giao hàng, chụp chứng từ` khi `da_giao ≥ tổng − EPS`; **skip hoàn toàn nếu giá trị hiện tại là `Đã nộp chứng từ`**; không ghi gì khác |

### 3.4 Quy ước đặt tên

DocType/fieldname/file **ASCII không dấu** (gotcha diacritics); label tiếng Việt đầy đủ. Mọi thư mục Python có `__init__.py` (kể cả `api/`); `modules.txt` khớp package `van_chuyen`.

---

## 4. Roles & phân quyền

Ship 2 Role qua fixtures: **`Lái Xe`**, **`Điều Phối Vận Chuyển`**. **DocPerm KHÔNG ship qua fixtures** — cấp trong `after_install` bằng `add_permission`/`update_permission_property`, bọc try/except + `log_error`.

| DocType | Điều Phối Vận Chuyển | Lái Xe |
|---|---|---|
| Chuyen Xe | read, write, create, submit, cancel, amend, print | **không có gì** |
| Sales Invoice | không cấp thêm (không cần) | **không có gì** |

**Nguyên tắc:** Lái Xe = zero DocType permission; mọi truy cập qua whitelisted method có guard. **Chỉ role Điều Phối Vận Chuyển tạo/submit/hoàn thành/hủy chuyến** — guard cứng ở server, không chỉ ẩn nút.

Guards dùng chung (`api/guards.py`):
- `require_dieu_phoi()` — throw `PermissionError` nếu session user thiếu role.
- `require_driver()` — trả về `Driver.name` có `custom_user == frappe.session.user`, throw nếu không map được.
- `require_own_trip(trip_name)` — driver của session phải là `lai_xe` của chuyến.

---

## 5. Whitelisted API (`vanchuyen/api/`)

Mỗi method: docstring + guard **dòng đầu**; `frappe.db.sql` có comment vì sao không dùng ORM; response JSON gọn; message lỗi tiếng Việt. Sau guard, truy vấn nội bộ dùng `frappe.db.*` trực tiếp (đã tự kiểm phạm vi).

**`api/dieu_phoi.py`** (tất cả `require_dieu_phoi()`):
- `get_pool(tu_ngay=None, den_ngay=None, tinh=None, tim=None, page=1, page_size=30)` — SI `docstatus=1, is_return=0, hình thức='Tự vận chuyển', COALESCE(custom_trang_thai_xep,'') != 'Đủ'`; `tim` match customer_name/`custom_po_`/name. Trả về mỗi đơn: name, khách, địa chỉ, PO, tỉnh, tổng kiện, hộp lẻ, thể tích m³, `da_xep`, `con_lai`, `the_tich_con_lai`, ghi chú NPP + giao hàng, posting_date. **Filter + paginate server-side.**
- `get_drivers()` / `get_vehicles()` — bản ghi active, kèm thể tích khả dụng.
- `get_trips(trang_thai=None, tu_ngay=None, den_ngay=None)` / `get_trip(name)` — chi tiết kèm stops.
- `save_trip(payload)` — tạo/sửa chuyến **nháp**; rows chỉ nhận `sales_invoice, so_kien, the_tich`; server copy phần hiển thị; trả về doc sau validate (client nhận luôn cảnh báo tải).
- `submit_trip(name)` / `cancel_trip(name)` / `complete_trip(name)`.
- `adjust_trip(name, add_rows=[], remove_row_names=[])` — cho chuyến **đã submit**: sửa child table qua doc API + `save()` để kích `on_update_after_submit` → reconcile tự chạy.

**`api/lai_xe.py`** (tất cả `require_driver()`):
- `get_my_trips()` — chuyến `docstatus=1`, `lai_xe = driver(session)`, trạng thái `Đang giao` + `Hoàn thành` có `ngay_giao` = hôm nay; mỗi chuyến kèm stops tối giản: row name, khách, địa chỉ, tỉnh, PO, kiện, khối, hộp lẻ, trạng thái, so_chung_tu, ghi chú. **Không trả bất kỳ số tiền nào.**
- `update_stop_status(trip, row_name, trang_thai, ghi_chu=None)` — `require_own_trip`; chỉ nhận 4 giá trị hợp lệ; cập nhật row + `save()` (trigger reconcile).
- `upload_chung_tu(trip, row_name)` — `require_own_trip`; file từ `frappe.request.files`; `save_file(..., dt='Sales Invoice', dn=<SI của row>, is_private=1)`; `so_chung_tu += 1`; trả `file_url`.

**`api/dieu_hanh.py`** (Phase 2, guard = `frappe.has_permission('Sales Invoice', 'read'/'write')` thật — dành cho admin logistics đã có quyền SI):
- `get_invoices_dieu_phoi(filters, page, page_size)` — thay thế `frappe.client.get_list` 1000 đơn của trang cũ: filter server-side (khoảng ngày, trạng thái VC, hình thức, PO, khách, nhóm KH, địa chỉ), loại `customer_group='Showroom'`, `is_return=0`, sort `posting_date desc`.
- `bulk_update_van_chuyen(names, fieldname, value)` — chỉ whitelist 2 field: `custom_hình_thức_vận_chuyển`, `custom_trạng_thái_vận_chuyển`; check quyền write từng doc.
- `get_items_for_export(names)` — trả items (item_code, item_name, qty, uom) + `custom_quycach` của Item batch-lookup, phục vụ Excel đơn tổng/đơn chia (thay N+1 `frappe.client.get` của trang cũ).

---

## 6. Portal SPA `/vc` — theo skill `frappe-portal-spa` (bắt buộc đọc trước khi code phần này)

**`www/vc.py`**: chưa login → redirect `/login?redirect-to=/vc`. Bơm `VC_CONTEXT = { user, full_name, is_dieu_phoi, is_lai_xe, driver_name, assetVersion, csrfToken }`. Không có role nào → render trang "không có quyền".

**`www/vc.html`**: extends web template; `head_include` chứa **import map** remap toàn bộ `lib/` + `components/` sang `?v=`; shell.js/shell.css cache-bust `?v={{now}}`.

**`public/vanchuyen/`**: `shell.js` (hash router, VIEW_MODULES dynamic import `withV()`, nav theo role, bottom-nav mobile), `lib/` (api.js wrap frappe.call + csrf, router.js, dom.js, format.js), `components/` (toast, modal, confirm), `views/` (1 file/route, export `render({container, params, query})`), `shell.css` — **mọi class prefix `vc-`**, không class trần. `escapeHtml` mọi dữ liệu render.

**Landing theo role:** chỉ `Lái Xe` → `#/chuyen`; có `Điều Phối` → `#/xep-chuyen`; nav chỉ hiện route được phép (server vẫn là chốt chặn thật).

### View contracts

**`#/xep-chuyen`** (Điều Phối, desktop-first responsive) — Phase 1
- 2 cột. Trái: **pool** — search (khách/PO/số đơn), filter tỉnh + khoảng ngày; card đơn: khách, địa chỉ, badge PO, `còn n/N kiện · m m³`, hộp lẻ, ghi chú.
- Phải: **trip builder** — chọn ngày/lái xe/xe → hiện **thanh tải** `9,2 / 12 m³ (77%)` live khi thêm bớt (≥90% vàng, >100% đỏ); tick card = thêm **toàn bộ phần còn lại**; nút "Xếp một phần" mở dialog nhập kiện (thể tích auto pro-rata, sửa được) — phần dư tự cập nhật lại card pool.
- Danh sách chuyến Nháp/Đang giao: mở, sửa nháp, Submit, Adjust (chuyến đã chốt), nút **Hoàn thành** tự nổi bật khi mọi stop ở trạng thái kết thúc, link in Phiếu giao hàng, Hủy (confirm).
- Client chỉ kiểm tra cho mượt tay — **validate server là sự thật** (hiện message throw của server nguyên văn).

**`#/chuyen`** (Lái Xe, mobile-first) — Phase 1
- Card list: chuyến Đang giao (của tôi) trên cùng, Hoàn thành hôm nay bên dưới; mỗi card: ngày, biển số, tiến độ `3/8 điểm`.

**`#/chuyen/:id`** — Phase 1
- Sticky header: biển số, ngày, tiến độ. Mỗi stop card: khách, địa chỉ (**tap mở Google Maps** `https://www.google.com/maps/search/?api=1&query=<encoded>`), PO, `kiện · m³ · hộp lẻ`; **3 nút trạng thái to** (Đã giao / Khách hẹn / Hoàn) + chạm lại để về Chờ giao; nút 📷 (badge số ảnh): `<input type="file" accept="image/*" capture="environment">` → resize canvas max 1200px, JPEG q≈0.8 **trước khi** upload; ô ghi chú.
- Optimistic UI + toast lỗi & retry (lái xe ở vùng sóng yếu); mọi action gọi `api/lai_xe.py`.

**`#/dieu-phoi`** (admin logistics, desktop) — Phase 2
- Port `docs/legacy/quan-ly-van-chuyen.html` thành view module, **giữ nguyên hành vi**: time range 30/60/90/tất cả, quick filters (hôm nay/hôm qua/ngày/PO/khách/nhóm/địa chỉ/trạng thái), stats card theo hình thức VC (click = filter), bulk gán hình thức + trạng thái, detail modal, **2 loại Excel export giữ nguyên logic** (đơn tổng gộp thùng/hộp theo `custom_quycach`, chuẩn hóa hộp dư → thùng; đơn chia mỗi đơn 1 dòng; hạn PO theo miền +2/+4/+6 ngày).
- **Thay data layer**: dùng `api/dieu_hanh.py` (server filter + paginate + batch items) thay `frappe.client.get_list`/`get` N+1; XLSX (SheetJS CDN) **lazy-load chỉ trong view này**.

---

## 7. Print Format — `Phieu Giao Hang Chuyen Xe`

Jinja HTML (không Builder), DocType Chuyen Xe, ship qua fixtures export. A4 dọc: header công ty + "PHIẾU GIAO HÀNG — {{ doc.name }}" + ngày; khối thông tin: lái xe, SĐT, biển số, tổng đơn/kiện/thể tích; bảng: STT, Khách hàng, Địa chỉ, Số PO, Kiện, Thể tích (m³), **cột Ký nhận để trống (cao ~2cm)**; chân trang 2 ô ký: Điều phối / Lái xe. CSS inline trong print format, không phụ thuộc asset ngoài.

---

## 8. Phases & acceptance (dừng chờ user test sau mỗi phase)

### Phase 0 — Backend hoàn chỉnh (vận hành được ngay từ Desk)
Scaffold app + module `Van Chuyen` (`__init__.py` đủ mọi thư mục, `modules.txt` khớp); 2 DocType; 3 Custom Field fixtures (export, validator 0 ERROR); 2 Role fixtures + `after_install` cấp DocPerm; controller đủ validate/lifecycle/reconcile (§3); Print Format; hooks.py.

**Acceptance:** `bench install-app vanchuyen` sạch trên site test → từ Desk: (a) tạo chuyến 2 đơn, submit → cả 2 SI có `custom_chuyến_xe`, lái xe/SĐT/biển số stamp đúng, `custom_trạng_thái_vận_chuyển='Đang giao hàng'`, trạng thái xếp `Đủ`; (b) tách 1 đơn 12 kiện ra 2 chuyến 8+4 → chuỗi `"CX-…, CX-…"`, xếp quá 12 kiện bị chặn kèm số liệu; (c) chuyến vượt tải 105% cảnh báo, 115% chặn; (d) cancel 1 chuyến → stamp nhả đúng, trạng thái xếp về `Một phần`; (e) complete chuyến có 1 stop `Khách hẹn` → phần đó quay lại pool (`da_xep` giảm); (f) SI đang `Đã nộp chứng từ` không bao giờ bị reconcile ghi đè.

### Phase 1 — Portal /vc (xếp chuyến + lái xe)
`www/vc.py|html` + import map; shell + 3 view (`xep-chuyen`, `chuyen`, `chuyen/:id`); `api/guards.py`, `api/dieu_phoi.py`, `api/lai_xe.py`.

**Acceptance:** (a) user chỉ có role Lái Xe: login /vc → landing `#/chuyen`, chỉ thấy chuyến mình; gọi thẳng method dieu_phoi qua console → PermissionError; (b) bấm "Đã giao" trên mobile → row đổi, reconcile chạy (SI cập nhật); (c) chụp ảnh → File private gắn đúng SI, badge tăng; (d) xếp một phần qua dialog: pool cập nhật "còn lại" ngay, thanh tải live đổi màu; (e) user không role nào → trang từ chối; (f) sửa 1 file trong `lib/` + deploy → refresh thường ăn bản mới (import map đúng).

### Phase 2 — View `#/dieu-phoi`
`api/dieu_hanh.py` + port legacy HTML thành view module theo §6.

**Acceptance:** cùng một dataset, file Excel xuất từ view mới **giống kết quả** trang cũ (đơn tổng + đơn chia); filter/PO search/bulk update hoạt động; view chỉ mở cho user có quyền SI; payload trang đầu < 200 đơn (server paginate) thay vì 1000.

**Mỗi phase:** commit-per-feature (message ghi P0/P1/P2) → push `main` → chạy verify block:
```bash
python3 -m py_compile vanchuyen/**/*.py
for f in vanchuyen/public/**/*.js; do node --check "$f"; done
python3 .claude/skills/nextcode-build/references/validate_shipped_docs.py apps/vanchuyen/vanchuyen
# kiểm __init__.py theo modules.txt (frappe-app-shipping-gotchas Gotcha #1)
```

---

## 9. Ràng buộc kỹ thuật (non-negotiable)

1. Backend = **file Python whitelisted method**, không Server Script / Client Script rải rác.
2. Fieldname/DocType/file mới **ASCII**; field production có dấu dùng **nguyên văn theo §2.4**, không đoán, không "sửa".
3. **Không** export fixtures / tạo Property Setter cho bất kỳ field ở §2.4.
4. Stamp về SI luôn `frappe.db.set_value(update_modified=False)`; không `doc.save()` trên SI.
5. DocPerm qua `after_install`, không qua fixtures; seed nào lỗi cũng không được chết install.
6. SPA theo `frappe-portal-spa`: import map cho shared modules, `withV()` cho view, CSS prefix `vc-`, escapeHtml.
7. Nghi ngờ hành vi Frappe v16 → đọc source thật trên raw.githubusercontent.com, không đoán.
8. Deploy: `bench --site <site> migrate → bench build --app vanchuyen → bench restart → refresh`.

## 10. Ngoài phạm vi (không build)

- COD / thu tiền / đối soát tiền lái xe (field `custom_cod` để nguyên, không đụng).
- Tách Sales Invoice / sinh chứng từ kế toán mới.
- Gán hình thức vận chuyển tự động, tối ưu lộ trình, bản đồ định tuyến.
- Notification/Telegram (để phase tương lai).
