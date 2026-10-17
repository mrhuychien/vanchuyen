// #/thu-hoi — THU HỒI HÀNG (điều hành + tổ trưởng). Siêu thị xuất trả → xe vào lấy →
// nhận về kho; từ đó kế toán tiếp nối (kiểm hàng → nhập chứng từ → xong) và CHẶNG TỔNG
// hiện luôn ở đây, đọc từ phiếu kiểm bên app kế toán.
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate, formatQty } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { CHANG_FALLBACK, changBadge, changBar } from "../components/thu-hoi-ui.js";

const S = { chang: "dang_mo", tim: "", page: 1, data: { rows: [], counts: {} } };

export async function render({ container, query }) {
	if (query && query.chang) S.chang = query.chang;
	container.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Thu hồi hàng</div>
				<div class="vc-view-banner-subtitle">Siêu thị xuất trả → xe vào lấy → nhận về kho → kế toán kiểm &amp; lập hóa đơn trả về</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-rotate-left"></i></div>
		</div>
		<a class="vc-btn-primary vc-btn-block vc-mb-3" href="#/thu-hoi/new"><i class="fas fa-plus"></i> Tạo yêu cầu xuất trả</a>
		<div class="vc-filters vc-mb-2">
			<input class="vc-input" id="th-search" type="search" autocomplete="off"
				placeholder="🔍 Tìm khách / điểm / số phiếu siêu thị / lái xe..." value="${escapeHtml(S.tim)}" />
		</div>
		<div id="th-pills" class="vc-pill-nav"></div>
		<div id="th-list">${skeleton(110, 3)}</div>`;

	let t = null;
	container.querySelector("#th-search").addEventListener("input", (e) => {
		clearTimeout(t);
		t = setTimeout(() => {
			S.tim = e.target.value.trim();
			S.page = 1;
			load(container);
		}, 300);
	});
	S.page = 1;
	await load(container);
}

async function load(container) {
	const list = container.querySelector("#th-list");
	if (S.page === 1) list.innerHTML = skeleton(110, 3);
	try {
		const res = await call("vanchuyen.api.thu_hoi.list_lo", {
			chang: S.chang,
			tim: S.tim || undefined,
			page: S.page,
			page_size: 30,
		});
		// Trang > 1 NỐI THÊM (cùng lý do với #/su-co: bấm "Xem tiếp" mà mất 30 dòng đầu
		// là người dùng tưởng dữ liệu hỏng).
		if (S.page > 1) res.rows = (S.data.rows || []).concat(res.rows || []);
		S.data = res;
	} catch (e) {
		list.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div><div class="vc-empty-title">Không tải được</div><p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	drawPills(container);
	drawList(container);
}

function drawPills(container) {
	const c = S.data.counts || {};
	const ds = S.data.chang_list || CHANG_FALLBACK;
	const tong = ds.reduce((a, k) => a + (c[k] || 0), 0);
	const mo = tong - (c["Xong"] || 0);
	const pill = (key, label, n) =>
		`<button class="${S.chang === key ? "vc-active" : ""}" data-f="${escapeHtml(key)}">${escapeHtml(label)} (${n})</button>`;
	const box = container.querySelector("#th-pills");
	box.innerHTML =
		pill("dang_mo", "Đang mở", mo) +
		ds.map((k) => pill(k, k, c[k] || 0)).join("") +
		pill("tat_ca", "Tất cả", tong);
	box.querySelectorAll("[data-f]").forEach((b) =>
		b.addEventListener("click", () => {
			S.chang = b.dataset.f;
			S.page = 1;
			load(container);
		})
	);
}

function drawList(container) {
	const rows = S.data.rows || [];
	const list = container.querySelector("#th-list");
	if (!rows.length) {
		list.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">📭</div>
			<div class="vc-empty-title">Không có lô thu hồi nào${S.chang === "dang_mo" ? " đang mở" : ""}</div>
			<p class="vc-text-muted">Siêu thị gửi phiếu xuất trả thì bấm "Tạo yêu cầu xuất trả" ở trên.</p></div>`;
		return;
	}
	const more = S.data.has_more
		? `<button class="vc-btn-ghost vc-btn-block vc-mt-2" id="th-more">Xem tiếp (đã hiện ${rows.length}/${S.data.total})</button>`
		: "";
	list.innerHTML = `<div class="vc-list">${rows.map(card).join("")}</div>${more}`;
	list.querySelectorAll("[data-tien]").forEach((b) =>
		b.addEventListener("click", () => tienChang(container, b.dataset.lo, b.dataset.tien, b))
	);
	const mb = list.querySelector("#th-more");
	if (mb)
		mb.addEventListener("click", () => {
			S.page += 1;
			load(container);
		});
}

function card(r) {
	const ds = S.data.chang_list || CHANG_FALLBACK;
	const giao = [r.ten_lai_xe ? "🚚 " + escapeHtml(r.ten_lai_xe) : "🚚 chưa giao xe", r.xe ? escapeHtml(r.xe) : "",
		r.ngay_hen_lay ? "hẹn " + escapeHtml(formatDate(r.ngay_hen_lay)) : ""].filter(Boolean).join(" · ");
	const kien = r.so_kien_nhan
		? `📦 nhận ${formatQty(r.so_kien_nhan)}${r.so_kien_du_kien ? "/" + formatQty(r.so_kien_du_kien) : ""} kiện`
		: r.so_kien_du_kien ? `📦 dự kiến ${formatQty(r.so_kien_du_kien)} kiện` : "";
	// Nút tiến chặng nhanh chỉ cho ba chặng của vận chuyển; từ "Đã nhận hàng" là việc
	// của kế toán, ở đây chỉ xem.
	let tien = "";
	if (r.chang === "Tạo yêu cầu")
		tien = `<button class="vc-btn-success" data-lo="${escapeHtml(r.name)}" data-tien="Đã lấy hàng"><i class="fas fa-check"></i> Đã lấy hàng</button>`;
	else if (r.chang === "Đã lấy hàng")
		tien = `<button class="vc-btn-success" data-lo="${escapeHtml(r.name)}" data-tien="Đã nhận hàng"><i class="fas fa-warehouse"></i> Đã nhận hàng</button>`;
	const tuoi = r.tuoi != null && r.tuoi > 0 ? ` · <b class="${r.tuoi > 7 ? "vc-text-danger" : ""}">${r.tuoi} ngày</b>` : "";
	return `
	<div class="vc-order-card">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">🏬 ${escapeHtml(r.ten_diem || r.customer_name || r.name)}</div>
				<div class="vc-order-addr">${escapeHtml(r.customer_name || "")}${r.ma_diem ? " · " + escapeHtml(r.ma_diem) : ""}${r.so_phieu_sieu_thi ? " · phiếu " + escapeHtml(r.so_phieu_sieu_thi) : ""}</div>
			</div>
			${changBadge(r.chang, ds)}
		</div>
		${changBar(r.chang, ds)}
		${r.dia_chi ? `<div class="vc-text-sm vc-text-muted vc-mt-1">📍 ${escapeHtml(r.dia_chi)}</div>` : ""}
		<div class="vc-text-sm vc-mt-1">📅 ${escapeHtml(formatDate(r.ngay_yeu_cau))}${tuoi} · ${escapeHtml(r.name)}${r.ly_do ? " · " + escapeHtml(r.ly_do) : ""}</div>
		<div class="vc-text-sm vc-text-muted vc-mt-1">${giao}</div>
		<div class="vc-order-meta">
			${kien ? `<span class="vc-chip">${kien}</span>` : ""}
			${Number(r.tong_sl_khai) > 0 ? `<span class="vc-chip">khai ${formatQty(r.tong_sl_khai)} (ĐVT kho)</span>` : ""}
			<span class="vc-chip">📎 ${Number(r.so_dinh_kem) || 0} file</span>
		</div>
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">
			<a class="vc-btn-primary" href="#/thu-hoi/${encodeURIComponent(r.name)}"><i class="fas fa-pen"></i> Chi tiết</a>
			${tien}
		</div>
	</div>`;
}

async function tienChang(container, lo, chang, btn) {
	let soKien;
	if (chang === "Đã nhận hàng") {
		// Đếm kiện lúc hàng xuống xe là việc của người đứng ở kho, ngay lúc đó — để trống
		// cũng được, nhưng hỏi thì người ta mới đếm.
		const v = window.prompt("Số kiện thực nhận (để trống nếu chưa đếm):", "");
		if (v === null) return;
		soKien = v.trim() === "" ? undefined : Number(v.replace(",", "."));
		if (soKien !== undefined && !(soKien >= 0)) {
			showToast("Số kiện không hợp lệ", "warning");
			return;
		}
	}
	btn.disabled = true;
	try {
		await call("vanchuyen.api.thu_hoi.chuyen_chang", { name: lo, trang_thai: chang, so_kien_nhan: soKien });
		showToast(`${lo}: ${chang}`, "success");
		S.page = 1;
		await load(container);
	} catch (e) {
		btn.disabled = false;
		showToast(errText(e), "error");
	}
}
