import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractTaskLinkIds,
  normalizeTaskId,
  renderTaskBodyHtml,
  splitTaskLinks,
} from './task-links.ts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

test('normalizeTaskId canonicalizes T casing', () => {
  assert.equal(normalizeTaskId('t-0001'), 'T-0001');
  assert.equal(normalizeTaskId('T-12'), 'T-12');
});

test('extractTaskLinkIds parses soft @{T-xxxx} only', () => {
  const body = 'See @{T-0001} and @{T-0002}; also @{T-0001} again. Not blocked_by.';
  assert.deepEqual(extractTaskLinkIds(body), ['T-0001', 'T-0002']);
});

test('extractTaskLinkIds ignores malformed', () => {
  assert.deepEqual(extractTaskLinkIds('@{T-} @{task} @T-0001 {T-0001}'), []);
});

test('splitTaskLinks keeps surrounding text', () => {
  const segs = splitTaskLinks('before @{T-0009} after');
  assert.deepEqual(segs, [
    { kind: 'text', text: 'before ' },
    { kind: 'link', id: 'T-0009', raw: '@{T-0009}' },
    { kind: 'text', text: ' after' },
  ]);
});

test('renderTaskBodyHtml: known clickable, unknown muted', () => {
  const known = new Set(['T-0001']);
  const html = renderTaskBodyHtml('go @{T-0001} / @{T-9999}', known, esc);
  assert.match(html, /data-select-task="T-0001"/);
  assert.match(html, /class="task-link"/);
  assert.match(html, /class="task-link is-unknown"/);
  assert.doesNotMatch(html, /data-select-task="T-9999"/);
  assert.match(html, /@\{T-0001\}/);
  assert.match(html, /@\{T-9999\}/);
});

test('renderTaskBodyHtml escapes HTML in plain text', () => {
  const html = renderTaskBodyHtml('<script>x</script> @{T-0001}', new Set(['T-0001']), esc);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
