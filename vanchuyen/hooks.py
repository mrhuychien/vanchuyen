app_name = "vanchuyen"
app_title = "Van Chuyen"
app_publisher = "Rong Vang Hoang Gia"
app_description = "Quan ly chuyen xe & giao hang tu van chuyen"
app_email = "it@rongvanghoanggia.com"
app_license = "mit"

# Sau khi cài: cấp DocPerm (KHÔNG ship qua fixtures — xem install.py)
after_install = "vanchuyen.install.after_install"

# Lịch đăng kiểm trên Vehicle: chu kỳ 6 tháng / 1 năm / 2 năm → hạn tự tính lại MỖI lần lưu
# (kể cả sửa tay trên Desk). Hook không throw — nó chạy cho mọi lần lưu Vehicle của mọi app.
doc_events = {
    "Vehicle": {
        "validate": "vanchuyen.van_chuyen.doctype.nhat_ky_xe.nhat_ky_xe.vehicle_validate",
    },
}

# ---------------------------------------------------------------------------
# Fixtures — CHỈ ship đúng thứ app này sở hữu, lọc theo NAME (không quét cả DocType).
#   - 3 Custom Field app tự đặt (fieldname ASCII): custom_trang_thai_xep / _the_tich_kha_dung / _user.
#   - 5 Custom Field STAMP thuộc khâu vận chuyển (theo quyết định: vanchuyen tạo & sở hữu khi cài):
#     custom_chuyến_xe / _lái_xe / _tên_lái_xe / _điện_thoại_lái_xe / _xe — giữ nguyên fieldname có
#     dấu để không mất dữ liệu + không phải sửa chỗ đọc; định nghĩa tái tạo KHỚP hiện trạng.
#   - 2 Role. - 1 Print Format (Jinja).
# LƯU Ý: KHÔNG ship các field NGUỒN từ đơn hàng (custom_hình_thức_vận_chuyển, _trạng_thái_vận_chuyển,
# _tổng_kiện, _thể_tích_lô, _po_, _tỉnh, _ghi_chú_*) — app khác sở hữu; vanchuyen chỉ đọc/ghi runtime.
# Trước khi deploy nên chạy `bench export-fixtures --app vanchuyen` để lấy đúng định nghĩa canonical.
# ---------------------------------------------------------------------------
fixtures = [
    {
        "dt": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                [
                    "Sales Invoice-custom_trang_thai_xep",
                    "Vehicle-custom_the_tich_kha_dung",
                    "Driver-custom_user",
                    "Sales Invoice-custom_chuyến_xe",
                    "Sales Invoice-custom_lái_xe",
                    "Sales Invoice-custom_tên_lái_xe",
                    "Sales Invoice-custom_điện_thoại_lái_xe",
                    "Sales Invoice-custom_xe",
                    "Sales Invoice-custom_chuyen_xe_link",
                    "Driver-custom_login_token",
                    "Driver-custom_is_to_truong",
                    "Sales Invoice-custom_gửi_xe",
                    "Vehicle-custom_phu_phi_xe",
                    "Sales Invoice-custom_co_su_co",
                    "Sales Invoice-custom_su_co_tom_tat",
                    # Quản lý xe (#/quan-ly-xe): loại xe + lịch đăng kiểm / thay dầu trên Vehicle.
                    "Vehicle-custom_loai_xe",
                    "Vehicle-custom_ngay_cap_nhat_km",
                    "Vehicle-custom_sec_lich_xe",
                    "Vehicle-custom_chu_ky_dang_kiem",
                    "Vehicle-custom_ngay_dang_kiem",
                    "Vehicle-custom_han_dang_kiem",
                    "Vehicle-custom_col_lich_xe",
                    "Vehicle-custom_thay_dau_moi_km",
                    "Vehicle-custom_thay_dau_moi_thang",
                    "Vehicle-custom_ngay_thay_dau",
                    "Vehicle-custom_km_thay_dau",
                ],
            ]
        ],
    },
    {
        "dt": "Role",
        "filters": [["name", "in", ["Lái Xe", "Điều Phối Vận Chuyển"]]],
    },
    {
        "dt": "Print Format",
        "filters": [["name", "in", ["Phieu Giao Hang Chuyen Xe"]]],
    },
]
