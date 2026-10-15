const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const catalog = require('../src/catalog.json');
const trustedSprites = require('./sprite-hashes.json');
const MAX_PNG_BYTES = 1_000_000;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function validateSprite(bytes, expectedHash, name) {
  if (bytes.length > MAX_PNG_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Invalid PNG: ${name}`);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw new Error(`Sprite integrity check failed: ${name}`);
  }
  return 'data:image/png;base64,' + bytes.toString('base64');
}

async function downloadSprite(species, {fetchImpl = fetch, manifest = trustedSprites, retryDelay = 500} = {}) {
  const match = /^SPECIES_([A-Z0-9_]+)$/.exec(species.key);
  if (!match || match[0] !== species.key) throw new Error('Invalid sprite name.');
  const name = match[1], expectedHash = manifest.sha256[species.key];
  if (typeof manifest.revision !== 'string' || manifest.revision.length !== 40 ||
      !/^[a-f0-9]{40}$/.test(manifest.revision) || typeof expectedHash !== 'string' ||
      expectedHash.length !== 64 || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(`Missing trusted sprite hash: ${name}`);
  }
  const url = `https://raw.githubusercontent.com/ForwardFeed/ER-nextdex/${manifest.revision}/static/sprites/${name}.png`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(15_000)});
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (attempt === 2 || (response.status !== 429 && response.status < 500)) {
        throw new Error(`Sprite ${name}: HTTP ${response.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      continue;
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.body || !['image/png', 'application/octet-stream'].includes(contentType) ||
        Number(response.headers.get('content-length')) > MAX_PNG_BYTES) {
      await response.body?.cancel();
      throw new Error(`Invalid PNG response: ${name}`);
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_PNG_BYTES) throw new Error(`PNG is too large: ${name}`);
      chunks.push(chunk);
    }
    return validateSprite(Buffer.concat(chunks), expectedHash, name);
  }
}

async function bundleSprites({species = Object.values(catalog.species), output = path.resolve(__dirname, '../src/icons.json'), ...options} = {}) {
  const queue = [...species], images = {}, manifest = options.manifest || trustedSprites;
  async function download() {
    for (;;) {
      const entry = queue.pop();
      if (!entry) return;
      images[entry.key] = await downloadSprite(entry, options);
    }
  }
  // Keep network bytes in memory; only verified, serialized image data reaches disk.
  await Promise.all(Array.from({length: 12}, download));
  const sorted = Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b)));
  const data = JSON.stringify({source: `https://github.com/ForwardFeed/ER-nextdex/tree/${manifest.revision}/static/sprites`, images: sorted});
  const destination = path.resolve(output);
  const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(destination), '.sprites-'));
  const temporaryFile = path.join(temporaryDirectory, 'icons.json');
  try {
    const descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, data); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporaryFile, destination);
  } finally {
    fs.rmSync(temporaryFile, {force: true});
    fs.rmdirSync(temporaryDirectory);
  }
  return Object.keys(images).length;
}

if (require.main === module) {
  bundleSprites().then(count => console.log(`Bundled ${count} Pokémon sprites for offline use.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {bundleSprites, downloadSprite, validateSprite, MAX_PNG_BYTES};
