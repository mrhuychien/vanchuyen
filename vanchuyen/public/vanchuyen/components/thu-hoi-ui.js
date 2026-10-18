// Mảnh giao diện dùng chung của THU HỒI HÀNG: huy hiệu chặng + thanh 7 nấc.
// Nằm ở components/ (có trong import map) chứ không export từ một view: view import
// view khác theo đường tương đối là ăn bản cache cũ của /assets (Luật vàng #1).
import { escapeHtml } from "../lib/format.js";

// Fallback khi server cũ chưa trả `chang_list` — nguồn thật là lo_thu_hoi.CHANG.
export const CHANG_FALLBACK = ["Tạo yêu cầu", "Đã lấy hàng", "Đã nhận hàng", "Đang kiểm", "Đã kiểm hàng", "Đã nhập chứng từ", "Xong"];
export const VAN_CHUYEN = 3; // ba chặng đầu thuộc app này, bốn chặng sau thuộc kế toán
// Hủy yêu cầu (lo_thu_hoi.DA_HUY): KHÔNG phải một nấc của thanh 7 nấc — lô dừng hẳn.
export const DA_HUY = "Đã hủy";
// Hủy TẠI CHỖ (lo_thu_hoi.HUY_TAI_CHO): siêu thị hủy hàng, công ty không thu — lô đi tắt từ
// "Tạo yêu cầu" sang "Đã kiểm hàng" (nhận đủ theo phiếu); ba nấc giữa vẽ là BỎ QUA.
export const HUY_TAI_CHO = "Hủy tại chỗ";
const BO_QUA_HTC = new Set(["Đã lấy hàng", "Đã nhận hàng", "Đang kiểm"]);

export function htcTag() {
	return `<span class="vc-badge vc-badge-htc">🗑 Hủy tại chỗ</span>`;
}

// "2026-10-17 09:12:33.4" → "17/10 09:12". Không đi qua new Date(): Safari không đọc
// chuỗi có dấu cách giữa ngày và giờ.
export function fmtLuc(s) {
	const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
	return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(s || "");
}

export function changBadge(chang, list = CHANG_FALLBACK) {
	const i = list.indexOf(chang);
	let c = "vc-badge-muted";
	if (chang === DA_HUY) c = "vc-badge-danger";
	else if (chang === "Tạo yêu cầu") c = "vc-badge-warning";
	else if (i >= 0 && i < VAN_CHUYEN) c = "vc-badge-primary";
	else if (chang === "Xong") c = "vc-badge-success";
	return `<span class="vc-badge ${c}">${escapeHtml(chang || "")}</span>`;
}

// Thanh 7 nấc: nấc đã qua tô đậm, nấc đang đứng có viền. Ba nấc đầu màu vận chuyển,
// bốn nấc sau màu kế toán — nhìn là biết lô đang nằm ở bên nào. Lô hủy tại chỗ (`htc`): ba
// nấc giữa (lấy hàng, nhận hàng, đếm hàng) vẽ gạch chéo — bỏ qua, không phải "chưa tới".
export function changBar(chang, list = CHANG_FALLBACK, htc = false) {
	if (chang === DA_HUY) return ""; // lô hủy không có tiến độ để vẽ — huy hiệu + dòng lý do nói đủ
	const i = list.indexOf(chang);
	return `<div class="vc-th-steps" title="${escapeHtml(chang || "")}${htc ? " · hủy tại chỗ" : ""}">${list
		.map((c, k) => {
			const cls = ["vc-th-step", k < VAN_CHUYEN ? "vc-th-step-vc" : "vc-th-step-kt"];
			if (htc && BO_QUA_HTC.has(c)) cls.push("vc-th-step-skip");
			else if (k <= i) cls.push("vc-th-step-on");
			if (k === i) cls.push("vc-th-step-cur");
			return `<span class="${cls.join(" ")}"></span>`;
		})
		.join("")}</div>`;
}

// Một dòng nói lô bị hủy: lúc nào · ai — lý do.
export function huyLine(r) {
	const ai = [r.huy_luc ? fmtLuc(r.huy_luc) : "", r.huy_boi || ""].filter(Boolean).join(" · ");
	return `<div class="vc-th-huy">🚫 Đã hủy${ai ? " " + escapeHtml(ai) : ""} — ${escapeHtml(r.ly_do_huy || "không ghi lý do")}</div>`;
}
