// Modal bottom-sheet (mobile) → centered (desktop). Nội dung do caller dựng (đã escape).

let _closeHandler = null;

export function showModal({ title = "", body = "", footer = "" }) {
	const mount = document.getElementById("vc-modal-mount");
	if (!mount) return null;
	mount.innerHTML = `
		<div class="vc-modal-content" role="dialog" aria-modal="true">
			<div class="vc-modal-head">
				<h3 class="vc-modal-title">${title}</h3>
				<button class="vc-icon-btn" data-vc-close aria-label="Đóng"><i class="fas fa-times"></i></button>
			</div>
			<div class="vc-modal-body">${body}</div>
			${footer ? `<div class="vc-modal-foot">${footer}</div>` : ""}
		</div>`;
	mount.classList.add("vc-show");
	mount.onclick = (e) => {
		if (e.target === mount || e.target.closest("[data-vc-close]")) closeModal();
	};
	return mount.querySelector(".vc-modal-content");
}

export function closeModal() {
	const m = document.getElementById("vc-modal-mount");
	if (!m) return;
	m.classList.remove("vc-show");
	m.innerHTML = "";
	if (_closeHandler) {
		try {
			_closeHandler();
		} catch (e) {
			/* ignore */
		}
		_closeHandler = null;
	}
}

export function setModalCloseHandler(fn) {
	_closeHandler = fn;
}
