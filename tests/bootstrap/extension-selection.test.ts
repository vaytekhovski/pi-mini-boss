import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncDeclaredPackages } from '../../src/bootstrap/extension-selection.js';

describe('bootstrap extension selection', () => {
  it('runs the CLI through the running node, not through PATH', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const ok = await syncDeclaredPackages(async (command, args) => {
      calls.push({ command, args });
    });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    // A shell where `pi` exists but `node` does not fails with
    // "exec: node: not found", so both halves come from the current process.
    assert.equal(calls[0].command, process.execPath);
    assert.equal(calls[0].args[0], process.argv[1]);
    assert.deepEqual(calls[0].args.slice(1), ['update', '--extensions']);
  });

  it('reports false when the update fails', async () => {
    const ok = await syncDeclaredPackages(async () => {
      throw new Error('boom');
    });
    assert.equal(ok, false);
  });
});
