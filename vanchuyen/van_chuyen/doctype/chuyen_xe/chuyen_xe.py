"""Controller `Chuyen Xe` — nguồn sự thật duy nhất của mô hình xếp chuyến/tách đơn.

Quy tắc vàng của tách đơn: *phần còn lại KHÔNG phải là một record — nó là phép trừ.*
Không bao giờ clone/tách Sales Invoice. Child row mang `so_kien`/`the_tich` của phần
lên chuyến đó; "còn lại" = tổng của đơn − tổng đã phân bổ trên các chuyến còn hiệu lực.
"""

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

# ── Hằng số ────────────────────────────────────────────────────────────────
EPS = 0.001            # custom_tổng_kiện là Float → mọi so sánh dùng epsilon
OVERLOAD_HARD = 1.10   # >110% thể tích khả dụng → chặn cứng; >100% → cảnh báo


def _fmt(v):
	"""Số gọn cho message lỗi tiếng Việt (bỏ số 0 thừa): 8, 12, 4.5."""
	return "%g" % flt(v)


# ════════════════════════════════════════════════════════════════════════════
# AGGREGATE HELPERS — dùng chung cho controller + API. KHÔNG lặp lại logic ở nơi khác.
# ════════════════════════════════════════════════════════════════════════════
def da_xep(si, exclude_trip=None):
	"""Tổng kiện của đơn `si` đang được các chuyến GIỮ CHỖ.

	Chuyến nháp/đang giao giữ toàn bộ allocation; chuyến Hoàn thành chỉ giữ phần
	`Đã giao` thật — phần Khách hẹn/Hoàn tự nhả về pool.

	Dùng SQL trực tiếp: cần JOIN parent(trang_thai/docstatus) với child rows và áp
	điều kiện phủ định "Hoàn thành nhưng chưa giao" — ORM get_all không diễn đạt gọn.
	"""
	params = {"si": si}
	exclude_sql = ""
	if exclude_trip:
		exclude_sql = " AND cx.name != %(ex)s"
		params["ex"] = exclude_trip
	val = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(cxd.so_kien), 0)
		FROM `tabChuyen Xe Don Hang` cxd
		JOIN `tabChuyen Xe` cx ON cx.name = cxd.parent
		WHERE cxd.sales_invoice = %(si)s
		  AND cx.docstatus < 2
		  AND NOT (cx.trang_thai = 'Hoàn thành' AND cxd.trang_thai_giao != 'Đã giao')
		"""
		+ exclude_sql,
		params,
	)[0][0]
	return flt(val)


def da_giao(si):
	"""Tổng kiện đã giao thật của đơn (rows `Đã giao` trên chuyến đã submit)."""
	val = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(cxd.so_kien), 0)
		FROM `tabChuyen Xe Don Hang` cxd
		JOIN `tabChuyen Xe` cx ON cx.name = cxd.parent
		WHERE cxd.sales_invoice = %(si)s
		  AND cxd.trang_thai_giao = 'Đã giao'
		  AND cx.docstatus = 1
		""",
		{"si": si},
	)[0][0]
	return flt(val)


def _si_tong(si):
	return flt(frappe.db.get_value("Sales Invoice", si, "custom_tổng_kiện"))


def _si_the_tich_lo_cm3(si):
	return flt(frappe.db.get_value("Sales Invoice", si, "custom_thể_tích_lô"))


def con_lai(si):
	"""Số kiện của đơn chưa được xếp lên chuyến nào (còn trong pool)."""
	return _si_tong(si) - da_xep(si)


def the_tich_con_lai(si):
	"""Thể tích (m³) của phần còn lại — pro-rata theo tỉ lệ kiện."""
	tong = _si_tong(si)
	if tong <= 0:
		return 0.0
	return _si_the_tich_lo_cm3(si) / 1_000_000.0 * con_lai(si) / tong


def _trips_holding(si):
	"""Các chuyến (docstatus<2) đang giữ allocation cho đơn `si`, sắp theo creation.

	cx.name là PK nên GROUP BY cx.name hợp lệ dưới ONLY_FULL_GROUP_BY."""
	return frappe.db.sql(
		"""
		SELECT cx.name, cx.lai_xe, cx.ten_lai_xe, cx.sdt_lai_xe, cx.xe,
		       cx.trang_thai, cx.creation
		FROM `tabChuyen Xe` cx
		JOIN `tabChuyen Xe Don Hang` cxd ON cxd.parent = cx.name
		WHERE cxd.sales_invoice = %(si)s
		  AND cx.docstatus < 2
		  AND NOT (cx.trang_thai = 'Hoàn thành' AND cxd.trang_thai_giao != 'Đã giao')
		GROUP BY cx.name
		ORDER BY cx.creation ASC
		""",
		{"si": si},
		as_dict=True,
	)


# ════════════════════════════════════════════════════════════════════════════
# RECONCILE — stamp ngược kết quả về Sales Invoice (đơn đã submit).
# Luôn frappe.db.set_value(update_modified=False): KHÔNG đụng timestamp kế toán.
# ════════════════════════════════════════════════════════════════════════════
def reconcile(si_list):
	for si in {s for s in si_list if s}:
		_reconcile_one(si)


def _reconcile_one(si):
	tong = _si_tong(si)
	trips = _trips_holding(si)
	xep = da_xep(si)

	chuyen_str = ", ".join(t.name for t in trips)
	latest = max(trips, key=lambda t: t.creation) if trips else None
	values = {
		"custom_chuyến_xe": chuyen_str,
		# Link chỉ chứa 1 giá trị → driver của chuyến MỚI NHẤT còn hiệu lực.
		"custom_lái_xe": latest.lai_xe if latest else "",
		"custom_tên_lái_xe": " / ".join((t.ten_lai_xe or "") for t in trips),
		"custom_điện_thoại_lái_xe": " / ".join((t.sdt_lai_xe or "") for t in trips),
		"custom_xe": " / ".join((t.xe or "") for t in trips),
	}

	if tong > 0 and xep >= tong - EPS:
		values["custom_trang_thai_xep"] = "Đủ"
	elif xep > EPS:
		values["custom_trang_thai_xep"] = "Một phần"
	else:
		values["custom_trang_thai_xep"] = "Chưa xếp"

	# TUYỆT ĐỐI KHÔNG ghi custom_trạng_thái_vận_chuyển / custom_hình_thức_vận_chuyển — 2 field này
	# do app khác quản lý vòng đời; vanchuyen chỉ ĐỌC (lọc pool 'Tự vận chuyển'), không bao giờ ghi.
	frappe.db.set_value("Sales Invoice", si, values, update_modified=False)


def _format_dia_chi(shipping_address, tinh):
	"""Dòng đầu của shipping_address (bỏ <br> + mọi tag) + tỉnh."""
	txt = shipping_address or ""
	first = re.split(r"<br\s*/?>", txt, maxsplit=1, flags=re.IGNORECASE)[0]
	first = re.sub(r"<[^>]+>", "", first).strip()
	parts = [p for p in (first, tinh) if p]
	return ", ".join(parts)


# ════════════════════════════════════════════════════════════════════════════
class ChuyenXe(Document):
	def before_validate(self):
		# Backfill master (lái xe/xe) không phụ thuộc client fetch, rồi enrich rows.
		self._fetch_master()
		self._enrich_rows()

	def validate(self):
		# Check cấu trúc từng dòng: LUÔN chạy (kể cả sau submit).
		self._validate_structural()
		# Check pool-integrity + cross-trip + throw quá tải: khi dựng nháp, khi SUBMIT
		# (0→1: giữa lúc dựng và submit có thể chuyến khác đã chiếm chỗ), hoặc khi adjust
		# thêm/bớt đơn. KHÔNG chạy khi Lái Xe chỉ cập nhật trạng thái điểm giao — nếu không,
		# admin đổi hình thức VC giữa chừng sẽ CHẶN lái xe ghi giao hàng.
		heavy = self._needs_heavy_validation()
		if heavy:
			self._validate_pool_and_crosstrip()
		self._compute_totals(warn_overload=heavy)

	def _needs_heavy_validation(self):
		if self.docstatus == 0:
			return True  # đang dựng nháp
		before = self.get_doc_before_save()
		if before is None or before.docstatus == 0:
			return True  # đang submit (0→1) → phải validate pool + cross-trip
		# đã submit từ trước → chỉ heavy khi thành phần (sales_invoice, so_kien) đổi (adjust)
		sig = lambda doc: sorted((r.sales_invoice, round(flt(r.so_kien), 3)) for r in doc.don_hang)
		return sig(self) != sig(before)

	def on_submit(self):
		self.db_set("trang_thai", "Đang giao")
		reconcile([r.sales_invoice for r in self.don_hang])

	def on_update_after_submit(self):
		# Reconcile cả đơn bị GỠ khỏi chuyến → hợp rows hiện tại ∪ rows trước khi lưu.
		sis = {r.sales_invoice for r in self.don_hang}
		before = self.get_doc_before_save()
		if before:
			sis |= {r.sales_invoice for r in before.don_hang}
		reconcile(list(sis))

	def on_cancel(self):
		reconcile([r.sales_invoice for r in self.don_hang])

	def complete(self):
		"""Hoàn thành chuyến (chỉ gọi qua API, đã guard Điều Phối). Nhả phần chưa giao."""
		if self.docstatus != 1:
			frappe.throw(_("Chỉ hoàn thành được chuyến đã submit."))
		if self.trang_thai == "Hoàn thành":
			return
		self.db_set("trang_thai", "Hoàn thành")
		reconcile([r.sales_invoice for r in self.don_hang])

	# ── internal ────────────────────────────────────────────────────────────
	def _fetch_master(self):
		if self.lai_xe:
			d = frappe.db.get_value("Driver", self.lai_xe, ["full_name", "cell_number"], as_dict=True)
			if d:
				self.ten_lai_xe = d.full_name
				self.sdt_lai_xe = d.cell_number
		if self.xe:
			self.the_tich_xe = flt(frappe.db.get_value("Vehicle", self.xe, "custom_the_tich_kha_dung"))

	def _enrich_rows(self):
		"""Server copy phần hiển thị (snapshot chủ đích) + auto pro-rata thể tích.
		Đừng tin client: chỉ điền khi trống để giữ snapshot lịch sử giao hàng."""
		for row in self.don_hang:
			if not row.sales_invoice:
				continue
			si = frappe.db.get_value(
				"Sales Invoice",
				row.sales_invoice,
				["customer_name", "shipping_address", "custom_tỉnh", "custom_po_",
				 "custom_hộp_lẻ", "custom_thể_tích_lô", "custom_tổng_kiện"],
				as_dict=True,
			)
			if not si:
				continue
			if not row.khach_hang:
				row.khach_hang = si.get("customer_name")
			if not row.dia_chi:
				row.dia_chi = _format_dia_chi(si.get("shipping_address"), si.get("custom_tỉnh"))
			if not row.so_po:
				row.so_po = si.get("custom_po_")
			if not row.hop_le:
				row.hop_le = flt(si.get("custom_hộp_lẻ"))
			tong = flt(si.get("custom_tổng_kiện"))
			if not row.the_tich and row.so_kien and tong > 0:
				row.the_tich = flt(si.get("custom_thể_tích_lô")) / 1_000_000.0 * flt(row.so_kien) / tong

	def _validate_structural(self):
		"""Ràng buộc cấu trúc mỗi dòng — an toàn để chạy mọi lúc (kể cả sau submit)."""
		seen = set()
		for row in self.don_hang:
			if flt(row.so_kien) <= 0:
				frappe.throw(_("Dòng {0}: số kiện phải lớn hơn 0.").format(row.idx))
			if flt(row.the_tich) < 0:
				frappe.throw(_("Dòng {0}: thể tích không được âm.").format(row.idx))
			if row.sales_invoice in seen:
				frappe.throw(
					_("Đơn {0} xuất hiện 2 lần trong chuyến — sửa số kiện ở dòng đã có, đừng thêm dòng mới.").format(
						row.sales_invoice
					)
				)
			seen.add(row.sales_invoice)

	def _validate_pool_and_crosstrip(self):
		"""Pool-integrity (SI submit/return/hình thức) + ràng buộc tách đơn cross-trip.
		Chỉ chạy khi dựng/điều chỉnh chuyến (thành phần dòng đổi) — xem validate()."""
		for row in self.don_hang:
			si = row.sales_invoice
			info = frappe.db.get_value(
				"Sales Invoice",
				si,
				["docstatus", "is_return", "custom_hình_thức_vận_chuyển", "custom_tổng_kiện"],
				as_dict=True,
			)
			if not info or info.docstatus != 1:
				frappe.throw(_("Đơn {0} chưa được submit — không xếp chuyến.").format(si))
			if info.is_return:
				frappe.throw(_("Đơn {0} là hoá đơn trả (return) — không xếp chuyến.").format(si))
			if info.get("custom_hình_thức_vận_chuyển") != "Tự vận chuyển":
				frappe.throw(_("Đơn {0} không phải hình thức 'Tự vận chuyển'.").format(si))

			# Cross-trip: đã xếp ở chuyến khác + phần lên chuyến này ≤ tổng của đơn.
			tong = flt(info.get("custom_tổng_kiện"))
			khac = da_xep(si, exclude_trip=self.name)
			if khac + flt(row.so_kien) > tong + EPS:
				frappe.throw(
					_("{0}: đã xếp {1}/{2} kiện ở chuyến khác, chỉ còn {3} kiện — không thể xếp {4}.").format(
						si, _fmt(khac), _fmt(tong), _fmt(tong - khac), _fmt(row.so_kien)
					)
				)

	def _compute_totals(self, warn_overload=True):
		if not self.the_tich_xe and self.xe:
			self.the_tich_xe = flt(frappe.db.get_value("Vehicle", self.xe, "custom_the_tich_kha_dung"))
		self.tong_don = len(self.don_hang)
		self.tong_kien = sum(flt(r.so_kien) for r in self.don_hang)
		self.tong_the_tich = sum(flt(r.the_tich) for r in self.don_hang)

		the_tich_xe = flt(self.the_tich_xe)
		if the_tich_xe > 0:
			ratio = self.tong_the_tich / the_tich_xe
			self.ti_le_tai = ratio * 100
			# Chỉ chặn/cảnh báo tải khi đang dựng/điều chỉnh chuyến (không khi lái xe cập nhật điểm).
			if warn_overload and ratio > OVERLOAD_HARD:
				frappe.throw(
					_("Quá tải {0}% (ngưỡng chặn {1}%): {2} m³ vượt thể tích khả dụng {3} m³. Giảm bớt đơn.").format(
						_fmt(ratio * 100), int(OVERLOAD_HARD * 100), _fmt(self.tong_the_tich), _fmt(the_tich_xe)
					)
				)
			if warn_overload and ratio > 1.0:
				frappe.msgprint(
					_("Cảnh báo tải trọng: {0}% > 100% thể tích khả dụng ({1} m³).").format(
						_fmt(ratio * 100), _fmt(the_tich_xe)
					),
					indicator="orange",
					title=_("Vượt tải"),
				)
		else:
			self.ti_le_tai = 0
