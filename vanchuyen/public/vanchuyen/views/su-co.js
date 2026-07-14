// #/su-co — SỰ CỐ VẬN CHUYỂN (điều hành). Đơn giao qua đơn vị VC bị hoàn / giao một
// phần / hư hỏng / chờ chứng từ... Ghi nhận + theo dõi tiến trình; backlog ngược về SI.
import { call, upload, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml, formatDate, formatCurrency } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { showModal, closeModal } from "../components/modal.js";

const LOAI = ["Hoàn hàng", "Giao một phần", "Hư hỏng, móp méo", "Chờ xử lý chứng từ", "Chậm, thất lạc", "Khách từ chối, sai địa chỉ", "Khác"];
const TRANG_THAI = ["Mới", "Đang xử lý", "Đã xử lý", "Đóng"];
const HUONG = ["", "Giao lại", "Hoàn toàn bộ", "Giao một phần", "Bồi thường", "Giảm trừ công nợ", "Hủy đơn", "Khác"];
const LOAI_ICON = {
	"Hoàn hàng": "↩️", "Giao một phần": "📦", "Hư hỏng, móp méo": "💥",
	"Chờ xử lý chứng từ": "📄", "Chậm, thất lạc": "🐢", "Khách từ chối, sai địa chỉ": "🚫", "Khác": "❔",
};
function ttBadge(tt) {
	const c = tt === "Mới" ? "vc-badge-danger" : tt === "Đang xử lý" ? "vc-badge-warning" : "vc-badge-success";
	return `<span class="vc-badge ${c}">${escapeHtml(tt)}</span>`;
}

let ROOT = null;
const S = { filter: "open", tim: "", data: { rows: [], counts: {} }, selSi: null };

export async function render({ container }) {
	ROOT = container;
	container.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Sự cố vận chuyển</div>
				<div class="vc-view-banner-subtitle">Đơn giao qua đơn vị VC bị hoàn / một phần / hư hỏng...</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-triangle-exclamation"></i></div>
		</div>
		<button class="vc-btn-primary vc-btn-block vc-mb-3" id="sc-add"><i class="fas fa-plus"></i> Ghi nhận sự cố mới</button>
		<div class="vc-filters vc-mb-2">
			<input class="vc-input" id="sc-search" placeholder="🔍 Tìm đơn / khách / PO..." />
		</div>
		<div id="sc-pills" class="vc-flex vc-gap-2 vc-mb-3" style="flex-wrap:wrap"></div>
		<div id="sc-list">${skeleton(90, 3)}</div>`;

	document.getElementById("sc-add").addEventListener("click", openCreate);
	let t = null;
	document.getElementById("sc-search").addEventListener("input", (e) => {
		clearTimeout(t);
		t = setTimeout(() => {
			S.tim = e.target.value.trim();
			load();
		}, 300);
	});
	await load();
}

function pill(label, key, n) {
	return `<button class="vc-chip ${S.filter === key ? "vc-chip-accent" : ""}" data-f="${key}">${escapeHtml(label)}${n != null ? ` (${n})` : ""}</button>`;
}

async function load() {
	const list = document.getElementById("sc-list");
	list.innerHTML = skeleton(90, 3);
	const args = { tim: S.tim || undefined };
	if (S.filter !== "all" && S.filter !== "open") args.trang_thai = S.filter;
	try {
		S.data = await call("vanchuyen.api.su_co.list_issues", args);
	} catch (e) {
		list.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div><div class="vc-empty-title">Không tải được</div><p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	drawPills();
	drawList();
}

function drawPills() {
	const c = S.data.counts || {};
	const open = (c["Mới"] || 0) + (c["Đang xử lý"] || 0);
	const total = TRANG_THAI.reduce((a, k) => a + (c[k] || 0), 0);
	const box = document.getElementById("sc-pills");
	box.innerHTML =
		pill("Đang mở", "open", open) +
		pill("Tất cả", "all", total) +
		TRANG_THAI.map((k) => pill(k, k, c[k] || 0)).join("");
	box.querySelectorAll("[data-f]").forEach((b) =>
		b.addEventListener("click", () => {
			S.filter = b.dataset.f;
			load();
		})
	);
}

function drawList() {
	let rows = S.data.rows || [];
	if (S.filter === "open") rows = rows.filter((r) => r.trang_thai === "Mới" || r.trang_thai === "Đang xử lý");
	const list = document.getElementById("sc-list");
	if (!rows.length) {
		list.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">✅</div><div class="vc-empty-title">Không có sự cố${S.filter === "open" ? " đang mở" : ""}</div></div>`;
		return;
	}
	list.innerHTML = `<div class="vc-list">${rows.map(card).join("")}</div>`;
	list.querySelectorAll("[data-upd]").forEach((b) => b.addEventListener("click", () => openUpdate(b.dataset.upd)));
}

function card(r) {
	const anh = r.dinh_kem ? `<img src="${escapeHtml(r.dinh_kem)}" alt="" style="width:100%;max-height:150px;object-fit:cover;border-radius:8px;margin-top:.4rem" loading="lazy" />` : "";
	const meta = [
		r.so_kien_anh_huong ? `${r.so_kien_anh_huong} kiện` : "",
		r.gia_tri_anh_huong ? formatCurrency(r.gia_tri_anh_huong) : "",
		r.huong_xu_ly ? "→ " + escapeHtml(r.huong_xu_ly) : "",
	].filter(Boolean).join(" · ");
	return `
	<div class="vc-order-card">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${LOAI_ICON[r.loai_su_co] || "❔"} ${escapeHtml(r.loai_su_co)} — ${escapeHtml(r.customer || "")}</div>
				<div class="vc-order-addr">${escapeHtml(r.sales_invoice)} · ${escapeHtml(r.hinh_thuc || "")}${r.po ? " · PO " + escapeHtml(r.po) : ""}</div>
			</div>
			${ttBadge(r.trang_thai)}
		</div>
		${r.mo_ta ? `<div class="vc-text-sm vc-mt-2">${escapeHtml(r.mo_ta)}</div>` : ""}
		${meta ? `<div class="vc-text-sm vc-text-muted vc-mt-1">${meta}</div>` : ""}
		${anh}
		<div class="vc-text-sm vc-text-muted vc-mt-1">📅 ${escapeHtml(formatDate(r.ngay_phat_sinh))}${r.nguoi_phu_trach ? " · " + escapeHtml(r.nguoi_phu_trach) : ""}</div>
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">
			<button class="vc-btn-primary" data-upd="${escapeHtml(r.name)}"><i class="fas fa-pen"></i> Cập nhật</button>
			<a class="vc-btn-ghost" href="/app/sales-invoice/${encodeURIComponent(r.sales_invoice)}" target="_blank">Mở đơn</a>
		</div>
	</div>`;
}

// ── Tạo mới ──────────────────────────────────────────────────────────────────
function openCreate() {
	S.selSi = null;
	const loaiOpts = LOAI.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
	const body = `
		<div class="vc-field"><label>Tìm đơn (giao qua đơn vị VC)</label>
			<input class="vc-input" id="sc-si-q" placeholder="Mã đơn / khách / PO..." autocomplete="off" /></div>
		<div id="sc-si-res" class="vc-mb-2"></div>
		<div id="sc-si-chosen" class="vc-mb-2"></div>
		<div class="vc-field"><label>Loại sự cố *</label><select class="vc-input" id="sc-loai">${loaiOpts}</select></div>
		<div class="vc-flex vc-gap-2" style="flex-wrap:wrap">
			<div class="vc-field" style="flex:1;min-width:120px"><label>Số kiện ảnh hưởng</label><input class="vc-input" id="sc-kien" type="number" min="0" step="1" /></div>
			<div class="vc-field" style="flex:1;min-width:120px"><label>Giá trị ảnh hưởng</label><input class="vc-input" id="sc-gt" type="number" min="0" step="1000" /></div>
		</div>
		<div class="vc-field"><label>Mô tả</label><textarea class="vc-input" id="sc-mota" style="min-height:56px" placeholder="Diễn biến sự cố..."></textarea></div>
		<div class="vc-field"><label>Người phụ trách</label><input class="vc-input" id="sc-npt" placeholder="Tên người xử lý" /></div>`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Hủy</button><button class="vc-btn-primary" id="sc-save">Tạo sự cố</button>`;
	const content = showModal({ title: "Ghi nhận sự cố", body, footer });
	if (!content) return;
	const q = (id) => content.querySelector("#" + id);

	let tt = null;
	q("sc-si-q").addEventListener("input", (e) => {
		clearTimeout(tt);
		tt = setTimeout(async () => {
			const v = e.target.value.trim();
			if (!v) { q("sc-si-res").innerHTML = ""; return; }
			try {
				const rows = await call("vanchuyen.api.su_co.search_carrier_invoices", { tim: v });
				q("sc-si-res").innerHTML = rows.length
					? rows.map((r) => `<div class="vc-order-card" style="padding:.5rem .6rem;cursor:pointer" data-pick='${escapeHtml(JSON.stringify(r))}'>
						<div class="vc-font-bold vc-text-sm">${escapeHtml(r.name)}${r.co_su_co ? ' <span class="vc-badge vc-badge-warning">có sự cố</span>' : ""}</div>
						<div class="vc-text-sm vc-text-muted">${escapeHtml(r.customer || "")} · ${escapeHtml(r.hinh_thuc || "")}${r.po ? " · PO " + escapeHtml(r.po) : ""}</div></div>`).join("")
					: '<div class="vc-text-sm vc-text-muted">Không tìm thấy đơn giao qua đơn vị VC.</div>';
				q("sc-si-res").querySelectorAll("[data-pick]").forEach((el) =>
					el.addEventListener("click", () => {
						S.selSi = JSON.parse(el.dataset.pick);
						q("sc-si-res").innerHTML = "";
						q("sc-si-q").value = "";
						q("sc-si-chosen").innerHTML = `<div class="vc-badge vc-badge-primary">✓ ${escapeHtml(S.selSi.name)} — ${escapeHtml(S.selSi.customer || "")}</div>`;
					})
				);
			} catch (err) {
				showToast(errText(err), "error");
			}
		}, 300);
	});

	q("sc-save").addEventListener("click", async () => {
		if (!S.selSi) { showToast("Chọn đơn hàng trước", "warning"); return; }
		const payload = {
			sales_invoice: S.selSi.name,
			loai_su_co: q("sc-loai").value,
			so_kien_anh_huong: Number(q("sc-kien").value) || 0,
			gia_tri_anh_huong: Number(q("sc-gt").value) || 0,
			mo_ta: q("sc-mota").value.trim(),
			nguoi_phu_trach: q("sc-npt").value.trim(),
			trang_thai: "Mới",
		};
		const btn = q("sc-save");
		btn.disabled = true;
		try {
			await call("vanchuyen.api.su_co.create_issue", { payload: JSON.stringify(payload) });
			showToast("Đã ghi nhận sự cố", "success");
			closeModal();
			await load();
		} catch (e) {
			btn.disabled = false;
			showToast(errText(e), "error");
		}
	});
}

// ── Cập nhật ─────────────────────────────────────────────────────────────────
async function openUpdate(name) {
	let d;
	try {
		d = await call("vanchuyen.api.su_co.get_issue", { name });
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	const ttOpts = TRANG_THAI.map((t) => `<option value="${escapeHtml(t)}" ${t === d.trang_thai ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");
	const hOpts = HUONG.map((h) => `<option value="${escapeHtml(h)}" ${h === (d.huong_xu_ly || "") ? "selected" : ""}>${h ? escapeHtml(h) : "— chưa chọn —"}</option>`).join("");
	const body = `
		<div class="vc-text-sm vc-text-muted vc-mb-2">${escapeHtml(d.sales_invoice)} · ${escapeHtml(d.customer || "")} · ${escapeHtml(d.loai_su_co)}</div>
		<div class="vc-field"><label>Trạng thái xử lý</label><select class="vc-input" id="su-tt">${ttOpts}</select></div>
		<div class="vc-field"><label>Hướng xử lý</label><select class="vc-input" id="su-h">${hOpts}</select></div>
		<div class="vc-field"><label>Ghi chú xử lý</label><textarea class="vc-input" id="su-gc" style="min-height:56px">${escapeHtml(d.ghi_chu_xu_ly || "")}</textarea></div>
		<div class="vc-field"><label>Người phụ trách</label><input class="vc-input" id="su-npt" value="${escapeHtml(d.nguoi_phu_trach || "")}" /></div>
		<div class="vc-field"><label>Đính kèm biên bản/ảnh</label><input type="file" id="su-file" accept="image/*" /></div>
		${d.dinh_kem ? `<img src="${escapeHtml(d.dinh_kem)}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px" />` : ""}`;
	const footer = `<button class="vc-btn-ghost" data-vc-close>Đóng</button><button class="vc-btn-primary" id="su-save">Lưu</button>`;
	const content = showModal({ title: "Cập nhật sự cố", body, footer });
	if (!content) return;
	const q = (id) => content.querySelector("#" + id);
	q("su-save").addEventListener("click", async () => {
		const btn = q("su-save");
		btn.disabled = true;
		try {
			const file = q("su-file").files[0];
			if (file) await upload("vanchuyen.api.su_co.upload_dinh_kem", file, { su_co: name });
			await call("vanchuyen.api.su_co.update_issue", {
				name,
				payload: JSON.stringify({
					trang_thai: q("su-tt").value,
					huong_xu_ly: q("su-h").value,
					ghi_chu_xu_ly: q("su-gc").value.trim(),
					nguoi_phu_trach: q("su-npt").value.trim(),
				}),
			});
			showToast("Đã cập nhật sự cố", "success");
			closeModal();
			await load();
		} catch (e) {
			btn.disabled = false;
			showToast(errText(e), "error");
		}
	});
}
