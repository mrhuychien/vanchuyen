// #/dieu-phoi — admin logistics (Phase 2). PORT NGUYÊN trang gốc quan-ly-van-chuyen.html
// (giao diện rvhg- + mọi thao tác giữ y hệt), CHỈ thay tầng data bằng 3 method server:
//   - vanchuyen.api.dieu_hanh.get_invoices_dieu_phoi  (thay frappe.client.get_list 1000)
//   - vanchuyen.api.dieu_hanh.get_items_for_export    (thay N+1 frappe.client.get + get_value)
//   - vanchuyen.api.dieu_hanh.bulk_update_van_chuyen  (thay vòng lặp set_value)
// XLSX lazy-load. Field production đọc qua alias ASCII do API trả (F trỏ alias).

// ── CSS gốc (prefix rvhg-, không đụng vc-) — inject 1 lần ────────────────────
const CSS_TEXT = `
:root {
  --rvhg-primary:#7c3aed; --rvhg-primary-light:#a78bfa; --rvhg-primary-dark:#5b21b6;
  --rvhg-secondary:#06b6d4; --rvhg-accent:#f472b6; --rvhg-success:#10b981; --rvhg-warning:#f59e0b; --rvhg-danger:#ef4444;
  --rvhg-gray-50:#f9fafb; --rvhg-gray-100:#f3f4f6; --rvhg-gray-200:#e5e7eb; --rvhg-gray-300:#d1d5db; --rvhg-gray-400:#9ca3af;
  --rvhg-gray-500:#6b7280; --rvhg-gray-600:#4b5563; --rvhg-gray-700:#374151; --rvhg-gray-800:#1f2937; --rvhg-gray-900:#111827;
  --rvhg-glass-bg:rgba(255,255,255,0.85); --rvhg-glass-border:rgba(255,255,255,0.4);
  --rvhg-shadow-sm:0 1px 2px 0 rgb(0 0 0 / 0.05); --rvhg-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1);
  --rvhg-shadow-md:0 10px 15px -3px rgb(0 0 0 / 0.1); --rvhg-shadow-lg:0 20px 25px -5px rgb(0 0 0 / 0.1);
  --rvhg-shadow-xl:0 25px 50px -12px rgb(0 0 0 / 0.25);
}
.rvhg-app, .rvhg-app *, .rvhg-modal, .rvhg-modal * { margin:0; padding:0; box-sizing:border-box; }
.rvhg-app {
  font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:linear-gradient(135deg,#667eea 0%,#764ba2 50%,#f093fb 100%); background-attachment:fixed;
  min-height:100vh; padding:24px; position:relative; color:var(--rvhg-gray-800); margin:-1rem;
}
.rvhg-app::before { content:''; position:absolute; inset:0; background:
  radial-gradient(circle at 20% 80%, rgba(120,119,198,0.3) 0%, transparent 50%),
  radial-gradient(circle at 80% 20%, rgba(255,119,198,0.3) 0%, transparent 50%),
  radial-gradient(circle at 40% 40%, rgba(120,200,255,0.2) 0%, transparent 40%);
  pointer-events:none; z-index:0; }
.rvhg-container { max-width:1500px; margin:0 auto; position:relative; z-index:1; }
.rvhg-glass-card { background:var(--rvhg-glass-bg); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);
  border-radius:24px; box-shadow:var(--rvhg-shadow-xl), inset 0 1px 0 var(--rvhg-glass-border);
  border:1px solid var(--rvhg-glass-border); padding:28px; margin-bottom:24px; transition:transform .3s ease, box-shadow .3s ease; }
.rvhg-glass-card:hover { transform:translateY(-2px); box-shadow:0 30px 60px -12px rgb(0 0 0 / 0.3); }
.rvhg-header { background:linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%); }
.rvhg-header-content { display:flex; align-items:center; gap:24px; margin-bottom:24px; flex-wrap:wrap; }
.rvhg-header-icon { background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%); padding:20px;
  border-radius:20px; display:flex; align-items:center; justify-content:center; box-shadow:0 10px 30px rgba(124,58,237,0.4); }
.rvhg-header-icon svg { width:40px; height:40px; stroke:white; fill:none; stroke-width:2; }
.rvhg-header-title h1 { font-size:2.4em; background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:6px; font-weight:800; letter-spacing:-.5px; }
.rvhg-header-title p { color:var(--rvhg-gray-500); font-size:1em; font-weight:500; }
.rvhg-data-counter { background:linear-gradient(135deg,var(--rvhg-success) 0%,#059669 100%); color:white; padding:8px 16px;
  border-radius:12px; font-weight:700; font-size:.9em; display:inline-flex; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(16,185,129,0.3); }
.rvhg-time-range-section { background:linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.5) 100%);
  padding:16px 24px; border-radius:18px; border:1px solid var(--rvhg-gray-200); margin-bottom:16px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.rvhg-time-range-label { font-weight:700; color:var(--rvhg-gray-700); font-size:.95em; display:flex; align-items:center; gap:8px; }
.rvhg-time-range-buttons { display:flex; gap:8px; flex-wrap:wrap; }
.rvhg-time-btn { padding:10px 18px; border-radius:12px; border:2px solid var(--rvhg-gray-200); background:white; cursor:pointer;
  font-weight:600; font-size:13px; transition:all .25s ease; color:var(--rvhg-gray-700); font-family:inherit; }
.rvhg-time-btn:hover { border-color:var(--rvhg-primary-light); transform:translateY(-2px); }
.rvhg-time-btn.rvhg-active { background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%); color:white; border-color:transparent; box-shadow:0 6px 16px rgba(124,58,237,0.3); }
.rvhg-filters-section { background:linear-gradient(135deg,var(--rvhg-gray-50) 0%,white 100%); padding:20px 24px; border-radius:20px; border:1px solid var(--rvhg-gray-200); }
.rvhg-filters-row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
.rvhg-filter-chip { padding:12px 20px; border-radius:14px; border:2px solid var(--rvhg-gray-200); background:white; cursor:pointer;
  font-weight:600; font-size:14px; transition:all .25s cubic-bezier(.4,0,.2,1); display:flex; align-items:center; gap:8px;
  color:var(--rvhg-gray-700); position:relative; overflow:hidden; font-family:inherit; }
.rvhg-filter-chip::before { content:''; position:absolute; inset:0; background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%); opacity:0; transition:opacity .25s ease; z-index:0; }
.rvhg-filter-chip span { position:relative; z-index:1; }
.rvhg-filter-chip:hover { border-color:var(--rvhg-primary-light); transform:translateY(-2px); box-shadow:0 8px 20px rgba(124,58,237,0.15); }
.rvhg-filter-chip.rvhg-active { border-color:var(--rvhg-primary); color:white; box-shadow:0 8px 24px rgba(124,58,237,0.35); }
.rvhg-filter-chip.rvhg-active::before { opacity:1; }
.rvhg-filter-select { padding:12px 16px; border:2px solid var(--rvhg-gray-200); border-radius:14px; font-weight:600; font-size:14px;
  background:white; cursor:pointer; transition:all .25s ease; color:var(--rvhg-gray-700); min-width:160px; font-family:inherit; }
.rvhg-filter-select:hover { border-color:var(--rvhg-primary-light); }
.rvhg-filter-select:focus { outline:none; border-color:var(--rvhg-primary); box-shadow:0 0 0 4px rgba(124,58,237,0.1); }
.rvhg-date-input { padding:12px 16px; border:2px solid var(--rvhg-gray-200); border-radius:14px; font-size:14px; font-weight:600;
  background:white; cursor:pointer; transition:all .25s ease; color:var(--rvhg-gray-700); font-family:inherit; }
.rvhg-date-input:focus { outline:none; border-color:var(--rvhg-primary); box-shadow:0 0 0 4px rgba(124,58,237,0.1); }
.rvhg-po-search-input { padding:12px 16px; border:2px solid var(--rvhg-gray-200); border-radius:14px; font-size:14px; font-weight:600;
  background:white; transition:all .25s ease; color:var(--rvhg-gray-700); font-family:inherit; min-width:180px; }
.rvhg-po-search-input:focus { outline:none; border-color:var(--rvhg-primary); box-shadow:0 0 0 4px rgba(124,58,237,0.1); }
.rvhg-po-search-input::placeholder { color:var(--rvhg-gray-400); font-weight:500; }
.rvhg-filter-toggle-btn { padding:12px 18px; background:linear-gradient(135deg,var(--rvhg-gray-100) 0%,var(--rvhg-gray-50) 100%);
  border:2px solid var(--rvhg-gray-200); border-radius:14px; cursor:pointer; font-weight:600; color:var(--rvhg-gray-600);
  transition:all .25s ease; display:flex; align-items:center; gap:10px; font-size:14px; font-family:inherit; }
.rvhg-filter-toggle-btn:hover { background:white; border-color:var(--rvhg-primary-light); color:var(--rvhg-primary); }
.rvhg-filter-toggle-btn .rvhg-arrow { transition:transform .3s ease; font-size:12px; }
.rvhg-filter-toggle-btn.rvhg-expanded .rvhg-arrow { transform:rotate(180deg); }
.rvhg-filter-status { padding:10px 16px; background:linear-gradient(135deg,#dbeafe 0%,#e0e7ff 100%); border-radius:12px; font-size:.9em;
  color:var(--rvhg-primary-dark); font-weight:700; margin-left:auto; border:1px solid rgba(124,58,237,0.2); }
.rvhg-advanced-filters { margin-top:16px; display:none; background:white; padding:20px; border-radius:16px; border:1px solid var(--rvhg-gray-200); animation:rvhgSlideDown .3s ease; }
@keyframes rvhgSlideDown { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
.rvhg-advanced-filters.rvhg-show { display:block; }
.rvhg-filters-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; }
.rvhg-filter-group { display:flex; flex-direction:column; gap:8px; }
.rvhg-filter-group label { font-size:.85em; font-weight:700; color:var(--rvhg-gray-600); text-transform:uppercase; letter-spacing:.5px; }
.rvhg-filter-group input, .rvhg-filter-group select { padding:12px 14px; border:2px solid var(--rvhg-gray-200); border-radius:12px;
  font-size:14px; transition:all .25s ease; font-family:inherit; background:white; color:var(--rvhg-gray-700); }
.rvhg-filter-group input:focus, .rvhg-filter-group select:focus { outline:none; border-color:var(--rvhg-primary); box-shadow:0 0 0 4px rgba(124,58,237,0.1); }
.rvhg-stats-dashboard { background:linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.9) 100%); }
.rvhg-stats-title { font-size:1.5em; font-weight:800; color:var(--rvhg-gray-800); margin-bottom:24px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.rvhg-stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; }
.rvhg-stat-card { background:white; padding:20px; border-radius:18px; border:2px solid var(--rvhg-gray-200); cursor:pointer;
  transition:all .3s cubic-bezier(.4,0,.2,1); position:relative; overflow:hidden; }
.rvhg-stat-card::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,var(--rvhg-primary),var(--rvhg-accent)); transform:scaleX(0); transition:transform .3s ease; }
.rvhg-stat-card:hover { border-color:var(--rvhg-primary-light); box-shadow:0 12px 28px rgba(124,58,237,0.15); transform:translateY(-4px); }
.rvhg-stat-card:hover::before { transform:scaleX(1); }
.rvhg-stat-card.rvhg-active { border-color:var(--rvhg-primary); background:linear-gradient(135deg,#faf5ff 0%,#f3e8ff 100%); box-shadow:0 12px 28px rgba(124,58,237,0.25); }
.rvhg-stat-card.rvhg-active::before { transform:scaleX(1); }
.rvhg-stat-card-header { font-size:.9em; color:var(--rvhg-gray-500); margin-bottom:10px; font-weight:600; }
.rvhg-stat-card-value { font-size:2.8em; font-weight:800; background:linear-gradient(135deg,var(--rvhg-gray-800) 0%,var(--rvhg-gray-600) 100%);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.rvhg-stat-card-label { font-size:.95em; color:var(--rvhg-gray-600); margin-top:4px; font-weight:600; }
.rvhg-card-title { font-size:1.6em; font-weight:800; color:var(--rvhg-gray-800); margin-bottom:24px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.rvhg-status-legend { margin-left:auto; display:flex; gap:10px; font-size:.55em; font-weight:600; flex-wrap:wrap; }
.rvhg-status-legend-item { padding:8px 14px; border-radius:10px; white-space:nowrap; cursor:pointer; transition:all .25s ease; border:2px solid transparent; }
.rvhg-status-legend-item:hover { transform:translateY(-2px); box-shadow:0 6px 16px rgba(0,0,0,0.12); }
.rvhg-status-legend-item.rvhg-active { border-color:var(--rvhg-primary); box-shadow:0 6px 16px rgba(124,58,237,0.25); transform:translateY(-2px); }
.rvhg-status-processing { background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%); color:#92400e; }
.rvhg-status-delivering { background:linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%); color:#1e3a8a; }
.rvhg-status-delivered { background:linear-gradient(135deg,#fed7aa 0%,#fdba74 100%); color:#9a3412; }
.rvhg-status-submitted { background:linear-gradient(135deg,#d1fae5 0%,#a7f3d0 100%); color:#065f46; }
.rvhg-btn { padding:14px 22px; border-radius:14px; font-weight:700; cursor:pointer; transition:all .3s cubic-bezier(.4,0,.2,1);
  border:none; font-size:15px; display:flex; align-items:center; justify-content:center; gap:10px; position:relative; overflow:hidden; font-family:inherit; color:white; }
.rvhg-btn::before { content:''; position:absolute; top:0; left:-100%; width:100%; height:100%; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent); transition:left .5s ease; }
.rvhg-btn:hover::before { left:100%; }
.rvhg-btn:disabled { opacity:.5; cursor:not-allowed; }
.rvhg-btn:not(:disabled):hover { box-shadow:0 12px 28px rgba(0,0,0,0.2); transform:translateY(-3px); }
.rvhg-btn:not(:disabled):active { transform:translateY(-1px); }
.rvhg-btn-primary { background:linear-gradient(135deg,#10b981 0%,#059669 100%); }
.rvhg-btn-secondary { background:linear-gradient(135deg,#f97316 0%,#dc2626 100%); }
.rvhg-btn-tertiary { background:linear-gradient(135deg,#3b82f6 0%,#6366f1 100%); }
.rvhg-btn-warning { background:linear-gradient(135deg,#eab308 0%,#f97316 100%); }
.rvhg-btn-purple { background:linear-gradient(135deg,#a855f7 0%,#7c3aed 100%); }
.rvhg-btn-neutral { background:linear-gradient(135deg,#9ca3af 0%,#6b7280 100%); }
.rvhg-btn-gray { background:var(--rvhg-gray-200); color:var(--rvhg-gray-700); }
.rvhg-invoice-list { display:flex; flex-direction:column; gap:8px; }
.rvhg-invoice-item { padding:12px 14px; border-radius:12px; border:1px solid var(--rvhg-gray-200); background:white; cursor:pointer; transition:all .2s ease; position:relative; overflow:hidden; font-size:.875rem; }
.rvhg-invoice-item::after { content:''; position:absolute; top:0; left:0; width:3px; height:100%; background:linear-gradient(180deg,var(--rvhg-primary),var(--rvhg-accent)); opacity:0; transition:opacity .2s ease; }
.rvhg-invoice-item:hover { border-color:var(--rvhg-primary-light); box-shadow:0 4px 14px rgba(124,58,237,0.1); transform:translateX(2px); }
.rvhg-invoice-item:hover::after { opacity:1; }
.rvhg-invoice-item.rvhg-selected { border-color:var(--rvhg-primary); background:linear-gradient(135deg,#faf5ff 0%,#f3e8ff 100%) !important; box-shadow:0 4px 14px rgba(124,58,237,0.15); }
.rvhg-invoice-item.rvhg-selected::after { opacity:1; }
.rvhg-invoice-actions { display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid var(--rvhg-gray-200); }
.rvhg-btn-view { flex:1; padding:6px 12px; border-radius:8px; border:1px solid var(--rvhg-primary); background:white; color:var(--rvhg-primary);
  cursor:pointer; font-weight:600; font-size:12px; transition:all .2s ease; display:flex; align-items:center; justify-content:center; gap:6px; font-family:inherit; }
.rvhg-btn-view:hover { background:var(--rvhg-primary); color:white; }
.rvhg-invoice-header { display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:12px; }
.rvhg-invoice-info { flex:1; min-width:0; }
.rvhg-invoice-id { font-weight:700; color:var(--rvhg-primary); margin-bottom:4px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:.875rem; }
.rvhg-badge { padding:2px 8px; border-radius:12px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.3px; display:inline-block; line-height:1.4; }
.rvhg-badge-green { background:linear-gradient(135deg,#d1fae5 0%,#a7f3d0 100%); color:#065f46; }
.rvhg-badge-orange { background:linear-gradient(135deg,#fed7aa 0%,#fdba74 100%); color:#9a3412; }
.rvhg-badge-blue { background:linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%); color:#1e3a8a; }
.rvhg-badge-yellow { background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%); color:#92400e; }
.rvhg-badge-purple { background:linear-gradient(135deg,#e9d5ff 0%,#d8b4fe 100%); color:#6b21a8; }
.rvhg-badge-po { background:linear-gradient(135deg,#cffafe 0%,#a5f3fc 100%); color:#155e75; font-family:'SF Mono',Monaco,Consolas,monospace; text-transform:none; letter-spacing:0; }
.rvhg-invoice-customer { font-size:.95rem; font-weight:600; color:var(--rvhg-gray-800); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rvhg-invoice-meta { color:var(--rvhg-gray-500); font-size:.8rem; line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rvhg-invoice-meta-address { color:var(--rvhg-gray-500); font-size:.75rem; line-height:1.4; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rvhg-invoice-vehicle { color:var(--rvhg-success); font-size:.8rem; margin-top:8px; font-weight:600; padding-top:8px; border-top:1px solid rgba(16,185,129,0.2); }
.rvhg-invoice-stats { display:flex; gap:14px; flex-shrink:0; }
.rvhg-stat-item { text-align:center; min-width:56px; }
.rvhg-stat-label { color:var(--rvhg-gray-500); font-size:.65rem; margin-bottom:2px; font-weight:600; text-transform:uppercase; letter-spacing:.3px; }
.rvhg-stat-value { font-weight:700; font-size:1rem; color:var(--rvhg-gray-800); line-height:1.2; }
.rvhg-stat-value-date { font-size:.8rem; }
.rvhg-load-more-section { display:flex; justify-content:center; padding:20px; margin-top:16px; }
.rvhg-btn-load-more { padding:16px 40px; border-radius:16px; background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%);
  color:white; border:none; font-weight:700; font-size:16px; cursor:pointer; transition:all .3s ease; display:flex; align-items:center; gap:12px; box-shadow:0 8px 24px rgba(124,58,237,0.3); font-family:inherit; }
.rvhg-btn-load-more:hover:not(:disabled) { transform:translateY(-3px); box-shadow:0 12px 32px rgba(124,58,237,0.4); }
.rvhg-btn-load-more:disabled { opacity:.6; cursor:not-allowed; }
.rvhg-spinner { width:20px; height:20px; border:3px solid rgba(255,255,255,0.3); border-top-color:white; border-radius:50%; animation:rvhgSpin .8s linear infinite; }
@keyframes rvhgSpin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
.rvhg-bottom-pagination { display:flex; justify-content:center; align-items:center; gap:12px; padding:24px; margin-top:20px;
  background:linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%); border-radius:20px; border:1px solid var(--rvhg-glass-border); flex-wrap:wrap; }
.rvhg-bottom-pagination button { padding:12px 24px; border:none; border-radius:14px; background:linear-gradient(135deg,var(--rvhg-primary) 0%,#6366f1 100%);
  color:white; cursor:pointer; font-weight:700; font-size:14px; transition:all .3s ease; font-family:inherit; }
.rvhg-bottom-pagination button:hover:not(:disabled) { box-shadow:0 8px 24px rgba(124,58,237,0.3); transform:translateY(-2px); }
.rvhg-bottom-pagination button:disabled { opacity:.4; cursor:not-allowed; background:var(--rvhg-gray-400); }
.rvhg-bottom-pagination button.rvhg-first-page { background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); }
.rvhg-bottom-pagination span { font-size:15px; color:var(--rvhg-gray-700); font-weight:700; padding:0 16px; }
.rvhg-page-numbers { display:flex; gap:8px; }
.rvhg-page-num { width:40px; height:40px; border-radius:12px; border:2px solid var(--rvhg-gray-200); background:white; color:var(--rvhg-gray-700);
  font-weight:700; cursor:pointer; transition:all .25s ease; display:flex; align-items:center; justify-content:center; font-family:inherit; }
.rvhg-page-num:hover { border-color:var(--rvhg-primary-light); color:var(--rvhg-primary); }
.rvhg-page-num.rvhg-active { background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%); color:white; border-color:transparent; }
.rvhg-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); align-items:center; justify-content:center; padding:20px; z-index:99999; font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; }
.rvhg-modal.rvhg-detail { z-index:100000; }
.rvhg-modal.rvhg-show { display:flex; }
.rvhg-modal-inner { background:white; border-radius:28px; box-shadow:var(--rvhg-shadow-xl); max-width:900px; width:100%; max-height:90vh; overflow-y:auto; padding:36px; animation:rvhgModalIn .3s ease; color:var(--rvhg-gray-800); }
@keyframes rvhgModalIn { from{opacity:0;transform:scale(.95) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }
.rvhg-modal-heading { font-size:1.7em; font-weight:800; color:var(--rvhg-gray-800); margin-bottom:28px; }
.rvhg-action-buttons { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-bottom:24px; }
.rvhg-detail-header { display:flex; justify-content:space-between; align-items:start; margin-bottom:28px; padding-bottom:20px; border-bottom:2px solid var(--rvhg-gray-200); }
.rvhg-detail-title { font-size:1.6em; font-weight:800; color:var(--rvhg-gray-800); }
.rvhg-detail-close { background:var(--rvhg-gray-100); border:none; width:40px; height:40px; border-radius:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:22px; color:var(--rvhg-gray-500); transition:all .25s ease; font-family:inherit; }
.rvhg-detail-close:hover { background:var(--rvhg-gray-200); color:var(--rvhg-gray-800); transform:rotate(90deg); }
.rvhg-detail-section { margin-bottom:24px; }
.rvhg-detail-section-title { font-size:1.15em; font-weight:800; color:var(--rvhg-gray-700); margin-bottom:14px; display:flex; align-items:center; gap:10px; }
.rvhg-detail-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; }
.rvhg-detail-item { background:var(--rvhg-gray-50); padding:14px; border-radius:14px; border:1px solid var(--rvhg-gray-200); }
.rvhg-detail-item-po { background:linear-gradient(135deg,#ecfeff 0%,#cffafe 100%); border-color:#67e8f9; }
.rvhg-detail-label { font-size:.85em; color:var(--rvhg-gray-500); font-weight:700; margin-bottom:6px; text-transform:uppercase; letter-spacing:.5px; }
.rvhg-detail-value { font-size:1.05em; color:var(--rvhg-gray-800); font-weight:700; word-break:break-word; }
.rvhg-detail-value-po { font-family:'SF Mono',Monaco,Consolas,monospace; color:#155e75; }
.rvhg-detail-link { display:inline-flex; align-items:center; gap:10px; padding:14px 24px; background:linear-gradient(135deg,var(--rvhg-primary) 0%,#6366f1 100%); color:white; text-decoration:none; border-radius:14px; font-weight:700; transition:all .3s ease; margin-top:20px; }
.rvhg-detail-link:hover { box-shadow:0 12px 28px rgba(124,58,237,0.35); transform:translateY(-3px); color:white; text-decoration:none; }
.rvhg-selection-bar { position:sticky; top:8px; z-index:95; background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%); color:white; padding:10px 14px; border-radius:12px; margin-bottom:12px; box-shadow:0 8px 24px rgba(124,58,237,0.3); display:none; align-items:center; gap:10px; flex-wrap:wrap; animation:rvhgSelSlide .2s ease; }
.rvhg-selection-bar.rvhg-show { display:flex; }
@keyframes rvhgSelSlide { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
.rvhg-selection-count { font-weight:700; font-size:.875rem; display:flex; align-items:center; gap:8px; padding-right:10px; border-right:1px solid rgba(255,255,255,0.3); }
.rvhg-selection-count-num { background:rgba(255,255,255,0.25); padding:3px 10px; border-radius:8px; min-width:28px; text-align:center; font-weight:800; }
.rvhg-selection-bar-actions { display:flex; gap:6px; flex-wrap:wrap; flex:1; }
.rvhg-sel-btn { background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.35); color:white; padding:6px 12px; border-radius:8px; font-size:.8rem; font-weight:600; cursor:pointer; transition:all .15s ease; display:inline-flex; align-items:center; gap:6px; font-family:inherit; }
.rvhg-sel-btn:hover { background:rgba(255,255,255,0.35); }
.rvhg-sel-btn.rvhg-primary-action { background:white; color:var(--rvhg-primary); font-weight:700; }
.rvhg-sel-btn.rvhg-primary-action:hover { background:rgba(255,255,255,0.9); }
.rvhg-selection-clear { background:transparent; border:1px solid rgba(255,255,255,0.4); color:white; padding:6px 10px; border-radius:8px; cursor:pointer; font-size:.8rem; margin-left:auto; transition:all .15s ease; font-family:inherit; }
.rvhg-selection-clear:hover { background:rgba(239,68,68,0.9); border-color:rgba(239,68,68,0.9); }
.rvhg-checkbox { position:relative; width:18px; height:18px; border:2px solid var(--rvhg-gray-300); border-radius:4px; background:white; cursor:pointer; transition:all .12s ease; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; margin-top:2px; }
.rvhg-checkbox:hover { border-color:var(--rvhg-primary); }
.rvhg-checkbox.rvhg-checked { background:var(--rvhg-primary); border-color:var(--rvhg-primary); }
.rvhg-checkbox.rvhg-checked::after { content:''; width:4px; height:8px; border:solid white; border-width:0 2px 2px 0; transform:rotate(45deg) translate(-1px,-1px); }
.rvhg-checkbox.rvhg-indeterminate { background:var(--rvhg-primary); border-color:var(--rvhg-primary); }
.rvhg-checkbox.rvhg-indeterminate::after { content:''; width:8px; height:2px; background:white; border-radius:1px; }
.rvhg-list-toolbar { display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--rvhg-gray-50); border:1px solid var(--rvhg-gray-200); border-radius:10px; margin-bottom:8px; font-size:.82rem; color:var(--rvhg-gray-700); }
.rvhg-list-toolbar-label { font-weight:600; cursor:pointer; user-select:none; display:flex; align-items:center; gap:8px; }
.rvhg-keyboard-hint { margin-left:auto; font-size:.72rem; color:var(--rvhg-gray-500); }
.rvhg-keyboard-hint kbd { display:inline-block; padding:1px 5px; background:white; border:1px solid var(--rvhg-gray-300); border-radius:4px; font-size:.68rem; font-family:monospace; color:var(--rvhg-gray-700); margin:0 1px; }
.rvhg-invoice-row { display:flex; align-items:flex-start; gap:10px; }
.rvhg-invoice-row-content { flex:1; min-width:0; }
.rvhg-floating-action-btn { position:fixed; right:30px; bottom:30px; width:72px; height:72px; border-radius:50%; background:linear-gradient(135deg,var(--rvhg-primary) 0%,var(--rvhg-accent) 100%); color:white; border:none; box-shadow:0 12px 32px rgba(124,58,237,0.5); cursor:pointer; display:none; align-items:center; justify-content:center; font-size:28px; transition:all .3s cubic-bezier(.4,0,.2,1); z-index:9999; font-family:inherit; }
.rvhg-floating-action-btn.rvhg-show { display:flex; animation:rvhgBounceIn .5s ease; }
@keyframes rvhgBounceIn { 0%{opacity:0;transform:scale(.3)} 50%{transform:scale(1.1)} 100%{opacity:1;transform:scale(1)} }
.rvhg-floating-action-btn:hover { transform:scale(1.1) rotate(5deg); box-shadow:0 16px 40px rgba(124,58,237,0.6); }
.rvhg-count-badge { position:absolute; top:-6px; right:-6px; background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%); color:white; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; border:3px solid white; box-shadow:0 4px 12px rgba(239,68,68,0.4); }
.rvhg-loading { text-align:center; padding:60px 20px; color:var(--rvhg-gray-500); font-size:1.1em; }
.rvhg-loading svg { animation:rvhgSpin 1s linear infinite; }
.rvhg-error-msg { background:linear-gradient(135deg,#fee2e2 0%,#fecaca 100%); border:2px solid #fca5a5; color:#991b1b; padding:20px; border-radius:16px; margin-bottom:20px; font-weight:600; }
.rvhg-toast-container { position:fixed; top:1rem; right:1rem; z-index:100001; font-family:'Inter',sans-serif; }
.rvhg-toast { padding:14px 20px; border-radius:14px; margin-bottom:10px; font-weight:600; color:white; box-shadow:0 12px 30px rgba(0,0,0,0.15); animation:rvhgToastIn .3s ease; display:flex; align-items:center; gap:10px; min-width:250px; }
@keyframes rvhgToastIn { from{opacity:0;transform:translateX(100%)} to{opacity:1;transform:translateX(0)} }
.rvhg-toast-success { background:linear-gradient(135deg,#10b981 0%,#059669 100%); }
.rvhg-toast-error { background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%); }
.rvhg-toast-info { background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%); }
.rvhg-toast-warning { background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%); }
@media (max-width:768px) {
  .rvhg-app { padding:16px; margin:-1rem; }
  .rvhg-header-title h1 { font-size:1.7em; }
  .rvhg-invoice-header { flex-direction:column; }
  .rvhg-action-buttons { grid-template-columns:1fr; }
  .rvhg-modal-inner { padding:24px; }
  .rvhg-filters-grid { grid-template-columns:1fr; }
  .rvhg-floating-action-btn { right:20px; bottom:20px; width:64px; height:64px; }
  .rvhg-status-legend { width:100%; margin-left:0; margin-top:12px; }
  .rvhg-card-title { font-size:1.3em; }
  .rvhg-filter-status { width:100%; margin-left:0; margin-top:12px; }
  .rvhg-stats-grid { grid-template-columns:repeat(2,1fr); }
  .rvhg-bottom-pagination { gap:8px; }
  .rvhg-bottom-pagination button { padding:10px 16px; font-size:13px; }
  .rvhg-page-numbers { display:none; }
  .rvhg-po-search-input { width:100%; }
  .rvhg-selection-bar { gap:6px; padding:8px 10px; }
  .rvhg-selection-count { font-size:.8rem; padding-right:8px; }
  .rvhg-sel-btn { font-size:.7rem; padding:5px 8px; }
  .rvhg-keyboard-hint { display:none; }
}
`;

// ── Markup gốc (DOM), giữ nguyên id ──────────────────────────────────────────
const MARKUP = `
<div class="rvhg-app" id="rvhg-app"><div class="rvhg-container">
  <div class="rvhg-header rvhg-glass-card">
    <div class="rvhg-header-content">
      <div class="rvhg-header-icon"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
      <div class="rvhg-header-title"><h1>🚚 Quản lý Vận chuyển</h1><p>Phân công vận chuyển và xuất báo cáo</p></div>
      <div class="rvhg-data-counter" id="rvhg-data-counter">📊 Đang tải...</div>
    </div>
    <div class="rvhg-time-range-section">
      <div class="rvhg-time-range-label">⏱️ Khoảng thời gian:</div>
      <div class="rvhg-time-range-buttons">
        <button class="rvhg-time-btn rvhg-active" type="button" data-range="30">30 ngày</button>
        <button class="rvhg-time-btn" type="button" data-range="60">60 ngày</button>
        <button class="rvhg-time-btn" type="button" data-range="90">90 ngày</button>
        <button class="rvhg-time-btn" type="button" data-range="all">Tất cả</button>
      </div>
      <div style="margin-left:auto;color:var(--rvhg-gray-600);font-weight:600;font-size:.85em;" id="rvhg-time-range-info">Từ: ...</div>
    </div>
    <div class="rvhg-filters-section">
      <div class="rvhg-filters-row">
        <button class="rvhg-filter-chip" id="rvhg-filter-today" type="button"><span>📅 Hôm nay</span></button>
        <button class="rvhg-filter-chip" id="rvhg-filter-yesterday" type="button"><span>📆 Hôm qua</span></button>
        <input type="date" id="rvhg-filter-date" class="rvhg-date-input" />
        <input type="text" id="rvhg-filter-po-quick" class="rvhg-po-search-input" placeholder="🔢 Số PO..." />
        <select id="rvhg-filter-status" class="rvhg-filter-select">
          <option value="">📋 Tất cả trạng thái</option>
          <option value="Đang xử lý">⏳ Đang xử lý</option>
          <option value="Đang giao hàng">🚚 Đang giao hàng</option>
          <option value="Đã giao hàng, chụp chứng từ">📸 Đã giao hàng</option>
          <option value="Đã nộp chứng từ">✅ Đã nộp chứng từ</option>
        </select>
        <button class="rvhg-filter-toggle-btn" id="rvhg-advanced-toggle" type="button"><span>🔧 Lọc nâng cao</span><span class="rvhg-arrow">▼</span></button>
        <button class="rvhg-filter-chip" id="rvhg-clear-filter-btn" type="button"><span>❌ Xóa lọc</span></button>
        <div class="rvhg-filter-status" id="rvhg-filter-status-text">Đang tải...</div>
      </div>
      <div class="rvhg-advanced-filters" id="rvhg-advanced-content">
        <div class="rvhg-filters-grid">
          <div class="rvhg-filter-group"><label>Từ ngày</label><input type="date" id="rvhg-filter-from-date" /></div>
          <div class="rvhg-filter-group"><label>Đến ngày</label><input type="date" id="rvhg-filter-to-date" /></div>
          <div class="rvhg-filter-group"><label>Khách hàng</label><input type="text" id="rvhg-filter-customer" placeholder="Tên khách hàng..." /></div>
          <div class="rvhg-filter-group"><label>Chi tiết địa chỉ</label><input type="text" id="rvhg-filter-address-name" placeholder="Địa chỉ chi tiết..." /></div>
          <div class="rvhg-filter-group"><label>Số PO</label><input type="text" id="rvhg-filter-po" placeholder="Số PO khách hàng..." /></div>
          <div class="rvhg-filter-group"><label>Nhóm khách hàng</label><select id="rvhg-filter-customer-group"><option value="">Tất cả</option></select></div>
        </div>
        <div style="margin-top:16px;"><button class="rvhg-btn rvhg-btn-tertiary" id="rvhg-apply-advanced-btn" type="button">🔍 Áp dụng bộ lọc</button></div>
      </div>
    </div>
  </div>

  <div class="rvhg-stats-dashboard rvhg-glass-card">
    <div class="rvhg-stats-title"><span>📊 Thống kê vận chuyển</span><span style="font-size:.65em;color:var(--rvhg-gray-500);font-weight:600;" id="rvhg-stats-period">(30 ngày gần nhất)</span></div>
    <div class="rvhg-stats-grid" id="rvhg-stats-grid"></div>
  </div>

  <div class="rvhg-glass-card">
    <div class="rvhg-card-title">📦 Danh sách đơn hàng<div class="rvhg-status-legend" id="rvhg-status-legend"></div></div>
    <div class="rvhg-selection-bar" id="rvhg-selection-bar">
      <div class="rvhg-selection-count"><span class="rvhg-selection-count-num" id="rvhg-sel-count">0</span><span id="rvhg-sel-count-text">đơn đã chọn</span></div>
      <div class="rvhg-selection-bar-actions">
        <button class="rvhg-sel-btn rvhg-primary-action" id="rvhg-sel-assign" type="button">🚛 Phân công vận chuyển</button>
        <button class="rvhg-sel-btn" id="rvhg-sel-status" type="button">📋 Cập nhật trạng thái</button>
        <button class="rvhg-sel-btn" id="rvhg-sel-export" type="button">📥 Xuất Excel</button>
      </div>
      <button class="rvhg-selection-clear" id="rvhg-sel-clear" type="button" title="Bỏ chọn (Esc)">✕ Bỏ chọn</button>
    </div>
    <div class="rvhg-list-toolbar" id="rvhg-list-toolbar" style="display:none;">
      <label class="rvhg-list-toolbar-label" id="rvhg-master-checkbox-label"><span class="rvhg-checkbox" id="rvhg-master-checkbox"></span><span id="rvhg-master-text">Chọn tất cả trong trang này</span></label>
      <span class="rvhg-keyboard-hint"><kbd>Shift</kbd>+Click: chọn dải · <kbd>Ctrl</kbd>+<kbd>A</kbd>: chọn tất cả · <kbd>Esc</kbd>: bỏ chọn</span>
    </div>
    <div id="rvhg-invoice-list" class="rvhg-invoice-list"></div>
    <div class="rvhg-bottom-pagination">
      <button id="rvhg-btn-first" type="button" class="rvhg-first-page">⏮ Đầu</button>
      <button id="rvhg-btn-prev" type="button">◀ Trước</button>
      <div class="rvhg-page-numbers" id="rvhg-page-numbers"></div>
      <span id="rvhg-page-info">Trang 1</span>
      <button id="rvhg-btn-next" type="button">Sau ▶</button>
    </div>
    <div class="rvhg-load-more-section" id="rvhg-load-more-section">
      <button class="rvhg-btn-load-more" id="rvhg-btn-load-more" type="button">📥 Tải thêm 1000 đơn hàng</button>
    </div>
  </div>
</div>
<button class="rvhg-floating-action-btn" id="rvhg-floating-btn" type="button">📊<span class="rvhg-count-badge" id="rvhg-floating-count">0</span></button>
</div>

<div id="rvhg-management-modal" class="rvhg-modal">
  <div class="rvhg-modal-inner">
    <h3 class="rvhg-modal-heading">📊 Chức năng quản lý</h3>
    <div style="background:linear-gradient(135deg,#faf5ff 0%,#f3e8ff 100%);padding:20px;border-radius:18px;margin-bottom:28px;border:2px solid #e9d5ff;">
      <p style="font-weight:800;font-size:1.1em;color:var(--rvhg-gray-800);">Đơn hàng đã chọn: <span id="rvhg-modal-selected-count" style="color:var(--rvhg-primary);">0</span></p>
    </div>
    <div style="margin-bottom:28px;"><label style="display:block;font-weight:800;margin-bottom:14px;font-size:1.1em;color:var(--rvhg-gray-800);">🚛 Phân công hình thức vận chuyển:</label><div class="rvhg-action-buttons" id="rvhg-shipping-type-buttons"></div></div>
    <div style="margin-bottom:28px;"><label style="display:block;font-weight:800;margin-bottom:14px;font-size:1.1em;color:var(--rvhg-gray-800);">📋 Cập nhật trạng thái vận chuyển:</label><div class="rvhg-action-buttons" id="rvhg-status-buttons"></div></div>
    <div style="margin-bottom:28px;"><label style="display:block;font-weight:800;margin-bottom:14px;font-size:1.1em;color:var(--rvhg-gray-800);">📊 Xuất báo cáo Excel (Đơn lẻ):</label><div class="rvhg-action-buttons" id="rvhg-export-single-buttons"></div></div>
    <div style="margin-bottom:28px;"><label style="display:block;font-weight:800;margin-bottom:14px;font-size:1.1em;color:var(--rvhg-gray-800);">📄 Xuất báo cáo Excel (Đơn tổng + Đơn chia):</label><div class="rvhg-action-buttons" id="rvhg-export-combined-buttons"></div></div>
    <div style="display:flex;gap:14px;"><button class="rvhg-btn rvhg-btn-gray" id="rvhg-close-mgmt-btn" type="button" style="flex:1;">✕ Đóng</button></div>
  </div>
</div>

<div id="rvhg-detail-modal" class="rvhg-modal rvhg-detail">
  <div class="rvhg-modal-inner">
    <div class="rvhg-detail-header"><div class="rvhg-detail-title" id="rvhg-detail-invoice-name">Chi tiết đơn hàng</div><button class="rvhg-detail-close" id="rvhg-detail-close-btn" type="button">✕</button></div>
    <div class="rvhg-detail-section"><div class="rvhg-detail-section-title">📋 Thông tin cơ bản</div><div class="rvhg-detail-grid">
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Khách hàng</div><div class="rvhg-detail-value" id="rvhg-detail-customer">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Ngày đơn hàng</div><div class="rvhg-detail-value" id="rvhg-detail-date">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Nhóm khách hàng</div><div class="rvhg-detail-value" id="rvhg-detail-group">-</div></div>
      <div class="rvhg-detail-item rvhg-detail-item-po"><div class="rvhg-detail-label">🔢 Số PO</div><div class="rvhg-detail-value rvhg-detail-value-po" id="rvhg-detail-po">-</div></div>
    </div></div>
    <div class="rvhg-detail-section"><div class="rvhg-detail-section-title">📍 Địa chỉ giao hàng</div><div class="rvhg-detail-grid">
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Tên địa chỉ</div><div class="rvhg-detail-value" id="rvhg-detail-address-name">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Tỉnh/Thành phố</div><div class="rvhg-detail-value" id="rvhg-detail-province">-</div></div>
    </div><div style="margin-top:14px;"><div class="rvhg-detail-item"><div class="rvhg-detail-label">Địa chỉ chi tiết</div><div class="rvhg-detail-value" id="rvhg-detail-address">-</div></div></div></div>
    <div class="rvhg-detail-section"><div class="rvhg-detail-section-title">🚚 Thông tin vận chuyển</div><div class="rvhg-detail-grid">
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Hình thức vận chuyển</div><div class="rvhg-detail-value" id="rvhg-detail-shipping-type">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Trạng thái vận chuyển</div><div class="rvhg-detail-value" id="rvhg-detail-shipping-status">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Xe</div><div class="rvhg-detail-value" id="rvhg-detail-vehicle">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Lái xe</div><div class="rvhg-detail-value" id="rvhg-detail-driver">-</div></div>
    </div></div>
    <div class="rvhg-detail-section"><div class="rvhg-detail-section-title">📦 Thông tin kiện hàng</div><div class="rvhg-detail-grid">
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Tổng kiện</div><div class="rvhg-detail-value" id="rvhg-detail-packages">-</div></div>
      <div class="rvhg-detail-item"><div class="rvhg-detail-label">Thể tích (m³)</div><div class="rvhg-detail-value" id="rvhg-detail-volume">-</div></div>
    </div></div>
    <div class="rvhg-detail-section"><a class="rvhg-detail-link" id="rvhg-detail-erp-link" href="#" target="_blank">🔗 Xem trên ERPNext</a></div>
  </div>
</div>

<div id="rvhg-toast" class="rvhg-toast-container"></div>
`;

// ═══════════════════════════════════════════════════════════════════════════
// STATE + LOGIC (port nguyên trang gốc; F trỏ alias ASCII do API trả về)
// ═══════════════════════════════════════════════════════════════════════════
const F = {
	tinh: "tinh",
	tong_kien: "tong_kien",
	thetichlo: "the_tich_lo",
	shipping_type: "hinh_thuc",
	vehicle: "xe",
	driver: "ten_lai_xe",
	shipping_status: "trang_thai_vc",
	po: "po",
};

let allInvoices = [];
let customerGroups = [];
let selectedInvoices = [];
let shippingTypes = [];
let shippingStatuses = [];
let currentPage = 1;
const itemsPerPage = 20;
const loadBatchSize = 1000;
let totalLoadedRecords = 0;
let loadPageNum = 1;
let isLoading = false;
let hasMoreData = true;
let currentTimeRange = "30";
let lastSelectedIndex = -1;
let _docKbBound = false;

let filters = {
	today: false, yesterday: false, date: "", status: "", fromDate: "", toDate: "",
	customer: "", addressName: "", customerGroup: "", po: "", shippingType: null, statusFilter: null,
};

const shippingTypeConfig = {
	"Viettel Post": { icon: "📮", gradient: "linear-gradient(135deg,#fff5f5 0%,#ffe4e6 100%)", btnClass: "rvhg-btn-tertiary" },
	"Nhất Tín": { icon: "📦", gradient: "linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)", btnClass: "rvhg-btn-secondary" },
	"Tự vận chuyển": { icon: "🚗", gradient: "linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)", btnClass: "rvhg-btn-primary" },
	"Xe vào bốc": { icon: "🚛", gradient: "linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%)", btnClass: "rvhg-btn-purple" },
	"Chưa phân công": { icon: "⚪", gradient: "white", btnClass: "rvhg-btn-neutral" },
};

const regionMapping = {
	"Miền Bắc": ["Hà Nội", "Hải Phòng", "Hải Dương", "Hưng Yên", "Bắc Ninh", "Bắc Giang", "Quảng Ninh", "Vĩnh Phúc", "Thái Nguyên", "Phú Thọ", "Lạng Sơn", "Cao Bằng", "Hà Giang", "Tuyên Quang", "Yên Bái", "Lào Cai", "Điện Biên", "Lai Châu", "Sơn La", "Hòa Bình", "Nam Định", "Thái Bình", "Ninh Bình", "Hà Nam"],
	"Miền Trung": ["Thanh Hóa", "Nghệ An", "Hà Tĩnh", "Quảng Bình", "Quảng Trị", "Thừa Thiên Huế", "Đà Nẵng", "Quảng Nam", "Quảng Ngãi", "Bình Định", "Phú Yên", "Khánh Hòa", "Ninh Thuận", "Bình Thuận", "Kon Tum", "Gia Lai", "Đắk Lắk", "Đắk Nông", "Lâm Đồng"],
	"Miền Nam": ["Hồ Chí Minh", "Đồng Nai", "Bình Dương", "Bà Rịa - Vũng Tàu", "Long An", "Tiền Giang", "Bến Tre", "Vĩnh Long", "Trà Vinh", "Đồng Tháp", "An Giang", "Kiên Giang", "Cần Thơ", "Hậu Giang", "Sóc Trăng", "Bạc Liêu", "Cà Mau", "Tây Ninh", "Bình Phước"],
};

function callMethod(method, args) {
	return new Promise((resolve, reject) => {
		window.frappe.call({ method, args, callback: (r) => resolve(r ? r.message : undefined), error: (e) => reject(e) });
	});
}

function loadXLSX() {
	if (window.XLSX) return Promise.resolve();
	return new Promise((res, rej) => {
		const s = document.createElement("script");
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
		s.onload = () => res();
		s.onerror = () => rej(new Error("Không tải được thư viện Excel"));
		document.head.appendChild(s);
	});
}

function getRegionFromProvince(province) {
	if (!province) return "Miền Bắc";
	for (const [region, provinces] of Object.entries(regionMapping)) {
		if (provinces.some((p) => province.includes(p) || p.includes(province))) return region;
	}
	return "Miền Bắc";
}
function calculatePODeadline(postingDate, province) {
	if (!postingDate) return "";
	const region = getRegionFromProvince(province);
	const date = new Date(postingDate);
	let daysToAdd = 2;
	if (region === "Miền Trung") daysToAdd = 4;
	if (region === "Miền Nam") daysToAdd = 6;
	date.setDate(date.getDate() + daysToAdd);
	return date.toISOString().split("T")[0];
}
function convertToM3(cm3) { return ((cm3 || 0) / 1000000).toFixed(3); }
function getTodayDate() { return new Date().toISOString().split("T")[0]; }
function getYesterdayDate() { const y = new Date(); y.setDate(y.getDate() - 1); return y.toISOString().split("T")[0]; }
function getDateNDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; }
function formatDateToDDMMYYYY(s) { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }
function escapeHtml(str) { const div = document.createElement("div"); div.textContent = String(str || ""); return div.innerHTML; }

function showToast(message, type = "info") {
	const c = document.getElementById("rvhg-toast");
	if (!c) return;
	const toast = document.createElement("div");
	toast.className = `rvhg-toast rvhg-toast-${type}`;
	toast.innerHTML = escapeHtml(message);
	c.appendChild(toast);
	setTimeout(() => toast.remove(), 3500);
}

function getTimeRangeStartDate() {
	if (currentTimeRange === "all") return null;
	return getDateNDaysAgo(parseInt(currentTimeRange, 10));
}
function updateTimeRangeInfo() {
	const startDate = getTimeRangeStartDate();
	const info = document.getElementById("rvhg-time-range-info");
	const period = document.getElementById("rvhg-stats-period");
	if (startDate) {
		info.textContent = `Từ: ${formatDateToDDMMYYYY(startDate)}`;
		period.textContent = `(${currentTimeRange} ngày gần nhất)`;
	} else {
		info.textContent = "Toàn bộ dữ liệu";
		period.textContent = "(Toàn bộ)";
	}
}
function setTimeRange(range) {
	currentTimeRange = range;
	document.querySelectorAll(".rvhg-time-btn").forEach((b) => b.classList.remove("rvhg-active"));
	document.querySelector(`.rvhg-time-btn[data-range="${range}"]`)?.classList.add("rvhg-active");
	updateTimeRangeInfo();
	allInvoices = [];
	totalLoadedRecords = 0;
	loadPageNum = 1;
	hasMoreData = true;
	currentPage = 1;
	selectedInvoices = [];
	document.getElementById("rvhg-load-more-section").style.display = "";
	showLoading();
	loadMoreInvoices().then(() => { renderStatistics(); applyFilters(); });
}

function rebuildShippingTypesFromData() {
	const types = new Set(Object.keys(shippingTypeConfig));
	allInvoices.forEach((inv) => { const t = inv[F.shipping_type]; if (t && t.trim()) types.add(t.trim()); });
	shippingTypes = Array.from(types).sort();
	shippingTypes.forEach((type) => {
		if (!shippingTypeConfig[type]) shippingTypeConfig[type] = { icon: "📋", gradient: "linear-gradient(135deg,#f3f4f6 0%,#e5e7eb 100%)", btnClass: "rvhg-btn-neutral" };
	});
}
function rebuildShippingStatusesFromData() {
	const fixed = ["Đang xử lý", "Đang giao hàng", "Đã giao hàng, chụp chứng từ", "Đã nộp chứng từ"];
	const statuses = new Set(fixed);
	allInvoices.forEach((inv) => { const s = inv[F.shipping_status]; if (s && s.trim()) statuses.add(s.trim()); });
	shippingStatuses = fixed.concat(Array.from(statuses).filter((s) => !fixed.includes(s)).sort());
}

function renderStatusLegend() {
	const legend = document.getElementById("rvhg-status-legend");
	if (!legend) return;
	legend.innerHTML = "";
	const cfg = {
		"Đang xử lý": { icon: "⏳", class: "rvhg-status-processing" },
		"Đang giao hàng": { icon: "🚚", class: "rvhg-status-delivering" },
		"Đã giao hàng, chụp chứng từ": { icon: "📸", class: "rvhg-status-delivered" },
		"Đã nộp chứng từ": { icon: "✅", class: "rvhg-status-submitted" },
	};
	shippingStatuses.forEach((status) => {
		const c = cfg[status] || { icon: "📋", class: "rvhg-status-processing" };
		const item = document.createElement("span");
		item.className = `rvhg-status-legend-item ${c.class}`;
		item.dataset.status = status;
		item.textContent = `${c.icon} ${status}`;
		item.addEventListener("click", () => toggleStatusFilter(status));
		legend.appendChild(item);
	});
}
function renderShippingTypeButtons() {
	const container = document.getElementById("rvhg-shipping-type-buttons");
	container.innerHTML = "";
	shippingTypes.forEach((type) => {
		const config = shippingTypeConfig[type];
		const b = document.createElement("button");
		b.type = "button";
		b.className = `rvhg-btn ${config.btnClass}`;
		b.textContent = `${config.icon} ${type}`;
		b.addEventListener("click", () => assignShippingTypeFromModal(type));
		container.appendChild(b);
	});
}
function renderStatusButtons() {
	const container = document.getElementById("rvhg-status-buttons");
	container.innerHTML = "";
	const styles = {
		"Đang xử lý": { gradient: "linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)", icon: "⏳" },
		"Đang giao hàng": { gradient: "linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)", icon: "🚚" },
		"Đã giao hàng, chụp chứng từ": { gradient: "linear-gradient(135deg,#f97316 0%,#ea580c 100%)", icon: "📸" },
		"Đã nộp chứng từ": { gradient: "linear-gradient(135deg,#10b981 0%,#059669 100%)", icon: "✅" },
	};
	shippingStatuses.forEach((status) => {
		const st = styles[status] || { gradient: "linear-gradient(135deg,#9ca3af 0%,#6b7280 100%)", icon: "📋" };
		const b = document.createElement("button");
		b.type = "button";
		b.className = "rvhg-btn";
		b.style.background = st.gradient;
		b.textContent = `${st.icon} ${status}`;
		b.addEventListener("click", () => updateShippingStatusFromModal(status));
		container.appendChild(b);
	});
}
function renderExportButtons() {
	const hasSelection = selectedInvoices.length > 0;
	const hint = hasSelection ? `(${selectedInvoices.length} đã chọn)` : "";
	const single = document.getElementById("rvhg-export-single-buttons");
	const combined = document.getElementById("rvhg-export-combined-buttons");
	single.innerHTML = ""; combined.innerHTML = "";
	if (hasSelection) {
		const bs = document.createElement("button");
		bs.type = "button"; bs.className = "rvhg-btn rvhg-btn-warning"; bs.textContent = `📊 Đơn đã chọn ${hint}`;
		bs.addEventListener("click", () => exportSingleExcel("selected")); single.appendChild(bs);
		const bc = document.createElement("button");
		bc.type = "button"; bc.className = "rvhg-btn rvhg-btn-purple"; bc.textContent = `📄 Đơn đã chọn ${hint}`;
		bc.addEventListener("click", () => exportCombinedExcel("selected")); combined.appendChild(bc);
	} else {
		shippingTypes.forEach((type) => {
			if (type !== "Chưa phân công") {
				const bs = document.createElement("button");
				bs.type = "button"; bs.className = "rvhg-btn rvhg-btn-warning"; bs.textContent = `📊 ${type}`;
				bs.addEventListener("click", () => exportSingleExcel(type)); single.appendChild(bs);
				const bc = document.createElement("button");
				bc.type = "button"; bc.className = "rvhg-btn rvhg-btn-purple"; bc.textContent = `📄 ${type}`;
				bc.addEventListener("click", () => exportCombinedExcel(type)); combined.appendChild(bc);
			}
		});
	}
}

function calculateStatistics() {
	const stats = {};
	shippingTypes.forEach((type) => { stats[type] = 0; });
	const startDate = getTimeRangeStartDate();
	allInvoices.forEach((inv) => {
		if (startDate && inv.posting_date < startDate) return;
		let type = inv[F.shipping_type];
		if (!type || type.trim() === "") type = "Chưa phân công"; else type = type.trim();
		if (stats[type] === undefined) stats[type] = 0;
		stats[type]++;
	});
	return stats;
}
function renderStatistics() {
	const stats = calculateStatistics();
	const grid = document.getElementById("rvhg-stats-grid");
	if (!grid) return;
	grid.innerHTML = "";
	shippingTypes.forEach((type) => {
		const config = shippingTypeConfig[type];
		const card = document.createElement("div");
		card.className = "rvhg-stat-card";
		card.dataset.type = type;
		card.innerHTML = `<div class="rvhg-stat-card-header">${config.icon} ${escapeHtml(type)}</div><div class="rvhg-stat-card-value">${stats[type] || 0}</div><div class="rvhg-stat-card-label">đơn hàng</div>`;
		card.addEventListener("click", () => toggleShippingTypeFilter(type));
		if (filters.shippingType === type) card.classList.add("rvhg-active");
		grid.appendChild(card);
	});
}

function toggleFilter(filterType) {
	if (filterType === "today") {
		filters.today = !filters.today;
		if (filters.today) { filters.yesterday = false; filters.date = ""; document.getElementById("rvhg-filter-yesterday").classList.remove("rvhg-active"); document.getElementById("rvhg-filter-date").value = ""; }
		document.getElementById("rvhg-filter-today").classList.toggle("rvhg-active", filters.today);
	} else if (filterType === "yesterday") {
		filters.yesterday = !filters.yesterday;
		if (filters.yesterday) { filters.today = false; filters.date = ""; document.getElementById("rvhg-filter-today").classList.remove("rvhg-active"); document.getElementById("rvhg-filter-date").value = ""; }
		document.getElementById("rvhg-filter-yesterday").classList.toggle("rvhg-active", filters.yesterday);
	}
	applyFilters();
}
function toggleStatusFilter(status) {
	filters.statusFilter = filters.statusFilter === status ? null : status;
	document.querySelectorAll(".rvhg-status-legend-item").forEach((item) => item.classList.toggle("rvhg-active", item.dataset.status === filters.statusFilter));
	applyFilters();
}
function toggleShippingTypeFilter(type) {
	filters.shippingType = filters.shippingType === type ? null : type;
	document.querySelectorAll(".rvhg-stat-card").forEach((c) => c.classList.toggle("rvhg-active", c.dataset.type === filters.shippingType));
	applyFilters();
}
function toggleAdvancedFilters() {
	document.getElementById("rvhg-advanced-toggle").classList.toggle("rvhg-expanded");
	document.getElementById("rvhg-advanced-content").classList.toggle("rvhg-show");
}
function applyFilters() {
	filters.status = document.getElementById("rvhg-filter-status").value;
	filters.date = document.getElementById("rvhg-filter-date").value;
	filters.fromDate = document.getElementById("rvhg-filter-from-date").value;
	filters.toDate = document.getElementById("rvhg-filter-to-date").value;
	filters.customer = document.getElementById("rvhg-filter-customer").value.trim().toLowerCase();
	filters.addressName = document.getElementById("rvhg-filter-address-name").value.trim().toLowerCase();
	filters.customerGroup = document.getElementById("rvhg-filter-customer-group").value;
	const quickPo = document.getElementById("rvhg-filter-po-quick").value.trim().toLowerCase();
	const advancedPo = document.getElementById("rvhg-filter-po").value.trim().toLowerCase();
	filters.po = quickPo || advancedPo;
	if (filters.date || filters.fromDate || filters.toDate) {
		filters.today = false; filters.yesterday = false;
		document.getElementById("rvhg-filter-today").classList.remove("rvhg-active");
		document.getElementById("rvhg-filter-yesterday").classList.remove("rvhg-active");
	}
	currentPage = 1;
	selectedInvoices = [];
	const filteredCount = getFilteredInvoices().length;
	updateFilterStatus(`Hiển thị ${filteredCount} / ${allInvoices.length} đơn`);
	renderManagerView();
	updateFloatingButtons();
	updatePaginationButtons();
}
function clearFilters() {
	filters = { today: false, yesterday: false, date: "", status: "", fromDate: "", toDate: "", customer: "", addressName: "", customerGroup: "", po: "", shippingType: null, statusFilter: null };
	document.getElementById("rvhg-filter-today").classList.remove("rvhg-active");
	document.getElementById("rvhg-filter-yesterday").classList.remove("rvhg-active");
	document.querySelectorAll(".rvhg-stat-card").forEach((c) => c.classList.remove("rvhg-active"));
	document.querySelectorAll(".rvhg-status-legend-item").forEach((i) => i.classList.remove("rvhg-active"));
	["rvhg-filter-status", "rvhg-filter-date", "rvhg-filter-from-date", "rvhg-filter-to-date", "rvhg-filter-customer", "rvhg-filter-address-name", "rvhg-filter-customer-group", "rvhg-filter-po-quick", "rvhg-filter-po"].forEach((id) => { document.getElementById(id).value = ""; });
	applyFilters();
}
function getFilteredInvoices() {
	return allInvoices.filter((inv) => {
		if (filters.today && inv.posting_date !== getTodayDate()) return false;
		if (filters.yesterday && inv.posting_date !== getYesterdayDate()) return false;
		if (filters.date && inv.posting_date !== filters.date) return false;
		if (filters.fromDate && inv.posting_date && inv.posting_date < filters.fromDate) return false;
		if (filters.toDate && inv.posting_date && inv.posting_date > filters.toDate) return false;
		if (filters.shippingType !== null) {
			let invType = inv[F.shipping_type];
			if (!invType || invType.trim() === "") invType = "Chưa phân công"; else invType = invType.trim();
			if (invType !== filters.shippingType) return false;
		}
		if (filters.status && inv[F.shipping_status] !== filters.status) return false;
		if (filters.statusFilter && inv[F.shipping_status] !== filters.statusFilter) return false;
		if (filters.customer && !(inv.customer || "").toLowerCase().includes(filters.customer)) return false;
		if (filters.addressName && !(inv.shipping_address_name || "").toLowerCase().includes(filters.addressName)) return false;
		if (filters.customerGroup && inv.customer_group !== filters.customerGroup) return false;
		if (filters.po && !(inv[F.po] || "").toLowerCase().includes(filters.po)) return false;
		return true;
	});
}

function openDetailModal(invoiceName) {
	const invoice = allInvoices.find((inv) => inv.name === invoiceName);
	if (!invoice) return;
	document.getElementById("rvhg-detail-invoice-name").textContent = `Chi tiết: ${invoice.name}`;
	document.getElementById("rvhg-detail-customer").textContent = invoice.customer || "-";
	document.getElementById("rvhg-detail-date").textContent = formatDateToDDMMYYYY(invoice.posting_date) || "-";
	document.getElementById("rvhg-detail-group").textContent = invoice.customer_group || "-";
	document.getElementById("rvhg-detail-po").textContent = invoice[F.po] || "— Chưa có —";
	document.getElementById("rvhg-detail-address-name").textContent = invoice.shipping_address_name || "-";
	document.getElementById("rvhg-detail-province").textContent = invoice[F.tinh] || "-";
	document.getElementById("rvhg-detail-address").textContent = invoice.shipping_address || "-";
	document.getElementById("rvhg-detail-shipping-type").textContent = invoice[F.shipping_type] || "Chưa phân công";
	document.getElementById("rvhg-detail-shipping-status").textContent = invoice[F.shipping_status] || "-";
	document.getElementById("rvhg-detail-vehicle").textContent = invoice[F.vehicle] || "-";
	document.getElementById("rvhg-detail-driver").textContent = invoice[F.driver] || "-";
	document.getElementById("rvhg-detail-packages").textContent = invoice[F.tong_kien] || "0";
	document.getElementById("rvhg-detail-volume").textContent = convertToM3(invoice[F.thetichlo]);
	document.getElementById("rvhg-detail-erp-link").href = `${window.location.origin}/app/sales-invoice/${encodeURIComponent(invoice.name)}`;
	document.getElementById("rvhg-detail-modal").classList.add("rvhg-show");
}
function closeDetailModal() { document.getElementById("rvhg-detail-modal").classList.remove("rvhg-show"); }

async function exportSingleExcel(shippingType) {
	try { await loadXLSX(); } catch (e) { showToast(e.message, "error"); return; }
	let filtered, exportLabel, fileLabel;
	if (selectedInvoices.length > 0) {
		filtered = allInvoices.filter((inv) => selectedInvoices.includes(inv.name));
		exportLabel = `${filtered.length} đơn đã chọn`; fileLabel = "Don-Da-Chon";
	} else {
		filtered = getFilteredInvoices().filter((inv) => {
			let t = inv[F.shipping_type]; if (!t || t.trim() === "") t = "Chưa phân công"; else t = t.trim();
			return t === shippingType;
		});
		exportLabel = shippingType; fileLabel = shippingType.replace(/\s+/g, "-");
	}
	if (filtered.length === 0) { showToast(`Không có đơn hàng ${exportLabel}`, "warning"); return; }
	const data = filtered.map((inv, index) => {
		const addr = (inv.shipping_address || "").split(/<br\s*\/?>/i)[0].trim();
		const full = addr ? `${addr}, ${inv[F.tinh] || ""}`.replace(/,\s*$/, "") : inv[F.tinh] || "";
		return {
			STT: index + 1, "Khách hàng": inv.customer || "", "Số PO": inv[F.po] || "", "Tên địa chỉ": inv.shipping_address_name || "",
			"Địa chỉ": full, "Số kiện": inv[F.tong_kien] || 0, "Số kg": (inv[F.tong_kien] || 0) * 11,
			"Hạn PO": calculatePODeadline(inv.posting_date, inv[F.tinh]), "Ghi chú": inv.name,
		};
	});
	const ws = window.XLSX.utils.json_to_sheet(data);
	ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 18 }, { wch: 25 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }];
	const wb = window.XLSX.utils.book_new();
	const sheetName = (selectedInvoices.length > 0 ? "Đơn đã chọn" : shippingType).substring(0, 31);
	window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
	window.XLSX.writeFile(wb, `${fileLabel}_${new Date().toISOString().split("T")[0]}.xlsx`);
	showToast(`Đã xuất ${filtered.length} ${exportLabel}`, "success");
}

async function exportCombinedExcel(shippingType) {
	try { await loadXLSX(); } catch (e) { showToast(e.message, "error"); return; }
	let filtered, exportLabel;
	const useSelection = shippingType === "selected" || selectedInvoices.length > 0;
	if (useSelection) {
		if (selectedInvoices.length === 0) { showToast("Chưa có đơn nào được chọn", "warning"); return; }
		filtered = allInvoices.filter((inv) => selectedInvoices.includes(inv.name));
		exportLabel = `${filtered.length} đơn đã chọn`;
	} else {
		filtered = getFilteredInvoices().filter((inv) => {
			let t = inv[F.shipping_type]; if (!t || t.trim() === "") t = "Chưa phân công"; else t = t.trim();
			return t === shippingType;
		});
		exportLabel = shippingType;
	}
	if (filtered.length === 0) { showToast(`Không có đơn hàng ${exportLabel}`, "warning"); return; }
	showToast(`Đang tạo Excel cho ${filtered.length} đơn...`, "info");
	try {
		// Batch items + custom_quycach (thay N+1 frappe.client.get + get_value của trang cũ)
		const withItemsRaw = await callMethod("vanchuyen.api.dieu_hanh.get_items_for_export", { names: JSON.stringify(filtered.map((i) => i.name)) });
		const itemsByName = {};
		(withItemsRaw || []).forEach((x) => { itemsByName[x.name] = x.items || []; });
		const invoicesWithItems = filtered.map((inv) => ({ name: inv.name, items: itemsByName[inv.name] || [] }));

		const productMap = {};
		invoicesWithItems.forEach((invoice) => {
			(invoice.items || []).forEach((item) => {
				const key = item.item_code || item.item_name;
				if (!productMap[key]) productMap[key] = { thung: 0, hop: 0, item_name: item.item_name || "", item_code: item.item_code || "", barcode: item.barcode || "", quycach: item.quycach || 0 };
				const qty = item.qty || 0;
				const uom = (item.uom || "").trim();
				if (uom === "Hộp") productMap[key].hop += qty;
				else if (uom === "Thùng" || uom === "" || !uom) {
					productMap[key].thung += Math.floor(qty);
					const frac = qty - Math.floor(qty);
					if (frac > 0 && productMap[key].quycach > 0) productMap[key].hop += Math.round(frac * productMap[key].quycach);
				} else productMap[key].thung += Math.floor(qty);
			});
		});
		Object.values(productMap).forEach((p) => {
			if (p.quycach > 0 && p.hop >= p.quycach) { p.thung += Math.floor(p.hop / p.quycach); p.hop = p.hop % p.quycach; }
		});
		const donTongData = Object.values(productMap).map((p) => ({ "Loại": "Hàng truyền thống", "Quy cách": p.quycach > 0 ? `${p.quycach} hộp/thùng` : "", "Mã vạch": p.barcode, "Tên sản phẩm": p.item_name, "Mã": p.item_code, "Số thùng": p.thung, "Lẻ": p.hop }));
		donTongData.push({ "Loại": "Total", "Quy cách": "", "Mã vạch": "", "Tên sản phẩm": "", "Mã": "", "Số thùng": donTongData.reduce((s, i) => s + i["Số thùng"], 0), "Lẻ": donTongData.reduce((s, i) => s + i["Lẻ"], 0) });

		const donChiaData = filtered.map((inv) => {
			let productStr = "", totalHopDu = 0;
			const invoice = invoicesWithItems.find((i) => i.name === inv.name);
			if (invoice && invoice.items) {
				const invProducts = {};
				invoice.items.forEach((item) => {
					const key = item.item_code || item.item_name;
					if (!invProducts[key]) invProducts[key] = { thung: 0, hop: 0, quycach: item.quycach || 0 };
					const qty = item.qty || 0;
					const uom = (item.uom || "").trim();
					if (uom === "Hộp") invProducts[key].hop += qty;
					else { invProducts[key].thung += Math.floor(qty); const frac = qty - Math.floor(qty); if (frac > 0 && invProducts[key].quycach > 0) invProducts[key].hop += Math.round(frac * invProducts[key].quycach); }
				});
				Object.values(invProducts).forEach((p) => { if (p.quycach > 0 && p.hop >= p.quycach) { p.thung += Math.floor(p.hop / p.quycach); p.hop = p.hop % p.quycach; } });
				productStr = Object.entries(invProducts).map(([code, p]) => `${code} - ${p.thung} Thùng${p.hop > 0 ? ` + ${p.hop} Hộp` : ""}`).join(", ");
				totalHopDu = Object.values(invProducts).reduce((s, p) => s + p.hop, 0);
			}
			return { "Tỉnh": inv[F.tinh] || "", "Chi tiết": inv.shipping_address_name || "", "Số PO": inv[F.po] || "", "Sản phẩm": productStr, "Số kiện": inv[F.tong_kien] || 0, "Lẻ hộp": totalHopDu, "Thể tích(m3)": convertToM3(inv[F.thetichlo]) };
		});
		const totalVolume = filtered.reduce((s, inv) => s + (inv[F.thetichlo] || 0), 0);
		donChiaData.push({ "Tỉnh": "Total", "Chi tiết": "", "Số PO": "", "Sản phẩm": "", "Số kiện": donChiaData.reduce((s, i) => s + i["Số kiện"], 0), "Lẻ hộp": donChiaData.reduce((s, i) => s + i["Lẻ hộp"], 0), "Thể tích(m3)": convertToM3(totalVolume) });

		const wb = window.XLSX.utils.book_new();
		const wsT = window.XLSX.utils.json_to_sheet(donTongData);
		wsT["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 40 }, { wch: 15 }, { wch: 12 }, { wch: 10 }];
		window.XLSX.utils.book_append_sheet(wb, wsT, "Đơn tổng");
		const wsC = window.XLSX.utils.json_to_sheet(donChiaData);
		wsC["!cols"] = [{ wch: 20 }, { wch: 40 }, { wch: 18 }, { wch: 50 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
		window.XLSX.utils.book_append_sheet(wb, wsC, "Đơn chia");
		const fileLabel = useSelection ? "Don-Da-Chon" : shippingType.replace(/\s+/g, "-");
		window.XLSX.writeFile(wb, `${fileLabel}-Don-Tong-Chia_${new Date().toISOString().split("T")[0]}.xlsx`);
		showToast(`Đã xuất ${filtered.length} ${exportLabel}`, "success");
	} catch (error) {
		console.error("Export error:", error);
		showToast("Lỗi: " + (error.message || error), "error");
	}
}

function loadCustomerGroups() {
	return callMethod("frappe.client.get_list", { doctype: "Customer Group", fields: ["name"], order_by: "name asc", limit_page_length: 999 })
		.then((rows) => {
			customerGroups = rows || [];
			const select = document.getElementById("rvhg-filter-customer-group");
			customerGroups.forEach((g) => { const o = document.createElement("option"); o.value = g.name; o.textContent = g.name; select.appendChild(o); });
		})
		.catch(() => {});
}

async function loadInitialData() {
	showLoading();
	updateFilterStatus("Đang tải dữ liệu...");
	await loadMoreInvoices();
	renderStatistics();
	applyFilters();
	setupEventListeners();
}

// Thay frappe.client.get_list 1000 bằng method server (guarded, cùng base filter).
function loadMoreInvoices() {
	if (isLoading) return Promise.resolve(false);
	isLoading = true;
	const loadBtn = document.getElementById("rvhg-btn-load-more");
	loadBtn.disabled = true;
	loadBtn.innerHTML = '<div class="rvhg-spinner"></div> Đang tải...';
	updateFilterStatus("Đang tải thêm dữ liệu...");
	const startDate = getTimeRangeStartDate();
	const apiFilters = {};
	if (startDate) apiFilters.tu_ngay = startDate;
	return callMethod("vanchuyen.api.dieu_hanh.get_invoices_dieu_phoi", { filters: JSON.stringify(apiFilters), page: loadPageNum, page_size: loadBatchSize })
		.then((res) => {
			isLoading = false;
			loadBtn.disabled = false;
			loadBtn.innerHTML = "📥 Tải thêm 1000 đơn hàng";
			const rows = (res && res.rows) || [];
			const total = (res && res.total) || 0;
			allInvoices = [...allInvoices, ...rows];
			totalLoadedRecords += rows.length;
			loadPageNum += 1;
			if (allInvoices.length >= total || rows.length < loadBatchSize) {
				hasMoreData = false;
				document.getElementById("rvhg-load-more-section").style.display = "none";
			}
			rebuildShippingTypesFromData();
			rebuildShippingStatusesFromData();
			renderStatusLegend();
			renderShippingTypeButtons();
			renderStatusButtons();
			renderExportButtons();
			updateDataCounter();
			updateFilterStatus(`Đã tải ${totalLoadedRecords} đơn hàng`);
			renderStatistics();
			renderManagerView();
			updatePaginationButtons();
			return true;
		})
		.catch((err) => {
			isLoading = false;
			loadBtn.disabled = false;
			loadBtn.innerHTML = "📥 Tải thêm 1000 đơn hàng";
			console.error("Load error:", err);
			showToast("Lỗi tải dữ liệu - kiểm tra Console", "error");
			return false;
		});
}

function updateDataCounter() {
	document.getElementById("rvhg-data-counter").innerHTML = `📊 Đã tải: ${totalLoadedRecords.toLocaleString()} đơn`;
}

function getPaginatedInvoices() {
	const filtered = getFilteredInvoices();
	const start = (currentPage - 1) * itemsPerPage;
	return filtered.slice(start, start + itemsPerPage);
}
function updatePaginationButtons() {
	const filtered = getFilteredInvoices();
	const totalPages = Math.ceil(filtered.length / itemsPerPage);
	document.getElementById("rvhg-page-info").textContent = `Trang ${currentPage} / ${totalPages || 1}`;
	document.getElementById("rvhg-btn-first").disabled = currentPage === 1;
	document.getElementById("rvhg-btn-prev").disabled = currentPage === 1;
	document.getElementById("rvhg-btn-next").disabled = currentPage >= totalPages;
	const cont = document.getElementById("rvhg-page-numbers");
	cont.innerHTML = "";
	const dots = () => { const d = document.createElement("span"); d.textContent = "..."; d.style.padding = "0 8px"; d.style.color = "var(--rvhg-gray-400)"; return d; };
	if (totalPages <= 7) {
		for (let i = 1; i <= totalPages; i++) cont.appendChild(createPageButton(i));
	} else {
		cont.appendChild(createPageButton(1));
		if (currentPage > 3) cont.appendChild(dots());
		for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) cont.appendChild(createPageButton(i));
		if (currentPage < totalPages - 2) cont.appendChild(dots());
		if (totalPages > 1) cont.appendChild(createPageButton(totalPages));
	}
}
function createPageButton(pageNum) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = `rvhg-page-num ${pageNum === currentPage ? "rvhg-active" : ""}`;
	btn.textContent = pageNum;
	btn.addEventListener("click", () => goToPage(pageNum));
	return btn;
}
function goToPage(page) {
	const totalPages = Math.ceil(getFilteredInvoices().length / itemsPerPage);
	if (page >= 1 && page <= totalPages) {
		currentPage = page;
		renderManagerView();
		updateSelectionUI();
		updatePaginationButtons();
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
}

function updateSelectionUI() {
	const total = selectedInvoices.length;
	const fab = document.getElementById("rvhg-floating-btn");
	const bar = document.getElementById("rvhg-selection-bar");
	const toolbar = document.getElementById("rvhg-list-toolbar");
	if (!fab || !bar || !toolbar) return;
	toolbar.style.display = getFilteredInvoices().length > 0 ? "flex" : "none";
	if (total > 0) {
		bar.classList.add("rvhg-show");
		document.getElementById("rvhg-sel-count").textContent = total;
		const currentPageNames = getPaginatedInvoices().map((inv) => inv.name);
		const inPage = selectedInvoices.filter((n) => currentPageNames.includes(n)).length;
		document.getElementById("rvhg-sel-count-text").textContent = total === inPage ? "đơn đã chọn" : `đơn đã chọn (${inPage} trong trang)`;
		fab.classList.add("rvhg-show");
		document.getElementById("rvhg-floating-count").textContent = total;
	} else {
		bar.classList.remove("rvhg-show");
		fab.classList.remove("rvhg-show");
	}
	updateMasterCheckbox();
	renderExportButtons();
}
function updateMasterCheckbox() {
	const cb = document.getElementById("rvhg-master-checkbox");
	const text = document.getElementById("rvhg-master-text");
	if (!cb) return;
	const names = getPaginatedInvoices().map((inv) => inv.name);
	const sel = names.filter((n) => selectedInvoices.includes(n)).length;
	cb.classList.remove("rvhg-checked", "rvhg-indeterminate");
	if (names.length === 0) { text.textContent = "Chọn tất cả trong trang này"; return; }
	if (sel === 0) text.textContent = `Chọn tất cả ${names.length} đơn trong trang`;
	else if (sel === names.length) { cb.classList.add("rvhg-checked"); text.textContent = `Đã chọn cả trang (${sel}/${names.length})`; }
	else { cb.classList.add("rvhg-indeterminate"); text.textContent = `Đã chọn ${sel}/${names.length} trong trang`; }
}
function updateFloatingButtons() { updateSelectionUI(); }

function toggleSelectAllCurrentPage() {
	const names = getPaginatedInvoices().map((inv) => inv.name);
	if (names.length === 0) return;
	const allSel = names.every((n) => selectedInvoices.includes(n));
	if (allSel) selectedInvoices = selectedInvoices.filter((n) => !names.includes(n));
	else names.forEach((n) => { if (!selectedInvoices.includes(n)) selectedInvoices.push(n); });
	renderManagerView();
	updateSelectionUI();
}
function clearAllSelection() {
	if (selectedInvoices.length === 0) return;
	selectedInvoices = [];
	lastSelectedIndex = -1;
	renderManagerView();
	updateSelectionUI();
}
function handleShiftSelect(invoiceName) {
	const filtered = getFilteredInvoices();
	const cur = filtered.findIndex((inv) => inv.name === invoiceName);
	if (cur === -1) return false;
	if (lastSelectedIndex === -1) { lastSelectedIndex = cur; return false; }
	const start = Math.min(lastSelectedIndex, cur), end = Math.max(lastSelectedIndex, cur);
	for (let i = start; i <= end; i++) { const n = filtered[i].name; if (!selectedInvoices.includes(n)) selectedInvoices.push(n); }
	lastSelectedIndex = cur;
	renderManagerView();
	updateSelectionUI();
	return true;
}

function openManagementModal() {
	if (selectedInvoices.length === 0) return;
	document.getElementById("rvhg-modal-selected-count").textContent = selectedInvoices.length;
	document.getElementById("rvhg-management-modal").classList.add("rvhg-show");
}
function closeManagementModal() { document.getElementById("rvhg-management-modal").classList.remove("rvhg-show"); }
async function assignShippingTypeFromModal(type) { await assignShippingType(type); closeManagementModal(); }
async function updateShippingStatusFromModal(status) { await updateShippingStatus(status); closeManagementModal(); }

async function assignShippingType(type) {
	if (selectedInvoices.length === 0) return;
	showToast("Đang phân công...", "info");
	try {
		await callMethod("vanchuyen.api.dieu_hanh.bulk_update_van_chuyen", { names: JSON.stringify(selectedInvoices), fieldname: "custom_hình_thức_vận_chuyển", value: type });
		selectedInvoices.forEach((n) => { const inv = allInvoices.find((i) => i.name === n); if (inv) inv[F.shipping_type] = type; });
		showToast(`Đã phân công ${selectedInvoices.length} đơn: ${type}`, "success");
		selectedInvoices = [];
		renderStatistics(); renderManagerView(); updateFloatingButtons();
	} catch (e) { showToast("Lỗi: " + (e.message || e), "error"); }
}
async function updateShippingStatus(status) {
	if (selectedInvoices.length === 0) return;
	showToast("Đang cập nhật...", "info");
	try {
		await callMethod("vanchuyen.api.dieu_hanh.bulk_update_van_chuyen", { names: JSON.stringify(selectedInvoices), fieldname: "custom_trạng_thái_vận_chuyển", value: status });
		selectedInvoices.forEach((n) => { const inv = allInvoices.find((i) => i.name === n); if (inv) inv[F.shipping_status] = status; });
		showToast(`Đã cập nhật ${selectedInvoices.length} đơn: ${status}`, "success");
		selectedInvoices = [];
		renderManagerView(); updateFloatingButtons();
	} catch (e) { showToast("Lỗi: " + (e.message || e), "error"); }
}

function toggleInvoiceSelection(invoiceName, shiftKey = false) {
	if (shiftKey && lastSelectedIndex !== -1) { if (handleShiftSelect(invoiceName)) return; }
	const index = selectedInvoices.indexOf(invoiceName);
	if (index > -1) selectedInvoices.splice(index, 1); else selectedInvoices.push(invoiceName);
	const idx = getFilteredInvoices().findIndex((inv) => inv.name === invoiceName);
	if (idx !== -1) lastSelectedIndex = idx;
	renderManagerView();
	updateSelectionUI();
}

function renderManagerView() {
	const list = document.getElementById("rvhg-invoice-list");
	if (!list) return;
	const paginated = getPaginatedInvoices();
	if (getFilteredInvoices().length === 0) {
		list.innerHTML = '<div class="rvhg-loading">Không có đơn hàng nào phù hợp với bộ lọc</div>';
		return;
	}
	list.innerHTML = "";
	paginated.forEach((invoice) => {
		const isSelected = selectedInvoices.includes(invoice.name);
		const item = document.createElement("div");
		let invType = invoice[F.shipping_type];
		if (!invType || invType.trim() === "") invType = "Chưa phân công"; else invType = invType.trim();
		const config = shippingTypeConfig[invType] || shippingTypeConfig["Chưa phân công"];
		item.className = `rvhg-invoice-item ${isSelected ? "rvhg-selected" : ""}`;
		item.style.background = config.gradient;

		let typeBadge = "";
		const typeVal = invoice[F.shipping_type];
		if (typeVal && typeVal.trim() !== "" && typeVal !== "Chưa phân công") {
			const bc = typeVal === "Tự vận chuyển" ? "rvhg-badge-green" : typeVal === "Nhất Tín" ? "rvhg-badge-orange" : typeVal === "Xe vào bốc" ? "rvhg-badge-purple" : "rvhg-badge-blue";
			typeBadge = `<span class="rvhg-badge ${bc}">${escapeHtml(typeVal)}</span>`;
		}
		let statusBadge = "";
		const statusVal = invoice[F.shipping_status];
		if (statusVal) {
			const sc = { "Đang xử lý": "rvhg-badge-yellow", "Đang giao hàng": "rvhg-badge-blue", "Đã giao hàng, chụp chứng từ": "rvhg-badge-orange", "Đã nộp chứng từ": "rvhg-badge-green" };
			statusBadge = `<span class="rvhg-badge ${sc[statusVal] || "rvhg-badge-yellow"}">${escapeHtml(statusVal)}</span>`;
		}
		let poBadge = "";
		const poVal = invoice[F.po];
		if (poVal && String(poVal).trim() !== "") poBadge = `<span class="rvhg-badge rvhg-badge-po" title="Số PO khách hàng">🔢 PO: ${escapeHtml(poVal)}</span>`;

		let vehicleDriverInfo = "";
		const vehicleVal = invoice[F.vehicle], driverVal = invoice[F.driver];
		if (typeVal === "Tự vận chuyển" || typeVal === "Xe vào bốc") {
			if (vehicleVal || driverVal) {
				vehicleDriverInfo = `<div class="rvhg-invoice-vehicle">`;
				if (vehicleVal) vehicleDriverInfo += `🚗 ${escapeHtml(vehicleVal)}`;
				if (driverVal) { if (vehicleVal) vehicleDriverInfo += " • "; vehicleDriverInfo += `👤 ${escapeHtml(driverVal)}`; }
				vehicleDriverInfo += `</div>`;
			}
		}

		item.innerHTML = `
			<div class="rvhg-invoice-row">
				<span class="rvhg-checkbox ${isSelected ? "rvhg-checked" : ""}" data-action="checkbox" data-name="${escapeHtml(invoice.name)}"></span>
				<div class="rvhg-invoice-row-content">
					<div class="rvhg-invoice-header" data-action="select" data-name="${escapeHtml(invoice.name)}">
						<div class="rvhg-invoice-info">
							<div class="rvhg-invoice-id"><span>${escapeHtml(invoice.name)}</span>${typeBadge}${statusBadge}${poBadge}</div>
							<div class="rvhg-invoice-customer">${escapeHtml(invoice.customer || "N/A")}</div>
							<div class="rvhg-invoice-meta">${escapeHtml(invoice.shipping_address_name || "")}</div>
							<div class="rvhg-invoice-meta-address">📍 ${escapeHtml(invoice.shipping_address || "")}, ${escapeHtml(invoice[F.tinh] || "")}</div>
						</div>
						<div class="rvhg-invoice-stats">
							<div class="rvhg-stat-item"><div class="rvhg-stat-label">Ngày</div><div class="rvhg-stat-value rvhg-stat-value-date">${formatDateToDDMMYYYY(invoice.posting_date)}</div></div>
							<div class="rvhg-stat-item"><div class="rvhg-stat-label">Kiện</div><div class="rvhg-stat-value">${invoice[F.tong_kien] || 0}</div></div>
							<div class="rvhg-stat-item"><div class="rvhg-stat-label">m³</div><div class="rvhg-stat-value">${convertToM3(invoice[F.thetichlo])}</div></div>
						</div>
					</div>
					${vehicleDriverInfo}
					<div class="rvhg-invoice-actions"><button class="rvhg-btn-view" type="button" data-action="detail" data-name="${escapeHtml(invoice.name)}">👁️ Xem chi tiết</button></div>
				</div>
			</div>`;
		list.appendChild(item);
	});
}

function setupEventListeners() {
	document.querySelectorAll(".rvhg-time-btn").forEach((btn) => btn.addEventListener("click", () => setTimeRange(btn.dataset.range)));
	document.getElementById("rvhg-filter-today").addEventListener("click", () => toggleFilter("today"));
	document.getElementById("rvhg-filter-yesterday").addEventListener("click", () => toggleFilter("yesterday"));
	document.getElementById("rvhg-filter-date").addEventListener("change", applyFilters);
	document.getElementById("rvhg-filter-status").addEventListener("change", applyFilters);
	document.getElementById("rvhg-advanced-toggle").addEventListener("click", toggleAdvancedFilters);
	document.getElementById("rvhg-clear-filter-btn").addEventListener("click", clearFilters);
	document.getElementById("rvhg-apply-advanced-btn").addEventListener("click", applyFilters);

	let poDebounce = null;
	document.getElementById("rvhg-filter-po-quick").addEventListener("input", () => { clearTimeout(poDebounce); poDebounce = setTimeout(applyFilters, 300); });
	document.getElementById("rvhg-filter-po-quick").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(poDebounce); applyFilters(); } });

	document.getElementById("rvhg-btn-first").addEventListener("click", () => goToPage(1));
	document.getElementById("rvhg-btn-prev").addEventListener("click", () => goToPage(currentPage - 1));
	document.getElementById("rvhg-btn-next").addEventListener("click", () => goToPage(currentPage + 1));
	document.getElementById("rvhg-btn-load-more").addEventListener("click", loadMoreInvoices);
	document.getElementById("rvhg-floating-btn").addEventListener("click", openManagementModal);
	document.getElementById("rvhg-close-mgmt-btn").addEventListener("click", closeManagementModal);
	document.getElementById("rvhg-detail-close-btn").addEventListener("click", closeDetailModal);
	document.getElementById("rvhg-management-modal").addEventListener("click", (e) => { if (e.target.id === "rvhg-management-modal") closeManagementModal(); });
	document.getElementById("rvhg-detail-modal").addEventListener("click", (e) => { if (e.target.id === "rvhg-detail-modal") closeDetailModal(); });

	document.getElementById("rvhg-invoice-list").addEventListener("click", (e) => {
		const detailBtn = e.target.closest('[data-action="detail"]');
		if (detailBtn) { e.stopPropagation(); openDetailModal(detailBtn.dataset.name); return; }
		const cb = e.target.closest('[data-action="checkbox"]');
		if (cb) { e.stopPropagation(); toggleInvoiceSelection(cb.dataset.name, e.shiftKey); return; }
		const selectArea = e.target.closest('[data-action="select"]');
		if (selectArea) { if (e.shiftKey) window.getSelection()?.removeAllRanges(); toggleInvoiceSelection(selectArea.dataset.name, e.shiftKey); }
	});

	document.getElementById("rvhg-sel-assign").addEventListener("click", openManagementModal);
	document.getElementById("rvhg-sel-status").addEventListener("click", openManagementModal);
	document.getElementById("rvhg-sel-export").addEventListener("click", () => { if (selectedInvoices.length === 0) return; exportCombinedExcel("selected"); });
	document.getElementById("rvhg-sel-clear").addEventListener("click", clearAllSelection);
	document.getElementById("rvhg-master-checkbox-label").addEventListener("click", (e) => { e.preventDefault(); toggleSelectAllCurrentPage(); });

	// Keyboard: bind document-level 1 lần; no-op khi view không mounted.
	if (!_docKbBound) {
		_docKbBound = true;
		document.addEventListener("keydown", (e) => {
			if (!document.getElementById("rvhg-invoice-list")) return; // view không hiện → bỏ qua
			if (e.key === "Escape") {
				const mgmt = document.getElementById("rvhg-management-modal");
				const detail = document.getElementById("rvhg-detail-modal");
				if (mgmt && mgmt.classList.contains("rvhg-show")) closeManagementModal();
				else if (detail && detail.classList.contains("rvhg-show")) closeDetailModal();
				else if (selectedInvoices.length > 0) clearAllSelection();
				return;
			}
			const tag = (e.target.tagName || "").toLowerCase();
			const isInput = tag === "input" || tag === "textarea" || tag === "select";
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !isInput) { e.preventDefault(); toggleSelectAllCurrentPage(); }
		});
	}
}

function updateFilterStatus(message) { const el = document.getElementById("rvhg-filter-status-text"); if (el) el.textContent = message; }
function showLoading() {
	const list = document.getElementById("rvhg-invoice-list");
	if (list) list.innerHTML = `<div class="rvhg-loading"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg><p style="margin-top:16px;font-weight:600;">Đang tải dữ liệu...</p></div>`;
}

function injectCss() {
	if (document.getElementById("rvhg-styles")) return;
	const s = document.createElement("style");
	s.id = "rvhg-styles";
	s.textContent = CSS_TEXT;
	document.head.appendChild(s);
}

// ── Entry point cho SPA ─────────────────────────────────────────────────────
export async function render({ container }) {
	injectCss();
	container.innerHTML = MARKUP;
	// reset state (module cache tồn tại giữa các lần vào view)
	allInvoices = []; customerGroups = []; selectedInvoices = []; shippingTypes = []; shippingStatuses = [];
	currentPage = 1; totalLoadedRecords = 0; loadPageNum = 1; isLoading = false; hasMoreData = true;
	currentTimeRange = "30"; lastSelectedIndex = -1;
	filters = { today: false, yesterday: false, date: "", status: "", fromDate: "", toDate: "", customer: "", addressName: "", customerGroup: "", po: "", shippingType: null, statusFilter: null };

	updateTimeRangeInfo();
	await loadCustomerGroups();
	try {
		await loadInitialData();
	} catch (e) {
		showToast("Lỗi khi tải dữ liệu: " + (e.message || e), "error");
	}
}
