import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../../src/tasks/store.js';
import { ActivityStore } from '../../src/activity/store.js';
import { createDashboardApp } from '../../src/dashboard/server.js';

const get = (app: ReturnType<typeof createDashboardApp>, path: string, init?: RequestInit) =>
  app.fetch(new Request('http://localhost' + path, init));

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
  let activity: ActivityStore;
  beforeEach(() => {
    store = new TaskStore(':memory:');
    activity = new ActivityStore(':memory:');
  });
  afterEach(() => {
    store.close();
    activity.close();
  });

  it('serves the snapshot of the shared store without deleted tasks', async () => {
    store.create({ subject: 'в работе', status: 'development', activeForm: 'делаю' });
    store.create({ subject: 'блокер', status: 'blocked', priority: 'high' });
    store.remove(store.create({ subject: 'удалённая' }).id);

    const res = await get(createDashboardApp(store, activity), '/api/tasks');
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
      analysis: 0,
      planning: 0,
      development: 1,
      review: 0,
      testing: 0,
      report: 0,
      completed: 0,
      blocked: 1,
    });
  });

  it('renders the board, sidebar and activity panel', async () => {
    const res = await get(createDashboardApp(store, activity), '/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<aside>/, 'the page has a sidebar');
    assert.match(html, /EventSource\("\/api\/events"\)/, 'the page subscribes to the SSE stream');
    for (const status of ['pending', 'analysis', 'planning', 'development', 'review', 'testing', 'report', 'completed', 'blocked']) {
      assert.ok(html.includes('s-' + status), `status ${status} is rendered`);
    }
    assert.match(html, /id="activity"/, 'the activity panel is rendered');
  });

  it('patches a task from the dashboard', async () => {
    const task = store.create({ subject: 'начало' });
    const res = await get(createDashboardApp(store, activity), '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review', subject: 'изменено' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number; subject: string; status: string };
    assert.equal(body.subject, 'изменено');
    assert.equal(body.status, 'review');
    assert.equal(store.get(task.id)?.subject, 'изменено');
  });

  it('rejects an unknown status in a patch', async () => {
    const task = store.create({ subject: 'x' });
    const res = await get(createDashboardApp(store, activity), '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'nonsense' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects an unknown priority in a patch', async () => {
    const task = store.create({ subject: 'x' });
    const res = await get(createDashboardApp(store, activity), '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'weird' }),
    });
    assert.equal(res.status, 400);
    assert.equal(store.get(task.id)?.priority, 'normal');
  });

  it('rejects an empty patch without touching the store', async () => {
    const task = store.create({ subject: 'unchanged' });
    const before = store.get(task.id)!;
    const res = await get(createDashboardApp(store, activity), '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const after = store.get(task.id)!;
    assert.equal(after.subject, 'unchanged');
    assert.equal(after.updatedAt, before.updatedAt);
  });

  it('serves a multi-project snapshot (projects, tasks, counts, currentProject)', async () => {
    const alpha = store.ensureProject('alpha', '/repo/alpha');
    const beta = store.ensureProject('beta', '/repo/beta');
    store.create({ subject: 'в альфе', projectId: alpha.id });
    store.create({ subject: 'в бете', projectId: beta.id, status: 'development' });

    const res = await get(createDashboardApp(store, activity), '/api/tasks');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      currentProject: string | null;
      projects: Array<{ id: number; name: string; path: string }>;
      tasks: Array<{ subject: string; projectId: number | null }>;
      counts: { total: number };
    };
    assert.deepEqual(
      body.projects.map((project) => [project.name, project.path]),
      [
        ['alpha', '/repo/alpha'],
        ['beta', '/repo/beta'],
      ],
    );
    assert.deepEqual(body.projects.map((project) => project.id).sort(), [alpha.id, beta.id].sort());
    assert.deepEqual(
      body.tasks.map((task) => [task.subject, task.projectId]),
      [
        ['в альфе', alpha.id],
        ['в бете', beta.id],
      ],
    );
    assert.equal(body.counts.total, 2);
    assert.ok(body.currentProject === null || typeof body.currentProject === 'string');
  });

  it('moves a task to another column with action=move', async () => {
    const task = store.create({ subject: 'перенести', status: 'pending' });
    const res = await get(createDashboardApp(store, activity), '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', status: 'completed' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'completed');
    assert.equal(store.get(task.id)?.status, 'completed');
  });

  it('reassigns a task to another project with action=project', async () => {
    const task = store.create({ subject: 'переехать' });
    const res = await get(createDashboardApp(store, activity), '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'project', project: 'other' }),
    });
    assert.equal(res.status, 200);
    const other = store.listProjects().find((project) => project.name === 'other');
    assert.ok(other, 'the target project was created');
    assert.equal(store.get(task.id)?.projectId, other!.id);
  });

  it('answers 404 for an unknown task and 400 for a bad action', async () => {
    const app = createDashboardApp(store, activity);
    const missing = await get(app, '/api/tasks/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', status: 'completed' }),
    });
    assert.equal(missing.status, 404);

    const task = store.create({ subject: 'x' });
    const badAction = await get(app, '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'teleport' }),
    });
    assert.equal(badAction.status, 400);

    const badStatus = await get(app, '/api/tasks/' + task.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', status: 'nonsense' }),
    });
    assert.equal(badStatus.status, 400);
  });

  it('serves the page as utf-8 html', async () => {
    const res = await get(createDashboardApp(store, activity), '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(res.headers.get('content-type') ?? '', /charset=utf-8/i);
  });

  it('serves the activity snapshot', async () => {
    activity.setAgentActivity('пишу код');
    activity.recordSubagent('analyst', 'running', 'читаю репо');
    const res = await get(createDashboardApp(store, activity), '/api/activity');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { agent: { detail: string }; runs: Array<{ name: string }> };
    assert.equal(body.agent.detail, 'пишу код');
    assert.deepEqual(body.runs.map((run) => run.name), ['analyst']);
  });

  it('pushes a fresh snapshot when a task changes', { timeout: 5000 }, async () => {
    const res = await get(createDashboardApp(store, activity), '/api/events');
    const reader = res.body!.getReader();
    const first = await readUntil(reader, 'event: tasks');
    assert.match(first, /event: tasks/);
    assert.match(first, /"total":0/);

    store.create({ subject: 'живая задача' });
    assert.match(await readUntil(reader, 'живая задача'), /живая задача/);
    await reader.cancel();
  });
});
