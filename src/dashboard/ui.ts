/**
 * pi-mini-boss dashboard UI — a single self-contained page that renders the
 * shared task store and stays current through an SSE stream.
 */
export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>pi-mini-boss · tasks</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0e1116; color: #d7dde5; }
  header { display: flex; gap: 16px; align-items: baseline; padding: 14px 18px; border-bottom: 1px solid #1e2733; position: sticky; top: 0; background: #0e1116; }
  header h1 { font-size: 15px; margin: 0; color: #7dd3fc; }
  .counts { color: #8b98a9; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #64748b; margin-left: 8px; vertical-align: middle; }
  .dot.live { background: #22c55e; }
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; padding: 16px 18px; }
  .col { background: #131926; border: 1px solid #1e2733; border-radius: 8px; padding: 10px; min-height: 80px; }
  .col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 8px; color: #8b98a9; }
  .task { border-left: 3px solid #334155; padding: 6px 8px; margin-bottom: 6px; background: #0e1116; border-radius: 4px; }
  .task .id { color: #64748b; }
  .task .pr { float: right; font-size: 11px; color: #94a3b8; }
  .task small { color: #7b8798; display: block; margin-top: 2px; }
  .s-in_progress { border-left-color: #38bdf8; }
  .s-completed { border-left-color: #22c55e; opacity: .75; }
  .s-blocked { border-left-color: #f59e0b; }
  .p-high .pr { color: #fbbf24; } .p-urgent .pr { color: #f87171; }
  .empty { color: #4b5768; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>pi-mini-boss</h1>
  <span class="counts" id="counts">…</span>
  <span class="dot" id="dot"></span>
</header>
<div class="board" id="board"></div>
<script>
const STATUS = ["pending", "in_progress", "blocked", "completed"];
const LABEL = { pending: "pending", in_progress: "in progress", blocked: "blocked", completed: "completed" };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const dot = document.getElementById("dot");

function render({ tasks, counts }) {
  document.getElementById("counts").textContent =
    counts.completed + "/" + counts.total + " done · " + counts.in_progress + " active · " + counts.blocked + " blocked";
  const board = document.getElementById("board");
  board.innerHTML = STATUS.map((status) => {
    const items = tasks.filter((t) => t.status === status);
    const body = items.length
      ? items.map((t) => '<div class="task s-' + t.status + " p-" + t.priority + '"><span class="pr">' + t.priority +
          '</span><span class="id">#' + t.id + "</span> " + esc(t.subject) +
          (t.activeForm && t.status === "in_progress" ? "<small>" + esc(t.activeForm) + "</small>" : "") + "</div>").join("")
      : '<div class="empty">—</div>';
    return '<section class="col"><h2>' + LABEL[status] + " (" + items.length + ")</h2>" + body + "</section>";
  }).join("");
}

const es = new EventSource("/api/events");
es.addEventListener("tasks", (e) => { dot.classList.add("live"); render(JSON.parse(e.data)); });
es.onerror = () => dot.classList.remove("live");
</script>
</body>
</html>`;
}
