// #/thu-hoi/:id — MỘT lô thu hồi. id = "new" là tạo yêu cầu xuất trả mới.
//
// Thứ tự khối = thứ tự người điều hành làm khi nhận phiếu xuất trả của siêu thị:
// khách → điểm lấy hàng → thông tin phiếu → giao xe → hàng khai → đính kèm phiếu.
// Server là sự thật: địa chỉ phải thuộc khách, quy đổi ĐVT, khóa khi kế toán đã kiểm —
// màn hình chỉ kiểm cho mượt tay và hiện nguyên văn câu báo của server.
import { call, upload, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate, formatQty } from "../lib/format.js";
import { go, replace } from "../lib/router.js";
import { showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm.js";
import { chuanBiFile } from "../lib/anh.js";
import { CHANG_FALLBACK, VAN_CHUYEN, changBadge, changBar } from "../components/thu-hoi-ui.js";

const VC = CHANG_FALLBACK.slice(0, VAN_CHUYEN); // ba chặng vận chuyển

let ROOT = null;
let D = null; // bản ghi từ server (null khi tạo mới)
let F = null; // trạng thái form
let OPT = null; // lái xe, xe, chuyến, lý do
let DIRTY = false;
let CHO_FILE = []; // file chọn khi CHƯA lưu lần đầu — gửi ngay sau khi tạo xong
let DIA_CHI = null; // danh sách địa chỉ của khách đang chọn

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
	draw();
	if (F.customer && !khoaKhach()) loadDiaChi("");
}

function formFrom(d) {
	const base = {
		customer: "", customer_name: "", shipping_address_name: "", diem: null,
		ngay_yeu_cau: OPT.today, so_phieu_sieu_thi: "", ly_do: "", nguoi_lien_he: "", sdt_lien_he: "",
		ghi_chu: "", ngay_hen_lay: "", lai_xe: "", xe: "", chuyen_xe: "", so_kien_du_kien: "",
		so_kien_nhan: "", gia_tri_khai: "", items: [],
	};
	if (!d) return base;
	const f = { ...base };
	for (const k of Object.keys(base)) if (d[k] !== undefined && d[k] !== null) f[k] = d[k];
	f.diem = d.shipping_address_name
		? { name: d.shipping_address_name, ten: d.ten_diem, ma: d.ma_diem, dia_chi: d.dia_chi, phone: d.sdt_diem }
		: null;
	f.items = (d.items || []).map((r) => ({ ...r }));
	return f;
}

const khoaKhach = () => !!(D && D.khoa_ke_toan);

// ── vẽ ───────────────────────────────────────────────────────────────────────
function draw() {
	const ds = (D && D.chang_list) || CHANG_FALLBACK;
	ROOT.innerHTML = `
		${D ? headCard(ds) : `<div class="vc-view-banner"><div>
			<div class="vc-view-banner-title">Tạo yêu cầu xuất trả</div>
			<div class="vc-view-banner-subtitle">Siêu thị gọi trả hàng → giao xe vào lấy</div></div>
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
				${sel("ly_do", "Lý do trả", [""].concat(OPT.ly_do || []).map((x) => [x, x || "— chọn —"]))}
				${inp("gia_tri_khai", "Giá trị theo phiếu siêu thị", "number")}
				${inp("nguoi_lien_he", "Người liên hệ ở điểm")}
				${inp("sdt_lien_he", "SĐT liên hệ", "tel")}
			</div>
			<div class="vc-field"><label>Ghi chú</label>
				<textarea class="vc-input" data-f="ghi_chu" style="min-height:56px">${escapeHtml(F.ghi_chu || "")}</textarea></div>
			<div class="vc-text-sm vc-text-muted">Ngày yêu cầu = ngày siêu thị gọi / ngày trên phiếu xuất trả. Tuổi của lô tính từ ngày này.</div>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Điều phối lấy hàng</div>
			<div class="vc-th-grid">
				${inp("ngay_hen_lay", "Ngày hẹn lấy", "date")}
				${sel("lai_xe", "Lái xe", giuGiaTri("lai_xe", [["", "— chưa giao —"]].concat((OPT.drivers || []).map((d) => [d.name, `${d.full_name || d.name}${d.cell_number ? " · " + d.cell_number : ""}`]))))}
				${sel("xe", "Xe", giuGiaTri("xe", [["", "— chọn xe —"]].concat((OPT.vehicles || []).map((v) => [v.name, [v.name, v.make, v.model].filter(Boolean).join(" · ")]))))}
				${sel("chuyen_xe", "Đi kèm chuyến (tùy chọn)", giuGiaTri("chuyen_xe", [["", "— không —"]].concat((OPT.trips || []).map((t) => [t.name, `${t.name} · ${formatDate(t.ngay_giao)} · ${t.ten_lai_xe || ""}`]))))}
				${inp("so_kien_du_kien", "Số kiện dự kiến", "number")}
				${D ? inp("so_kien_nhan", "Số kiện thực nhận", "number") : ""}
			</div>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Hàng siêu thị khai trả</div>
			<div class="vc-text-sm vc-text-muted vc-mb-2">Theo phiếu xuất trả — số KHAI. Kế toán đếm riêng lúc kiểm hàng rồi mới so.</div>
			<input class="vc-input" id="th-item-q" type="search" autocomplete="off" placeholder="➕ Thêm mã: gõ mã / tên / mã vạch..." />
			<div id="th-item-res"></div>
			<div id="th-items"></div>
		</div>
		<div class="vc-card vc-th-sec">
			<div class="vc-section-title">Chứng từ đính kèm</div>
			<label class="vc-photo-btn"><i class="fas fa-paperclip"></i> Chọn file (ảnh / PDF)
				<input type="file" id="th-file" multiple accept="image/*,application/pdf" style="display:none" /></label>
			<div id="th-files" class="vc-mt-2"></div>
		</div>
		<div class="vc-th-actions">
			${D && D.trang_thai === "Tạo yêu cầu" ? `<button class="vc-btn-ghost" id="th-del"><i class="fas fa-trash"></i></button>` : ""}
			<button class="vc-btn-primary" id="th-save" style="flex:1"><i class="fas fa-floppy-disk"></i> ${D ? "Lưu thay đổi" : "Tạo yêu cầu"}</button>
		</div>`;
	drawKhach();
	drawItems();
	drawFiles();
	bind();
}

function headCard(ds) {
	const i = VC.indexOf(D.trang_thai);
	const tien = i >= 0 && i < VC.length - 1 ? VC[i + 1] : null;
	const lui = i > 0 && !D.khoa_ke_toan ? VC[i - 1] : null;
	const moc = (nhan, luc, ai) => (luc ? `<dt>${nhan}</dt><dd>${escapeHtml(fmtLuc(luc))}${ai ? " · " + escapeHtml(ai) : ""}</dd>` : "");
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
			${moc("Lấy hàng", D.lay_luc, D.lay_boi)}
			${moc("Nhận về kho", D.nhan_luc, D.nhan_boi)}
		</dl>
		${D.khoa_ke_toan ? `<div class="vc-th-note vc-mt-2">Kế toán đã mở phiếu kiểm hàng (chặng <b>${escapeHtml(D.chang)}</b>) —
			khách và điểm lấy hàng đã khóa, không lùi chặng được nữa.</div>` : ""}
		${!D.co_ke_toan && D.trang_thai === "Đã nhận hàng" ? `<div class="vc-th-note vc-mt-2">Site chưa cài app kế toán — lô dừng ở "Đã nhận hàng".</div>` : ""}
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">
			${tien ? `<button class="vc-btn-success" data-chang="${escapeHtml(tien)}"><i class="fas fa-arrow-right"></i> ${escapeHtml(tien)}</button>` : ""}
			${lui ? `<button class="vc-btn-ghost" data-chang="${escapeHtml(lui)}"><i class="fas fa-rotate-left"></i> Lùi về "${escapeHtml(lui)}"</button>` : ""}
		</div>
	</div>`;
}

function inp(f, label, type = "text") {
	const v = F[f] === null || F[f] === undefined ? "" : F[f];
	const extra = type === "number" ? ' inputmode="decimal" step="any" min="0"' : "";
	return `<div class="vc-field"><label>${escapeHtml(label)}</label>
		<input class="vc-input" data-f="${f}" type="${type}" value="${escapeHtml(v)}"${extra} /></div>`;
}

// Giá trị đang gắn trên lô mà danh sách chọn đã lọc bỏ (xe ngừng dùng / xe con, lái xe
// đã nghỉ, chuyến đã xong): vẫn hiện đúng nó — ô chọn không được trông như "chưa chọn".
function giuGiaTri(f, opts) {
	const v = F[f];
	return !v || opts.some(([x]) => String(x) === String(v)) ? opts : opts.concat([[v, `${v} (đã ẩn khỏi danh sách)`]]);
}

function sel(f, label, opts) {
	return `<div class="vc-field"><label>${escapeHtml(label)}</label><select class="vc-input" data-f="${f}">${opts
		.map(([v, t]) => `<option value="${escapeHtml(v)}" ${String(F[f] || "") === String(v) ? "selected" : ""}>${escapeHtml(t)}</option>`)
		.join("")}</select></div>`;
}

function drawKhach() {
	const box = ROOT.querySelector("#th-khach");
	const diem = F.diem
		? `<div class="vc-th-diem vc-th-diem-on">
			<div class="vc-font-bold">🏬 ${escapeHtml(F.diem.ten || F.diem.name)}${F.diem.ma ? ` <span class="vc-badge vc-badge-muted">${escapeHtml(F.diem.ma)}</span>` : ""}</div>
			<div class="vc-text-sm vc-text-muted">${escapeHtml(F.diem.dia_chi || "")}${F.diem.phone ? " · ☎ " + escapeHtml(F.diem.phone) : ""}</div>
			<div class="vc-text-sm vc-text-muted">${escapeHtml(F.diem.name)}</div></div>`
		: "";
	if (khoaKhach()) {
		box.innerHTML = `<div class="vc-font-bold">${escapeHtml(F.customer_name || F.customer)}</div>
			<div class="vc-text-sm vc-text-muted vc-mb-2">${escapeHtml(F.customer)}</div>${diem}`;
		return;
	}
	box.innerHTML = `
		${F.customer
			? `<div class="vc-flex vc-items-center vc-justify-between vc-gap-2 vc-mb-2">
				<div><div class="vc-font-bold">${escapeHtml(F.customer_name || F.customer)}</div>
				<div class="vc-text-sm vc-text-muted">${escapeHtml(F.customer)}</div></div>
				<button class="vc-btn-ghost" id="th-doi-khach">Đổi khách</button></div>`
			: `<div class="vc-field"><label>Khách hàng *</label>
				<input class="vc-input" id="th-cust-q" type="search" autocomplete="off" placeholder="Gõ tên / mã khách (Co.op, BigC, Lotte...)" /></div>
				<div id="th-cust-res"></div>`}
		${F.customer ? `${diem}
			<div class="vc-field vc-mt-2"><label>${F.diem ? "Đổi điểm lấy hàng" : "Điểm lấy hàng *"}</label>
				<input class="vc-input" id="th-diem-q" type="search" autocomplete="off" placeholder="Tìm điểm theo tên / mã / địa chỉ..." /></div>
			<div id="th-diem-res"></div>` : ""}`;
	if (F.customer) drawDiaChi();
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

function drawItems() {
	const box = ROOT.querySelector("#th-items");
	if (!F.items.length) {
		box.innerHTML = `<div class="vc-text-sm vc-text-muted vc-mt-2">Chưa có mã nào. Không bắt buộc — nhưng có số khai thì kế toán mới so được lệch.</div>`;
		return;
	}
	box.innerHTML = `<div class="vc-th-rows">${F.items
		.map((r, i) => {
			const uoms = r.uoms && r.uoms.length ? r.uoms : [{ uom: r.uom || r.stock_uom, he_so: 1 }];
			return `<div class="vc-th-row">
				<div class="vc-th-row-name"><div class="vc-font-bold vc-text-sm">${escapeHtml(r.item_name || r.item_code)}</div>
					<div class="vc-text-sm vc-text-muted">${escapeHtml(r.item_code)}</div></div>
				<input class="vc-input vc-th-qty" data-i="${i}" data-k="qty" type="number" inputmode="decimal" step="any" min="0" value="${escapeHtml(r.qty)}" />
				<select class="vc-input vc-th-uom" data-i="${i}" data-k="uom">${uoms
					.map((u) => `<option value="${escapeHtml(u.uom)}" ${u.uom === (r.uom || r.stock_uom) ? "selected" : ""}>${escapeHtml(u.uom)}${u.he_so > 1 ? ` (${formatQty(u.he_so)})` : ""}</option>`)
					.join("")}</select>
				<button type="button" class="vc-icon-btn" data-xoa="${i}" aria-label="Xóa dòng"><i class="fas fa-xmark"></i></button>
			</div>`;
		})
		.join("")}</div>`;
	box.querySelectorAll("[data-k]").forEach((el) =>
		el.addEventListener("input", () => {
			const r = F.items[Number(el.dataset.i)];
			if (!r) return;
			r[el.dataset.k] = el.dataset.k === "qty" ? Number(el.value) || 0 : el.value;
			DIRTY = true;
		})
	);
	box.querySelectorAll("[data-xoa]").forEach((b) =>
		b.addEventListener("click", () => {
			F.items.splice(Number(b.dataset.xoa), 1);
			DIRTY = true;
			drawItems();
		})
	);
}

function drawFiles() {
	const box = ROOT.querySelector("#th-files");
	if (!D) {
		box.innerHTML = CHO_FILE.length
			? `<div class="vc-text-sm">Sẽ gửi sau khi tạo: ${CHO_FILE.map((f) => escapeHtml(f.name)).join(", ")}</div>`
			: `<div class="vc-text-sm vc-text-muted">Phiếu xuất trả của siêu thị (PDF/ảnh), biên bản, ảnh hàng...</div>`;
		return;
	}
	const files = D.files || [];
	box.innerHTML = files.length
		? `<div class="vc-th-files">${files
				.map(
					(f) => `<div class="vc-th-file">
				<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener">${
					f.is_image
						? `<img src="${escapeHtml(f.url)}" alt="" loading="lazy" />`
						: `<div class="vc-th-file-icon"><i class="fas fa-file-lines"></i></div>`
				}<div class="vc-th-file-name">${escapeHtml(f.file_name)}</div></a>
				<button type="button" class="vc-icon-btn vc-th-file-x" data-file="${escapeHtml(f.name)}" aria-label="Gỡ file"><i class="fas fa-xmark"></i></button>
			</div>`
				)
				.join("")}</div>`
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

// ── sự kiện ──────────────────────────────────────────────────────────────────
function bind() {
	ROOT.querySelectorAll("[data-f]").forEach((el) =>
		el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
			F[el.dataset.f] = el.value;
			DIRTY = true;
		})
	);
	bindKhach();
	bindItemSearch();
	ROOT.querySelector("#th-file").addEventListener("change", onFiles);
	ROOT.querySelector("#th-save").addEventListener("click", save);
	const del = ROOT.querySelector("#th-del");
	if (del) del.addEventListener("click", xoaLo);
	ROOT.querySelectorAll("[data-chang]").forEach((b) => b.addEventListener("click", () => doiChang(b.dataset.chang, b)));
}

function bindKhach() {
	const doi = ROOT.querySelector("#th-doi-khach");
	if (doi)
		doi.addEventListener("click", () => {
			F.customer = F.customer_name = F.shipping_address_name = "";
			F.diem = null;
			DIA_CHI = null;
			DIRTY = true;
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
							DIRTY = true;
							drawKhach();
							bindKhach();
							loadDiaChi("");
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

function bindItemSearch() {
	const q = ROOT.querySelector("#th-item-q");
	let t = null;
	q.addEventListener("input", () => {
		clearTimeout(t);
		t = setTimeout(async () => {
			const res = ROOT.querySelector("#th-item-res");
			const v = q.value.trim();
			if (!v) {
				res.innerHTML = "";
				return;
			}
			try {
				const rows = await call("vanchuyen.api.thu_hoi.search_items", { tim: v });
				res.innerHTML = rows.length
					? rows.map((it, i) => `<button type="button" class="vc-th-diem" data-it="${i}">
						<div class="vc-font-bold vc-text-sm">${escapeHtml(it.item_name || it.name)}</div>
						<div class="vc-text-sm vc-text-muted">${escapeHtml(it.name)} · ĐVT kho ${escapeHtml(it.stock_uom || "")}</div></button>`).join("")
					: '<div class="vc-text-sm vc-text-muted">Không tìm thấy mã hàng.</div>';
				res.querySelectorAll("[data-it]").forEach((b) =>
					b.addEventListener("click", () => {
						const it = rows[Number(b.dataset.it)];
						if (F.items.some((r) => r.item_code === it.name)) {
							showToast("Mã này đã có — sửa số lượng ở dòng đó.", "warning");
							return;
						}
						F.items.push({ item_code: it.name, item_name: it.item_name, uom: it.stock_uom, stock_uom: it.stock_uom, uoms: it.uoms, qty: 1 });
						DIRTY = true;
						q.value = "";
						res.innerHTML = "";
						drawItems();
					})
				);
			} catch (e) {
				showToast(errText(e), "error");
			}
		}, 300);
	});
}

async function onFiles(e) {
	const files = Array.from(e.target.files || []);
	e.target.value = "";
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
		"ghi_chu", "ngay_hen_lay", "lai_xe", "xe", "chuyen_xe", "so_kien_du_kien", "so_kien_nhan", "gia_tri_khai"].forEach((k) => {
		if (k === "so_kien_nhan" && !D) return;
		p[k] = F[k];
	});
	p.items = F.items.map((r) => ({ item_code: r.item_code, uom: r.uom || r.stock_uom, qty: Number(r.qty) || 0, ghi_chu: r.ghi_chu || "" }));
	return p;
}

async function save() {
	if (!F.customer) return showToast("Chọn khách hàng trước", "warning");
	if (!F.shipping_address_name) return showToast("Chọn điểm lấy hàng (địa chỉ của khách)", "warning");
	if (!F.ngay_yeu_cau) return showToast("Chọn ngày yêu cầu", "warning");
	if (F.items.some((r) => !(Number(r.qty) > 0))) return showToast("Số lượng khai phải > 0 (hoặc xóa dòng)", "warning");
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

// "2026-10-17 09:12:33.4" → "17/10 09:12". Không đi qua new Date(): Safari không đọc
// chuỗi có dấu cách giữa ngày và giờ.
function fmtLuc(s) {
	const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
	return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(s || "");
}

function errBox(msg) {
	return `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
		<div class="vc-empty-title">Không tải được lô thu hồi</div>
		<p class="vc-text-muted">${escapeHtml(msg)}</p>
		<a class="vc-btn-ghost" href="#/thu-hoi">← Danh sách thu hồi</a></div>`;
}
