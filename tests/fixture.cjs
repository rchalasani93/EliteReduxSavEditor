const core = require('../src/core.js');
function fixture() {
  const bytes = new Uint8Array(131072).fill(255),
    view = new DataView(bytes.buffer);
  const addresses = new Map();
  for (let i = 0; i < 20; i++) {
    const sid = (i + 16) % 20,
      off = i * 4096;
    bytes.fill(0, off, off + 4084);
    view.setUint16(off + 4084, sid, true);
    view.setUint32(off + 4088, core.SIGNATURE, true);
    view.setUint32(off + 4092, 4, true);
    addresses.set(sid, off);
  }
  const write = (logical, data) =>
    data.forEach(
      (n, i) =>
        (bytes[addresses.get(Math.floor((logical + i) / 4084)) + ((logical + i) % 4084)] = n),
    );
  write(0, core.encode('Tester', 8));
  write(0xc88, [3, 7, 0x38, 0x2f, 6, 0x1e]);
  write(2 * 4084 + 0x234, [1]);
  const m = new Uint8Array(76),
    v = new DataView(m.buffer);
  v.setUint32(0, 0x121ec839, true);
  v.setUint32(4, 12345678, true);
  v.setUint32(8, (10000 << 11) | 85, true);
  v.setUint32(12, 326 | (53 << 11) | (200 << 22), true);
  v.setUint32(16, 150 | (396 << 16) | (14 << 27), true);
  v.setUint32(20, (15 << 10) | (2 << 16) | (20 << 19), true);
  m.set(core.encode('Tester', 7), 31);
  m.set(core.encode('Mewtwo', 12), 38);
  m[50] = 4;
  m.set([24, 24, 24, 32], 52);
  m[60] = 20;
  m[61] = 255;
  [62, 64, 66, 68, 70, 72, 74].forEach((o, i) =>
    v.setUint16(o, [78, 78, 49, 47, 63, 79, 47][i], true),
  );
  write(core.PARTY_START, m);
  write(core.PC_START + 78 * 52, m.subarray(0, 52));
  write(core.PC_START + 780 * 52, core.encode('Box 1', 9));
  for (const off of addresses.values())
    view.setUint16(off + 4086, core.checksum(bytes.subarray(off, off + 4084)), true);
  return bytes;
}
module.exports = { fixture };
