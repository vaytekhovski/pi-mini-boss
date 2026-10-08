import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain .mjs module, no type declarations
import { renderBoard } from '../../bin/pi-mini-boss-board.mjs';

const strip = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, '');

describe('board render', () => {
  it('renders counts and groups tasks by status', () => {
    const out = strip(
      renderBoard(
        {
          tasks: [
            { id: 1, subject: 'alpha', status: 'in_progress', active_form: 'doing alpha', priority: 'normal' },
            { id: 2, subject: 'beta', status: 'completed', active_form: '', priority: 'high' },
          ],
          counts: { total: 2, pending: 0, in_progress: 1, completed: 1, blocked: 0 },
        },
        60,
      ),
    );
    assert.match(out, /1\/2 done/);
    assert.match(out, /1 active/);
    assert.match(out, /in progress \(1\)/);
    assert.match(out, /#1 alpha doing alpha/);
    assert.match(out, /completed \(1\)/);
    assert.match(out, /#2 beta/);
  });

  it('shows an empty placeholder for statuses without tasks', () => {
    const out = strip(
      renderBoard({ tasks: [], counts: { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 } }, 60),
    );
    assert.match(out, /0\/0 done/);
    assert.match(out, /pending \(0\)/);
    assert.match(out, /—/);
  });
});
