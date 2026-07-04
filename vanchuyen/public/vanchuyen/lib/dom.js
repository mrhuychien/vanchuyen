// Tiện ích DOM tối giản. `html` chỉ nối chuỗi (KHÔNG auto-escape) — caller tự
// escapeHtml dữ liệu người dùng (theo quy ước frappe-portal-spa).

export function html(strings, ...values) {
	return strings.reduce(
		(acc, s, i) => acc + s + (i < values.length ? (values[i] ?? "") : ""),
		""
	);
}

export function el(id) {
	return document.getElementById(id);
}

export function qs(sel, root = document) {
	return root.querySelector(sel);
}

export function qsa(sel, root = document) {
	return Array.from(root.querySelectorAll(sel));
}

// Skeleton nhanh khi đang tải (không để màn trắng).
export function skeleton(height = 90, count = 3) {
	let out = "";
	for (let i = 0; i < count; i++) {
		out += `<div class="vc-skeleton" style="height:${height}px;margin-bottom:.75rem"></div>`;
	}
	return out;
}
