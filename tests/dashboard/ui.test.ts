import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboardHtml } from '../../src/dashboard/ui.js';

/** Body of the `:root { ... }` block that opens the stylesheet (parchment). */
function rootBlock(html: string): string {
  const start = html.indexOf(':root {');
  assert.ok(start !== -1, 'the default :root palette exists');
  return html.slice(start, html.indexOf('}', start));
}

/** Body of the `:root[data-theme="dark"] { ... }` block. */
function darkBlock(html: string): string {
  const start = html.indexOf(':root[data-theme="dark"]');
  assert.ok(start !== -1, 'a dark theme selector exists');
  return html.slice(start, html.indexOf('}', start));
}

function cssVar(block: string, name: string): string | null {
  const match = block.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  return match ? match[1].trim() : null;
}

/** Source between the `<script>` and `</script>` whose body contains `needle`. */
function inlineScript(html: string, needle: string): string {
  const at = html.indexOf(needle);
  assert.ok(at !== -1, `the inline script containing ${needle} exists`);
  const start = html.lastIndexOf('<script>', at);
  const end = html.indexOf('</script>', at);
  assert.ok(start !== -1 && end !== -1, 'the inline script has both tags');
  return html.slice(start + '<script>'.length, end);
}

/** Verbatim source of a `function name(...) { ... }` declaration, braces balanced. */
function functionSource(html: string, name: string): string {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `function ${name} is defined`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('dashboard ui', () => {
  const html = renderDashboardHtml();

  it('applies the theme before the boards container and the modal', () => {
    const script = html.indexOf('pi-mini-boss.dashboard.v1.theme');
    const boards = html.indexOf('id="boards"');
    const modal = html.indexOf('id="modal"');
    assert.ok(script !== -1, 'the inline theme script is inlined');
    assert.ok(script < boards, 'the theme script runs before the boards container');
    assert.ok(script < modal, 'the theme script runs before the task modal');
    assert.match(html, /document\.documentElement\.dataset\.theme\s*=/);
  });

  it('defaults to parchment and persists the choice under the shared key', () => {
    assert.match(html, /var theme = "parchment"/, 'the default theme is parchment');
    assert.match(html, /localStorage\.getItem\("pi-mini-boss\.dashboard\.v1\.theme"\)/);
    assert.match(html, /readLS\("theme", "parchment"\)/);
    assert.match(html, /writeLS\("theme", next\)/);
  });

  it('declares both palettes with different backgrounds', () => {
    const light = rootBlock(html);
    const dark = darkBlock(html);
    assert.equal(cssVar(light, 'bg'), '#f2e8d5');
    assert.equal(cssVar(dark, 'bg'), '#1b1b1b');
    assert.notEqual(cssVar(light, 'bg'), cssVar(dark, 'bg'));
    assert.equal(cssVar(dark, 'ink'), '#e7e7e7');
    assert.match(html, /:root\s*\{\s*color-scheme:\s*light/);
    assert.match(dark, /color-scheme:\s*dark/);
  });

  it('keeps the board scroll inside the project block', () => {
    assert.match(html, /\.boards\s*\{[^}]*overflow-x:\s*auto/);
    assert.match(html, /\.board-wrap\s*\{[^}]*max-height:/);
    assert.match(html, /\.board-head\s*\{[^}]*flex:\s*0 0 auto/);
    assert.match(html, /\.board-body\s*\{[^}]*overflow:\s*auto/);
    assert.match(html, /\.board-wrap\s*\{[^}]*calc\(\(100vw - 318px\) \/ 2\)/);
    assert.match(html, /\.board\s*\{[^}]*min-width:\s*0/);
  });

  it('renders a theme toggle button in the header', () => {
    assert.match(html, /<header>[\s\S]*id="theme-btn"[\s\S]*<\/header>/);
    assert.match(html, /id="theme-btn"[^>]*aria-label="[^"]+"/);
    assert.match(html, /id="theme-btn"[^>]*aria-pressed="false"/);
  });

  it('has no dark-blue legacy palette left', () => {
    for (const hex of ['#0e1116', '#131926', '#1e2733', '#0f141c']) {
      assert.ok(!html.includes(hex), `legacy colour ${hex} is gone`);
    }
  });

  it('renders the global waiting indicator and per-project activity grouping', () => {
    assert.match(html, /id="waiting"/);
    assert.match(html, /function activityPanel\(\)/);
    assert.match(html, /act-group-head/);
  });

  it('runs the inline theme script: default, stored dark, garbage falls back', () => {
    const src = inlineScript(html, 'pi-mini-boss.dashboard.v1.theme');
    const key = 'pi-mini-boss.dashboard.v1.theme';
    const run = (stored?: string): string | undefined => {
      const store: Record<string, string> = {};
      if (stored !== undefined) store[key] = stored;
      const document = { documentElement: { dataset: {} as Record<string, string> } };
      const localStorage = {
        getItem: (k: string): string | null => store[k] ?? null,
        setItem: (k: string, v: string): void => { store[k] = String(v); },
      };
      new Function('document', 'localStorage', src)(document, localStorage);
      return document.documentElement.dataset.theme;
    };
    assert.equal(run(), 'parchment', 'no stored value defaults to parchment');
    assert.equal(run('"dark"'), 'dark', 'a stored dark theme is applied');
    assert.equal(run('nonsense'), 'parchment', 'garbage falls back to parchment');
  });

  it('escapes HTML-significant characters in the inline esc()', () => {
    const esc = new Function(functionSource(html, 'esc') + '\nreturn esc;')();
    assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(esc('"'), '&quot;');
    assert.equal(esc("'"), '&#39;');
    assert.equal(esc('&'), '&amp;');
    assert.equal(esc('обычный текст 123'), 'обычный текст 123');
  });

  it('keeps --muted at WCAG AA contrast on both light surfaces', () => {
    const light = rootBlock(html);
    const muted = cssVar(light, 'muted');
    const panel = cssVar(light, 'panel');
    const bg = cssVar(light, 'bg');
    assert.ok(muted && panel && bg, 'the light palette defines muted, panel and bg');
    const onPanel = contrast(muted, panel);
    const onBg = contrast(muted, bg);
    assert.ok(onPanel >= 4.5, `--muted on --panel is ${onPanel.toFixed(2)} (needs >= 4.5)`);
    assert.ok(onBg >= 4.5, `--muted on --bg is ${onBg.toFixed(2)} (needs >= 4.5)`);
  });
});
