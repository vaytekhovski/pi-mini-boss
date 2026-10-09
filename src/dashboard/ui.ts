/**
 * pi-mini-boss dashboard UI — one self-contained page.
 *
 * The screen is a grid of boards, one per project, so several projects running
 * in parallel are visible at once:
 *   • boards can be collapsed and hidden (a "Показать скрытые" panel restores);
 *   • every board has its own set of visible status columns;
 *   • a global toolbar filters by project and exposes the shared column preset;
 *   • a card can be dragged between columns (PATCH action=move) and clicked to
 *     open the editor.
 *
 * Everything is fed by the SSE stream from `server.ts`; layout choices live in
 * the browser (localStorage), never on the server. All untrusted task/activity
 * text is escaped before it reaches the DOM. The whole file is a template
 * string, so no backticks or `${}` appear below.
 */
export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pi-mini-boss · задачи</title>
<style>
  :root {
    color-scheme: light;
    --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
    --bg: #f2e8d5;
    --panel: #faf3e3;
    --panel-2: #efe3cc;
    --border: #d9c8a5;
    --ink: #3a2f26;
    --muted: #71634c;
    --accent: #8c6239;
    --accent-hover: #a1743f;
    --card: #fffaf0;
    --overlay: rgba(58, 47, 38, .45);
    --paper:
      repeating-linear-gradient(0deg, rgba(140, 98, 57, .030) 0 1px, transparent 1px 3px),
      radial-gradient(circle at 18% 12%, rgba(255, 255, 255, .55), transparent 62%),
      radial-gradient(circle at 82% 88%, rgba(140, 98, 57, .07), transparent 58%);
    --s-pending: #6f6455;
    --s-analysis: #7c4dab;
    --s-planning: #4b4fb0;
    --s-development: #2f6f9f;
    --s-review: #b26a00;
    --s-testing: #0f7d8c;
    --s-report: #2e7d5b;
    --s-completed: #2f8f4e;
    --s-blocked: #c0392b;
    --p-high: #9a6b00;
    --p-urgent: #b3261e;
    --badge-running-bg: #dbe7f0; --badge-running-fg: #1f5273;
    --badge-done-bg: #dcecdc; --badge-done-fg: #20632f;
    --badge-error-bg: #f3dcd9; --badge-error-fg: #8f2018;
    --badge-waiting-bg: #f6e6c8; --badge-waiting-fg: #7a5200;
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #1b1b1b;
    --panel: #242424;
    --panel-2: #2d2d2d;
    --border: #3b3b3b;
    --ink: #e7e7e7;
    --muted: #a0a0a0;
    --accent: #b08d57;
    --accent-hover: #c39d63;
    --card: #202020;
    --overlay: rgba(0, 0, 0, .6);
    --paper:
      radial-gradient(circle at 18% 12%, rgba(255, 255, 255, .03), transparent 62%),
      radial-gradient(circle at 82% 88%, rgba(176, 141, 87, .05), transparent 58%);
    --s-pending: #b0a89a;
    --s-analysis: #c4a7f0;
    --s-planning: #9aa0f5;
    --s-development: #7cc2f0;
    --s-review: #e8b04b;
    --s-testing: #5fd3e0;
    --s-report: #6ad3a3;
    --s-completed: #5fce7f;
    --s-blocked: #f08a80;
    --p-high: #e8b04b;
    --p-urgent: #f08a80;
    --badge-running-bg: #26323d; --badge-running-fg: #8cc8ee;
    --badge-done-bg: #203021; --badge-done-fg: #7fdc9b;
    --badge-error-bg: #3a2220; --badge-error-fg: #f0978c;
    --badge-waiting-bg: #3a3220; --badge-waiting-fg: #e8c56b;
  }
  * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: var(--bg); background-image: var(--paper); color: var(--ink); }
  header { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background-color: var(--bg); background-image: var(--paper); z-index: 3; }
  header h1 { font: 700 16px/1.2 var(--serif); margin: 0; color: var(--accent); }
  .counts, .muted { color: var(--muted); }
  .wait-chip { background: var(--badge-waiting-bg); color: var(--badge-waiting-fg); border: 1px solid var(--border); border-radius: 8px; padding: 2px 9px; font-size: 12px; font-weight: 600; }
  .wait-chip.hidden { display: none; }
  .theme-btn { margin-left: auto; background: var(--panel-2); border: 1px solid var(--border); color: var(--ink); border-radius: 6px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .theme-btn:hover { background: var(--panel); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); margin-left: 8px; vertical-align: middle; }
  .dot.live { background: var(--s-completed); }
  .app { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 16px; align-items: start; padding: 0 18px 24px; }
  main { min-width: 0; }
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 16px 0 0; }
  .toolbar label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  .toolbar select { background: var(--panel-2); border: 1px solid var(--border); color: var(--ink); border-radius: 6px; padding: 5px 8px; font: inherit; }
  .toolbar button, .board-actions button, .chip-btn, .hidden-panel button {
    background: var(--panel-2); border: 1px solid var(--border); color: var(--ink); border-radius: 6px; padding: 4px 9px; font: inherit; cursor: pointer;
  }
  .toolbar button:hover, .board-actions button:hover, .chip-btn:hover, .hidden-panel button:hover { background: var(--panel); }
  .hidden-panel { margin-top: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .hidden-panel.hidden { display: none; }
  .hidden-panel .hidden-row { display: flex; gap: 10px; align-items: center; padding: 4px 0; }
  .hidden-panel .hidden-row .n { color: var(--muted); }
  .hidden-panel .hidden-row button { margin-left: auto; }
  .boards { display: flex; flex-direction: column; gap: 16px; padding-top: 16px; padding-bottom: 4px; }
  /* доска во всю ширину окна: колонки статусов идут одним рядом, а не переносятся вниз; лишнее уходит в горизонтальный скролл .board-body. */
  .board-wrap { flex: 0 0 auto; width: 100%; display: flex; flex-direction: column; max-height: calc(100vh - 250px); min-height: 240px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); padding: 12px; }
  .board-wrap.current { border-color: var(--accent); }
  .board-head { flex: 0 0 auto; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .board-head h2 { font: 700 15px/1.2 var(--serif); margin: 0; color: var(--ink); }
  .board-head .pill { font-family: var(--serif); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); border: 1px solid var(--border); border-radius: 8px; padding: 1px 7px; }
  .board-state { font-size: 11px; font-weight: 600; border-radius: 8px; padding: 1px 8px; }
  .board-state.waiting { background: var(--badge-waiting-bg); color: var(--badge-waiting-fg); }
  .board-state.running { background: var(--badge-running-bg); color: var(--badge-running-fg); }
  .board-state.done { color: var(--muted); font-weight: 400; }
  .board-head .bcounts { color: var(--muted); font-size: 12px; }
  .board-head .board-actions { margin-left: auto; display: flex; gap: 6px; }
  .board-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .col-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
  .col-chips .lbl { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; margin-right: 2px; }
  .chip-btn.on { background: var(--accent); border-color: var(--accent); color: var(--card); }
  .chip-btn.off { opacity: .5; }
  .board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, 1fr); gap: 12px; margin-top: 12px; min-width: 0; }
  .col { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; min-height: 80px; }
  .col.drag-over { border-color: var(--accent); background: var(--panel); }
  .col h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 8px; color: var(--muted); }
  .task { border-left: 3px solid var(--border); padding: 6px 8px; margin-bottom: 6px; background: var(--card); border-radius: 4px; cursor: pointer; }
  .task:hover { background: var(--panel); }
  .task.dragging { opacity: .45; }
  .task .id { color: var(--muted); }
  .task .pr { float: right; font-size: 11px; color: var(--muted); }
  .task small { color: var(--muted); display: block; margin-top: 2px; }
  .task .desc { color: var(--ink); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .task .when { color: var(--muted); font-size: 11px; margin-top: 4px; }
  .done-mark { color: var(--s-completed); font-weight: 700; margin: 0 3px; }
  .task.is-done { opacity: .7; }
  .s-pending { border-left-color: var(--s-pending); }
  .s-analysis { border-left-color: var(--s-analysis); }
  .s-planning { border-left-color: var(--s-planning); }
  .s-development { border-left-color: var(--s-development); }
  .s-review { border-left-color: var(--s-review); }
  .s-testing { border-left-color: var(--s-testing); }
  .s-report { border-left-color: var(--s-report); }
  .s-completed { border-left-color: var(--s-completed); }
  .s-blocked { border-left-color: var(--s-blocked); }
  .p-high .pr { color: var(--p-high); } .p-urgent .pr { color: var(--p-urgent); }
  .empty { color: var(--muted); font-style: italic; }
  aside { position: sticky; top: 57px; padding-top: 16px; display: flex; flex-direction: column; gap: 14px; }
  aside h2 { font: 700 12px/1.2 var(--serif); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 6px; }
  .rows { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .row { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer; user-select: none; border-bottom: 1px solid var(--border); }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--panel-2); }
  .row .sw { width: 8px; height: 8px; border-radius: 2px; background: var(--border); flex: none; }
  .row .n { margin-left: auto; color: var(--muted); }
  .row.off { color: var(--muted); }
  .row.off .sw { background: var(--border); }
  .row.off .n { color: var(--muted); }
  .row.s-pending .sw { background: var(--s-pending); }
  .row.s-analysis .sw { background: var(--s-analysis); }
  .row.s-planning .sw { background: var(--s-planning); }
  .row.s-development .sw { background: var(--s-development); }
  .row.s-review .sw { background: var(--s-review); }
  .row.s-testing .sw { background: var(--s-testing); }
  .row.s-report .sw { background: var(--s-report); }
  .row.s-completed .sw { background: var(--s-completed); }
  .row.s-blocked .sw { background: var(--s-blocked); }
  .note { color: var(--muted); font-size: 11px; }
  /* activity panel */
  .act { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; max-height: 340px; overflow-y: auto; }
  .act-group { display: flex; flex-direction: column; gap: 6px; }
  .act-group-head { font: 700 12px/1.2 var(--serif); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); border-bottom: 1px solid var(--border); padding-bottom: 3px; }
  .act-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 8px; margin-right: 6px; vertical-align: middle; }
  .act-badge.running { background: var(--badge-running-bg); color: var(--badge-running-fg); }
  .act-badge.done { background: var(--badge-done-bg); color: var(--badge-done-fg); }
  .act-badge.error { background: var(--badge-error-bg); color: var(--badge-error-fg); }
  .act-badge.waiting { background: var(--badge-waiting-bg); color: var(--badge-waiting-fg); }
  .act-run { border-left: 2px solid var(--border); padding: 2px 0 2px 8px; }
  .act-run.running { border-left-color: var(--s-development); }
  .act-run.done { border-left-color: var(--s-completed); }
  .act-run.error { border-left-color: var(--s-blocked); }
  .act-run.waiting { border-left-color: var(--s-review); }
  .act-run b { color: var(--ink); }
  .act-run .when { color: var(--muted); font-size: 11px; margin-top: 1px; }
  /* task editor modal */
  .modal { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 10; }
  .modal.hidden { display: none; }
  .modal-card { width: min(520px, 92vw); background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 10px; max-height: 90vh; overflow-y: auto; }
  .modal-head { display: flex; align-items: baseline; gap: 10px; }
  .modal-head .id { color: var(--muted); }
  .modal-head .x { margin-left: auto; background: none; border: 0; color: var(--muted); font-size: 18px; cursor: pointer; }
  .modal-card label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .modal-card input, .modal-card textarea, .modal-card select { background: var(--card); border: 1px solid var(--border); color: var(--ink); border-radius: 6px; padding: 7px 9px; font: inherit; }
  .modal-card textarea { min-height: 80px; resize: vertical; }
  .modal-actions { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
  .modal-actions button { background: var(--accent); border: 0; color: var(--card); padding: 8px 16px; border-radius: 6px; cursor: pointer; font: inherit; }
  .modal-actions button:hover { background: var(--accent-hover); }
  .modal-actions .err { color: var(--s-blocked); font-size: 12px; }
  @media (max-width: 900px) {
    .app { grid-template-columns: minmax(0, 1fr); }
    aside { position: static; order: -1; }
  }
</style>
<script>
(function () {
  var theme = "parchment";
  try {
    var raw = localStorage.getItem("pi-mini-boss.dashboard.v1.theme");
    if (raw !== null) { theme = JSON.parse(raw) === "dark" ? "dark" : "parchment"; }
  } catch (e) { theme = "parchment"; }
  document.documentElement.dataset.theme = theme;
})();
</script>
</head>
<body>
<header>
  <h1>pi-mini-boss</h1>
  <span class="counts" id="counts">…</span>
  <span class="dot" id="dot"></span>
  <span class="muted" id="stamp"></span>
  <span class="wait-chip hidden" id="waiting">⏳ ждёт ответа</span>
  <button class="theme-btn" id="theme-btn" type="button" aria-label="переключить тему" aria-pressed="false">☾ тёмная</button>
</header>
<div class="app">
  <main>
    <div class="toolbar">
      <label for="project-filter">Проект</label>
      <select id="project-filter"></select>
      <button id="hidden-btn" type="button">Показать скрытые (0)</button>
    </div>
    <div class="hidden-panel hidden" id="hidden-panel"></div>
    <div class="boards" id="boards"></div>
  </main>
  <aside>
    <div>
      <h2>Общий пресет колонок</h2>
      <div class="rows" id="statuses"></div>
      <div class="note">действует на доски без своего набора колонок</div>
    </div>
    <div>
      <h2>Активность</h2>
      <div class="act" id="activity"></div>
    </div>
    <div class="note" id="conn">реалтайм через SSE</div>
  </aside>
</div>

<div class="modal hidden" id="modal">
  <div class="modal-card">
    <div class="modal-head">
      <span class="id" id="modal-id">#—</span>
      <button class="x" id="modal-close" title="закрыть">×</button>
    </div>
    <label>Тема<input id="f-subject" /></label>
    <label>Описание<textarea id="f-description"></textarea></label>
    <label>Статус
      <select id="f-status">
        <option value="pending">pending — в очереди</option>
        <option value="analysis">analysis — анализ</option>
        <option value="planning">planning — планирование</option>
        <option value="development">development — разработка</option>
        <option value="review">review — ревью</option>
        <option value="testing">testing — тестирование</option>
        <option value="report">report — отчёт</option>
        <option value="completed">completed — готово</option>
        <option value="blocked">blocked — заблокировано</option>
        <option value="deleted">deleted — удалена</option>
      </select>
    </label>
    <label>Приоритет
      <select id="f-priority">
        <option value="low">low</option>
        <option value="normal">normal</option>
        <option value="high">high</option>
        <option value="urgent">urgent</option>
      </select>
    </label>
    <label>Текущая активность (activeForm)<input id="f-activeform" /></label>
    <div class="modal-actions">
      <button id="modal-save">Сохранить</button>
      <span class="err" id="modal-err"></span>
    </div>
  </div>
</div>

<script>
var STATUS = ["pending", "analysis", "planning", "development", "review", "testing", "report", "completed", "blocked"];
var LABEL = {
  pending: "pending", analysis: "анализ", planning: "планирование", development: "разработка",
  review: "ревью", testing: "тестирование", report: "отчёт", completed: "готово", blocked: "блок", deleted: "удалена"
};
var ACTIVE = ["analysis", "planning", "development", "review", "testing", "report"];
var UNASSIGNED = "—";

var state = { currentProject: null, projects: [], tasks: [], counts: { total: 0 }, activity: { agent: null, agents: [], runs: [] } };
var lastAt = 0;
var editingId = null;
var dragging = false;
var dragId = null;

/* ---- persisted browser state (versioned keys, safe parse) ---- */
var LS = "pi-mini-boss.dashboard.v1.";

function readLS(key, fallback) {
  try {
    var raw = localStorage.getItem(LS + key);
    if (raw == null) { return fallback; }
    var parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch (e) {}
}
function asBoolMap(v) {
  var out = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) { out[String(k)] = !!v[k]; } }
  }
  return out;
}
function asStatusList(v) {
  if (!Array.isArray(v)) { return null; }
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (STATUS.indexOf(v[i]) !== -1 && out.indexOf(v[i]) === -1) { out.push(v[i]); }
  }
  return out;
}
function asColumnsMap(v) {
  var out = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) { continue; }
      var list = asStatusList(v[k]);
      if (list) { out[String(k)] = list; }
    }
  }
  return out;
}

var ui = {
  projectOrder: readLS("projectOrder", []),
  collapsed: asBoolMap(readLS("projectCollapsed", {})),
  hiddenProjects: asBoolMap(readLS("projectHidden", {})),
  columnsByProject: asColumnsMap(readLS("columnsByProject", {})),
  globalColumns: asStatusList(readLS("globalColumns", null)) || STATUS.slice(),
  filter: readLS("projectFilter", "all"),
  hiddenPanelOpen: false
};
if (!Array.isArray(ui.projectOrder)) { ui.projectOrder = []; }
if (typeof ui.filter !== "string") { ui.filter = "all"; }

function saveCollapsed() { writeLS("projectCollapsed", ui.collapsed); }
function saveHidden() { writeLS("projectHidden", ui.hiddenProjects); }
function saveColumns(name) {
  if (name) { writeLS("columnsByProject", ui.columnsByProject); }
}
function saveGlobalColumns() { writeLS("globalColumns", ui.globalColumns); }
function saveFilter() { writeLS("projectFilter", ui.filter); }

/* ---- helpers ---- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function ago(ms) {
  var d = Math.max(0, Date.now() - ms) / 1000;
  if (d < 60) { return Math.round(d) + " с"; }
  if (d < 3600) { return Math.round(d / 60) + " мин"; }
  if (d < 86400) { return Math.round(d / 3600) + " ч"; }
  return Math.round(d / 86400) + " дн";
}
function activeCount(c) {
  var n = 0;
  for (var i = 0; i < ACTIVE.length; i++) { n += (c[ACTIVE[i]] || 0); }
  return n;
}
/* Meaningful task title: the subject the agent wrote, never a file name. */
function title(t) {
  return (t.subject || "").trim() || ("#" + t.id);
}
/* Every activity row: the per-project agent rows plus all subagent runs. */
function allRuns() {
  var a = state.activity || {};
  var agents = a.agents || [];
  if (!agents.length && a.agent) { agents = [a.agent]; }
  var list = [];
  var i;
  for (i = 0; i < agents.length; i++) { list.push(agents[i]); }
  var runs = a.runs || [];
  for (i = 0; i < runs.length; i++) { list.push(runs[i]); }
  return list;
}
/* A run belongs to a board when its project matches, or when the row has no
   project and the board is the session's current project. */
function runOwnedBy(run, name) {
  var p = run.project || "";
  return p === name || (p === "" && name === state.currentProject);
}
function anyWaiting() {
  var list = allRuns();
  for (var i = 0; i < list.length; i++) { if (list[i].status === "waiting") { return true; } }
  return false;
}
/* Board status badge: waiting > running > done (with the newest activity age). */
function projectState(name) {
  var list = allRuns();
  var newest = 0;
  var hasWaiting = false;
  var hasRunning = false;
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!runOwnedBy(r, name)) { continue; }
    if (r.updatedAt > newest) { newest = r.updatedAt; }
    if (r.status === "waiting") { hasWaiting = true; }
    if (r.status === "running") { hasRunning = true; }
  }
  if (hasWaiting) { return { cls: "waiting", text: "⏳ ждёт ответа" }; }
  if (hasRunning) { return { cls: "running", text: "● работает" }; }
  return { cls: "done", text: newest ? "✓ готово · " + ago(newest) : "✓ готово" };
}
function renderWaiting() {
  var el = document.getElementById("waiting");
  if (anyWaiting()) { el.classList.remove("hidden"); } else { el.classList.add("hidden"); }
}

/* ---- boards model ---- */
function projectNames() {
  var names = [];
  var i;
  for (i = 0; i < state.projects.length; i++) {
    if (names.indexOf(state.projects[i].name) === -1) { names.push(state.projects[i].name); }
  }
  return names;
}
function boardsData() {
  var map = {};
  var nameById = {};
  var i, p, t;
  for (i = 0; i < state.projects.length; i++) {
    p = state.projects[i];
    nameById[p.id] = p.name;
    map[p.name] = { name: p.name, tasks: [] };
  }
  for (i = 0; i < state.tasks.length; i++) {
    t = state.tasks[i];
    var name = (t.projectId != null && nameById[t.projectId] != null) ? nameById[t.projectId] : UNASSIGNED;
    if (!map[name]) { map[name] = { name: name, tasks: [] }; }
    map[name].tasks.push(t);
  }
  return map;
}
function boardCounts(project) {
  var c = { total: 0 };
  var i;
  for (i = 0; i < STATUS.length; i++) { c[STATUS[i]] = 0; }
  c.deleted = 0;
  for (i = 0; i < project.length; i++) {
    c.total += 1;
    if (c[project[i].status] != null) { c[project[i].status] += 1; }
  }
  return c;
}
function lastActivity(board) {
  var ts = 0;
  for (var i = 0; i < board.tasks.length; i++) {
    if (board.tasks[i].updatedAt > ts) { ts = board.tasks[i].updatedAt; }
  }
  return ts;
}
function boardOrder(map) {
  var names = Object.keys(map);
  var current = state.currentProject;
  var orderIndex = {};
  for (var i = 0; i < ui.projectOrder.length; i++) { orderIndex[ui.projectOrder[i]] = i; }
  names.sort(function (a, b) {
    if (a === b) { return 0; }
    if (a === current) { return -1; }
    if (b === current) { return 1; }
    var ia = orderIndex.hasOwnProperty(a) ? orderIndex[a] : null;
    var ib = orderIndex.hasOwnProperty(b) ? orderIndex[b] : null;
    if (ia != null || ib != null) {
      var va = ia == null ? Infinity : ia;
      var vb = ib == null ? Infinity : ib;
      if (va !== vb) { return va - vb; }
    }
    var la = lastActivity(map[a]);
    var lb = lastActivity(map[b]);
    if (la !== lb) { return lb - la; }
    return a.localeCompare(b, "ru");
  });
  return names;
}
function boardColumns(name) {
  var list = ui.columnsByProject[name] || ui.globalColumns;
  return STATUS.filter(function (s) { return list.indexOf(s) !== -1; });
}
function hiddenNames() {
  var names = projectNames();
  if (Object.keys(boardsData()).indexOf(UNASSIGNED) !== -1 && names.indexOf(UNASSIGNED) === -1) {
    names.push(UNASSIGNED);
  }
  return names.filter(function (n) { return !!ui.hiddenProjects[n]; });
}

/* ---- rendering ---- */
function card(t) {
  var done = t.status === "completed";
  var out = '<div class="task s-' + esc(t.status) + " p-" + esc(t.priority) + (done ? " is-done" : "") + '" draggable="true" data-id="' + t.id + '">';
  out += '<span class="pr">' + esc(t.priority) + '</span>';
  out += '<span class="id">#' + t.id + "</span> " + (done ? '<span class="done-mark">✓</span>' : "") + esc(title(t));
  if (t.activeForm && ACTIVE.indexOf(t.status) !== -1) { out += "<small>" + esc(t.activeForm) + "</small>"; }
  if (t.description) { out += '<div class="desc" title="' + esc(t.description) + '">' + esc(t.description) + "</div>"; }
  out += '<div class="when">обновлено ' + ago(t.updatedAt) + "</div>";
  return out + "</div>";
}

function column(status, tasks) {
  var items = tasks.filter(function (t) { return t.status === status; });
  var body = items.length ? items.map(card).join("") : '<div class="empty">—</div>';
  return '<section class="col s-' + status + '" data-status="' + status + '"><h3>' +
    esc(LABEL[status]) + " (" + items.length + ")</h3>" + body + "</section>";
}

function boardHtml(board) {
  var isCurrent = board.name === state.currentProject;
  var c = boardCounts(board.tasks);
  var collapsed = !!ui.collapsed[board.name];
  var st = projectState(board.name);
  var heading = '<div class="board-head">' +
    "<h2>" + esc(board.name) + "</h2>" +
    (isCurrent ? '<span class="pill">текущий</span>' : "") +
    '<span class="board-state ' + st.cls + '">' + esc(st.text) + "</span>" +
    '<span class="bcounts">' +
      "backlog " + c.pending + " · active " + activeCount(c) + " · today " + (c.completed || 0) +
    "</span>" +
    '<span class="board-actions">' +
      '<button type="button" class="board-collapse" data-project="' + esc(board.name) + '">' + (collapsed ? "развернуть" : "свернуть") + "</button>" +
      '<button type="button" class="board-hide" data-project="' + esc(board.name) + '">скрыть проект</button>' +
    "</span>" +
  "</div>";

  if (collapsed) {
    return '<div class="board-wrap' + (isCurrent ? " current" : "") + '">' + heading + "</div>";
  }

  var visible = boardColumns(board.name);
  var chips = '<div class="col-chips"><span class="lbl">колонки</span>' + STATUS.map(function (s) {
    var on = visible.indexOf(s) !== -1;
    return '<button type="button" class="chip-btn ' + (on ? "on" : "off") +
      '" data-project="' + esc(board.name) + '" data-column="' + s + '">' + esc(LABEL[s]) + "</button>";
  }).join("") + "</div>";

  var grid = visible.length
    ? '<div class="board">' + visible.map(function (s) { return column(s, board.tasks); }).join("") + "</div>"
    : '<div class="empty" style="margin-top:10px">все колонки скрыты в этой доске</div>';

  return '<div class="board-wrap' + (isCurrent ? " current" : "") + '">' + heading + '<div class="board-body">' + chips + grid + "</div></div>";
}

function renderBoards() {
  var map = boardsData();
  var order = boardOrder(map);
  var shown = order.filter(function (name) {
    if (ui.hiddenProjects[name]) { return false; }
    if (ui.filter !== "all" && ui.filter !== name) { return false; }
    return true;
  });
  document.getElementById("boards").innerHTML = shown.length
    ? shown.map(function (name) { return boardHtml(map[name]); }).join("")
    : '<div class="empty">нет видимых досок — выберите проект выше или верните скрытые</div>';
}

function renderToolbar() {
  var select = document.getElementById("project-filter");
  var names = projectNames();
  if (Object.keys(boardsData()).indexOf(UNASSIGNED) !== -1 && names.indexOf(UNASSIGNED) === -1) {
    names.push(UNASSIGNED);
  }
  var sig = names.join("\\u0000");
  if (select.getAttribute("data-sig") !== sig) {
    select.setAttribute("data-sig", sig);
    select.innerHTML = "";
    var all = document.createElement("option");
    all.value = "all";
    all.textContent = "Все проекты";
    select.appendChild(all);
    for (var i = 0; i < names.length; i++) {
      var o = document.createElement("option");
      o.value = names[i];
      o.textContent = names[i];
      select.appendChild(o);
    }
  }
  select.value = ui.filter;
  document.getElementById("hidden-btn").textContent = "Показать скрытые (" + hiddenNames().length + ")";

  var panel = document.getElementById("hidden-panel");
  if (!ui.hiddenPanelOpen) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
  } else {
    panel.classList.remove("hidden");
    var hidden = hiddenNames();
    panel.innerHTML = hidden.length
      ? hidden.map(function (n) {
          return '<div class="hidden-row"><span class="n">' + esc(n) +
            '</span><button type="button" class="show-project" data-project="' + esc(n) + '">показать</button></div>';
        }).join("")
      : '<div class="empty">скрытых проектов нет</div>';
  }
}

function renderSidebar() {
  document.getElementById("statuses").innerHTML = STATUS.map(function (status) {
    var on = ui.globalColumns.indexOf(status) !== -1;
    return '<div class="row s-' + status + (on ? "" : " off") + '" data-status="' + status +
      '"><span class="sw"></span>' + esc(LABEL[status]) + '<span class="n">' + (state.counts[status] || 0) + "</span></div>";
  }).join("");
}

function actBadge(status) {
  var mark = status === "running" ? "…" : status === "done" ? "✓" : status === "waiting" ? "⏳" : "!";
  return '<span class="act-badge ' + esc(status) + '">' + mark + "</span>";
}

/* Activity grouped per project: the agent row plus its subagents. */
function activityPanel() {
  var a = state.activity || {};
  var agents = a.agents || (a.agent ? [a.agent] : []);
  var runs = a.runs || [];
  var groups = Object.create(null);
  var order = [];
  function group(key) {
    if (!groups[key]) { groups[key] = { agent: null, runs: [] }; order.push(key); }
    return groups[key];
  }
  /* An agent row without a project belongs to the current project when waiting. */
  function runKey(r) {
    var p = r.project || "";
    if (!p && r.status === "waiting" && state.currentProject) { return state.currentProject; }
    return p;
  }
  var i;
  for (i = 0; i < agents.length; i++) {
    var ag = group(runKey(agents[i]));
    if (!ag.agent) { ag.agent = agents[i]; }
  }
  for (i = 0; i < runs.length; i++) { group(runKey(runs[i])).runs.push(runs[i]); }
  if (!order.length) {
    document.getElementById("activity").innerHTML = '<div class="empty">субагентов пока нет</div>';
    return;
  }
  var keys = order.slice().sort(function (x, y) {
    if (x === state.currentProject) { return -1; }
    if (y === state.currentProject) { return 1; }
    if (x === "") { return 1; }
    if (y === "") { return -1; }
    return x.localeCompare(y, "ru");
  });
  document.getElementById("activity").innerHTML = keys.map(function (key) {
    var g = groups[key];
    var out = '<div class="act-group"><div class="act-group-head">' + esc(key || UNASSIGNED) + "</div>";
    if (g.agent) {
      out += '<div class="act-run ' + esc(g.agent.status) + '">' + actBadge(g.agent.status) +
        "<b>агент</b>" + (g.agent.detail ? ' <span class="muted">' + esc(g.agent.detail) + "</span>" : "") +
        '<div class="when">' + ago(g.agent.updatedAt) + " назад</div></div>";
    }
    var running = g.runs.filter(function (r) { return r.status === "running"; });
    var rest = g.runs.filter(function (r) { return r.status !== "running"; }).slice(0, 12);
    var list = running.concat(rest);
    if (!list.length && !g.agent) { out += '<div class="empty">—</div>'; }
    out += list.map(function (r) {
      return '<div class="act-run ' + esc(r.status) + '">' + actBadge(r.status) +
        "<b>" + esc(r.name) + "</b>" +
        (r.detail ? ' <span class="muted">' + esc(r.detail) + "</span>" : "") +
        '<div class="when">' + ago(r.updatedAt) + " назад</div>" +
        "</div>";
    }).join("");
    return out + "</div>";
  }).join("");
}

function render() {
  var c = state.counts || { total: 0 };
  document.getElementById("counts").textContent =
    (c.completed || 0) + "/" + (c.total || 0) + " готово · " + activeCount(c) + " в работе · " + (c.blocked || 0) + " блок";
  renderWaiting();
  renderToolbar();
  renderBoards();
  renderSidebar();
  activityPanel();
  if (lastAt) { document.getElementById("stamp").textContent = "· данные " + ago(lastAt) + " назад"; }
}

/* ---- mutations ---- */
function moveTask(id, status) {
  for (var i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].id === id) {
      state.tasks[i].status = status;
      state.tasks[i].updatedAt = Date.now();
      break;
    }
  }
  render();
  fetch("/api/tasks/" + id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "move", status: status })
  }).catch(function () {});
}

function openTask(id) {
  var t = null;
  for (var i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].id === id) { t = state.tasks[i]; break; }
  }
  if (!t) { return; }
  editingId = id;
  document.getElementById("modal-id").textContent = "#" + t.id;
  document.getElementById("f-subject").value = t.subject || "";
  document.getElementById("f-description").value = t.description || "";
  document.getElementById("f-status").value = t.status;
  document.getElementById("f-priority").value = t.priority || "normal";
  document.getElementById("f-activeform").value = t.activeForm || "";
  document.getElementById("modal-err").textContent = "";
  document.getElementById("modal").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  editingId = null;
}
function saveTask() {
  if (editingId == null) { return; }
  var body = {
    subject: document.getElementById("f-subject").value,
    description: document.getElementById("f-description").value,
    status: document.getElementById("f-status").value,
    priority: document.getElementById("f-priority").value,
    activeForm: document.getElementById("f-activeform").value
  };
  var err = document.getElementById("modal-err");
  fetch("/api/tasks/" + editingId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) { return res.json().then(function (j) { throw new Error(j.error || res.status); }); }
    closeModal();
  }).catch(function (e) {
    err.textContent = "не сохранено: " + e.message;
  });
}

/* ---- events ---- */
document.getElementById("project-filter").addEventListener("change", function (e) {
  ui.filter = e.target.value || "all";
  saveFilter();
  render();
});
document.getElementById("hidden-btn").addEventListener("click", function () {
  ui.hiddenPanelOpen = !ui.hiddenPanelOpen;
  renderToolbar();
});
document.getElementById("hidden-panel").addEventListener("click", function (e) {
  var btn = e.target.closest(".show-project");
  if (!btn) { return; }
  delete ui.hiddenProjects[btn.getAttribute("data-project")];
  saveHidden();
  render();
});

document.getElementById("statuses").addEventListener("click", function (e) {
  var row = e.target.closest(".row");
  if (!row) { return; }
  var status = row.getAttribute("data-status");
  var idx = ui.globalColumns.indexOf(status);
  if (idx === -1) { ui.globalColumns.push(status); } else { ui.globalColumns.splice(idx, 1); }
  saveGlobalColumns();
  render();
});

document.getElementById("boards").addEventListener("click", function (e) {
  if (dragging) { return; }
  var collapse = e.target.closest(".board-collapse");
  if (collapse) {
    var cname = collapse.getAttribute("data-project");
    ui.collapsed[cname] = !ui.collapsed[cname];
    saveCollapsed();
    render();
    return;
  }
  var hide = e.target.closest(".board-hide");
  if (hide) {
    ui.hiddenProjects[hide.getAttribute("data-project")] = true;
    saveHidden();
    render();
    return;
  }
  var chip = e.target.closest(".chip-btn");
  if (chip) {
    var pname = chip.getAttribute("data-project");
    var col = chip.getAttribute("data-column");
    var list = (ui.columnsByProject[pname] || boardColumns(pname)).slice();
    var at = list.indexOf(col);
    if (at === -1) { list.push(col); } else { list.splice(at, 1); }
    ui.columnsByProject[pname] = STATUS.filter(function (s) { return list.indexOf(s) !== -1; });
    saveColumns(pname);
    render();
    return;
  }
  var el = e.target.closest(".task");
  if (!el) { return; }
  openTask(Number(el.getAttribute("data-id")));
});

document.getElementById("boards").addEventListener("dragstart", function (e) {
  var el = e.target.closest(".task");
  if (!el) { return; }
  dragging = true;
  dragId = Number(el.getAttribute("data-id"));
  el.classList.add("dragging");
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragId)); } catch (err) {}
  }
});
document.getElementById("boards").addEventListener("dragend", function (e) {
  var el = e.target.closest(".task");
  if (el) { el.classList.remove("dragging"); }
  dragId = null;
  setTimeout(function () { dragging = false; }, 0);
});
document.getElementById("boards").addEventListener("dragover", function (e) {
  var col = e.target.closest(".col");
  if (!col) { return; }
  e.preventDefault();
  col.classList.add("drag-over");
});
document.getElementById("boards").addEventListener("dragleave", function (e) {
  var col = e.target.closest(".col");
  if (col) { col.classList.remove("drag-over"); }
});
document.getElementById("boards").addEventListener("drop", function (e) {
  var col = e.target.closest(".col");
  if (!col) { return; }
  e.preventDefault();
  col.classList.remove("drag-over");
  var id = dragId;
  if (id == null && e.dataTransfer) {
    var parsed = Number(e.dataTransfer.getData("text/plain"));
    if (!isNaN(parsed)) { id = parsed; }
  }
  var status = col.getAttribute("data-status");
  if (id == null || !status) { return; }
  moveTask(id, status);
});

document.getElementById("modal-save").addEventListener("click", saveTask);
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal").addEventListener("click", function (e) {
  if (e.target === this) { closeModal(); }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { closeModal(); }
});

/* ---- theme ---- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  var dark = theme === "dark";
  var btn = document.getElementById("theme-btn");
  btn.textContent = dark ? "☀ светлая" : "☾ тёмная";
  btn.setAttribute("aria-pressed", dark ? "true" : "false");
}
applyTheme(readLS("theme", "parchment") === "dark" ? "dark" : "parchment");
document.getElementById("theme-btn").addEventListener("click", function () {
  var next = document.documentElement.dataset.theme === "dark" ? "parchment" : "dark";
  writeLS("theme", next);
  applyTheme(next);
});

/* ---- data feed ---- */
var es = new EventSource("/api/events");
es.addEventListener("tasks", function (e) {
  var data = JSON.parse(e.data);
  if (Array.isArray(data.projects)) { state.projects = data.projects; }
  if (Array.isArray(data.tasks)) { state.tasks = data.tasks; }
  if (data.counts) { state.counts = data.counts; }
  if (data.currentProject !== undefined) { state.currentProject = data.currentProject; }
  if (data.activity) { state.activity = data.activity; }
  lastAt = Date.now();
  document.getElementById("dot").classList.add("live");
  document.getElementById("conn").textContent = "реалтайм через SSE · подключено";
  render();
});
es.addEventListener("activity", function (e) {
  state.activity = JSON.parse(e.data);
  lastAt = Date.now();
  render();
});
es.onerror = function () {
  document.getElementById("dot").classList.remove("live");
  document.getElementById("conn").textContent = "соединение потеряно — переподключаюсь…";
};
setInterval(function () { render(); }, 10000);
</script>
</body>
</html>`;
}
