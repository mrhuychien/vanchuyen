// Mảnh giao diện dùng chung của THU HỒI HÀNG: huy hiệu chặng + thanh 7 nấc.
// Nằm ở components/ (có trong import map) chứ không export từ một view: view import
// view khác theo đường tương đối là ăn bản cache cũ của /assets (Luật vàng #1).
import { escapeHtml } from "../lib/format.js";

// Fallback khi server cũ chưa trả `chang_list` — nguồn thật là lo_thu_hoi.CHANG.
export const CHANG_FALLBACK = ["Tạo yêu cầu", "Đã lấy hàng", "Đã nhận hàng", "Đang kiểm", "Đã kiểm hàng", "Đã nhập chứng từ", "Xong"];
export const VAN_CHUYEN = 3; // ba chặng đầu thuộc app này, bốn chặng sau thuộc kế toán

export function changBadge(chang, list = CHANG_FALLBACK) {
	const i = list.indexOf(chang);
	let c = "vc-badge-muted";
	if (chang === "Tạo yêu cầu") c = "vc-badge-warning";
	else if (i >= 0 && i < VAN_CHUYEN) c = "vc-badge-primary";
	else if (chang === "Xong") c = "vc-badge-success";
	return `<span class="vc-badge ${c}">${escapeHtml(chang || "")}</span>`;
}

// Thanh 7 nấc: nấc đã qua tô đậm, nấc đang đứng có viền. Ba nấc đầu màu vận chuyển,
// bốn nấc sau màu kế toán — nhìn là biết lô đang nằm ở bên nào.
export function changBar(chang, list = CHANG_FALLBACK) {
	const i = list.indexOf(chang);
	return `<div class="vc-th-steps" title="${escapeHtml(chang || "")}">${list
		.map((c, k) => {
			const cls = ["vc-th-step", k < VAN_CHUYEN ? "vc-th-step-vc" : "vc-th-step-kt"];
			if (k <= i) cls.push("vc-th-step-on");
			if (k === i) cls.push("vc-th-step-cur");
			return `<span class="${cls.join(" ")}"></span>`;
		})
		.join("")}</div>`;
}
