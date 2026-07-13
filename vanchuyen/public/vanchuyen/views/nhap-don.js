// #/nhap-don — NHẬP ĐƠN TỰ ĐỘNG (Điều hành). Port từ trang HTML standalone nhưng:
//   - Trích xuất Gemini + tra cứu Item + tạo Sales Invoice đi qua server (vanchuyen.api.nhap_don),
//     KHÔNG để khoá API/logic nghiệp vụ trên trình duyệt.
//   - pdf.js + jszip lazy-load từ cdnjs; trình duyệt chỉ tách trang Coopmart & render ảnh gửi lên.
import { call, errText } from "../lib/api.js";
import { escapeHtml } from "../lib/format.js";
import { showToast } from "../components/toast.js";
import { showModal, closeModal } from "../components/modal.js";

const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const JSZIP_SRC = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

// ── State ────────────────────────────────────────────────────────────────────
let ROOT = null;
let filesQueue = [];
let filesData = {};
let currentReviewFile = null;
let currentReviewData = null;
let currentFileIndex = 0;
let isAutoCreating = false;
const pdfCache = new Map();

// ── Lazy libs ────────────────────────────────────────────────────────────────
function loadScript(src) {
	return new Promise((res, rej) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = () => res();
		s.onerror = () => rej(new Error("Không tải được thư viện: " + src));
		document.head.appendChild(s);
	});
}
async function ensureLibs() {
	if (!window.pdfjsLib) {
		await loadScript(PDFJS_SRC);
		if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
	}
	if (!window.JSZip) await loadScript(JSZIP_SRC);
}

// ── CSS (prefix nd-, inject 1 lần) ───────────────────────────────────────────
const CSS_TEXT = `
.nd-drop { border:2px dashed var(--vc-border,#d1d5db); border-radius:16px; padding:2rem 1rem; text-align:center;
  cursor:pointer; transition:all .25s ease; background:rgba(99,102,241,.03); }
.nd-drop.nd-over, .nd-drop:hover { border-color:#6366f1; background:rgba(99,102,241,.08); }
.nd-drop-icon { font-size:2.4rem; }
.nd-drop h3 { margin:.4rem 0 .2rem; font-size:1.05rem; }
.nd-drop p { margin:0; color:var(--vc-muted,#6b7280); font-size:.85rem; }
.nd-retailers { display:flex; flex-wrap:wrap; gap:.35rem; justify-content:center; margin-top:.75rem; }
.nd-retailer { font-size:.68rem; padding:.2rem .55rem; border-radius:999px; background:rgba(148,163,184,.15); color:var(--vc-muted,#6b7280); }
.nd-file { display:flex; align-items:center; justify-content:space-between; gap:.6rem; padding:.7rem .8rem;
  border:1px solid var(--vc-border,#e5e7eb); border-left-width:4px; border-left-color:transparent; border-radius:12px;
  background:#fff; cursor:pointer; transition:all .15s ease; }
.nd-file:hover { background:#f8fafc; transform:translateX(2px); }
.nd-file.nd-processing { border-left-color:#6366f1; background:rgba(99,102,241,.06); }
.nd-file.nd-completed { border-left-color:#10b981; background:rgba(16,185,129,.06); }
.nd-file.nd-error { border-left-color:#ef4444; background:rgba(239,68,68,.06); }
.nd-file-name { flex:1; min-width:0; font-size:.85rem; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nd-file-status { font-size:.72rem; font-weight:600; padding:.25rem .6rem; border-radius:10px; white-space:nowrap; flex-shrink:0; }
.nd-st-pending { background:rgba(148,163,184,.2); color:#64748b; }
.nd-st-processing { background:#6366f1; color:#fff; }
.nd-st-completed { background:#10b981; color:#fff; }
.nd-st-error { background:#ef4444; color:#fff; }
.nd-list { display:flex; flex-direction:column; gap:.5rem; }
.nd-items { width:100%; border-collapse:collapse; font-size:.82rem; }
.nd-items th { text-align:left; font-weight:600; padding:.4rem .5rem; border-bottom:2px solid var(--vc-border,#e5e7eb); color:var(--vc-muted,#6b7280); }
.nd-items td { padding:.35rem .5rem; border-bottom:1px solid var(--vc-border,#f1f5f9); }
.nd-items input { width:100%; padding:.45rem .5rem; border:1px solid var(--vc-border,#d1d5db); border-radius:8px; font-size:.82rem; font-family:inherit; }
.nd-items input:focus { outline:none; border-color:#6366f1; }
.nd-rm { background:#ef4444; color:#fff; border:none; border-radius:8px; padding:.35rem .7rem; font-size:.72rem; font-weight:600; cursor:pointer; }
.nd-result { border:1px solid var(--vc-border,#e5e7eb); border-left-width:4px; border-radius:12px; padding:.8rem 1rem; }
.nd-result.ok { border-left-color:#10b981; }
.nd-result.err { border-left-color:#ef4444; }
.nd-result a { color:#6366f1; font-weight:600; text-decoration:none; }
.nd-modal-form { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; margin-bottom:1rem; }
@media (max-width:600px){ .nd-modal-form { grid-template-columns:1fr; } }
`;

function injectCss() {
	if (document.getElementById("nd-styles")) return;
	const s = document.createElement("style");
	s.id = "nd-styles";
	s.textContent = CSS_TEXT;
	document.head.appendChild(s);
}

// ── Entry ────────────────────────────────────────────────────────────────────
export async function render({ container }) {
	injectCss();
	ROOT = container;
	filesQueue = [];
	filesData = {};
	isAutoCreating = false;
	pdfCache.clear();

	container.innerHTML = `
		<div class="vc-view-banner">
			<div>
				<div class="vc-view-banner-title">Nhập đơn tự động</div>
				<div class="vc-view-banner-subtitle">Tải phiếu đặt hàng PDF/ZIP — hệ thống tự đọc & tạo đơn</div>
			</div>
			<div class="vc-view-banner-badge"><i class="fas fa-file-invoice"></i></div>
		</div>

		<div class="vc-card vc-mb-3">
			<div class="nd-drop" id="nd-drop">
				<input type="file" id="nd-input" multiple accept=".pdf,.zip" style="display:none" />
				<div class="nd-drop-icon">📤</div>
				<h3>Kéo &amp; thả hoặc bấm chọn file</h3>
				<p>Hỗ trợ PDF, ZIP · Coopmart nhiều trang tự tách đơn riêng</p>
				<div class="nd-retailers">
					${["🛒 Lotte", "🏪 WinMart", "🏬 Emart", "🏢 BRG", "💫 Mega Market", "🌟 BigC", "🎯 Coopmart", "🔷 AEON"]
						.map((r) => `<span class="nd-retailer">${r}</span>`)
						.join("")}
				</div>
			</div>
		</div>

		<div class="vc-card vc-mb-3" id="nd-files-card" style="display:none">
			<div class="vc-flex" style="justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
				<div class="vc-section-title" style="margin:0">📦 Đơn hàng (<span id="nd-count">0</span>)</div>
				<button class="vc-btn-primary" id="nd-process-all" disabled><i class="fas fa-bolt"></i> Xử lý tất cả</button>
			</div>
			<div class="nd-list" id="nd-list"></div>
		</div>

		<div class="vc-card" id="nd-results-card" style="display:none">
			<div class="vc-section-title">✅ Kết quả tạo đơn</div>
			<div class="nd-list" id="nd-results"></div>
		</div>`;

	bindDrop();
	document.getElementById("nd-process-all").addEventListener("click", processAll);
}

// ── Drop / chọn file ─────────────────────────────────────────────────────────
function bindDrop() {
	const drop = document.getElementById("nd-drop");
	const input = document.getElementById("nd-input");
	drop.addEventListener("click", () => input.click());
	input.addEventListener("change", (e) => handleFiles(e.target.files));
	["dragenter", "dragover", "dragleave", "drop"].forEach((ev) =>
		drop.addEventListener(ev, (e) => {
			e.preventDefault();
			e.stopPropagation();
		})
	);
	drop.addEventListener("dragenter", () => drop.classList.add("nd-over"));
	drop.addEventListener("dragleave", () => drop.classList.remove("nd-over"));
	drop.addEventListener("drop", (e) => {
		drop.classList.remove("nd-over");
		handleFiles(e.dataTransfer.files);
	});
}

async function handleFiles(fileList) {
	const arr = Array.from(fileList || []);
	if (!arr.length) return;
	try {
		await ensureLibs();
	} catch (e) {
		showToast(errText(e), "error");
		return;
	}
	for (const file of arr) {
		const name = file.name.toLowerCase();
		if (name.endsWith(".pdf")) {
			await addPdfFile(file, file.name);
		} else if (name.endsWith(".zip")) {
			try {
				const zip = await window.JSZip.loadAsync(file);
				const pdfNames = Object.keys(zip.files).filter(
					(n) => n.toLowerCase().endsWith(".pdf") && !n.startsWith("__MACOSX")
				);
				for (const pn of pdfNames) {
					const blob = await zip.files[pn].async("blob");
					await addPdfFile(new File([blob], pn, { type: "application/pdf" }), pn);
				}
			} catch (e) {
				showToast(`Lỗi giải nén ${file.name}: ${e.message}`, "error");
			}
		}
	}
	renderFilesList();
	updateProcessAllBtn();
	showToast(`Đã thêm ${filesQueue.length} đơn`, "success");
}

async function pdfDoc(file) {
	const key = `${file.name}_${file.size}`;
	if (pdfCache.has(key)) return pdfCache.get(key);
	const buf = await file.arrayBuffer();
	const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
	pdfCache.set(key, doc);
	return doc;
}

async function isCoopmart(file) {
	try {
		const doc = await pdfDoc(file);
		const page = await doc.getPage(1);
		const tc = await page.getTextContent();
		const text = tc.items.map((i) => i.str).join(" ");
		return text.includes("Co.opMart") || text.includes("POM343") || text.includes("JDA Software");
	} catch (e) {
		return false;
	}
}

async function addPdfFile(file, name) {
	const coop = await isCoopmart(file);
	if (coop) {
		let numPages = 1;
		try {
			numPages = (await pdfDoc(file)).numPages;
		} catch (e) {
			/* keep 1 */
		}
		for (let p = 1; p <= numPages; p++) {
			const displayName = numPages > 1 ? `${name} (Trang ${p}/${numPages})` : name;
			filesQueue.push({ file, pageNum: p, totalPages: numPages, displayName, isCoopmart: true });
			filesData[filesQueue.length - 1] = { displayName, status: "pending" };
		}
	} else {
		filesQueue.push({ file, pageNum: null, totalPages: 1, displayName: name, isCoopmart: false });
		filesData[filesQueue.length - 1] = { displayName: name, status: "pending" };
	}
}

function renderFilesList() {
	const card = document.getElementById("nd-files-card");
	const list = document.getElementById("nd-list");
	document.getElementById("nd-count").textContent = filesQueue.length;
	card.style.display = filesQueue.length ? "" : "none";
	list.innerHTML = "";
	filesQueue.forEach((info, index) => {
		const status = filesData[index]?.status || "pending";
		const div = document.createElement("div");
		div.className = `nd-file nd-${status}`;
		div.innerHTML = `<span class="nd-file-name">${escapeHtml(info.displayName)}</span>
			<span class="nd-file-status nd-st-${status}">${statusLabel(status, filesData[index])}</span>`;
		div.addEventListener("click", () => handleFileClick(index));
		list.appendChild(div);
	});
}

function statusLabel(status, data) {
	if (status === "completed") return "✅ Đã tạo đơn";
	if (status === "processing") return "⚙️ Đang xử lý";
	if (status === "error") return "❌ Lỗi";
	return data?.extractedData ? "⏳ Chờ tạo đơn" : "⏳ Chờ xử lý";
}

function updateFileStatus(index, status) {
	filesData[index].status = status;
	const items = document.querySelectorAll("#nd-list .nd-file");
	if (items[index]) {
		items[index].className = `nd-file nd-${status}`;
		const st = items[index].querySelector(".nd-file-status");
		st.className = `nd-file-status nd-st-${status}`;
		st.textContent = statusLabel(status, filesData[index]);
	}
}

function updateProcessAllBtn() {
	const btn = document.getElementById("nd-process-all");
	if (btn) btn.disabled = !filesQueue.some((_, i) => !filesData[i]?.invoiceName);
}

// ── Render 1 trang PDF → base64 PNG ──────────────────────────────────────────
async function renderPageBase64(file, pageNum) {
	const doc = await pdfDoc(file);
	const page = await doc.getPage(pageNum);
	const viewport = page.getViewport({ scale: 2.0 });
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	canvas.width = viewport.width;
	canvas.height = viewport.height;
	await page.render({ canvasContext: ctx, viewport }).promise;
	return canvas.toDataURL("image/png").split(",")[1];
}
function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => resolve(reader.result.split(",")[1]);
		reader.onerror = reject;
	});
}

// ── Click file → trích xuất → mở modal ───────────────────────────────────────
async function handleFileClick(index) {
	if (filesData[index]?.invoiceName) {
		window.open(`/app/sales-invoice/${encodeURIComponent(filesData[index].invoiceName)}`, "_blank");
		return;
	}
	currentFileIndex = index;
	currentReviewFile = filesQueue[index];
	updateFileStatus(index, "processing");
	try {
		if (!filesData[index].extractedData) {
			let b64, mime;
			if (currentReviewFile.pageNum !== null && currentReviewFile.totalPages > 1) {
				b64 = await renderPageBase64(currentReviewFile.file, currentReviewFile.pageNum);
				mime = "image/png";
			} else {
				b64 = await fileToBase64(currentReviewFile.file);
				mime = "application/pdf";
			}
			filesData[index].extractedData = await call("vanchuyen.api.nhap_don.extract_order", {
				data_b64: b64,
				mime_type: mime,
			});
		}
		currentReviewData = filesData[index].extractedData;
		updateFileStatus(index, "pending");
		openReviewModal(currentReviewData);
	} catch (e) {
		updateFileStatus(index, "error");
		showToast(errText(e), "error");
		if (isAutoCreating) continueAutoCreate();
	}
}

// ── Modal kiểm tra ───────────────────────────────────────────────────────────
function itemIdHeader(customer) {
	if (customer === "Coopmart") return "Mã Coopmart";
	if (customer === "Mega Market") return "Mã MM";
	return "Barcode";
}

function normalizeItems(data) {
	const isCoop = data.customer === "Coopmart";
	const isMM = data.customer === "Mega Market";
	return (data.items || []).map((item) => {
		let uom = "Thùng";
		let qty = item.ou_qty || 0;
		let itemId = item.barcode || item.custom_macop || item.mamm || "";
		let lookupType = "barcode";
		if (isCoop) {
			lookupType = "coopmart";
			itemId = item.custom_macop || itemId;
			const q = parseFloat(item.ou_qty || 0);
			const qp = parseFloat(item.ou_qty_pcs || 0);
			if (Number.isInteger(q) && q > 0) {
				uom = "Thùng";
				qty = q;
			} else if (qp > 0) {
				uom = "Hộp";
				qty = qp;
			}
		} else if (isMM) {
			lookupType = "megamarket";
			itemId = item.mamm || "";
			uom = "Hộp";
		} else if (data.customer === "Winmart") uom = "Hộp";
		else if (data.customer === "EMART") uom = "Thùng";
		else if (data.customer === "BRG Retail") uom = "Hộp";
		else if (data.customer === "AEON") uom = "Thùng";
		return { itemId, qty: qty || 1, uom, lookupType };
	});
}

function itemRowHtml(it, ph) {
	return `<tr>
		<td><input type="text" class="nd-it-id" value="${escapeHtml(it.itemId)}" placeholder="${escapeHtml(ph)}" data-lt="${escapeHtml(it.lookupType)}"></td>
		<td><input type="number" class="nd-it-qty" value="${escapeHtml(it.qty)}" min="1"></td>
		<td><input type="text" class="nd-it-uom" value="${escapeHtml(it.uom)}"></td>
		<td><button class="nd-rm" type="button">Xóa</button></td>
	</tr>`;
}

function openReviewModal(data) {
	const ph = itemIdHeader(data.customer);
	const items = normalizeItems(data);
	const body = `
		<div class="nd-modal-form">
			<div class="vc-field"><label>Khách hàng *</label><input class="vc-input" id="nd-r-customer" value="${escapeHtml(data.customer || "")}"></div>
			<div class="vc-field"><label>Số PO *</label><input class="vc-input" id="nd-r-po" value="${escapeHtml(data.so_po || "")}"></div>
			<div class="vc-field"><label>Ngày PO</label><input class="vc-input" type="date" id="nd-r-podate" value="${escapeHtml(data.po_date || "")}"></div>
			<div class="vc-field"><label>Địa chỉ giao hàng</label><input class="vc-input" id="nd-r-deliver" value="${escapeHtml(data.delivered_to || "")}"></div>
		</div>
		<div class="vc-section-title" style="margin-top:.5rem">📦 Sản phẩm (<span id="nd-it-count">0</span>)</div>
		<div style="overflow-x:auto">
			<table class="nd-items">
				<thead><tr><th style="width:42%">${escapeHtml(ph)}</th><th style="width:20%">SL</th><th style="width:22%">ĐVT</th><th style="width:16%"></th></tr></thead>
				<tbody id="nd-it-body">${items.map((it) => itemRowHtml(it, ph)).join("")}</tbody>
			</table>
		</div>
		<button class="vc-btn-ghost vc-btn-block vc-mt-2" id="nd-add-item" type="button"><i class="fas fa-plus"></i> Thêm sản phẩm</button>`;
	const footer = `
		<button class="vc-btn-ghost" data-vc-close type="button">Hủy</button>
		<button class="vc-btn-ghost" id="nd-skip" type="button">⏭ Bỏ qua</button>
		<button class="vc-btn-primary" id="nd-auto" type="button"><i class="fas fa-bolt"></i> Tạo đơn loạt</button>
		<button class="vc-btn-success" id="nd-create" type="button"><i class="fas fa-check"></i> Tạo đơn</button>`;

	const content = showModal({ title: "📝 Kiểm tra đơn hàng", body, footer });
	if (!content) return;
	const tbody = content.querySelector("#nd-it-body");
	const refreshCount = () => {
		content.querySelector("#nd-it-count").textContent = tbody.querySelectorAll("tr").length;
	};
	const bindRow = (tr) => tr.querySelector(".nd-rm").addEventListener("click", () => {
		tr.remove();
		refreshCount();
	});
	tbody.querySelectorAll("tr").forEach(bindRow);
	refreshCount();
	content.querySelector("#nd-add-item").addEventListener("click", () => {
		const tmp = document.createElement("tbody");
		tmp.innerHTML = itemRowHtml({ itemId: "", qty: 1, uom: "Thùng", lookupType: "barcode" }, ph);
		const tr = tmp.firstElementChild;
		tbody.appendChild(tr);
		bindRow(tr);
		refreshCount();
	});
	content.querySelector("#nd-skip").addEventListener("click", skipCurrentFile);
	content.querySelector("#nd-auto").addEventListener("click", startAutoCreate);
	content.querySelector("#nd-create").addEventListener("click", () => createInvoice(content));
}

function collectModal(content) {
	const header = {
		customer: content.querySelector("#nd-r-customer").value.trim(),
		so_po: content.querySelector("#nd-r-po").value.trim(),
		po_date: content.querySelector("#nd-r-podate").value || null,
		delivered_to: content.querySelector("#nd-r-deliver").value.trim(),
	};
	const items = [];
	content.querySelectorAll("#nd-it-body tr").forEach((tr) => {
		const itemId = tr.querySelector(".nd-it-id").value.trim();
		const qty = parseFloat(tr.querySelector(".nd-it-qty").value) || 0;
		const uom = tr.querySelector(".nd-it-uom").value.trim();
		const lookupType = tr.querySelector(".nd-it-id").dataset.lt || "barcode";
		if (itemId && qty > 0) items.push({ itemId, qty, uom, lookupType });
	});
	return { header, items };
}

// ── Tạo đơn ──────────────────────────────────────────────────────────────────
async function createInvoice(content) {
	const btn = content.querySelector("#nd-create");
	const { header, items } = collectModal(content);
	if (!header.customer || !header.so_po) {
		showToast("Nhập đủ Khách hàng và Số PO", "error");
		return;
	}
	if (!items.length) {
		showToast("Chưa có sản phẩm hợp lệ", "error");
		return;
	}
	if (!header.delivered_to && !window.confirm("⚠️ Đơn không có địa chỉ giao hàng. Vẫn tạo?")) return;

	btn.disabled = true;
	const orig = btn.innerHTML;
	btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';
	try {
		const res = await call("vanchuyen.api.nhap_don.create_sales_invoice", {
			header: JSON.stringify(header),
			items: JSON.stringify(items),
		});
		if (res.missing && res.missing.length) {
			showToast(`Bỏ qua ${res.missing.length} mã không tìm thấy`, "warning");
		}
		filesData[currentFileIndex].invoiceName = res.name;
		filesData[currentFileIndex].status = "completed";
		updateFileStatus(currentFileIndex, "completed");
		updateProcessAllBtn();
		addResult(currentReviewFile.displayName, res.name, res.created, true);
		showToast(`Đã tạo ${res.name}`, "success");
		if (isAutoCreating) {
			await continueAutoCreate();
		} else {
			closeModal();
		}
	} catch (e) {
		showToast(errText(e), "error");
		if (isAutoCreating) {
			if (window.confirm(`Lỗi: ${errText(e)}\n\nBỏ qua đơn này và tiếp tục?`)) {
				skipCurrentFile();
			} else {
				isAutoCreating = false;
				closeModal();
			}
		}
	} finally {
		btn.disabled = false;
		btn.innerHTML = orig;
	}
}

function skipCurrentFile() {
	filesData[currentFileIndex].status = "pending";
	updateFileStatus(currentFileIndex, "pending");
	showToast("Đã bỏ qua đơn này", "info");
	if (isAutoCreating) continueAutoCreate();
	else closeModal();
}

async function startAutoCreate() {
	isAutoCreating = true;
	showToast("🚀 Bắt đầu tạo đơn loạt...", "info");
	const content = document.querySelector("#vc-modal-mount .vc-modal-content");
	if (content) await createInvoice(content);
}

async function continueAutoCreate() {
	if (!isAutoCreating) return;
	const next = filesQueue.findIndex((_, i) => filesData[i]?.extractedData && !filesData[i]?.invoiceName);
	if (next === -1) {
		showToast("✅ Đã tạo xong tất cả đơn đã đọc!", "success");
		isAutoCreating = false;
		closeModal();
		return;
	}
	currentFileIndex = next;
	currentReviewFile = filesQueue[next];
	currentReviewData = filesData[next].extractedData;
	openReviewModal(currentReviewData);
	await new Promise((r) => setTimeout(r, 300));
	const content = document.querySelector("#vc-modal-mount .vc-modal-content");
	if (content) await createInvoice(content);
}

// ── Xử lý tất cả (đọc lần lượt) ──────────────────────────────────────────────
async function processAll() {
	const pending = filesQueue.some((_, i) => !filesData[i]?.invoiceName);
	if (!pending) {
		showToast("Không có đơn nào cần xử lý", "info");
		return;
	}
	for (let i = 0; i < filesQueue.length; i++) {
		if (filesData[i]?.invoiceName) continue;
		await handleFileClick(i);
		await new Promise((r) => setTimeout(r, 800));
	}
}

// ── Kết quả ──────────────────────────────────────────────────────────────────
function addResult(fileName, invoiceName, itemsCount, ok) {
	const card = document.getElementById("nd-results-card");
	const grid = document.getElementById("nd-results");
	card.style.display = "";
	const div = document.createElement("div");
	div.className = `nd-result ${ok ? "ok" : "err"}`;
	div.innerHTML = ok
		? `<div style="font-weight:600">📄 ${escapeHtml(fileName)}</div>
			<div class="vc-mt-1" style="font-size:.85rem">✅ ${itemsCount} sản phẩm ·
			<a href="/app/sales-invoice/${encodeURIComponent(invoiceName)}" target="_blank">Xem ${escapeHtml(invoiceName)} →</a></div>`
		: `<div style="font-weight:600">📄 ${escapeHtml(fileName)}</div>
			<div class="vc-mt-1" style="font-size:.85rem;color:#ef4444">❌ Tạo đơn thất bại</div>`;
	grid.appendChild(div);
}
