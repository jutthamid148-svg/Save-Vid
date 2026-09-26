// Generates the two remaining brand assets that the head and the manifest
// reference but that did not exist yet:
//   web/og-image.png  -- 1200x630 social share card
//   web/logo.svg      -- vector wordmark for the schema.org publisher block
// The PNG is drawn on a raw RGBA buffer and encoded by hand, reusing the
// zero-dependency encoder from makeicons.js so the build needs no image library.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND = [0x2f, 0x6b, 0xff];
const BRAND_2 = [0x1d, 0x4f, 0xf0];
const DARK = [0x07, 0x0b, 0x12];

const WEB = path.join(__dirname, 'web');
fs.mkdirSync(path.join(WEB, 'icons'), { recursive: true });

// ── PNG encoder ──────────────────────────────────────────────────────────────
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
  ihdr[9] = 6;
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

// ── SDF primitives ──────────────────────────────────────────────────────────
function sdSegment(px, py, x1, y1, x2, y2, half) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy) - half;
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// The same download mark as makeicons.js, on a 100x100 grid: shaft, chevron,
// and a tray built from three segments so its corners come out round.
function markSdf(px, py) {
  let d = sdSegment(px, py, 50, 18, 50, 54, 4.8);
  d = Math.min(d, sdSegment(px, py, 32, 40, 50, 58, 4.8));
  d = Math.min(d, sdSegment(px, py, 68, 40, 50, 58, 4.8));
  d = Math.min(d, sdSegment(px, py, 29, 64, 29, 76, 4.8));
  d = Math.min(d, sdSegment(px, py, 71, 64, 71, 76, 4.8));
  d = Math.min(d, sdSegment(px, py, 29, 76, 71, 76, 4.8));
  return d;
}

// ── a tiny stroke font ───────────────────────────────────────────────────────
// The card needs a readable wordmark, but a raster PNG cannot reference a font
// and there is no image library in the build. So the eight glyphs the name
// needs are defined as polylines and stroked with the same SDF machinery as
// the mark. Round caps and a single stroke weight give a geometric sans that
// suits the rest of the brand.
const GLYPHS = {
  S: [[[52, 16], [40, 5], [24, 5], [11, 17], [11, 28], [24, 39], [38, 39], [51, 50], [51, 63], [38, 75], [22, 75], [9, 64]]],
  a: [[[44, 30], [44, 76]], [[44, 36], [30, 29], [15, 37], [10, 52], [16, 69], [31, 76], [44, 68]]],
  v: [[[9, 30], [29, 76], [49, 30]]],
  e: [[[10, 53], [46, 53]], [[46, 53], [45, 40], [30, 29], [14, 37], [9, 53], [16, 69], [30, 76], [44, 69]]],
  V: [[[6, 5], [29, 76], [52, 5]]],
  i: [[[20, 31], [20, 68]]],
  d: [[[34, 5], [34, 76]], [[34, 36], [20, 29], [9, 39], [8, 63], [20, 75], [34, 68]]],
  n: [[[10, 30], [10, 76]], [[10, 36], [24, 28], [38, 35], [40, 76]]],
  t: [[[24, 11], [24, 63], [37, 73]], [[10, 31], [38, 31]]],
  '.': [[[20, 70], [20, 71]]]
};

const GLYPH_W = 60, GLYPH_H = 80, TRACK = 8;

// Distance to a whole polyline: the min over its segments. Unioning them is
// still a field, so the joins come out round without any extra work.
function sdPoly(px, py, pts, half) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    d = Math.min(d, sdSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], half));
  }
  return d;
}

// Width of a string in glyph units, so the wordmark can be centred.
function measure(text) {
  let w = 0;
  for (const ch of text) w += GLYPH_W + (ch === '.' ? 20 : TRACK);
  return w - TRACK;
}

// ── the 1200x630 share card ──────────────────────────────────────────────────
// Platforms crop this to roughly 1.91:1, so everything meaningful is kept well
// inside a centred safe box and nothing important touches an edge.
const W = 1200, H = 630;

function buildOG() {
  const buf = Buffer.alloc(W * H * 4);
  const S = 2;                                    // supersampling per axis

  // Two glow blobs behind the plate give the card depth without a gradient
  // library: they are just radial falloff on the brand colour.
  const glows = [
    { x: 170,  y: 60,  r: 520, c: BRAND,   a: 0.30 },
    { x: 1080, y: 580, r: 560, c: BRAND_2, a: 0.24 },
    { x: 1000, y: 60,  r: 380, c: BRAND,   a: 0.16 }
  ];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          // Base: near-black with a vertical lift so the card is not flat.
          const t = py / H;
          let R = DARK[0] + (0x0d - DARK[0]) * t;
          let G = DARK[1] + (0x14 - DARK[1]) * t;
          let B = DARK[2] + (0x22 - DARK[2]) * t;
          let A = 255;

          for (const g of glows) {
            const f = Math.max(0, 1 - Math.hypot(px - g.x, py - g.y) / g.r);
            const w = f * f * g.a;
            R += (g.c[0] - R) * w;
            G += (g.c[1] - G) * w;
            B += (g.c[2] - B) * w;
          }

          // The mark, centred high on the card.
          const k = 130 / 100;
          const cx = W / 2, cy = 238;
          const cov = clamp01(0.5 - markSdf((px - cx) / k + 50, (py - cy) / k + 50) * k);
          if (cov > 0) {
            R = R + (BRAND[0] - R) * cov;
            G = G + (BRAND[1] - G) * cov;
            B = B + (BRAND[2] - B) * cov;
          }

          // The wordmark. "SaveVid" is drawn in white at full size and ".net"
          // in the brand blue at 70%, which is how the wordmark reads on the
          // site itself.
          const wk = 0.86;                        // stroke font is 80 units tall
          const word = 'SaveVid', tail = '.net';
          const wWord = measure(word) * wk, wTail = measure(tail) * wk * 0.7;
          const gap = 18 * wk;
          const total = wWord + gap + wTail;
          const startX = W / 2 - total / 2;
          const wY = 338;                              // top of the cap height

          // Lay each glyph out in sequence and take the union, so overlapping
          // strokes read as one continuous letter.
          let dWord = Infinity, dTail = Infinity;
          let gx = 0;
          for (const ch of word) {
            const ox = startX + gx * wk, oy = wY;
            for (const pl of GLYPHS[ch] || []) {
              const pts = pl.map((p) => [(ox + p[0] * wk) - 0, (oy + p[1] * wk) - 0]);
              dWord = Math.min(dWord, sdPoly(px, py, pts, 7));
            }
            gx += GLYPH_W + TRACK;
          }
          gx = 0;
          for (const ch of tail) {
            const ox = startX + wWord + gap + gx * wk * 0.7, oy = wY;
            for (const pl of GLYPHS[ch] || []) {
              const pts = pl.map((p) => [ox + p[0] * wk * 0.7, oy + p[1] * wk * 0.7]);
              dTail = Math.min(dTail, sdPoly(px, py, pts, 7 * 0.72));
            }
            gx += GLYPH_W + TRACK;
          }

          const covW = clamp01(0.5 - dWord);
          if (covW > 0) {
            R = R + (0xf1 - R) * covW;
            G = G + (0xf5 - G) * covW;
            B = B + (0xf9 - B) * covW;
          }
          const covT = clamp01(0.5 - dTail);
          if (covT > 0) {
            R = R + (BRAND[0] - R) * covT;
            G = G + (BRAND[1] - G) * covT;
            B = B + (BRAND[2] - B) * covT;
          }

          // Underline bar beneath the wordmark.
          const bar = clamp01(0.5 - sdRoundRect(px, py, W / 2, 466, total / 2, 5, 5));
          if (bar > 0) {
            R = R + (BRAND[0] - R) * bar;
            G = G + (BRAND[1] - G) * bar;
            B = B + (BRAND[2] - B) * bar;
          }

          ar += R; ag += G; ab += B; aa += A;
        }
      }

      const n = S * S;
      const i = (y * W + x) * 4;
      buf[i] = Math.round(ar / n);
      buf[i + 1] = Math.round(ag / n);
      buf[i + 2] = Math.round(ab / n);
      buf[i + 3] = Math.round(aa / n);
    }
  }
  return encodePNG(W, H, buf);
}

const ogPath = path.join(WEB, 'og-image.png');
const og = buildOG();
fs.writeFileSync(ogPath, og);
console.log('og-image.png', W + 'x' + H, og.length + ' bytes');

// ── logo.svg ────────────────────────────────────────────────────────────────
// Google requires the publisher logo to be a real, crawlable image, and a
// scalable mark is the right format for it. The mark itself is pure stroked
// paths; the wordmark is a <text> with a system font stack, so it does carry a
// font dependency and can render in a fallback face. That is acceptable here
// because the file is only ever consumed by Google's crawler and by the site
// header, both of which have the stack available. The PNG card above is the
// one asset that must look identical everywhere, which is why its wordmark is
// drawn from the stroke font instead.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96" width="420" height="96" role="img" aria-label="SaveVid.net">
  <title>SaveVid.net</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4d86ff"/>
      <stop offset="1" stop-color="#1d4ff0"/>
    </linearGradient>
  </defs>
  <rect x="4" y="8" width="80" height="80" rx="22" fill="#070b12"/>
  <rect x="4.75" y="8.75" width="78.5" height="78.5" rx="21.25" fill="none" stroke="url(#g)" stroke-width="1.5" opacity=".55"/>
  <g stroke="url(#g)" stroke-width="9.6" stroke-linecap="round" fill="none">
    <path d="M44 26 V58"/>
    <path d="M33 45 L44 58"/>
    <path d="M55 45 L44 58"/>
    <path d="M31 66 V74"/>
    <path d="M57 66 V74"/>
    <path d="M31 74 H57"/>
  </g>
  <text x="104" y="63"
        font-family="'Segoe UI Variable Display','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif"
        font-size="50" font-weight="800" letter-spacing="-1.6" fill="#f1f5f9">Save<tspan fill="url(#g)">Vid.net</tspan></text>
</svg>
`;
fs.writeFileSync(path.join(WEB, 'logo.svg'), logo);
console.log('logo.svg', Buffer.byteLength(logo) + ' bytes');
