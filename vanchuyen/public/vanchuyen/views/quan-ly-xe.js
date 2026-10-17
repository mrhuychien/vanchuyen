// #/quan-ly-xe — QUẢN LÝ XE: xe tải / xe con, lịch đăng kiểm, lịch thay dầu, nhật ký
// bảo dưỡng & sửa chữa. MỘT module cho 2 route: danh sách (#/quan-ly-xe) và chi tiết
// (#/quan-ly-xe/:id). Hạn + mức cảnh báo do SERVER tính (nhat_ky_xe.py) — client chỉ
// vẽ; phép cộng tháng ở đây CHỈ để xem trước trong form, lưu xong server tính lại.
import { call, upload, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatNumber, formatCurrency, formatDate } from "../lib/format.js";
import { go } from "../lib/router.js";
import { showToast } from "../components/toast.js";
import { showModal, closeModal } from "../components/modal.js";
import { confirmDialog } from "../components/confirm.js";

const API = "vanchuyen.api.quan_ly_xe.";
const XE_TAI = "Xe tải";
const XE_CON = "Xe con";
const LOAI = ["Đăng kiểm", "Thay dầu", "Bảo dưỡng", "Sửa chữa"];
const ICON = { "Đăng kiểm": "📋", "Thay dầu": "🛢️", "Bảo dưỡng": "🔧", "Sửa chữa": "🛠️" };
const CHU_KY = ["6 tháng", "1 năm", "2 năm", "Ngày cụ thể"];
const CHU_KY_THANG = { "6 tháng": 6, "1 năm": 12, "2 năm": 24 };
const NHIEN_LIEU = [
	["Diesel", "Dầu diesel"],
	["Petrol", "Xăng"],
	["Electric", "Điện"],
	["Natural Gas", "Khí (CNG/LPG)"],
];
const NOI_DUNG_GOI_Y = {
	"Đăng kiểm": "VD: Đăng kiểm định kỳ, nộp phí đường bộ",
	"Thay dầu": "VD: Dầu máy 15W-40 + lọc dầu",
	"Bảo dưỡng": "VD: Bảo dưỡng cấp 2 — lọc gió, dầu phanh, căng xích cam",
	"Sửa chữa": "VD: Thay má phanh trước, hàn ống xả",
};
const MUC = {
	qua_han: { badge: "vc-badge-danger", label: "Quá hạn" },
	sap_den: { badge: "vc-badge-warning", label: "Sắp đến hạn" },
	ok: { badge: "vc-badge-success", label: "Còn hạn" },
	chua_co: { badge: "vc-badge-muted", label: "Thiếu dữ liệu" },
	chua_cai: { badge: "vc-badge-muted", label: "Chưa cài lịch" },
};
// Km đọc cũ hơn ngần này ngày thì nhắc: "còn X km" tính trên số km cũ.
const KM_CU_NGAY = 14;

const S = { data: null, filter: "all", xe: null, logLoai: "", logs: null };
let ROOT = null;

export async function render({ container, params }) {
	ROOT = container;
	if (params && params.id) return renderDetail(params.id);
	return renderList();
}

// ── Tiện ích ─────────────────────────────────────────────────────────────────
function todayStr() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 'YYYY-MM-DD' + n tháng lịch, kẹp cuối tháng (31/08 + 6 = 28/02) — CÙNG luật với
// nhat_ky_xe.cong_thang (bộ kiểm docs/verified so hai bên). Chỉ để XEM TRƯỚC.
export function congThang(iso, n) {
	if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
	const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
	const m0 = m - 1 + Number(n || 0);
	const yy = y + Math.floor(m0 / 12);
	const mm = (m0 % 12) + 1;
	const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
	return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function km(n) {
	return formatNumber(n) + " km";
}

function badge(muc) {
	const m = MUC[muc];
	return m ? `<span class="vc-badge ${m.badge}">${m.label}</span>` : "";
}

function errBox(e) {
	return `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
		<div class="vc-empty-title">Không tải được dữ liệu</div>
		<p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
}

function chip(value, active, key, label) {
	return `<button type="button" class="vc-chip-btn ${active ? "active" : ""}" data-${key}="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}"><span>${escapeHtml(label || value)}</span></button>`;
}

// Nhóm chip chọn-một trong modal: bấm là đổi `active`, gọi onPick(value).
function bindChips(root, key, onPick) {
	root.querySelectorAll(`[data-${key}]`).forEach((b) =>
		b.addEventListener("click", () => {
			root.querySelectorAll(`[data-${key}]`).forEach((x) => {
				x.classList.toggle("active", x === b);
				x.setAttribute("aria-pressed", x === b ? "true" : "false");
			});
			onPick(b.getAttribute(`data-${key}`));
		})
	);
}

// Ảnh đính kèm chỉ nhận đường dẫn file của Frappe (hoặc http/https): `dinh_kem` sửa được
// trên Desk, một chuỗi `javascript:` lọt vào href là chạy được khi tổ trưởng bấm ảnh.
function safeUrl(u) {
	return /^(\/(private\/)?files\/|https?:\/\/)/i.test(u || "") ? u : "";
}

function soNguyen(v) {
	const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
	return Number.isFinite(n) ? n : 0;
}

// Nhãn một mục lịch trên thẻ xe / thẻ chi tiết (server đã tính `nhan` + `muc`).
function nhanDangKiem(dk) {
	if (dk.muc === "chua_cai") return "Chưa cài lịch";
	if (dk.muc === "chua_co") return "Chưa có ngày đăng kiểm gần nhất";
	return `${dk.nhan} · ${formatDate(dk.han)}`;
}

function nhanThayDau(td, x) {
	if (td.muc === "chua_cai") return "Chưa cài lịch";
	if (td.muc === "chua_co") {
		if (!td.ngay && !td.km) return "Chưa ghi lần thay dầu";
		if (td.km_tiep && !x.km) return "Chưa có số km hiện tại";
		return "Thiếu số km lúc thay";
	}
	return td.nhan;
}

// Thẻ xe + "Cần chú ý" chỉ cần nhãn ngắn; ngày/km hẹn đầy đủ nằm ở trang chi tiết.
function nhanBaoDuong(bd) {
	return bd.nhan;
}

function kmCu(x) {
	return x.km && x.km_cu_ngay !== null && x.km_cu_ngay > KM_CU_NGAY;
}

function resizeImage(file, maxDim, quality) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			let { width, height } = img;
			if (width > height && width > maxDim) {
				height = Math.round((height * maxDim) / width);
				width = maxDim;
			} else if (height >= width && height > maxDim) {
				width = Math.round((width * maxDim) / height);
				height = maxDim;
			}
			const c = document.createElement("canvas");
			c.width = width;
			c.height = height;
			c.getContext("2d").drawImage(img, 0, 0, width, height);
			c.toBlob((b) => (b ? resolve(b) : reject(new Error("Nén ảnh thất bại"))), "image/jpeg", quality);
			URL.revokeObjectURL(img.src);
		};
		img.onerror = () => reject(new Error("Không đọc được ảnh"));
		img.src = URL.createObjectURL(file);
	});
}

// ════════════════════════════════════════════════════════════════════════════
// DANH SÁCH
// ════════════════════════════════════════════════════════════════════════════
async function renderList() {
	ROOT.innerHTML = skeleton(110, 3);
	try {
		S.data = await call(API + "list_vehicles");
	} catch (e) {
		ROOT.innerHTML = errBox(e);
		return;
	}
	drawList();
}

// Việc cần làm: mọi mục lịch quá hạn / sắp đến hạn, gấp nhất lên đầu.
export function canChuY(xs) {
	const out = [];
	for (const x of xs || []) {
		const items = [
			["Đăng kiểm", x.dang_kiem, nhanDangKiem],
			["Thay dầu", x.thay_dau, (it) => nhanThayDau(it, x)],
			["Bảo dưỡng", x.bao_duong, nhanBaoDuong],
		];
		for (const [hang_muc, it, nhan] of items) {
			if (it && (it.muc === "qua_han" || it.muc === "sap_den")) {
				out.push({ xe: x.name, loai_xe: x.loai_xe, hang_muc, muc: it.muc, con_ngay: it.con_ngay, con_km: it.con_km, nhan: nhan(it) });
			}
		}
	}
	const rank = (v) => (v === null || v === undefined ? Infinity : v);
	out.sort(
		(a, b) =>
			(a.muc === "qua_han" ? 0 : 1) - (b.muc === "qua_han" ? 0 : 1) ||
			rank(a.con_ngay) - rank(b.con_ngay) ||
			rank(a.con_km) - rank(b.con_km)
	);
	return out;
}

function viecHtml(viec, coXe) {
	if (!coXe) return "";
	if (!viec.length) {
		return `<div class="vc-xe-ok-line vc-mb-3">✅ Không có xe nào quá hạn hay sắp đến hạn.</div>`;
	}
	const qua = viec.filter((v) => v.muc === "qua_han").length;
	const rows = viec
		.map(
			(v) => `<button type="button" class="vc-xe-alert ${v.muc}" data-open="${escapeHtml(v.xe)}">
				<span class="vc-xe-alert-dot"></span>
				<span class="vc-xe-alert-main"><b>${escapeHtml(v.xe)}</b> · ${escapeHtml(v.hang_muc)}</span>
				<span class="vc-xe-alert-nhan">${escapeHtml(v.nhan)}</span>
			</button>`
		)
		.join("");
	return `<div class="vc-card vc-mb-3 vc-xe-alerts">
		<div class="vc-xe-alerts-title">${qua ? `🚨 ${qua} việc quá hạn` : `⏰ ${viec.length} việc sắp đến hạn`}${
			viec.length - qua && qua ? ` · ${viec.length - qua} sắp đến hạn` : ""
		}</div>
		${rows}
	</div>`;
}

function pill(key, label) {
	return `<button class="${S.filter === key ? "vc-active" : ""}" data-filter="${key}">${escapeHtml(label)}</button>`;
}

function drawList() {
	const xs = S.data.xe || [];
	const tai = xs.filter((x) => x.loai_xe === XE_TAI);
	const con = xs.filter((x) => x.loai_xe === XE_CON);
	const shown = S.filter === "tai" ? tai : S.filter === "con" ? con : xs;
	const cp = xs.reduce((a, x) => a + (Number(x.chi_phi_nam) || 0), 0);
	ROOT.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Quản lý xe</div>
				<div class="vc-view-banner-subtitle">${tai.length} xe tải · ${con.length} xe con${
					cp ? ` · chi phí ${S.data.nam}: ${escapeHtml(formatCurrency(cp))}` : ""
				}</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-screwdriver-wrench"></i></div>
		</div>
		${viecHtml(canChuY(xs), xs.length)}
		<div class="vc-xe-toolbar">
			<div class="vc-pill-nav" style="margin:0">
				${pill("all", `Tất cả (${xs.length})`)}${pill("tai", `🚚 Xe tải (${tai.length})`)}${pill("con", `🚗 Xe con (${con.length})`)}
			</div>
			<button class="vc-btn-primary" id="qx-add"><i class="fas fa-plus"></i> Thêm xe</button>
		</div>
		<div class="vc-text-sm vc-text-muted vc-mb-2">Chỉ <b>xe tải</b> hiện ở màn Xếp chuyến. Bấm vào xe để ghi đăng kiểm, thay dầu, bảo dưỡng, sửa chữa.</div>
		<div class="vc-list vc-xe-list" id="qx-list">
			${
				shown.length
					? shown.map(xeCard).join("")
					: `<div class="vc-empty"><div class="vc-empty-icon">🚚</div><div class="vc-empty-title">${
							xs.length ? "Không có xe nào trong nhóm này" : "Chưa có xe nào"
						}</div></div>`
			}
		</div>`;

	ROOT.querySelectorAll("[data-filter]").forEach((b) =>
		b.addEventListener("click", () => {
			S.filter = b.dataset.filter;
			drawList();
		})
	);
	ROOT.querySelector("#qx-add").addEventListener("click", () => openXeForm(null));
	bindOpen(ROOT);
}

function bindOpen(root) {
	root.querySelectorAll("[data-open]").forEach((el) => {
		const open = () => go("/quan-ly-xe/" + encodeURIComponent(el.dataset.open));
		el.addEventListener("click", open);
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				open();
			}
		});
	});
}

function worstMuc(x) {
	const ms = [x.dang_kiem, x.thay_dau, x.bao_duong].map((it) => it && it.muc);
	if (ms.includes("qua_han")) return "qua_han";
	if (ms.includes("sap_den")) return "sap_den";
	return "";
}

function lichRow(label, it, text) {
	return `<div class="vc-xe-row"><span class="vc-xe-row-label">${label}</span><span class="vc-xe-muc ${it.muc || ""}">${escapeHtml(text)}</span></div>`;
}

export function xeCard(x) {
	const meta = [
		[x.make, x.model].filter(Boolean).join(" "),
		x.loai_xe === XE_TAI && x.the_tich ? `${formatNumber(x.the_tich, 2)} m³` : "",
		x.km ? km(x.km) + (kmCu(x) ? ` (đọc ${x.km_cu_ngay} ngày trước)` : "") : "",
	]
		.filter(Boolean)
		.join(" · ");
	const bd = x.bao_duong && x.bao_duong.muc ? lichRow("🔧 Bảo dưỡng", x.bao_duong, nhanBaoDuong(x.bao_duong)) : "";
	return `
	<div class="vc-order-card vc-selectable vc-xe-card ${worstMuc(x)}" data-open="${escapeHtml(x.name)}" role="button" tabindex="0">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${x.loai_xe === XE_CON ? "🚗" : "🚚"} ${escapeHtml(x.name)}</div>
				<div class="vc-order-addr">${escapeHtml(meta)}</div>
			</div>
			<span class="vc-badge ${x.loai_xe === XE_CON ? "vc-badge-muted" : "vc-badge-primary"}">${escapeHtml(x.loai_xe)}</span>
		</div>
		<div class="vc-xe-lich">
			${lichRow("📋 Đăng kiểm", x.dang_kiem, nhanDangKiem(x.dang_kiem))}
			${lichRow("🛢️ Thay dầu", x.thay_dau, nhanThayDau(x.thay_dau, x))}
			${bd}
		</div>
		${Number(x.chi_phi_nam) > 0 ? `<div class="vc-xe-cost">Chi phí năm nay: <b>${escapeHtml(formatCurrency(x.chi_phi_nam))}</b></div>` : ""}
	</div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// CHI TIẾT
// ════════════════════════════════════════════════════════════════════════════
async function renderDetail(id) {
	ROOT.innerHTML = skeleton(120, 3);
	const title = document.getElementById("vc-title");
	if (title) title.textContent = id;
	try {
		setXe(await call(API + "get_vehicle", { name: id }));
	} catch (e) {
		ROOT.innerHTML = errBox(e) + `<div class="vc-text-center"><a class="vc-btn-ghost" href="#/quan-ly-xe">← Danh sách xe</a></div>`;
		return;
	}
	drawDetail();
}

function setXe(x) {
	S.xe = x;
	S.logLoai = "";
	S.logs = x.nhat_ky || { rows: [], total: 0, page: 1, has_more: false };
}

// Sau khi lưu / xoá: vẽ lại theo dữ liệu mới nhưng GIỮ bộ lọc nhật ký đang xem — sửa
// một bản ghi "Thay dầu" xong mà bị đá về "Tất cả" thì bản vừa sửa lẫn giữa danh sách.
function capNhatXe(x) {
	const loai = S.logLoai;
	setXe(x);
	S.logLoai = loai;
	drawDetail();
	if (loai) loadLogs(1);
}

function dl(rows) {
	return `<dl class="vc-detail-list vc-text-sm">${rows
		.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v ? escapeHtml(v) : '<span class="vc-text-muted">—</span>'}</dd>`)
		.join("")}</dl>`;
}

function schedCard(icon, title, it, main, rows, buttons) {
	return `<div class="vc-card vc-mb-3 vc-xe-sched ${it && it.muc ? it.muc : ""}">
		<div class="vc-xe-sched-head"><div class="vc-xe-sched-title">${icon} ${escapeHtml(title)}</div>${it ? badge(it.muc) : ""}</div>
		<div class="vc-xe-sched-main ${it && it.muc ? it.muc : ""}">${escapeHtml(main)}</div>
		${dl(rows)}
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">${buttons}</div>
	</div>`;
}

function dkCard(x) {
	const dk = x.dang_kiem;
	return schedCard(
		"📋",
		"Đăng kiểm",
		dk,
		dk.muc === "chua_cai" ? "Chưa cài lịch" : dk.muc === "chua_co" ? "Chưa có ngày đăng kiểm gần nhất" : dk.nhan,
		[
			["Chu kỳ", dk.chu_ky || ""],
			["Lần gần nhất", dk.ngay ? formatDate(dk.ngay) : ""],
			["Hạn", dk.han ? formatDate(dk.han) : ""],
		],
		`<button class="vc-btn-primary" data-ghi="Đăng kiểm"><i class="fas fa-plus"></i> Ghi nhận đăng kiểm</button>
		 <button class="vc-btn-ghost" data-lich="Đăng kiểm"><i class="fas fa-gear"></i> Cài lịch</button>`
	);
}

function tdCard(x) {
	const td = x.thay_dau;
	const chuKy = [td.moi_km ? `mỗi ${km(td.moi_km)}` : "", td.moi_thang ? `${td.moi_thang} tháng` : ""].filter(Boolean).join(" · ");
	const lanGan = [td.ngay ? formatDate(td.ngay) : "", td.km ? km(td.km) : ""].filter(Boolean).join(" · ");
	const lanToi = [td.km_tiep ? km(td.km_tiep) : "", td.han ? formatDate(td.han) : ""].filter(Boolean).join(" · ");
	const kmNow = x.km ? km(x.km) + (x.km_cu_ngay !== null ? ` (đọc ${x.km_cu_ngay ? x.km_cu_ngay + " ngày trước" : "hôm nay"})` : "") : "";
	return schedCard(
		"🛢️",
		"Thay dầu",
		td,
		nhanThayDau(td, x),
		[
			["Chu kỳ", chuKy],
			["Lần gần nhất", lanGan],
			["Lần tới", lanToi],
			["Km hiện tại", kmNow],
		],
		`<button class="vc-btn-primary" data-ghi="Thay dầu"><i class="fas fa-plus"></i> Ghi nhận thay dầu</button>
		 <button class="vc-btn-ghost" data-lich="Thay dầu"><i class="fas fa-gear"></i> Cài lịch</button>`
	);
}

function bdCard(x) {
	const bd = x.bao_duong;
	const hen = bd && bd.muc ? [bd.han ? formatDate(bd.han) : "", bd.km_tiep ? km(bd.km_tiep) : ""].filter(Boolean).join(" · ") : "";
	return schedCard(
		"🔧",
		"Bảo dưỡng & sửa chữa",
		bd && bd.muc ? bd : null,
		bd && bd.muc ? bd.nhan : bd ? "Không có hẹn lần sau" : "Chưa có lần bảo dưỡng nào",
		[
			["Bảo dưỡng gần nhất", bd && bd.ngay ? formatDate(bd.ngay) : ""],
			["Hẹn lần sau", hen],
		],
		`<button class="vc-btn-primary" data-ghi="Bảo dưỡng"><i class="fas fa-plus"></i> Bảo dưỡng</button>
		 <button class="vc-btn-ghost" data-ghi="Sửa chữa"><i class="fas fa-plus"></i> Sửa chữa</button>`
	);
}

function chiPhiCard(x) {
	const cp = x.chi_phi || { nam: "", theo_loai: {}, tong_nam: 0, tong: 0 };
	const chips = LOAI.filter((l) => cp.theo_loai[l] && cp.theo_loai[l].nam > 0)
		.map((l) => `<span class="vc-chip">${ICON[l]} ${escapeHtml(l)} ${escapeHtml(formatCurrency(cp.theo_loai[l].nam))}</span>`)
		.join("");
	const so = LOAI.reduce((a, l) => a + ((cp.theo_loai[l] && cp.theo_loai[l].so) || 0), 0);
	return `<div class="vc-card vc-mb-3">
		<div class="vc-xe-sched-title">💰 Chi phí năm ${escapeHtml(cp.nam)}</div>
		<div class="vc-xe-sched-main">${escapeHtml(formatCurrency(cp.tong_nam))}</div>
		${chips ? `<div class="vc-order-meta" style="margin-top:0">${chips}</div>` : ""}
		<div class="vc-text-sm vc-text-muted vc-mt-2">Từ trước tới nay: ${escapeHtml(formatCurrency(cp.tong))} · ${so} bản ghi</div>
	</div>`;
}

function drawDetail() {
	const x = S.xe;
	ROOT.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">${x.loai_xe === XE_CON ? "🚗" : "🚚"} ${escapeHtml(x.name)}</div>
				<div class="vc-view-banner-subtitle">${escapeHtml(
					[[x.make, x.model].filter(Boolean).join(" "), x.loai_xe, x.loai_xe === XE_TAI && x.the_tich ? `${formatNumber(x.the_tich, 2)} m³` : ""]
						.filter(Boolean)
						.join(" · ")
				)}</div>
			</div>
			<div class="vc-view-banner-badge">${x.km ? escapeHtml(km(x.km)) : "chưa có km"}</div>
		</div>
		<div class="vc-flex vc-gap-2 vc-mb-3" style="flex-wrap:wrap">
			<a class="vc-btn-ghost" href="#/quan-ly-xe"><i class="fas fa-list"></i> Danh sách</a>
			<button class="vc-btn-ghost" id="qx-edit"><i class="fas fa-pen"></i> Sửa thông tin</button>
			<button class="vc-btn-ghost" id="qx-km"><i class="fas fa-gauge-high"></i> Cập nhật km</button>
		</div>
		${kmCu(x) ? `<div class="vc-xe-warn vc-mb-3">⚠️ Số km đọc đã ${x.km_cu_ngay} ngày — nhắc thay dầu theo km có thể trễ. Bấm <b>Cập nhật km</b>.</div>` : ""}
		${x.loai_xe === XE_CON ? `<div class="vc-text-sm vc-text-muted vc-mb-2">Xe con — không hiện ở màn Xếp chuyến.</div>` : ""}
		<div class="vc-two-col">
			<div>${dkCard(x)}${tdCard(x)}${bdCard(x)}</div>
			<div>
				${chiPhiCard(x)}
				<div class="vc-card">
					<div class="vc-xe-sched-title">🗂️ Nhật ký</div>
					<div class="vc-pill-nav" id="qx-log-pills">
						${["", ...LOAI].map((l) => `<button class="${S.logLoai === l ? "vc-active" : ""}" data-log-loai="${escapeHtml(l)}">${l ? ICON[l] + " " + escapeHtml(l) : "Tất cả"}</button>`).join("")}
					</div>
					<div id="qx-logs"></div>
				</div>
			</div>
		</div>`;

	ROOT.querySelector("#qx-edit").addEventListener("click", () => openXeForm(x));
	ROOT.querySelector("#qx-km").addEventListener("click", () => openKm(x));
	ROOT.querySelectorAll("[data-ghi]").forEach((b) => b.addEventListener("click", () => openGhiNhan(b.dataset.ghi, null)));
	ROOT.querySelectorAll("[data-lich]").forEach((b) =>
		b.addEventListener("click", () => (b.dataset.lich === "Đăng kiểm" ? openLichDK(x) : openLichTD(x)))
	);
	ROOT.querySelectorAll("[data-log-loai]").forEach((b) =>
		b.addEventListener("click", () => {
			S.logLoai = b.dataset.logLoai;
			ROOT.querySelectorAll("[data-log-loai]").forEach((o) => o.classList.toggle("vc-active", o === b));
			loadLogs(1);
		})
	);
	drawLogs();
}

async function loadLogs(page) {
	const box = document.getElementById("qx-logs");
	if (page === 1 && box) box.innerHTML = skeleton(70, 2);
	try {
		const res = await call(API + "list_logs", { xe: S.xe.name, loai: S.logLoai || undefined, page, page_size: 20 });
		// Trang > 1 là NỐI THÊM: nút "Xem tiếp" mà làm mất 20 dòng đầu thì tưởng dữ liệu hỏng.
		if (page > 1) res.rows = (S.logs.rows || []).concat(res.rows || []);
		S.logs = res;
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	drawLogs();
}

export function logCard(r) {
	const sub = [r.so_km ? km(r.so_km) : "", r.noi_thuc_hien || ""].filter(Boolean).join(" · ");
	const hen =
		r.loai === "Đăng kiểm" && r.han_tiep
			? `Hạn mới: ${formatDate(r.han_tiep)}`
			: r.loai === "Bảo dưỡng" && (r.han_tiep || r.km_tiep)
				? `Hẹn lần sau: ${[r.han_tiep ? formatDate(r.han_tiep) : "", r.km_tiep ? km(r.km_tiep) : ""].filter(Boolean).join(" · ")}`
				: "";
	return `
	<div class="vc-order-card vc-xe-log">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${ICON[r.loai] || ""} ${escapeHtml(r.loai)} · ${escapeHtml(formatDate(r.ngay))}</div>
				${sub ? `<div class="vc-order-addr">${escapeHtml(sub)}</div>` : ""}
			</div>
			${r.chi_phi ? `<div class="vc-font-bold" style="white-space:nowrap">${escapeHtml(formatCurrency(r.chi_phi))}</div>` : ""}
		</div>
		${r.noi_dung ? `<div class="vc-text-sm vc-mt-1">${escapeHtml(r.noi_dung)}</div>` : ""}
		${hen ? `<div class="vc-text-sm vc-mt-1 vc-xe-hen">${escapeHtml(hen)}</div>` : ""}
		${r.ghi_chu ? `<div class="vc-order-note">📝 ${escapeHtml(r.ghi_chu)}</div>` : ""}
		${safeUrl(r.dinh_kem) ? `<a href="${escapeHtml(safeUrl(r.dinh_kem))}" target="_blank" rel="noopener"><img class="vc-xe-thumb" src="${escapeHtml(safeUrl(r.dinh_kem))}" alt="Ảnh chứng từ" loading="lazy" /></a>` : ""}
		<div class="vc-flex vc-gap-2 vc-mt-2">
			<button class="vc-btn-ghost" data-sua="${escapeHtml(r.name)}"><i class="fas fa-pen"></i> Sửa</button>
			<button class="vc-btn-ghost vc-xe-del" data-xoa="${escapeHtml(r.name)}"><i class="fas fa-trash"></i> Xoá</button>
		</div>
	</div>`;
}

function drawLogs() {
	const box = document.getElementById("qx-logs");
	if (!box) return;
	const rows = S.logs.rows || [];
	if (!rows.length) {
		box.innerHTML = `<div class="vc-text-sm vc-text-muted vc-text-center vc-mt-2 vc-mb-2">Chưa có bản ghi${S.logLoai ? " " + escapeHtml(S.logLoai.toLowerCase()) : ""} nào.</div>`;
		return;
	}
	const more = S.logs.has_more
		? `<button class="vc-btn-ghost vc-btn-block vc-mt-2" id="qx-more">Xem tiếp (đã hiện ${rows.length}/${S.logs.total})</button>`
		: "";
	box.innerHTML = `<div class="vc-list">${rows.map(logCard).join("")}</div>${more}`;
	box.querySelectorAll("[data-sua]").forEach((b) =>
		b.addEventListener("click", () => openGhiNhan(null, rows.find((r) => r.name === b.dataset.sua)))
	);
	box.querySelectorAll("[data-xoa]").forEach((b) =>
		b.addEventListener("click", () => xoaLog(rows.find((r) => r.name === b.dataset.xoa)))
	);
	const mb = document.getElementById("qx-more");
	if (mb) mb.addEventListener("click", () => loadLogs((S.logs.page || 1) + 1));
}

// ════════════════════════════════════════════════════════════════════════════
// FORM
// ════════════════════════════════════════════════════════════════════════════
async function runSave(btn, fn) {
	btn.disabled = true;
	try {
		await fn();
	} catch (e) {
		showToast(errText(e), "error");
	} finally {
		btn.disabled = false;
	}
}

function openXeForm(x) {
	const isNew = !x;
	let loai = x ? x.loai_xe : XE_TAI;
	let fuelTouched = !isNew;
	const fuelOf = (l) => (l === XE_TAI ? "Diesel" : "Petrol");
	const fuel = x ? x.fuel_type || fuelOf(loai) : fuelOf(loai);
	const body = `
		${
			isNew
				? `<div class="vc-field"><label>Biển số *</label><input class="vc-input" id="qx-bs" placeholder="VD 29C-123.45" autocomplete="off" autocapitalize="characters" /></div>`
				: `<div class="vc-text-sm vc-text-muted vc-mb-2">Biển số <b>${escapeHtml(x.name)}</b> — đổi biển số làm trên Desk (kéo theo các chuyến cũ).</div>`
		}
		<div class="vc-field"><label>Loại xe *</label>
			<div class="vc-chip-group" id="qx-loai">${chip(XE_TAI, loai === XE_TAI, "loai", "🚚 Xe tải")}${chip(XE_CON, loai === XE_CON, "loai", "🚗 Xe con")}</div>
			<div class="vc-xe-hint vc-mt-1">Chỉ xe tải hiện ở màn Xếp chuyến. Xe con chỉ theo dõi lịch đăng kiểm, bảo dưỡng.</div>
		</div>
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<div class="vc-field" style="flex:1;min-width:140px"><label>Hãng xe *</label><input class="vc-input" id="qx-make" value="${escapeHtml((x && x.make) || "")}" placeholder="VD Hyundai" /></div>
			<div class="vc-field" style="flex:1;min-width:140px"><label>Dòng xe *</label><input class="vc-input" id="qx-model" value="${escapeHtml((x && x.model) || "")}" placeholder="VD Porter 150" /></div>
		</div>
		<div class="vc-field"><label>Nhiên liệu</label><select class="vc-select" id="qx-fuel">${NHIEN_LIEU.map(
			([v, l]) => `<option value="${v}" ${v === fuel ? "selected" : ""}>${escapeHtml(l)}</option>`
		).join("")}</select></div>
		<div class="vc-field" id="qx-tt-wrap" ${loai === XE_TAI ? "" : "hidden"}><label>Thể tích khả dụng (m³)</label>
			<input class="vc-input" id="qx-tt" type="number" min="0" step="0.1" inputmode="decimal" value="${x && x.the_tich ? escapeHtml(x.the_tich) : ""}" />
			<div class="vc-xe-hint vc-mt-1">Thể tích xếp hàng thực tế (~85–90% thùng) — dùng cho thanh tải ở Xếp chuyến.</div>
		</div>
		${isNew ? `<div class="vc-field"><label>Số km hiện tại</label><input class="vc-input" id="qx-km0" type="number" min="0" step="1" inputmode="numeric" placeholder="VD 123450" /></div>` : ""}`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button><button class="vc-btn-primary" id="qx-xe-save">${isNew ? "Thêm xe" : "Lưu"}</button>`;
	const content = showModal({ title: isNew ? "Thêm xe" : "Sửa thông tin xe", body, footer });
	if (!content) return;
	const q = (id) => content.querySelector("#" + id);
	q("qx-fuel").addEventListener("change", () => (fuelTouched = true));
	bindChips(content, "loai", (v) => {
		loai = v;
		q("qx-tt-wrap").hidden = loai !== XE_TAI;
		if (!fuelTouched) q("qx-fuel").value = fuelOf(loai);
	});
	q("qx-xe-save").addEventListener("click", () =>
		runSave(q("qx-xe-save"), async () => {
			const payload = {
				name: isNew ? undefined : x.name,
				bien_so: isNew ? q("qx-bs").value.trim() : undefined,
				loai_xe: loai,
				make: q("qx-make").value.trim(),
				model: q("qx-model").value.trim(),
				fuel_type: q("qx-fuel").value,
				the_tich: Number(q("qx-tt").value) || 0,
				km: isNew ? soNguyen(q("qx-km0").value) : undefined,
			};
			if (isNew && !payload.bien_so) return showToast("Nhập biển số xe", "warning");
			if (!payload.make || !payload.model) return showToast("Nhập hãng xe và dòng xe", "warning");
			const res = await call(API + "save_vehicle", { payload: JSON.stringify(payload) });
			closeModal();
			showToast(isNew ? `Đã thêm xe ${res.name}` : "Đã lưu thông tin xe", "success");
			if (isNew) {
				go("/quan-ly-xe/" + encodeURIComponent(res.name));
			} else {
				capNhatXe(res);
			}
		})
	);
}

function openKm(x) {
	const body = `
		<div class="vc-field"><label>Số km trên đồng hồ</label>
			<input class="vc-input" id="qx-km-new" type="number" min="0" step="1" inputmode="numeric" value="${x.km || ""}" />
			<div class="vc-xe-hint vc-mt-1">Đang lưu: ${x.km ? escapeHtml(km(x.km)) : "chưa có"}${x.ngay_km ? " · đọc ngày " + escapeHtml(formatDate(x.ngay_km)) : ""}</div>
		</div>`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button><button class="vc-btn-primary" id="qx-km-save">Lưu</button>`;
	const content = showModal({ title: `Cập nhật km · ${escapeHtml(x.name)}`, body, footer });
	if (!content) return;
	const btn = content.querySelector("#qx-km-save");
	const save = (v) =>
		runSave(btn, async () => {
			const res = await call(API + "update_km", { xe: x.name, km: v });
			closeModal();
			showToast("Đã cập nhật km", "success");
			capNhatXe(res);
		});
	btn.addEventListener("click", () => {
		const raw = content.querySelector("#qx-km-new").value;
		if (raw === "") return showToast("Nhập số km", "warning");
		const v = soNguyen(raw);
		if (x.km && v < x.km) {
			// Đồng hồ không chạy lùi — nhỏ hơn số đang lưu gần như chắc là sửa chỗ gõ nhầm.
			confirmDialog({
				title: "Số km nhỏ hơn số đang lưu",
				message: `Đang lưu <b>${escapeHtml(km(x.km))}</b>, số mới <b>${escapeHtml(km(v))}</b>. Chỉ lưu khi đang SỬA số đã gõ nhầm.`,
				okText: "Vẫn lưu",
				danger: true,
				onOk: () => save(v),
			});
			return;
		}
		save(v);
	});
}

function openLichDK(x) {
	const dk = x.dang_kiem;
	let chuKy = dk.chu_ky || "1 năm";
	const body = `
		<div class="vc-field"><label>Chu kỳ đăng kiểm</label>
			<div class="vc-chip-group" id="qx-ck">${CHU_KY.map((c) => chip(c, c === chuKy, "ck")).join("")}</div></div>
		<div class="vc-field"><label id="qx-dk-ngay-lbl">Ngày đăng kiểm gần nhất</label>
			<input class="vc-input" id="qx-dk-ngay" type="date" max="${todayStr()}" value="${escapeHtml(dk.ngay || "")}" /></div>
		<div class="vc-field" id="qx-dk-han-wrap"><label>Hạn đăng kiểm (theo giấy chứng nhận)</label>
			<input class="vc-input" id="qx-dk-han" type="date" value="${escapeHtml(dk.han || "")}" /></div>
		<div class="vc-xe-preview" id="qx-dk-prev"></div>`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button><button class="vc-btn-primary" id="qx-dk-save">Lưu lịch</button>`;
	const content = showModal({ title: `Lịch đăng kiểm · ${escapeHtml(x.name)}`, body, footer });
	if (!content) return;
	const q = (id) => content.querySelector("#" + id);
	const refresh = () => {
		const coDinh = !!CHU_KY_THANG[chuKy];
		q("qx-dk-han-wrap").hidden = coDinh;
		q("qx-dk-ngay-lbl").textContent = coDinh ? "Ngày đăng kiểm gần nhất *" : "Ngày đăng kiểm gần nhất (không bắt buộc)";
		const ngay = q("qx-dk-ngay").value;
		q("qx-dk-prev").hidden = !coDinh;
		q("qx-dk-prev").textContent = coDinh
			? ngay
				? `→ Hạn đăng kiểm: ${formatDate(congThang(ngay, CHU_KY_THANG[chuKy]))}`
				: "Nhập ngày đăng kiểm gần nhất để tính hạn."
			: "";
	};
	bindChips(content, "ck", (v) => {
		chuKy = v;
		refresh();
	});
	q("qx-dk-ngay").addEventListener("input", refresh);
	refresh();
	q("qx-dk-save").addEventListener("click", () =>
		runSave(q("qx-dk-save"), async () => {
			const payload = { chu_ky: chuKy, ngay: q("qx-dk-ngay").value || null, han: CHU_KY_THANG[chuKy] ? null : q("qx-dk-han").value || null };
			if (CHU_KY_THANG[chuKy] && !payload.ngay) return showToast("Nhập ngày đăng kiểm gần nhất", "warning");
			if (!CHU_KY_THANG[chuKy] && !payload.han) return showToast("Nhập hạn đăng kiểm", "warning");
			const res = await call(API + "save_lich", { xe: x.name, hang_muc: "Đăng kiểm", payload: JSON.stringify(payload) });
			closeModal();
			showToast("Đã lưu lịch đăng kiểm", "success");
			capNhatXe(res);
		})
	);
}

function lanToiText(ngay, kmLan, moiKm, moiThang) {
	const parts = [];
	if (moiKm > 0 && kmLan > 0) parts.push(km(kmLan + moiKm));
	if (moiThang > 0 && ngay) parts.push(formatDate(congThang(ngay, moiThang)));
	return parts.join(" · ");
}

function openLichTD(x) {
	const td = x.thay_dau;
	const body = `
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<div class="vc-field" style="flex:1;min-width:130px"><label>Thay mỗi (km)</label>
				<input class="vc-input" id="qx-td-km" type="number" min="0" step="500" inputmode="numeric" placeholder="VD 5000" value="${td.moi_km || ""}" /></div>
			<div class="vc-field" style="flex:1;min-width:130px"><label>Hoặc mỗi (tháng)</label>
				<input class="vc-input" id="qx-td-thang" type="number" min="0" step="1" inputmode="numeric" placeholder="để trống nếu chỉ theo km" value="${td.moi_thang || ""}" /></div>
		</div>
		<div class="vc-xe-hint vc-mb-2">Đặt cả hai thì mốc nào tới trước nhắc mốc đó.</div>
		<div class="vc-section-title" style="margin-top:.25rem">Lần thay gần nhất</div>
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<div class="vc-field" style="flex:1;min-width:130px"><label>Ngày</label>
				<input class="vc-input" id="qx-td-ngay" type="date" max="${todayStr()}" value="${escapeHtml(td.ngay || "")}" /></div>
			<div class="vc-field" style="flex:1;min-width:130px"><label>Số km lúc thay</label>
				<input class="vc-input" id="qx-td-kml" type="number" min="0" step="1" inputmode="numeric" value="${td.km || ""}" /></div>
		</div>
		<div class="vc-xe-preview" id="qx-td-prev"></div>`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button><button class="vc-btn-primary" id="qx-td-save">Lưu lịch</button>`;
	const content = showModal({ title: `Lịch thay dầu · ${escapeHtml(x.name)}`, body, footer });
	if (!content) return;
	const q = (id) => content.querySelector("#" + id);
	const vals = () => ({
		moi_km: soNguyen(q("qx-td-km").value),
		moi_thang: soNguyen(q("qx-td-thang").value),
		ngay: q("qx-td-ngay").value || null,
		km: soNguyen(q("qx-td-kml").value),
	});
	const refresh = () => {
		const v = vals();
		const t = lanToiText(v.ngay, v.km, v.moi_km, v.moi_thang);
		q("qx-td-prev").hidden = !t;
		q("qx-td-prev").textContent = t ? `→ Lần thay tới: ${t}` : "";
	};
	content.querySelectorAll("input").forEach((i) => i.addEventListener("input", refresh));
	refresh();
	q("qx-td-save").addEventListener("click", () =>
		runSave(q("qx-td-save"), async () => {
			const payload = vals();
			if (!payload.moi_km && !payload.moi_thang) return showToast("Nhập chu kỳ theo km hoặc theo tháng", "warning");
			const res = await call(API + "save_lich", { xe: x.name, hang_muc: "Thay dầu", payload: JSON.stringify(payload) });
			closeModal();
			showToast("Đã lưu lịch thay dầu", "success");
			capNhatXe(res);
		})
	);
}

// Ghi nhận MỚI (log = null, loai = hạng mục) hoặc SỬA một bản ghi (log có sẵn).
function openGhiNhan(loai, log) {
	const x = S.xe;
	const edit = !!log;
	loai = edit ? log.loai : loai;
	const dk = x.dang_kiem;
	const td = x.thay_dau;
	// Đăng kiểm: ghi MỚI thì chọn được chu kỳ (lưu luôn vào xe); SỬA thì theo ĐÚNG chu kỳ
	// đang có — kể cả trống (khi đó server đòi hạn nhập tay, form phải hiện ô hạn).
	let chuKy = edit ? dk.chu_ky || "" : dk.chu_ky || "1 năm";
	const chonChuKy = loai === "Đăng kiểm" && !edit;
	// Thay dầu chưa cài chu kỳ → hỏi luôn trong form ghi nhận, khỏi bắt đi Cài lịch trước.
	const hoiChuKyDau = loai === "Thay dầu" && !edit && td.muc === "chua_cai";
	const v = (f, d = "") => (edit && log[f] !== null && log[f] !== undefined && log[f] !== 0 ? log[f] : d);

	const body = `
		${
			chonChuKy
				? `<div class="vc-field"><label>Chu kỳ đăng kiểm của xe</label>
					<div class="vc-chip-group" id="qx-g-ck">${CHU_KY.map((c) => chip(c, c === chuKy, "gck")).join("")}</div></div>`
				: ""
		}
		${
			hoiChuKyDau
				? `<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
					<div class="vc-field" style="flex:1;min-width:130px"><label>Thay mỗi (km)</label><input class="vc-input" id="qx-g-mkm" type="number" min="0" step="500" inputmode="numeric" placeholder="VD 5000" /></div>
					<div class="vc-field" style="flex:1;min-width:130px"><label>Hoặc mỗi (tháng)</label><input class="vc-input" id="qx-g-mth" type="number" min="0" step="1" inputmode="numeric" placeholder="để trống nếu chỉ theo km" /></div>
				</div>`
				: loai === "Thay dầu"
					? `<div class="vc-xe-hint vc-mb-2">Chu kỳ: ${escapeHtml([td.moi_km ? "mỗi " + km(td.moi_km) : "", td.moi_thang ? td.moi_thang + " tháng" : ""].filter(Boolean).join(" · "))} (sửa ở Cài lịch)</div>`
					: ""
		}
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<div class="vc-field" style="flex:1;min-width:140px"><label>Ngày thực hiện *</label>
				<input class="vc-input" id="qx-g-ngay" type="date" max="${todayStr()}" value="${escapeHtml(v("ngay", todayStr()))}" /></div>
			<div class="vc-field" style="flex:1;min-width:140px"><label>Số km lúc làm</label>
				<input class="vc-input" id="qx-g-km" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(v("so_km"))}" placeholder="${x.km ? "đang lưu " + escapeHtml(formatNumber(x.km)) : ""}" /></div>
		</div>
		<div class="vc-field" id="qx-g-han-wrap" hidden><label>Hạn đăng kiểm mới * (theo giấy chứng nhận)</label>
			<input class="vc-input" id="qx-g-han" type="date" value="${escapeHtml(loai === "Đăng kiểm" ? v("han_tiep") : "")}" /></div>
		<div class="vc-xe-preview" id="qx-g-prev" hidden></div>
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<div class="vc-field" style="flex:1;min-width:140px"><label>Chi phí (đ)</label>
				<input class="vc-input" id="qx-g-cp" type="number" min="0" step="1000" inputmode="numeric" value="${escapeHtml(v("chi_phi"))}" />
				<div class="vc-xe-hint" id="qx-g-cp-hint"></div></div>
			<div class="vc-field" style="flex:1;min-width:140px"><label>Nơi làm</label>
				<input class="vc-input" id="qx-g-noi" value="${escapeHtml(v("noi_thuc_hien"))}" placeholder="${loai === "Đăng kiểm" ? "Trạm đăng kiểm…" : "Gara…"}" /></div>
		</div>
		<div class="vc-field"><label>Nội dung</label>
			<textarea class="vc-textarea vc-input" id="qx-g-nd" style="min-height:60px" placeholder="${escapeHtml(NOI_DUNG_GOI_Y[loai] || "")}">${escapeHtml(v("noi_dung"))}</textarea></div>
		${
			loai === "Bảo dưỡng"
				? `<div class="vc-section-title" style="margin-top:.25rem">Hẹn bảo dưỡng lần sau (nếu gara có hẹn)</div>
				<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
					<div class="vc-field" style="flex:1;min-width:140px"><label>Ngày</label><input class="vc-input" id="qx-g-hngay" type="date" value="${escapeHtml(v("han_tiep"))}" /></div>
					<div class="vc-field" style="flex:1;min-width:140px"><label>Hoặc ở km</label><input class="vc-input" id="qx-g-hkm" type="number" min="0" step="500" inputmode="numeric" value="${escapeHtml(v("km_tiep"))}" /></div>
				</div>`
				: ""
		}
		<div class="vc-field"><label>Ghi chú</label>
			<textarea class="vc-textarea vc-input" id="qx-g-gc" style="min-height:44px">${escapeHtml(v("ghi_chu"))}</textarea></div>
		<div class="vc-field"><label>Ảnh hoá đơn / giấy tờ</label><input type="file" id="qx-g-file" accept="image/*" /></div>
		${edit && safeUrl(log.dinh_kem) ? `<img class="vc-xe-thumb" src="${escapeHtml(safeUrl(log.dinh_kem))}" alt="Ảnh đã lưu" />` : ""}`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button><button class="vc-btn-primary" id="qx-g-save">${edit ? "Lưu" : "Ghi nhận"}</button>`;
	const content = showModal({ title: `${ICON[loai] || ""} ${edit ? "Sửa" : "Ghi nhận"} ${escapeHtml(loai.toLowerCase())} · ${escapeHtml(x.name)}`, body, footer });
	if (!content) return;
	const q = (id) => content.querySelector("#" + id);

	const refresh = () => {
		const ngay = q("qx-g-ngay").value;
		let prev = "";
		if (loai === "Đăng kiểm") {
			const coDinh = !!CHU_KY_THANG[chuKy];
			q("qx-g-han-wrap").hidden = coDinh;
			if (coDinh) prev = ngay ? `→ Hạn đăng kiểm mới: ${formatDate(congThang(ngay, CHU_KY_THANG[chuKy]))} (${chuKy})` : "";
		} else if (loai === "Thay dầu") {
			const moiKm = hoiChuKyDau ? soNguyen(q("qx-g-mkm").value) : td.moi_km;
			const moiThang = hoiChuKyDau ? soNguyen(q("qx-g-mth").value) : td.moi_thang;
			const t = lanToiText(ngay, soNguyen(q("qx-g-km").value), moiKm, moiThang);
			prev = t ? `→ Lần thay tới: ${t}` : "";
		}
		q("qx-g-prev").hidden = !prev;
		q("qx-g-prev").textContent = prev;
		const cp = Number(q("qx-g-cp").value) || 0;
		q("qx-g-cp-hint").textContent = cp ? "= " + formatCurrency(cp) : "";
	};
	if (chonChuKy)
		bindChips(content, "gck", (c) => {
			chuKy = c;
			refresh();
		});
	content.querySelectorAll("input").forEach((i) => i.addEventListener("input", refresh));
	refresh();

	q("qx-g-save").addEventListener("click", () =>
		runSave(q("qx-g-save"), async () => {
			const ngay = q("qx-g-ngay").value;
			if (!ngay) return showToast("Chọn ngày thực hiện", "warning");
			if (ngay > todayStr()) return showToast("Ngày thực hiện không được ở tương lai", "warning");
			const payload = {
				ngay,
				so_km: soNguyen(q("qx-g-km").value),
				chi_phi: Number(q("qx-g-cp").value) || 0,
				noi_thuc_hien: q("qx-g-noi").value.trim(),
				noi_dung: q("qx-g-nd").value.trim(),
				ghi_chu: q("qx-g-gc").value.trim(),
			};
			if (loai === "Đăng kiểm") {
				if (chonChuKy) payload.chu_ky = chuKy;
				const coDinh = !!CHU_KY_THANG[chuKy];
				payload.han_tiep = coDinh ? "" : q("qx-g-han").value;
				if (!coDinh && !payload.han_tiep) return showToast("Nhập hạn đăng kiểm mới", "warning");
			} else if (loai === "Bảo dưỡng") {
				payload.han_tiep = q("qx-g-hngay").value;
				payload.km_tiep = soNguyen(q("qx-g-hkm").value);
			} else if (hoiChuKyDau) {
				payload.moi_km = soNguyen(q("qx-g-mkm").value);
				payload.moi_thang = soNguyen(q("qx-g-mth").value);
			}
			let res;
			if (edit) {
				res = await call(API + "update_log", { name: log.name, payload: JSON.stringify(payload) });
			} else {
				res = await call(API + "add_log", { payload: JSON.stringify({ ...payload, xe: x.name, loai }) });
			}
			const file = q("qx-g-file").files && q("qx-g-file").files[0];
			if (file) {
				try {
					const blob = await resizeImage(file, 1600, 0.82);
					await upload(API + "upload_anh", new File([blob], "anh.jpg", { type: "image/jpeg" }), { name: res.log });
					res = { xe: await call(API + "get_vehicle", { name: x.name }) };
				} catch (e) {
					showToast("Đã lưu bản ghi nhưng chưa tải được ảnh: " + errText(e), "warning");
				}
			}
			closeModal();
			showToast(edit ? "Đã lưu bản ghi" : `Đã ghi nhận ${loai.toLowerCase()}`, "success");
			capNhatXe(res.xe);
		})
	);
}

function xoaLog(r) {
	if (!r) return;
	const lich = r.loai === "Đăng kiểm" || r.loai === "Thay dầu";
	confirmDialog({
		title: "Xoá bản ghi",
		message:
			`Xoá <b>${escapeHtml(r.loai.toLowerCase())}</b> ngày <b>${escapeHtml(formatDate(r.ngay))}</b>?` +
			(lich ? "<br>Nếu đây là lần mới nhất, lịch của xe lùi về lần ghi liền trước." : ""),
		okText: "Xoá",
		danger: true,
		onOk: async () => {
			try {
				const res = await call(API + "delete_log", { name: r.name });
				showToast("Đã xoá bản ghi", "success");
				capNhatXe(res.xe);
			} catch (e) {
				showToast(errText(e), "error");
			}
		},
	});
}
