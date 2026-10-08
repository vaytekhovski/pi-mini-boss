#!/usr/bin/env node
/**
 * pi-mini-boss board — a standalone terminal panel for the shared store.
 *
 * Shows tasks, live status, AND questions from the agent. Run it in a tmux pane
 * next to Pi; the transcript scroll stays intact because the question is answered
 * here, not in a modal overlay.
 *
 *   pi-mini-boss-board [--db <path>] [--once] [--interval <ms>]
 *
 * Keys (while a question is shown): 1-9 answer/toggle · Enter submit (multi) ·
 * Esc cancel · q quit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const once = args.includes("--once");
const interval = Number(flag("--interval", "350")) || 350;
const dbPath =
  flag("--db", process.env.PI_MINI_BOSS_DB) ||
  path.join(os.homedir(), ".pi", "agent", "pi-mini-boss", "tasks.db");

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
};

const ORDER = ["in_progress", "pending", "blocked", "completed"];
const TITLE = { pending: "pending", in_progress: "in progress", blocked: "blocked", completed: "completed" };
const GLYPH = { pending: "○", in_progress: "◐", blocked: "⊘", completed: "✓" };
const COLOR = { pending: c.dim, in_progress: c.cyan, blocked: c.yellow, completed: c.green };

/** The board owns no schema of record — it mirrors the extension's tables. */
function openDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, header TEXT NOT NULL DEFAULT '', multi_select INTEGER NOT NULL DEFAULT 0, options TEXT NOT NULL, answer TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, answered_at INTEGER);
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', active_form TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  `);
  return db;
}

function readState(db) {
  const tasks = db.prepare("SELECT * FROM tasks WHERE status != 'deleted' ORDER BY id").all();
  const counts = db.prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE status != 'deleted' GROUP BY status").all();
  const summary = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };
  for (const { status, n } of counts) {
    summary.total += n;
    if (status in summary) summary[status] += n;
  }
  const qrow = db
    .prepare("SELECT * FROM questions WHERE status = 'pending' ORDER BY id DESC LIMIT 1")
    .get();
  const question = qrow
    ? {
        id: qrow.id,
        question: qrow.question,
        header: qrow.header,
        multiSelect: qrow.multi_select === 1,
        options: JSON.parse(qrow.options),
      }
    : null;
  return { tasks, counts: summary, question };
}

/** Render the board (question block first, then task columns). Pure, for tests. */
export function renderBoard(state, width = 60) {
  const { tasks, counts, question, selected } = state;
  const rule = "─".repeat(Math.max(12, Math.min(width, 72)));
  const lines = [
    `${c.bold}pi-mini-boss${c.reset} ${c.dim}board${c.reset}   ` +
      `${c.green}${counts.completed}/${counts.total} done${c.reset} · ` +
      `${c.cyan}${counts.in_progress} active${c.reset} · ` +
      `${c.yellow}${counts.blocked} blocked${c.reset}`,
    `${c.dim}${rule}${c.reset}`,
  ];

  if (question) {
    const picks = selected ?? new Set();
    lines.push(`${c.magenta}❓${c.reset} ${c.bold}${question.header || "Вопрос"}${c.reset}: ${question.question}`);
    question.options.forEach((option, index) => {
      const mark = question.multiSelect ? (picks.has(index) ? "[x]" : "[ ]") : " ";
      const desc = option.description ? ` ${c.dim}— ${option.description}${c.reset}` : "";
      lines.push(`  ${mark} ${c.bold}${index + 1}${c.reset} ${option.label}${desc}`);
    });
    lines.push(
      `  ${c.dim}${question.multiSelect ? "цифры — отметить · Enter — ок · Esc — отмена" : "цифра — выбрать · Esc — отмена"}${c.reset}`,
    );
    lines.push(`${c.dim}${rule}${c.reset}`);
  }

  for (const status of ORDER) {
    const items = tasks.filter((task) => task.status === status);
    lines.push(`${COLOR[status]}▸ ${TITLE[status]} (${items.length})${c.reset}`);
    if (items.length === 0) {
      lines.push(`  ${c.dim}—${c.reset}`);
    } else {
      for (const task of items) {
        const pr = task.priority && task.priority !== "normal" ? ` ${c.yellow}${task.priority}${c.reset}` : "";
        const af = status === "in_progress" && task.active_form ? ` ${c.dim}${task.active_form}${c.reset}` : "";
        lines.push(`  ${GLYPH[status]} ${c.dim}#${task.id}${c.reset} ${task.subject}${pr}${af}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** CLI loop + key handling. */
export function runBoard() {
  const db = openDb();
  db.prepare(
    "INSERT INTO board (id, pid, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, updated_at = excluded.updated_at",
  ).run(process.pid, Date.now());

  let selected = new Set();
  let activeQuestionId = null;

  const draw = () => {
    const state = readState(db);
    if (state.question && state.question.id !== activeQuestionId) {
      activeQuestionId = state.question.id;
      selected = new Set(
        state.question.options.map((option, index) => (option.selected ? index : -1)).filter((index) => index >= 0),
      );
    }
    if (!state.question) activeQuestionId = null;
    state.selected = selected;
    const body = renderBoard(state, process.stdout.columns || 60);
    if (once) {
      process.stdout.write(`${body}\n`);
      return;
    }
    const hint = state.question ? "  ответь в панели" : "  Ctrl+C / q — выход";
    process.stdout.write(`\x1b[2J\x1b[H${body}\n${c.dim}${hint}${c.reset}\n`);
  };

  const quit = () => {
    try {
      db.prepare("DELETE FROM board WHERE id = 1").run();
    } catch {
      /* best effort */
    }
    db.close();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(`${c.reset}\n`);
    process.exit(0);
  };

  const submit = () => {
    const q = readState(db).question;
    if (!q) return;
    const labels = [...selected].sort((a, b) => a - b).map((i) => q.options[i].label);
    if (labels.length === 0) return;
    db.prepare(
      "UPDATE questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ? AND status = 'pending'",
    ).run(JSON.stringify(labels), Date.now(), q.id);
    selected = new Set();
    activeQuestionId = null;
    draw();
  };

  const cancel = () => {
    const q = readState(db).question;
    if (!q) return;
    db.prepare("UPDATE questions SET status = 'cancelled', answered_at = ? WHERE id = ? AND status = 'pending'").run(
      Date.now(),
      q.id,
    );
    selected = new Set();
    activeQuestionId = null;
    draw();
  };

  const onKey = (data) => {
    if (data === "\x03" || data === "q") return quit();
    const q = readState(db).question;
    if (!q) return;
    if (data === "\x1b") return cancel();
    if (data === "\r" || data === "\n") {
      if (q.multiSelect) return submit();
      return;
    }
    const match = /^[1-9]$/.exec(data);
    if (!match) return;
    const index = Number(match[0]) - 1;
    if (index >= q.options.length) return;
    if (q.multiSelect) {
      selected.has(index) ? selected.delete(index) : selected.add(index);
      draw();
    } else {
      selected = new Set([index]);
      submit();
    }
  };

  if (once) {
    draw();
    db.close();
    return;
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", onKey);
  process.on("SIGINT", quit);

  draw();
  setInterval(() => {
    db.prepare("UPDATE board SET pid = ?, updated_at = ? WHERE id = 1").run(process.pid, Date.now());
    draw();
  }, interval);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBoard();
}
