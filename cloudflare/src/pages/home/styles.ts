export const homeStyles = String.raw`
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0F172A; color: #E2E8F0; line-height: 1.5; min-height: 100vh; }
:root { --bg-color:#0F172A; --card-base:#1E293B; --card-dark:#0F172A; --card-light:#334155; --text-color:#E2E8F0; --highlight-color:#FFD700; --color-primary:#6366F1; --color-system:#3B82F6; --color-character:#10B981; --color-event:#F59E0B; --color-extension:#8B5CF6; }
.container { max-width:1400px; margin:0 auto; padding:calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left)); }
.header { position:relative; z-index:60; display:flex; flex-direction:column; align-items:stretch; margin-bottom:32px; gap:16px; background:rgba(30,41,59,0.7); backdrop-filter:blur(8px); padding:16px 24px; border-radius:24px; border:1px solid rgba(255,255,255,0.08); }
.header-top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; width:100%; }
.header-bottom { display:flex; justify-content:flex-start; width:100%; min-width:0; }
.header-left { display:flex; align-items:flex-start; gap:20px; flex:0 0 auto; min-width:0; }
.header-discover { display:flex; flex-direction:column; align-items:flex-start; gap:10px; width:100%; min-width:0; }
.logo h1 { font-size:1.8rem; font-weight:700; background:linear-gradient(135deg, #6366F1, #8B5CF6); -webkit-background-clip:text; -webkit-text-fill-color:transparent; display:flex; align-items:center; gap:10px; white-space:nowrap; }
.release-notice { display:inline-flex; align-items:center; gap:7px; min-height:32px; padding:6px 11px; border-radius:999px; border:1px solid rgba(245,158,11,0.42); background:rgba(120,53,15,0.22); color:#FDE68A; cursor:pointer; font:inherit; font-size:0.76rem; white-space:nowrap; transition:background 0.18s ease,border-color 0.18s ease,transform 0.18s ease; }
.release-notice:hover { background:rgba(180,83,9,0.3); border-color:rgba(251,191,36,0.7); transform:translateY(-1px); }
.release-notice i { color:#FBBF24; }
.release-notice strong { color:#FEF3C7; font-weight:700; }
.release-update-guide { display:flex; flex-direction:column; gap:16px; }
.release-update-lead { color:rgba(226,232,240,0.9); }
.release-update-steps { margin-left:22px; display:flex; flex-direction:column; gap:9px; }
.release-update-steps code { color:#C7D2FE; }
.release-update-codebox { position:relative; }
.release-update-code { display:block; width:100%; min-height:92px; resize:none; padding:14px 82px 14px 14px; border-radius:12px; background:rgba(15,23,42,0.9); border:1px solid rgba(99,102,241,0.34); color:#C7D2FE; font:0.86rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; outline:none; }
.release-update-code:focus { border-color:rgba(129,140,248,0.75); box-shadow:0 0 0 2px rgba(99,102,241,0.14); }
.release-update-copy-btn { position:absolute; top:9px; right:9px; display:inline-flex; align-items:center; gap:6px; min-height:34px; padding:6px 10px; border:1px solid rgba(129,140,248,0.45); border-radius:9px; background:rgba(30,41,59,0.96); color:#E0E7FF; font:inherit; font-size:0.78rem; cursor:pointer; }
.release-update-copy-btn:hover { background:rgba(79,70,229,0.28); border-color:rgba(129,140,248,0.75); }
.user-info { display:flex; align-items:flex-start; justify-content:flex-end; gap:16px; flex-wrap:wrap; margin-left:auto; max-width:100%; }
.header-search { display:flex; align-items:center; gap:10px; width:100%; min-width:0; max-width:none; flex:1; padding:10px 14px; border-radius:999px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.08); }
.tag-filter { display:flex; align-items:center; justify-content:flex-start; gap:8px; flex-wrap:wrap; width:100%; }
.tag-filter-btn { border:1px solid rgba(148,163,184,0.35); background:rgba(15,23,42,0.62); color:#CBD5E1; border-radius:999px; padding:5px 12px; font-size:0.76rem; line-height:1.2; cursor:pointer; transition:background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease; }
.tag-filter-btn:hover { transform:translateY(-1px); border-color:rgba(226,232,240,0.55); color:#E2E8F0; }
.tag-filter-btn.active { color:#FFFFFF; }
.tag-filter-btn.is-disabled { opacity:0.55; cursor:wait; transform:none; }
.tag-filter-btn.all.active { border-color:rgba(99,102,241,0.62); background:rgba(99,102,241,0.22); }
.tag-filter-btn.system.active { border-color:rgba(59,130,246,0.62); background:rgba(59,130,246,0.22); }
.tag-filter-btn.character.active { border-color:rgba(16,185,129,0.62); background:rgba(16,185,129,0.22); }
.tag-filter-btn.event.active { border-color:rgba(245,158,11,0.62); background:rgba(245,158,11,0.22); }
.tag-filter-btn.extension.active { border-color:rgba(139,92,246,0.62); background:rgba(139,92,246,0.22); }
  .toggle-group { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .sort-select { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); font-size:0.82rem; white-space:nowrap; }
  .sort-select span { display:inline-flex; align-items:center; gap:6px; color:#CBD5E1; }
  .sort-select select { background:transparent; border:none; color:#E2E8F0; outline:none; font-size:0.82rem; cursor:pointer; }
  .sort-select select option { color:#0F172A; }
  .tavern-status { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); font-size:0.82rem; white-space:nowrap; }
  .tavern-status--connected { color:#86EFAC; border-color:rgba(34,197,94,0.35); }
  .tavern-status--connecting { color:#FDE68A; border-color:rgba(245,158,11,0.35); }
  .tavern-status--disconnected { color:#CBD5E1; }
  .tavern-status--error { color:#FCA5A5; border-color:rgba(239,68,68,0.35); }
  .header-search input { width:100%; background:transparent; border:none; color:#E2E8F0; outline:none; font-size:0.95rem; }

.header-search i { color:#94A3B8; }
.avatar,.detail-author-avatar,.author-avatar { border-radius:50%; object-fit:cover; }
.avatar { width:40px; height:40px; border:2px solid #6366F1; }
.author-avatar { width:24px; height:24px; }
.detail-author-avatar { width:36px; height:36px; border:2px solid rgba(99,102,241,0.4); }
.btn { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:30px; padding:8px 20px; color:#E2E8F0; font-weight:500; cursor:pointer; transition:all 0.2s; display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
.btn-primary { background:linear-gradient(135deg, #6366F1, #4F46E5); border:none; box-shadow:0 4px 15px rgba(99,102,241,0.4); }
.btn-primary:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(99,102,241,0.5); }
.btn-outline:hover,.action-btn:hover { background:rgba(99,102,241,0.2); border-color:#6366F1; }
.workshop-close-btn { min-height:44px; padding:8px 14px; border-color:rgba(248,113,113,0.45); background:rgba(127,29,29,0.22); color:#FECACA; }
.workshop-close-btn:hover { background:rgba(185,28,28,0.42); border-color:#F87171; color:#FFFFFF; transform:translateY(-1px); }
.is-loading { position:relative; opacity:0.92; cursor:progress; }
.is-loading i.fa-spinner { animation:cw-spin 0.8s linear infinite; }
.is-loading::after { content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 24px rgba(99,102,241,0.18); }
@keyframes cw-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
.badge-admin { background:#6366F1; padding:2px 8px; border-radius:30px; }
.badge-rejected { background:#B91C1C; }
.user-menu { position:relative; }
.user-menu-trigger { display:flex; align-items:center; gap:10px; background:transparent; border:none; color:#E2E8F0; cursor:pointer; }
.user-menu-name { max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.user-menu-dropdown { position:absolute; top:calc(100% + 10px); right:0; min-width:180px; background:rgba(15,23,42,0.96); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:8px; display:none; box-shadow:0 18px 40px rgba(0,0,0,0.35); z-index:20; }
.user-menu.open .user-menu-dropdown { display:flex; flex-direction:column; gap:6px; }
.user-menu-item { width:100%; border:none; background:rgba(255,255,255,0.04); color:#E2E8F0; border-radius:10px; padding:10px 12px; text-align:left; cursor:pointer; display:flex; align-items:center; gap:8px; }
.user-menu-item:hover { background:rgba(99,102,241,0.18); }
.user-menu-item.active { background:rgba(99,102,241,0.22); color:#C7D2FE; }
.sort-menu-trigger { padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.04); }
.sort-menu-trigger:hover { background:rgba(99,102,241,0.18); }
.sort-menu .user-menu-dropdown { min-width:210px; }
.projects-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:24px; margin-top:24px; }
.project-load-more { margin-top:28px; display:flex; flex-direction:column; align-items:center; gap:10px; }
.project-load-more-btn { min-width:220px; justify-content:center; }
.project-load-more-meta { font-size:0.82rem; color:rgba(226,232,240,0.68); }
.project-card { background:linear-gradient(145deg, #1E293B, #0F172A); border:1px solid rgba(255,255,255,0.08); border-radius:20px; overflow:hidden; transition:all 0.25s; display:flex; flex-direction:column; cursor:pointer; }
  .project-card:hover { transform:translateY(-6px); border-color:rgba(99,102,241,0.5); box-shadow:0 20px 25px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3); }
  .project-card:focus-visible { outline:2px solid #818CF8; outline-offset:3px; }
  .card-cover { height:160px; background-size:cover; background-position:center; background-color:#0F172A; position:relative; }
  .card-overlay-actions { position:absolute; right:12px; bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .icon-stat-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; font-size:0.78rem; backdrop-filter:blur(8px); position:relative; transition:transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease; }
  .like-btn { cursor:pointer; }
  .like-btn:hover { transform:translateY(-1px); box-shadow:0 10px 24px rgba(15,23,42,0.42); background:rgba(127,29,29,0.36); border-color:rgba(248,113,113,0.72); color:#FECACA; }
  .icon-stat-btn.liked { color:#FCA5A5; border-color:rgba(239,68,68,0.35); }
  .icon-stat-btn__hint { position:absolute; left:50%; bottom:calc(100% + 10px); transform:translateX(-50%) translateY(4px); pointer-events:none; opacity:0; padding:6px 10px; border-radius:10px; white-space:nowrap; background:rgba(15,23,42,0.96); border:1px solid rgba(255,255,255,0.12); color:#E2E8F0; font-size:0.72rem; line-height:1; box-shadow:0 12px 30px rgba(0,0,0,0.35); transition:opacity 0.18s ease, transform 0.18s ease; }
  .icon-stat-btn__hint::after { content:''; position:absolute; left:50%; top:100%; transform:translateX(-50%); border:6px solid transparent; border-top-color:rgba(15,23,42,0.96); }
  .like-btn:hover .icon-stat-btn__hint { opacity:1; transform:translateX(-50%) translateY(0); }
  .icon-stat-btn--static { cursor:default; opacity:0.9; }
  .icon-stat-btn.is-disabled { opacity:0.5; cursor:not-allowed; box-shadow:none; transform:none; }
  .icon-stat-btn.is-disabled:hover { background:rgba(15,23,42,0.82); border-color:rgba(255,255,255,0.1); color:#E2E8F0; transform:none; box-shadow:none; }
  .icon-stat-btn.is-disabled:hover .icon-stat-btn__hint { opacity:1; transform:translateX(-50%) translateY(0); }
  .card-content { padding:16px; display:flex; flex-direction:column; gap:12px; }

.card-row1,.card-meta,.detail-title-row { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.type-badge { padding:4px 12px; border-radius:30px; font-size:0.7rem; font-weight:600; text-transform:uppercase; background:rgba(59,130,246,0.2); color:#60A5FA; border:1px solid rgba(59,130,246,0.3); }
.type-badge.system { background:rgba(59,130,246,0.2); color:#60A5FA; }
.type-badge.character { background:rgba(16,185,129,0.2); color:#34D399; }
.type-badge.event { background:rgba(245,158,11,0.2); color:#FBBF24; }
.type-badge.extension { background:rgba(139,92,246,0.2); color:#A78BFA; }
  .project-name { font-weight:600; font-size:1rem; line-height:1.4; flex:1; text-align:right; }
  .card-author,.detail-author,.detail-meta,.detail-section-title,.detail-keywords { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .install-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:0.72rem; color:#BBF7D0; background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.3); margin-left:auto; }
  .install-badge--update { color:#FDE68A; border-color:rgba(245,158,11,0.35); background:rgba(245,158,11,0.12); }
  .project-tags,.detail-keyword-list { display:flex; flex-wrap:wrap; gap:8px; }
  .tag { background:rgba(255,255,255,0.08); padding:2px 10px; border-radius:30px; font-size:0.7rem; }
.tag-system-ejs { color:#E9D5FF; background:rgba(147,51,234,.16); border:1px solid rgba(192,132,252,.42); box-shadow:inset 0 0 0 1px rgba(255,255,255,.03); }
.tag-system-artwork { color:#A5F3FC; background:rgba(8,145,178,.14); border:1px solid rgba(34,211,238,.34); box-shadow:inset 0 0 0 1px rgba(255,255,255,.03); }
.card-artwork-badge { position:absolute; left:12px; top:12px; z-index:2; display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:9px; color:#67E8F9; background:rgba(8,47,73,.82); border:1px solid rgba(34,211,238,.42); font-size:.78rem; box-shadow:0 6px 16px rgba(2,8,23,.28),inset 0 0 0 1px rgba(255,255,255,.035); backdrop-filter:blur(8px); }
.card-artwork-badge i { line-height:1; }
  .card-meta { font-size:0.75rem; opacity:0.7; }
  .card-meta--version { align-items:center; }
  .version-block { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .version-diff { display:inline-flex; align-items:center; gap:6px; }
  .version-diff__from { color:#CBD5E1; }
  .version-diff__to { color:#FDE68A; font-weight:600; }
  .inline-update-btn { padding:4px 10px; font-size:0.72rem; border-radius:999px; }
  .card-actions,.admin-actions,.admin-card-actions { display:flex; gap:8px; justify-content:space-between; }
  .admin-actions--draft { flex-wrap:wrap; }
  .admin-actions--draft > * { flex:1 1 calc(50% - 4px); }
  .card-actions--primary > * { flex:1; }
  .install-btn { flex:1; }
  .edit-btn,.delete-btn,.delete-project-btn { flex:1; }
  .action-btn { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:6px 12px; color:inherit; cursor:pointer; transition:0.2s; font-size:0.8rem; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap; }
  .action-btn.is-disabled,.btn.is-disabled { opacity:0.45; cursor:not-allowed; pointer-events:none; }

  .action-btn.is-loading { opacity:0.75; cursor:wait; }
  .inline-loading-spinner,.loading-spinner { display:inline-block; border-radius:50%; border:2px solid rgba(255,255,255,0.2); border-top-color:#C7D2FE; animation:spin 0.8s linear infinite; }
  .inline-loading-spinner { width:14px; height:14px; }
  .loading-spinner { width:32px; height:32px; }
  @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
  .toggle-switch { display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.06); padding:4px 12px; border-radius:30px; cursor:pointer; }

.toggle-switch span { white-space:nowrap; }
.toggle-switch input { width:40px; height:20px; appearance:none; background:#334155; border-radius:20px; position:relative; cursor:pointer; }
.toggle-switch input:checked { background:#6366F1; }
.toggle-switch input::before { content:''; width:16px; height:16px; background:white; border-radius:50%; position:absolute; top:2px; left:2px; transition:0.2s; }
.toggle-switch input:checked::before { left:22px; }
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(8px); display:flex; justify-content:center; align-items:flex-start; padding:40px 20px; z-index:9999; overflow-y:auto; }
.modal-content { background:var(--bg-color); color:var(--text-color); border-radius:24px; max-width:860px; width:100%; max-height:calc(100vh - 80px); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,0.12); box-shadow:0 25px 50px -12px black; animation:slideUp 0.3s ease; }
@keyframes slideUp { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }
.modal-header { display:flex; justify-content:space-between; align-items:center; padding:24px 24px 12px; border-bottom:1px solid rgba(255,255,255,0.08); flex-shrink:0; }
.modal-header h2 { font-size:1.5rem; display:flex; align-items:center; gap:8px; }
.close-btn { width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; flex:none; background:none; border:none; border-radius:12px; color:inherit; font-size:1.4rem; cursor:pointer; opacity:0.72; touch-action:manipulation; }
.close-btn:hover { opacity:1; }
.modal-body { flex:1; overflow-y:auto; padding:20px 24px 24px; }
.detail-loading { min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; color:rgba(226,232,240,0.9); }
.detail-loading-text { font-size:0.95rem; }
.form-group { margin-bottom:16px; }
.form-group label { display:block; margin-bottom:6px; font-weight:500; opacity:0.8; }
.form-group input,.form-group textarea,.form-group select { width:100%; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:inherit; }
#characterFacetsGroup > label { margin-bottom:10px; color:#E2E8F0; font-weight:700; opacity:1; }
.taxonomy-facet-group { margin-top:8px; overflow:hidden; border:1px solid rgba(148,163,184,.16); border-radius:12px; background:rgba(15,23,42,.46); }
.taxonomy-facet-group summary { display:flex; align-items:center; gap:8px; padding:10px 12px; list-style:none; cursor:pointer; user-select:none; color:#E2E8F0; font-weight:700; }
.taxonomy-facet-group summary::-webkit-details-marker { display:none; }
.taxonomy-facet-group summary::before { content:'›'; flex:none; color:#94A3B8; font-size:1.05rem; line-height:1; transition:transform .16s ease; }
.taxonomy-facet-group[open] summary::before { transform:rotate(90deg); }
.taxonomy-facet-group summary small { margin-left:auto; color:rgba(226,232,240,.44); font-size:.7rem; font-weight:500; }
.taxonomy-chip-list { display:flex; flex-wrap:wrap; gap:8px; padding:0 12px 12px; }
.form-group .taxonomy-chip { display:inline-flex; max-width:100%; margin:0; font-weight:600; opacity:1; cursor:pointer; }
.form-group .taxonomy-chip input { position:absolute; width:1px; height:1px; margin:0; padding:0; opacity:0; pointer-events:none; }
.taxonomy-chip span { display:inline-flex; align-items:center; min-height:32px; max-width:100%; padding:6px 10px; border:1px solid rgba(148,163,184,.2); border-radius:999px; background:rgba(30,41,59,.72); color:rgba(226,232,240,.74); font-size:.8rem; line-height:1.2; transition:border-color .16s ease,background .16s ease,color .16s ease,transform .16s ease; }
.taxonomy-chip:hover span { border-color:rgba(129,140,248,.46); color:#E0E7FF; }
.taxonomy-chip input:checked + span { border-color:rgba(129,140,248,.62); background:rgba(99,102,241,.22); color:#EEF2FF; box-shadow:0 0 0 1px rgba(129,140,248,.12) inset; }
.taxonomy-chip input:checked + span::before { content:'✓'; margin-right:5px; color:#C7D2FE; font-size:.72rem; font-weight:800; }
.taxonomy-chip:active span { transform:scale(.97); }
.display-tags-label { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.display-tags-label small { color:rgba(199,210,254,.8); font-size:.75rem; font-weight:700; }
.display-tag-picker { padding:10px 0 2px; }
.display-tag-picker-empty { width:100%; padding:10px 12px; border:1px dashed rgba(148,163,184,.2); border-radius:12px; color:rgba(148,163,184,.68); font-size:.8rem; }
.form-hint { margin-top:6px; font-size:.82rem; line-height:1.45; color:rgba(226,232,240,.62); }
.file-drop { border:2px dashed rgba(255,255,255,0.2); border-radius:12px; padding:30px; text-align:center; cursor:pointer; transition:0.2s; }
.file-drop:hover { border-color:#6366F1; background:rgba(99,102,241,0.1); }
.file-drop.is-dragover { border-color:#818CF8; background:rgba(99,102,241,.18); box-shadow:0 0 0 3px rgba(99,102,241,.08) inset; }
.upload-file-preview { margin-top:10px; display:flex; flex-direction:column; gap:10px; }
.upload-file-preview[hidden] { display:none; }
.upload-file-preview .detail-section { margin:0; }
.upload-preview-summary { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 11px; border-radius:10px; border:1px solid rgba(99,102,241,.22); background:rgba(30,41,59,.52); color:rgba(226,232,240,.78); font-size:.82rem; }
.upload-preview-summary span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.upload-preview-summary strong { flex:none; color:#E0E7FF; font-size:.8rem; }
.upload-preview-summary-actions { display:inline-flex; align-items:center; gap:8px; flex:none; overflow:visible !important; }
.upload-preview-clear-btn,.upload-preview-remove-btn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; flex:none; padding:0; border-radius:999px; border:1px solid rgba(248,113,113,.28); background:rgba(127,29,29,.16); color:#FCA5A5; cursor:pointer; font:inherit; line-height:1; }
.upload-preview-clear-btn:hover,.upload-preview-remove-btn:hover { background:rgba(185,28,28,.28); color:#FECACA; }
.upload-preview-file-chip > span { min-width:0; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.upload-preview-files { display:flex; flex-wrap:wrap; gap:7px; }
.upload-preview-file-chip { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:6px 8px; border-radius:999px; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,42,.58); color:rgba(226,232,240,.78); font-size:.76rem; }
.upload-preview-file-chip b { color:#C7D2FE; font-weight:600; }
.upload-preview-error { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; border:1px solid rgba(248,113,113,.32); background:rgba(127,29,29,.18); color:#FECACA; font-size:.84rem; }
.upload-cover-image { display:block; width:100%; height:220px; object-fit:cover; object-position:center; border-radius:18px; border:1px solid rgba(255,255,255,.08); background:#0F172A; }
.edit-current-content { margin:18px 0 20px; display:flex; flex-direction:column; gap:12px; }
.edit-current-content .detail-section { margin:0; }
.edit-current-cover { border:1px solid rgba(148,163,184,.18); border-radius:12px; overflow:hidden; background:rgba(15,23,42,.46); }
.edit-current-cover .detail-section-title { padding:10px 12px; margin:0; }
.edit-current-cover img { display:block; width:100%; max-height:220px; object-fit:cover; }
.edit-current-cover--empty .empty-state { padding:18px 12px; }
.form-submit-btn { width:100%; padding:12px; justify-content:center; }
.toast { position:fixed; bottom:20px; right:20px; background:#1E293B; color:white; padding:12px 24px; border-radius:30px; box-shadow:0 8px 20px black; z-index:10000; border-left:4px solid #6366F1; }
.admin-review-modal,.admin-review-detail-modal { max-width:1040px; }
.admin-review-queue { display:flex; flex-direction:column; gap:14px; }
.admin-review-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:10px 12px; border:1px solid rgba(148,163,184,.14); border-radius:14px; background:rgba(15,23,42,.42); }
.admin-review-sort-control { display:inline-flex; align-items:center; gap:8px; color:rgba(226,232,240,.72); font-size:.8rem; }
.admin-review-sort-control select { min-width:118px; padding:7px 30px 7px 10px; border:1px solid rgba(148,163,184,.2); border-radius:10px; background:#111827; color:#E5E7EB; }
.admin-review-type-filters { display:flex; flex-wrap:wrap; gap:6px; }
.admin-review-filter-btn { border:1px solid rgba(148,163,184,.18); border-radius:999px; padding:6px 10px; background:rgba(30,41,59,.58); color:rgba(226,232,240,.72); font-size:.76rem; cursor:pointer; }
.admin-review-filter-btn:hover { border-color:rgba(129,140,248,.42); color:#E0E7FF; }
.admin-review-filter-btn.active { border-color:rgba(129,140,248,.58); background:rgba(99,102,241,.2); color:#EEF2FF; }
.admin-review-queue-summary { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px 14px; border:1px solid rgba(99,102,241,0.22); background:rgba(30,41,59,0.52); border-radius:14px; color:rgba(226,232,240,0.78); font-size:0.86rem; }
.admin-review-queue-summary strong { color:#E0E7FF; font-size:1.05rem; }
.admin-review-list { display:flex; flex-direction:column; gap:12px; }
.admin-review-card { background:linear-gradient(145deg,rgba(30,41,59,0.92),rgba(15,23,42,0.88)); border:1px solid rgba(148,163,184,0.16); border-radius:16px; padding:14px; box-shadow:0 10px 26px rgba(0,0,0,0.14); transition:transform .18s ease,border-color .18s ease,background .18s ease; cursor:pointer; }
.admin-review-card:focus-visible { outline:2px solid rgba(129,140,248,.7); outline-offset:2px; }
.admin-review-card-grid { display:grid; grid-template-columns:112px minmax(0,1fr); gap:14px; align-items:stretch; }
.admin-review-thumb { min-height:82px; border-radius:12px; background-position:center; background-size:cover; background-repeat:no-repeat; border:1px solid rgba(148,163,184,.14); background-color:rgba(15,23,42,.7); }
.admin-review-card-body { min-width:0; display:flex; flex-direction:column; }
.admin-review-title-line { display:flex; align-items:center; gap:8px; min-width:0; }
.admin-review-title-line .type-badge { flex:none; }
.admin-review-title-line .admin-review-title { min-width:0; }
.admin-review-card:hover { border-color:rgba(129,140,248,0.35); }
.admin-review-card.is-skipped { animation:adminReviewSkip .45s ease; }
@keyframes adminReviewSkip { 0% { transform:translateX(0); opacity:1; } 45% { transform:translateX(18px); opacity:.55; } 100% { transform:translateX(0); opacity:1; } }
.admin-review-card-head { display:flex; align-items:flex-start; gap:12px; }
.admin-review-position { flex:none; min-width:46px; padding:5px 8px; border-radius:999px; text-align:center; font-size:.72rem; font-weight:700; color:#C7D2FE; background:rgba(99,102,241,.13); border:1px solid rgba(99,102,241,.25); }
.admin-review-card-heading { min-width:0; flex:1; }
.admin-review-title { font-size:1.08rem; font-weight:750; line-height:1.35; word-break:break-word; }
.admin-review-author { margin-top:4px; font-size:.8rem; color:rgba(226,232,240,.68); display:flex; align-items:center; gap:6px; }




.admin-review-card-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.admin-review-card-actions .btn { min-width:118px; justify-content:center; }
.admin-review-detail-shell { display:flex; flex-direction:column; gap:16px; min-height:0; }
.admin-review-summary { display:flex; flex-direction:column; gap:14px; padding:18px; border-radius:18px; border:1px solid rgba(148,163,184,.16); background:linear-gradient(145deg,rgba(30,41,59,.92),rgba(15,23,42,.88)); }
.admin-review-summary-head { display:flex; align-items:flex-start; gap:12px; }
.admin-review-summary-heading { min-width:0; flex:1; }
.admin-review-summary-heading h3 { margin:0 0 5px; font-size:1.25rem; line-height:1.35; }
.admin-review-summary-heading > div { color:rgba(226,232,240,.68); font-size:.82rem; }

.admin-review-signals { display:flex; flex-wrap:wrap; gap:8px; }
.admin-review-signal { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; font-size:.76rem; color:#CBD5E1; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08); }
.admin-review-signal--info { color:#C7D2FE; border-color:rgba(99,102,241,.34); background:rgba(99,102,241,.1); }
.admin-review-signal--ejs { color:#E9D5FF; border-color:rgba(192,132,252,.42); background:rgba(147,51,234,.15); }
.admin-review-signal--good { color:#BBF7D0; border-color:rgba(34,197,94,.3); background:rgba(34,197,94,.1); }
.admin-review-signal--warning { color:#FDE68A; border-color:rgba(245,158,11,.34); background:rgba(245,158,11,.1); }
.admin-review-description { border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(15,23,42,.58); overflow:hidden; }
.admin-review-description summary { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:11px 13px; cursor:pointer; font-weight:650; color:#E2E8F0; }
.admin-review-description summary::-webkit-details-marker { display:none; }
.admin-review-description-hint { font-size:.72rem; font-weight:500; color:rgba(226,232,240,.5); }
.admin-review-description-body { max-height:260px; overflow:auto; padding:0 13px 13px; white-space:pre-wrap; word-break:break-word; color:rgba(226,232,240,.8); line-height:1.55; }
.admin-review-sticky-actions { position:sticky; bottom:0; z-index:4; display:flex; justify-content:flex-end; gap:8px; padding:12px; border-radius:14px; border:1px solid rgba(148,163,184,.16); background:rgba(15,23,42,.92); backdrop-filter:blur(12px); box-shadow:0 -12px 28px rgba(0,0,0,.22); }
.admin-review-sticky-actions .btn { min-width:108px; justify-content:center; }
.admin-review-approve-btn { color:#DCFCE7; border:1px solid rgba(34,197,94,.38); background:rgba(22,163,74,.24); }
.admin-review-approve-btn:hover { background:rgba(22,163,74,.4); }
.admin-review-reject-btn { color:#FECACA; border:1px solid rgba(248,113,113,.36); background:rgba(185,28,28,.22); }
.admin-review-reject-btn:hover { background:rgba(185,28,28,.4); }
.admin-log-card { display:flex; flex-direction:column; gap:10px; }
.admin-log-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.admin-log-head time { flex:none; color:rgba(148,163,184,.82); font-size:.76rem; white-space:nowrap; }
.admin-log-actor { display:flex; align-items:center; gap:7px; color:rgba(226,232,240,.7); font-size:.8rem; }
.admin-log-reason { padding:9px 11px; border-radius:10px; border:1px solid rgba(248,113,113,.24); background:rgba(127,29,29,.12); color:#FECACA; line-height:1.45; }
.admin-log-trace { border:1px solid rgba(148,163,184,.14); border-radius:11px; background:rgba(15,23,42,.5); overflow:hidden; }
.admin-log-trace summary { padding:9px 11px; cursor:pointer; color:rgba(203,213,225,.76); font-size:.78rem; font-weight:650; }
.admin-log-trace summary::-webkit-details-marker { display:none; }
.admin-log-trace > div { display:grid; grid-template-columns:110px minmax(0,1fr); gap:10px; padding:7px 11px; border-top:1px solid rgba(148,163,184,.08); align-items:start; }
.admin-log-trace > div > span { color:rgba(148,163,184,.78); font-size:.75rem; }
.admin-log-trace code { min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; color:#CBD5E1; font-size:.73rem; }
.admin-review-diff-summary { padding:16px; border-radius:16px; border:1px solid rgba(99,102,241,.28); background:linear-gradient(145deg,rgba(49,46,129,.18),rgba(15,23,42,.78)); display:flex; flex-direction:column; gap:12px; }
.admin-review-diff-summary-head { display:flex; justify-content:space-between; gap:12px; align-items:center; color:#CBD5E1; }
.admin-review-diff-summary-head strong { font-size:1.35rem; color:#E0E7FF; }
.admin-review-diff-summary-head span { font-size:.8rem; color:rgba(226,232,240,.58); }
.admin-review-diff-counts { display:flex; flex-wrap:wrap; gap:8px; }
.admin-review-diff-counts span,.admin-review-diff-status { display:inline-flex; align-items:center; gap:5px; padding:5px 9px; border-radius:999px; font-size:.75rem; font-weight:750; border:1px solid transparent; }
.admin-review-diff-counts .added,.admin-review-diff-status--added { color:#BBF7D0; background:rgba(22,163,74,.12); border-color:rgba(34,197,94,.3); }
.admin-review-diff-counts .modified,.admin-review-diff-status--modified { color:#FDE68A; background:rgba(217,119,6,.12); border-color:rgba(245,158,11,.3); }
.admin-review-diff-counts .deleted,.admin-review-diff-status--deleted { color:#FECACA; background:rgba(185,28,28,.13); border-color:rgba(248,113,113,.3); }
.admin-review-diff-counts .unchanged,.admin-review-diff-status--unchanged { color:#CBD5E1; background:rgba(100,116,139,.12); border-color:rgba(148,163,184,.22); }
.admin-review-risk-delta { display:flex; flex-direction:column; gap:8px; padding-top:10px; border-top:1px solid rgba(255,255,255,.07); }
.admin-review-risk-delta strong { font-size:.8rem; color:#E2E8F0; }
.admin-review-risk-delta > div { display:flex; flex-wrap:wrap; gap:7px; }
.admin-review-risk-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:999px; font-size:.74rem; }
.admin-review-risk-chip--warning { color:#FDE68A; background:rgba(217,119,6,.11); border:1px solid rgba(245,158,11,.28); }
.admin-review-risk-chip--good { color:#BBF7D0; background:rgba(22,163,74,.1); border:1px solid rgba(34,197,94,.25); }
.admin-review-risk-chip--danger { color:#FECACA; background:rgba(185,28,28,.11); border:1px solid rgba(248,113,113,.28); }
.admin-review-diff-section { display:flex; flex-direction:column; gap:10px; }
.admin-review-diff-list { display:flex; flex-direction:column; gap:10px; }
.admin-review-diff-entry { overflow:hidden; border-radius:14px; border:1px solid rgba(148,163,184,.15); background:rgba(15,23,42,.72); }
.admin-review-diff-entry--added { border-color:rgba(34,197,94,.24); }
.admin-review-diff-entry--modified { border-color:rgba(245,158,11,.24); }
.admin-review-diff-entry--deleted { border-color:rgba(248,113,113,.24); }
.admin-review-diff-entry > summary { list-style:none; cursor:pointer; display:grid; grid-template-columns:auto minmax(120px,1fr) auto; gap:10px; align-items:center; padding:11px 12px; }
.admin-review-diff-entry > summary::-webkit-details-marker { display:none; }
.admin-review-diff-entry-title { min-width:0; font-weight:720; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.admin-review-diff-fields { font-size:.72rem; color:rgba(226,232,240,.52); text-align:right; }
.admin-review-diff-entry-body { border-top:1px solid rgba(255,255,255,.06); }
.admin-review-diff-code { overflow:auto; max-height:520px; padding:8px 0; background:#0B1120; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.76rem; line-height:1.5; }
.admin-review-diff-line { display:grid; grid-template-columns:26px minmax(max-content,1fr); min-width:max-content; }
.admin-review-diff-line > span { user-select:none; text-align:center; color:rgba(226,232,240,.35); }
.admin-review-diff-line code { padding:1px 14px 1px 4px; white-space:pre; color:#CBD5E1; }
.admin-review-diff-line--add { background:rgba(22,163,74,.13); }
.admin-review-diff-line--add > span,.admin-review-diff-line--add code { color:#BBF7D0; }
.admin-review-diff-line--del { background:rgba(185,28,28,.14); }
.admin-review-diff-line--del > span,.admin-review-diff-line--del code { color:#FECACA; }
.admin-review-diff-line--same code { color:rgba(203,213,225,.62); }
.admin-review-diff-skip { padding:5px 14px 5px 30px; color:#818CF8; background:rgba(79,70,229,.08); font-size:.72rem; }
.admin-review-diff-empty,.admin-review-no-changes { padding:16px; text-align:center; color:rgba(226,232,240,.58); border:1px dashed rgba(148,163,184,.16); border-radius:12px; }
.admin-review-unchanged { border:1px solid rgba(148,163,184,.13); border-radius:14px; background:rgba(30,41,59,.42); overflow:hidden; }
.admin-review-unchanged > summary { list-style:none; cursor:pointer; padding:11px 13px; display:flex; justify-content:space-between; gap:10px; align-items:center; color:#CBD5E1; }
.admin-review-unchanged > summary::-webkit-details-marker { display:none; }
.admin-review-unchanged > summary small { color:rgba(226,232,240,.46); }
.admin-review-unchanged-titles { display:flex; flex-wrap:wrap; gap:6px; padding:0 13px 11px; }
.admin-review-unchanged-titles span { padding:4px 8px; border-radius:8px; background:rgba(255,255,255,.045); color:rgba(226,232,240,.68); font-size:.72rem; }
.admin-review-load-unchanged { margin:0 13px 13px; }
.admin-review-unchanged [data-admin-unchanged-content] { padding:0 13px 13px; }

.admin-list-item,.admin-card { background:rgba(30,41,59,0.8); border-radius:12px; padding:12px; margin-bottom:12px; }
.admin-list-item { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.admin-card-title { font-weight:bold; margin-bottom:4px; }
.admin-card-desc { margin:8px 0; }
  .detail-panel,.detail-summary,.detail-section,.detail-entry-meta { display:flex; flex-direction:column; gap:16px; }
  .detail-panel-scroll { overflow-y:auto; padding-right:4px; }
  .detail-cover { height:220px; border-radius:18px; background-size:cover; background-position:center; background-color:#0F172A; border:1px solid rgba(255,255,255,0.08); overflow:hidden; box-shadow:inset 0 -80px 120px rgba(15,23,42,0.35); }
  .detail-summary { padding:20px; background:linear-gradient(145deg, rgba(30,41,59,0.95), rgba(15,23,42,0.92)); border:1px solid rgba(255,255,255,0.08); border-radius:20px; }
  .detail-summary--split { display:grid; grid-template-columns:minmax(0, 1fr) 220px; gap:20px; align-items:start; }
  .detail-summary-main { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .detail-actions-panel { display:flex; flex-direction:column; gap:12px; padding:16px; border-radius:16px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.08); }
  .detail-install-btn,.detail-update-btn { justify-content:center; width:100%; }

.detail-card-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.detail-card-row-title { align-items:flex-start; }
.detail-tags-row { margin-top:2px; }
.detail-project-name { font-size:1.6rem; font-weight:700; line-height:1.25; word-break:break-word; }
.detail-meta-row { font-size:0.82rem; color:rgba(226,232,240,0.75); }
.detail-stats-row { display:flex; align-items:stretch; gap:8px; }
.detail-stat { min-width:86px; min-height:52px; display:grid; grid-template-columns:auto auto; grid-template-rows:auto auto; align-items:center; justify-content:start; column-gap:7px; padding:8px 10px; border:1px solid rgba(255,255,255,.08); border-radius:10px; background:rgba(15,23,42,.42); color:rgba(226,232,240,.78); }
.detail-stat i { grid-row:1 / span 2; color:#94A3B8; }
.detail-stat strong { font-size:.86rem; color:#E2E8F0; line-height:1.1; }
.detail-stat span { font-size:.66rem; color:rgba(226,232,240,.5); line-height:1.1; }
button.detail-stat { cursor:pointer; text-align:left; font:inherit; }
button.detail-stat:hover:not(:disabled) { border-color:rgba(248,113,113,.3); background:rgba(127,29,29,.12); }
button.detail-stat.liked i { color:#F87171; }
button.detail-stat:disabled { cursor:not-allowed; opacity:.55; }
.detail-meta-item { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); }
.detail-description,.detail-entry-content { border-radius:16px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.06); color:rgba(226,232,240,0.88); white-space:pre-wrap; word-break:break-word; }
.entry-behavior-meta { display:flex; flex-wrap:wrap; gap:7px; padding:10px 12px; border-radius:12px; background:rgba(14,116,144,.08); border:1px solid rgba(34,211,238,.16); }
.entry-behavior-meta span { display:inline-flex; align-items:center; gap:5px; padding:4px 8px; border-radius:999px; background:rgba(255,255,255,.05); color:rgba(224,242,254,.82); font-size:.72rem; line-height:1.2; }
.admin-review-diff-entry-body > .entry-behavior-meta { margin:10px 10px 0; }
.detail-description { padding:16px 18px; }
.external-links-section { gap:12px; }
.external-links-note { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; border-radius:12px; background:rgba(245,158,11,.11); border:1px solid rgba(251,191,36,.38); color:#FDE68A; font-size:.78rem; font-weight:600; line-height:1.45; }
.external-links-note i { margin-top:2px; flex:none; color:#FBBF24; }
.external-link-groups { display:flex; flex-direction:column; gap:8px; }
.external-link-domain { overflow:hidden; border:1px solid rgba(148,163,184,.14); border-radius:12px; background:rgba(15,23,42,.6); }
.external-link-domain > summary { list-style:none; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; color:#E2E8F0; font-size:.82rem; font-weight:650; }
.external-link-domain > summary::-webkit-details-marker { display:none; }
.external-link-domain > summary span { display:inline-flex; align-items:center; gap:7px; min-width:0; }
.external-link-domain > summary span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.external-link-domain > summary span:last-child { flex:none; color:rgba(226,232,240,.55); font-size:.72rem; }
.external-link-list { display:flex; flex-direction:column; gap:8px; padding:0 10px 10px; }
.external-link-item { min-width:0; padding:10px; border-radius:10px; background:rgba(2,6,23,.48); border:1px solid rgba(255,255,255,.05); }
.external-link-item code { display:block; max-width:100%; overflow-wrap:anywhere; white-space:pre-wrap; color:#BFDBFE; font-size:.76rem; line-height:1.45; user-select:text; }
.external-link-sources { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.external-link-sources span { display:inline-flex; max-width:100%; padding:3px 7px; border-radius:999px; background:rgba(255,255,255,.05); color:rgba(226,232,240,.62); font-size:.68rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.external-link-copy-trigger { width:100%; display:block; padding:0; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.external-link-copy-trigger:hover code { color:#d8c39f; text-decoration:underline; text-underline-offset:3px; }
.external-link-warning-modal { z-index:10020; }
.external-link-warning-modal .modal-content { max-width:620px; border-radius:16px; background:#18191c; border:1px solid rgba(255,255,255,.1); }
.external-link-warning { display:grid; grid-template-columns:auto minmax(0,1fr); gap:14px 16px; padding:4px 2px 2px; }
.external-link-warning-icon { width:38px; height:38px; display:grid; place-items:center; border-radius:10px; background:rgba(245,158,11,.1); color:#d9b66e; }
.external-link-warning-copy { min-width:0; }
.external-link-warning-copy strong { display:block; color:#efeee9; font-size:.95rem; }
.external-link-warning-copy p { margin:7px 0 12px; color:#aaa8a3; font-size:.8rem; line-height:1.55; }
.external-link-warning-host { display:block; margin-bottom:5px; color:#bca57f; font-size:.72rem; font-weight:700; }
.external-link-warning-copy code { display:block; max-width:100%; padding:10px 11px; overflow-wrap:anywhere; border:1px solid rgba(255,255,255,.07); border-radius:8px; background:#111214; color:#bbb9b4; font-size:.74rem; line-height:1.5; user-select:text; }
.external-link-warning-actions { grid-column:1 / -1; display:flex; justify-content:flex-end; gap:8px; padding-top:4px; }
.external-link-warning-actions .btn { width:auto; min-width:108px; }
.external-link-warning-copy-btn { background:#bea47d; border-color:#ceb58f; color:#151619; }
.detail-entry-list { display:flex; flex-direction:column; gap:12px; }
.entry-item { border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden; background:rgba(15,23,42,0.55); }
.entry-header { background:rgba(0,0,0,0.3); padding:12px 14px; cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:500; }
.entry-title { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.entry-remove-btn { flex:none; width:36px; height:36px; margin-left:auto; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; border:1px solid rgba(248,113,113,0.38); background:rgba(127,29,29,0.28); color:#FCA5A5; cursor:pointer; }
.entry-remove-btn:hover { background:rgba(185,28,28,0.48); border-color:rgba(248,113,113,0.72); color:#FFF; }
.entry-remove-btn i { transform:none !important; font-size:0.82rem; }
.entry-header i { font-size:0.8rem; transition:transform 0.2s; }
.entry-header.open i { transform:rotate(90deg); }
.entry-content { padding:0 14px; max-height:0; overflow:hidden; transition:max-height 0.3s ease, padding 0.3s ease, margin 0.3s ease; }
.entry-content.open { padding:0 14px 14px; margin-top:2px; max-height:280px; overflow-y:auto; }
.strategy-badge { display:inline-block; width:24px; text-align:center; font-weight:bold; }
.strategy-constant { color:#3B82F6; }
.strategy-selective { color:#10B981; }
.detail-keywords-block { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid rgba(99,102,241,0.28); border-radius:14px; background:rgba(30,41,59,0.5); }
.detail-keywords-title { font-size:0.78rem; font-weight:700; letter-spacing:0.08em; color:#C7D2FE; text-transform:uppercase; }
.detail-keyword-list { margin-top:6px; }
.keyword-chip { display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; border:1px solid rgba(99,102,241,0.6); background:rgba(99,102,241,0.08); color:#C7D2FE; font-size:0.78rem; line-height:1.2; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04); }
.detail-entry-content { padding:14px; }
  .empty-state { padding:18px; border-radius:14px; border:1px dashed rgba(255,255,255,0.14); color:rgba(226,232,240,0.72); text-align:center; }
  .update-modal { display:flex; flex-direction:column; gap:20px; }
  .update-diff-group { display:flex; flex-direction:column; gap:16px; }
  .update-modal-actions { display:flex; justify-content:flex-end; gap:12px; padding-top:8px; }
  .install-worldbook-form { display:flex; flex-direction:column; gap:18px; }
  .install-target-switch { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); overflow:hidden; border:1px solid rgba(148,163,184,.22); border-radius:14px; background:rgba(15,23,42,.7); }
  .install-target-option { min-height:48px; justify-content:center; gap:8px; border:0; border-radius:0; background:transparent; color:rgba(226,232,240,.72); box-shadow:none; }
  .install-target-option + .install-target-option { border-left:1px solid rgba(148,163,184,.18); }
  .install-target-option:hover:not(:disabled) { background:rgba(99,102,241,.09); color:#E0E7FF; transform:none; box-shadow:none; }
  .install-target-option.active { background:rgba(99,102,241,.2); color:#C7D2FE; box-shadow:inset 0 0 0 1px rgba(129,140,248,.28); }
  .install-target-option:disabled { cursor:not-allowed; opacity:.4; }
  .install-additional-panel { display:flex; flex-direction:column; gap:10px; }
  .install-additional-panel[hidden] { display:none !important; }
  .install-worldbook-search-wrap { position:relative; }
  .install-worldbook-search-wrap > i { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:rgba(148,163,184,.65); pointer-events:none; }
  .install-worldbook-search-wrap input { width:100%; padding-left:38px; }
  .install-worldbook-list { display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto; padding:2px; }
  .install-worldbook-option { width:100%; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; padding:11px 12px; border:1px solid rgba(148,163,184,.16); border-radius:11px; background:rgba(15,23,42,.55); color:#E2E8F0; text-align:left; cursor:pointer; }
  .install-worldbook-option span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .install-worldbook-option > i:last-child { opacity:0; color:#A7F3D0; }
  .install-worldbook-option:hover { border-color:rgba(129,140,248,.38); background:rgba(99,102,241,.08); }
  .install-worldbook-option.active { border-color:rgba(52,211,153,.48); background:rgba(16,185,129,.1); }
  .install-worldbook-option.active > i:last-child { opacity:1; }
  .install-worldbook-empty { padding:18px 12px; border:1px dashed rgba(148,163,184,.18); border-radius:11px; color:rgba(203,213,225,.62); text-align:center; }
  .install-submit-btn { width:100%; justify-content:center; min-height:46px; border:1px solid rgba(52,211,153,.55); background:linear-gradient(135deg,#059669,#10B981); color:#ECFDF5; box-shadow:0 6px 18px rgba(16,185,129,.2); }
  .install-submit-btn:hover { transform:translateY(-1px); border-color:rgba(110,231,183,.8); box-shadow:0 8px 22px rgba(16,185,129,.28); }
  @media (max-width: 960px) { .header-top { flex-direction:column; align-items:stretch; } .header-left { width:100%; } .user-info { width:100%; justify-content:flex-end; margin-left:0; } }
  @media (max-width: 640px) { .header-discover { width:100%; min-width:0; } .header-search { max-width:none; } .tag-filter { width:100%; } .modal-overlay { padding:calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left)); } .modal-content { max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); border-radius:18px; } .modal-header { padding:12px 12px 8px 18px; } .modal-header h2 { font-size:1.2rem; min-width:0; } .modal-body { padding:14px 18px calc(18px + env(safe-area-inset-bottom)); } .detail-cover { height:180px; } .detail-summary { padding:16px; } .detail-summary--split { grid-template-columns:1fr; } .detail-card-row { align-items:flex-start; } }
  @media (max-width: 960px) { .header-left { flex-wrap:wrap; } }
  @media (max-width: 640px) { .release-notice { max-width:100%; white-space:normal; text-align:left; } }
  @media (max-width: 640px) { .admin-review-toolbar { align-items:stretch; flex-direction:column; } .admin-review-sort-control { justify-content:space-between; } .admin-review-sort-control select { flex:1; min-width:0; } .admin-review-queue-summary { align-items:flex-start; flex-direction:column; } .admin-review-card-grid { grid-template-columns:84px minmax(0,1fr); gap:10px; } .admin-review-thumb { min-height:72px; } .admin-review-card-head { flex-wrap:wrap; gap:8px; } .admin-review-title-line { flex-wrap:wrap; } .admin-review-card-actions { display:grid; grid-template-columns:1fr 1fr; } .admin-review-card-actions .btn { min-width:0; } .admin-review-summary-head { flex-wrap:wrap; } .admin-review-description-hint { display:none; } .admin-review-sticky-actions { display:grid; grid-template-columns:1fr 1fr; padding:10px; } .admin-review-sticky-actions .btn { min-width:0; } .admin-review-sticky-actions [data-admin-review-back] { grid-column:1 / -1; } .admin-review-diff-summary-head { align-items:flex-start; flex-direction:column; } .admin-review-diff-entry > summary { grid-template-columns:auto minmax(0,1fr); } .admin-review-diff-fields { grid-column:1 / -1; text-align:left; } .admin-review-diff-code { max-height:60dvh; font-size:.7rem; } .admin-review-unchanged > summary { align-items:flex-start; flex-direction:column; } .admin-log-head { flex-direction:column; gap:5px; } .admin-log-head time { white-space:normal; } .admin-log-trace > div { grid-template-columns:1fr; gap:4px; } }

/* 2026 mobile gallery integration: homepage discovery shell only. */
body { background:#0f1012; color:#ececea; }
.container { max-width:1480px; padding:calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(96px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left)); }
.projects-grid { grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px; margin-top:16px; align-items:start; }
.project-card { position:relative; overflow:visible; border:1px solid rgba(255,255,255,.075); border-radius:11px; background:#1b1c1f; box-shadow:0 4px 14px rgba(0,0,0,.14); transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease; }
.project-card:hover { transform:translateY(-2px); border-color:rgba(255,255,255,.13); box-shadow:0 10px 26px rgba(0,0,0,.2); }
.project-card:focus-visible { outline:2px solid rgba(162,139,107,.65); outline-offset:3px; }
.card-head { position:relative; height:36px; display:flex; align-items:center; gap:8px; padding:0 6px 0 10px; border-bottom:1px solid rgba(255,255,255,.075); border-radius:10px 10px 0 0; background:#1b1c1f; }
.card-creator { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#aaa8a3; font-size:.68rem; }
.card-admin-control { position:relative; flex:none; }
.card-more-btn { width:28px; height:28px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.055); border-radius:7px; background:rgba(255,255,255,.035); color:rgba(236,236,234,.5); font:700 .96rem/1 system-ui,sans-serif; cursor:pointer; opacity:.72; }
.card-more-btn:hover,.card-more-btn:focus-visible { opacity:1; color:#d7d6d2; background:rgba(255,255,255,.065); border-color:rgba(255,255,255,.095); outline:none; }
.card-admin-menu { position:absolute; top:33px; right:0; z-index:24; width:148px; display:none; flex-direction:column; gap:5px; padding:6px; border:1px solid rgba(255,255,255,.1); border-radius:9px; background:rgba(33,34,38,.97); box-shadow:0 18px 42px rgba(0,0,0,.38); backdrop-filter:blur(18px); }
.project-card.admin-menu-open .card-admin-menu { display:flex; }
.card-admin-menu .action-btn { width:100%; min-height:36px; justify-content:flex-start; flex:none; border:0; background:transparent; color:#d8d7d3; border-radius:7px; font-size:.72rem; }
.card-admin-menu .action-btn:hover { transform:none; background:rgba(255,255,255,.06); border-color:transparent; }
.card-admin-menu .delete-btn,.card-admin-menu .delete-project-btn { color:#e7a39e; }
.card-cover,.card-text-preview { width:100%; aspect-ratio:1/1; border-bottom:1px solid rgba(255,255,255,.075); background:#212226; }
.card-cover { height:auto; background-size:cover; background-position:center; }
.card-text-preview { display:flex; flex-direction:column; justify-content:space-between; gap:10px; padding:14px 13px 12px; overflow:hidden; }
.card-text-preview__type { color:#73726e; font-size:.61rem; font-weight:760; letter-spacing:.06em; text-transform:uppercase; }
.card-text-preview p { margin:0; color:#ececea; font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif; font-size:.8rem; line-height:1.58; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:6; overflow:hidden; }
.card-text-preview__hint { color:#73726e; font-size:.61rem; }
.card-content { padding:10px 10px 8px; gap:0; }
.project-name { min-height:2.5em; color:#ececea; font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif; font-size:.9rem; font-weight:700; line-height:1.38; text-align:left; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.project-tags { display:flex; flex-wrap:nowrap; gap:0; min-width:0; margin-top:7px; overflow:hidden; white-space:nowrap; color:#77756f; }
.project-tags .tag { flex:none; padding:0; border:0; border-radius:0; background:transparent; color:#8f8d87; font-size:.59rem; line-height:1.4; }
.project-tags .tag + .tag::before { content:' · '; margin:0 2px; color:#66645f; }
.card-status-line { display:flex; align-items:center; gap:6px; min-width:0; margin-top:6px; color:#aaa8a3; font-size:.58rem; overflow:hidden; }
.card-reject-reason { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#d07770; }
.card-footer { min-height:38px; margin-top:8px; padding-top:7px; border-top:1px solid rgba(255,255,255,.075); display:flex; align-items:center; gap:6px; }
.card-signals { min-width:0; flex:1; display:flex; align-items:center; gap:8px; overflow:hidden; white-space:nowrap; color:#77756f; }
.card-quality-signal { display:inline-flex; align-items:center; gap:4px; min-width:0; color:#8f8d87; font-size:.58rem; }
.card-quality-signal i { color:#a28b6b; font-size:.62rem; }
.card-quality-signal--installed i { color:#8ea88f; }
.card-footer-actions { flex:none; display:flex; align-items:center; gap:4px; }
.card-footer .action-btn { min-height:30px; padding:0 8px; border:0; border-radius:7px; background:transparent; color:#d9d8d4; font-size:.62rem; font-weight:760; }
.card-footer .action-btn:hover { transform:none; border-color:transparent; background:rgba(162,139,107,.1); color:#c5ad8b; }
.card-footer .action-btn.is-disabled { opacity:.42; }
.card-footer .inline-update-btn { color:#c5ad8b; }
.card-overlay-actions,.card-artwork-badge,.card-author,.card-meta--version,.card-actions--primary,.admin-actions { display:none !important; }
@media (max-width:640px) {
  .container { padding:calc(8px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right)) calc(96px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left)); }
  .header { position:sticky; top:0; z-index:60; margin:calc(-8px - env(safe-area-inset-top)) -10px 10px; padding:calc(7px + env(safe-area-inset-top)) 10px 7px; border-radius:0; border-width:0 0 1px; background:rgba(21,22,25,.90); backdrop-filter:blur(18px); }
  .header-top { flex-direction:row; align-items:center; min-height:44px; gap:8px; }
  .header-left { width:auto; min-width:0; flex:1; flex-wrap:nowrap; align-items:center; gap:7px; }
  .header-bottom,.header-discover { display:none; }
  .logo { min-width:0; }
  .logo h1 { min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:none; -webkit-text-fill-color:currentColor; color:#ececea; font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif; font-size:1.02rem; font-weight:700; }
  .logo h1 i { display:none; }
  .release-notice { width:36px; min-width:36px; height:36px; min-height:36px; padding:0; justify-content:center; border-radius:9px; border-color:rgba(162,139,107,.18); background:rgba(162,139,107,.07); color:#b9a180; }
  .release-notice span,.release-notice strong { display:none; }
  .release-notice i { color:#a28b6b; }
  .user-info { width:auto; flex:none; margin:0; gap:5px; flex-wrap:nowrap; align-items:center; }
  .toggle-group { gap:5px; flex-wrap:nowrap; }
  .toggle-group .sort-menu,.toggle-group .toggle-switch { display:none; }
  .tavern-status { width:36px; height:36px; padding:0; justify-content:center; border-radius:9px; background:rgba(255,255,255,.035); border-color:rgba(255,255,255,.06); }
  .tavern-status span { display:none; }
  .workshop-close-btn { width:36px; height:36px; min-height:36px; padding:0; justify-content:center; border-radius:9px; }
  .workshop-close-btn { font-size:0; }
  .workshop-close-btn i { font-size:.82rem; }
  .user-menu-trigger { width:38px; height:38px; padding:0; justify-content:center; }
  .user-menu-trigger .user-menu-name,.user-menu-trigger > i { display:none; }
  .avatar { width:34px; height:34px; border:1px solid rgba(255,255,255,.12); }
  #loginBtn { min-height:38px; padding:0 11px; border-radius:9px; box-shadow:none; }
  .projects-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:12px; }
  .project-card:hover { transform:none; box-shadow:0 4px 14px rgba(0,0,0,.14); }
  .card-head { height:34px; padding-left:9px; }
  .card-content { padding:9px 9px 7px; }
  .project-name { font-size:.86rem; }
  .project-tags .tag { font-size:.56rem; }
  .card-quality-signal span { display:none; }
  .card-quality-signal { gap:0; }
  .mobile-tool-dock { position:fixed; left:50%; bottom:max(8px,env(safe-area-inset-bottom)); z-index:80; width:min(calc(100% - 18px),420px); transform:translateX(-50%); display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; padding:5px; border:1px solid rgba(255,255,255,.10); border-radius:13px; background:rgba(33,34,38,.88); box-shadow:0 16px 42px rgba(0,0,0,.34); backdrop-filter:blur(22px); }
  .mobile-tool-dock button { height:46px; display:flex; align-items:center; justify-content:center; gap:6px; border:1px solid transparent; border-radius:9px; background:transparent; color:#aaa8a3; font:700 .68rem/1 system-ui,sans-serif; }
  .mobile-tool-dock button i { font-size:.9rem; }
  .mobile-tool-dock button.active,.mobile-tool-dock button:active { color:#c5ad8b; background:rgba(162,139,107,.10); border-color:rgba(162,139,107,.16); }
  .mobile-tool-backdrop { position:fixed; inset:0; z-index:70; display:block; visibility:hidden; opacity:0; background:rgba(0,0,0,.34); transition:opacity .16s ease,visibility .16s ease; }
  .mobile-tool-backdrop.show { visibility:visible; opacity:1; }
  .mobile-tool-sheet { position:fixed; left:50%; bottom:calc(max(8px,env(safe-area-inset-bottom)) + 62px); z-index:75; width:min(calc(100% - 18px),604px); max-height:min(62dvh,560px); display:block; visibility:hidden; opacity:0; transform:translate(-50%,12px); overflow:hidden; border:1px solid rgba(255,255,255,.10); border-radius:13px; background:rgba(33,34,38,.96); box-shadow:0 24px 60px rgba(0,0,0,.38); backdrop-filter:blur(22px); transition:opacity .18s ease,transform .18s ease,visibility .18s ease; }
  .mobile-tool-sheet.show { visibility:visible; opacity:1; transform:translate(-50%,0); }
  .mobile-tool-sheet-head { height:50px; display:flex; align-items:center; padding:0 13px; border-bottom:1px solid rgba(255,255,255,.075); }
  .mobile-tool-sheet-head strong { font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif; font-size:.9rem; }
  .mobile-tool-sheet-head button { margin-left:auto; height:36px; border:0; background:transparent; color:#c5ad8b; font-weight:700; }
  .mobile-tool-panel { padding:13px; overflow:auto; max-height:calc(62dvh - 50px); }
  .mobile-tool-panel[hidden] { display:none; }
  .mobile-search-box { height:48px; display:flex; align-items:center; gap:9px; padding:0 12px; border:1px solid rgba(255,255,255,.10); border-radius:9px; background:#1b1c1f; color:#73726e; }
  .mobile-search-box input { width:100%; height:100%; border:0; outline:0; background:transparent; color:#ececea; font-size:16px; }
  .mobile-filter-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
  .mobile-filter-option { min-height:42px; border:1px solid rgba(255,255,255,.08); border-radius:8px; background:transparent; color:#aaa8a3; font-size:.72rem; }
  .mobile-filter-option.active { color:#c5ad8b; border-color:rgba(162,139,107,.26); background:rgba(162,139,107,.09); }
  .mobile-sort-list { padding-top:5px; padding-bottom:5px; }
  .mobile-sort-option { width:100%; height:48px; display:flex; align-items:center; gap:10px; border:0; border-bottom:1px solid rgba(255,255,255,.065); background:transparent; color:#d9d8d4; text-align:left; }
  .mobile-sort-option:last-child { border-bottom:0; }
  .mobile-sort-option i { margin-left:auto; color:#c5ad8b; }
  .mobile-tool-empty { padding:24px 12px; text-align:center; color:#77756f; font-size:.72rem; }
}
@media (min-width:641px) {
  .mobile-tool-dock,.mobile-tool-backdrop,.mobile-tool-sheet { display:none !important; }
}

/* Project detail v3: large modal workspace with bounded reading columns. */
.project-detail-modal { padding:24px 36px; overflow:hidden; align-items:center; background:rgba(5,6,8,.78); backdrop-filter:blur(10px); }
.project-detail-modal .modal-content { width:min(100%,1480px); max-width:1480px; height:calc(100dvh - 48px); max-height:calc(100dvh - 48px); background:#18191c; color:#ececea; border:1px solid rgba(255,255,255,.09); border-radius:14px; box-shadow:0 28px 80px rgba(0,0,0,.5); animation:slideUp .18s ease; }
.project-detail-modal .modal-header { min-height:58px; padding:0 20px; background:#18191c; border-bottom:1px solid rgba(255,255,255,.07); }
.project-detail-modal .modal-header h2 { color:#d9d8d4; font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif; font-size:.9rem; font-weight:700; }
.project-detail-modal .modal-header h2 i { color:#a28b6b; }
.project-detail-modal .close-btn { width:38px; height:38px; border-radius:9px; color:#aaa8a3; }
.project-detail-modal .close-btn:hover { background:rgba(255,255,255,.05); color:#ececea; }
.project-detail-modal .modal-body { padding:0; overflow-x:hidden; }
.project-detail-modal .detail-panel { gap:24px; }
.project-detail-modal .detail-panel-scroll { overflow:visible; padding:24px 26px 30px; }
.project-detail-modal .detail-hero { display:grid; grid-template-columns:minmax(360px,460px) minmax(0,1fr); gap:30px; align-items:start; }
.project-detail-modal .detail-cover { width:100%; aspect-ratio:4/3; height:auto; min-height:0; align-self:start; border:1px solid rgba(255,255,255,.07); border-radius:11px; background-color:#212226; background-size:contain; background-position:center; background-repeat:no-repeat; box-shadow:none; }
.project-detail-modal .detail-primary { min-width:0; min-height:100%; display:flex; flex-direction:column; justify-content:flex-start; gap:13px; padding:10px 0 4px; }
.project-detail-modal .detail-project-name { margin:0; color:#f1f1ef; font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif; font-size:clamp(1.2rem,2.25vw,1.62rem); font-weight:760; line-height:1.34; letter-spacing:-.015em; word-break:break-word; }
.project-detail-modal .detail-identity-row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-width:0; color:#aaa8a3; font-size:.78rem; }
.project-detail-modal .detail-author { min-width:0; gap:7px; flex-wrap:nowrap; }
.project-detail-modal .detail-author > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.project-detail-modal .detail-author-avatar { width:29px; height:29px; flex:none; display:block; border:1px solid rgba(255,255,255,.12); background-color:#25262a; background-position:center; background-size:cover; background-repeat:no-repeat; }
.project-detail-modal .detail-identity-separator { color:#5f5e5a; }
.project-detail-modal .detail-type-label { color:#a9cdb9; font-weight:720; }
.project-detail-modal .detail-actions-panel { display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:0; border:0; border-radius:0; background:none; }
.project-detail-modal .detail-action-buttons { width:100%; display:flex; gap:8px; }
.project-detail-modal .detail-install-btn,.project-detail-modal .detail-update-btn { width:auto; min-height:44px; flex:1 1 0; justify-content:center; border-radius:9px; font-weight:760; box-shadow:none; transform:none; }
.project-detail-modal .detail-install-btn { border:1px solid #ceb58f; background:#bea47d; color:#151619; }
.project-detail-modal .detail-install-btn:hover:not(:disabled) { border-color:#dbc39d; background:#cdb38b; color:#101113; box-shadow:0 8px 20px rgba(0,0,0,.2); transform:none; }
.project-detail-modal .detail-install-btn.is-loading::after { box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); }
.project-detail-modal .detail-update-btn { border:1px solid rgba(255,255,255,.1); background:#222327; color:#cfcdc8; }
.project-detail-modal .detail-update-btn:hover:not(:disabled) { border-color:rgba(162,139,107,.35); background:rgba(162,139,107,.09); color:#cbb18d; transform:none; }
.project-detail-modal .install-badge { width:max-content; }
.project-detail-modal .detail-tags-row { display:flex; flex-wrap:wrap; gap:6px; min-width:0; margin:0; overflow:visible; white-space:normal; }
.project-detail-modal .detail-tags-row .tag { flex:none; padding:5px 9px; border:1px solid rgba(255,255,255,.075); border-radius:999px; background:rgba(255,255,255,.045); color:#aaa8a3; font-size:.71rem; line-height:1.2; }
.project-detail-modal .detail-tags-row .tag-system-ejs { border-color:rgba(190,166,204,.2); background:rgba(154,123,170,.085); color:#c8b8cf; }
.project-detail-modal .detail-tags-row .tag-system-artwork { border-color:rgba(142,168,143,.22); background:rgba(120,151,122,.08); color:#aac0aa; }
.project-detail-modal .detail-tags-row .tag + .tag::before { content:none; }
.project-detail-modal .detail-stats-row { display:flex; align-items:center; gap:18px; min-height:30px; }
.project-detail-modal .detail-stat { min-width:0; min-height:0; display:inline-flex; align-items:center; justify-content:flex-start; gap:6px; padding:0; border:0; border-radius:0; background:none; color:#85837e; }
.project-detail-modal .detail-stat i { grid-row:auto; color:#77756f; font-size:.76rem; }
.project-detail-modal .detail-stat strong { color:#cac9c5; font-size:.78rem; font-weight:760; line-height:1; }
.project-detail-modal .detail-stat span { color:#77756f; font-size:.68rem; line-height:1; }
.project-detail-modal button.detail-stat:hover:not(:disabled) { border:0; background:none; color:#d9aaa5; }
.project-detail-modal button.detail-stat:hover:not(:disabled) i,.project-detail-modal button.detail-stat.liked i { color:#d97872; }
.project-detail-modal button.detail-stat:disabled { opacity:.55; }
.project-detail-modal .detail-warning { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; border:1px solid rgba(245,158,11,.24); border-radius:10px; background:rgba(245,158,11,.07); color:#dbc58d; font-size:.76rem; line-height:1.5; }
.project-detail-modal .detail-warning i { flex:none; margin-top:3px; }
.project-detail-modal .detail-overview { display:flex; flex-direction:column; gap:10px; align-items:flex-start; }
.project-detail-modal .detail-overview .detail-block-title,.project-detail-modal .detail-overview .detail-description { width:100%; }
.project-detail-modal .detail-primary .detail-facts { width:100%; margin-top:auto; grid-template-columns:repeat(4,minmax(0,1fr)); }
.project-detail-modal .detail-primary .detail-fact:nth-child(n+3) { border-top:0; }
.project-detail-modal .detail-primary .detail-fact + .detail-fact { border-left:1px solid rgba(255,255,255,.065); }
.project-detail-modal .detail-block-title,.project-detail-modal .detail-section-title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0; color:#e5e4e1; font-size:.9rem; font-weight:760; }
.project-detail-modal .detail-description { max-width:820px; padding:0; border:0; border-radius:0; background:none; color:#bbb9b4; font-size:.84rem; line-height:1.72; white-space:normal; word-break:break-word; }
.project-detail-modal .detail-markdown { min-width:0; }
.project-detail-modal .detail-markdown > :first-child { margin-top:0; }
.project-detail-modal .detail-markdown > :last-child { margin-bottom:0; }
.project-detail-modal .detail-markdown p { margin:0 0 13px; }
.project-detail-modal .detail-markdown h3,.project-detail-modal .detail-markdown h4 { margin:20px 0 8px; color:#e5e4e1; line-height:1.4; }
.project-detail-modal .detail-markdown h3 { font-size:1rem; }
.project-detail-modal .detail-markdown h4 { font-size:.9rem; }
.project-detail-modal .detail-markdown ul,.project-detail-modal .detail-markdown ol { margin:7px 0 14px; padding-left:1.55rem; }
.project-detail-modal .detail-markdown li + li { margin-top:4px; }
.project-detail-modal .detail-markdown blockquote { margin:10px 0 14px; padding:4px 0 4px 12px; border-left:2px solid rgba(190,164,125,.45); color:#aaa8a3; }
.project-detail-modal .detail-md-rule { height:1px; margin:18px 0; border:0; background:rgba(255,255,255,.075); }
.project-detail-modal .detail-md-inline-code { padding:2px 5px; border-radius:5px; background:rgba(255,255,255,.06); color:#d3c1a4; font-family:Consolas,"Cascadia Mono",monospace; font-size:.8em; }
.project-detail-modal .detail-md-code { max-width:100%; margin:10px 0 15px; padding:12px 14px; overflow-x:auto; border:1px solid rgba(255,255,255,.07); border-radius:8px; background:#111214; color:#c7c5c0; font-family:Consolas,"Cascadia Mono",monospace; font-size:.76rem; line-height:1.55; white-space:pre; }
.project-detail-modal .detail-safe-link { display:inline; max-width:100%; margin:0; padding:0; border:0; background:none; color:#c6ad86; font:inherit; text-align:inherit; text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; overflow-wrap:anywhere; cursor:pointer; }
.project-detail-modal .detail-safe-link:hover { color:#dbc39d; }
.project-detail-modal .detail-facts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-content:start; overflow:hidden; border-width:1px 0; border-style:solid; border-color:rgba(255,255,255,.07); border-radius:0; }
.project-detail-modal .detail-fact { min-width:0; display:grid; grid-template-columns:auto minmax(0,1fr); grid-template-rows:auto auto; gap:2px 8px; padding:12px 10px; }
.project-detail-modal .detail-fact:nth-child(even) { border-left:1px solid rgba(255,255,255,.065); }
.project-detail-modal .detail-fact:nth-child(n+3) { border-top:1px solid rgba(255,255,255,.065); }
.project-detail-modal .detail-fact i { grid-row:1 / span 2; align-self:center; color:#77756f; font-size:.78rem; }
.project-detail-modal .detail-fact span { color:#6f6d68; font-size:.62rem; line-height:1.2; }
.project-detail-modal .detail-fact strong { min-width:0; overflow:hidden; color:#b9b7b2; font-size:.74rem; font-weight:720; line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }
.project-detail-modal .detail-section { gap:10px; padding-top:20px; border-top:1px solid rgba(255,255,255,.075); }
.project-detail-modal .detail-section-title > span { display:inline-flex; align-items:center; gap:7px; }
.project-detail-modal .detail-section-title > span:last-child { flex:none; color:#706e69; font-size:.68rem; font-weight:650; }
.project-detail-modal .detail-entry-list { gap:0; }
.project-detail-modal .entry-item { border:0; border-bottom:1px solid rgba(255,255,255,.06); border-radius:0; background:transparent; }
.project-detail-modal .entry-item:first-child { border-top:1px solid rgba(255,255,255,.06); }
.project-detail-modal .entry-header { min-height:48px; padding:10px 4px; background:transparent; color:#c8c6c1; font-size:.82rem; font-weight:650; }
.project-detail-modal .entry-header:hover { background:rgba(255,255,255,.018); }
.project-detail-modal .entry-header > i { color:#6f6d68; }
.project-detail-modal .strategy-badge { width:24px; height:24px; flex:none; display:grid; place-items:center; border-radius:7px; background:rgba(255,255,255,.045); font-size:.68rem; }
.project-detail-modal .entry-content { padding:0 4px; transition:max-height .2s ease,padding .2s ease; }
.project-detail-modal .entry-content.open { max-height:none; overflow:visible; margin:0; padding:12px 4px 16px; border-top:1px solid rgba(255,255,255,.045); }
.project-detail-modal .detail-entry-meta { display:grid; grid-template-columns:minmax(220px,280px) minmax(0,1fr); grid-template-rows:auto auto; gap:12px 18px; align-items:start; }
.project-detail-modal .entry-behavior-meta { gap:6px; padding:0; border:0; border-radius:0; background:none; }
.project-detail-modal .entry-behavior-meta span { padding:4px 7px; border-radius:7px; background:rgba(255,255,255,.035); color:#92908b; font-size:.66rem; }
.project-detail-modal .detail-keywords-block { display:grid; grid-template-columns:1fr; gap:10px; padding:0; border:0; border-radius:0; background:none; }
.project-detail-modal .detail-keywords-title { color:#77756f; font-size:.64rem; letter-spacing:.04em; }
.project-detail-modal .detail-keyword-list { display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; }
.project-detail-modal .keyword-chip { padding:3px 7px; border:1px solid rgba(255,255,255,.08); border-radius:7px; background:rgba(255,255,255,.025); box-shadow:none; color:#a7a59f; font-size:.66rem; }
.project-detail-modal .detail-entry-content { grid-column:2; grid-row:1 / span 2; min-height:100%; padding:4px 0 4px 16px; border:0; border-left:1px solid rgba(255,255,255,.06); border-radius:0; background:transparent; color:#bdbbb6; font-size:.79rem; line-height:1.7; }
.project-detail-modal .detail-entry-workspace-section { min-width:0; }
.project-detail-modal .detail-entry-workspace { display:grid; grid-template-columns:minmax(260px,300px) minmax(0,1fr); align-items:start; min-width:0; border-top:1px solid rgba(255,255,255,.06); }
.project-detail-modal .detail-entry-nav { position:sticky; top:0; align-self:start; max-height:calc(100dvh - 106px); overflow-y:auto; border-right:1px solid rgba(255,255,255,.065); scrollbar-width:thin; }
.project-detail-modal .detail-entry-nav-item { width:100%; min-height:52px; display:flex; align-items:center; gap:9px; padding:9px 10px; border:0; border-bottom:1px solid rgba(255,255,255,.055); border-radius:0; background:transparent; color:#b9b7b2; text-align:left; cursor:pointer; box-shadow:none; }
.project-detail-modal .detail-entry-nav-item:hover { background:rgba(255,255,255,.025); color:#e2e1de; transform:none; }
.project-detail-modal .detail-entry-nav-item.active { background:rgba(162,139,107,.11); color:#eceae5; box-shadow:inset 2px 0 0 #a28b6b; }
.project-detail-modal .detail-entry-nav-copy { min-width:0; display:flex; flex:1; flex-direction:column; gap:3px; }
.project-detail-modal .detail-entry-nav-copy strong { overflow:hidden; color:inherit; font-size:.78rem; font-weight:680; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
.project-detail-modal .detail-entry-nav-copy small { color:#77756f; font-size:.62rem; line-height:1.2; }
.project-detail-modal .detail-entry-pane { min-width:0; padding:0 0 0 28px; scroll-margin-top:68px; }
.project-detail-modal .detail-entry-panel { display:none; min-width:0; }
.project-detail-modal .detail-entry-panel.active { display:block; }
.project-detail-modal .detail-entry-panel-heading { display:flex; align-items:center; gap:9px; min-height:52px; max-width:860px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.055); }
.project-detail-modal .detail-entry-panel-heading h3 { min-width:0; margin:0; color:#e7e5e1; font-size:.9rem; font-weight:720; line-height:1.35; word-break:break-word; }
.project-detail-modal .detail-entry-info { max-width:860px; display:flex; flex-direction:column; gap:10px; padding:14px 0 16px; }
.project-detail-modal .detail-keywords-inline { display:flex; flex-direction:column; gap:8px; }
.project-detail-modal .detail-keywords-group { display:grid; grid-template-columns:78px minmax(0,1fr); gap:10px; align-items:start; }
.project-detail-modal .detail-keywords-group .detail-keywords-title { padding-top:5px; }
.project-detail-modal .detail-keywords-group .detail-keyword-list { margin-top:0; }
.project-detail-modal .detail-entry-pane .detail-entry-content { width:100%; max-width:860px; min-height:0; padding:16px 0 0; border:0; border-top:1px solid rgba(255,255,255,.055); border-radius:0; background:transparent; color:#bdbbb6; font-size:.79rem; line-height:1.72; }
.project-detail-modal .detail-disclosure { padding-top:16px; }
.project-detail-modal .detail-disclosure > summary { list-style:none; cursor:pointer; user-select:none; }
.project-detail-modal .detail-disclosure > summary::-webkit-details-marker { display:none; }
.project-detail-modal .detail-disclosure > summary::after { content:'›'; margin-left:4px; color:#6d6b66; font-size:1rem; line-height:1; transition:transform .16s ease; }
.project-detail-modal .detail-disclosure[open] > summary::after { transform:rotate(90deg); }
.project-detail-modal .detail-disclosure-body { display:flex; flex-direction:column; gap:10px; padding-top:12px; }
.project-detail-modal .external-links-note { border-color:rgba(245,158,11,.2); background:rgba(245,158,11,.055); color:#b9a778; font-size:.72rem; }

@media (max-width:900px) and (min-width:641px) {
  .project-detail-modal { padding:18px; }
  .project-detail-modal .modal-content { height:calc(100dvh - 36px); max-height:calc(100dvh - 36px); }
  .project-detail-modal .detail-entry-workspace { grid-template-columns:220px minmax(0,1fr); }
  .project-detail-modal .detail-hero { grid-template-columns:minmax(300px,360px) minmax(0,1fr); gap:20px; }
  .project-detail-modal .detail-overview { display:flex; flex-direction:column; gap:12px; }
  .project-detail-modal .detail-facts { grid-template-columns:repeat(4,minmax(0,1fr)); width:100%; border-radius:0; border-width:1px 0; }
  .project-detail-modal .detail-fact,.project-detail-modal .detail-fact:nth-child(even),.project-detail-modal .detail-fact:nth-child(n+3) { border-top:0; border-left:0; }
  .project-detail-modal .detail-fact + .detail-fact { border-left:1px solid rgba(255,255,255,.065); }
  .project-detail-modal .detail-entry-meta { display:flex; flex-direction:column; gap:12px; }
  .project-detail-modal .detail-keywords-block { grid-template-columns:repeat(2,minmax(0,1fr)); width:100%; }
  .project-detail-modal .detail-entry-content { width:100%; min-height:0; padding:12px 0 0; border-left:0; border-top:1px solid rgba(255,255,255,.05); }
}

@media (max-width:640px) {
  .project-detail-modal { align-items:stretch; padding:0; overflow:hidden; background:#0f1012; backdrop-filter:none; }
  .project-detail-modal .modal-content { width:100%; max-width:none; height:100dvh; max-height:100dvh; border:0; border-radius:0; background:#0f1012; box-shadow:none; }
  .project-detail-modal .modal-header { min-height:52px; padding:calc(6px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) 6px calc(14px + env(safe-area-inset-left)); background:rgba(15,16,18,.94); border-bottom-color:rgba(255,255,255,.065); backdrop-filter:blur(16px); }
  .project-detail-modal .modal-header h2 { font-size:.92rem; }
  .project-detail-modal .modal-header h2 i { color:#a28b6b; }
  .project-detail-modal .close-btn { width:40px; height:40px; border-radius:9px; font-size:1.12rem; }
  .project-detail-modal .modal-body { min-height:0; padding:0; }
  .project-detail-modal .detail-panel { gap:18px; }
  .project-detail-modal .detail-panel-scroll { padding:0 calc(15px + env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left)); }
  .project-detail-modal .detail-hero { display:flex; flex-direction:column; gap:14px; }
  .project-detail-modal .detail-cover { width:calc(100% + 30px + env(safe-area-inset-left) + env(safe-area-inset-right)); aspect-ratio:auto; height:clamp(158px,26dvh,190px); min-height:158px; margin:0 calc(-15px - env(safe-area-inset-right)) 0 calc(-15px - env(safe-area-inset-left)); border-width:0 0 1px; border-radius:0; background-size:cover; }
  .project-detail-modal .detail-primary { gap:10px; padding:0; }
  .project-detail-modal .detail-project-name { font-size:1.12rem; line-height:1.4; letter-spacing:0; }
  .project-detail-modal .detail-author-avatar { width:27px; height:27px; }
  .project-detail-modal .detail-actions-panel { align-items:stretch; }
  .project-detail-modal .detail-action-buttons { gap:7px; }
  .project-detail-modal .detail-install-btn,.project-detail-modal .detail-update-btn { min-height:42px; }
  .project-detail-modal .detail-tags-row { flex-wrap:nowrap; margin-right:calc(-15px - env(safe-area-inset-right)); padding-right:calc(15px + env(safe-area-inset-right)); overflow-x:auto; overflow-y:hidden; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
  .project-detail-modal .detail-tags-row .tag { padding:6px 10px; font-size:.76rem; }
  .project-detail-modal .detail-tags-row::-webkit-scrollbar { display:none; }
  .project-detail-modal .detail-stats-row { gap:16px; }
  .project-detail-modal .detail-overview { display:flex; flex-direction:column; gap:12px; }
  .project-detail-modal .detail-facts,.project-detail-modal .detail-primary .detail-facts { grid-template-columns:repeat(2,minmax(0,1fr)); border:0; }
  .project-detail-modal .detail-fact,.project-detail-modal .detail-primary .detail-fact:nth-child(n+3),.project-detail-modal .detail-fact + .detail-fact,.project-detail-modal .detail-primary .detail-fact + .detail-fact { padding:10px 8px; border-top:1px solid rgba(255,255,255,.065); border-left:0; }
  .project-detail-modal .detail-section { padding-top:17px; }
  .project-detail-modal .detail-entry-workspace { display:flex; flex-direction:column; border-top:0; }
  .project-detail-modal .detail-entry-nav { position:static; display:flex; gap:6px; max-height:none; margin-right:calc(-15px - env(safe-area-inset-right)); padding:0 calc(15px + env(safe-area-inset-right)) 10px 0; overflow-x:auto; overflow-y:hidden; border-right:0; border-bottom:1px solid rgba(255,255,255,.06); scrollbar-width:none; -webkit-overflow-scrolling:touch; }
  .project-detail-modal .detail-entry-nav::-webkit-scrollbar { display:none; }
  .project-detail-modal .detail-entry-nav-item { width:auto; min-width:180px; min-height:46px; flex:0 0 auto; border:1px solid rgba(255,255,255,.065); border-radius:8px; }
  .project-detail-modal .detail-entry-nav-item.active { border-color:rgba(162,139,107,.38); box-shadow:inset 0 0 0 1px rgba(162,139,107,.12); }
  .project-detail-modal .detail-entry-nav-copy small { display:none; }
  .project-detail-modal .detail-entry-pane { padding:0; scroll-margin-top:58px; }
  .project-detail-modal .detail-entry-panel-heading { min-height:0; padding:12px 0 10px; }
  .project-detail-modal .detail-keywords-group { display:block; }
  .project-detail-modal .detail-keywords-group .detail-keywords-title { display:block; margin-bottom:5px; padding-top:0; }
  .project-detail-modal .detail-entry-pane .detail-entry-content { padding-top:12px; font-size:.76rem; }
  .project-detail-modal .detail-entry-meta { display:flex; flex-direction:column; gap:12px; }
  .project-detail-modal .detail-keywords-block { grid-template-columns:1fr; }
  .project-detail-modal .entry-content.open { padding:11px 4px 14px; }
  .project-detail-modal .detail-entry-content { width:100%; min-height:0; padding:12px 0 0; border-left:0; border-top:1px solid rgba(255,255,255,.05); font-size:.76rem; }
}

/* 2026 accessibility/readability pass: neutral whites with AAA-oriented contrast on current dark surfaces. */
:root {
  --cw-text-heading:#FFFFFF;
  --cw-text-primary:#F5F7FA;
  --cw-text-secondary:#D7DEE8;
  --cw-text-muted:#AEB6C2;
  --cw-text-link:#E6EEFA;
}
body { color:var(--cw-text-primary); }
.project-name,.card-text-preview p { color:var(--cw-text-primary); }
.card-creator,.card-status-line,.card-quality-signal,.project-tags .tag,.project-load-more-meta { color:var(--cw-text-secondary); }
.card-text-preview__type,.card-text-preview__hint,.card-signals { color:var(--cw-text-muted); }
.card-footer .action-btn { color:var(--cw-text-primary); }

.project-detail-modal .modal-content { color:var(--cw-text-primary); }
.project-detail-modal .modal-header h2,.project-detail-modal .detail-project-name,.project-detail-modal .detail-block-title,.project-detail-modal .detail-section-title,.project-detail-modal .detail-markdown h3,.project-detail-modal .detail-markdown h4,.project-detail-modal .detail-entry-panel-heading h3 { color:var(--cw-text-heading); }
.project-detail-modal .close-btn,.project-detail-modal .detail-identity-row,.project-detail-modal .detail-tags-row .tag,.project-detail-modal .detail-markdown blockquote,.project-detail-modal .entry-behavior-meta span,.project-detail-modal .keyword-chip,.project-detail-modal .detail-entry-nav-item { color:var(--cw-text-secondary); }
.project-detail-modal .detail-description,.project-detail-modal .detail-entry-content,.project-detail-modal .detail-entry-pane .detail-entry-content,.project-detail-modal .detail-md-code { color:var(--cw-text-primary); }
.project-detail-modal .detail-description { font-size:.95rem; line-height:1.76; font-weight:500; }
.project-detail-modal .detail-entry-content,.project-detail-modal .detail-entry-pane .detail-entry-content { font-size:.92rem; line-height:1.78; font-weight:500; }
.project-detail-modal .detail-markdown h3 { font-size:1.08rem; }
.project-detail-modal .detail-markdown h4 { font-size:.98rem; }
.project-detail-modal .detail-md-inline-code { color:var(--cw-text-primary); }
.project-detail-modal .detail-safe-link { color:var(--cw-text-link); font-weight:600; }
.project-detail-modal .detail-safe-link:hover { color:var(--cw-text-heading); }
.project-detail-modal .detail-stat { color:var(--cw-text-secondary); }
.project-detail-modal .detail-stat i,.project-detail-modal .detail-stat span,.project-detail-modal .detail-fact i,.project-detail-modal .detail-fact span,.project-detail-modal .detail-section-title > span:last-child,.project-detail-modal .entry-header > i,.project-detail-modal .detail-keywords-title,.project-detail-modal .detail-entry-nav-copy small,.project-detail-modal .detail-disclosure > summary::after { color:var(--cw-text-muted); }
.project-detail-modal .detail-stat strong,.project-detail-modal .detail-fact strong { color:var(--cw-text-primary); }
.project-detail-modal .detail-stat strong { font-size:.82rem; }
.project-detail-modal .detail-stat span { font-size:.74rem; }
.project-detail-modal .detail-fact span { font-size:.72rem; }
.project-detail-modal .detail-fact strong { font-size:.82rem; }
.project-detail-modal .detail-section-title > span:last-child { font-size:.74rem; }
.project-detail-modal .entry-header { color:var(--cw-text-primary); font-size:.88rem; }
.project-detail-modal .entry-behavior-meta span { font-size:.72rem; }
.project-detail-modal .detail-keywords-title { font-size:.72rem; }
.project-detail-modal .keyword-chip { font-size:.74rem; }
.project-detail-modal .detail-entry-nav-item:hover,.project-detail-modal .detail-entry-nav-item.active { color:var(--cw-text-heading); }
.project-detail-modal .detail-entry-nav-copy strong { font-size:.84rem; font-weight:700; }
.project-detail-modal .detail-entry-nav-copy small { font-size:.7rem; }
.project-detail-modal .detail-entry-panel-heading h3 { font-size:.98rem; }
.external-link-warning-copy strong { color:var(--cw-text-heading); }
.external-link-warning-copy p,.external-link-warning-copy code { color:var(--cw-text-secondary); }
.external-link-warning-host { color:var(--cw-text-primary); }
.detail-loading,.form-hint,.empty-state { color:var(--cw-text-secondary); }

@media (max-width:640px) {
  .project-detail-modal .detail-entry-pane .detail-entry-content,.project-detail-modal .detail-entry-content { font-size:.9rem; line-height:1.76; }
  .project-detail-modal .detail-description { font-size:.94rem; }
}

/* Project detail v4: full-width identity header, 8/4 media-action hero, and local table of contents. */
body,.logo h1,.sidebar-brand-copy strong,.mobile-tool-sheet-head strong,.project-detail-modal .modal-header h2,.project-detail-modal .detail-project-name { font-family:var(--workshop-content-font); }
.project-detail-modal .detail-panel-scroll { gap:20px; }
.project-detail-modal .detail-project-header { display:flex; flex-direction:column; gap:8px; min-width:0; padding:2px 0 0; }
.project-detail-modal .detail-project-header .detail-project-name { max-width:1180px; font-size:clamp(1.35rem,2.1vw,1.9rem); line-height:1.28; }
.project-detail-modal .detail-project-header .detail-identity-row { min-height:30px; }
.project-detail-modal .detail-toc { position:sticky; top:0; z-index:6; display:flex; align-items:center; gap:6px; min-width:0; margin:0 -8px; padding:8px; overflow-x:auto; overflow-y:hidden; border:1px solid rgba(255,255,255,.07); border-radius:10px; background:rgba(24,25,28,.94); box-shadow:0 8px 22px rgba(0,0,0,.14); backdrop-filter:blur(14px); scrollbar-width:none; }
.project-detail-modal .detail-toc::-webkit-scrollbar { display:none; }
.project-detail-modal .detail-toc-item { flex:none; display:inline-flex; align-items:center; min-height:34px; padding:0 11px; border:1px solid transparent; border-radius:8px; color:var(--cw-text-secondary); font-size:.78rem; font-weight:650; line-height:1; text-decoration:none; white-space:nowrap; }
.project-detail-modal .detail-toc-item:hover,.project-detail-modal .detail-toc-item:focus-visible { border-color:rgba(255,255,255,.10); background:rgba(255,255,255,.045); color:var(--cw-text-heading); outline:none; }
.project-detail-modal .detail-toc-item.active { border-color:rgba(162,139,107,.24); background:rgba(162,139,107,.10); color:var(--cw-text-heading); }
.project-detail-modal .detail-hero { grid-template-columns:minmax(0,2fr) minmax(280px,1fr); gap:24px; align-items:start; }
.project-detail-modal .detail-cover { height:clamp(330px,34vw,420px); aspect-ratio:auto; background-size:contain; background-position:center; }
.project-detail-modal .detail-primary { min-height:0; gap:14px; padding:0; }
.project-detail-modal .detail-primary .detail-facts { margin-top:0; grid-template-columns:repeat(2,minmax(0,1fr)); }
.project-detail-modal .detail-primary .detail-fact:nth-child(n+3) { border-top:1px solid rgba(255,255,255,.065); }
.project-detail-modal .detail-primary .detail-fact:nth-child(odd) { border-left:0; }
.project-detail-modal .detail-primary .detail-fact:nth-child(even) { border-left:1px solid rgba(255,255,255,.065); }
.project-detail-modal .detail-action-buttons { max-width:none; }
.project-detail-modal .detail-overview,.project-detail-modal #detail-worldbook,.project-detail-modal .detail-md-heading-2 { scroll-margin-top:58px; }

@media (max-width:900px) and (min-width:641px) {
  .project-detail-modal .detail-hero { grid-template-columns:minmax(0,2fr) minmax(235px,1fr); gap:18px; }
  .project-detail-modal .detail-cover { height:clamp(280px,40vw,340px); }
  .project-detail-modal .detail-project-header .detail-project-name { font-size:1.35rem; }
}

@media (max-width:640px) {
  .project-detail-modal .detail-panel-scroll { gap:16px; }
  .project-detail-modal .detail-project-header { padding-top:14px; }
  .project-detail-modal .detail-project-header .detail-project-name { font-size:1.2rem; line-height:1.38; }
  .project-detail-modal .detail-toc { top:0; margin:0 calc(-15px - env(safe-area-inset-right)) 0 calc(-15px - env(safe-area-inset-left)); padding:7px calc(15px + env(safe-area-inset-right)) 7px calc(15px + env(safe-area-inset-left)); border-width:1px 0; border-radius:0; }
  .project-detail-modal .detail-toc-item { min-height:32px; padding:0 10px; font-size:.76rem; }
  .project-detail-modal .detail-cover { height:clamp(180px,31dvh,240px); background-size:contain; background-color:#18191c; }
  .project-detail-modal .detail-overview,.project-detail-modal #detail-worldbook,.project-detail-modal .detail-md-heading-2 { scroll-margin-top:54px; }
}

`;
