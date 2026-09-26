// Generates the PWA icon set. Draws the mark on a raw RGBA buffer and encodes
// the PNG by hand (zlib is in node core) so the build needs no image library.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND = [0x2f, 0x6b, 0xff];
const DARK = [0x07, 0x0b, 0x12];

const OUT = path.join(__dirname, 'web', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// --- minimal PNG encoder -----------------------------------------------------
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;    // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- geometry, in a 100x100 design grid --------------------------------------
// Every shape below is a proper signed distance field, so the union of them is
// also a field and the anti-aliasing is exact rather than a post-hoc blur.
function sdSegment(px, py, x1, y1, x2, y2, half) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy) - half;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

// The download mark: a shaft, a chevron head, and a tray with rounded corners.
function markSdf(px, py) {
  // shaft, from just under the head down to the chevron
  let d = sdSegment(px, py, 50, 20, 50, 54, 4.6);
  // chevron head
  d = Math.min(d, sdSegment(px, py, 33, 40, 50, 57, 4.6));
  d = Math.min(d, sdSegment(px, py, 67, 40, 50, 57, 4.6));
  // tray: two uprights and a floor, so the corners are round for free
  d = Math.min(d, sdSegment(px, py, 30, 64, 30, 74, 4.6));
  d = Math.min(d, sdSegment(px, py, 70, 64, 70, 74, 4.6));
  d = Math.min(d, sdSegment(px, py, 30, 74, 70, 74, 4.6));
  return d;
}

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 3;                                  // supersampling per axis
  // A maskable icon gets cropped to a circle by the launcher, so its art has to
  // sit inside the safe zone. A normal icon can use the full plate.
  const artScale = maskable ? 0.60 : 0.74;
  const radius = maskable ? size / 2 : size * 0.225;
  const inset = maskable ? 0 : size * 0.055;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          const dPlate = maskable
            ? -1
            : sdRoundRect(px, py, size / 2, size / 2, size / 2 - inset, size / 2 - inset, radius);
          const covBg = clamp01(0.5 - dPlate);
          let R = DARK[0], G = DARK[1], B = DARK[2], A = 255 * covBg;

          const k = (size * artScale) / 100;
          const c = size / 2;
          const dMark = markSdf((px - c) / k + 50, (py - c) / k + 50) * k;
          const cov = clamp01(0.5 - dMark);
          if (cov > 0) {
            R = R + (BRAND[0] - R) * cov;
            G = G + (BRAND[1] - G) * cov;
            B = B + (BRAND[2] - B) * cov;
            A = Math.max(A, 255 * cov);
          }

          ar += R; ag += G; ab += B; aa += A;
        }
      }

      const n = S * S;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(ar / n);
      buf[i + 1] = Math.round(ag / n);
      buf[i + 2] = Math.round(ab / n);
      buf[i + 3] = Math.round(aa / n);
    }
  }
  return encodePNG(size, size, buf);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Rounded-rect SDF centred at (cx, cy) with half-extents (hw, hh) and radius r.
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['favicon-32.png', 32, false]
];

for (const [name, size, maskable] of targets) {
  const png = render(size, maskable);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(name, String(size) + 'x' + size, maskable ? 'maskable' : 'any', png.length + ' bytes');
}
