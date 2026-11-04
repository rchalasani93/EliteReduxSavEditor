const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  zlib = require('node:zlib');
const png = require('../scripts/png.cjs');
const icons = require('../src/icons.json').images;
const bytes = key => Buffer.from(icons[key].split(',')[1], 'base64');

// A minimal 8-bit RGBA PNG for synthetic images.
function rgbaPng(width, height, pixel) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      raw.writeUInt32BE(pixel(x, y) >>> 0, y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('every bundled sprite re-encodes to identical pixels and a smaller file', () => {
  let before = 0,
    after = 0;
  for (const key of Object.keys(icons)) {
    const original = bytes(key),
      compact = png.compact(original);
    const a = png.decode(original),
      b = png.decode(compact);
    assert.equal(b.width, a.width, key);
    assert.equal(b.height, a.height, key);
    assert.ok(a.rgba.equals(b.rgba), `${key} pixels changed`);
    before += original.length;
    after += compact.length;
  }
  assert.ok(after < before * 0.4, `sprites only shrank to ${Math.round((after / before) * 100)}%`);
});

test('palette depth follows the colour count, and translucent colours keep their alpha', () => {
  const two = rgbaPng(64, 64, (x, y) => ((x ^ y) % 3 ? 0xff000080 : 0x00000000));
  const compact = png.compact(two);
  assert.equal(compact[24], 1, 'two colours fit in 1 bit per pixel');
  assert.equal(compact[25], 3, 'indexed colour');
  assert.ok(png.decode(two).rgba.equals(png.decode(compact).rgba));
  const sixteen = rgbaPng(64, 64, (x, y) => (((x + y) % 16) * 0x10101000) | 0xff);
  assert.equal(png.compact(sixteen)[24], 4);
});

test('images with more than 256 colours are left as they are', () => {
  const many = rgbaPng(32, 32, (x, y) => ((x * 32 + y) << 8) | 0xff);
  assert.equal(png.compact(many), many);
});

test('malformed PNG data is rejected', () => {
  assert.throws(() => png.decode(Buffer.from('<svg onload="alert(1)">')), /Not a PNG/);
  const truncated = bytes('SPECIES_MEWTWO').subarray(0, 40);
  assert.throws(() => png.decode(truncated));
  const huge = rgbaPng(1, 1, () => 0);
  huge.writeUInt32BE(5000, 16); // claims a 5000-pixel width
  assert.throws(() => png.decode(huge), /size not supported/);
});
