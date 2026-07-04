import { showModal, closeModal } from "./modal.js";

// message phải được caller escape sẵn nếu chứa dữ liệu người dùng.
export function confirmDialog({ title = "Xác nhận", message = "", okText = "Đồng ý", danger = false, onOk }) {
	const body = `<p class="vc-confirm-msg">${message}</p>`;
	const footer = `
		<button class="vc-btn-ghost" data-vc-close>Hủy</button>
		<button class="${danger ? "vc-btn-danger" : "vc-btn-primary"}" data-vc-ok>${okText}</button>`;
	const content = showModal({ title, body, footer });
	if (!content) return;
	content.querySelector("[data-vc-ok]").addEventListener("click", async () => {
		closeModal();
		if (onOk) await onOk();
	});
}
