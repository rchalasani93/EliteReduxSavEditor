const {test} = require('node:test');
const assert = require('node:assert/strict');
const {escape, pngSource} = require('../src/html.js');

test('catalog text and attribute payloads are encoded without reinterpreting entities', () => {
  assert.equal(escape('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escape('\' autofocus onfocus="alert(1)" x="'), '&#39; autofocus onfocus=&quot;alert(1)&quot; x=&quot;');
  assert.equal(escape('&lt;script&gt; & " \' >'), '&amp;lt;script&amp;gt; &amp; &quot; &#39; &gt;');
  assert.equal(escape(150), '150');
});

test('sprite sources accept only bounded embedded PNG data', () => {
  assert.equal(pngSource('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
  for (const source of [
    'https://example.com/tracker.png', 'javascript:alert(1)',
    'data:image/svg+xml,<svg onload="alert(1)"></svg>',
    'data:image/png;base64,aGVsbG8=" onerror="alert(1)',
    'data:image/png;base64,aGVsbG8=\n', null, {},
    'data:image/png;base64,' + 'A'.repeat(2_000_000)
  ]) assert.equal(pngSource(source), '');
});
