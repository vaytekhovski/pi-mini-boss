import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore } from '../../src/tasks/store.js';

describe('task store', () => {
  let store: TaskStore;
  beforeEach(() => {
    store = new TaskStore(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('creates, updates, lists and counts tasks', () => {
    const a = store.create({ subject: 'one' });
    assert.equal(a.status, 'pending');
    assert.equal(a.priority, 'normal');

    store.update(a.id, { status: 'development', activeForm: 'doing one' });
    assert.equal(store.get(a.id)?.status, 'development');
    assert.equal(store.get(a.id)?.activeForm, 'doing one');

    const b = store.create({ subject: 'two', priority: 'high' });
    assert.deepEqual(store.list().map((task) => task.subject), ['one', 'two']);
    assert.deepEqual(store.counts(), {
      total: 2,
      pending: 1,
      analysis: 0,
      planning: 0,
      development: 1,
      review: 0,
      testing: 0,
      report: 0,
      completed: 0,
      blocked: 0,
    });

    assert.equal(store.remove(b.id), true);
    assert.deepEqual(store.list().map((task) => task.subject), ['one']);
    assert.equal(store.get(b.id)?.status, 'deleted');
  });

  it('emits a change event on every mutation', () => {
    let n = 0;
    const off = store.onChange(() => n++);
    store.create({ subject: 'x' });
    store.create({ subject: 'y' });
    off();
    store.create({ subject: 'z' });
    assert.equal(n, 2);
  });

  it('returns null for unknown ids and no-ops the update', () => {
    assert.equal(store.get(999), null);
    assert.equal(store.update(999, { status: 'completed' }), null);
  });

  it('ensureProject is idempotent by name', () => {
    const first = store.ensureProject('alpha', '/repo/alpha');
    const second = store.ensureProject('alpha');
    assert.equal(second.id, first.id);
    assert.equal(second.path, '/repo/alpha');
    assert.deepEqual(store.listProjects().map((p) => p.name), ['alpha']);
  });

  it('filters list and counts by projectId', () => {
    const a = store.ensureProject('a');
    const b = store.ensureProject('b');
    store.create({ subject: 'a1', projectId: a.id });
    store.create({ subject: 'b1', projectId: b.id });
    store.create({ subject: 'none' });

    assert.deepEqual(store.list(undefined, a.id).map((t) => t.subject), ['a1']);
    assert.equal(store.counts(a.id).total, 1);
    // The unfiltered aggregates stay intact.
    assert.equal(store.counts().total, 3);
    assert.equal(store.list().length, 3);
  });

  it('assignLegacyTasks binds only NULL rows and is repeatable', () => {
    const project = store.ensureProject('p');
    store.create({ subject: 'legacy one' });
    store.create({ subject: 'legacy two' });
    store.create({ subject: 'owned', projectId: store.ensureProject('other').id });

    assert.equal(store.assignLegacyTasks(project.id), 2);
    assert.equal(store.assignLegacyTasks(project.id), 0);
    assert.deepEqual(store.list(undefined, project.id).map((t) => t.subject), ['legacy one', 'legacy two']);
  });

  it('migrates a database created before projects existed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mini-boss-'));
    const dbPath = path.join(dir, 'tasks.db');
    const Database = (await import('better-sqlite3')).default;
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        active_form TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacy.prepare(
      "INSERT INTO tasks (subject, created_at, updated_at) VALUES ('old task', 1, 1)",
    ).run();
    legacy.close();

    const migrated = new TaskStore(dbPath);
    try {
      const task = migrated.list()[0];
      assert.equal(task.subject, 'old task');
      assert.equal(task.projectId, null);
      const project = migrated.ensureProject('migrated');
      assert.equal(migrated.assignLegacyTasks(project.id), 1);
      assert.equal(migrated.get(task.id)?.projectId, project.id);
    } finally {
      migrated.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reopening a migrated database is idempotent and keeps projects unique', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mini-boss-'));
    const dbPath = path.join(dir, 'tasks.db');
    try {
      const first = new TaskStore(dbPath);
      const project = first.ensureProject('stable', '/repo/stable');
      first.close();

      // Re-running the migration must not throw nor duplicate the project row.
      const second = new TaskStore(dbPath);
      try {
        const again = second.ensureProject('stable');
        assert.equal(again.id, project.id);
        assert.deepEqual(second.listProjects().map((p) => p.name), ['stable']);
      } finally {
        second.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates legacy in_progress tasks into development', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mini-boss-'));
    const dbPath = path.join(dir, 'tasks.db');
    const Database = (await import('better-sqlite3')).default;
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        active_form TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacy.prepare(
      "INSERT INTO tasks (subject, status, created_at, updated_at) VALUES ('old work', 'in_progress', 1, 1)",
    ).run();
    legacy.close();

    const migrated = new TaskStore(dbPath);
    try {
      const task = migrated.list()[0];
      assert.equal(task.status, 'development');
      assert.equal(migrated.counts().development, 1);
      assert.equal(migrated.counts().total, 1);
    } finally {
      migrated.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('snapshot returns projects, tasks and counts', () => {
    const project = store.ensureProject('snap');
    store.create({ subject: 'one', projectId: project.id });
    const snap = store.snapshot();
    assert.deepEqual(snap.projects.map((p) => p.name), ['snap']);
    assert.equal(snap.tasks.length, 1);
    assert.equal(snap.counts.total, 1);
  });

  it('update treats projectId null as unbind and undefined as unchanged', () => {
    const project = store.ensureProject('p');
    const task = store.create({ subject: 't', projectId: project.id });

    store.update(task.id, { status: 'development' });
    assert.equal(store.get(task.id)?.projectId, project.id);

    store.update(task.id, { projectId: null });
    assert.equal(store.get(task.id)?.projectId, null);
  });

});
