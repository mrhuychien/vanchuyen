// Định dạng tập trung (vi-VN) + escapeHtml. Template literal KHÔNG tự escape →
// mọi dữ liệu người dùng phải qua escapeHtml() trước khi nhét vào innerHTML.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
	if (s === null || s === undefined) return "";
	return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function formatNumber(v, digits = 0) {
	const n = Number(v) || 0;
	return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(
		digits ? n : Math.round(n)
	);
}

// Số kiện/thể tích: bỏ số 0 thừa, tối đa 3 số lẻ.
export function formatQty(v) {
	const n = Number(v) || 0;
	return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

export function formatM3(v) {
	const n = Number(v) || 0;
	return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(n);
}

export function formatCurrency(v) {
	return formatNumber(v) + " ₫";
}

export function formatDate(s) {
	if (!s) return "";
	const d = new Date(s);
	if (isNaN(d.getTime())) return String(s);
	return d.toLocaleDateString("vi-VN");
}
