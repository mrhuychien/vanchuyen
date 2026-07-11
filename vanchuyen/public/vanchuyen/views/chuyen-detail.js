// #/chuyen/:id — Lái Xe: quản lý từng điểm giao. Optimistic UI + toast lỗi & retry.
import { call, upload, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate, formatQty, formatM3 } from "../lib/format.js";
import { showToast } from "../components/toast.js";

let TRIP = null;

export async function render({ container, params }) {
	container.innerHTML = skeleton(120, 3);
	let trips;
	try {
		trips = await call("vanchuyen.api.lai_xe.get_my_trips");
	} catch (e) {
		container.innerHTML = errBox(errText(e));
		return;
	}
	TRIP = (trips || []).find((t) => t.name === params.id);
	if (!TRIP) {
		container.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">📭</div>
			<div class="vc-empty-title">Không tìm thấy chuyến</div>
			<p class="vc-text-muted">Chuyến có thể đã hoàn thành trước hôm nay.</p></div>`;
		return;
	}
	draw(container);
}

function banner() {
	return `<div class="vc-view-banner">
		<div>
			<div class="vc-view-banner-title">${escapeHtml(TRIP.name)}</div>
			<div class="vc-view-banner-subtitle">${escapeHtml(formatDate(TRIP.ngay_giao))} · ${escapeHtml(TRIP.xe || "")}</div>
		</div>
		<div class="vc-view-banner-badge" id="vc-prog">${TRIP.stops_giao}/${TRIP.stops_total} điểm</div>
	</div>`;
}

function statusClass(s) {
	return s === "Đã giao" ? "done" : s === "Khách hẹn" ? "hen" : s === "Hoàn" ? "hoan" : "";
}

function stopCard(s) {
	const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s.dia_chi || "");
	return `
	<div class="vc-stop-card ${statusClass(s.trang_thai_giao)}${s.trang_thai_giao === "Đã giao" && (s.so_chung_tu || 0) > 0 ? " has-proof" : ""}" data-row="${escapeHtml(s.row_name)}">
		<div class="vc-order-cust">${escapeHtml(s.khach_hang || "")}</div>
		<div class="vc-stop-state" data-state>${stateLabel(s)}</div>
		<a class="vc-stop-addr" href="${mapUrl}" target="_blank" rel="noopener">
			<i class="fas fa-map-marker-alt"></i> ${escapeHtml(s.dia_chi || "(chưa có địa chỉ)")}</a>
		<div class="vc-order-meta">
			${s.so_po ? `<span class="vc-chip">PO ${escapeHtml(s.so_po)}</span>` : ""}
			<span class="vc-chip">${formatQty(s.so_kien)} kiện</span>
			<span class="vc-chip">${formatM3(s.the_tich)} m³</span>
			${s.hop_le ? `<span class="vc-chip">${formatQty(s.hop_le)} hộp lẻ</span>` : ""}
		</div>
		<div class="vc-status-btns">
			<button class="vc-status-btn done ${s.trang_thai_giao === "Đã giao" ? "active" : ""}" data-st="Đã giao">Đã giao</button>
			<button class="vc-status-btn hen ${s.trang_thai_giao === "Khách hẹn" ? "active" : ""}" data-st="Khách hẹn">Khách hẹn</button>
			<button class="vc-status-btn hoan ${s.trang_thai_giao === "Hoàn" ? "active" : ""}" data-st="Hoàn">Hoàn</button>
		</div>
		<div class="vc-photo-row">
			<label class="vc-photo-btn"><i class="fas fa-camera"></i> Chụp CT
				<span class="vc-photo-badge" data-badge>${s.so_chung_tu || 0}</span>
				<input type="file" accept="image/*" capture="environment" data-photo style="display:none" />
			</label>
			<input class="vc-input" style="flex:1" placeholder="Ghi chú giao hàng" value="${escapeHtml(s.ghi_chu || "")}" data-note />
		</div>
	</div>`;
}

function draw(container) {
	container.innerHTML = banner() + `<div id="vc-stops">${TRIP.stops.map(stopCard).join("")}</div>`;
	container.querySelectorAll(".vc-stop-card").forEach(bindCard);
}

function refreshProgress() {
	TRIP.stops_giao = TRIP.stops.filter((s) => s.trang_thai_giao === "Đã giao").length;
	const p = document.getElementById("vc-prog");
	if (p) p.textContent = `${TRIP.stops_giao}/${TRIP.stops_total} điểm`;
}

function stateLabel(s) {
	const proof = (s.so_chung_tu || 0) > 0;
	if (s.trang_thai_giao === "Đã giao") return proof ? "✅ Đã giao hàng, chụp chứng từ" : "✅ Đã giao";
	if (s.trang_thai_giao === "Khách hẹn") return "🕐 Khách hẹn";
	if (s.trang_thai_giao === "Hoàn") return "↩️ Hoàn";
	return "⏳ Chờ giao";
}

// Đồng bộ toàn bộ hiển thị thẻ theo trạng thái + có chứng từ (đọc từ stop, không truyền lẻ).
function applyCardVisual(cardEl, stop) {
	cardEl.classList.remove("done", "hen", "hoan", "has-proof");
	const c = statusClass(stop.trang_thai_giao);
	if (c) cardEl.classList.add(c);
	if (stop.trang_thai_giao === "Đã giao" && (stop.so_chung_tu || 0) > 0) cardEl.classList.add("has-proof");
	cardEl.querySelectorAll(".vc-status-btn").forEach((b) => b.classList.toggle("active", b.dataset.st === stop.trang_thai_giao));
	const stateEl = cardEl.querySelector("[data-state]");
	if (stateEl) stateEl.textContent = stateLabel(stop);
}

function bindCard(cardEl) {
	const rowName = cardEl.dataset.row;
	const stop = TRIP.stops.find((s) => s.row_name === rowName);

	cardEl.querySelectorAll(".vc-status-btn").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const prev = stop.trang_thai_giao;
			// Chạm lại trạng thái đang active → về 'Chờ giao'.
			const target = prev === btn.dataset.st ? "Chờ giao" : btn.dataset.st;
			stop.trang_thai_giao = target;
			applyCardVisual(cardEl, stop);
			refreshProgress();
			try {
				await call("vanchuyen.api.lai_xe.update_stop_status", {
					trip: TRIP.name,
					row_name: rowName,
					trang_thai: target,
				});
				showToast("Đã cập nhật", "success");
			} catch (e) {
				stop.trang_thai_giao = prev;
				applyCardVisual(cardEl, stop);
				refreshProgress();
				showToast(errText(e) + " — thử lại", "error");
			}
		});
	});

	const photo = cardEl.querySelector("[data-photo]");
	const badge = cardEl.querySelector("[data-badge]");
	photo.addEventListener("change", () => handlePhoto(photo, rowName, badge, stop));

	const note = cardEl.querySelector("[data-note]");
	note.addEventListener("change", async () => {
		try {
			await call("vanchuyen.api.lai_xe.update_stop_status", {
				trip: TRIP.name,
				row_name: rowName,
				trang_thai: stop.trang_thai_giao,
				ghi_chu: note.value,
			});
			stop.ghi_chu = note.value;
			showToast("Đã lưu ghi chú", "success");
		} catch (e) {
			showToast(errText(e), "error");
		}
	});
}

async function handlePhoto(input, rowName, badge, stop) {
	const file = input.files && input.files[0];
	if (!file) return;
	try {
		const blob = await resizeImage(file, 1200, 0.8);
		const res = await upload(
			"vanchuyen.api.lai_xe.upload_chung_tu",
			new File([blob], "chungtu.jpg", { type: "image/jpeg" }),
			{ trip: TRIP.name, row_name: rowName }
		);
		badge.textContent = res.so_chung_tu;
		stop.so_chung_tu = res.so_chung_tu;
		// Up chứng từ xong → TỰ đánh dấu 'Đã giao' → reconcile ghi SI 'Đã giao hàng, chụp chứng từ'.
		if (stop.trang_thai_giao !== "Đã giao") {
			await call("vanchuyen.api.lai_xe.update_stop_status", {
				trip: TRIP.name,
				row_name: rowName,
				trang_thai: "Đã giao",
			});
			stop.trang_thai_giao = "Đã giao";
			refreshProgress();
		}
		const cardEl = input.closest(".vc-stop-card");
		if (cardEl) applyCardVisual(cardEl, stop);
		showToast("Đã giao hàng + lưu chứng từ", "success");
	} catch (e) {
		showToast(errText(e), "error");
	}
	input.value = "";
}

// Resize canvas max 1200px + JPEG q≈0.8 TRƯỚC khi upload (lái xe vùng sóng yếu).
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

function errBox(msg) {
	return `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
		<div class="vc-empty-title">Không tải được chuyến</div>
		<p class="vc-text-muted">${escapeHtml(msg)}</p></div>`;
}
