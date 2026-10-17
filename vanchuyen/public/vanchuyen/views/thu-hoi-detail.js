// #/thu-hoi/:id — MỘT lô thu hồi. id = "new" là tạo yêu cầu xuất trả mới.
//
// Thứ tự khối = thứ tự người điều hành làm khi siêu thị báo trả hàng:
// khách → điểm lấy hàng → thông tin phiếu → dán chi tiết hàng từ mail → đơn vị thu hồi
// (Viettel Post / Nhất Tín vào lấy) → đính kèm. Mã hàng + số lượng chính xác là việc của
// kế toán lúc kiểm hàng — màn này không bắt gõ từng mã.
// Server là sự thật: địa chỉ phải thuộc khách, đuôi file đính kèm, khóa khi kế toán đã
// kiểm — màn hình chỉ kiểm cho mượt tay và hiện nguyên văn câu báo của server.
// Hủy yêu cầu: lô GIỮ LẠI ở "Đã hủy" kèm lý do (không xóa), chỉ xem — trừ đính kèm (mail
// hủy của siêu thị hay đến sau); "Khôi phục" đưa về đúng chặng trước khi hủy.
import { call, upload, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate } from "../lib/format.js";
import { go, replace } from "../lib/router.js";
import { showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm.js";
import { showModal, closeModal } from "../components/modal.js";
import { chuanBiFile } from "../lib/anh.js";
import { CHANG_FALLBACK, DA_HUY, VAN_CHUYEN, changBadge, changBar, fmtLuc } from "../components/thu-hoi-ui.js";

const VC = CHANG_FALLBACK.slice(0, VAN_CHUYEN); // ba chặng vận chuyển

let ROOT = null;
let D = null; // bản ghi từ server (null khi tạo mới)
let F = null; // trạng thái form
let OPT = null; // lý do trả, đơn vị thu hồi
let DIRTY = false;
let CHO_FILE = []; // file chọn khi CHƯA lưu lần đầu — gửi ngay sau khi tạo xong
let DIA_CHI = null; // danh sách địa chỉ của khách đang chọn (null = chưa tải)
let DOI_DIEM = false; // đã có điểm mà người dùng bấm "Đổi điểm" → mở lại danh sách

// Đuôi file nhận đính kèm — KHỚP `DUOI_DINH_KEM` ở api/thu_hoi.py (server mới là chốt; ở
// đây lọc trước để khỏi tải một file 10MB lên rồi mới bị từ chối).
const DUOI = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "pdf",
	"xls", "xlsx", "xlsm", "csv", "ods", "doc", "docx", "odt", "rtf", "txt",
	"eml", "msg", "zip", "rar", "7z"]);
const ACCEPT = "image/*,application/pdf," + [...DUOI].filter((d) => !/^(jpe?g|png|webp|gif|hei[cf])$/.test(d)).map((d) => "." + d).join(",");
const duoi = (ten) => ((String(ten || "").match(/\.([^.]+)$/) || [])[1] || "").toLowerCase();
const ICON = {
	pdf: "fa-file-pdf", xls: "fa-file-excel", xlsx: "fa-file-excel", xlsm: "fa-file-excel", ods: "fa-file-excel",
	csv: "fa-file-csv", doc: "fa-file-word", docx: "fa-file-word", odt: "fa-file-word", rtf: "fa-file-word",
	txt: "fa-file-lines", eml: "fa-envelope", msg: "fa-envelope", zip: "fa-file-zipper", rar: "fa-file-zipper", "7z": "fa-file-zipper",
};
// Loại server mở thẳng trong tab (`DUOI_XEM_TRONG_TAB`); loại khác server trả dạng tải xuống.
const XEM_TRONG_TAB = new Set(["jpg", "jpeg", "png", "webp", "gif", "pdf"]);

export async function render({ container, params }) {
	ROOT = container;
	container.innerHTML = skeleton(140, 3);
	const isNew = params.id === "new";
	try {
		const [opt, d] = await Promise.all([
			call("vanchuyen.api.thu_hoi.get_lua_chon"),
			isNew ? Promise.resolve(null) : call("vanchuyen.api.thu_hoi.get_lo", { name: params.id }),
		]);
		OPT = opt;
		D = d;
	} catch (e) {
		container.innerHTML = errBox(errText(e));
		return;
	}
	F = formFrom(D);
	DIRTY = false;
	CHO_FILE = [];
	DIA_CHI = null;
	DOI_DIEM = false;
	draw();
}

function formFrom(d) {
	const base = {
		customer: "", customer_name: "", shipping_address_name: "", diem: null,
		ngay_yeu_cau: OPT.today, so_phieu_sieu_thi: "", ly_do: "", nguoi_lien_he: "", sdt_lien_he: "",
		ghi_chu: "", chi_tiet_hang: "", don_vi_thu_hoi: "", ma_van_don: "", ngay_hen_lay: "",
		so_kien_du_kien: "", so_kien_nhan: "", gia_tri_khai: "",
	};
	if (!d) return base;
	const f = { ...base };
	for (const k of Object.keys(base)) if (d[k] !== undefined && d[k] !== null) f[k] = d[k];
	f.diem = d.shipping_address_name
		? { name: d.shipping_address_name, ten: d.ten_diem, ma: d.ma_diem, dia_chi: d.dia_chi, phone: d.sdt_diem }
		: null;
	return f;
}

const khoaKhach = () => !!(D && D.khoa_ke_toan);
const daHuy = () => !!(D && D.trang_thai === DA_HUY);
// Lô hủy chỉ xem: ô nhập / ô chọn khóa hẳn; ô văn bản (mail dán dài) để readonly — vẫn cuộn,
// bôi chọn, copy được, thứ mà ô disabled không cho trên mọi trình duyệt.
const chiDoc = () => (daHuy() ? " readonly" : "");

// ── vẽ ───────────────────────────────────────────────────────────────────────
function draw() {
	const ds = (D && D.chang_list) || CHANG_FALLBACK;
	ROOT.innerHTML = `
		${D ? headCard(ds) : `<div class="vc-view-banner"><div>
			<div class="vc-view-banner-title">Tạo yêu cầu xuất trả</div>
			<div class="vc-view-banner-subtitle">Siêu thị báo trả hàng → đơn vị vận chuyển vào lấy</div></div>
			<div class="vc-view-banner-badge"><i class="fas fa-rotate-left"></i></div></div>`}
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Khách hàng &amp; điểm lấy hàng</div>
			<div id="th-khach"></div>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Thông tin yêu cầu</div>
			<div class="vc-th-grid">
				${inp("ngay_yeu_cau", "Ngày yêu cầu *", "date")}
				${inp("so_phieu_sieu_thi", "Số phiếu xuất trả (siêu thị)")}
				${sel("ly_do", "Lý do trả", giuGiaTri("ly_do", [""].concat(OPT.ly_do || []).map((x) => [x, x || "— chọn —"])))}
				${inp("gia_tri_khai", "Giá trị theo phiếu siêu thị", "number")}
				${inp("nguoi_lien_he", "Người liên hệ ở điểm")}
				${inp("sdt_lien_he", "SĐT liên hệ", "tel")}
			</div>
			<div class="vc-field"><label>Ghi chú</label>
				<textarea class="vc-input" data-f="ghi_chu" style="min-height:56px"${chiDoc()}>${escapeHtml(F.ghi_chu || "")}</textarea></div>
			<div class="vc-text-sm vc-text-muted">Ngày yêu cầu = ngày siêu thị gọi / ngày trên phiếu xuất trả. Tuổi của lô tính từ ngày này.</div>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Chi tiết hàng cần thu</div>
			<div class="vc-text-sm vc-text-muted vc-mb-2">Siêu thị gửi danh sách hàng qua mail thì copy cả bảng dán NGUYÊN VĂN vào đây.
				Mã hàng + số lượng chính xác kế toán ghi lúc kiểm hàng.</div>
			<textarea class="vc-input vc-th-paste" data-f="chi_tiet_hang" rows="8" spellcheck="false"${chiDoc()}
				placeholder="Dán nội dung mail siêu thị gửi — danh sách hàng cần thu...">${escapeHtml(F.chi_tiet_hang || "")}</textarea>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Điều phối thu hồi</div>
			<div class="vc-text-sm vc-text-muted vc-mb-2">Đơn vị vận chuyển vào siêu thị lấy hàng trả về công ty.</div>
			<div class="vc-th-grid">
				${sel("don_vi_thu_hoi", "Đơn vị thu hồi", giuGiaTri("don_vi_thu_hoi", [["", "— chọn —"]].concat((OPT.don_vi || []).map((x) => [x, x]))))}
				${inp("ma_van_don", "Mã vận đơn (nếu có)")}
				${inp("ngay_hen_lay", "Ngày thu", "date")}
				${inp("so_kien_du_kien", "Số kiện (theo vận đơn)", "number")}
				${D ? inp("so_kien_nhan", "Số kiện thực nhận", "number") : ""}
			</div>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Chứng từ đính kèm</div>
			<label class="vc-photo-btn"><i class="fas fa-paperclip"></i> Chọn file (ảnh / PDF / Excel / Word / mail...)
				<input type="file" id="th-file" multiple accept="${ACCEPT}" style="display:none" /></label>
			<div id="th-files" class="vc-mt-2"></div>
		</div>
		${daHuy() ? "" : `<div class="vc-th-actions">
			${D && D.trang_thai === "Tạo yêu cầu" ? `<button class="vc-btn-ghost" id="th-del"><i class="fas fa-trash"></i></button>` : ""}
			<button class="vc-btn-primary" id="th-save" style="flex:1"><i class="fas fa-floppy-disk"></i> ${D ? "Lưu thay đổi" : "Tạo yêu cầu"}</button>
		</div>`}`;
	drawKhach();
	drawFiles();
	bind();
}

function headCard(ds) {
	const huy = daHuy();
	const ve = D.huy_tu || "Tạo yêu cầu"; // chặng trước khi hủy — Khôi phục về đúng đây
	const i = VC.indexOf(D.trang_thai);
	const tien = !huy && i >= 0 && i < VC.length - 1 ? VC[i + 1] : null;
	const lui = !huy && i > 0 && !D.khoa_ke_toan ? VC[i - 1] : null;
	const moc = (nhan, luc, ai) => (luc ? `<dt>${nhan}</dt><dd>${escapeHtml(fmtLuc(luc))}${ai ? " · " + escapeHtml(ai) : ""}</dd>` : "");
	const thuHoi = [D.don_vi_thu_hoi, D.ma_van_don ? "VĐ " + D.ma_van_don : "", D.ngay_hen_lay ? "thu " + formatDate(D.ngay_hen_lay) : ""]
		.filter(Boolean)
		.join(" · ");
	return `
	<div class="vc-card vc-th-sec">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${escapeHtml(D.name)}</div>
				<div class="vc-order-addr">${escapeHtml(D.ten_diem || "")} · ${escapeHtml(D.customer_name || "")}</div>
			</div>
			${changBadge(D.chang, ds)}
		</div>
		${changBar(D.chang, ds)}
		<dl class="vc-detail-list vc-mt-2">
			<dt>Yêu cầu</dt><dd>${escapeHtml(formatDate(D.ngay_yeu_cau))}</dd>
			${thuHoi ? `<dt>Thu hồi</dt><dd>${escapeHtml(thuHoi)}</dd>` : ""}
			${moc("Lấy hàng", D.lay_luc, D.lay_boi)}
			${moc("Nhận về kho", D.nhan_luc, D.nhan_boi)}
		</dl>
		${huy ? `<div class="vc-th-huy-box vc-mt-2">
			<div class="vc-font-bold">🚫 Đã hủy yêu cầu${D.huy_luc ? " · " + escapeHtml(fmtLuc(D.huy_luc)) : ""}${D.huy_boi ? " · " + escapeHtml(D.huy_boi) : ""}</div>
			<div>Lý do: ${escapeHtml(D.ly_do_huy || "")}</div>
			<div class="vc-text-sm">Hủy khi lô đang ở "${escapeHtml(ve)}". Lô hủy chỉ xem — vẫn đính kèm thêm được (mail hủy của siêu thị...).</div>
		</div>` : ""}
		${D.khoa_ke_toan ? `<div class="vc-th-note vc-mt-2">Kế toán đã mở phiếu kiểm hàng (chặng <b>${escapeHtml(D.chang)}</b>) —
			khách và điểm lấy hàng đã khóa, không lùi chặng được nữa. Muốn hủy lô: nhờ kế toán xóa phiếu kiểm trước.</div>` : ""}
		${!D.co_ke_toan && D.trang_thai === "Đã nhận hàng" ? `<div class="vc-th-note vc-mt-2">Site chưa cài app kế toán — lô dừng ở "Đã nhận hàng".</div>` : ""}
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">
			${tien ? `<button class="vc-btn-success" data-chang="${escapeHtml(tien)}"><i class="fas fa-arrow-right"></i> ${escapeHtml(tien)}</button>` : ""}
			${lui ? `<button class="vc-btn-ghost" data-chang="${escapeHtml(lui)}"><i class="fas fa-rotate-left"></i> Lùi về "${escapeHtml(lui)}"</button>` : ""}
			${huy ? `<button class="vc-btn-ghost" id="th-khoiphuc"><i class="fas fa-rotate-left"></i> Khôi phục về "${escapeHtml(ve)}"</button>`
				: !D.khoa_ke_toan ? `<button class="vc-btn-ghost vc-th-btn-huy" id="th-huy"><i class="fas fa-ban"></i> Hủy yêu cầu</button>` : ""}
		</div>
	</div>`;
}

function inp(f, label, type = "text") {
	const v = F[f] === null || F[f] === undefined ? "" : F[f];
	const extra = type === "number" ? ' inputmode="decimal" step="any" min="0"' : "";
	return `<div class="vc-field"><label>${escapeHtml(label)}</label>
		<input class="vc-input" data-f="${f}" type="${type}" value="${escapeHtml(v)}"${extra}${daHuy() ? " disabled" : ""} /></div>`;
}

// Giá trị đang lưu trên lô mà danh sách chọn không còn (lựa chọn Select vừa đổi trên Desk):
// vẫn hiện đúng nó — ô chọn không được trông như "chưa chọn".
function giuGiaTri(f, opts) {
	const v = F[f];
	return !v || opts.some(([x]) => String(x) === String(v)) ? opts : opts.concat([[v, `${v} (đã ẩn khỏi danh sách)`]]);
}

function sel(f, label, opts) {
	return `<div class="vc-field"><label>${escapeHtml(label)}</label><select class="vc-input" data-f="${f}"${daHuy() ? " disabled" : ""}>${opts
		.map(([v, t]) => `<option value="${escapeHtml(v)}" ${String(F[f] || "") === String(v) ? "selected" : ""}>${escapeHtml(t)}</option>`)
		.join("")}</select></div>`;
}

function drawKhach() {
	const box = ROOT.querySelector("#th-khach");
	// Điểm đã chọn: thẻ gọn + nút đổi. Danh sách điểm chỉ mở khi CHƯA chọn hoặc bấm "Đổi
	// điểm" — chọn xong thì thu lại, như ô khách.
	const theDiem = (nut) =>
		F.diem
			? `<div class="vc-th-diem vc-th-diem-on vc-th-diem-chon">
				<div class="vc-th-diem-info">
					<div class="vc-font-bold">🏬 ${escapeHtml(F.diem.ten || F.diem.name)}${F.diem.ma ? ` <span class="vc-badge vc-badge-muted">${escapeHtml(F.diem.ma)}</span>` : ""}</div>
					<div class="vc-text-sm vc-text-muted">${escapeHtml(F.diem.dia_chi || "")}${F.diem.phone ? " · ☎ " + escapeHtml(F.diem.phone) : ""}</div>
					<div class="vc-text-sm vc-text-muted">${escapeHtml(F.diem.name)}</div>
				</div>${nut}</div>`
			: "";
	if (khoaKhach() || daHuy()) {
		box.innerHTML = `<div class="vc-font-bold">${escapeHtml(F.customer_name || F.customer)}</div>
			<div class="vc-text-sm vc-text-muted vc-mb-2">${escapeHtml(F.customer)}</div>${theDiem("")}`;
		return;
	}
	if (!F.customer) {
		box.innerHTML = `<div class="vc-field"><label>Khách hàng *</label>
			<input class="vc-input" id="th-cust-q" type="search" autocomplete="off" placeholder="Gõ tên / mã khách (Co.op, BigC, Lotte...)" /></div>
			<div id="th-cust-res"></div>`;
		return;
	}
	const moList = !F.diem || DOI_DIEM;
	box.innerHTML = `
		<div class="vc-flex vc-items-center vc-justify-between vc-gap-2 vc-mb-2">
			<div><div class="vc-font-bold">${escapeHtml(F.customer_name || F.customer)}</div>
			<div class="vc-text-sm vc-text-muted">${escapeHtml(F.customer)}</div></div>
			<button class="vc-btn-ghost" id="th-doi-khach">Đổi khách</button></div>
		${
			moList
				? `<div class="vc-field vc-mt-2"><label>${F.diem ? "Đổi điểm lấy hàng" : "Điểm lấy hàng *"}</label>
				<input class="vc-input" id="th-diem-q" type="search" autocomplete="off" placeholder="Tìm điểm theo tên / mã / địa chỉ..." /></div>
				<div id="th-diem-res"></div>
				${F.diem ? `<button type="button" class="vc-btn-ghost vc-mt-2" id="th-giu-diem">Giữ điểm cũ: ${escapeHtml(F.diem.ten || F.diem.name)}</button>` : ""}`
				: theDiem(`<button type="button" class="vc-btn-ghost" id="th-doi-diem">Đổi điểm</button>`)
		}`;
	if (!moList) return;
	if (DIA_CHI === null) loadDiaChi("");
	else drawDiaChi();
}

function drawDiaChi() {
	const res = ROOT.querySelector("#th-diem-res");
	if (!res) return;
	if (DIA_CHI === null) {
		res.innerHTML = skeleton(50, 1);
		return;
	}
	if (!DIA_CHI.length) {
		res.innerHTML = `<div class="vc-text-sm vc-text-danger">Khách này chưa có địa chỉ nào khớp. Thêm Address cho khách trên Desk rồi chọn lại.</div>`;
		return;
	}
	res.innerHTML = `<div class="vc-th-diem-list">${DIA_CHI.map(
		(a) => `<button type="button" class="vc-th-diem ${F.shipping_address_name === a.name ? "vc-th-diem-on" : ""}" data-addr="${escapeHtml(a.name)}">
			<div class="vc-font-bold">${escapeHtml(a.ten)}${a.ma ? ` <span class="vc-badge vc-badge-muted">${escapeHtml(a.ma)}</span>` : ""}</div>
			<div class="vc-text-sm vc-text-muted">${escapeHtml(a.dia_chi || a.name)}</div></button>`
	).join("")}</div>`;
	res.querySelectorAll("[data-addr]").forEach((b) =>
		b.addEventListener("click", () => {
			const a = DIA_CHI.find((x) => x.name === b.dataset.addr);
			if (!a) return;
			F.shipping_address_name = a.name;
			F.diem = a;
			DOI_DIEM = false; // chọn xong thì thu danh sách lại
			DIRTY = true;
			drawKhach();
			bindKhach();
		})
	);
}

async function loadDiaChi(tim) {
	DIA_CHI = null;
	drawDiaChi();
	try {
		DIA_CHI = await call("vanchuyen.api.thu_hoi.get_dia_chi", { customer: F.customer, tim: tim || undefined });
	} catch (e) {
		DIA_CHI = [];
		showToast(errText(e), "error");
	}
	drawDiaChi();
}

function drawFiles() {
	const box = ROOT.querySelector("#th-files");
	if (!D) {
		box.innerHTML = CHO_FILE.length
			? `<div class="vc-text-sm">Sẽ gửi sau khi tạo: ${CHO_FILE.map((f) => escapeHtml(f.name)).join(", ")}</div>`
			: `<div class="vc-text-sm vc-text-muted">Phiếu xuất trả của siêu thị (PDF / ảnh), mail, file Excel danh sách hàng, biên bản...</div>`;
		return;
	}
	const files = D.files || [];
	box.innerHTML = files.length
		? `<div class="vc-th-files">${files.map(theFile).join("")}</div>`
		: `<div class="vc-text-sm vc-text-muted">Chưa có file nào.</div>`;
	box.querySelectorAll("[data-file]").forEach((b) =>
		b.addEventListener("click", () =>
			confirmDialog({
				title: "Gỡ file đính kèm",
				message: "Gỡ file này khỏi lô? File bị xóa hẳn.",
				okText: "Gỡ",
				danger: true,
				onOk: async () => {
					try {
						const r = await call("vanchuyen.api.thu_hoi.xoa_dinh_kem", { name: D.name, file: b.dataset.file });
						D.files = r.files;
						drawFiles();
					} catch (e) {
						showToast(errText(e), "error");
					}
				},
			})
		)
	);
}

function theFile(f) {
	const ext = f.ext || duoi(f.file_name);
	// Ảnh / PDF mở tab mới; Excel / Word… server trả dạng tải xuống → `download`.
	const mo = XEM_TRONG_TAB.has(ext) ? 'target="_blank" rel="noopener"' : `download="${escapeHtml(f.file_name)}"`;
	return `<div class="vc-th-file">
		<a href="${escapeHtml(f.url)}" ${mo}>${
			f.is_image
				? `<img src="${escapeHtml(f.url)}" alt="" loading="lazy" />`
				: `<div class="vc-th-file-icon"><i class="fas ${ICON[ext] || "fa-file"}"></i></div>`
		}<div class="vc-th-file-name">${escapeHtml(f.file_name)}</div></a>
		<button type="button" class="vc-icon-btn vc-th-file-x" data-file="${escapeHtml(f.name)}" aria-label="Gỡ file"><i class="fas fa-xmark"></i></button>
	</div>`;
}

// ── sự kiện ──────────────────────────────────────────────────────────────────
function bind() {
	ROOT.querySelectorAll("[data-f]").forEach((el) =>
		el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
			F[el.dataset.f] = el.value;
			DIRTY = true;
		})
	);
	bindKhach();
	ROOT.querySelector("#th-file").addEventListener("change", onFiles);
	const sv = ROOT.querySelector("#th-save");
	if (sv) sv.addEventListener("click", save);
	const del = ROOT.querySelector("#th-del");
	if (del) del.addEventListener("click", xoaLo);
	const huy = ROOT.querySelector("#th-huy");
	if (huy) huy.addEventListener("click", huyLo);
	const kp = ROOT.querySelector("#th-khoiphuc");
	if (kp) kp.addEventListener("click", khoiPhuc);
	ROOT.querySelectorAll("[data-chang]").forEach((b) => b.addEventListener("click", () => doiChang(b.dataset.chang, b)));
}

function bindKhach() {
	const doi = ROOT.querySelector("#th-doi-khach");
	if (doi)
		doi.addEventListener("click", () => {
			F.customer = F.customer_name = F.shipping_address_name = "";
			F.diem = null;
			DIA_CHI = null;
			DOI_DIEM = false;
			DIRTY = true;
			drawKhach();
			bindKhach();
		});
	const doiDiem = ROOT.querySelector("#th-doi-diem");
	if (doiDiem)
		doiDiem.addEventListener("click", () => {
			DOI_DIEM = true;
			DIA_CHI = null; // tải lại đủ danh sách — lần tìm trước có thể đã lọc bớt
			drawKhach();
			bindKhach();
		});
	const giu = ROOT.querySelector("#th-giu-diem");
	if (giu)
		giu.addEventListener("click", () => {
			DOI_DIEM = false;
			drawKhach();
			bindKhach();
		});
	const cq = ROOT.querySelector("#th-cust-q");
	if (cq) {
		let t = null;
		cq.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(async () => {
				const res = ROOT.querySelector("#th-cust-res");
				const v = cq.value.trim();
				if (!v) {
					res.innerHTML = "";
					return;
				}
				try {
					const rows = await call("vanchuyen.api.thu_hoi.search_customers", { tim: v });
					res.innerHTML = rows.length
						? rows.map((c) => `<button type="button" class="vc-th-diem" data-cust="${escapeHtml(c.name)}" data-ten="${escapeHtml(c.customer_name || c.name)}">
							<div class="vc-font-bold">${escapeHtml(c.customer_name || c.name)}</div>
							<div class="vc-text-sm vc-text-muted">${escapeHtml(c.name)}${c.customer_group ? " · " + escapeHtml(c.customer_group) : ""}</div></button>`).join("")
						: '<div class="vc-text-sm vc-text-muted">Không tìm thấy khách.</div>';
					res.querySelectorAll("[data-cust]").forEach((b) =>
						b.addEventListener("click", () => {
							F.customer = b.dataset.cust;
							F.customer_name = b.dataset.ten;
							F.shipping_address_name = "";
							F.diem = null;
							DIA_CHI = null; // drawKhach tự tải danh sách điểm của khách mới
							DOI_DIEM = false;
							DIRTY = true;
							drawKhach();
							bindKhach();
						})
					);
				} catch (e) {
					showToast(errText(e), "error");
				}
			}, 300);
		});
	}
	const dq = ROOT.querySelector("#th-diem-q");
	if (dq) {
		let t = null;
		dq.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => loadDiaChi(dq.value.trim()), 300);
		});
	}
}

async function onFiles(e) {
	const chon = Array.from(e.target.files || []);
	e.target.value = "";
	const bo = chon.filter((f) => !DUOI.has(duoi(f.name)));
	if (bo.length)
		showToast(`Không đính kèm được: ${bo.map((f) => f.name).join(", ")} — chỉ nhận ảnh, PDF, Excel, Word, txt, mail, file nén`, "warning");
	const files = chon.filter((f) => DUOI.has(duoi(f.name)));
	if (!files.length) return;
	if (!D) {
		CHO_FILE = CHO_FILE.concat(files);
		drawFiles();
		return;
	}
	await guiFile(D.name, files);
}

async function guiFile(name, files) {
	let loi = 0;
	for (const f of files) {
		try {
			const r = await upload("vanchuyen.api.thu_hoi.upload_dinh_kem", await chuanBiFile(f), { name });
			if (D && D.name === name) D.files = r.files;
		} catch (err) {
			loi += 1;
			showToast(`${f.name}: ${errText(err)}`, "error");
		}
	}
	if (D) drawFiles();
	if (files.length - loi > 0) showToast(`Đã đính kèm ${files.length - loi} file`, "success");
}

function payload() {
	const p = {};
	["ngay_yeu_cau", "so_phieu_sieu_thi", "ly_do", "customer", "shipping_address_name", "nguoi_lien_he", "sdt_lien_he",
		"ghi_chu", "chi_tiet_hang", "don_vi_thu_hoi", "ma_van_don", "ngay_hen_lay", "so_kien_du_kien", "so_kien_nhan",
		"gia_tri_khai"].forEach((k) => {
		if (k === "so_kien_nhan" && !D) return;
		p[k] = F[k];
	});
	return p;
}

async function save() {
	if (!F.customer) return showToast("Chọn khách hàng trước", "warning");
	if (!F.shipping_address_name) return showToast("Chọn điểm lấy hàng (địa chỉ của khách)", "warning");
	if (!F.ngay_yeu_cau) return showToast("Chọn ngày yêu cầu", "warning");
	const btn = ROOT.querySelector("#th-save");
	btn.disabled = true;
	try {
		const moi = !D;
		const d = await call("vanchuyen.api.thu_hoi.save_lo", { payload: JSON.stringify(payload()), name: D ? D.name : undefined });
		D = d;
		if (moi && CHO_FILE.length) {
			const files = CHO_FILE;
			CHO_FILE = [];
			await guiFile(d.name, files);
			D = await call("vanchuyen.api.thu_hoi.get_lo", { name: d.name });
		}
		F = formFrom(D);
		DIRTY = false;
		DOI_DIEM = false;
		// Tạo xong thì đổi URL tại chỗ (không thêm một nấc "new" vào lịch sử) rồi vẽ lại
		// bằng bản ghi thật — để còn đính kèm tiếp và chuyển chặng.
		if (moi) replace("/thu-hoi/" + encodeURIComponent(D.name));
		draw();
		showToast(moi ? `Đã tạo ${D.name}` : "Đã lưu", "success");
	} catch (e) {
		btn.disabled = false;
		showToast(errText(e), "error");
	}
}

async function doiChang(chang, btn) {
	if (DIRTY) return showToast("Đang có thay đổi chưa lưu — bấm Lưu trước", "warning");
	let soKien;
	if (chang === "Đã nhận hàng") {
		const v = window.prompt("Số kiện thực nhận (để trống nếu chưa đếm):", D.so_kien_nhan ? String(D.so_kien_nhan) : "");
		if (v === null) return;
		soKien = v.trim() === "" ? undefined : Number(v.replace(",", "."));
		if (soKien !== undefined && !(soKien >= 0)) return showToast("Số kiện không hợp lệ", "warning");
	}
	btn.disabled = true;
	try {
		D = await call("vanchuyen.api.thu_hoi.chuyen_chang", { name: D.name, trang_thai: chang, so_kien_nhan: soKien });
		F = formFrom(D);
		DOI_DIEM = false;
		draw();
		showToast(`${D.name}: ${chang}`, "success");
	} catch (e) {
		btn.disabled = false;
		showToast(errText(e), "error");
	}
}

function xoaLo() {
	confirmDialog({
		title: "Xóa lô thu hồi",
		message: `Xóa ${escapeHtml(D.name)} cùng file đính kèm? Chỉ dùng khi lập nhầm.`,
		okText: "Xóa",
		danger: true,
		onOk: async () => {
			try {
				await call("vanchuyen.api.thu_hoi.xoa_lo", { name: D.name });
				showToast("Đã xóa", "success");
				go("/thu-hoi");
			} catch (e) {
				showToast(errText(e), "error");
			}
		},
	});
}

// Hủy: lý do BẮT BUỘC (server cũng chặn) — lô hủy giữ lại làm dấu vết, lý do là câu trả lời
// cho "lô này đi đâu rồi". Gợi ý bấm một chạm cho mấy lý do hay gặp, sửa tiếp được.
const GOI_Y_HUY = ["Siêu thị rút yêu cầu trả hàng", "Lập trùng / lập nhầm lô", "Đơn vị vận chuyển không lấy được hàng"];

function huyLo() {
	if (DIRTY) return showToast("Đang có thay đổi chưa lưu — bấm Lưu trước", "warning");
	const box = showModal({
		title: "Hủy yêu cầu xuất trả",
		body: `<p class="vc-confirm-msg">Lô <b>${escapeHtml(D.name)}</b> chuyển sang <b>Đã hủy</b> và được GIỮ LẠI làm dấu vết
			(không xóa). Hủy nhầm thì bấm "Khôi phục" — lô về lại "${escapeHtml(D.trang_thai)}".</p>
			<div class="vc-th-goi-y">${GOI_Y_HUY.map((g) => `<button type="button" class="vc-chip" data-goi-y="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join("")}</div>
			<div class="vc-field vc-mt-2"><label>Lý do hủy *</label>
				<textarea class="vc-input" id="th-ly-do-huy" rows="3" placeholder="Vì sao hủy — ai báo, lúc nào..."></textarea></div>`,
		footer: `<button class="vc-btn-ghost" data-vc-close>Thôi</button>
			<button class="vc-btn-danger" id="th-huy-ok"><i class="fas fa-ban"></i> Hủy yêu cầu</button>`,
	});
	if (!box) return;
	const ta = box.querySelector("#th-ly-do-huy");
	const ok = box.querySelector("#th-huy-ok");
	box.querySelectorAll("[data-goi-y]").forEach((b) =>
		b.addEventListener("click", () => {
			ta.value = b.dataset.goiY;
			ta.focus();
		})
	);
	ok.addEventListener("click", async () => {
		const ly = ta.value.trim();
		if (ly.length < 5) return showToast("Ghi rõ lý do hủy (ít nhất 5 ký tự)", "warning");
		ok.disabled = true;
		try {
			D = await call("vanchuyen.api.thu_hoi.huy_lo", { name: D.name, ly_do: ly });
			closeModal();
			F = formFrom(D);
			DOI_DIEM = false;
			draw();
			showToast(`Đã hủy ${D.name}`, "success");
		} catch (e) {
			ok.disabled = false;
			showToast(errText(e), "error");
		}
	});
}

function khoiPhuc() {
	const ve = D.huy_tu || "Tạo yêu cầu";
	confirmDialog({
		title: "Khôi phục lô thu hồi",
		message: `Đưa ${escapeHtml(D.name)} về lại "${escapeHtml(ve)}"? Lý do hủy cũ vẫn còn trong lịch sử thay đổi của lô (Desk).`,
		okText: "Khôi phục",
		onOk: async () => {
			try {
				D = await call("vanchuyen.api.thu_hoi.khoi_phuc_lo", { name: D.name });
				F = formFrom(D);
				DOI_DIEM = false;
				draw();
				showToast(`Đã khôi phục ${D.name}: ${D.trang_thai}`, "success");
			} catch (e) {
				showToast(errText(e), "error");
			}
		},
	});
}

function errBox(msg) {
	return `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
		<div class="vc-empty-title">Không tải được lô thu hồi</div>
		<p class="vc-text-muted">${escapeHtml(msg)}</p>
		<a class="vc-btn-ghost" href="#/thu-hoi">← Danh sách thu hồi</a></div>`;
}
