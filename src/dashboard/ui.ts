/**
 * pi-mini-boss dashboard UI — one self-contained page: the task board fills the
 * main area, a status sidebar sits on the right, and both are fed by the SSE
 * stream from `server.ts`.
 */
export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pi-mini-boss · задачи</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0e1116; color: #d7dde5; }
  header { display: flex; gap: 14px; align-items: baseline; padding: 14px 18px; border-bottom: 1px solid #1e2733; position: sticky; top: 0; background: #0e1116; z-index: 2; }
  header h1 { font-size: 15px; margin: 0; color: #7dd3fc; }
  .counts, .muted { color: #8b98a9; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #64748b; margin-left: 8px; vertical-align: middle; }
  .dot.live { background: #22c55e; }
  .app { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 16px; align-items: start; padding: 0 18px 24px; }
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; padding-top: 16px; }
  .col { background: #131926; border: 1px solid #1e2733; border-radius: 8px; padding: 10px; min-height: 80px; }
  .col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 8px; color: #8b98a9; }
  .task { border-left: 3px solid #334155; padding: 6px 8px; margin-bottom: 6px; background: #0e1116; border-radius: 4px; }
  .task .id { color: #64748b; }
  .task .pr { float: right; font-size: 11px; color: #94a3b8; }
  .task small { color: #7b8798; display: block; margin-top: 2px; }
  .task .desc { color: #9aa6b6; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .task .when { color: #5b6675; font-size: 11px; margin-top: 4px; }
  .s-in_progress { border-left-color: #38bdf8; }
  .s-completed { border-left-color: #22c55e; opacity: .75; }
  .s-blocked { border-left-color: #f59e0b; }
  .p-high .pr { color: #fbbf24; } .p-urgent .pr { color: #f87171; }
  .empty { color: #4b5768; font-style: italic; }
  aside { position: sticky; top: 57px; padding-top: 16px; display: flex; flex-direction: column; gap: 12px; }
  aside h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8b98a9; margin: 0 0 6px; }
  .rows { background: #131926; border: 1px solid #1e2733; border-radius: 8px; overflow: hidden; }
  .row { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer; user-select: none; border-bottom: 1px solid #1a2230; }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: #161d2c; }
  .row .sw { width: 8px; height: 8px; border-radius: 2px; background: #334155; flex: none; }
  .row .n { margin-left: auto; color: #8b98a9; }
  .row.off { color: #55606f; }
  .row.off .sw { background: #2a3140; }
  .row.off .n { color: #55606f; }
  .row.s-pending .sw { background: #64748b; }
  .row.s-in_progress .sw { background: #38bdf8; }
  .row.s-blocked .sw { background: #f59e0b; }
  .row.s-completed .sw { background: #22c55e; }
  .note { color: #5b6675; font-size: 11px; }
  @media (max-width: 900px) {
    .app { grid-template-columns: minmax(0, 1fr); }
    aside { position: static; order: -1; }
  }
</style>
</head>
<body>
<header>
  <h1>pi-mini-boss</h1>
  <span class="counts" id="counts">…</span>
  <span class="dot" id="dot"></span>
  <span class="muted" id="stamp"></span>
</header>
<div class="app">
  <main><div class="board" id="board"></div></main>
  <aside>
    <div>
      <h2>Статусы</h2>
      <div class="rows" id="statuses"></div>
    </div>
    <div class="note" id="conn">реалтайм через SSE</div>
  </aside>
</div>
<script>
var STATUS = ["pending", "in_progress", "blocked", "completed"];
var LABEL = { pending: "pending", in_progress: "in progress", blocked: "blocked", completed: "completed" };
var hidden = {};
var state = { tasks: [], counts: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 } };
var lastAt = 0;

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function ago(ms) {
  var d = Math.max(0, Date.now() - ms) / 1000;
  if (d < 60) { return Math.round(d) + " с"; }
  if (d < 3600) { return Math.round(d / 60) + " мин"; }
  if (d < 86400) { return Math.round(d / 3600) + " ч"; }
  return Math.round(d / 86400) + " дн";
}

function card(t) {
  var out = '<div class="task s-' + t.status + " p-" + t.priority + '">';
  out += '<span class="pr">' + esc(t.priority) + '</span>';
  out += '<span class="id">#' + t.id + "</span> " + esc(t.subject);
  if (t.activeForm && t.status === "in_progress") { out += "<small>" + esc(t.activeForm) + "</small>"; }
  if (t.description) { out += '<div class="desc" title="' + esc(t.description) + '">' + esc(t.description) + "</div>"; }
  out += '<div class="when">обновлено ' + ago(t.updatedAt) + " назад</div>";
  return out + "</div>";
}

function column(status) {
  var items = state.tasks.filter(function (t) { return t.status === status; });
  var body = items.length ? items.map(card).join("") : '<div class="empty">—</div>';
  return '<section class="col"><h2>' + LABEL[status] + " (" + items.length + ")</h2>" + body + "</section>";
}

function sidebar() {
  document.getElementById("statuses").innerHTML = STATUS.map(function (status) {
    return '<div class="row s-' + status + (hidden[status] ? " off" : "") + '" data-status="' + status +
      '"><span class="sw"></span>' + LABEL[status] + '<span class="n">' + (state.counts[status] || 0) + "</span></div>";
  }).join("");
}

function render() {
  var c = state.counts;
  document.getElementById("counts").textContent =
    c.completed + "/" + c.total + " готово · " + c.in_progress + " в работе · " + c.blocked + " блок";
  var shown = STATUS.filter(function (s) { return !hidden[s]; });
  document.getElementById("board").innerHTML = shown.length
    ? shown.map(column).join("")
    : '<div class="empty">все колонки скрыты — включите статус справа</div>';
  sidebar();
  if (lastAt) { document.getElementById("stamp").textContent = "· данные " + ago(lastAt) + " назад"; }
}

document.getElementById("statuses").addEventListener("click", function (e) {
  var row = e.target.closest(".row");
  if (!row) { return; }
  var status = row.getAttribute("data-status");
  hidden[status] = !hidden[status];
  render();
});

var es = new EventSource("/api/events");
es.addEventListener("tasks", function (e) {
  state = JSON.parse(e.data);
  lastAt = Date.now();
  document.getElementById("dot").classList.add("live");
  document.getElementById("conn").textContent = "реалтайм через SSE · подключено";
  render();
});
es.onerror = function () {
  document.getElementById("dot").classList.remove("live");
  document.getElementById("conn").textContent = "соединение потеряно — переподключаюсь…";
};
setInterval(render, 10000);
</script>
</body>
</html>`;
}
