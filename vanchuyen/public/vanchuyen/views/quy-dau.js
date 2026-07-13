// Port NGUYÊN trang mẫu "Quản Trị Quỹ Dầu" (chi tiền thủ công + lịch + danh sách GL + QR).
// Dùng làm PHẦN ĐẦU của #/tra-cuoc. CSS scope trong .qd-wrap để KHÔNG rò theme tối ra portal.
// Data dùng frappe.call trực tiếp (user điều hành/kế toán có quyền GL/JE/Driver) — giữ giống mẫu.

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap";

const CSS_TEXT = `
.qd-wrap, .qd-wrap * { margin:0; padding:0; box-sizing:border-box; }
.qd-wrap {
  --qd-primary:#6366f1; --qd-success:#22c55e; --qd-warning:#f59e0b; --qd-danger:#ef4444; --qd-info:#0ea5e9;
  --qd-bg-dark:#0f172a; --qd-bg-card:#1e293b; --qd-bg-input:#0f172a;
  --qd-text-primary:#f1f5f9; --qd-text-secondary:#94a3b8; --qd-text-muted:#64748b; --qd-border:#334155;
  --qd-gradient:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);
  --qd-gradient-gold:linear-gradient(135deg,#fbbf24 0%,#f59e0b 50%,#d97706 100%);
  --qd-gradient-danger:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);
  --qd-gradient-success:linear-gradient(135deg,#22c55e 0%,#15803d 100%);
  --qd-radius-sm:8px; --qd-radius-md:12px; --qd-radius-lg:16px; --qd-shadow:0 10px 15px -3px rgb(0 0 0 / 0.4);
  font-family:'Be Vietnam Pro',sans-serif; background:var(--qd-bg-dark); color:var(--qd-text-primary);
  line-height:1.6; border-radius:var(--qd-radius-lg); padding:6px; display:block; margin-bottom:20px;
}
.qd-container { max-width:1500px; margin:0 auto; padding:14px; }
.qd-header { background:var(--qd-bg-card); border:1px solid var(--qd-border); border-radius:var(--qd-radius-lg);
  padding:16px 24px; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; box-shadow:var(--qd-shadow); }
.qd-header-left { display:flex; align-items:center; gap:14px; }
.qd-logo { width:50px; height:50px; background:var(--qd-gradient-gold); border-radius:var(--qd-radius-md); display:flex; align-items:center; justify-content:center; font-size:22px; color:#1e293b; }
.qd-header-title h1 { font-size:20px; font-weight:800; background:var(--qd-gradient-gold); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.qd-header-title p { color:var(--qd-text-secondary); font-size:12px; }
.qd-fiscal-badge { background:var(--qd-bg-input); border:1px solid var(--qd-border); padding:8px 14px; border-radius:var(--qd-radius-md); font-size:12px; color:var(--qd-text-secondary); display:flex; align-items:center; gap:6px; }
.qd-fiscal-badge i { color:var(--qd-primary); }
.qd-stats-panel { background:var(--qd-bg-card); border:1px solid var(--qd-border); border-radius:var(--qd-radius-lg); padding:20px; margin-bottom:20px; display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr auto; gap:16px; align-items:stretch; box-shadow:var(--qd-shadow); }
.qd-stat { padding:14px 16px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-md); display:flex; flex-direction:column; justify-content:center; }
.qd-stat-label { font-size:10px; color:var(--qd-text-muted); text-transform:uppercase; letter-spacing:.8px; margin-bottom:6px; display:flex; align-items:center; gap:6px; }
.qd-stat-value { font-size:22px; font-weight:800; letter-spacing:-.5px; }
.qd-stat.primary .qd-stat-value { font-size:28px; background:var(--qd-gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.qd-stat-value.positive { color:var(--qd-success); }
.qd-stat-value.negative { color:var(--qd-danger); }
.qd-stat-sub { font-size:11px; color:var(--qd-text-muted); margin-top:2px; }
.qd-stat-cta { display:flex; align-items:center; padding:0; }
.qd-btn-chi { background:var(--qd-gradient-danger); color:#fff; border:none; padding:16px 24px; border-radius:var(--qd-radius-md); font-family:inherit; font-size:14px; font-weight:700; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:4px; box-shadow:0 4px 12px rgba(239,68,68,.3); transition:transform .15s ease; height:100%; min-width:130px; }
.qd-btn-chi:hover { transform:translateY(-2px); }
.qd-btn-chi i { font-size:22px; }
.qd-main-grid { display:grid; grid-template-columns:460px 1fr; gap:20px; margin-bottom:20px; }
.qd-card { background:var(--qd-bg-card); border:1px solid var(--qd-border); border-radius:var(--qd-radius-lg); overflow:hidden; box-shadow:var(--qd-shadow); }
.qd-card-header { padding:14px 18px; border-bottom:1px solid var(--qd-border); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.qd-card-title { font-size:14px; font-weight:700; display:flex; align-items:center; gap:10px; }
.qd-card-title i { width:28px; height:28px; background:var(--qd-gradient); border-radius:var(--qd-radius-sm); display:flex; align-items:center; justify-content:center; font-size:12px; }
.qd-card-body { padding:16px; }
.qd-cal-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.qd-cal-nav-btn { width:32px; height:32px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-sm); color:var(--qd-text-secondary); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px; transition:all .2s; }
.qd-cal-nav-btn:hover { border-color:var(--qd-primary); color:var(--qd-text-primary); }
.qd-cal-month-info { text-align:center; }
.qd-cal-month-year { font-size:14px; font-weight:700; color:var(--qd-text-primary); }
.qd-cal-lunar { font-size:11px; color:var(--qd-text-muted); }
.qd-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
.qd-cal-weekday { text-align:center; font-size:10px; font-weight:600; color:var(--qd-text-muted); padding:6px 2px; text-transform:uppercase; }
.qd-cal-day { aspect-ratio:1; background:var(--qd-bg-input); border:1px solid transparent; border-radius:var(--qd-radius-sm); display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; transition:all .15s; padding:3px 2px; min-height:48px; position:relative; }
.qd-cal-day:hover { border-color:var(--qd-primary); }
.qd-cal-day.today { border-color:var(--qd-primary); background:rgba(99,102,241,.15); }
.qd-cal-day.selected { border-color:#ec4899; background:rgba(236,72,153,.2); }
.qd-cal-day.other-month { opacity:.3; }
.qd-cal-day.has-chi { background:rgba(239,68,68,.08); }
.qd-cal-day.has-chi.heavy { background:rgba(239,68,68,.2); }
.qd-cal-day-solar { font-size:13px; font-weight:700; color:var(--qd-text-primary); }
.qd-cal-day-lunar { font-size:8px; color:var(--qd-text-muted); margin-top:1px; }
.qd-cal-day-amount { font-size:9px; color:var(--qd-danger); font-weight:700; margin-top:1px; white-space:nowrap; overflow:hidden; }
.qd-cal-legend { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; padding-top:12px; border-top:1px dashed var(--qd-border); font-size:10px; color:var(--qd-text-muted); }
.qd-cal-legend-item { display:flex; align-items:center; gap:4px; }
.qd-cal-legend-dot { width:10px; height:10px; border-radius:3px; }
.qd-filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; align-items:center; }
.qd-pill-group { display:inline-flex; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-md); padding:3px; gap:2px; }
.qd-pill { padding:6px 12px; font-size:11px; font-weight:600; color:var(--qd-text-secondary); cursor:pointer; border-radius:8px; transition:all .15s; border:none; background:transparent; font-family:inherit; }
.qd-pill:hover { color:var(--qd-text-primary); }
.qd-pill.active { background:var(--qd-gradient); color:#fff; }
.qd-search-wrap { position:relative; flex:1; min-width:180px; }
.qd-search-wrap i { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--qd-text-muted); font-size:12px; }
.qd-search-input { width:100%; padding:8px 12px 8px 32px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-md); color:var(--qd-text-primary); font-family:inherit; font-size:12px; }
.qd-search-input:focus { outline:none; border-color:var(--qd-primary); }
.qd-list-summary { display:flex; gap:14px; flex-wrap:wrap; padding:10px 14px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-md); margin-bottom:12px; font-size:12px; }
.qd-list-summary-item { display:flex; gap:6px; align-items:center; }
.qd-list-summary-item .label { color:var(--qd-text-muted); }
.qd-list-summary-item .value { font-weight:700; }
.qd-expense-list { border:1px solid var(--qd-border); border-radius:var(--qd-radius-md); overflow:hidden; }
.qd-date-group { background:var(--qd-bg-input); padding:8px 14px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--qd-border); font-size:12px; position:sticky; top:0; }
.qd-date-group-label { font-weight:700; color:var(--qd-text-primary); display:flex; align-items:center; gap:6px; }
.qd-date-group-label i { color:var(--qd-primary); }
.qd-date-group-total { font-weight:700; color:var(--qd-danger); }
.qd-date-group-lunar { font-size:10px; color:var(--qd-text-muted); font-weight:400; margin-left:6px; }
.qd-expense-row { display:grid; grid-template-columns:1fr auto auto; gap:10px; align-items:center; padding:10px 14px; border-bottom:1px solid var(--qd-border); transition:background .15s; }
.qd-expense-row:last-child { border-bottom:none; }
.qd-expense-row:hover { background:rgba(99,102,241,.05); }
.qd-expense-content { min-width:0; }
.qd-expense-text { font-size:13px; color:var(--qd-text-primary); line-height:1.4; word-break:break-word; }
.qd-expense-meta { font-size:10px; color:var(--qd-text-muted); margin-top:3px; display:flex; gap:8px; flex-wrap:wrap; }
.qd-expense-meta-tag { background:var(--qd-bg-input); padding:1px 6px; border-radius:4px; }
.qd-expense-amount { font-size:14px; font-weight:700; white-space:nowrap; }
.qd-expense-amount.chi { color:var(--qd-danger); }
.qd-expense-amount.nap { color:var(--qd-success); }
.qd-expense-link { width:28px; height:28px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-sm); color:var(--qd-text-muted); display:flex; align-items:center; justify-content:center; text-decoration:none; font-size:10px; transition:all .15s; }
.qd-expense-link:hover { color:var(--qd-primary); border-color:var(--qd-primary); }
.qd-pagination { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:14px; flex-wrap:wrap; }
.qd-page-btn { min-width:32px; height:32px; padding:0 8px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-sm); color:var(--qd-text-secondary); font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; }
.qd-page-btn:hover:not(:disabled) { border-color:var(--qd-primary); color:var(--qd-text-primary); }
.qd-page-btn.active { background:var(--qd-primary); border-color:var(--qd-primary); color:#fff; }
.qd-page-btn:disabled { opacity:.4; cursor:not-allowed; }
.qd-page-info { font-size:11px; color:var(--qd-text-muted); margin:0 8px; }
.qd-btn { padding:10px 16px; border:none; border-radius:var(--qd-radius-md); font-family:inherit; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:all .15s; }
.qd-btn-primary { background:var(--qd-gradient); color:#fff; }
.qd-btn-success { background:var(--qd-gradient-success); color:#fff; }
.qd-btn-danger { background:var(--qd-gradient-danger); color:#fff; }
.qd-btn-outline { background:transparent; border:1px solid var(--qd-border); color:var(--qd-text-secondary); }
.qd-btn-outline:hover { border-color:var(--qd-primary); color:var(--qd-text-primary); }
.qd-btn-sm { padding:6px 10px; font-size:11px; }
.qd-input, .qd-select { width:100%; padding:10px 14px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-md); color:var(--qd-text-primary); font-family:inherit; font-size:13px; }
.qd-input:focus, .qd-select:focus { outline:none; border-color:var(--qd-primary); }
.qd-form-group { margin-bottom:14px; }
.qd-form-group > label { font-size:12px; font-weight:600; color:var(--qd-text-secondary); margin-bottom:6px; display:flex; align-items:center; gap:6px; }
.qd-fab { display:none; position:fixed; bottom:20px; right:20px; height:56px; padding:0 20px; background:var(--qd-gradient-danger); border:none; border-radius:28px; color:#fff; font-size:14px; font-weight:700; font-family:inherit; cursor:pointer; box-shadow:0 8px 24px rgba(239,68,68,.5); align-items:center; gap:8px; z-index:100; }
.qd-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.8); backdrop-filter:blur(8px); z-index:9999; display:none; justify-content:center; align-items:center; padding:20px; }
.qd-modal-overlay.show { display:flex; }
.qd-modal-content { background:var(--qd-bg-card); border:1px solid var(--qd-border); border-radius:var(--qd-radius-lg); padding:24px; width:100%; max-width:480px; max-height:90vh; overflow-y:auto; font-family:'Be Vietnam Pro',sans-serif; color:var(--qd-text-primary); }
.qd-modal-content * { box-sizing:border-box; }
.qd-modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
.qd-modal-title { font-size:16px; font-weight:700; display:flex; align-items:center; gap:10px; }
.qd-modal-title i { color:var(--qd-primary); }
.qd-modal-close { width:32px; height:32px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:var(--qd-radius-sm); color:var(--qd-text-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; }
.qd-modal-close:hover { color:var(--qd-text-primary); }
.qd-modal-actions { display:flex; gap:10px; margin-top:18px; }
.qd-modal-actions .qd-btn { flex:1; }
.qd-qr-preview { background:var(--qd-bg-input); border-radius:var(--qd-radius-md); padding:18px; text-align:center; margin-top:14px; display:none; border:2px solid var(--qd-success); }
.qd-qr-preview.show { display:block; }
.qd-qr-preview-title { font-size:12px; font-weight:700; color:var(--qd-success); margin-bottom:10px; display:flex; align-items:center; justify-content:center; gap:6px; }
.qd-qr-preview img { width:220px; height:220px; border-radius:var(--qd-radius-sm); margin-bottom:12px; background:#fff; padding:6px; box-shadow:0 4px 12px rgba(0,0,0,.3); }
.qd-qr-preview-info { font-size:12px; color:var(--qd-text-secondary); line-height:1.8; text-align:left; background:var(--qd-bg-card); padding:10px 14px; border-radius:var(--qd-radius-sm); }
.qd-qr-preview-info > div { display:flex; justify-content:space-between; gap:10px; word-break:break-word; }
.qd-qr-preview-info strong { color:var(--qd-text-muted); font-weight:600; min-width:80px; }
.qd-qr-preview-info span { font-weight:600; color:var(--qd-text-primary); text-align:right; }
.qd-qr-hint { margin-top:12px; padding:10px 12px; background:rgba(14,165,233,.08); border:1px dashed rgba(14,165,233,.4); border-radius:var(--qd-radius-sm); font-size:11px; color:var(--qd-text-muted); display:flex; align-items:center; gap:8px; }
.qd-qr-hint.hidden { display:none; }
.qd-qr-hint i { color:var(--qd-info); }
.qd-section-divider { display:flex; align-items:center; gap:8px; margin:18px 0 12px; padding-top:14px; border-top:1px dashed var(--qd-border); font-size:12px; font-weight:700; color:var(--qd-text-secondary); text-transform:uppercase; letter-spacing:.5px; }
.qd-section-divider i { color:var(--qd-primary); }
.qd-form-row { display:grid; grid-template-columns:1fr 1.4fr; gap:10px; }
.qd-form-row .qd-form-group { margin-bottom:0; }
.qd-amount-quick { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
.qd-amount-chip { padding:4px 10px; background:var(--qd-bg-input); border:1px solid var(--qd-border); border-radius:8px; font-size:11px; color:var(--qd-text-secondary); cursor:pointer; font-family:inherit; }
.qd-amount-chip:hover { border-color:var(--qd-primary); color:var(--qd-text-primary); }
.qd-toast { position:fixed; bottom:90px; left:50%; transform:translateX(-50%) translateY(150%); padding:12px 20px; border-radius:var(--qd-radius-md); color:#fff; font-weight:600; font-size:13px; z-index:10001; transition:transform .4s ease; max-width:90vw; box-shadow:0 8px 24px rgba(0,0,0,.4); }
.qd-toast.show { transform:translateX(-50%) translateY(0); }
.qd-toast.success { background:var(--qd-success); }
.qd-toast.error { background:var(--qd-danger); }
.qd-toast.warning { background:var(--qd-warning); }
.qd-spinner { width:32px; height:32px; border:3px solid var(--qd-border); border-top-color:var(--qd-primary); border-radius:50%; animation:qd-spin .9s linear infinite; margin:30px auto; }
@keyframes qd-spin { to { transform:rotate(360deg); } }
.qd-empty { text-align:center; padding:36px 20px; color:var(--qd-text-muted); }
.qd-empty i { font-size:36px; opacity:.4; margin-bottom:10px; display:block; }
.qd-empty p { font-size:13px; }
@media (max-width:1100px) {
  .qd-main-grid { grid-template-columns:1fr; }
  .qd-stats-panel { grid-template-columns:1fr 1fr; }
  .qd-stat-cta { grid-column:span 2; }
  .qd-btn-chi { width:100%; flex-direction:row; }
}
@media (max-width:640px) {
  .qd-container { padding:8px; }
  .qd-header { padding:14px; }
  .qd-stats-panel { padding:14px; gap:10px; }
  .qd-stat-value { font-size:18px; }
  .qd-stat.primary .qd-stat-value { font-size:22px; }
  .qd-btn-chi { display:none; }
  .qd-fab { display:flex; }
  .qd-expense-row { grid-template-columns:1fr auto; }
  .qd-expense-link { display:none; }
}
`;

const MARKUP = `
<div class="qd-container">
  <header class="qd-header">
    <div class="qd-header-left">
      <div class="qd-logo"><i class="fas fa-dragon"></i></div>
      <div class="qd-header-title">
        <h1>Quản Trị Quỹ Dầu</h1>
        <p>Chi tiền &amp; theo dõi tạm ứng — Rồng Vàng Hoàng Gia</p>
      </div>
    </div>
    <div class="qd-fiscal-badge"><i class="fas fa-calendar-alt"></i><span id="qd-fiscal-label">—</span></div>
  </header>
  <div class="qd-stats-panel">
    <div class="qd-stat primary">
      <div class="qd-stat-label"><i class="fas fa-wallet"></i> Số dư quỹ</div>
      <div class="qd-stat-value" id="qd-stat-balance">0 ₫</div>
      <div class="qd-stat-sub">141 — Tạm ứng / HR-EMP-00001</div>
    </div>
    <div class="qd-stat"><div class="qd-stat-label"><i class="fas fa-arrow-down"></i> Tổng nạp năm TC</div><div class="qd-stat-value positive" id="qd-stat-credit">0 ₫</div></div>
    <div class="qd-stat"><div class="qd-stat-label"><i class="fas fa-arrow-up"></i> Tổng chi năm TC</div><div class="qd-stat-value negative" id="qd-stat-debit">0 ₫</div></div>
    <div class="qd-stat"><div class="qd-stat-label"><i class="fas fa-calendar-day"></i> Chi tháng này</div><div class="qd-stat-value negative" id="qd-stat-month">0 ₫</div></div>
    <div class="qd-stat-cta"><button class="qd-btn-chi" id="qd-btn-open-expense"><i class="fas fa-minus-circle"></i><span>Chi tiền</span></button></div>
  </div>
  <div class="qd-main-grid">
    <div class="qd-card">
      <div class="qd-card-header">
        <div class="qd-card-title"><i class="fas fa-calendar-alt"></i> Lịch chi tiêu</div>
        <button class="qd-btn qd-btn-outline qd-btn-sm" id="qd-btn-clear-date" style="display:none;"><i class="fas fa-times"></i> Bỏ chọn ngày</button>
      </div>
      <div class="qd-card-body">
        <div class="qd-cal-header">
          <button class="qd-cal-nav-btn" id="qd-cal-prev"><i class="fas fa-chevron-left"></i></button>
          <div class="qd-cal-month-info"><div class="qd-cal-month-year" id="qd-cal-month-year">Tháng —</div><div class="qd-cal-lunar" id="qd-cal-lunar"></div></div>
          <button class="qd-cal-nav-btn" id="qd-cal-next"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="qd-cal-grid" id="qd-cal-grid"></div>
        <div class="qd-cal-legend">
          <div class="qd-cal-legend-item"><span class="qd-cal-legend-dot" style="background:rgba(99,102,241,0.15);border:1px solid var(--qd-primary);"></span> Hôm nay</div>
          <div class="qd-cal-legend-item"><span class="qd-cal-legend-dot" style="background:rgba(239,68,68,0.08);"></span> Có chi</div>
          <div class="qd-cal-legend-item"><span class="qd-cal-legend-dot" style="background:rgba(239,68,68,0.2);"></span> Chi nhiều</div>
        </div>
      </div>
    </div>
    <div class="qd-card">
      <div class="qd-card-header">
        <div class="qd-card-title"><i class="fas fa-list-alt"></i> Danh sách chi tiền</div>
        <button class="qd-btn qd-btn-outline qd-btn-sm" id="qd-btn-refresh"><i class="fas fa-sync-alt"></i> Tải lại</button>
      </div>
      <div class="qd-card-body">
        <div class="qd-filters">
          <div class="qd-pill-group" id="qd-period-pills">
            <button class="qd-pill active" data-period="this-month">Tháng này</button>
            <button class="qd-pill" data-period="last-month">Tháng trước</button>
            <button class="qd-pill" data-period="this-quarter">Quý này</button>
            <button class="qd-pill" data-period="fy">Năm TC</button>
          </div>
          <div class="qd-pill-group" id="qd-type-pills">
            <button class="qd-pill active" data-type="all">Tất cả</button>
            <button class="qd-pill" data-type="chi">Chi</button>
            <button class="qd-pill" data-type="nap">Nạp</button>
          </div>
          <div class="qd-search-wrap"><i class="fas fa-search"></i><input type="text" class="qd-search-input" id="qd-search" placeholder="Tìm nội dung..."></div>
        </div>
        <div class="qd-list-summary" id="qd-list-summary">
          <div class="qd-list-summary-item"><span class="label"><i class="fas fa-receipt"></i> Số giao dịch:</span><span class="value" id="qd-sum-count">0</span></div>
          <div class="qd-list-summary-item"><span class="label">Tổng chi:</span><span class="value" style="color:var(--qd-danger);" id="qd-sum-chi">0 ₫</span></div>
          <div class="qd-list-summary-item"><span class="label">Tổng nạp:</span><span class="value" style="color:var(--qd-success);" id="qd-sum-nap">0 ₫</span></div>
        </div>
        <div class="qd-expense-list" id="qd-expense-list"><div class="qd-spinner"></div></div>
        <div class="qd-pagination" id="qd-pagination"></div>
      </div>
    </div>
  </div>
</div>
<button class="qd-fab" id="qd-btn-open-expense-mobile"><i class="fas fa-minus-circle"></i><span>Chi tiền</span></button>
<div class="qd-modal-overlay" id="qd-expense-modal">
  <div class="qd-modal-content">
    <div class="qd-modal-header"><div class="qd-modal-title"><i class="fas fa-money-bill-wave"></i> Chi tiền từ quỹ</div><button class="qd-modal-close" id="qd-btn-close-expense"><i class="fas fa-times"></i></button></div>
    <div class="qd-form-group"><label><i class="fas fa-calendar"></i> Ngày chi *</label><input type="date" id="qd-exp-date" class="qd-input"></div>
    <div class="qd-form-group"><label><i class="fas fa-coins"></i> Số tiền (VNĐ) *</label><input type="number" id="qd-exp-amount" class="qd-input" placeholder="0" min="0">
      <div class="qd-amount-quick">
        <button class="qd-amount-chip" data-amount="100000">+100k</button><button class="qd-amount-chip" data-amount="200000">+200k</button>
        <button class="qd-amount-chip" data-amount="500000">+500k</button><button class="qd-amount-chip" data-amount="1000000">+1tr</button>
        <button class="qd-amount-chip" data-amount="2000000">+2tr</button><button class="qd-amount-chip" data-amount="5000000">+5tr</button>
        <button class="qd-amount-chip" data-amount="0">Xóa</button>
      </div>
    </div>
    <div class="qd-form-group"><label><i class="fas fa-align-left"></i> Nội dung *</label><textarea id="qd-exp-content" class="qd-input" placeholder="VD: Đổ dầu xe 29C-12345..." style="min-height:60px; resize:vertical;"></textarea></div>
    <div class="qd-form-group"><label><i class="fas fa-exchange-alt"></i> TK đối ứng (chi phí) *</label>
      <select id="qd-exp-account" class="qd-select">
        <option value="6412 - Chi phí bán hàng GT - HGC" selected>6412 — Chi phí bán hàng GT (vận chuyển)</option>
        <option value="6411 - Chi phí bán hàng MT - HGC">6411 — Chi phí bán hàng MT</option>
        <option value="642 - Chi phí quản lý - HGC">642 — Chi phí quản lý</option>
        <option value="1111 - Tiền mặt - HGC">1111 — Tiền mặt (hoàn quỹ)</option>
      </select>
    </div>
    <div class="qd-section-divider"><i class="fas fa-qrcode"></i><span>QR Chuyển khoản (tùy chọn)</span></div>
    <div class="qd-form-group"><label><i class="fas fa-bolt"></i> Chọn nhanh từ lái xe</label><select id="qd-exp-driver" class="qd-select"><option value="">— Hoặc nhập TK thủ công bên dưới —</option></select></div>
    <div class="qd-form-row">
      <div class="qd-form-group"><label><i class="fas fa-university"></i> Ngân hàng</label><select id="qd-exp-bank" class="qd-select"><option value="">— Chọn NH —</option></select></div>
      <div class="qd-form-group"><label><i class="fas fa-hashtag"></i> Số TK</label><input type="text" id="qd-exp-account-no" class="qd-input" placeholder="Số tài khoản" autocomplete="off"></div>
    </div>
    <div class="qd-form-group"><label><i class="fas fa-id-card"></i> Tên chủ TK</label><input type="text" id="qd-exp-account-name" class="qd-input" placeholder="VD: NGUYEN VAN A" autocomplete="off" style="text-transform:uppercase;"></div>
    <div class="qd-qr-preview" id="qd-exp-qr-preview">
      <div class="qd-qr-preview-title"><i class="fas fa-mobile-alt"></i> Quét QR để chuyển khoản</div>
      <img id="qd-exp-qr-img" src="" alt="QR Code">
      <div class="qd-qr-preview-info">
        <div><strong>NH:</strong> <span id="qd-exp-qr-bank">-</span></div>
        <div><strong>STK:</strong> <span id="qd-exp-qr-account">-</span></div>
        <div><strong>Chủ TK:</strong> <span id="qd-exp-qr-name">-</span></div>
        <div><strong>Số tiền:</strong> <span id="qd-exp-qr-amount" style="color:var(--qd-success);font-weight:700;">-</span></div>
        <div><strong>Nội dung:</strong> <span id="qd-exp-qr-content">-</span></div>
      </div>
      <div style="display:flex; gap:6px; margin-top:10px; justify-content:center;">
        <button class="qd-btn qd-btn-outline qd-btn-sm" id="qd-btn-copy-qr-account" type="button"><i class="fas fa-copy"></i> Sao chép STK</button>
        <a class="qd-btn qd-btn-outline qd-btn-sm" id="qd-btn-open-qr-large" target="_blank"><i class="fas fa-expand"></i> Xem to</a>
      </div>
    </div>
    <div class="qd-qr-hint" id="qd-exp-qr-hint"><i class="fas fa-info-circle"></i> Nhập đủ Số TK, Số tiền và Ngân hàng để sinh QR thanh toán</div>
    <div class="qd-modal-actions"><button class="qd-btn qd-btn-outline" id="qd-btn-cancel-expense">Hủy</button><button class="qd-btn qd-btn-success" id="qd-btn-save-expense"><i class="fas fa-check"></i> Tạo bút toán</button></div>
  </div>
</div>
<div class="qd-toast" id="qd-toast"></div>
`;

// ===== CONFIG =====
const COMPANY = "Công ty cổ phần Hoàng Giang";
const FUND_ACCOUNT = "141 - Tạm ứng - HGC";
const FUND_PARTY = "HR-EMP-00001";
const FY = { start: "2026-04-01", end: "2027-03-31" };
const ITEMS_PER_PAGE = 15;

const BANK_LIST = [
	{ id: "970422", name: "MB Bank", aliases: ["mb", "mbbank", "mb bank", "militarybank"] },
	{ id: "970436", name: "Vietcombank", aliases: ["vcb", "vietcombank"] },
	{ id: "970415", name: "VietinBank", aliases: ["vietinbank", "ctg"] },
	{ id: "970418", name: "BIDV", aliases: ["bidv"] },
	{ id: "970405", name: "Agribank", aliases: ["agribank", "agri"] },
	{ id: "970407", name: "Techcombank", aliases: ["tcb", "techcombank"] },
	{ id: "970416", name: "ACB", aliases: ["acb"] },
	{ id: "970423", name: "TPBank", aliases: ["tpbank", "tpb"] },
	{ id: "970432", name: "VPBank", aliases: ["vpbank", "vpb"] },
	{ id: "970403", name: "Sacombank", aliases: ["sacombank", "stb"] },
	{ id: "970437", name: "HDBank", aliases: ["hdbank", "hdb"] },
	{ id: "970443", name: "SHB", aliases: ["shb"] },
	{ id: "970448", name: "OCB", aliases: ["ocb"] },
	{ id: "970449", name: "LPBank", aliases: ["lpbank", "lienvietpostbank", "lpb"] },
	{ id: "970441", name: "VIB", aliases: ["vib"] },
	{ id: "970440", name: "SeABank", aliases: ["seabank", "seab"] },
	{ id: "970426", name: "MSB", aliases: ["msb", "maritime"] },
	{ id: "970431", name: "Eximbank", aliases: ["eximbank", "eib"] },
	{ id: "970403b", name: "Sacombank", aliases: [] },
	{ id: "970409", name: "BacABank", aliases: ["bacabank", "bab"] },
	{ id: "970428", name: "Nam A Bank", aliases: ["namabank", "nab"] },
	{ id: "970452", name: "KienLongBank", aliases: ["kienlongbank", "klb"] },
	{ id: "970454", name: "BVBank", aliases: ["bvbank"] },
	{ id: "970424", name: "Shinhan Bank", aliases: ["shinhan"] },
	{ id: "970458", name: "UOB", aliases: ["uob"] },
	{ id: "970412", name: "PVcomBank", aliases: ["pvcombank", "pvb"] },
];
const BANK_IDS = (() => {
	const m = {};
	BANK_LIST.forEach((b) => {
		m[b.name.toLowerCase().trim()] = b.id;
		b.aliases.forEach((a) => (m[a] = b.id));
	});
	return m;
})();
const BANK_NAMES = (() => {
	const m = {};
	BANK_LIST.forEach((b) => (m[b.id] = b.name));
	return m;
})();

// ===== LUNAR =====
const LUNAR_INFO = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06aa0,0x1a6c4,0x0aae0,0x092e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252];
const CAN = ["Giáp","Ất","Bính","Đinh","Mậu","Kỷ","Canh","Tân","Nhâm","Quý"];
const CHI = ["Tý","Sửu","Dần","Mão","Thìn","Tỵ","Ngọ","Mùi","Thân","Dậu","Tuất","Hợi"];
const LUNAR_MONTHS = ["Giêng","Hai","Ba","Tư","Năm","Sáu","Bảy","Tám","Chín","Mười","Một","Chạp"];
function lunarYearDays(y) { let s = 348; for (let i = 0x8000; i > 0x8; i >>= 1) s += LUNAR_INFO[y - 1900] & i ? 1 : 0; return s + leapDays(y); }
function leapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
function leapDays(y) { return leapMonth(y) ? (LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29) : 0; }
function lunarMonthDays(y, m) { return LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29; }
function solarToLunar(year, month, day) {
	if (year < 1900 || year > 2100) return { month: 0, day: 0, year: 0, isLeap: false };
	let offset = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(1900, 0, 31)) / 86400000);
	let ly = 1900, tmp = 0;
	for (ly = 1900; ly < 2101 && offset > 0; ly++) { tmp = lunarYearDays(ly); offset -= tmp; }
	if (offset < 0) { offset += tmp; ly--; }
	const lp = leapMonth(ly);
	let isLeap = false, lm = 1;
	for (lm = 1; lm < 13 && offset > 0; lm++) {
		if (lp > 0 && lm === lp + 1 && !isLeap) { --lm; isLeap = true; tmp = leapDays(ly); }
		else tmp = lunarMonthDays(ly, lm);
		if (isLeap && lm === lp + 1) isLeap = false;
		offset -= tmp;
	}
	if (offset === 0 && lp > 0 && lm === lp + 1) { if (isLeap) isLeap = false; else { isLeap = true; --lm; } }
	if (offset < 0) { offset += tmp; --lm; }
	return { year: ly, month: lm, day: offset + 1, isLeap };
}
const canChi = (y) => CAN[(y - 4) % 10] + " " + CHI[(y - 4) % 12];

// ===== STATE =====
const state = {
	calMonth: 0, calYear: 0, selectedDate: null,
	filterPeriod: "this-month", filterType: "all", searchQuery: "",
	page: 1, allTransactions: [], dailyTotals: {}, drivers: [],
};

// ===== HELPERS =====
const $ = (id) => document.getElementById(id);
const fmt = (n) => (!n || isNaN(n) ? "0 ₫" : new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " ₫");
const fmtK = (n) => { n = Math.abs(n); if (n >= 1e9) return (n / 1e9).toFixed(1) + "tỷ"; if (n >= 1e6) return Math.round(n / 1e6) + "tr"; if (n >= 1e3) return Math.round(n / 1e3) + "k"; return n; };
const fmtDate = (s) => (!s ? "" : new Date(s).toLocaleDateString("vi-VN"));
const escapeHtml = (s) => (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const getBankId = (name) => (!name ? "970422" : BANK_IDS[name.toLowerCase().trim()] || "970422");
const pad = (n) => String(n).padStart(2, "0");
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const vietQRUrl = (amount, content, bank) => {
	if (!bank || !bank.accountNo) return null;
	return `https://img.vietqr.io/image/${bank.bankId || "970422"}-${bank.accountNo}-compact2.png` +
		`?amount=${amount}&addInfo=${encodeURIComponent(content || "Thanh toan")}&accountName=${encodeURIComponent(bank.accountName || "")}`;
};
const toast = (msg, type = "success") => {
	const t = $("qd-toast"); if (!t) return;
	t.textContent = msg; t.className = "qd-toast " + type + " show";
	setTimeout(() => t.classList.remove("show"), 3500);
};
const F = () => window.frappe;

// ===== DATA =====
async function loadAllTransactions() {
	try {
		const r = await F().call({
			method: "frappe.client.get_list",
			args: {
				doctype: "GL Entry",
				filters: { docstatus: 1, account: FUND_ACCOUNT, party: FUND_PARTY, posting_date: ["between", [FY.start, FY.end]], is_cancelled: 0 },
				fields: ["name", "posting_date", "remarks", "debit", "credit", "voucher_type", "voucher_no", "against"],
				order_by: "posting_date desc, creation desc",
				limit_page_length: 0,
			},
		});
		state.allTransactions = (r.message || []).filter((t) => t.voucher_type !== "Period Closing Voucher");
		await mergeJournalEntryRemarks();
		computeDerivedData();
		renderAll();
	} catch (e) {
		console.error("loadAllTransactions", e);
		toast("Lỗi tải giao dịch", "error");
		state.allTransactions = [];
		computeDerivedData();
		renderAll();
	}
}
async function mergeJournalEntryRemarks() {
	const jeVouchers = [...new Set(state.allTransactions.filter((t) => t.voucher_type === "Journal Entry" && t.voucher_no).map((t) => t.voucher_no))];
	if (!jeVouchers.length) return;
	const CHUNK = 50, remarkMap = {};
	for (let i = 0; i < jeVouchers.length; i += CHUNK) {
		const chunk = jeVouchers.slice(i, i + CHUNK);
		try {
			const je = await F().call({ method: "frappe.client.get_list", args: { doctype: "Journal Entry", filters: [["name", "in", chunk]], fields: ["name", "user_remark"], limit_page_length: chunk.length } });
			(je.message || []).forEach((e) => { if (e.user_remark) remarkMap[e.name] = e.user_remark; });
		} catch (err) { console.warn("mergeJE chunk", err); }
	}
	state.allTransactions.forEach((t) => { if (t.voucher_type === "Journal Entry" && t.voucher_no && remarkMap[t.voucher_no]) t.remarks = remarkMap[t.voucher_no]; });
}
function computeDerivedData() {
	state.dailyTotals = {};
	state.allTransactions.forEach((t) => {
		const d = t.posting_date;
		if (!state.dailyTotals[d]) state.dailyTotals[d] = { chi: 0, nap: 0 };
		state.dailyTotals[d].chi += parseFloat(t.credit) || 0;
		state.dailyTotals[d].nap += parseFloat(t.debit) || 0;
	});
}
async function loadDrivers() {
	try {
		const r = await F().call({ method: "frappe.client.get_list", args: { doctype: "Driver", fields: ["name", "full_name", "cell_number", "custom_nganhang", "custom_stk", "custom_tentk"], limit_page_length: 0 } });
		state.drivers = (r.message || []).map((d) => ({
			id: d.name, name: d.full_name || d.name, phone: d.cell_number || "",
			bank: { bankId: getBankId(d.custom_nganhang), bankName: d.custom_nganhang || "", accountNo: d.custom_stk || "", accountName: d.custom_tentk || d.full_name || "" },
		}));
		populateDriverSelect();
	} catch (e) { console.error("loadDrivers", e); }
}

// ===== STATS =====
function renderStats() {
	let totalDebit = 0, totalCredit = 0;
	state.allTransactions.forEach((t) => { totalDebit += parseFloat(t.debit) || 0; totalCredit += parseFloat(t.credit) || 0; });
	const now = new Date();
	const mStart = dateStr(new Date(now.getFullYear(), now.getMonth(), 1));
	const mEnd = dateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
	let monthChi = 0;
	state.allTransactions.forEach((t) => { if (t.posting_date >= mStart && t.posting_date <= mEnd) monthChi += parseFloat(t.credit) || 0; });
	$("qd-stat-balance").textContent = fmt(totalDebit - totalCredit);
	$("qd-stat-credit").textContent = fmt(totalDebit);
	$("qd-stat-debit").textContent = fmt(totalCredit);
	$("qd-stat-month").textContent = fmt(monthChi);
	$("qd-fiscal-label").textContent = `${fmtDate(FY.start)} — ${fmtDate(FY.end)}`;
}

// ===== CALENDAR =====
function renderCalendar() {
	const grid = $("qd-cal-grid");
	const first = new Date(state.calYear, state.calMonth, 1);
	const last = new Date(state.calYear, state.calMonth + 1, 0);
	const startWeekday = first.getDay() === 0 ? 6 : first.getDay() - 1;
	const lunarFirst = solarToLunar(state.calYear, state.calMonth + 1, 1);
	$("qd-cal-month-year").textContent = `Tháng ${state.calMonth + 1}, ${state.calYear}`;
	$("qd-cal-lunar").textContent = `Tháng ${LUNAR_MONTHS[lunarFirst.month - 1]}${lunarFirst.isLeap ? " nhuận" : ""} — ${canChi(lunarFirst.year)}`;
	const weekdays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
	let html = weekdays.map((d) => `<div class="qd-cal-weekday">${d}</div>`).join("");
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const todayS = dateStr(today);
	let maxChi = 0;
	for (let day = 1; day <= last.getDate(); day++) { const ds = `${state.calYear}-${pad(state.calMonth + 1)}-${pad(day)}`; if (state.dailyTotals[ds]) maxChi = Math.max(maxChi, state.dailyTotals[ds].chi); }
	const prevLast = new Date(state.calYear, state.calMonth, 0).getDate();
	for (let i = startWeekday - 1; i >= 0; i--) {
		const day = prevLast - i;
		const pm = state.calMonth === 0 ? 12 : state.calMonth;
		const py = state.calMonth === 0 ? state.calYear - 1 : state.calYear;
		const lun = solarToLunar(py, pm, day);
		html += `<div class="qd-cal-day other-month"><div class="qd-cal-day-solar">${day}</div><div class="qd-cal-day-lunar">${lun.day}</div></div>`;
	}
	for (let day = 1; day <= last.getDate(); day++) {
		const ds = `${state.calYear}-${pad(state.calMonth + 1)}-${pad(day)}`;
		const lun = solarToLunar(state.calYear, state.calMonth + 1, day);
		const chi = state.dailyTotals[ds]?.chi || 0;
		let cls = "qd-cal-day";
		if (ds === todayS) cls += " today";
		if (ds === state.selectedDate) cls += " selected";
		if (chi > 0) { cls += " has-chi"; if (maxChi > 0 && chi >= maxChi * 0.6) cls += " heavy"; }
		const lunarDisplay = lun.day === 1 ? `${lun.month}/${lun.day}` : lun.day;
		const chiDisplay = chi > 0 ? `<div class="qd-cal-day-amount">-${fmtK(chi)}</div>` : "";
		html += `<div class="${cls}" data-date="${ds}"><div class="qd-cal-day-solar">${day}</div><div class="qd-cal-day-lunar">${lunarDisplay}</div>${chiDisplay}</div>`;
	}
	const totalCells = startWeekday + last.getDate();
	const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
	for (let day = 1; day <= remaining; day++) {
		const nm = state.calMonth === 11 ? 1 : state.calMonth + 2;
		const ny = state.calMonth === 11 ? state.calYear + 1 : state.calYear;
		const lun = solarToLunar(ny, nm, day);
		html += `<div class="qd-cal-day other-month"><div class="qd-cal-day-solar">${day}</div><div class="qd-cal-day-lunar">${lun.day}</div></div>`;
	}
	grid.innerHTML = html;
	grid.querySelectorAll(".qd-cal-day[data-date]").forEach((el) => {
		el.addEventListener("click", () => {
			const ds = el.dataset.date;
			state.selectedDate = state.selectedDate === ds ? null : ds;
			state.page = 1;
			renderCalendar(); renderExpenseList();
			$("qd-btn-clear-date").style.display = state.selectedDate ? "inline-flex" : "none";
		});
	});
}

// ===== EXPENSE LIST =====
function getFilteredTransactions() {
	let txs = state.allTransactions.slice();
	if (state.selectedDate) {
		txs = txs.filter((t) => t.posting_date === state.selectedDate);
	} else {
		const now = new Date(); let from, to;
		switch (state.filterPeriod) {
			case "this-month": from = dateStr(new Date(now.getFullYear(), now.getMonth(), 1)); to = dateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)); break;
			case "last-month": from = dateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = dateStr(new Date(now.getFullYear(), now.getMonth(), 0)); break;
			case "this-quarter": { const q = Math.floor(now.getMonth() / 3); from = dateStr(new Date(now.getFullYear(), q * 3, 1)); to = dateStr(new Date(now.getFullYear(), q * 3 + 3, 0)); break; }
			default: from = FY.start; to = FY.end;
		}
		txs = txs.filter((t) => t.posting_date >= from && t.posting_date <= to);
	}
	if (state.filterType === "chi") txs = txs.filter((t) => (parseFloat(t.credit) || 0) > 0);
	else if (state.filterType === "nap") txs = txs.filter((t) => (parseFloat(t.debit) || 0) > 0);
	if (state.searchQuery) { const q = state.searchQuery.toLowerCase(); txs = txs.filter((t) => (t.remarks || "").toLowerCase().includes(q)); }
	return txs;
}
function renderExpenseList() {
	const txs = getFilteredTransactions();
	let totalChi = 0, totalNap = 0;
	txs.forEach((t) => { totalChi += parseFloat(t.credit) || 0; totalNap += parseFloat(t.debit) || 0; });
	$("qd-sum-count").textContent = txs.length;
	$("qd-sum-chi").textContent = fmt(totalChi);
	$("qd-sum-nap").textContent = fmt(totalNap);
	const container = $("qd-expense-list");
	if (!txs.length) { container.innerHTML = `<div class="qd-empty"><i class="fas fa-inbox"></i><p>Không có giao dịch phù hợp</p></div>`; $("qd-pagination").innerHTML = ""; return; }
	const totalPages = Math.max(1, Math.ceil(txs.length / ITEMS_PER_PAGE));
	if (state.page > totalPages) state.page = 1;
	const start = (state.page - 1) * ITEMS_PER_PAGE;
	const pageItems = txs.slice(start, start + ITEMS_PER_PAGE);
	const groups = {};
	pageItems.forEach((t) => { (groups[t.posting_date] = groups[t.posting_date] || []).push(t); });
	let html = "";
	Object.keys(groups).sort().reverse().forEach((date) => {
		const items = groups[date];
		let dateChi = 0; items.forEach((t) => (dateChi += parseFloat(t.credit) || 0));
		const [y, m, d] = date.split("-").map(Number);
		const lun = solarToLunar(y, m, d);
		const wd = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(date).getDay()];
		html += `<div class="qd-date-group"><span class="qd-date-group-label"><i class="fas fa-calendar-day"></i> ${wd}, ${fmtDate(date)}<span class="qd-date-group-lunar">(${lun.day}/${lun.month} ÂL)</span></span><span class="qd-date-group-total">${dateChi > 0 ? "-" + fmt(dateChi) : ""}</span></div>`;
		items.forEach((t) => {
			const debit = parseFloat(t.debit) || 0, credit = parseFloat(t.credit) || 0;
			const isChi = credit > 0, amount = isChi ? credit : debit;
			const against = (t.against || "").split(",")[0].trim();
			html += `<div class="qd-expense-row"><div class="qd-expense-content"><div class="qd-expense-text">${escapeHtml(t.remarks || "(không có nội dung)")}</div><div class="qd-expense-meta"><span class="qd-expense-meta-tag"><i class="fas fa-${isChi ? "arrow-up" : "arrow-down"}"></i> ${isChi ? "Chi" : "Nạp"}</span>${against ? `<span class="qd-expense-meta-tag">${escapeHtml(against)}</span>` : ""}${t.voucher_no ? `<span class="qd-expense-meta-tag">${escapeHtml(t.voucher_no)}</span>` : ""}</div></div><div class="qd-expense-amount ${isChi ? "chi" : "nap"}">${isChi ? "-" : "+"}${fmt(amount)}</div>${t.voucher_no ? `<a class="qd-expense-link" href="/app/journal-entry/${encodeURIComponent(t.voucher_no)}" target="_blank" title="Mở bút toán"><i class="fas fa-external-link-alt"></i></a>` : "<span></span>"}</div>`;
		});
	});
	container.innerHTML = html;
	renderPagination(totalPages, txs.length);
}
function renderPagination(totalPages, totalItems) {
	const p = $("qd-pagination");
	if (totalPages <= 1) { p.innerHTML = `<span class="qd-page-info">${totalItems} giao dịch</span>`; return; }
	let html = `<button class="qd-page-btn" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}><i class="fas fa-chevron-left"></i></button>`;
	for (let i = 1; i <= totalPages; i++) {
		if (i === 1 || i === totalPages || (i >= state.page - 1 && i <= state.page + 1)) html += `<button class="qd-page-btn ${i === state.page ? "active" : ""}" data-page="${i}">${i}</button>`;
		else if (i === state.page - 2 || i === state.page + 2) html += `<span class="qd-page-info">…</span>`;
	}
	html += `<button class="qd-page-btn" data-page="${state.page + 1}" ${state.page === totalPages ? "disabled" : ""}><i class="fas fa-chevron-right"></i></button><span class="qd-page-info">${totalItems} GD</span>`;
	p.innerHTML = html;
	p.querySelectorAll(".qd-page-btn[data-page]").forEach((b) => b.addEventListener("click", () => { const np = parseInt(b.dataset.page); if (np >= 1 && np <= totalPages) { state.page = np; renderExpenseList(); } }));
}
function renderAll() { renderStats(); renderCalendar(); renderExpenseList(); }

// ===== MODAL =====
function populateDriverSelect() {
	const sel = $("qd-exp-driver"); if (!sel) return;
	sel.innerHTML = '<option value="">— Hoặc nhập TK thủ công bên dưới —</option>';
	state.drivers.forEach((d) => {
		const opt = document.createElement("option");
		opt.value = d.id;
		const hasBank = d.bank && d.bank.accountNo;
		opt.textContent = d.name + (d.phone ? ` (${d.phone})` : "") + (hasBank ? "" : " ⚠ chưa có TK");
		opt.dataset.bank = JSON.stringify(d.bank || {});
		opt.dataset.name = d.name;
		opt.disabled = !hasBank;
		sel.appendChild(opt);
	});
}
function populateBankSelect() {
	const sel = $("qd-exp-bank"); if (!sel) return;
	sel.innerHTML = '<option value="">— Chọn NH —</option>';
	BANK_LIST.forEach((b) => { const opt = document.createElement("option"); opt.value = b.id; opt.textContent = b.name; sel.appendChild(opt); });
}
function openExpenseModal() {
	$("qd-expense-modal").classList.add("show");
	$("qd-exp-date").value = state.selectedDate || dateStr(new Date());
	$("qd-exp-amount").value = ""; $("qd-exp-content").value = "";
	$("qd-exp-driver").value = ""; $("qd-exp-bank").value = "";
	$("qd-exp-account-no").value = ""; $("qd-exp-account-name").value = "";
	$("qd-exp-qr-preview").classList.remove("show"); $("qd-exp-qr-hint").classList.remove("hidden");
}
function closeExpenseModal() { $("qd-expense-modal").classList.remove("show"); }
function onDriverQuickFill() {
	const sel = $("qd-exp-driver");
	if (!sel.value) { updateExpenseQR(); return; }
	const bank = JSON.parse(sel.options[sel.selectedIndex].dataset.bank || "{}");
	if (bank.accountNo) {
		$("qd-exp-bank").value = bank.bankId || "";
		$("qd-exp-account-no").value = bank.accountNo;
		$("qd-exp-account-name").value = (bank.accountName || "").toUpperCase();
		const driverName = sel.options[sel.selectedIndex].dataset.name;
		if (!$("qd-exp-content").value.trim()) $("qd-exp-content").value = `Chi cho ${driverName}`;
	}
	updateExpenseQR();
}
function readCurrentBank() {
	const bankId = $("qd-exp-bank").value;
	return { bankId, accountNo: $("qd-exp-account-no").value.trim(), accountName: $("qd-exp-account-name").value.trim(), bankName: BANK_NAMES[bankId] || "" };
}
function updateExpenseQR() {
	const amount = parseFloat($("qd-exp-amount").value) || 0;
	const content = $("qd-exp-content").value.trim();
	const bank = readCurrentBank();
	const preview = $("qd-exp-qr-preview"), hint = $("qd-exp-qr-hint");
	const valid = bank.bankId && bank.accountNo && bank.accountNo.length >= 4 && amount > 0;
	if (!valid) { preview.classList.remove("show"); hint.classList.remove("hidden"); return; }
	const qrUrl = vietQRUrl(amount, content || "Thanh toan", bank);
	if (!qrUrl) { preview.classList.remove("show"); hint.classList.remove("hidden"); return; }
	$("qd-exp-qr-img").src = qrUrl;
	$("qd-exp-qr-bank").textContent = bank.bankName || bank.bankId;
	$("qd-exp-qr-account").textContent = bank.accountNo;
	$("qd-exp-qr-name").textContent = bank.accountName || "(không tên)";
	$("qd-exp-qr-amount").textContent = fmt(amount);
	$("qd-exp-qr-content").textContent = content || "(trống)";
	$("qd-btn-open-qr-large").href = qrUrl;
	preview.classList.add("show"); hint.classList.add("hidden");
}
async function copyToClipboard(text, label) {
	try { await navigator.clipboard.writeText(text); toast((label || "Đã sao chép") + ": " + text, "success"); }
	catch (e) {
		const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
		document.body.appendChild(ta); ta.select();
		try { document.execCommand("copy"); toast((label || "Đã sao chép") + ": " + text, "success"); } catch (_) { toast("Không sao chép được", "error"); }
		document.body.removeChild(ta);
	}
}
async function createExpenseEntry() {
	const date = $("qd-exp-date").value;
	const amount = parseFloat($("qd-exp-amount").value) || 0;
	const content = $("qd-exp-content").value.trim();
	const account = $("qd-exp-account").value;
	if (!date) { toast("Chọn ngày", "warning"); return; }
	if (amount <= 0) { toast("Nhập số tiền", "warning"); return; }
	if (!content) { toast("Nhập nội dung", "warning"); return; }
	try {
		const btn = $("qd-btn-save-expense");
		btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';
		const je = await F().call({
			method: "frappe.client.insert",
			args: { doc: { doctype: "Journal Entry", voucher_type: "Journal Entry", posting_date: date, company: COMPANY, user_remark: content,
				accounts: [
					{ account: FUND_ACCOUNT, party_type: "Employee", party: FUND_PARTY, debit_in_account_currency: 0, credit_in_account_currency: amount },
					{ account: account, debit_in_account_currency: amount, credit_in_account_currency: 0 },
				] } },
		});
		btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Tạo bút toán';
		if (je.message) {
			closeExpenseModal();
			toast(`Đã tạo ${je.message.name}`, "success");
			if (confirm(`Submit ${je.message.name}?`)) { await F().call({ method: "frappe.client.submit", args: { doc: je.message } }); toast("Đã submit", "success"); }
			loadAllTransactions();
		}
	} catch (e) {
		console.error(e);
		const btn = $("qd-btn-save-expense"); btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Tạo bút toán';
		toast("Lỗi tạo bút toán", "error");
	}
}

// ===== INIT =====
let _bound = false;
function bind() {
	$("qd-cal-prev").addEventListener("click", () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(); });
	$("qd-cal-next").addEventListener("click", () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(); });
	$("qd-btn-clear-date").addEventListener("click", () => { state.selectedDate = null; state.page = 1; renderCalendar(); renderExpenseList(); $("qd-btn-clear-date").style.display = "none"; });
	$("qd-period-pills").addEventListener("click", (e) => { const b = e.target.closest(".qd-pill"); if (!b) return; $("qd-period-pills").querySelectorAll(".qd-pill").forEach((p) => p.classList.remove("active")); b.classList.add("active"); state.filterPeriod = b.dataset.period; state.page = 1; renderExpenseList(); });
	$("qd-type-pills").addEventListener("click", (e) => { const b = e.target.closest(".qd-pill"); if (!b) return; $("qd-type-pills").querySelectorAll(".qd-pill").forEach((p) => p.classList.remove("active")); b.classList.add("active"); state.filterType = b.dataset.type; state.page = 1; renderExpenseList(); });
	let searchTimer;
	$("qd-search").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.searchQuery = e.target.value.trim(); state.page = 1; renderExpenseList(); }, 250); });
	$("qd-btn-refresh").addEventListener("click", loadAllTransactions);
	$("qd-btn-open-expense").addEventListener("click", openExpenseModal);
	$("qd-btn-open-expense-mobile").addEventListener("click", openExpenseModal);
	$("qd-btn-close-expense").addEventListener("click", closeExpenseModal);
	$("qd-btn-cancel-expense").addEventListener("click", closeExpenseModal);
	$("qd-btn-save-expense").addEventListener("click", createExpenseEntry);
	$("qd-exp-driver").addEventListener("change", onDriverQuickFill);
	$("qd-exp-bank").addEventListener("change", updateExpenseQR);
	$("qd-exp-account-no").addEventListener("input", updateExpenseQR);
	$("qd-exp-account-name").addEventListener("input", updateExpenseQR);
	$("qd-exp-amount").addEventListener("input", updateExpenseQR);
	$("qd-exp-content").addEventListener("input", updateExpenseQR);
	$("qd-btn-copy-qr-account").addEventListener("click", () => { const acc = $("qd-exp-account-no").value.trim(); if (acc) copyToClipboard(acc, "Đã chép STK"); });
	document.querySelectorAll(".qd-amount-chip").forEach((c) => c.addEventListener("click", () => { const inp = $("qd-exp-amount"); const add = parseInt(c.dataset.amount); if (add === 0) inp.value = ""; else inp.value = (parseInt(inp.value) || 0) + add; updateExpenseQR(); }));
	$("qd-expense-modal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("show"); });
}

function injectCss() {
	if (!document.getElementById("qd-font-link")) {
		const l = document.createElement("link"); l.id = "qd-font-link"; l.rel = "stylesheet"; l.href = FONT_LINK; document.head.appendChild(l);
	}
	if (!document.getElementById("qd-styles")) {
		const s = document.createElement("style"); s.id = "qd-styles"; s.textContent = CSS_TEXT; document.head.appendChild(s);
	}
}

// Mount vào 1 container (dùng làm phần đầu của #/tra-cuoc).
export function mountQuyDau(container) {
	injectCss();
	container.classList.add("qd-wrap");
	container.innerHTML = MARKUP;
	const now = new Date();
	state.calMonth = now.getMonth();
	state.calYear = now.getFullYear();
	state.selectedDate = null;
	state.page = 1;
	bind();
	populateBankSelect();
	loadDrivers();
	loadAllTransactions();
}
