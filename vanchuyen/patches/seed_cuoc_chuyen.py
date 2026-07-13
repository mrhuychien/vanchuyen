"""Seed bảng giá cước chuyến mặc định cho các site đã cài từ trước (after_install không chạy lại)."""

from vanchuyen.install import seed_cuoc_chuyen


def execute():
	seed_cuoc_chuyen()
