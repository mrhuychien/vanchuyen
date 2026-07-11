// #/tai-khoan — TỔ TRƯỞNG: tạo tài khoản lái xe + QR đăng nhập 1-chạm.
import { call, errText } from "../lib/api.js";
import { skeleton } from "../lib/dom.js";
import { escapeHtml } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { showModal, closeModal } from "../components/modal.js";
import { confirmDialog } from "../components/confirm.js";

let ROOT = null;
let LIST = [];

function loadQRLib() {
	if (window.QRCode) return Promise.resolve();
	return new Promise((res, rej) => {
		const s = document.createElement("script");
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
		s.onload = () => res();
		s.onerror = () => rej(new Error("Không tải được thư viện QR"));
		document.head.appendChild(s);
	});
}

export async function render({ container }) {
	ROOT = container;
	container.innerHTML = skeleton(90, 3);
	try {
		LIST = await call("vanchuyen.api.to_truong.list_driver_accounts");
	} catch (e) {
		container.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
			<div class="vc-empty-title">Không tải được danh sách</div>
			<p class="vc-text-muted">${escapeHtml(errText(e))}</p></div>`;
		return;
	}
	draw();
}

function draw() {
	const co = LIST.filter((d) => d.has_account);
	ROOT.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Tài khoản lái xe</div>
				<div class="vc-view-banner-subtitle">${co.length}/${LIST.length} lái xe đã có tài khoản</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-id-card"></i></div>
		</div>

		<div class="vc-card vc-mb-3">
			<div class="vc-builder-rows-title">Thêm lái xe mới</div>
			<div class="vc-field"><label>Họ tên lái xe</label><input class="vc-input" id="vc-nd-ten" placeholder="Nguyễn Văn A" /></div>
			<div class="vc-field"><label>Số điện thoại</label><input class="vc-input" id="vc-nd-sdt" type="tel" inputmode="numeric" placeholder="09xxxxxxxx" /></div>
			<button class="vc-btn-primary vc-btn-block" id="vc-nd-create"><i class="fas fa-user-plus"></i> Tạo tài khoản + QR</button>
		</div>

		<div class="vc-section-title">Danh sách lái xe</div>
		<div class="vc-list" id="vc-acc-list">
			${LIST.length ? LIST.map(accCard).join("") : '<div class="vc-text-muted vc-text-sm vc-text-center">Chưa có lái xe nào.</div>'}
		</div>`;

	document.getElementById("vc-nd-create").addEventListener("click", createNew);
	bindList();
}

function accCard(d) {
	const badge = !d.has_account
		? '<span class="vc-badge vc-badge-muted">Chưa có TK</span>'
		: d.enabled
		? '<span class="vc-badge vc-badge-success">Đang mở</span>'
		: '<span class="vc-badge vc-badge-danger">Đã khóa</span>';
	let actions = "";
	if (!d.has_account) {
		actions = `<button class="vc-btn-primary" data-create-existing="${escapeHtml(d.driver)}" style="flex:1"><i class="fas fa-qrcode"></i> Tạo tài khoản + QR</button>`;
	} else {
		actions = `
			<button class="vc-btn-primary" data-qr="${escapeHtml(d.driver)}"><i class="fas fa-qrcode"></i> Xem QR</button>
			<button class="vc-btn-ghost" data-regen="${escapeHtml(d.driver)}">Cấp lại QR</button>
			<button class="${d.enabled ? "vc-btn-danger" : "vc-btn-success"}" data-toggle="${escapeHtml(d.driver)}" data-en="${d.enabled ? 1 : 0}">${d.enabled ? "Khóa" : "Mở"}</button>`;
	}
	return `
	<div class="vc-order-card" data-drv="${escapeHtml(d.driver)}">
		<div class="vc-order-head">
			<div>
				<div class="vc-order-cust">${escapeHtml(d.full_name || d.driver)}</div>
				<div class="vc-order-addr">${escapeHtml(d.cell_number || "")}${d.user ? " · " + escapeHtml(d.user) : ""}</div>
			</div>
			${badge}
		</div>
		<div class="vc-flex vc-gap-2 vc-mt-2" style="flex-wrap:wrap">${actions}</div>
	</div>`;
}

function bindList() {
	const wrap = document.getElementById("vc-acc-list");
	wrap.querySelectorAll("[data-create-existing]").forEach((b) =>
		b.addEventListener("click", () => createForExisting(b.dataset.createExisting))
	);
	wrap.querySelectorAll("[data-qr]").forEach((b) => b.addEventListener("click", () => showQR(find(b.dataset.qr))));
	wrap.querySelectorAll("[data-regen]").forEach((b) =>
		b.addEventListener("click", () =>
			confirmDialog({
				title: "Cấp lại QR",
				message: "QR cũ sẽ HẾT hiệu lực. Lái xe phải quét QR mới. Tiếp tục?",
				okText: "Cấp lại",
				onOk: async () => {
					try {
						const d = await call("vanchuyen.api.to_truong.regenerate_driver_token", { driver: b.dataset.regen });
						replace(d);
						showToast("Đã cấp QR mới", "success");
						showQR(d);
					} catch (e) {
						showToast(errText(e), "error");
					}
				},
			})
		)
	);
	wrap.querySelectorAll("[data-toggle]").forEach((b) =>
		b.addEventListener("click", async () => {
			try {
				const d = await call("vanchuyen.api.to_truong.set_driver_enabled", {
					driver: b.dataset.toggle,
					enabled: b.dataset.en === "1" ? 0 : 1,
				});
				replace(d);
				redrawList();
				showToast(d.enabled ? "Đã mở tài khoản" : "Đã khóa tài khoản", "success");
			} catch (e) {
				showToast(errText(e), "error");
			}
		})
	);
}

function find(driver) {
	return LIST.find((d) => d.driver === driver);
}
function replace(d) {
	const i = LIST.findIndex((x) => x.driver === d.driver);
	if (i >= 0) LIST[i] = d;
	else LIST.push(d);
}
function redrawList() {
	const wrap = document.getElementById("vc-acc-list");
	if (wrap) {
		wrap.innerHTML = LIST.map(accCard).join("");
		bindList();
	}
}

async function createNew() {
	const ten = document.getElementById("vc-nd-ten").value.trim();
	const sdt = document.getElementById("vc-nd-sdt").value.trim();
	if (!ten || !sdt) {
		showToast("Nhập họ tên và số điện thoại", "error");
		return;
	}
	const btn = document.getElementById("vc-nd-create");
	btn.disabled = true;
	try {
		const d = await call("vanchuyen.api.to_truong.create_driver_account", { full_name: ten, cell_number: sdt });
		replace(d);
		showToast("Đã tạo tài khoản " + (d.full_name || ""), "success");
		draw();
		showQR(d);
	} catch (e) {
		showToast(errText(e), "error");
	} finally {
		btn.disabled = false;
	}
}

async function createForExisting(driver) {
	try {
		const d = await call("vanchuyen.api.to_truong.create_account_for_driver", { driver });
		replace(d);
		showToast("Đã tạo tài khoản " + (d.full_name || ""), "success");
		redrawList();
		showQR(d);
	} catch (e) {
		showToast(errText(e), "error");
	}
}

async function showQR(d) {
	if (!d || !d.login_url) {
		showToast("Lái xe chưa có QR", "warning");
		return;
	}
	const body = `
		<div class="vc-qr-wrap"><div id="vc-qrbox"></div></div>
		<div class="vc-qr-name">${escapeHtml(d.full_name || d.driver)}</div>
		<div class="vc-qr-url" id="vc-qr-url">${escapeHtml(d.login_url)}</div>
		<p class="vc-text-sm vc-text-muted vc-text-center">Lái xe mở camera điện thoại quét mã này để vào app — không cần nhập mật khẩu.</p>`;
	const footer = `<button class="vc-btn-ghost" id="vc-qr-copy">Sao chép link</button>
		<button class="vc-btn-primary" data-vc-close>Xong</button>`;
	showModal({ title: "QR đăng nhập lái xe", body, footer });
	document.getElementById("vc-qr-copy").addEventListener("click", () => {
		navigator.clipboard?.writeText(d.login_url).then(
			() => showToast("Đã sao chép link", "success"),
			() => showToast("Không sao chép được", "error")
		);
	});
	try {
		await loadQRLib();
		const box = document.getElementById("vc-qrbox");
		if (box && window.QRCode) {
			box.innerHTML = "";
			new window.QRCode(box, { text: d.login_url, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
		}
	} catch (e) {
		const box = document.getElementById("vc-qrbox");
		if (box) box.innerHTML = `<p class="vc-text-danger vc-text-sm">${escapeHtml(errText(e))}</p>`;
	}
}
