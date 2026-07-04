// #/dieu-phoi — admin logistics (Phase 2). Port trang legacy: giữ nguyên hành vi
// filter/quick-filter/stats/bulk/export, THAY data layer bằng api/dieu_hanh.py
// (server filter+paginate+batch items) + XLSX lazy-load chỉ trong view này.
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatQty, formatM3, formatDate } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { showModal, closeModal } from "../components/modal.js";

const SHIP_TYPES = ["Chưa phân công", "Nhất Tín", "Viettel Post", "Tự vận chuyển", "Xe vào bốc"];
const SHIP_STATUSES = [
	"Chờ xử lý",
	"Đang xử lý",
	"Đang giao hàng",
	"Đã giao hàng, chụp chứng từ",
	"Đã nộp chứng từ",
];
const TYPE_ICON = {
	"Chưa phân công": "⚪",
	"Nhất Tín": "📦",
	"Viettel Post": "📮",
	"Tự vận chuyển": "🚗",
	"Xe vào bốc": "🚛",
};

// Region mapping + hạn PO theo miền (+2/+4/+6) — port nguyên từ trang legacy.
const REGION_MAP = {
	"Miền Bắc": [
		"Hà Nội", "Hải Phòng", "Hải Dương", "Hưng Yên", "Bắc Ninh", "Bắc Giang", "Quảng Ninh", "Vĩnh Phúc",
		"Thái Nguyên", "Phú Thọ", "Lạng Sơn", "Cao Bằng", "Hà Giang", "Tuyên Quang", "Yên Bái", "Lào Cai",
		"Điện Biên", "Lai Châu", "Sơn La", "Hòa Bình", "Nam Định", "Thái Bình", "Ninh Bình", "Hà Nam",
	],
	"Miền Trung": [
		"Thanh Hóa", "Nghệ An", "Hà Tĩnh", "Quảng Bình", "Quảng Trị", "Thừa Thiên Huế", "Đà Nẵng", "Quảng Nam",
		"Quảng Ngãi", "Bình Định", "Phú Yên", "Khánh Hòa", "Ninh Thuận", "Bình Thuận", "Kon Tum", "Gia Lai",
		"Đắk Lắk", "Đắk Nông", "Lâm Đồng",
	],
	"Miền Nam": [
		"Hồ Chí Minh", "Đồng Nai", "Bình Dương", "Bà Rịa - Vũng Tàu", "Long An", "Tiền Giang", "Bến Tre",
		"Vĩnh Long", "Trà Vinh", "Đồng Tháp", "An Giang", "Kiên Giang", "Cần Thơ", "Hậu Giang", "Sóc Trăng",
		"Bạc Liêu", "Cà Mau", "Tây Ninh", "Bình Phước",
	],
};

const S = {
	rows: [],
	total: 0,
	page: 1,
	pageSize: 100,
	stats: {},
	selected: new Set(),
	timeRange: "30",
	groups: [],
	filter: {
		tu_ngay: "",
		den_ngay: "",
		date: "",
		hinh_thuc: "",
		trang_thai: "",
		po: "",
		customer: "",
		customer_group: "",
		address_name: "",
	},
};
let ROOT = null;

// ── helpers ported ───────────────────────────────────────────────────────────
function regionOf(province) {
	if (!province) return "Miền Bắc";
	for (const [region, list] of Object.entries(REGION_MAP)) {
		if (list.some((p) => province.includes(p) || p.includes(province))) return region;
	}
	return "Miền Bắc";
}
function poDeadline(postingDate, province) {
	if (!postingDate) return "";
	const region = regionOf(province);
	const d = new Date(postingDate);
	const add = region === "Miền Nam" ? 6 : region === "Miền Trung" ? 4 : 2;
	d.setDate(d.getDate() + add);
	return d.toISOString().slice(0, 10);
}
function toM3(cm3) {
	return ((Number(cm3) || 0) / 1000000).toFixed(3);
}
function addrFirstLine(raw) {
	return (raw || "").split(/<br\s*\/?>/i)[0].trim();
}
function timeRangeStart() {
	if (S.timeRange === "all") return "";
	const n = parseInt(S.timeRange, 10);
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}
function apiFilters() {
	const f = { ...S.filter };
	const start = timeRangeStart();
	if (start && !f.tu_ngay) f.tu_ngay = start;
	Object.keys(f).forEach((k) => {
		if (!f[k]) delete f[k];
	});
	return f;
}

function loadXLSX() {
	if (window.XLSX) return Promise.resolve(window.XLSX);
	return new Promise((res, rej) => {
		const s = document.createElement("script");
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
		s.onload = () => res(window.XLSX);
		s.onerror = () => rej(new Error("Không tải được thư viện Excel"));
		document.head.appendChild(s);
	});
}

// ── data ─────────────────────────────────────────────────────────────────────
async function loadPage(page) {
	const res = await call("vanchuyen.api.dieu_hanh.get_invoices_dieu_phoi", {
		filters: JSON.stringify(apiFilters()),
		page,
		page_size: S.pageSize,
	});
	S.rows = res.rows || [];
	S.total = res.total || 0;
	S.stats = res.stats || {};
	S.page = page;
}

async function fetchAllFiltered() {
	const out = [];
	let page = 1;
	const size = 500;
	while (page <= 60) {
		const res = await call("vanchuyen.api.dieu_hanh.get_invoices_dieu_phoi", {
			filters: JSON.stringify(apiFilters()),
			page,
			page_size: size,
		});
		out.push(...(res.rows || []));
		if (out.length >= (res.total || 0) || !(res.rows || []).length) break;
		page++;
	}
	return out;
}

export async function render({ container }) {
	ROOT = container;
	container.innerHTML = skeleton(120, 4);
	try {
		await loadPage(1);
	} catch (e) {
		container.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
			<div class="vc-empty-title">Không tải được dữ liệu</div>
			<p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	draw();
}

function draw() {
	ROOT.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Điều hành vận chuyển</div>
				<div class="vc-view-banner-subtitle">${S.total} đơn · trang ${S.page}</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-clipboard-list"></i></div>
		</div>

		<div class="vc-pill-nav" id="vc-range">
			${["30", "60", "90", "all"]
				.map(
					(r) =>
						`<button class="${S.timeRange === r ? "vc-active" : ""}" data-range="${r}">${
							r === "all" ? "Tất cả" : r + " ngày"
						}</button>`
				)
				.join("")}
		</div>

		<div class="vc-filters">
			<input class="vc-input" type="date" id="vc-f-tu" value="${escapeHtml(S.filter.tu_ngay)}" aria-label="Từ ngày" />
			<input class="vc-input" type="date" id="vc-f-den" value="${escapeHtml(S.filter.den_ngay)}" aria-label="Đến ngày" />
			<input class="vc-input" id="vc-f-po" placeholder="Số PO" value="${escapeHtml(S.filter.po)}" />
			<input class="vc-input" id="vc-f-cust" placeholder="Khách hàng" value="${escapeHtml(S.filter.customer)}" />
			<select class="vc-select" id="vc-f-status">
				<option value="">— Trạng thái —</option>
				${SHIP_STATUSES.map(
					(s) => `<option value="${escapeHtml(s)}" ${S.filter.trang_thai === s ? "selected" : ""}>${escapeHtml(s)}</option>`
				).join("")}
			</select>
			<button class="vc-btn-ghost" id="vc-f-apply"><i class="fas fa-filter"></i> Lọc</button>
			<button class="vc-btn-ghost" id="vc-f-clear">Xóa lọc</button>
		</div>

		<div class="vc-kpi-grid" id="vc-stats" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
			${SHIP_TYPES.map(statCard).join("")}
		</div>

		<div id="vc-bulk"></div>

		<div class="vc-flex vc-gap-2 vc-mt-3 vc-mb-3" style="flex-wrap:wrap">
			<button class="vc-btn-ghost" id="vc-exp-single"><i class="fas fa-file-excel"></i> Xuất đơn (STT)</button>
			<button class="vc-btn-primary" id="vc-exp-combined"><i class="fas fa-file-excel"></i> Xuất đơn tổng + chia</button>
		</div>

		<div id="vc-table"></div>
		<div class="vc-pager vc-mt-3">
			<button class="vc-pager-btn" id="vc-prev" ${S.page <= 1 ? "disabled" : ""}>‹ Trước</button>
			<span class="vc-pager-info">Trang ${S.page}/${Math.max(1, Math.ceil(S.total / S.pageSize))} · ${S.total} đơn</span>
			<button class="vc-pager-btn" id="vc-next" ${S.page >= Math.ceil(S.total / S.pageSize) ? "disabled" : ""}>Sau ›</button>
		</div>`;

	// range pills
	ROOT.querySelectorAll("[data-range]").forEach((b) =>
		b.addEventListener("click", async () => {
			S.timeRange = b.dataset.range;
			await reload(1);
		})
	);
	// stats click → filter by type
	ROOT.querySelectorAll("[data-type]").forEach((c) =>
		c.addEventListener("click", async () => {
			const t = c.dataset.type;
			S.filter.hinh_thuc = S.filter.hinh_thuc === t ? "" : t;
			await reload(1);
		})
	);
	document.getElementById("vc-f-apply").addEventListener("click", () => {
		S.filter.tu_ngay = document.getElementById("vc-f-tu").value;
		S.filter.den_ngay = document.getElementById("vc-f-den").value;
		S.filter.po = document.getElementById("vc-f-po").value.trim();
		S.filter.customer = document.getElementById("vc-f-cust").value.trim();
		S.filter.trang_thai = document.getElementById("vc-f-status").value;
		reload(1);
	});
	document.getElementById("vc-f-clear").addEventListener("click", () => {
		S.filter = { tu_ngay: "", den_ngay: "", date: "", hinh_thuc: "", trang_thai: "", po: "", customer: "", customer_group: "", address_name: "" };
		reload(1);
	});
	document.getElementById("vc-prev").addEventListener("click", () => S.page > 1 && reload(S.page - 1));
	document.getElementById("vc-next").addEventListener("click", () => reload(S.page + 1));
	document.getElementById("vc-exp-single").addEventListener("click", exportSingle);
	document.getElementById("vc-exp-combined").addEventListener("click", exportCombined);

	drawBulk();
	drawTable();
}

async function reload(page) {
	try {
		await loadPage(page);
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	draw();
}

function statCard(t) {
	const active = S.filter.hinh_thuc === t;
	return `<div class="vc-kpi-card" data-type="${escapeHtml(t)}" style="cursor:pointer;${active ? "border-color:var(--vc-accent-1);box-shadow:0 0 0 2px var(--vc-accent-glow)" : ""}">
		<div class="vc-kpi-label">${TYPE_ICON[t] || ""} ${escapeHtml(t)}</div>
		<div class="vc-kpi-value">${S.stats[t] || 0}</div>
	</div>`;
}

function drawBulk() {
	const wrap = document.getElementById("vc-bulk");
	const n = S.selected.size;
	if (!n) {
		wrap.innerHTML = "";
		return;
	}
	wrap.innerHTML = `
	<div class="vc-card vc-mt-3">
		<div class="vc-flex vc-items-center vc-justify-between vc-mb-2">
			<div class="vc-font-bold">${n} đơn đã chọn</div>
			<button class="vc-btn-ghost" id="vc-sel-clear" style="padding:4px 10px">Bỏ chọn</button>
		</div>
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<select class="vc-select" id="vc-bulk-type" style="flex:1;min-width:160px">
				<option value="">Gán hình thức…</option>
				${SHIP_TYPES.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
			</select>
			<button class="vc-btn-primary" id="vc-bulk-type-apply">Áp dụng</button>
		</div>
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">
			<select class="vc-select" id="vc-bulk-status" style="flex:1;min-width:160px">
				<option value="">Gán trạng thái…</option>
				${SHIP_STATUSES.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
			</select>
			<button class="vc-btn-primary" id="vc-bulk-status-apply">Áp dụng</button>
		</div>
	</div>`;
	document.getElementById("vc-sel-clear").addEventListener("click", () => {
		S.selected.clear();
		draw();
	});
	document.getElementById("vc-bulk-type-apply").addEventListener("click", () =>
		bulkApply("custom_hình_thức_vận_chuyển", document.getElementById("vc-bulk-type").value)
	);
	document.getElementById("vc-bulk-status-apply").addEventListener("click", () =>
		bulkApply("custom_trạng_thái_vận_chuyển", document.getElementById("vc-bulk-status").value)
	);
}

async function bulkApply(fieldname, value) {
	if (!value) {
		showToast("Chọn giá trị để gán", "warning");
		return;
	}
	try {
		const res = await call("vanchuyen.api.dieu_hanh.bulk_update_van_chuyen", {
			names: JSON.stringify([...S.selected]),
			fieldname,
			value,
		});
		showToast(`Đã cập nhật ${res.updated}/${res.total} đơn`, "success");
		S.selected.clear();
		await reload(S.page);
	} catch (e) {
		showToast(errText(e), "error");
	}
}

function drawTable() {
	const wrap = document.getElementById("vc-table");
	if (!S.rows.length) {
		wrap.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">📭</div>
			<div class="vc-empty-title">Không có đơn nào khớp bộ lọc</div></div>`;
		return;
	}
	wrap.innerHTML = `
	<table class="vc-table">
		<thead><tr>
			<th style="width:36px"><input type="checkbox" id="vc-check-all" /></th>
			<th>Khách hàng</th><th>PO</th><th>Hình thức</th><th>Trạng thái</th>
			<th>Kiện</th><th>m³</th><th>Ngày</th><th></th>
		</tr></thead>
		<tbody>
			${S.rows.map(rowHtml).join("")}
		</tbody>
	</table>`;

	const all = document.getElementById("vc-check-all");
	all.checked = S.rows.every((r) => S.selected.has(r.name));
	all.addEventListener("change", () => {
		S.rows.forEach((r) => (all.checked ? S.selected.add(r.name) : S.selected.delete(r.name)));
		draw();
	});
	wrap.querySelectorAll("[data-check]").forEach((cb) =>
		cb.addEventListener("change", () => {
			cb.checked ? S.selected.add(cb.dataset.check) : S.selected.delete(cb.dataset.check);
			drawBulk();
		})
	);
	wrap.querySelectorAll("[data-detail]").forEach((btn) =>
		btn.addEventListener("click", () => openDetail(btn.dataset.detail))
	);
}

function rowHtml(r) {
	const ht = r.hinh_thuc || "Chưa phân công";
	return `<tr>
		<td data-label=""><input type="checkbox" data-check="${escapeHtml(r.name)}" ${S.selected.has(r.name) ? "checked" : ""} /></td>
		<td data-label="Khách hàng">${escapeHtml(r.customer_name || r.customer || "")}</td>
		<td data-label="PO">${escapeHtml(r.po || "")}</td>
		<td data-label="Hình thức">${TYPE_ICON[ht] || ""} ${escapeHtml(ht)}</td>
		<td data-label="Trạng thái">${escapeHtml(r.trang_thai_vc || "")}</td>
		<td data-label="Kiện">${formatQty(r.tong_kien)}</td>
		<td data-label="m³">${toM3(r.the_tich_lo)}</td>
		<td data-label="Ngày">${escapeHtml(formatDate(r.posting_date))}</td>
		<td data-label=""><button class="vc-btn-ghost" data-detail="${escapeHtml(r.name)}" style="padding:4px 10px">Xem</button></td>
	</tr>`;
}

function openDetail(name) {
	const r = S.rows.find((x) => x.name === name);
	if (!r) return;
	const addr = addrFirstLine(r.shipping_address);
	const full = addr ? `${addr}, ${r.tinh || ""}`.replace(/,\s*$/, "") : r.tinh || "";
	const body = `<dl class="vc-detail-list">
		<dt>Số đơn</dt><dd>${escapeHtml(r.name)}</dd>
		<dt>Khách hàng</dt><dd>${escapeHtml(r.customer_name || r.customer || "")}</dd>
		<dt>Nhóm KH</dt><dd>${escapeHtml(r.customer_group || "")}</dd>
		<dt>Số PO</dt><dd>${escapeHtml(r.po || "")}</dd>
		<dt>Địa chỉ</dt><dd>${escapeHtml(full)}</dd>
		<dt>Tỉnh</dt><dd>${escapeHtml(r.tinh || "")}</dd>
		<dt>Hình thức VC</dt><dd>${escapeHtml(r.hinh_thuc || "Chưa phân công")}</dd>
		<dt>Trạng thái VC</dt><dd>${escapeHtml(r.trang_thai_vc || "")}</dd>
		<dt>Xe</dt><dd>${escapeHtml(r.xe || "")}</dd>
		<dt>Lái xe</dt><dd>${escapeHtml(r.ten_lai_xe || "")}</dd>
		<dt>Tổng kiện</dt><dd>${formatQty(r.tong_kien)}</dd>
		<dt>Thể tích</dt><dd>${toM3(r.the_tich_lo)} m³</dd>
		<dt>Hạn PO</dt><dd>${escapeHtml(poDeadline(r.posting_date, r.tinh))}</dd>
		<dt>Ngày ghi</dt><dd>${escapeHtml(formatDate(r.posting_date))}</dd>
	</dl>`;
	showModal({ title: escapeHtml(r.customer_name || name), body, footer: `<button class="vc-btn-ghost" data-vc-close>Đóng</button>` });
}

// ── Export ───────────────────────────────────────────────────────────────────
async function exportTargets() {
	// Ưu tiên đơn đã chọn; nếu không có → toàn tập filtered.
	const all = await fetchAllFiltered();
	if (S.selected.size) {
		const set = S.selected;
		return all.filter((r) => set.has(r.name));
	}
	return all;
}

async function exportSingle() {
	let XLSX;
	try {
		XLSX = await loadXLSX();
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	showToast("Đang chuẩn bị Excel…", "info");
	const rows = await exportTargets();
	if (!rows.length) {
		showToast("Không có đơn để xuất", "warning");
		return;
	}
	const data = rows.map((inv, i) => {
		const addr = addrFirstLine(inv.shipping_address);
		const full = addr ? `${addr}, ${inv.tinh || ""}`.replace(/,\s*$/, "") : inv.tinh || "";
		return {
			STT: i + 1,
			"Khách hàng": inv.customer || "",
			"Số PO": inv.po || "",
			"Tên địa chỉ": inv.shipping_address_name || "",
			"Địa chỉ": full,
			"Số kiện": inv.tong_kien || 0,
			"Số kg": (inv.tong_kien || 0) * 11,
			"Hạn PO": poDeadline(inv.posting_date, inv.tinh),
			"Ghi chú": inv.name,
		};
	});
	const ws = XLSX.utils.json_to_sheet(data);
	ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 18 }, { wch: 25 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }];
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, "Đơn");
	XLSX.writeFile(wb, `Don_${new Date().toISOString().slice(0, 10)}.xlsx`);
	showToast(`Đã xuất ${rows.length} đơn`, "success");
}

async function exportCombined() {
	let XLSX;
	try {
		XLSX = await loadXLSX();
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	const rows = await exportTargets();
	if (!rows.length) {
		showToast("Không có đơn để xuất", "warning");
		return;
	}
	showToast(`Đang tạo Excel cho ${rows.length} đơn…`, "info");
	let withItems;
	try {
		withItems = await call("vanchuyen.api.dieu_hanh.get_items_for_export", {
			names: JSON.stringify(rows.map((r) => r.name)),
		});
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	const itemsByName = {};
	withItems.forEach((x) => (itemsByName[x.name] = x.items || []));

	// ── Đơn tổng: gộp theo item, tách Thùng/Hộp, chuẩn hóa hộp dư → thùng ──
	const productMap = {};
	Object.values(itemsByName).forEach((items) => {
		items.forEach((item) => {
			const key = item.item_code || item.item_name;
			if (!productMap[key]) {
				productMap[key] = { thung: 0, hop: 0, item_name: item.item_name || "", item_code: item.item_code || "", quycach: item.quycach || 0 };
			}
			addQty(productMap[key], item);
		});
	});
	Object.values(productMap).forEach(normalize);
	const donTong = Object.values(productMap).map((p) => ({
		Loại: "Hàng truyền thống",
		"Quy cách": p.quycach > 0 ? `${p.quycach} hộp/thùng` : "",
		"Mã vạch": "",
		"Tên sản phẩm": p.item_name,
		Mã: p.item_code,
		"Số thùng": p.thung,
		Lẻ: p.hop,
	}));
	donTong.push({
		Loại: "Total",
		"Quy cách": "",
		"Mã vạch": "",
		"Tên sản phẩm": "",
		Mã: "",
		"Số thùng": donTong.reduce((s, i) => s + i["Số thùng"], 0),
		Lẻ: donTong.reduce((s, i) => s + i["Lẻ"], 0),
	});

	// ── Đơn chia: mỗi đơn 1 dòng, thùng + hộp riêng ──
	const donChia = rows.map((inv) => {
		const items = itemsByName[inv.name] || [];
		const invProducts = {};
		items.forEach((item) => {
			const key = item.item_code || item.item_name;
			if (!invProducts[key]) invProducts[key] = { thung: 0, hop: 0, quycach: item.quycach || 0 };
			addQty(invProducts[key], item);
		});
		Object.values(invProducts).forEach(normalize);
		const productStr = Object.entries(invProducts)
			.map(([code, p]) => `${code} - ${p.thung} Thùng${p.hop > 0 ? ` + ${p.hop} Hộp` : ""}`)
			.join(", ");
		const hopDu = Object.values(invProducts).reduce((s, p) => s + p.hop, 0);
		return {
			Tỉnh: inv.tinh || "",
			"Chi tiết": inv.shipping_address_name || "",
			"Số PO": inv.po || "",
			"Sản phẩm": productStr,
			"Số kiện": inv.tong_kien || 0,
			"Lẻ hộp": hopDu,
			"Thể tích(m3)": toM3(inv.the_tich_lo),
		};
	});
	donChia.push({
		Tỉnh: "Total",
		"Chi tiết": "",
		"Số PO": "",
		"Sản phẩm": "",
		"Số kiện": donChia.reduce((s, i) => s + i["Số kiện"], 0),
		"Lẻ hộp": donChia.reduce((s, i) => s + i["Lẻ hộp"], 0),
		"Thể tích(m3)": toM3(rows.reduce((s, inv) => s + (Number(inv.the_tich_lo) || 0), 0)),
	});

	const wb = XLSX.utils.book_new();
	const wsT = XLSX.utils.json_to_sheet(donTong);
	wsT["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 10 }];
	XLSX.utils.book_append_sheet(wb, wsT, "Đơn tổng");
	const wsC = XLSX.utils.json_to_sheet(donChia);
	wsC["!cols"] = [{ wch: 20 }, { wch: 40 }, { wch: 18 }, { wch: 50 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
	XLSX.utils.book_append_sheet(wb, wsC, "Đơn chia");
	XLSX.writeFile(wb, `Don-Tong-Chia_${new Date().toISOString().slice(0, 10)}.xlsx`);
	showToast(`Đã xuất ${rows.length} đơn`, "success");
}

// Phân loại qty theo UOM (Hộp → hộp; Thùng/rỗng → thùng + phần thập phân sang hộp theo quycach).
function addQty(p, item) {
	const qty = Number(item.qty) || 0;
	const uom = (item.uom || "").trim();
	if (uom === "Hộp") {
		p.hop += qty;
	} else {
		p.thung += Math.floor(qty);
		const frac = qty - Math.floor(qty);
		if (frac > 0 && p.quycach > 0) p.hop += Math.round(frac * p.quycach);
	}
}
function normalize(p) {
	if (p.quycach > 0 && p.hop >= p.quycach) {
		p.thung += Math.floor(p.hop / p.quycach);
		p.hop = p.hop % p.quycach;
	}
}
