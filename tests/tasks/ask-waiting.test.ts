import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  runQuestionnaire,
  setWaitingReporter,
  type AskResult,
} from '../../src/tasks/ask-tool.js';

function uiWithCustom(custom: () => Promise<AskResult | null>): ExtensionContext['ui'] {
  return { custom } as unknown as ExtensionContext['ui'];
}

describe('ask waiting signal', () => {
  const calls: boolean[] = [];
  afterEach(() => {
    setWaitingReporter(undefined);
    calls.length = 0;
  });

  it('sets waiting before the panel and clears it after a cancel', async () => {
    setWaitingReporter((waiting) => calls.push(waiting));
    const ui = uiWithCustom(async () => ({ answers: [], cancelled: true }));
    const result = await runQuestionnaire(ui, []);
    assert.equal(result?.cancelled, true);
    assert.deepEqual(calls, [true, false]);
  });

  it('clears waiting even when the panel throws', async () => {
    setWaitingReporter((waiting) => calls.push(waiting));
    const ui = uiWithCustom(async () => {
      throw new Error('ui exploded');
    });
    await assert.rejects(runQuestionnaire(ui, []), /ui exploded/);
    assert.deepEqual(calls, [true, false]);
  });

  it('reports waiting true then false on a successful answer', async () => {
    setWaitingReporter((waiting) => calls.push(waiting));
    const ui = uiWithCustom(async () => ({ answers: [{ header: 'Q', labels: ['a'] }], cancelled: false }));
    const result = await runQuestionnaire(ui, []);
    assert.equal(result?.cancelled, false);
    assert.deepEqual(calls, [true, false]);
  });

  it('keeps the panel alive when the waiting reporter throws', async () => {
    setWaitingReporter(() => {
      throw new Error('reporter exploded');
    });
    const ui = uiWithCustom(async () => ({ answers: [{ header: 'Q', labels: ['a'] }], cancelled: false }));
    const result = await runQuestionnaire(ui, []);
    assert.equal(result?.cancelled, false);
  });

  it('forwards the cwd to the waiting reporter', async () => {
    const seen: Array<string | undefined> = [];
    setWaitingReporter((_waiting, cwd) => seen.push(cwd));
    const ui = uiWithCustom(async () => ({ answers: [], cancelled: true }));
    await runQuestionnaire(ui, [], undefined, undefined, 'X:/proj');
    assert.deepEqual(seen, ['X:/proj', 'X:/proj']);
  });
});
