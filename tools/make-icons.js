// Dependency-free icon generator: writes extension/assets/icons/*.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'extension', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

const C1 = [255, 199, 112];
const C2 = [255, 122, 24];
const C3 = [243, 71, 45];
const INK = [27, 13, 2];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function gradient(t) {
  const k = clamp01(t);
  return k < 0.55 ? mix(C1, C2, k / 0.55) : mix(C2, C3, (k - 0.55) / 0.45);
}

function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function segment(x, y, ax, ay, bx, by, w) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy || 1;
  const t = clamp01(((x - ax) * dx + (y - ay) * dy) / len);
  const px = ax + dx * t;
  const py = ay + dy * t;
  return (x - px) ** 2 + (y - py) ** 2 <= w * w;
}

function triangle(x, y, p1, p2, p3) {
  const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(x, y, p1[0], p1[1], p2[0], p2[1]);
  const d2 = sign(x, y, p2[0], p2[1], p3[0], p3[1]);
  const d3 = sign(x, y, p3[0], p3[1], p1[0], p1[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function shade(x, y, size) {
  const pad = size * 0.02;
  const r = size * 0.235;
  if (!roundedRect(x, y, pad, pad, size - pad, size - pad, r)) return [0, 0, 0, 0];

  // base gradient, diagonal top-left -> bottom-right
  const t = clamp01(((x - pad) / (size - 2 * pad) + (y - pad) / (size - 2 * pad)) / 2);
  let rgb = gradient(t);

  // soft top highlight
  const highlight = Math.pow(clamp01(1 - y / (size * 0.62)), 2) * 0.13;
  rgb = mix(rgb, [255, 255, 255], highlight);

  // glyph: download arrow
  const cx = size / 2;
  const stemTop = size * 0.25;
  const stemBottom = size * 0.525;
  const stroke = size * 0.065;
  const headBase = size * 0.405;
  const headY = size * 0.66;
  const halfW = size * 0.215;
  const barY = size * 0.805;
  const barHalf = size * 0.185;

  const onStem = segment(x, y, cx, stemTop, cx, stemBottom, stroke);
  const onHead = triangle(x, y,
    [cx, headY],
    [cx - halfW, headBase],
    [cx + halfW, headBase]
  );
  const onBar = segment(x, y, cx - barHalf, barY, cx + barHalf, barY, stroke * 0.95);

  if (onStem || onBar || onHead) rgb = mix(rgb, INK, 0.94);

  // inner border for depth
  const edge = !roundedRect(x, y, pad + size * 0.02, pad + size * 0.02, size - pad - size * 0.02, size - pad - size * 0.02, r - size * 0.02);
  if (edge) rgb = mix(rgb, [20, 12, 4], 0.055);

  return [...rgb.map((v) => Math.round(v)), 255];
}

function render(size) {
  const big = size * SS;
  const out = Buffer.alloc(size * size * 4);
  const samples = [];
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      samples.push(shade(x + 0.5, y + 0.5, big));
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = samples[(y * SS + sy) * big + (x * SS + sx)];
          const alpha = s[3] / 255;
          r += s[0] * alpha;
          g += s[1] * alpha;
          b += s[2] * alpha;
          a += s[3];
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const weight = (a / 255) || 1;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / weight);
      out[i + 1] = Math.round(g / weight);
      out[i + 2] = Math.round(b / weight);
      out[i + 3] = Math.round(alpha);
    }
  }
  return out;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
