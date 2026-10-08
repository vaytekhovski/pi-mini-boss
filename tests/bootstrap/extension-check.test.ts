import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentConfig } from '../../src/bootstrap/config.js';
import { checkExtensions } from '../../src/bootstrap/extension-check.js';

const baseConfig: AgentConfig = {
  role: { name: 'a', purpose: 'b', language: 'ru' },
  base_behavior: [],
  required_extensions: ['memory', 'todo'],
  recommended_extensions: [{ name: 'ponytail', why: 'x' }],
  workflow: [],
  thinking: { level: 'low', hide: true },
};

function withSettings(packages: string[], fn: (settingsPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-ext-'));
  const settingsPath = path.join(dir, 'settings.json');
  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ packages }));
    fn(settingsPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('bootstrap extension check', () => {
  it('matches short names against package sources and reports the rest', () => {
    withSettings(['npm:pi-hermes-memory'], (settingsPath) => {
      const result = checkExtensions(baseConfig, settingsPath);
      assert.deepEqual(result.missingRequired, ['todo']);
      assert.deepEqual(result.missingRecommended.map((ext) => ext.name), ['ponytail']);
    });
  });

  it('reports nothing missing when everything is installed', () => {
    withSettings(['npm:pi-hermes-memory', 'npm:@juicesharp/rpiv-todo', 'npm:@dietrichgebert/ponytail'], (settingsPath) => {
      const result = checkExtensions(baseConfig, settingsPath);
      assert.deepEqual(result.missingRequired, []);
      assert.deepEqual(result.missingRecommended, []);
    });
  });

  it('treats an unreadable settings file as nothing installed', () => {
    const result = checkExtensions(baseConfig, path.join(os.tmpdir(), `pmb-none-${Date.now()}.json`));
    assert.deepEqual(result.missingRequired, ['memory', 'todo']);
  });
});
