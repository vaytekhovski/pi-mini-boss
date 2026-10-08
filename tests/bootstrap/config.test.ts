import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CONFIG_PATH,
  loadAgentConfig,
  needsOnboarding,
  saveAgentConfig,
  type AgentConfig,
} from '../../src/bootstrap/config.js';

describe('bootstrap config', () => {
  it('loads the shipped default template with core fields intact', () => {
    const config = loadAgentConfig(DEFAULT_CONFIG_PATH);
    assert.ok(config.role?.name, 'role.name is set');
    assert.ok(Array.isArray(config.base_behavior) && config.base_behavior.length > 0);
    assert.ok(
      config.base_behavior.some((rule) => rule.includes('устаревшие статусы')),
      'core keeps the realtime-status rule',
    );
    assert.deepEqual(config.workflow, ['plan', 'do', 'verify', 'close']);
    assert.ok(config.thinking?.level, 'thinking.level is set');
    // Memory and tasks ship inside the module, so nothing external is required.
    assert.deepEqual(config.required_extensions, []);
    assert.ok(
      (config.recommended_extensions ?? []).length > 0,
      'extension catalogue is not empty',
    );
  });

  it('needs onboarding when the user config is absent', () => {
    const missing = path.join(os.tmpdir(), `pmb-missing-${Date.now()}.yaml`);
    assert.equal(needsOnboarding(missing), true);
  });

  it('round-trips a saved config and clears onboarding', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-cfg-'));
    const file = path.join(dir, 'agent.yaml');
    try {
      const config: AgentConfig = {
        ...loadAgentConfig(DEFAULT_CONFIG_PATH),
        role: { name: 'senior dev', purpose: 'pi-mini-boss', language: 'ru' },
        onboarded: true,
      };
      saveAgentConfig(config, file);
      assert.equal(needsOnboarding(file), false);
      const loaded = loadAgentConfig(file);
      assert.equal(loaded.role.name, 'senior dev');
      assert.equal(loaded.onboarded, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
