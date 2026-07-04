app_name = "vanchuyen"
app_title = "Van Chuyen"
app_publisher = "Rong Vang Hoang Gia"
app_description = "Quan ly chuyen xe & giao hang tu van chuyen"
app_email = "it@rongvanghoanggia.com"
app_license = "mit"

# Sau khi cài: cấp DocPerm (KHÔNG ship qua fixtures — xem install.py)
after_install = "vanchuyen.install.after_install"

# ---------------------------------------------------------------------------
# Fixtures — CHỈ ship đúng thứ app này sở hữu, lọc theo NAME (không quét cả DocType).
#   - 3 Custom Field của app SHIP (fieldname ASCII).
#   - 2 Role.
#   - 1 Print Format (Jinja).
# TUYỆT ĐỐI không export field production có dấu ở §2.4 build brief, không Property Setter.
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
