// #/chuyen — Lái Xe: danh sách chuyến của tôi (mobile-first). Không có số tiền.
// Kèm khối "Lấy hàng thu hồi": lô siêu thị trả hàng mà điều phối giao cho tôi.
import { call, upload, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate, formatCurrency, formatQty } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { resizeImage } from "../lib/anh.js";

let ROOT = null;

export async function render({ container }) {
	ROOT = container;
	container.innerHTML = skeleton(90, 3);
	// Hai nguồn nạp SONG SONG và hỏng ĐỘC LẬP: khối thu hồi lỗi (site chưa migrate bản
	// mới chẳng hạn) không được làm mất danh sách chuyến — đó là việc chính của lái xe.
	const [rt, rp] = await Promise.allSettled([
		call("vanchuyen.api.lai_xe.get_my_trips"),
		call("vanchuyen.api.thu_hoi.cua_toi"),
	]);
	if (rt.status === "rejected") {
		container.innerHTML = empty("⚠️", "Không tải được chuyến", errText(rt.reason));
		return;
	}
	const trips = rt.value || [];
	const pickups = rp.status === "fulfilled" ? rp.value || [] : [];
	if (!trips.length && !pickups.length) {
		container.innerHTML = empty("📭", "Chưa có chuyến nào hôm nay", "Chuyến sẽ hiện khi điều phối phân công.");
		return;
	}
	const choLay = pickups.filter((p) => p.trang_thai === "Tạo yêu cầu").length;
	container.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Chuyến của tôi</div>
				<div class="vc-view-banner-subtitle">${trips.length} chuyến hôm nay${choLay ? ` · ${choLay} điểm lấy hàng trả` : ""}</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-truck"></i></div>
		</div>
		${pickups.length ? `<div class="vc-section-title">Lấy hàng thu hồi</div>
			<div class="vc-list vc-mb-3" id="vc-pickups">${pickups.map(pickupCard).join("")}</div>` : ""}
		${trips.length ? `<div class="vc-section-title">Chuyến giao hàng</div><div class="vc-list">${trips.map(card).join("")}</div>` : ""}`;
	bindPickups(pickups);
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

function pickupCard(p) {
	const daLay = p.trang_thai === "Đã lấy hàng";
	const map = p.dia_chi ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.dia_chi)}` : "";
	const tel = (p.sdt_lien_he || p.sdt_diem || "").replace(/[^\d+]/g, "");
	const hang = (p.items || []).map((i) => `${escapeHtml(i.item_name)}: ${formatQty(i.qty)} ${escapeHtml(i.uom || "")}`).join(" · ");
	return `
	<div class="vc-stop-card ${daLay ? "done" : ""}" data-lo="${escapeHtml(p.name)}">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">🏬 ${escapeHtml(p.ten_diem || p.customer_name || p.name)}</div>
				<div class="vc-order-addr">${escapeHtml(p.customer_name || "")}${p.so_phieu_sieu_thi ? " · phiếu " + escapeHtml(p.so_phieu_sieu_thi) : ""}</div>
			</div>
			<span class="vc-badge ${daLay ? "vc-badge-success" : "vc-badge-warning"}">${daLay ? "Đã lấy" : "Chờ lấy"}</span>
		</div>
		${map ? `<a class="vc-stop-addr" href="${map}" target="_blank" rel="noopener">📍 ${escapeHtml(p.dia_chi)}</a>` : ""}
		<div class="vc-text-sm vc-mt-1">${p.ngay_hen_lay ? "📅 hẹn " + escapeHtml(formatDate(p.ngay_hen_lay)) : "📅 yêu cầu " + escapeHtml(formatDate(p.ngay_yeu_cau))}${
			Number(p.so_kien_du_kien) > 0 ? ` · 📦 ~${formatQty(p.so_kien_du_kien)} kiện` : ""}</div>
		${p.nguoi_lien_he || tel ? `<div class="vc-text-sm vc-mt-1">👤 ${escapeHtml(p.nguoi_lien_he || "")}${tel ? ` <a href="tel:${escapeHtml(tel)}">☎ ${escapeHtml(p.sdt_lien_he || p.sdt_diem)}</a>` : ""}</div>` : ""}
		${hang ? `<div class="vc-text-sm vc-text-muted vc-mt-1">${hang}</div>` : ""}
		${p.ghi_chu ? `<div class="vc-order-note vc-mt-1">${escapeHtml(p.ghi_chu)}</div>` : ""}
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">
			<label class="vc-photo-btn"><i class="fas fa-camera"></i> Chứng từ <span class="vc-photo-badge" data-n>${Number(p.so_dinh_kem) || 0}</span>
				<input type="file" accept="image/*" capture="environment" data-photo style="display:none" /></label>
			${daLay
				? `<button class="vc-btn-ghost" data-huy><i class="fas fa-rotate-left"></i> Bấm nhầm — chưa lấy</button>`
				: `<button class="vc-btn-success" data-lay style="flex:1"><i class="fas fa-check"></i> Đã lấy hàng</button>`}
		</div>
	</div>`;
}

function bindPickups(pickups) {
	const box = ROOT.querySelector("#vc-pickups");
	if (!box) return;
	box.querySelectorAll("[data-lo]").forEach((el) => {
		const name = el.dataset.lo;
		const lay = el.querySelector("[data-lay]");
		const huy = el.querySelector("[data-huy]");
		const photo = el.querySelector("[data-photo]");
		if (lay) lay.addEventListener("click", () => doiLay(name, 0, lay));
		if (huy) huy.addEventListener("click", () => doiLay(name, 1, huy));
		if (photo)
			photo.addEventListener("change", async () => {
				const f = photo.files && photo.files[0];
				photo.value = "";
				if (!f) return;
				try {
					const blob = await resizeImage(f, 1200, 0.8);
					const r = await upload(
						"vanchuyen.api.thu_hoi.lai_xe_upload",
						new File([blob], "lay-hang.jpg", { type: "image/jpeg" }),
						{ name }
					);
					const n = el.querySelector("[data-n]");
					if (n) n.textContent = r.so_dinh_kem;
					showToast("Đã lưu ảnh chứng từ", "success");
				} catch (e) {
					showToast(errText(e), "error");
				}
			});
	});
}

async function doiLay(name, huy, btn) {
	btn.disabled = true;
	try {
		await call("vanchuyen.api.thu_hoi.lai_xe_da_lay", { name, huy });
		showToast(huy ? "Đã hoàn tác" : "Đã lấy hàng — mang về kho", "success");
		await render({ container: ROOT });
	} catch (e) {
		btn.disabled = false;
		showToast(errText(e), "error");
	}
}

function empty(icon, title, sub) {
	return `<div class="vc-empty"><div class="vc-empty-icon">${icon}</div>
		<div class="vc-empty-title">${escapeHtml(title)}</div>
		${sub ? `<p class="vc-text-muted">${escapeHtml(sub)}</p>` : ""}</div>`;
}
