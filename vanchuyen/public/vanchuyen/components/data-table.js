// Phân trang bảng dài (10 dòng/trang) bằng chuỗi HTML + registry + event delegation.
// Trả về CHUỖI HTML nhúng vào template bất kỳ; pager tự ẩn khi ≤ pageSize.
// (theo frappe-portal-spa/references/pagination.md, prefix vc-)

const PT_REG = new Map();
let ptSeq = 0;

function ptPager(id, st) {
	const totalPages = Math.max(1, Math.ceil(st.rows.length / st.pageSize));
	if (totalPages <= 1) return "";
	return `<div class="vc-pager">
		<button class="vc-pager-btn" data-pt-prev="${id}" ${st.page <= 0 ? "disabled" : ""}>‹ Trước</button>
		<span class="vc-pager-info">Trang ${st.page + 1}/${totalPages} · ${st.rows.length} dòng</span>
		<button class="vc-pager-btn" data-pt-next="${id}" ${st.page >= totalPages - 1 ? "disabled" : ""}>Sau ›</button>
	</div>`;
}

function ptInner(id) {
	const st = PT_REG.get(id);
	if (!st) return "";
	const start = st.page * st.pageSize;
	return st.render(st.rows.slice(start, start + st.pageSize), start) + ptPager(id, st);
}

function ptDraw(id) {
	const el = document.querySelector(`[data-pt="${id}"]`);
	const st = PT_REG.get(id);
	if (!el || !st) return;
	el.innerHTML = ptInner(id);
	if (st.onDraw) {
		try {
			st.onDraw(el);
		} catch (e) {
			console.error(e);
		}
	}
}

/** paged({rows, render, pageSize=10, onDraw}). render(slice, startIndex) → HTML string. */
export function paged({ rows, render, pageSize = 10, onDraw = null }) {
	const id = "pt" + ++ptSeq;
	if (PT_REG.size > 200) PT_REG.delete(PT_REG.keys().next().value);
	PT_REG.set(id, { rows: rows || [], render, pageSize, page: 0, onDraw });
	if (onDraw) {
		setTimeout(() => {
			const el = document.querySelector(`[data-pt="${id}"]`);
			if (el) {
				try {
					onDraw(el);
				} catch (e) {
					console.error(e);
				}
			}
		}, 0);
	}
	return `<div class="vc-paged" data-pt="${id}">${ptInner(id)}</div>`;
}

// Delegation 1 lần khi module nạp — nút ‹ › sống dù bảng nằm sâu trong innerHTML.
document.addEventListener("click", (e) => {
	const prev = e.target.closest("[data-pt-prev]");
	const next = e.target.closest("[data-pt-next]");
	if (!prev && !next) return;
	const id = prev ? prev.dataset.ptPrev : next.dataset.ptNext;
	const st = PT_REG.get(id);
	if (!st) return;
	const total = Math.max(1, Math.ceil(st.rows.length / st.pageSize));
	st.page = Math.min(Math.max(0, st.page + (prev ? -1 : 1)), total - 1);
	ptDraw(id);
});
