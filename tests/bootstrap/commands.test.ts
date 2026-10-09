import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG_PATH, loadAgentConfig, type AgentConfig } from '../../src/bootstrap/config.js';
import {
  buildInfoText,
  languageFromAnswers,
  profileFromAnswers,
} from '../../src/bootstrap/index.js';

const answers = (...labels: string[][]) =>
  labels.map((l, i) => ({ header: `q${i}`, labels: l }));

describe('bootstrap profile commands', () => {
  it('reads the language from the single-tab answers', () => {
    assert.deepEqual(languageFromAnswers(answers(['en'])), { language: 'en' });
    assert.deepEqual(languageFromAnswers(answers(['ru'])), { language: 'ru' });
    // A cancelled/missing answer must not write a bogus language.
    assert.deepEqual(languageFromAnswers([]), { language: 'ru' });
  });

  it('maps the profile tabs to role name and purpose', () => {
    assert.deepEqual(
      profileFromAnswers(answers(['backend'], ['web-saas'])),
      { name: 'backend', purpose: 'web-saas' },
    );
  });

  it('leaves a field untouched when its tab has no label', () => {
    assert.deepEqual(profileFromAnswers(answers(['backend'], [])), { name: 'backend' });
    assert.deepEqual(profileFromAnswers(answers([], ['web-saas'])), { purpose: 'web-saas' });
  });
});

describe('buildInfoText', () => {
  it('reports the config, the chosen extensions and the assigned commands', () => {
    const config: AgentConfig = {
      ...loadAgentConfig(DEFAULT_CONFIG_PATH),
      role: { name: 'backend', purpose: 'web-saas', language: 'ru' },
      recommended_extensions: [
        { name: 'ponytail', why: 'lazy mode' },
        { name: 'skipped', why: 'off', selected: false },
      ],
      onboarded: true,
    };
    const text = buildInfoText(config, '9.9.9');
    assert.match(text, /pi-mini-boss 9\.9\.9/);
    assert.match(text, /Роль: backend/);
    assert.match(text, /Назначение: web-saas/);
    assert.match(text, /Онбординг: пройден/);
    assert.match(text, /Расширения: 1 выбрано/);
    assert.match(text, /ponytail/);
    assert.doesNotMatch(text, /skipped/);
    assert.match(text, /\/language/);
    assert.match(text, /\/mini-boss/);
  });

  it('tells the user to onboard and speaks English when configured so', () => {
    const config: AgentConfig = {
      ...loadAgentConfig(DEFAULT_CONFIG_PATH),
      role: { name: 'backend', purpose: 'api', language: 'en' },
      onboarded: false,
    };
    const text = buildInfoText(config, '0.1.0');
    assert.match(text, /Role: backend/);
    assert.match(text, /Onboarding: not done — run \/onboard/);
  });
});
