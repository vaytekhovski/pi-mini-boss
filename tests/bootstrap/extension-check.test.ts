import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentConfig } from '../../src/bootstrap/config.js';
import {
  checkExtensions,
  deactivateExtensionNames,
  installExtensionNames,
  installSelectedExtensions,
} from '../../src/bootstrap/extension-check.js';

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

  it('declares selected extensions in settings and keeps existing packages', () => {
    withSettings(['npm:pi-hermes-memory'], (settingsPath) => {
      assert.deepEqual(installSelectedExtensions(baseConfig, settingsPath), ['npm:ponytail']);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { packages: string[] };
      assert.deepEqual(settings.packages, ['npm:pi-hermes-memory', 'npm:ponytail']);
      // Idempotent: a second session adds nothing.
      assert.deepEqual(installSelectedExtensions(baseConfig, settingsPath), []);
    });
  });

  it('leaves options marked as optional alone', () => {
    const config: AgentConfig = {
      ...baseConfig,
      recommended_extensions: [
        { name: 'ponytail', why: 'x' },
        { name: 'pi-lens', why: 'y', selected: false },
      ],
    };
    withSettings([], (settingsPath) => {
      assert.deepEqual(installSelectedExtensions(config, settingsPath), ['npm:ponytail']);
    });
  });

  it('creates the settings file when there is none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-fresh-'));
    const settingsPath = path.join(dir, 'nested', 'settings.json');
    try {
      assert.deepEqual(installSelectedExtensions(baseConfig, settingsPath), ['npm:ponytail']);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { packages: string[] };
      assert.deepEqual(settings.packages, ['npm:ponytail']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('never rewrites a settings file it cannot parse', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-broken-'));
    const settingsPath = path.join(dir, 'settings.json');
    try {
      fs.writeFileSync(settingsPath, '{ not json');
      assert.deepEqual(installSelectedExtensions(baseConfig, settingsPath), []);
      assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ not json');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('declares a name list and skips the ones already there', () => {
    withSettings(['npm:ponytail'], (settingsPath) => {
      assert.deepEqual(installExtensionNames(['ponytail', 'pi-lens'], settingsPath), ['npm:pi-lens']);
    });
  });

  it('switches an extension off by dropping its declaration', () => {
    withSettings(['npm:pi-hermes-memory', 'npm:ponytail', 'npm:@scope/other'], (settingsPath) => {
      assert.deepEqual(deactivateExtensionNames(['ponytail'], settingsPath), ['npm:ponytail']);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { packages: string[] };
      assert.deepEqual(settings.packages, ['npm:pi-hermes-memory', 'npm:@scope/other']);
    });
  });

  it('drops a pinned declaration but leaves lookalikes alone', () => {
    withSettings(['npm:pi-lens@1.2.3', 'npm:my-pi-lens-fork'], (settingsPath) => {
      assert.deepEqual(deactivateExtensionNames(['pi-lens'], settingsPath), ['npm:pi-lens@1.2.3']);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { packages: string[] };
      assert.deepEqual(settings.packages, ['npm:my-pi-lens-fork']);
    });
  });
});
