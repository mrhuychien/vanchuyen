// Shell portal /vc — hash router, nav theo role, cache-bust view động, build handshake.
import { parseHash, matchRoute, go } from "./lib/router.js";
import { escapeHtml } from "./lib/format.js";
import { skeleton } from "./lib/dom.js";

// Build marker (Luật vàng #2): so với VC_CONTEXT.shellBuild để phát hiện shell cũ do cache.
const BUILD = "2026-10-17-p6-nav1";
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
	{ path: "/tra-cuoc", module: "./views/tra-cuoc.js", label: "Trả cước", icon: "fa-money-bill-wave", roles: ["dieu_hanh"] },
	{ path: "/su-co", module: "./views/su-co.js", label: "Sự cố", icon: "fa-triangle-exclamation", roles: ["dieu_hanh"] },
	// Quản lý xe: cùng một module cho danh sách + chi tiết (params.id).
	{ path: "/quan-ly-xe", module: "./views/quan-ly-xe.js", label: "Quản lý xe", icon: "fa-screwdriver-wrench", roles: ["dieu_phoi", "dieu_hanh", "admin"] },
	{ path: "/quan-ly-xe/:id", module: "./views/quan-ly-xe.js", label: "Chi tiết xe", roles: ["dieu_phoi", "dieu_hanh", "admin"], hideNav: true },
	// Thu hồi hàng: điều hành nhận phiếu xuất trả của siêu thị, tổ trưởng giao xe vào lấy.
	{ path: "/thu-hoi", module: "./views/thu-hoi.js", label: "Thu hồi", icon: "fa-rotate-left", roles: ["dieu_hanh", "dieu_phoi", "admin"] },
	{ path: "/thu-hoi/:id", module: "./views/thu-hoi-detail.js", label: "Lô thu hồi", roles: ["dieu_hanh", "dieu_phoi", "admin"], hideNav: true },
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

// Nhóm trên menu ngang (máy tính): các màn của đội xe gom vào nút "Đội xe". Bấm thì MỞ RỘNG
// thành hàng thứ hai ngay dưới header — hàng trên không bao giờ dài ra — bấm lại thì thu; nhớ
// theo từng máy, mặc định THU LẠI. Nút nhóm đứng ở chỗ mục đầu tiên của nó; người chỉ thấy
// một mục của nhóm (lái xe: "Chuyến của tôi") thì hiện thẳng mục đó, khỏi bấm mở.
// Thanh dưới trên điện thoại giữ nguyên.
const NHOM = [
	{
		key: "doi_xe",
		label: "Đội xe",
		icon: "fa-truck-field",
		paths: ["/xep-chuyen", "/tai-khoan", "/chuyen", "/quan-ly-xe", "/tra-cuoc"],
	},
];
const NHOM_KEY = "vc_nav_mo_";

function nhomMo(key) {
	try {
		return localStorage.getItem(NHOM_KEY + key) === "1";
	} catch (e) {
		return false; // trình duyệt chặn lưu trữ: luôn thu lại
	}
}

function luuNhom(key, mo) {
	try {
		localStorage.setItem(NHOM_KEY + key, mo ? "1" : "0");
	} catch (e) {
		// không lưu được thì lần sau mở lại thu lại — không sao
	}
}

function navLink(r) {
	return `<a href="#${r.path}" data-nav="${r.path}"><i class="fas ${r.icon}"></i> ${escapeHtml(r.label)}</a>`;
}

// Mục con của nhóm mà người này thấy được, theo thứ tự của nhóm.
function nhomCon(g, items) {
	return g.paths.map((p) => items.find((x) => x.path === p)).filter(Boolean);
}

function desktopNav(items) {
	const daVe = new Set();
	const out = [];
	for (const r of items) {
		const g = NHOM.find((n) => n.paths.includes(r.path));
		if (!g || nhomCon(g, items).length < 2) {
			out.push(navLink(r));
			continue;
		}
		if (daVe.has(g.key)) continue;
		daVe.add(g.key);
		out.push(`<button type="button" class="vc-nav-group-btn" data-nhom="${g.key}" aria-expanded="${nhomMo(g.key)}"
			aria-controls="vc-nhom-${g.key}"><i class="fas ${g.icon}"></i> ${escapeHtml(g.label)}
			<i class="fas fa-chevron-down vc-nav-caret"></i></button>`);
	}
	return out.join("");
}

// Hàng thứ hai của header: mục con của nhóm, chỉ hiện khi nhóm mở.
function subNav(items) {
	return NHOM.map((g) => [g, nhomCon(g, items)])
		.filter(([, con]) => con.length >= 2)
		.map(
			([g, con]) =>
				`<nav class="vc-subnav-row" id="vc-nhom-${g.key}" aria-label="${escapeHtml(g.label)}"${
					nhomMo(g.key) ? "" : " hidden"
				}>${con.map(navLink).join("")}</nav>`
		)
		.join("");
}

// Có nhóm mở thì header cao thêm một hàng: biến --vc-header-h đẩy nội dung, các mép dính
// (sticky) và menu tài khoản xuống theo. Đặt trên <html> vì menu tài khoản gắn vào <body>,
// nằm ngoài .vc-app.
function capNhatNhom() {
	const mo = !!document.querySelector(".vc-subnav-row:not([hidden])");
	document.documentElement.classList.toggle("vc-nhom-mo", mo);
}

function renderChrome() {
	const items = navItems();
	const header = document.getElementById("vc-header-inner");
	header.innerHTML = `
		<button class="vc-icon-btn" id="vc-back" aria-label="Quay lại" style="display:none"><i class="fas fa-arrow-left"></i></button>
		<div class="vc-header-title" id="vc-title">Vận chuyển</div>
		<div class="vc-header-actions">
			<nav class="vc-desktop-nav">${desktopNav(items)}</nav>
			<button class="vc-icon-btn" id="vc-refresh" aria-label="Làm mới"><i class="fas fa-sync-alt"></i></button>
			<button class="vc-icon-btn" id="vc-account" aria-label="Tài khoản"><i class="fas fa-circle-user"></i></button>
		</div>`;
	let sub = document.getElementById("vc-subnav");
	if (!sub) {
		sub = document.createElement("div");
		sub.id = "vc-subnav";
		sub.className = "vc-subnav";
		header.parentElement.appendChild(sub);
	}
	sub.innerHTML = subNav(items);
	capNhatNhom();

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

	// Cửa sổ hẹp (768–800px) mà menu vẫn tràn thì cuộn ngang trong thanh; chuột thường chỉ lăn
	// dọc — đổi lăn dọc thành cuộn ngang.
	const dnav = header.querySelector(".vc-desktop-nav");
	dnav.addEventListener(
		"wheel",
		(e) => {
			if (dnav.scrollWidth <= dnav.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
			dnav.scrollLeft += e.deltaY;
			e.preventDefault();
		},
		{ passive: false }
	);
	header.querySelectorAll(".vc-nav-group-btn").forEach((b) => {
		b.onclick = () => {
			const mo = b.getAttribute("aria-expanded") !== "true";
			b.setAttribute("aria-expanded", String(mo));
			document.getElementById(b.getAttribute("aria-controls")).hidden = !mo;
			luuNhom(b.dataset.nhom, mo);
			capNhatNhom();
		};
	});

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
	// Đang ở một màn trong nhóm mà nhóm đang thu: nút nhóm sáng lên, biết mình đang ở đâu.
	document.querySelectorAll(".vc-nav-group-btn").forEach((b) => {
		const hang = document.getElementById(b.getAttribute("aria-controls"));
		b.classList.toggle("vc-has-active", !!(hang && hang.querySelector("[data-nav].vc-active")));
	});
	// Menu đang cuộn ngang: kéo mục đang chọn vào tầm nhìn.
	const on = document.querySelector(".vc-desktop-nav a.vc-active");
	if (on && on.offsetParent) on.scrollIntoView({ block: "nearest", inline: "nearest" });
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
