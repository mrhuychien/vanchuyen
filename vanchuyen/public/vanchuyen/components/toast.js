// Toast góc trên-phải, tự biến mất ~3.5s. type: success | error | warning | info.

export function showToast(msg, type = "info") {
	const mount = document.getElementById("vc-toast-mount");
	if (!mount) return;
	const t = document.createElement("div");
	t.className = "vc-toast vc-" + type;
	t.textContent = msg;
	mount.appendChild(t);
	setTimeout(() => {
		t.style.animation = "vcToastOut .25s ease forwards";
		setTimeout(() => t.remove(), 260);
	}, 3500);
}
