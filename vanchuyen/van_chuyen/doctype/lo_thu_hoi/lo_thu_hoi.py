"""Lo Thu Hoi — MỘT LẦN khách (siêu thị) gọi trả hàng: đi lấy, rồi nhận về kho.

Hàng trả do ĐƠN VỊ VẬN CHUYỂN NGOÀI vào lấy (Viettel Post / Nhất Tín): lô chỉ giữ đơn vị,
mã vận đơn (nếu có), ngày thu, số kiện — không giao lái xe / xe của công ty. Chi tiết hàng
cần thu là bản DÁN NGUYÊN VĂN từ mail siêu thị (`chi_tiet_hang`); mã hàng + số lượng chính
xác do kế toán ghi ở phiếu kiểm hàng bên ketoan.

════════════════════════════════════════════════════════════════════════════
BA CHẶNG CỦA VẬN CHUYỂN, BA CHẶNG CỦA KẾ TOÁN
════════════════════════════════════════════════════════════════════════════

    Tạo yêu cầu → Đã lấy hàng → Đã nhận hàng          (bảng này, app này ghi)
    → Đang kiểm → Đã kiểm hàng → Đã nhập chứng từ → Xong (`Kiem Hang Thu Hoi`, ketoan ghi)

Bảng này KHÔNG có cột cho ba chặng sau, và đó là chủ đích: mỗi app chỉ ghi bảng
của mình (cùng luật với `Su Co Van Chuyen` ↔ `MT Hang Hoan`). Màn hình hiện
trạng thái TỔNG bằng cách ĐỌC MỀM phiếu kiểm bên kia — `phieu_kiem()` dưới đây.
Site chưa cài ketoan thì lô dừng ở "Đã nhận hàng", không nổ.

════════════════════════════════════════════════════════════════════════════
ĐỊA CHỈ PHẢI LÀ ĐỊA CHỈ CỦA CHÍNH KHÁCH NÀY
════════════════════════════════════════════════════════════════════════════

`shipping_address_name` là điểm siêu thị trả hàng, và kế toán dựng hóa đơn trả
về trên đúng khách + điểm đó (hóa đơn gốc cùng điểm được gợi ý trước). Saigon
Co.op chỉ có MỘT Customer cho ~mọi điểm, nên ô khách đúng mà ô điểm sai là
chuyện dễ xảy ra nhất — và nó trôi thẳng sang chứng từ. Chặn ở `validate` bằng
Dynamic Link, không tin client.

════════════════════════════════════════════════════════════════════════════
KẾ TOÁN ĐÃ MỞ PHIẾU KIỂM THÌ KHÓA KHÁCH / ĐIỂM / CHẶNG
════════════════════════════════════════════════════════════════════════════

Phiếu kiểm chép khách + điểm lúc mở, rồi hóa đơn trả về dựng trên đó. Cho đổi
khách ở đây sau lúc ấy là hai bảng nói về hai khách khác nhau mà không bảng nào
biết. Lùi chặng ("chưa nhận hàng") khi hàng đã được đếm cũng vậy — và HỦY cũng vậy.

════════════════════════════════════════════════════════════════════════════
HỦY YÊU CẦU — GIỮ LÔ LÀM DẤU VẾT, KHÔNG XÓA
════════════════════════════════════════════════════════════════════════════

Siêu thị rút yêu cầu, lập trùng, đơn vị vận chuyển không lấy được hàng… → "Đã hủy" kèm
lý do + ai / lúc nào + chặng trước khi hủy (`huy_tu`, để Khôi phục về đúng chỗ). Xóa thì
mất luôn câu trả lời cho "lô này đi đâu rồi". "Đã hủy" KHÔNG phải một nấc của 7 chặng:
lô dừng hẳn, không tính vào "đang mở". Chỉ hủy được khi kế toán CHƯA mở phiếu kiểm.

════════════════════════════════════════════════════════════════════════════
HỦY TẠI CHỖ — siêu thị hủy hàng, công ty KHÔNG thu về (khác hẳn "Hủy yêu cầu")
════════════════════════════════════════════════════════════════════════════

Hàng date quá ít, không đáng một chuyến: siêu thị hủy tại chỗ (biên bản hủy), công ty
vẫn phải lập hóa đơn trả về cho đúng số trên phiếu. Lô còn "Tạo yêu cầu" (chưa ai đi lấy)
bấm "Hủy tại chỗ" thì ĐI TẮT: bỏ qua Đã lấy hàng / Đã nhận hàng / đếm hàng, chặng tổng
đứng ở "Đã kiểm hàng" (nhận đủ theo phiếu) — `chang_tong()` — chờ kế toán nhập chứng từ.
Kế toán chép mã + số theo phiếu của siêu thị (không đếm), rồi lập hóa đơn trả về như lô
thường. Lùi về "Tạo yêu cầu" được khi kế toán chưa mở phiếu.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr

TAO = "Tạo yêu cầu"
DA_LAY = "Đã lấy hàng"
DA_NHAN = "Đã nhận hàng"
TRANG_THAI = (TAO, DA_LAY, DA_NHAN)
DA_HUY = "Đã hủy"  # ngoài tiến trình — xem "HỦY YÊU CẦU" ở đầu file
_DAU_HUY = ("ly_do_huy", "huy_boi", "huy_luc", "huy_tu")
HUY_TAI_CHO = "Hủy tại chỗ"  # đi tắt sang kế toán — xem "HỦY TẠI CHỖ" ở đầu file

# Phiếu kiểm hàng bên ketoan — CHỈ ĐỌC, và đọc MỀM.
KIEM_DT = "Kiem Hang Thu Hoi"
DANG_KIEM = "Đang kiểm"
DA_KIEM = "Đã kiểm hàng"
CHANG_KE_TOAN = (DANG_KIEM, DA_KIEM, "Đã nhập chứng từ", "Xong")
# Thứ tự 7 chặng tổng. Một chỗ khai, mọi màn đọc — xếp danh sách, vẽ pill, vẽ
# thanh tiến độ đều theo đúng thứ tự này.
CHANG = TRANG_THAI + CHANG_KE_TOAN

# Bảng hàng khai cũ (bản đầu, trước khi chi tiết hàng chuyển sang kế toán). Không còn
# field nào trỏ tới; giữ DocType để kế toán vẫn đọc được số khai của các lô cũ.
HANG_CU = "Lo Thu Hoi Hang"


def phieu_kiem(lo_names):
	"""{tên lô: trạng thái phiếu kiểm bên ketoan}. Site chưa có ketoan → {}.

	Trạng thái rỗng (bản ketoan cũ chưa kịp ghi) đọc là "Đang kiểm": phiếu đã mở
	là việc đã bắt đầu, hiện nó thành "Đã nhận hàng" là giấu người đang đếm.
	"""
	names = [n for n in (lo_names or []) if n]
	if not names or not frappe.db.table_exists(KIEM_DT):
		return {}
	# SQL thô: bảng của app khác, không có meta để đi qua ORM khi app đó vắng mặt.
	rows = frappe.db.sql(
		f"SELECT lo_thu_hoi, trang_thai FROM `tab{KIEM_DT}` WHERE lo_thu_hoi IN %(n)s",
		{"n": tuple(names)},
		as_dict=True,
	)
	return {r.lo_thu_hoi: cstr(r.trang_thai) or DANG_KIEM for r in rows}


def chang_tong(trang_thai, kiem=None, co_ke_toan=True):
	"""Chặng TỔNG của một lô: phiếu kiểm bên ketoan nếu có; lô HỦY TẠI CHỖ chưa có phiếu đứng
	ở "Đã kiểm hàng" (nhận đủ theo phiếu, chờ kế toán nhập chứng từ) — site chưa cài ketoan
	thì không có ai nhận, để nguyên "Hủy tại chỗ"."""
	if kiem:
		return kiem
	if trang_thai == HUY_TAI_CHO and co_ke_toan:
		return DA_KIEM
	return trang_thai


def dia_chi_cua_khach(address, customer):
	"""Address có Dynamic Link tới đúng Customer này không."""
	if not address or not customer:
		return False
	return bool(
		frappe.db.exists(
			"Dynamic Link",
			{
				"parenttype": "Address",
				"parent": address,
				"link_doctype": "Customer",
				"link_name": customer,
			},
		)
	)


def format_dia_chi(a):
	"""Một dòng đọc được: số nhà, đường, phường/quận, tỉnh. Bỏ phần trống."""
	if not a:
		return ""
	parts = [cstr(a.get(f)).strip() for f in ("address_line1", "address_line2", "city", "county", "state")]
	out = []
	for p in parts:
		if p and p not in out:
			out.append(p)
	return ", ".join(out)


def ma_diem_mt(address, customer):
	"""(mã điểm, tên điểm) theo bảng `MT Store` của ketoan — đọc mềm.

	`MT Store.address` CHÍNH LÀ `shipping_address_name` (như `nhap_don._resolve_address`
	đã dựa vào). Không có bảng / không có dòng → ("", "").
	"""
	if not address or not frappe.db.table_exists("MT Store"):
		return "", ""
	flt_ = {"address": address}
	if customer:
		flt_["customer"] = customer
	r = frappe.db.get_value("MT Store", flt_, ["store_code", "store_name"], as_dict=True)
	if not r:
		return "", ""
	return cstr(r.store_code), cstr(r.store_name)


class LoThuHoi(Document):
	def before_validate(self):
		self._chep_khach()
		self._chep_diem()
		self.ma_van_don = cstr(self.get("ma_van_don")).strip() or None
		self.so_dinh_kem = frappe.db.count(
			"File", {"attached_to_doctype": self.doctype, "attached_to_name": self.name}
		) if self.name and not self.is_new() else 0

	def validate(self):
		if self.trang_thai not in TRANG_THAI + (HUY_TAI_CHO, DA_HUY):
			frappe.throw(_("Trạng thái vận chuyển không hợp lệ: {0}").format(self.trang_thai))
		if self.trang_thai == DA_HUY:
			if not cstr(self.get("ly_do_huy")).strip():
				frappe.throw(_("Hủy yêu cầu phải ghi lý do — lô hủy được giữ lại làm dấu vết."))
		else:
			# Không còn hủy (Khôi phục) → bỏ dấu hủy trên bản ghi; dấu cũ còn trong Version.
			for f in _DAU_HUY:
				setattr(self, f, None)
		if not dia_chi_cua_khach(self.shipping_address_name, self.customer):
			frappe.throw(
				_(
					"Địa chỉ {0} không phải địa chỉ của khách {1}. Chọn lại điểm lấy hàng trong "
					"danh sách địa chỉ CỦA KHÁCH NÀY — hóa đơn trả về dựng trên đúng điểm đó."
				).format(self.shipping_address_name, self.customer)
			)
		self._khoa_khi_ke_toan_da_kiem()

	def on_trash(self):
		if phieu_kiem([self.name]):
			frappe.throw(
				_(
					"Lô {0} đã có phiếu kiểm hàng bên kế toán. Xóa lô là phiếu kiểm và hóa đơn "
					"trả về mất gốc — nhờ kế toán xóa phiếu kiểm trước."
				).format(self.name)
			)
		# Dòng hàng khai của bản cũ không còn field cha → Frappe không tự xóa theo lô.
		if frappe.db.table_exists(HANG_CU):
			frappe.db.delete(HANG_CU, {"parent": self.name, "parenttype": self.doctype})

	# ── chép phần hiển thị: SERVER làm, không tin client ─────────────────────
	def _chep_khach(self):
		if self.customer:
			self.customer_name = frappe.db.get_value("Customer", self.customer, "customer_name") or self.customer

	def _chep_diem(self):
		a = None
		if self.shipping_address_name:
			a = frappe.db.get_value(
				"Address",
				self.shipping_address_name,
				["address_title", "address_line1", "address_line2", "city", "county", "state", "phone"],
				as_dict=True,
			)
		if not a:
			self.ten_diem = self.dia_chi = self.sdt_diem = self.ma_diem = None
			return
		ma, ten_mt = ma_diem_mt(self.shipping_address_name, self.customer)
		self.ten_diem = ten_mt or cstr(a.address_title) or self.shipping_address_name
		self.ma_diem = ma or None
		self.dia_chi = format_dia_chi(a)
		self.sdt_diem = cstr(a.phone) or None

	def _khoa_khi_ke_toan_da_kiem(self):
		if self.is_new():
			return
		before = self.get_doc_before_save()
		if not before or not phieu_kiem([self.name]):
			return
		if self.trang_thai == HUY_TAI_CHO and before.trang_thai != HUY_TAI_CHO:
			frappe.throw(
				_("Kế toán đã mở phiếu kiểm hàng cho lô {0} — không chuyển sang 'Hủy tại chỗ' được nữa.").format(
					self.name
				)
			)
		if before.trang_thai == HUY_TAI_CHO and self.trang_thai not in (HUY_TAI_CHO, DA_HUY):
			frappe.throw(
				_(
					"Kế toán đã nhập hàng theo phiếu hủy của lô {0} — không lùi về chặng vận chuyển "
					"được nữa."
				).format(self.name)
			)
		if self.trang_thai == DA_HUY and before.trang_thai != DA_HUY:
			frappe.throw(
				_(
					"Kế toán đã mở phiếu kiểm hàng cho lô {0} — không hủy được nữa. Nhờ kế toán xóa "
					"phiếu kiểm trước, hoặc Kế toán trưởng kết luận 'không lập hóa đơn trả về'."
				).format(self.name)
			)
		doi = [
			lbl
			for f, lbl in (("customer", _("khách hàng")), ("shipping_address_name", _("điểm lấy hàng")))
			if cstr(before.get(f)) != cstr(self.get(f))
		]
		if doi:
			frappe.throw(
				_(
					"Kế toán đã mở phiếu kiểm hàng cho lô {0} — không đổi {1} được nữa. Phiếu kiểm "
					"và hóa đơn trả về đã dựng trên giá trị cũ."
				).format(self.name, ", ".join(doi))
			)
		if (
			before.trang_thai in TRANG_THAI
			and self.trang_thai in TRANG_THAI
			and TRANG_THAI.index(self.trang_thai) < TRANG_THAI.index(before.trang_thai)
		):
			frappe.throw(
				_("Kế toán đã kiểm hàng của lô {0} — không lùi chặng vận chuyển được nữa.").format(self.name)
			)
