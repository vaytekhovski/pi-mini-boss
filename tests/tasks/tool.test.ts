import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore } from '../../src/tasks/store.js';
import { registerTaskTool } from '../../src/tasks/tool.js';

interface ToolDef {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx?: { cwd?: string },
  ) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

function setup(): { store: TaskStore; execute: ToolDef['execute'] } {
  const store = new TaskStore(':memory:');
  const defs: ToolDef[] = [];
  const pi = { registerTool: (d: ToolDef) => defs.push(d) } as unknown as Parameters<
    typeof registerTaskTool
  >[0];
  registerTaskTool(pi, () => store, 'projects-memory');
  return { store, execute: defs[0].execute };
}

describe('task tool projects', () => {
  let store: TaskStore;
  let execute: ToolDef['execute'];
  let tmpdirs: string[];
  beforeEach(() => {
    ({ store, execute } = setup());
    tmpdirs = [];
  });
  afterEach(() => {
    store.close();
    for (const dir of tmpdirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const mkTmpdir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mini-boss-'));
    tmpdirs.push(dir);
    return dir;
  };

  it('binds new tasks to the detected project when ctx.cwd is given', async () => {
    const cwd = mkTmpdir();
    const result = await execute('id', { action: 'create', subject: 'scoped' }, undefined, undefined, {
      cwd,
    });
    const task = (result.details as { task: { projectId: number | null } }).task;
    const projects = store.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, path.basename(cwd));
    assert.equal(task.projectId, projects[0].id);
  });

  it('creates a task in an explicitly named project', async () => {
    const result = await execute('id', { action: 'create', subject: 'named', project: 'my-proj' }, undefined, undefined);
    const task = (result.details as { task: { projectId: number | null } }).task;
    const project = store.listProjects().find((p) => p.name === 'my-proj');
    assert.ok(project);
    assert.equal(task.projectId, project!.id);
  });

  it('lists projects and marks the current one', async () => {
    const cwd = mkTmpdir();
    const result = await execute('id', { action: 'projects' }, undefined, undefined, { cwd });
    const text = result.content[0].text;
    assert.match(text, /\(current\)/);
    assert.match(text, new RegExp(path.basename(cwd)));
  });

  it('creates an unbound task outside any project without errors', async () => {
    // Updated for the inbox fallback: without a cwd a new task lands in the
    // `inbox` project instead of staying project-less, so it can never be swept
    // into an unrelated project by the legacy backfill.
    const result = await execute('id', { action: 'create', subject: 'loose' }, undefined, undefined);
    const task = (result.details as { task: { projectId: number | null } }).task;
    const inbox = store.listProjects().find((p) => p.name === 'inbox');
    assert.ok(inbox, 'the inbox project was created');
    assert.equal(task.projectId, inbox!.id);
  });

  it('rejects an empty project name on create without creating a project', async () => {
    await assert.rejects(
      execute('id', { action: 'create', subject: 'x', project: '   ' }, undefined, undefined),
      /project name must not be empty/,
    );
    assert.deepEqual(store.listProjects(), []);
    assert.equal(store.list().length, 0);
  });

  it('rejects an empty project name on update', async () => {
    const task = store.create({ subject: 'x' });
    await assert.rejects(
      execute('id', { action: 'update', id: task.id, project: '  ' }, undefined, undefined),
      /project name must not be empty/,
    );
  });

  it('lists tasks for a project named with surrounding whitespace', async () => {
    await execute('id', { action: 'create', subject: 'in name', project: 'name' }, undefined, undefined);
    await execute('id', { action: 'create', subject: 'other', project: 'other' }, undefined, undefined);
    const result = await execute('id', { action: 'list', project: '  name  ' }, undefined, undefined);
    const tasks = (result.details as { tasks: Array<{ subject: string }> }).tasks;
    assert.deepEqual(tasks.map((t) => t.subject), ['in name']);
  });
});
