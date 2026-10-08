#!/usr/bin/env node
/**
 * pi-mini-boss board — a standalone terminal board for the shared task store.
 *
 * Put it in a tmux pane next to Pi; it reads the same SQLite store live, so it
 * is a native side panel (left or right of the Pi window) without touching Pi's
 * own TUI layout.
 *
 *   pi-mini-boss-board [--db <path>] [--once] [--interval <ms>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const once = args.includes("--once");
const interval = Number(flag("--interval", "800")) || 800;
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
};

const ORDER = ["in_progress", "pending", "blocked", "completed"];
const TITLE = { pending: "pending", in_progress: "in progress", blocked: "blocked", completed: "completed" };
const GLYPH = { pending: "○", in_progress: "◐", blocked: "⊘", completed: "✓" };
const COLOR = { pending: c.dim, in_progress: c.cyan, blocked: c.yellow, completed: c.green };

const EMPTY = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };

/** Read the shared store; a missing database is simply an empty board. */
function readBoard() {
  if (!fs.existsSync(dbPath)) {
    return { tasks: [], counts: { ...EMPTY } };
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 2000");
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE status != 'deleted' ORDER BY id")
      .all();
    const counts = { ...EMPTY, total: tasks.length };
    for (const task of tasks) {
      if (task.status in counts) counts[task.status] += 1;
    }
    return { tasks, counts };
  } finally {
    db.close();
  }
}

/** Render the board as plain text (with ANSI colours). Pure, for easy testing. */
export function renderBoard({ tasks, counts }, width = 60) {
  const rule = "─".repeat(Math.max(12, Math.min(width, 72)));
  const lines = [
    `${c.bold}pi-mini-boss${c.reset} ${c.dim}board${c.reset}   ` +
      `${c.green}${counts.completed}/${counts.total} done${c.reset} · ` +
      `${c.cyan}${counts.in_progress} active${c.reset} · ` +
      `${c.yellow}${counts.blocked} blocked${c.reset}`,
    `${c.dim}${rule}${c.reset}`,
  ];
  for (const status of ORDER) {
    const items = tasks.filter((task) => task.status === status);
    lines.push(`${COLOR[status]}▸ ${TITLE[status]} (${items.length})${c.reset}`);
    if (items.length === 0) {
      lines.push(`  ${c.dim}—${c.reset}`);
    } else {
      for (const task of items) {
        const pr = task.priority && task.priority !== "normal" ? ` ${c.yellow}${task.priority}${c.reset}` : "";
        const af =
          status === "in_progress" && task.active_form ? ` ${c.dim}${task.active_form}${c.reset}` : "";
        lines.push(`  ${GLYPH[status]} ${c.dim}#${task.id}${c.reset} ${task.subject}${pr}${af}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function frame() {
  let board;
  try {
    board = readBoard();
  } catch (error) {
    process.stdout.write(`${c.yellow}pi-mini-boss board: ${error.message}${c.reset}\n`);
    return;
  }
  const body = renderBoard(board, process.stdout.columns || 60);
  if (once) {
    process.stdout.write(`${body}\n`);
    return;
  }
  process.stdout.write(`\x1b[2J\x1b[H${body}\n${c.dim}  Ctrl+C to quit${c.reset}\n`);
}

// Exported for the unit test; the CLI loop only runs when invoked directly.
export function runBoard() {
  frame();
  if (once) return;
  const timer = setInterval(frame, interval);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.stdout.write(`${c.reset}\n`);
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBoard();
}
