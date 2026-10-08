import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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

    store.update(a.id, { status: 'in_progress', activeForm: 'doing one' });
    assert.equal(store.get(a.id)?.status, 'in_progress');
    assert.equal(store.get(a.id)?.activeForm, 'doing one');

    const b = store.create({ subject: 'two', priority: 'high' });
    assert.deepEqual(store.list().map((task) => task.subject), ['one', 'two']);
    assert.deepEqual(store.counts(), {
      total: 2,
      pending: 1,
      in_progress: 1,
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

});
