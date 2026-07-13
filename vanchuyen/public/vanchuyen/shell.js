// Shell portal /vc — hash router, nav theo role, cache-bust view động, build handshake.
import { parseHash, matchRoute, go } from "./lib/router.js";
import { escapeHtml } from "./lib/format.js";
import { skeleton } from "./lib/dom.js";

// Build marker (Luật vàng #2): so với VC_CONTEXT.shellBuild để phát hiện shell cũ do cache.
const BUILD = "2026-07-13-p3";
window.APP = { build: BUILD };

const CTX = window.VC_CONTEXT || {};
const ASSET_V = CTX.assetVersion || Date.now();
const BASE = "/assets/vanchuyen/vanchuyen/";

function withV(p) {
	// p là './views/x.js' → /assets/.../views/x.js?v=ASSET_V
	const abs = BASE + p.replace(/^\.\//, "");
	return abs + (abs.includes("?") ? "&" : "?") + "v=" + ASSET_V;
}

const ROUTES = [
	{ path: "/xep-chuyen", module: "./views/xep-chuyen.js", label: "Xếp chuyến", icon: "fa-boxes-packing", roles: ["dieu_phoi"] },
	{ path: "/tai-khoan", module: "./views/tai-khoan.js", label: "Tài khoản", icon: "fa-id-card", roles: ["dieu_phoi", "admin"] },
	{ path: "/chuyen", module: "./views/chuyen.js", label: "Chuyến của tôi", icon: "fa-truck", roles: ["lai_xe"] },
	{ path: "/chuyen/:id", module: "./views/chuyen-detail.js", label: "Chi tiết chuyến", roles: ["lai_xe"], hideNav: true },
	{ path: "/tong-quan", module: "./views/tong-quan.js", label: "Tổng quan", icon: "fa-chart-line", roles: ["dieu_hanh"] },
	{ path: "/dieu-phoi", module: "./views/dieu-phoi.js", label: "Điều hành", icon: "fa-clipboard-list", roles: ["dieu_hanh"] },
	{ path: "/nhap-don", module: "./views/nhap-don.js", label: "Nhập đơn", icon: "fa-file-invoice", roles: ["dieu_hanh"] },
];

function canAccess(route) {
	return route.roles.some((r) => CTX["is_" + r]);
}

function landing() {
	// Tổ trưởng (Điều Phối) → xếp chuyến; Lái xe → chuyến của tôi; Điều hành/Admin → tổng quan.
	if (CTX.is_dieu_phoi) return "/xep-chuyen";
	if (CTX.is_lai_xe) return "/chuyen";
	if (CTX.is_dieu_hanh) return "/tong-quan";
	return "/xep-chuyen";
}

// ── Header + nav ────────────────────────────────────────────────────────────
function navItems() {
	return ROUTES.filter((r) => !r.hideNav && canAccess(r));
}

function renderChrome() {
	const items = navItems();
	const header = document.getElementById("vc-header-inner");
	header.innerHTML = `
		<button class="vc-icon-btn" id="vc-back" aria-label="Quay lại" style="display:none"><i class="fas fa-arrow-left"></i></button>
		<div class="vc-header-title" id="vc-title">Vận chuyển</div>
		<div class="vc-header-actions">
			<nav class="vc-desktop-nav">
				${items
					.map(
						(r) =>
							`<a href="#${r.path}" data-nav="${r.path}"><i class="fas ${r.icon}"></i> ${escapeHtml(r.label)}</a>`
					)
					.join("")}
			</nav>
			<button class="vc-icon-btn" id="vc-refresh" aria-label="Làm mới"><i class="fas fa-sync-alt"></i></button>
			<button class="vc-icon-btn" id="vc-account" aria-label="Tài khoản"><i class="fas fa-circle-user"></i></button>
		</div>`;

	const nav = document.getElementById("vc-bottom-nav");
	nav.innerHTML = items
		.map(
			(r) =>
				`<a class="vc-nav-item" href="#${r.path}" data-nav="${r.path}">
					<i class="fas ${r.icon}"></i><span>${escapeHtml(r.label)}</span></a>`
		)
		.join("");
	nav.style.gridTemplateColumns = `repeat(${Math.max(items.length, 1)}, 1fr)`;
	nav.style.display = items.length > 1 ? "grid" : "none";

	document.getElementById("vc-refresh").onclick = () => render();
	document.getElementById("vc-account").onclick = toggleAccount;
	document.getElementById("vc-back").onclick = () => history.back();
}

function toggleAccount() {
	let menu = document.getElementById("vc-acct-menu");
	if (menu) {
		menu.remove();
		return;
	}
	menu = document.createElement("div");
	menu.id = "vc-acct-menu";
	menu.className = "vc-acct-menu";
	menu.innerHTML = `
		<div class="vc-acct-name">${escapeHtml(CTX.full_name || CTX.user || "")}</div>
		<div class="vc-acct-sub">${escapeHtml(CTX.user || "")}</div>
		<button class="vc-acct-logout" id="vc-logout">Đăng xuất</button>`;
	document.body.appendChild(menu);
	document.getElementById("vc-logout").onclick = () => {
		if (window.frappe && window.frappe.call) {
			window.frappe.call({ method: "logout", callback: () => (location.href = "/login") });
		} else {
			location.href = "/api/method/logout";
		}
	};
	setTimeout(() => {
		document.addEventListener("click", function h(e) {
			if (!e.target.closest("#vc-acct-menu") && !e.target.closest("#vc-account")) {
				menu.remove();
				document.removeEventListener("click", h);
			}
		});
	}, 0);
}

function setActiveNav(path) {
	document.querySelectorAll("[data-nav]").forEach((a) => {
		a.classList.toggle("vc-active", a.getAttribute("data-nav") === path);
	});
}

// ── Router ──────────────────────────────────────────────────────────────────
function selfHeal(path) {
	const key = "vc_heal_" + path;
	if (!sessionStorage.getItem(key)) {
		sessionStorage.setItem(key, "1");
		location.reload();
		return;
	}
	go(landing());
}

async function render() {
	const { path, query } = parseHash();
	if (path === "/") {
		go(landing());
		return;
	}
	const m = matchRoute(ROUTES, path);
	if (!m) {
		selfHeal(path);
		return;
	}
	if (!canAccess(m.route)) {
		renderDenied();
		return;
	}
	sessionStorage.removeItem("vc_heal_" + path);

	const detail = m.route.hideNav;
	document.getElementById("vc-back").style.display = detail ? "flex" : "none";
	document.getElementById("vc-title").textContent = m.route.label;
	setActiveNav(m.route.path);

	const view = document.getElementById("vc-view");
	view.innerHTML = skeleton(120, 3);
	try {
		const mod = await import(withV(m.route.module));
		await mod.render({ container: view, params: m.params, query });
	} catch (e) {
		console.error(e);
		view.innerHTML = `<div class="vc-empty"><div class="vc-empty-icon">⚠️</div>
			<div class="vc-empty-title">Không tải được màn hình</div>
			<p class="vc-text-muted">${escapeHtml(String((e && e.message) || e))}</p></div>`;
	}
}

function renderDenied() {
	document.getElementById("vc-title").textContent = "Không có quyền";
	document.getElementById("vc-view").innerHTML = `<div class="vc-empty">
		<div class="vc-empty-icon">🔒</div><div class="vc-empty-title">Bạn không có quyền truy cập màn hình này</div></div>`;
}

function checkStaleShell() {
	if (CTX.shellBuild && CTX.shellBuild !== BUILD) {
		const b = document.createElement("div");
		b.className = "vc-stale-banner";
		b.textContent = "Đang chạy bản cũ do cache — kéo để tải lại (hoặc Ctrl+Shift+R).";
		b.onclick = () => location.reload();
		document.body.appendChild(b);
	}
}

window.addEventListener("hashchange", render);
window.addEventListener("load", () => {
	renderChrome();
	checkStaleShell();
	render();
});
