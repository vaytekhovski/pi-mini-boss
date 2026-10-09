import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ActivityStore } from '../../src/activity/store.js';

describe('activity store', () => {
  let store: ActivityStore;
  beforeEach(() => {
    store = new ActivityStore(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('upserts the single agent activity row', () => {
    store.setAgentActivity('анализ');
    store.setAgentActivity('разработка');
    const snap = store.snapshot();
    assert.equal(snap.agent?.detail, 'разработка');
    assert.equal(snap.runs.length, 0);
  });

  it('records a subagent lifecycle without duplicate running rows', () => {
    store.recordSubagent('analyst', 'running', 'читаю');
    store.recordSubagent('analyst', 'running', 'читаю дальше');
    const open = store.listRuns().filter((r) => r.status === 'running');
    assert.equal(open.length, 1);
    assert.equal(open[0].detail, 'читаю дальше');

    store.recordSubagent('analyst', 'done', 'готово');
    const done = store.listRuns().filter((r) => r.name === 'analyst' && r.status === 'done');
    assert.equal(done.length, 1);
    assert.equal(done[0].detail, 'готово');
  });

  it('appends a finished row when no open run exists', () => {
    store.recordSubagent('tester', 'error', 'упал');
    const runs = store.listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'error');
    assert.equal(runs[0].name, 'tester');
  });

  it('emits a change event on every mutation', () => {
    let n = 0;
    const off = store.onChange(() => n++);
    store.setAgentActivity('x');
    store.recordSubagent('tester', 'running', 'тест');
    off();
    store.recordSubagent('tester', 'done');
    assert.equal(n, 2);
  });

  it('records agent and subagent rows with their project', () => {
    store.setAgentActivity('пишу', 'proj-a');
    store.recordSubagent('analyst', 'running', 'читаю', 'proj-a');
    assert.equal(store.listAgents()[0].project, 'proj-a');
    assert.equal(store.listRuns()[0].project, 'proj-a');
  });

  it('keeps one agent row per project without cross-project clobbering', () => {
    store.setAgentActivity('один', 'a');
    store.setAgentActivity('два', 'b');
    store.setAgentActivity('один-обновлён', 'a');
    assert.equal(store.listAgents().length, 2);
    const byProject = Object.fromEntries(store.listAgents().map((r) => [r.project, r.detail]));
    assert.equal(byProject.a, 'один-обновлён');
    assert.equal(byProject.b, 'два');
  });

  it('toggles the waiting status and preserves the detail', () => {
    store.setAgentActivity('анализ', 'proj-a');
    const waiting = store.setWaiting(true, 'proj-a');
    assert.equal(waiting.status, 'waiting');
    assert.equal(waiting.detail, 'анализ');
    const agent = store.snapshot().agents.find((r) => r.project === 'proj-a');
    assert.equal(agent?.status, 'waiting');
    assert.equal(agent?.detail, 'анализ');

    const resumed = store.setWaiting(false, 'proj-a');
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.detail, 'анализ');
  });

  it('exposes the freshest agent as snapshot().agent while listing all', () => {
    store.setAgentActivity('первый', 'a');
    store.setAgentActivity('второй', 'b');
    const snap = store.snapshot();
    assert.equal(snap.agent?.detail, 'второй');
    assert.equal(snap.agents.length, 2);
  });

  it('migrates a runs table created before the project column', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mini-boss-'));
    const dbPath = path.join(dir, 'activity.db');
    const Database = (await import('better-sqlite3')).default;
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL DEFAULT 'subagent',
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacy
      .prepare(
        "INSERT INTO runs (id, kind, name, status, detail, created_at, updated_at) VALUES (1, 'agent', 'agent', 'running', 'старый', 1, 1)",
      )
      .run();
    legacy.close();

    const migrated = new ActivityStore(dbPath);
    try {
      const agent = migrated.getAgent();
      assert.equal(agent?.detail, 'старый');
      assert.equal(agent?.project, '');
      // The new column is usable after the migration.
      const updated = migrated.setAgentActivity('новый', 'proj-a');
      assert.equal(updated.project, 'proj-a');
      assert.equal(migrated.listAgents().length, 2);
    } finally {
      migrated.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a waiting row and removes it when the wait ends on a clean project', () => {
    const waiting = store.setWaiting(true, 'proj-a');
    assert.equal(waiting?.status, 'waiting');
    assert.equal(store.listAgents().length, 1);

    const cleared = store.setWaiting(false, 'proj-a');
    assert.equal(cleared, undefined);
    assert.equal(store.listAgents().length, 0);
    assert.equal(store.snapshot().agents.length, 0);
  });

  it('does not create a phantom agent row when waiting=false has no prior activity', () => {
    const cleared = store.setWaiting(false, 'proj-x');
    assert.equal(cleared, undefined);
    assert.equal(store.listAgents().length, 0);
  });

  it('finishStaleProjects closes only the given projects running/waiting rows', () => {
    store.setAgentActivity('работаю', 'proj-a');
    store.recordSubagent('analyst', 'running', 'читаю', 'proj-a');
    store.setWaiting(true, 'proj-b');

    const changed = store.finishStaleProjects(['proj-a']);
    assert.equal(changed, 2);

    const agents = store.listAgents();
    assert.equal(agents.find((r) => r.project === 'proj-a')?.status, 'done');
    assert.equal(agents.find((r) => r.project === 'proj-b')?.status, 'waiting');
    assert.equal(store.listRuns().find((r) => r.name === 'analyst')?.status, 'done');
    assert.equal(store.finishStaleProjects([]), 0);
  });

  it('closes only rows older than the stale threshold', () => {
    store.setWaiting(true, 'fresh');
    store.setWaiting(true, 'old');
    (store as any).db
      .prepare("UPDATE runs SET updated_at = ? WHERE kind = 'agent' AND project = ?")
      .run(1, 'old');

    const changed = store.finishStaleProjects(['fresh', 'old'], Date.now() - 10 * 60 * 1000);
    assert.equal(changed, 1);

    const byProject = Object.fromEntries(store.listAgents().map((r) => [r.project, r.status]));
    assert.equal(byProject.fresh, 'waiting');
    assert.equal(byProject.old, 'done');
  });
});
