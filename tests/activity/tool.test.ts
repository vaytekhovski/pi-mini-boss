import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ActivityStore } from '../../src/activity/store.js';
import { registerBossTool } from '../../src/activity/tool.js';

interface ToolDef {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx?: { cwd?: string },
  ) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

function setup(): { store: ActivityStore; execute: ToolDef['execute'] } {
  const store = new ActivityStore(':memory:');
  const defs: ToolDef[] = [];
  const pi = { registerTool: (d: ToolDef) => defs.push(d) } as unknown as Parameters<
    typeof registerBossTool
  >[0];
  registerBossTool(pi, () => store, 'projects-memory');
  return { store, execute: defs[0].execute };
}

describe('boss tool projects', () => {
  let store: ActivityStore;
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

  it('records activity for the project detected from ctx.cwd', async () => {
    const cwd = mkTmpdir();
    await execute('id', { action: 'activity', detail: 'пишу' }, undefined, undefined, { cwd });
    const agent = store.listAgents()[0];
    assert.equal(agent.project, path.basename(cwd));
    assert.equal(agent.detail, 'пишу');
  });

  it('records under the empty project when no cwd is given', async () => {
    await execute('id', { action: 'activity', detail: 'пишу' }, undefined, undefined);
    assert.equal(store.listAgents()[0].project, '');
  });

  it('toggles the waiting signal through the boss tool', async () => {
    const cwd = mkTmpdir();
    const project = path.basename(cwd);
    await execute('id', { action: 'activity', detail: 'анализ' }, undefined, undefined, { cwd });

    const on = await execute('id', { waiting: true }, undefined, undefined, { cwd });
    assert.equal((on.details as { run: { status: string } }).run.status, 'waiting');
    const waiting = store.listAgents().find((r) => r.project === project);
    assert.equal(waiting?.status, 'waiting');
    assert.equal(waiting?.detail, 'анализ');

    await execute('id', { waiting: false }, undefined, undefined, { cwd });
    const resumed = store.listAgents().find((r) => r.project === project);
    assert.equal(resumed?.status, 'running');
    assert.equal(resumed?.detail, 'анализ');
  });

  it('rejects a call with neither action nor waiting', async () => {
    await assert.rejects(execute('id', {}, undefined, undefined), /requires an `action` or `waiting`/);
  });
});
