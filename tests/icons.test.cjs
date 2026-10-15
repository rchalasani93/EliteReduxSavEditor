const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {bundleSprites, downloadSprite, validateSprite, MAX_PNG_BYTES} = require('../scripts/icons.cjs');
const manifest = require('../scripts/sprite-hashes.json');
const icons = require('../src/icons.json');
const species = {key: 'SPECIES_MEWTWO'};
const png = Buffer.from(icons.images[species.key].split(',')[1], 'base64');
const response = bytes => new Response(bytes, {headers: {'content-type': 'image/png'}});

function temporaryOutput(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redux-icons-test-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return path.join(directory, 'icons.json');
}

test('sprite bytes must have a PNG signature and the pinned SHA-256 digest', () => {
  assert.equal(validateSprite(png, manifest.sha256[species.key], 'MEWTWO'), icons.images[species.key]);
  const modified = Buffer.from(png); modified[modified.length - 1] ^= 1;
  assert.throws(() => validateSprite(modified, manifest.sha256[species.key], 'MEWTWO'), /integrity/);
  assert.throws(() => validateSprite(Buffer.from('<script>bad</script>'), manifest.sha256[species.key], 'MEWTWO'), /Invalid PNG/);
});

test('sprite requests use the pinned source, reject redirects, and have a deadline', async () => {
  const image = await downloadSprite(species, {fetchImpl: async (url, options) => {
    assert.equal(url, `https://raw.githubusercontent.com/ForwardFeed/ER-nextdex/${manifest.revision}/static/sprites/MEWTWO.png`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response(png);
  }});
  assert.equal(image, icons.images[species.key]);
});

test('invalid names and missing hashes fail before making a request', async () => {
  const fetchImpl = async () => { assert.fail('Unexpected network request'); };
  for (const key of ['../MEWTWO', 'SPECIES_../../MEWTWO', 'SPECIES_MEWTWO\n']) {
    await assert.rejects(downloadSprite({key}, {fetchImpl}), /Invalid sprite name/);
  }
  await assert.rejects(downloadSprite({key: 'SPECIES_UNKNOWN'}, {fetchImpl}), /Missing trusted sprite hash/);
});

test('unexpected MIME types and oversized bodies are rejected', async () => {
  await assert.rejects(downloadSprite(species, {fetchImpl: async () => new Response(png, {headers: {'content-type': 'text/html'}})}), /Invalid PNG response/);
  await assert.rejects(downloadSprite(species, {fetchImpl: async () => new Response(png, {headers: {'content-type': 'image/png', 'content-length': String(MAX_PNG_BYTES + 1)}})}), /Invalid PNG response/);
  await assert.rejects(downloadSprite(species, {fetchImpl: async () => response(Buffer.alloc(MAX_PNG_BYTES + 1))}), /too large/);
});

test('transient failures retry but missing sprites fail immediately', async () => {
  let attempts = 0;
  await downloadSprite(species, {retryDelay: 0, fetchImpl: async () => ++attempts === 1 ? new Response(null, {status: 503}) : response(png)});
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(downloadSprite(species, {retryDelay: 0, fetchImpl: async () => {
    attempts++; return new Response(null, {status: 404});
  }}), /HTTP 404/);
  assert.equal(attempts, 1);
});

test('a modified download leaves the existing icon catalog untouched', async t => {
  const output = temporaryOutput(t);
  fs.writeFileSync(output, 'original catalog');
  const modified = Buffer.from(png); modified[modified.length - 1] ^= 1;
  await assert.rejects(bundleSprites({species: [species], output, fetchImpl: async () => response(modified)}), /integrity/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'original catalog');
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['icons.json']);
});

test('all pinned sprites regenerate the existing catalog byte for byte', async t => {
  const output = temporaryOutput(t);
  fs.writeFileSync(output, 'old catalog');
  const count = await bundleSprites({output, fetchImpl: async url => {
    const key = 'SPECIES_' + path.posix.basename(new URL(url).pathname, '.png');
    assert.ok(icons.images[key], key);
    return response(Buffer.from(icons.images[key].split(',')[1], 'base64'));
  }});
  assert.equal(count, 1922);
  assert.equal(fs.readFileSync(output, 'utf8'), fs.readFileSync(path.join(__dirname, '../src/icons.json'), 'utf8'));
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['icons.json']);
});
