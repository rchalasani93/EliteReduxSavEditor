// Lossless PNG re-encoding for the bundled sprites.
//
// The sprites arrive as 8-bit RGBA PNGs but use only a few dozen colours, so storing them as
// indexed (palette) PNGs with the smallest bit depth that fits makes them about a third of the
// size with identical pixels. decode() reads the PNGs this project produces or downloads
// (8-bit RGBA/RGB/greyscale and indexed, non-interlaced), so tests can compare pixels exactly.
'use strict';
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_SIDE = 1024;

function chunks(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE))
    throw new Error('Not a PNG.');
  const out = [];
  for (let o = 8; o + 12 <= png.length;) {
    const length = png.readUInt32BE(o);
    const type = png.toString('latin1', o + 4, o + 8);
    if (o + 12 + length > png.length) throw new Error('Truncated PNG chunk.');
    out.push({ type, data: png.subarray(o + 8, o + 8 + length) });
    o += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Reverse the per-row filters. bpp is bytes per pixel (at least 1), stride bytes per row.
function unfilter(raw, height, stride, bpp) {
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)],
      src = y * (stride + 1) + 1,
      dst = y * stride;
    if (type > 4) throw new Error('Bad PNG filter.');
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0,
        b = y ? out[dst - stride + x] : 0,
        c = y && x >= bpp ? out[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      out[dst + x] =
        (type === 0
          ? v
          : type === 1
            ? v + a
            : type === 2
              ? v + b
              : type === 3
                ? v + ((a + b) >> 1)
                : v + paeth(a, b, c)) & 255;
    }
  }
  return out;
}

// Pixels as RGBA bytes: { width, height, rgba }.
function decode(png) {
  const list = chunks(png);
  const ihdr = list.find(c => c.type === 'IHDR')?.data;
  if (!ihdr || ihdr.length !== 13) throw new Error('PNG has no header.');
  const width = ihdr.readUInt32BE(0),
    height = ihdr.readUInt32BE(4),
    depth = ihdr[8],
    colour = ihdr[9],
    interlace = ihdr[12];
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE)
    throw new Error('PNG size not supported.');
  if (interlace) throw new Error('Interlaced PNGs are not supported.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels || (colour !== 3 && depth !== 8) || (colour === 3 && ![1, 2, 4, 8].includes(depth)))
    throw new Error('PNG format not supported.');
  const bitsPerPixel = channels * depth,
    stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = zlib.inflateSync(
    Buffer.concat(list.filter(c => c.type === 'IDAT').map(c => c.data)),
    {
      maxOutputLength: height * (stride + 1),
    },
  );
  if (raw.length !== height * (stride + 1)) throw new Error('PNG image data has the wrong size.');
  const rows = unfilter(raw, height, stride, Math.max(1, bitsPerPixel >> 3));
  const rgba = Buffer.alloc(width * height * 4);
  const plte = list.find(c => c.type === 'PLTE')?.data,
    trns = list.find(c => c.type === 'tRNS')?.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4,
        r = y * stride;
      if (colour === 3) {
        const bit = x * depth,
          index = (rows[r + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        if (!plte || index * 3 + 2 >= plte.length)
          throw new Error('PNG palette index out of range.');
        rgba[o] = plte[index * 3];
        rgba[o + 1] = plte[index * 3 + 1];
        rgba[o + 2] = plte[index * 3 + 2];
        rgba[o + 3] = trns && index < trns.length ? trns[index] : 255;
      } else {
        const p = r + x * channels,
          grey = colour === 0 || colour === 4;
        rgba[o] = rows[p];
        rgba[o + 1] = grey ? rows[p] : rows[p + 1];
        rgba[o + 2] = grey ? rows[p] : rows[p + 2];
        rgba[o + 3] = colour === 6 ? rows[p + 3] : colour === 4 ? rows[p + 1] : 255;
      }
    }
  return { width, height, rgba };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
}

// Re-encode as an indexed PNG when the image has at most 256 colours (alpha included);
// otherwise return the input unchanged. Fully transparent pixels keep their exact RGB values.
function compact(png) {
  const { width, height, rgba } = decode(png);
  const colours = new Map();
  for (let o = 0; o < rgba.length; o += 4) {
    const key = rgba.readUInt32BE(o);
    if (!colours.has(key)) {
      if (colours.size === 256) return png;
      colours.set(key, colours.size);
    }
  }
  // Translucent colours first, so the transparency chunk can stop at the last of them.
  const palette = [...colours.keys()].sort((a, b) => (a & 255) - (b & 255) || a - b);
  const index = new Map(palette.map((key, i) => [key, i]));
  const depth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;
  const stride = Math.ceil((width * depth) / 8);
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = index.get(rgba.readUInt32BE((y * width + x) * 4)),
        bit = x * depth;
      rows[y * stride + (bit >> 3)] |= i << (8 - depth - (bit & 7));
    }
  // Indexed images usually compress best unfiltered; try the "up" filter too and keep the smaller.
  const filtered = type => {
    const out = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      out[y * (stride + 1)] = type;
      for (let x = 0; x < stride; x++) {
        const v = rows[y * stride + x],
          up = type === 2 && y ? rows[(y - 1) * stride + x] : 0;
        out[y * (stride + 1) + 1 + x] = (v - up) & 255;
      }
    }
    return zlib.deflateSync(out, { level: 9, memLevel: 9 });
  };
  const idat = [filtered(0), filtered(2)].sort((a, b) => a.length - b.length)[0];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((key, i) => {
    plte[i * 3] = key >>> 24;
    plte[i * 3 + 1] = (key >>> 16) & 255;
    plte[i * 3 + 2] = (key >>> 8) & 255;
  });
  const translucent = palette.filter(key => (key & 255) !== 255).length;
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (translucent)
    parts.push(chunk('tRNS', Buffer.from(palette.slice(0, translucent).map(key => key & 255))));
  parts.push(chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)));
  const out = Buffer.concat(parts);
  return out.length < png.length ? out : png;
}

module.exports = { decode, compact };
