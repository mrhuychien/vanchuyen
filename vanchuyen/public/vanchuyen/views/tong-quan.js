// #/tong-quan — TỔNG QUAN vận chuyển (Điều hành / quản trị). Trang chủ khi đăng nhập admin.
// Tổng hợp KPI + phân bổ theo trạng thái / hình thức + chuyến xe + top lái xe.
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatNumber, formatM3 } from "../lib/format.js";

let ROOT = null;
let PERIOD = "30";

const PERIODS = [
	{ v: "today", t: "Hôm nay" },
	{ v: "7", t: "7 ngày" },
	{ v: "30", t: "30 ngày" },
	{ v: "90", t: "90 ngày" },
	{ v: "all", t: "Tất cả" },
];

const STATUS_STYLE = {
	"Đang xử lý": { c: "#f59e0b", i: "⏳" },
	"Đang giao hàng": { c: "#3b82f6", i: "🚚" },
	"Đã giao hàng, chụp chứng từ": { c: "#f97316", i: "📸" },
	"Đã nộp chứng từ": { c: "#10b981", i: "✅" },
};
const TRIP_STYLE = {
	Nháp: { c: "#9ca3af", i: "📝" },
	"Đang giao": { c: "#3b82f6", i: "🚚" },
	"Hoàn thành": { c: "#10b981", i: "🏁" },
};

const CSS_TEXT = `
.tq-periods { display:flex; gap:.4rem; flex-wrap:wrap; margin-bottom:.9rem; }
.tq-period { padding:.4rem .8rem; border-radius:10px; border:1.5px solid var(--vc-border,#e5e7eb); background:#fff;
  font-weight:600; font-size:.82rem; cursor:pointer; color:var(--vc-text,#1f2937); font-family:inherit; }
.tq-period.on { background:var(--vc-accent-grad,linear-gradient(135deg,#6366f1,#8b5cf6)); color:#fff; border-color:transparent; }
.tq-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.6rem; margin-bottom:.9rem; }
.tq-kpi { background:#fff; border:1px solid var(--vc-border,#e5e7eb); border-radius:14px; padding:.8rem .9rem; position:relative; overflow:hidden; }
.tq-kpi::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--k,#6366f1); }
.tq-kpi-label { font-size:.72rem; color:var(--vc-muted,#6b7280); font-weight:600; text-transform:uppercase; letter-spacing:.3px; }
.tq-kpi-value { font-size:1.6rem; font-weight:800; line-height:1.1; margin-top:.15rem; }
.tq-kpi-sub { font-size:.72rem; color:var(--vc-muted,#6b7280); margin-top:.1rem; }
.tq-bar-row { margin-bottom:.6rem; }
.tq-bar-head { display:flex; justify-content:space-between; font-size:.82rem; font-weight:600; margin-bottom:.25rem; }
.tq-bar-track { height:10px; border-radius:999px; background:var(--vc-gray-100,#f1f5f9); overflow:hidden; }
.tq-bar-fill { height:100%; border-radius:999px; }
.tq-drv { display:flex; align-items:center; gap:.6rem; padding:.5rem 0; border-bottom:1px solid var(--vc-border,#f1f5f9); }
.tq-drv:last-child { border-bottom:none; }
.tq-drv-rank { width:26px; height:26px; border-radius:50%; background:var(--vc-gray-100,#f1f5f9); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.8rem; flex-shrink:0; }
.tq-drv-name { flex:1; min-width:0; font-weight:600; font-size:.88rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tq-drv-meta { font-size:.75rem; color:var(--vc-muted,#6b7280); text-align:right; white-space:nowrap; }
`;

function injectCss() {
	if (document.getElementById("tq-styles")) return;
	const s = document.createElement("style");
	s.id = "tq-styles";
	s.textContent = CSS_TEXT;
	document.head.appendChild(s);
}

export async function render({ container }) {
	injectCss();
	ROOT = container;
	container.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Tổng quan vận chuyển</div>
				<div class="vc-view-banner-subtitle">Số liệu kiểm soát tình hình giao hàng</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-chart-line"></i></div>
		</div>
		<div class="tq-periods" id="tq-periods">
			${PERIODS.map((p) => `<button class="tq-period ${p.v === PERIOD ? "on" : ""}" data-p="${p.v}">${p.t}</button>`).join("")}
		</div>
		<div id="tq-body">${skeleton(80, 4)}</div>`;

	container.querySelectorAll(".tq-period").forEach((b) =>
		b.addEventListener("click", () => {
			PERIOD = b.dataset.p;
			container.querySelectorAll(".tq-period").forEach((x) => x.classList.toggle("on", x.dataset.p === PERIOD));
			load();
		})
	);
	load();
}

async function load() {
	const body = document.getElementById("tq-body");
	if (!body) return;
	body.innerHTML = skeleton(80, 4);
	let d;
	try {
		d = await call("vanchuyen.api.tong_quan.get_overview", { period: PERIOD });
	} catch (e) {
		body.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
			<div class="vc-empty-title">Không tải được số liệu</div>
			<p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	body.innerHTML = draw(d);
}

function kpi(label, value, sub, color) {
	return `<div class="tq-kpi" style="--k:${color}">
		<div class="tq-kpi-label">${escapeHtml(label)}</div>
		<div class="tq-kpi-value">${value}</div>
		${sub ? `<div class="tq-kpi-sub">${sub}</div>` : ""}
	</div>`;
}

function barRow(label, count, total, color, icon) {
	const pct = total > 0 ? Math.round((count / total) * 100) : 0;
	return `<div class="tq-bar-row">
		<div class="tq-bar-head"><span>${icon || ""} ${escapeHtml(label)}</span><span>${formatNumber(count)} · ${pct}%</span></div>
		<div class="tq-bar-track"><div class="tq-bar-fill" style="width:${pct}%;background:${color}"></div></div>
	</div>`;
}

function draw(d) {
	const kpis = [
		kpi("Tổng đơn", formatNumber(d.total), `${formatNumber(d.tong_kien)} kiện · ${formatM3(d.the_tich)} m³`, "#6366f1"),
		kpi("Chưa phân công", formatNumber(d.chua_phan_cong), `Đã phân ${d.ty_le_phan_cong}%`, "#f59e0b"),
		kpi("Đang giao", formatNumber(d.dang_giao), "", "#3b82f6"),
		kpi("Đã giao", formatNumber(d.da_giao), `Tỷ lệ giao ${d.ty_le_giao}%`, "#10b981"),
		kpi("Đã nộp chứng từ", formatNumber(d.da_nop), "", "#059669"),
		kpi("Chuyến xe", formatNumber(d.trips_total), "", "#8b5cf6"),
		kpi("Sự cố đang mở", formatNumber(d.su_co_mo || 0), "Đơn giao qua đơn vị VC", (d.su_co_mo || 0) > 0 ? "#ef4444" : "#10b981"),
	].join("");

	const statusBars = d.by_status
		.map((s) => barRow(s.label, s.count, d.total, (STATUS_STYLE[s.label] || {}).c || "#6366f1", (STATUS_STYLE[s.label] || {}).i))
		.join("");

	const typeTotal = d.by_type.reduce((a, x) => a + x.count, 0);
	const typeBars = d.by_type.length
		? d.by_type.map((t, i) => barRow(t.label, t.count, typeTotal, ["#6366f1", "#8b5cf6", "#06b6d4", "#f472b6", "#f59e0b", "#10b981"][i % 6])).join("")
		: '<p class="vc-text-muted vc-text-sm">Chưa có dữ liệu.</p>';

	const tripTotal = d.trips_by_status.reduce((a, x) => a + x.count, 0);
	const tripBars = d.trips_by_status
		.map((s) => barRow(s.label, s.count, tripTotal, (TRIP_STYLE[s.label] || {}).c || "#8b5cf6", (TRIP_STYLE[s.label] || {}).i))
		.join("");

	const drivers = d.top_drivers.length
		? d.top_drivers
				.map(
					(dr, i) => `<div class="tq-drv">
			<div class="tq-drv-rank">${i + 1}</div>
			<div class="tq-drv-name">${escapeHtml(dr.ten)}</div>
			<div class="tq-drv-meta">${formatNumber(dr.so_chuyen)} chuyến · ${formatNumber(dr.so_don)} đơn<br>${formatM3(dr.the_tich)} m³</div>
		</div>`
				)
				.join("")
		: '<p class="vc-text-muted vc-text-sm">Chưa có chuyến nào trong kỳ.</p>';

	return `
		<div class="tq-kpis">${kpis}</div>
		<div class="vc-card vc-mb-3">
			<div class="vc-section-title">📋 Theo trạng thái giao hàng</div>
			${statusBars}
		</div>
		<div class="vc-card vc-mb-3">
			<div class="vc-section-title">🚛 Theo hình thức vận chuyển</div>
			${typeBars}
		</div>
		<div class="vc-card vc-mb-3">
			<div class="vc-section-title">🚚 Chuyến xe (${formatNumber(d.trips_total)})</div>
			${tripBars}
		</div>
		<div class="vc-card vc-mb-3">
			<div class="vc-section-title">🏆 Top lái xe theo số chuyến</div>
			${drivers}
		</div>
		${
			(d.su_co_loai && d.su_co_loai.length)
				? `<div class="vc-card">
					<div class="vc-section-title">⚠️ Sự cố đang mở theo loại</div>
					${d.su_co_loai.map((s) => barRow(s.label, s.count, d.su_co_mo || 0, "#ef4444")).join("")}
					<a class="vc-btn-ghost vc-btn-block vc-mt-2" href="#/su-co">Xem tất cả sự cố →</a>
				</div>`
				: ""
		}`;
}
