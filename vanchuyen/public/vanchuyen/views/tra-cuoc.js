// #/tra-cuoc — CHI TRẢ TIỀN CƯỚC (điều hành/kế toán). Lịch → chuyến trong ngày →
// sửa tay cước → QR chuyển khoản → tạo Journal Entry (từng chuyến / cả ngày).
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatCurrency, formatDate } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm.js";

// BIN VietQR các ngân hàng phổ biến (map tên/alias → mã). Tự nhận diện không phân biệt
// dấu/khoảng trắng/hoa thường: "MB Bank" = "mbbank" = "Ngân hàng MB".
const BANKS = [
	["970422", "MB Bank", ["mb", "mbbank", "militarybank", "quandoi"]],
	["970436", "Vietcombank", ["vcb", "ngoaithuong"]],
	["970415", "VietinBank", ["vietinbank", "ctg", "congthuong", "viettin"]],
	["970418", "BIDV", ["bidv", "dautu"]],
	["970405", "Agribank", ["agri", "nongnghiep"]],
	["970407", "Techcombank", ["tcb", "techcom", "ky thuong", "kythuong"]],
	["970416", "ACB", ["a chau", "achau"]],
	["970423", "TPBank", ["tpb", "tienphong"]],
	["970432", "VPBank", ["vpb", "vietnamthinhvuong", "thinhvuong"]],
	["970403", "Sacombank", ["stb", "saigonthuongtin"]],
	["970437", "HDBank", ["hdb", "hd bank"]],
	["970443", "SHB", ["saigonhanoi"]],
	["970448", "OCB", ["phuongdong"]],
	["970449", "LPBank", ["lpb", "lienvietpostbank", "lienviet", "loc phat", "locphat"]],
	["970441", "VIB", ["quocte"]],
	["970440", "SeABank", ["seab", "dongnama"]],
	["970426", "MSB", ["maritime", "hanghai"]],
	["970431", "Eximbank", ["eib", "xuatnhapkhau"]],
	["970400", "SCB", ["saigon"]],
	["970429", "SCBVietnam", []],
	["970419", "NCB", ["quocdan"]],
	["970425", "ABBank", ["anbinh"]],
	["970409", "BacABank", ["bab", "bac a", "baca"]],
	["970428", "NamABank", ["nam a", "nama"]],
	["970430", "PGBank", ["xangdau"]],
	["970438", "BaoVietBank", ["baoviet"]],
	["970452", "KienLongBank", ["klb", "kienlong"]],
	["970454", "BVBank", ["banviet", "vietcapital"]],
	["970457", "Woori", ["wooribank"]],
	["970458", "UnitedOverseas", ["uob"]],
	["970442", "HongLeong", ["hongleong"]],
	["970421", "VRB", ["vietnga"]],
	["970412", "PVcomBank", ["pvcom", "pvb"]],
	["970414", "Oceanbank", ["ocean", "daiduong"]],
	["546034", "CAKE", ["cakebyvpbank"]],
	["963388", "TIMO", ["timobyvpbank"]],
	["970424", "ShinhanBank", ["shinhan"]],
	["970462", "KookminHN", ["kookmin"]],
	["970434", "IndovinaBank", ["indovina", "ivb"]],
];
function norm(s) {
	return String(s || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "d")
		.replace(/[^a-z0-9]/g, "");
}
const BANK_BIN = (() => {
	const m = {};
	BANKS.forEach(([bin, name, aliases]) => {
		m[norm(name)] = bin;
		(aliases || []).forEach((a) => {
			m[norm(a)] = bin;
		});
	});
	return m;
})();
function bankBin(name) {
	const n = norm(name);
	if (!n) return "";
	if (BANK_BIN[n]) return BANK_BIN[n];
	// bỏ hậu tố "bank"/"nganhang", tiền tố "nganhang"
	const n2 = n.replace(/^nganhang/, "").replace(/(bank|nganhang)$/, "");
	if (n2 && BANK_BIN[n2]) return BANK_BIN[n2];
	// khớp bao hàm (tên chứa alias hoặc ngược lại)
	for (const k in BANK_BIN) {
		if (k.length >= 3 && (n.includes(k) || (n2 && n2.includes(k)))) return BANK_BIN[k];
	}
	return "";
}
function vietQrUrl(bank, amount, content) {
	const bin = bankBin(bank.nganhang);
	if (!bin || !bank.stk) return "";
	return (
		`https://img.vietqr.io/image/${bin}-${bank.stk}-compact2.png` +
		`?amount=${Math.round(amount)}&addInfo=${encodeURIComponent(content || "Tra cuoc")}` +
		`&accountName=${encodeURIComponent((bank.tentk || "").toUpperCase())}`
	);
}

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const pad = (n) => String(n).padStart(2, "0");

let ROOT = null;
const S = { nam: 0, thang: 0, selected: null, cal: {}, trips: [], dayFilter: "all" };

const CSS = `
.tc-cal { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
.tc-wd { text-align:center; font-size:.62rem; font-weight:700; color:var(--vc-muted,#6b7280); padding:2px 0; }
.tc-day { min-height:36px; border:1px solid var(--vc-border,#e5e7eb); border-radius:7px; background:#fff;
  display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; padding:1px; position:relative; transition:all .12s; }
.tc-day:hover { border-color:#6366f1; }
.tc-day.tc-other { opacity:.3; cursor:default; }
.tc-day.tc-today { border-color:#6366f1; }
.tc-day.tc-sel { border-color:#ec4899; background:#fdf2f8; }
.tc-day.tc-has { background:#eef2ff; }
.tc-day-n { font-size:.78rem; font-weight:700; line-height:1; }
.tc-day-amt { font-size:.52rem; font-weight:700; color:#4f46e5; line-height:1; margin-top:1px; }
.tc-day-dot { position:absolute; top:3px; right:3px; width:6px; height:6px; border-radius:50%; background:#ef4444; }
.tc-cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.tc-nav { width:30px; height:30px; border-radius:8px; border:1px solid var(--vc-border,#e5e7eb); background:#fff; cursor:pointer; font-size:.85rem; }
.tc-qr { text-align:center; margin:.5rem 0; }
.tc-qr img { width:148px; height:148px; background:#fff; border:1px solid var(--vc-border,#e5e7eb); border-radius:10px; padding:5px; }
.tc-qr a { display:block; font-size:.72rem; margin-top:.2rem; color:#6366f1; text-decoration:none; }
.tc-orders { margin:.4rem 0; padding:.5rem .6rem; background:var(--vc-gray-50,#f9fafb); border-radius:8px; font-size:.8rem; }
.tc-order { display:flex; justify-content:space-between; gap:8px; padding:2px 0; }
.tc-order-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-cuoc-row { display:flex; align-items:center; gap:.5rem; margin:.5rem 0; flex-wrap:wrap; }
.tc-cuoc-input { width:130px; padding:.5rem; border:1.5px solid var(--vc-border,#d1d5db); border-radius:8px; font-size:.95rem; font-weight:700; font-family:inherit; }
.tc-paid { background:#ecfdf5; border-color:#6ee7b7; }
.tc-pills { display:flex; gap:.4rem; margin-bottom:.6rem; flex-wrap:wrap; }
.tc-pill { padding:.4rem .8rem; border-radius:999px; border:1.5px solid var(--vc-border,#e5e7eb); background:#fff; font-size:.8rem; font-weight:600; cursor:pointer; font-family:inherit; color:var(--vc-text,#1f2937); }
.tc-pill.on { background:#6366f1; color:#fff; border-color:#6366f1; }
`;

function injectCss() {
	if (document.getElementById("tc-styles")) return;
	const s = document.createElement("style");
	s.id = "tc-styles";
	s.textContent = CSS;
	document.head.appendChild(s);
}

export async function render({ container }) {
	injectCss();
	ROOT = container;
	const now = new Date();
	S.nam = now.getFullYear();
	S.thang = now.getMonth() + 1;
	S.selected = null;
	container.innerHTML = `
		<div id="tc-quydau"></div>
		<div class="vc-section-title">📅 Trả cước theo chuyến</div>
		<div class="vc-card vc-mb-3" style="max-width:440px">
			<div class="tc-cal-head">
				<button class="tc-nav" id="tc-prev"><i class="fas fa-chevron-left"></i></button>
				<div style="font-weight:800" id="tc-month"></div>
				<button class="tc-nav" id="tc-next"><i class="fas fa-chevron-right"></i></button>
			</div>
			<div id="tc-cal">${skeleton(30, 2)}</div>
		</div>
		<div id="tc-day"></div>`;
	S.selected = new Date().toISOString().split("T")[0]; // hiện sẵn chuyến hôm nay
	// Phần đầu = port NGUYÊN trang mẫu Quản Trị Quỹ Dầu (chi tiền thủ công).
	// Dynamic import kèm assetVersion để không bị cache bản cũ khi deploy.
	try {
		const av = (window.VC_CONTEXT && window.VC_CONTEXT.assetVersion) || Date.now();
		const qd = await import(`./quy-dau.js?v=${av}`);
		qd.mountQuyDau(document.getElementById("tc-quydau"));
	} catch (e) {
		console.error("quy-dau", e);
	}
	document.getElementById("tc-prev").addEventListener("click", () => shiftMonth(-1));
	document.getElementById("tc-next").addEventListener("click", () => shiftMonth(1));
	await loadCalendar();
	await loadDay(); // hiện sẵn chuyến ngày hôm nay
}

function shiftMonth(delta) {
	S.thang += delta;
	if (S.thang < 1) {
		S.thang = 12;
		S.nam--;
	} else if (S.thang > 12) {
		S.thang = 1;
		S.nam++;
	}
	loadCalendar();
}

async function loadCalendar() {
	document.getElementById("tc-month").textContent = `Tháng ${S.thang}/${S.nam}`;
	try {
		S.cal = await call("vanchuyen.api.chi_cuoc.get_pay_calendar", { nam: S.nam, thang: S.thang });
	} catch (e) {
		document.getElementById("tc-cal").innerHTML = `<p class="vc-text-danger vc-text-sm">${escapeHtml(errText(e))}</p>`;
		return;
	}
	drawCalendar();
}

function drawCalendar() {
	const first = new Date(S.nam, S.thang - 1, 1);
	const startWd = (first.getDay() + 6) % 7; // T2=0
	const daysInMonth = new Date(S.nam, S.thang, 0).getDate();
	const todayStr = new Date().toISOString().split("T")[0];

	let html = WEEKDAYS.map((w) => `<div class="tc-wd">${w}</div>`).join("");
	for (let i = 0; i < startWd; i++) html += `<div class="tc-day tc-other"></div>`;
	for (let d = 1; d <= daysInMonth; d++) {
		const ds = `${S.nam}-${pad(S.thang)}-${pad(d)}`;
		const info = S.cal[ds];
		let cls = "tc-day";
		if (ds === todayStr) cls += " tc-today";
		if (ds === S.selected) cls += " tc-sel";
		if (info && info.tong > 0) cls += " tc-has";
		const amt = info && info.tong > 0 ? `<div class="tc-day-amt">${kFmt(info.tong)}</div>` : "";
		const dot = info && info.chua_tra > 0 ? `<div class="tc-day-dot" title="${info.chua_tra} chưa trả"></div>` : "";
		html += `<div class="${cls}" data-date="${ds}"><div class="tc-day-n">${d}</div>${amt}${dot}</div>`;
	}
	const cal = document.getElementById("tc-cal");
	cal.className = "tc-cal";
	cal.innerHTML = html;
	cal.querySelectorAll(".tc-day[data-date]").forEach((el) =>
		el.addEventListener("click", () => {
			S.selected = el.dataset.date;
			drawCalendar();
			loadDay();
		})
	);
}

function kFmt(n) {
	n = Math.abs(n);
	if (n >= 1e6) return Math.round(n / 1e6) + "tr";
	if (n >= 1e3) return Math.round(n / 1e3) + "k";
	return String(n);
}

async function loadDay() {
	const box = document.getElementById("tc-day");
	if (!S.selected) {
		box.innerHTML = "";
		return;
	}
	box.innerHTML = `<div class="vc-card">${skeleton(80, 2)}</div>`;
	let trips;
	try {
		trips = await call("vanchuyen.api.chi_cuoc.get_trips_for_pay", { ngay: S.selected });
	} catch (e) {
		box.innerHTML = `<div class="vc-card"><p class="vc-text-danger vc-text-sm">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	drawDay(trips);
}

function drawDay(trips) {
	S.trips = trips;
	const box = document.getElementById("tc-day");
	if (!trips.length) {
		box.innerHTML = `<div class="vc-card"><div class="vc-empty"><div class="vc-empty-icon">📭</div>
			<div class="vc-empty-title">Không có chuyến nào ngày ${escapeHtml(formatDate(S.selected))}</div></div></div>`;
		return;
	}
	S.dayFilter = "all";
	const unpaid = trips.filter((t) => !t.da_tra_cuoc && t.tong_cuoc > 0);
	const paidCount = trips.filter((t) => t.da_tra_cuoc).length;
	const tongNgay = trips.reduce((a, t) => a + Number(t.tong_cuoc || 0), 0);
	box.innerHTML = `
		<div class="vc-card vc-mb-3">
			<div class="vc-flex" style="justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap">
				<div class="vc-section-title" style="margin:0">🚚 ${trips.length} chuyến · ${escapeHtml(formatDate(S.selected))}</div>
				<div style="font-weight:800">Tổng: ${formatCurrency(tongNgay)}</div>
			</div>
			${unpaid.length ? `<button class="vc-btn-primary vc-btn-block vc-mt-2" id="tc-pay-day"><i class="fas fa-file-invoice-dollar"></i> Tạo bút toán cả ngày (${unpaid.length} chuyến chưa trả)</button>` : ""}
		</div>
		<div class="tc-pills" id="tc-pills">
			<button class="tc-pill on" data-f="all">Tất cả (${trips.length})</button>
			<button class="tc-pill" data-f="unpaid">Chưa trả (${trips.length - paidCount})</button>
			<button class="tc-pill" data-f="paid">Đã trả (${paidCount})</button>
		</div>
		<div class="vc-list" id="tc-trip-list"></div>`;

	if (unpaid.length) {
		document.getElementById("tc-pay-day").addEventListener("click", () =>
			confirmDialog({
				title: "Tạo bút toán cả ngày",
				message: `Tạo 1 bút toán trả cước cho <b>${unpaid.length}</b> chuyến chưa trả (Nợ 6412 / Có 141). Tiếp tục?`,
				okText: "Tạo bút toán",
				onOk: async () => {
					try {
						const r = await call("vanchuyen.api.chi_cuoc.pay_day", { ngay: S.selected });
						showToast(`Đã tạo bút toán ${r.journal_entry} (${r.count} chuyến)`, "success");
						await loadCalendar();
						await loadDay();
					} catch (e) {
						showToast(errText(e), "error");
					}
				},
			})
		);
	}
	document.getElementById("tc-pills").querySelectorAll(".tc-pill").forEach((b) =>
		b.addEventListener("click", () => {
			S.dayFilter = b.dataset.f;
			document.querySelectorAll("#tc-pills .tc-pill").forEach((p) => p.classList.toggle("on", p.dataset.f === S.dayFilter));
			renderTripList();
		})
	);
	renderTripList();
}

function renderTripList() {
	const list = document.getElementById("tc-trip-list");
	if (!list) return;
	let items = S.trips;
	if (S.dayFilter === "unpaid") items = S.trips.filter((t) => !t.da_tra_cuoc);
	else if (S.dayFilter === "paid") items = S.trips.filter((t) => t.da_tra_cuoc);
	list.innerHTML = items.length
		? items.map(tripCard).join("")
		: '<div class="vc-text-muted vc-text-sm vc-text-center vc-mt-2">Không có chuyến phù hợp.</div>';
	bindTrips();
}

function tripCard(t) {
	const paid = !!t.da_tra_cuoc;
	const orders = t.stops
		.map(
			(s) =>
				`<div class="tc-order"><span class="tc-order-name">${escapeHtml(s.khach_hang || "")}</span><span>${Number(s.so_kien) || 0} kiện</span></div>`
		)
		.join("");
	const badge = paid
		? '<span class="vc-badge vc-badge-success">✅ Đã trả</span>'
		: '<span class="vc-badge vc-badge-warning">Chưa trả</span>';
	const bankLine = t.bank && t.bank.stk
		? `${escapeHtml(t.bank.nganhang || "")} · ${escapeHtml(t.bank.stk)} · ${escapeHtml(t.bank.tentk || "")}`
		: '<span class="vc-text-danger">⚠ Lái xe chưa có TK ngân hàng</span>';

	let action = "";
	if (paid) {
		action = `<a class="vc-btn-ghost" href="/app/journal-entry/${encodeURIComponent(t.cuoc_je || "")}" target="_blank"><i class="fas fa-external-link-alt"></i> Xem bút toán</a>`;
	} else {
		// QR hiện SẴN theo tổng cước hiện tại (không cần bấm).
		// Nội dung chuyển khoản: ngày · mã chuyến · tỉnh các đơn trong chuyến.
		const noiDung = `${formatDate(t.ngay_giao)} ${t.name}${t.tinh ? " " + t.tinh : ""}`.trim();
		const qrUrl = t.bank && t.bank.stk ? vietQrUrl(t.bank, Number(t.tong_cuoc) || 0, noiDung) : "";
		const qrBlock = qrUrl
			? `<div class="tc-qr"><img src="${escapeHtml(qrUrl)}" alt="QR trả cước" loading="lazy" /><a href="${escapeHtml(qrUrl)}" target="_blank">Phóng to QR ⤢</a></div>`
			: "";
		action =
			`<div class="tc-cuoc-row">
				<input class="tc-cuoc-input" type="number" min="0" step="1000" value="${Math.round(Number(t.tong_cuoc) || 0)}" data-cuoc="${escapeHtml(t.name)}" />
				<button class="vc-btn-ghost" data-savecuoc="${escapeHtml(t.name)}">Lưu &amp; cập nhật QR</button>
				${t.cuoc_thu_cong ? '<span class="vc-badge vc-badge-muted">sửa tay</span>' : ""}
			</div>
			${qrBlock}
			<button class="vc-btn-success vc-btn-block" data-pay="${escapeHtml(t.name)}"><i class="fas fa-check"></i> Tạo bút toán</button>`;
	}

	return `
	<div class="vc-order-card ${paid ? "tc-paid" : ""}" data-trip="${escapeHtml(t.name)}">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${escapeHtml(t.ten_lai_xe || t.lai_xe || "")} · 🚛 ${escapeHtml(t.xe || "")}</div>
				<div class="vc-order-addr">${escapeHtml(t.name)} · ${escapeHtml(t.sdt_lai_xe || "")}</div>
			</div>
			${badge}
		</div>
		<div class="tc-orders">${orders || '<span class="vc-text-muted">— không có đơn —</span>'}</div>
		<div class="vc-text-sm vc-text-muted vc-mb-2">💳 ${bankLine}</div>
		<div style="font-weight:800;font-size:1.05rem;margin-bottom:.3rem">Cước: ${formatCurrency(t.tong_cuoc)}</div>
		${action}
	</div>`;
}

function bindTrips() {
	const box = document.getElementById("tc-day");
	box.querySelectorAll("[data-savecuoc]").forEach((b) =>
		b.addEventListener("click", async () => {
			const name = b.dataset.savecuoc;
			const inp = box.querySelector(`[data-cuoc="${cssEsc(name)}"]`);
			const amount = Number(inp.value) || 0;
			b.disabled = true;
			try {
				await call("vanchuyen.api.chi_cuoc.set_trip_cuoc", { name, amount });
				showToast("Đã lưu tiền cước", "success");
				await loadCalendar();
				await loadDay();
			} catch (e) {
				b.disabled = false;
				showToast(errText(e), "error");
			}
		})
	);
	box.querySelectorAll("[data-pay]").forEach((b) =>
		b.addEventListener("click", () => {
			const name = b.dataset.pay;
			confirmDialog({
				title: "Tạo bút toán trả cước",
				message: `Tạo bút toán trả cước cho chuyến <b>${escapeHtml(name)}</b> (Nợ 6412 / Có 141). Tiếp tục?`,
				okText: "Tạo bút toán",
				onOk: async () => {
					try {
						const r = await call("vanchuyen.api.chi_cuoc.pay_trip", { name });
						showToast(`Đã tạo bút toán ${r.journal_entry}`, "success");
						await loadCalendar();
						await loadDay();
					} catch (e) {
						showToast(errText(e), "error");
					}
				},
			});
		})
	);
}

function cssEsc(s) {
	return String(s).replace(/["\\]/g, "\\$&");
}
