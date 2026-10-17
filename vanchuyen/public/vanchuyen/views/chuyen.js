// #/chuyen — Lái Xe: danh sách chuyến của tôi (mobile-first). Không có số tiền.
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate, formatCurrency } from "../lib/format.js";

export async function render({ container }) {
	container.innerHTML = skeleton(90, 3);
	let trips;
	try {
		trips = await call("vanchuyen.api.lai_xe.get_my_trips");
	} catch (e) {
		container.innerHTML = empty("⚠️", "Không tải được chuyến", errText(e));
		return;
	}
	if (!trips || !trips.length) {
		container.innerHTML = empty("📭", "Chưa có chuyến nào hôm nay", "Chuyến sẽ hiện khi điều phối phân công.");
		return;
	}
	container.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Chuyến của tôi</div>
				<div class="vc-view-banner-subtitle">${trips.length} chuyến hôm nay</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-truck"></i></div>
		</div>
		<div class="vc-list">${trips.map(card).join("")}</div>`;
}

function card(t) {
	const badge =
		t.trang_thai === "Hoàn thành"
			? '<span class="vc-badge vc-badge-success">Hoàn thành</span>'
			: '<span class="vc-badge vc-badge-primary">Đang giao</span>';
	return `
		<a class="vc-order-card vc-selectable" href="#/chuyen/${encodeURIComponent(t.name)}">
			<div class="vc-order-head">
				<div>
					<div class="vc-order-cust">${escapeHtml(t.name)}</div>
					<div class="vc-order-addr">${escapeHtml(formatDate(t.ngay_giao))} · ${escapeHtml(t.xe || "")}</div>
				</div>
				${badge}
			</div>
			<div class="vc-order-meta">
				<span class="vc-chip"><i class="fas fa-map-marker-alt"></i> ${t.stops_giao}/${t.stops_total} điểm đã giao</span>
				${Number(t.tong_cuoc) > 0 ? `<span class="vc-chip vc-chip-accent">💵 ${formatCurrency(t.tong_cuoc)}</span>` : ""}
				<i class="fas fa-chevron-right vc-text-muted" style="margin-left:auto"></i>
			</div>
		</a>`;
}

function empty(icon, title, sub) {
	return `<div class="vc-empty"><div class="vc-empty-icon">${icon}</div>
		<div class="vc-empty-title">${escapeHtml(title)}</div>
		${sub ? `<p class="vc-text-muted">${escapeHtml(sub)}</p>` : ""}</div>`;
}
