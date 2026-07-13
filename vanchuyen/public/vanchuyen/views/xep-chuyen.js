// #/xep-chuyen — Điều Phối: pool đơn + trip builder (thanh tải live) + danh sách chuyến.
// Client chỉ kiểm cho mượt tay — validate server là sự thật (hiện message throw nguyên văn).
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatQty, formatM3, formatDate } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { showModal, closeModal } from "../components/modal.js";
import { confirmDialog } from "../components/confirm.js";

const S = {
	drivers: [],
	vehicles: [],
	pool: [],
	poolTotal: 0,
	poolPage: 1,
	trips: [],
	builder: { name: null, ngay_giao: "", lai_xe: "", xe: "", rows: [] },
	filter: { tim: "", tinh: "", tu: "", den: "" },
	saving: false,
};
let ROOT = null;

function todayStr() {
	return new Date().toISOString().slice(0, 10);
}
function vehicleVol() {
	const v = S.vehicles.find((x) => x.name === S.builder.xe);
	return v ? Number(v.custom_the_tich_kha_dung) || 0 : 0;
}
function builderVol() {
	return S.builder.rows.reduce((a, r) => a + (Number(r.the_tich) || 0), 0);
}
function poolPicked(si) {
	return S.builder.rows.some((r) => r.sales_invoice === si);
}

export async function render({ container }) {
	ROOT = container;
	container.innerHTML = skeleton(120, 4);
	S.builder = { name: null, ngay_giao: todayStr(), lai_xe: "", xe: "", rows: [] };
	try {
		const [drivers, vehicles, pool, trips] = await Promise.all([
			call("vanchuyen.api.dieu_phoi.get_drivers"),
			call("vanchuyen.api.dieu_phoi.get_vehicles"),
			call("vanchuyen.api.dieu_phoi.get_pool", { page: 1, page_size: 30 }),
			call("vanchuyen.api.dieu_phoi.get_trips"),
		]);
		S.drivers = drivers || [];
		S.vehicles = vehicles || [];
		S.pool = pool.rows || [];
		S.poolTotal = pool.total || 0;
		S.poolPage = 1;
		S.trips = trips || [];
	} catch (e) {
		container.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
			<div class="vc-empty-title">Không tải được dữ liệu</div>
			<p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	drawShell();
}

function drawShell() {
	// Mobile-first: setup (chọn XE trước → lái xe → ngày) lên ĐẦU, pool đơn ở dưới.
	// Desktop ≥768px: 2 cột (setup trái sticky, pool phải).
	ROOT.innerHTML = `
		<div class="vc-xep-grid">
			<div class="vc-xep-setup">
				<div class="vc-section-title">Chuyến đang dựng</div>
				<div id="vc-builder"></div>
			</div>
			<div class="vc-xep-pool">
				<div class="vc-section-title">Pool đơn cần xếp</div>
				<div class="vc-search-wrap">
					<i class="fas fa-search"></i>
					<input class="vc-search" id="vc-pool-search" placeholder="Tìm khách / PO / số đơn" value="${escapeHtml(S.filter.tim)}" />
				</div>
				<div class="vc-filters">
					<input class="vc-input" type="date" id="vc-f-tu" value="${escapeHtml(S.filter.tu)}" aria-label="Từ ngày" />
					<input class="vc-input" type="date" id="vc-f-den" value="${escapeHtml(S.filter.den)}" aria-label="Đến ngày" />
					<input class="vc-input" id="vc-f-tinh" placeholder="Tỉnh" value="${escapeHtml(S.filter.tinh)}" />
					<button class="vc-btn-ghost" id="vc-f-apply"><i class="fas fa-filter"></i> Lọc</button>
				</div>
				<div id="vc-pool-list"></div>
			</div>
		</div>
		<div class="vc-section-title">Chuyến Nháp / Đang giao</div>
		<div id="vc-trips"></div>
		<div class="vc-xep-cta" id="vc-xep-cta"></div>`;

	const search = document.getElementById("vc-pool-search");
	search.addEventListener("keydown", (e) => {
		if (e.key === "Enter") applyFilter();
	});
	document.getElementById("vc-f-apply").addEventListener("click", applyFilter);

	drawPool();
	drawBuilder();
	drawTrips();
}

function applyFilter() {
	S.filter.tim = document.getElementById("vc-pool-search").value.trim();
	S.filter.tu = document.getElementById("vc-f-tu").value;
	S.filter.den = document.getElementById("vc-f-den").value;
	S.filter.tinh = document.getElementById("vc-f-tinh").value.trim();
	reloadPool(1);
}

async function reloadPool(page) {
	const list = document.getElementById("vc-pool-list");
	if (page === 1) list.innerHTML = skeleton(80, 3);
	try {
		const res = await call("vanchuyen.api.dieu_phoi.get_pool", {
			tim: S.filter.tim || undefined,
			tinh: S.filter.tinh || undefined,
			tu_ngay: S.filter.tu || undefined,
			den_ngay: S.filter.den || undefined,
			page,
			page_size: 30,
		});
		S.poolTotal = res.total || 0;
		S.poolPage = page;
		S.pool = page === 1 ? res.rows || [] : S.pool.concat(res.rows || []);
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	drawPool();
}

function drawPool() {
	const list = document.getElementById("vc-pool-list");
	if (!list) return;
	if (!S.pool.length) {
		list.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">📭</div>
			<div class="vc-empty-title">Không còn đơn nào cần xếp</div></div>`;
		return;
	}
	const cards = S.pool.map(poolCard).join("");
	const more =
		S.pool.length < S.poolTotal
			? `<div class="vc-text-center vc-mt-3"><button class="vc-btn-ghost" id="vc-pool-more">Tải thêm (${S.pool.length}/${S.poolTotal})</button></div>`
			: `<div class="vc-text-center vc-mt-3 vc-text-muted vc-text-sm">Đã hiển thị ${S.pool.length} đơn</div>`;
	list.innerHTML = `<div class="vc-list">${cards}</div>${more}`;

	// Nút thêm/một-phần là control RIÊNG (không tap cả card) → tránh fat-finger thêm nhầm cả đơn.
	list.querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", () => addFull(btn.dataset.add)));
	list.querySelectorAll("[data-partial]").forEach((btn) => btn.addEventListener("click", () => openPartialDialog(btn.dataset.partial)));
	const moreBtn = document.getElementById("vc-pool-more");
	if (moreBtn) moreBtn.addEventListener("click", () => reloadPool(S.poolPage + 1));
}

function poolCard(o) {
	const picked = poolPicked(o.name);
	const canAdd = (Number(o.con_lai) || 0) > 0 && !picked;
	const actions = picked
		? `<span class="vc-order-added"><i class="fas fa-check"></i> Đã thêm vào chuyến</span>`
		: `<button type="button" class="vc-order-add-btn" data-add="${escapeHtml(o.name)}" ${canAdd ? "" : "disabled"}><i class="fas fa-plus"></i> Thêm hết (${formatQty(o.con_lai)} kiện)</button>` +
		  `<button type="button" class="vc-order-partial-btn" data-partial="${escapeHtml(o.name)}">Một phần</button>`;
	return `
	<div class="vc-order-card ${picked ? "vc-picked" : ""}">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${escapeHtml(o.khach_hang || "")}</div>
				<div class="vc-order-addr">${escapeHtml(o.dia_chi || "")}</div>
			</div>
			<div class="vc-flex vc-flex-col" style="align-items:flex-end;gap:.25rem;flex-shrink:0">
				${o.posting_date ? `<span class="vc-badge vc-badge-muted"><i class="fas fa-calendar-day"></i> ${escapeHtml(formatDate(o.posting_date))}</span>` : ""}
				${o.po ? `<span class="vc-badge vc-badge-primary">PO ${escapeHtml(o.po)}</span>` : ""}
			</div>
		</div>
		<div class="vc-order-meta">
			<span class="vc-chip vc-chip-accent">còn ${formatQty(o.con_lai)}/${formatQty(o.tong_kien)} kiện</span>
			<span class="vc-chip">${formatM3(o.the_tich_con_lai)} m³</span>
			${o.hop_le ? `<span class="vc-chip">${formatQty(o.hop_le)} hộp lẻ</span>` : ""}
		</div>
		${o.ghi_chu_npp ? `<div class="vc-order-note">📝 ${escapeHtml(o.ghi_chu_npp)}</div>` : ""}
		<div class="vc-order-actions">${actions}</div>
	</div>`;
}

function findPool(si) {
	return S.pool.find((o) => o.name === si);
}

function addFull(si) {
	const o = findPool(si);
	if (!o) return;
	if (poolPicked(si)) {
		showToast("Đơn đã có trong chuyến", "warning");
		return;
	}
	if ((Number(o.con_lai) || 0) <= 0) {
		showToast("Đơn đã xếp đủ", "warning");
		return;
	}
	S.builder.rows.push(mkRow(o, o.con_lai, o.the_tich_con_lai));
	showToast("Đã thêm " + (o.khach_hang || si), "success");
	drawBuilder();
	drawPool();
}

function mkRow(o, so_kien, the_tich) {
	return {
		sales_invoice: o.name,
		khach_hang: o.khach_hang,
		tong_kien: Number(o.tong_kien) || 0,
		the_tich_lo: Number(o.the_tich_lo) || 0,
		con_lai: Number(o.con_lai) || 0,
		so_kien: Number(so_kien) || 0,
		the_tich: Number(the_tich) || 0,
	};
}

function proRata(row) {
	// Thể tích pro-rata theo tỉ lệ kiện của cả đơn.
	if (row.tong_kien > 0) return (row.the_tich_lo * (Number(row.so_kien) || 0)) / row.tong_kien;
	return 0;
}

function openPartialDialog(si) {
	const o = findPool(si);
	if (!o || poolPicked(si)) {
		showToast("Đơn đã có trong chuyến hoặc không hợp lệ", "warning");
		return;
	}
	const body = `
		<div class="vc-field">
			<label>Số kiện lên chuyến (còn ${formatQty(o.con_lai)})</label>
			<input class="vc-input" id="vc-partial-kien" type="number" min="0.01" step="0.01" max="${o.con_lai}" value="${o.con_lai}" />
		</div>
		<div class="vc-text-sm vc-text-muted">Thể tích tự tính pro-rata theo số kiện.</div>`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button>
		<button class="vc-btn-primary" id="vc-partial-ok">Thêm vào chuyến</button>`;
	const content = showModal({ title: `Xếp một phần · ${escapeHtml(o.khach_hang || si)}`, body, footer });
	content.querySelector("#vc-partial-ok").addEventListener("click", () => {
		const kien = Number(document.getElementById("vc-partial-kien").value) || 0;
		if (kien <= 0) {
			showToast("Số kiện phải > 0", "error");
			return;
		}
		if (kien > (Number(o.con_lai) || 0) + 0.001) {
			showToast("Vượt số kiện còn lại của đơn", "error");
			return;
		}
		const row = mkRow(o, kien, 0);
		row.the_tich = proRata(row);
		S.builder.rows.push(row);
		showToast("Đã thêm một phần: " + (o.khach_hang || si), "success");
		closeModal();
		drawBuilder();
		drawPool();
	});
}

function loadBar() {
	const cap = vehicleVol();
	const used = builderVol();
	const pct = cap > 0 ? (used / cap) * 100 : 0;
	let cls = "";
	if (cap > 0 && pct > 100) cls = "over";
	else if (cap > 0 && pct >= 90) cls = "warn";
	const width = Math.min(pct, 100);
	const capTxt = cap > 0 ? `${formatM3(used)} / ${formatM3(cap)} m³ (${Math.round(pct)}%)` : `${formatM3(used)} m³ · chọn xe để thấy tải`;
	return `<div class="vc-load">
		<div class="vc-load-bar"><div class="vc-load-fill ${cls}" style="width:${width}%"></div></div>
		<div class="vc-load-text">${capTxt}</div>
	</div>`;
}

function drawBuilder() {
	const wrap = document.getElementById("vc-builder");
	if (!wrap) return;
	const b = S.builder;

	// Xe & lái xe = NÚT bấm (chip), tối ưu chạm 1 tay trên điện thoại (không droplist).
	const xeChips = S.vehicles.length
		? S.vehicles
				.map(
					(v) =>
						`<button type="button" class="vc-chip-btn ${v.name === b.xe ? "active" : ""}" data-xe="${escapeHtml(v.name)}" aria-pressed="${v.name === b.xe ? "true" : "false"}">` +
						`<span>${escapeHtml(v.name)}</span>` +
						`${v.custom_the_tich_kha_dung ? `<small>${formatM3(v.custom_the_tich_kha_dung)} m³</small>` : ""}</button>`
				)
				.join("")
		: '<span class="vc-text-muted vc-text-sm">Chưa có xe khả dụng</span>';
	const laixeChips = S.drivers.length
		? S.drivers
				.map(
					(d) =>
						`<button type="button" class="vc-chip-btn ${d.name === b.lai_xe ? "active" : ""}" data-laixe="${escapeHtml(d.name)}" aria-pressed="${d.name === b.lai_xe ? "true" : "false"}">` +
						`<span>${escapeHtml(d.full_name || d.name)}</span></button>`
				)
				.join("")
		: '<span class="vc-text-muted vc-text-sm">Chưa có lái xe</span>';

	wrap.innerHTML = `
	<div class="vc-card">
		${b.name ? `<div class="vc-badge vc-badge-muted vc-mb-2">Đang sửa nháp: ${escapeHtml(b.name)}</div>` : ""}
		<div class="vc-field"><label>Bước 1 · Chọn xe</label><div class="vc-chip-group" id="vc-b-xe-group" role="group" aria-label="Chọn xe">${xeChips}</div></div>
		<div class="vc-field"><label>Bước 2 · Chọn lái xe</label><div class="vc-chip-group" id="vc-b-laixe-group" role="group" aria-label="Chọn lái xe">${laixeChips}</div></div>
		<div class="vc-field"><label>Bước 3 · Ngày giao</label><input class="vc-input" type="date" id="vc-b-ngay" value="${escapeHtml(b.ngay_giao)}" /></div>
		${loadBar()}
		<div class="vc-builder-rows-title">Đơn đã chọn (${b.rows.length})</div>
		<div id="vc-b-rows">${b.rows.length ? b.rows.map(builderRow).join("") : '<div class="vc-text-muted vc-text-sm vc-text-center vc-mt-2 vc-mb-2">Chọn xe trước, rồi chọn đơn từ pool bên dưới ⬇</div>'}</div>
		<div class="vc-flex vc-gap-2 vc-mt-3">
			<button class="vc-btn-ghost" id="vc-b-clear" style="flex:1">Làm lại</button>
			<button class="vc-btn-primary" id="vc-b-save" style="flex:1"><i class="fas fa-save"></i> Lưu nháp</button>
		</div>
		<button class="vc-btn-success vc-btn-block vc-mt-2" id="vc-b-submit"><i class="fas fa-paper-plane"></i> Lưu & Xuất chuyến</button>
	</div>`;

	wrap.querySelectorAll("[data-xe]").forEach((btn) =>
		btn.addEventListener("click", () => {
			b.xe = btn.dataset.xe;
			drawBuilder();
		})
	);
	wrap.querySelectorAll("[data-laixe]").forEach((btn) =>
		btn.addEventListener("click", () => {
			b.lai_xe = btn.dataset.laixe;
			drawBuilder();
		})
	);
	document.getElementById("vc-b-ngay").addEventListener("change", (e) => (b.ngay_giao = e.target.value));
	wrap.querySelectorAll("[data-remove]").forEach((btn) =>
		btn.addEventListener("click", () => {
			b.rows = b.rows.filter((r) => r.sales_invoice !== btn.dataset.remove);
			drawBuilder();
			drawPool();
		})
	);
	wrap.querySelectorAll("[data-kien]").forEach((inp) =>
		inp.addEventListener("change", () => {
			const row = b.rows.find((r) => r.sales_invoice === inp.dataset.kien);
			if (!row) return;
			let v = Number(inp.value) || 0;
			if (v > row.con_lai + 0.001) {
				showToast("Vượt số kiện còn lại — hệ thống sẽ chặn khi lưu", "warning");
			}
			row.so_kien = v;
			row.the_tich = proRata(row);
			drawBuilder();
		})
	);
	document.getElementById("vc-b-clear").addEventListener("click", () => {
		S.builder = { name: null, ngay_giao: todayStr(), lai_xe: "", xe: "", rows: [] };
		drawBuilder();
		drawPool();
	});
	document.getElementById("vc-b-save").addEventListener("click", () => saveTrip(false));
	document.getElementById("vc-b-submit").addEventListener("click", () => saveTrip(true));

	updateCta();
}

// Thanh dính đáy trên mobile: tổng tải + nút Xuất — để tài xế thấy % tải & chốt
// chuyến ngay khi đang cuộn trong pool (setup đã ở trên, khuất tầm nhìn).
function updateCta() {
	const cta = document.getElementById("vc-xep-cta");
	if (!cta) return;
	const b = S.builder;
	if (!b.rows.length) {
		cta.className = "vc-xep-cta";
		cta.innerHTML = "";
		return;
	}
	const cap = vehicleVol();
	const used = builderVol();
	const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
	let tone = "";
	if (cap > 0 && pct > 100) tone = "over";
	else if (cap > 0 && pct >= 90) tone = "warn";
	cta.className = "vc-xep-cta show";
	cta.innerHTML =
		`<div class="vc-xep-cta-info ${tone}">${b.rows.length} đơn · ` +
		`${cap > 0 ? `${formatM3(used)} / ${formatM3(cap)} m³ (${pct}%)` : `${formatM3(used)} m³`}</div>` +
		`<button type="button" class="vc-xep-cta-btn vc-xep-cta-save" id="vc-cta-save"><i class="fas fa-save"></i> Lưu</button>` +
		`<button type="button" class="vc-xep-cta-btn" id="vc-cta-submit"><i class="fas fa-paper-plane"></i> Xuất</button>`;
	document.getElementById("vc-cta-save").addEventListener("click", () => saveTrip(false));
	document.getElementById("vc-cta-submit").addEventListener("click", () => saveTrip(true));
}

function builderRow(r) {
	return `
	<div class="vc-flex vc-items-center vc-gap-2 vc-mb-2" style="padding:.4rem;border:1px solid var(--vc-border);border-radius:10px">
		<div style="flex:1;min-width:0">
			<div class="vc-font-bold vc-text-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.khach_hang || r.sales_invoice)}</div>
			<div class="vc-text-muted vc-text-sm">${escapeHtml(r.sales_invoice)} · ${formatM3(r.the_tich)} m³</div>
		</div>
		<input class="vc-input" style="width:80px" type="number" min="0.01" step="0.01" value="${r.so_kien}" data-kien="${escapeHtml(r.sales_invoice)}" aria-label="Số kiện" />
		<button class="vc-icon-btn" data-remove="${escapeHtml(r.sales_invoice)}" aria-label="Bỏ"><i class="fas fa-times"></i></button>
	</div>`;
}

function builderPayload() {
	const b = S.builder;
	return {
		name: b.name || undefined,
		ngay_giao: b.ngay_giao,
		lai_xe: b.lai_xe,
		xe: b.xe,
		don_hang: b.rows.map((r) => ({ sales_invoice: r.sales_invoice, so_kien: r.so_kien, the_tich: r.the_tich })),
	};
}

async function saveTrip(thenSubmit) {
	const b = S.builder;
	if (S.saving) return; // chặn double-tap (CTA + nút card) tạo chuyến trùng
	if (!b.lai_xe || !b.xe) {
		showToast("Chọn lái xe và xe trước", "error");
		return;
	}
	if (!b.rows.length) {
		showToast("Chưa có đơn nào trong chuyến", "error");
		return;
	}
	S.saving = true;
	document.querySelectorAll("#vc-b-submit, #vc-b-save, #vc-cta-submit, #vc-cta-save").forEach((el) => (el.disabled = true));
	try {
		const doc = await call("vanchuyen.api.dieu_phoi.save_trip", { payload: JSON.stringify(builderPayload()) });
		b.name = doc.name;
		if (thenSubmit) {
			await call("vanchuyen.api.dieu_phoi.submit_trip", { name: doc.name });
			showToast("Đã xuất chuyến " + doc.name, "success");
			S.builder = { name: null, ngay_giao: todayStr(), lai_xe: "", xe: "", rows: [] };
		} else {
			showToast("Đã lưu nháp " + doc.name, "success");
		}
		await refreshAll();
	} catch (e) {
		// Hiện nguyên văn message throw của server (validate là sự thật).
		showToast(errText(e), "error");
	} finally {
		S.saving = false;
		document.querySelectorAll("#vc-b-submit, #vc-b-save, #vc-cta-submit").forEach((el) => (el.disabled = false));
	}
}

async function refreshAll() {
	try {
		const [pool, trips] = await Promise.all([
			call("vanchuyen.api.dieu_phoi.get_pool", {
				tim: S.filter.tim || undefined,
				tinh: S.filter.tinh || undefined,
				tu_ngay: S.filter.tu || undefined,
				den_ngay: S.filter.den || undefined,
				page: 1,
				page_size: 30,
			}),
			call("vanchuyen.api.dieu_phoi.get_trips"),
		]);
		S.pool = pool.rows || [];
		S.poolTotal = pool.total || 0;
		S.poolPage = 1;
		S.trips = trips || [];
	} catch (e) {
		showToast(errText(e), "error");
	}
	drawShell();
}

// ── Danh sách chuyến ─────────────────────────────────────────────────────────
function drawTrips() {
	const wrap = document.getElementById("vc-trips");
	if (!wrap) return;
	if (!S.trips.length) {
		wrap.innerHTML = `<div class="vc-text-muted vc-text-sm">Chưa có chuyến nào.</div>`;
		return;
	}
	wrap.innerHTML = `<div class="vc-list">${S.trips.map(tripCard).join("")}</div>`;
	S.trips.forEach((t) => {
		const card = wrap.querySelector(`[data-trip="${cssEscape(t.name)}"]`);
		if (!card) return;
		bindTrip(card, t);
	});
}

function tripBadge(t) {
	if (t.trang_thai === "Hoàn thành") return '<span class="vc-badge vc-badge-success">Hoàn thành</span>';
	if (t.trang_thai === "Đang giao") return '<span class="vc-badge vc-badge-primary">Đang giao</span>';
	return '<span class="vc-badge vc-badge-muted">Nháp</span>';
}

function tripCard(t) {
	const draft = t.docstatus === 0;
	const running = t.docstatus === 1 && t.trang_thai === "Đang giao";
	const printUrl =
		"/printview?doctype=Chuyen%20Xe&name=" + encodeURIComponent(t.name) + "&format=Phieu%20Giao%20Hang%20Chuyen%20Xe&trigger_print=0";
	let actions = "";
	if (draft) {
		actions = `
			<button class="vc-btn-ghost" data-edit>Sửa</button>
			<button class="vc-btn-success" data-submit><i class="fas fa-paper-plane"></i> Xuất</button>`;
	} else if (running) {
		actions = `
			<button class="vc-btn-ghost" data-adjust>Điều chỉnh</button>
			<a class="vc-btn-ghost" href="${printUrl}" target="_blank" rel="noopener">In phiếu</a>
			<button class="vc-btn-danger" data-cancel>Hủy</button>
			${t.can_complete ? '<button class="vc-btn-success" data-complete><i class="fas fa-flag-checkered"></i> Hoàn thành</button>' : ""}`;
	} else {
		actions = `<a class="vc-btn-ghost" href="${printUrl}" target="_blank" rel="noopener">In phiếu</a>`;
	}
	return `
	<div class="vc-order-card" data-trip="${escapeHtml(t.name)}">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${escapeHtml(t.name)}</div>
				<div class="vc-order-addr">${escapeHtml(formatDate(t.ngay_giao))} · ${escapeHtml(t.ten_lai_xe || t.lai_xe || "")} · ${escapeHtml(t.xe || "")}</div>
			</div>
			${tripBadge(t)}
		</div>
		<div class="vc-order-meta">
			<span class="vc-chip">${t.tong_don} đơn</span>
			<span class="vc-chip">${formatQty(t.tong_kien)} kiện</span>
			<span class="vc-chip">${formatM3(t.tong_the_tich)} m³ (${Math.round(Number(t.ti_le_tai) || 0)}%)</span>
			${t.docstatus === 1 ? `<span class="vc-chip">${t.stops_giao}/${t.stops_total} điểm</span>` : ""}
		</div>
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">${actions}</div>
	</div>`;
}

function bindTrip(card, t) {
	const q = (sel) => card.querySelector(sel);
	if (q("[data-edit]")) q("[data-edit]").addEventListener("click", () => editDraft(t.name));
	if (q("[data-submit]"))
		q("[data-submit]").addEventListener("click", async () => {
			await action("vanchuyen.api.dieu_phoi.submit_trip", { name: t.name }, "Đã xuất chuyến");
		});
	if (q("[data-cancel]"))
		q("[data-cancel]").addEventListener("click", () =>
			confirmDialog({
				title: "Hủy chuyến",
				message: `Hủy chuyến <b>${escapeHtml(t.name)}</b>? Các đơn sẽ nhả về pool.`,
				okText: "Hủy chuyến",
				danger: true,
				onOk: () => action("vanchuyen.api.dieu_phoi.cancel_trip", { name: t.name }, "Đã hủy chuyến"),
			})
		);
	if (q("[data-complete]"))
		q("[data-complete]").addEventListener("click", () =>
			confirmDialog({
				title: "Hoàn thành chuyến",
				message: `Hoàn thành <b>${escapeHtml(t.name)}</b>? Phần chưa giao sẽ nhả về pool.`,
				okText: "Hoàn thành",
				onOk: () => action("vanchuyen.api.dieu_phoi.complete_trip", { name: t.name }, "Đã hoàn thành chuyến"),
			})
		);
	if (q("[data-adjust]")) q("[data-adjust]").addEventListener("click", () => openAdjust(t.name));
}

async function action(method, args, okMsg) {
	try {
		await call(method, args);
		showToast(okMsg, "success");
		await refreshAll();
	} catch (e) {
		showToast(errText(e), "error");
	}
}

async function editDraft(name) {
	try {
		const doc = await call("vanchuyen.api.dieu_phoi.get_trip", { name });
		S.builder = {
			name: doc.name,
			ngay_giao: doc.ngay_giao || todayStr(),
			lai_xe: doc.lai_xe || "",
			xe: doc.xe || "",
			rows: (doc.stops || []).map((s) => ({
				sales_invoice: s.sales_invoice,
				khach_hang: s.khach_hang,
				tong_kien: Number(s.tong_kien) || 0,
				the_tich_lo: Number(s.the_tich_lo) || 0,
				con_lai: Number(s.con_lai) || Number(s.so_kien) || 0,
				so_kien: s.so_kien,
				the_tich: s.the_tich,
			})),
		};
		drawBuilder();
		window.scrollTo({ top: 0, behavior: "smooth" });
		showToast("Đã nạp nháp để sửa", "info");
	} catch (e) {
		showToast(errText(e), "error");
	}
}

async function openAdjust(name) {
	let doc;
	try {
		doc = await call("vanchuyen.api.dieu_phoi.get_trip", { name });
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	const remove = new Set();
	const addRows = [];
	const stopsHtml = (doc.stops || [])
		.map(
			(s) => `
		<div class="vc-flex vc-items-center vc-justify-between vc-mb-2" data-stop="${escapeHtml(s.row_name)}" style="padding:.4rem;border:1px solid var(--vc-border);border-radius:10px">
			<div><div class="vc-font-bold vc-text-sm">${escapeHtml(s.khach_hang || s.sales_invoice)}</div>
			<div class="vc-text-muted vc-text-sm">${escapeHtml(s.sales_invoice)} · ${formatQty(s.so_kien)} kiện · ${escapeHtml(s.trang_thai_giao)}</div></div>
			<button class="vc-btn-ghost" data-toggle-remove="${escapeHtml(s.row_name)}">Gỡ</button>
		</div>`
		)
		.join("");
	const poolOpts = ['<option value="">— chọn đơn từ pool để thêm —</option>']
		.concat(
			S.pool
				.filter((o) => (Number(o.con_lai) || 0) > 0)
				.map((o) => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.khach_hang || o.name)} · còn ${formatQty(o.con_lai)}</option>`)
		)
		.join("");
	const body = `
		<div class="vc-section-title" style="margin-top:0">Điểm giao hiện tại</div>
		<div id="vc-adj-stops">${stopsHtml || '<div class="vc-text-muted vc-text-sm">Không có điểm giao.</div>'}</div>
		<div class="vc-section-title">Thêm đơn</div>
		<div class="vc-flex vc-gap-2 vc-items-center">
			<select class="vc-select" id="vc-adj-pool" style="flex:1">${poolOpts}</select>
			<input class="vc-input" id="vc-adj-kien" type="number" min="0.01" step="0.01" placeholder="Kiện" style="width:90px" />
			<button class="vc-btn-ghost" id="vc-adj-add">Thêm</button>
		</div>
		<div id="vc-adj-added" class="vc-mt-2"></div>`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Đóng</button>
		<button class="vc-btn-primary" id="vc-adj-save">Lưu điều chỉnh</button>`;
	const content = showModal({ title: `Điều chỉnh ${escapeHtml(name)}`, body, footer });

	content.querySelectorAll("[data-toggle-remove]").forEach((btn) =>
		btn.addEventListener("click", () => {
			const rn = btn.dataset.toggleRemove;
			const row = content.querySelector(`[data-stop="${cssEscape(rn)}"]`);
			if (remove.has(rn)) {
				remove.delete(rn);
				btn.textContent = "Gỡ";
				btn.className = "vc-btn-ghost";
				row.style.opacity = "1";
			} else {
				remove.add(rn);
				btn.textContent = "Hoàn tác";
				btn.className = "vc-btn-danger";
				row.style.opacity = "0.5";
			}
		})
	);

	function renderAdded() {
		content.querySelector("#vc-adj-added").innerHTML = addRows
			.map((r) => `<span class="vc-badge vc-badge-primary" style="margin:2px">${escapeHtml(r.khach_hang)} +${formatQty(r.so_kien)}</span>`)
			.join("");
	}
	content.querySelector("#vc-adj-add").addEventListener("click", () => {
		const si = content.querySelector("#vc-adj-pool").value;
		const kien = Number(content.querySelector("#vc-adj-kien").value) || 0;
		const o = findPool(si);
		if (!o || kien <= 0) {
			showToast("Chọn đơn và số kiện > 0", "error");
			return;
		}
		if (kien > (Number(o.con_lai) || 0) + 0.001) {
			showToast("Vượt số kiện còn lại", "error");
			return;
		}
		const row = mkRow(o, kien, 0);
		row.the_tich = proRata(row);
		addRows.push(row);
		content.querySelector("#vc-adj-kien").value = "";
		renderAdded();
	});

	content.querySelector("#vc-adj-save").addEventListener("click", async () => {
		try {
			await call("vanchuyen.api.dieu_phoi.adjust_trip", {
				name,
				add_rows: JSON.stringify(addRows.map((r) => ({ sales_invoice: r.sales_invoice, so_kien: r.so_kien, the_tich: r.the_tich }))),
				remove_row_names: JSON.stringify([...remove]),
			});
			closeModal();
			showToast("Đã điều chỉnh chuyến", "success");
			await refreshAll();
		} catch (e) {
			showToast(errText(e), "error");
		}
	});
}

function cssEscape(s) {
	return String(s).replace(/["\\]/g, "\\$&");
}
