import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../../src/tasks/store.js';
import { createDashboardApp } from '../../src/dashboard/server.js';

const get = (app: ReturnType<typeof createDashboardApp>, path: string) =>
  app.fetch(new Request('http://localhost' + path));

/** Read SSE chunks until the payload contains `needle` (or the stream ends). */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (let i = 0; i < 10 && !text.includes(needle); i += 1) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value);
  }
  return text;
}

describe('dashboard server', () => {
  let store: TaskStore;
  beforeEach(() => {
    store = new TaskStore(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('serves the snapshot of the shared store without deleted tasks', async () => {
    store.create({ subject: 'в работе', status: 'in_progress', activeForm: 'делаю' });
    store.create({ subject: 'блокер', status: 'blocked', priority: 'high' });
    store.remove(store.create({ subject: 'удалённая' }).id);

    const res = await get(createDashboardApp(store), '/api/tasks');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      tasks: Array<{ subject: string }>;
      counts: Record<string, number>;
    };
    assert.deepEqual(
      body.tasks.map((task) => task.subject),
      ['в работе', 'блокер'],
    );
    assert.deepEqual(body.counts, {
      total: 2,
      pending: 0,
      in_progress: 1,
      completed: 0,
      blocked: 1,
    });
  });

  it('renders the board and the right sidebar with every status', async () => {
    const res = await get(createDashboardApp(store), '/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<aside>/, 'the page has a sidebar');
    assert.match(html, /EventSource\("\/api\/events"\)/, 'the page subscribes to the SSE stream');
    for (const status of ['pending', 'in_progress', 'blocked', 'completed']) {
      assert.ok(html.includes('s-' + status), `status ${status} is rendered`);
    }
  });

  it('pushes a fresh snapshot when a task changes', { timeout: 5000 }, async () => {
    const res = await get(createDashboardApp(store), '/api/events');
    const reader = res.body!.getReader();
    const first = await readUntil(reader, 'event: tasks');
    assert.match(first, /event: tasks/);
    assert.match(first, /"total":0/);

    store.create({ subject: 'живая задача' });
    assert.match(await readUntil(reader, 'живая задача'), /живая задача/);
    await reader.cancel();
  });
});
