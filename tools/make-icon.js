// Gera src/assets/icon.png e build/icon.ico (quadrado vermelho arredondado com um "V").
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(S) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  const r = S * 0.22, th = S * 0.075;
  const A = [S * 0.25, S * 0.28], B = [S * 0.5, S * 0.74], C = [S * 0.75, S * 0.28];
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const i = y * (S * 4 + 1) + 1 + x * 4;
      // distância ao retângulo arredondado
      const qx = Math.max(Math.abs(x + 0.5 - S / 2) - (S / 2 - r), 0);
      const qy = Math.max(Math.abs(y + 0.5 - S / 2) - (S / 2 - r), 0);
      const d = Math.hypot(qx, qy) - r;
      const alpha = Math.max(0, Math.min(1, 0.5 - d));
      const t = (x + y) / (2 * S);
      let R = 236 - t * 100, G = 56 - t * 36, Bc = 46 - t * 30;
      const v = Math.min(segDist(x + 0.5, y + 0.5, ...A, ...B), segDist(x + 0.5, y + 0.5, ...B, ...C));
      const w = Math.max(0, Math.min(1, th - v + 0.5));
      R = R * (1 - w) + 255 * w; G = G * (1 - w) + 255 * w; Bc = Bc * (1 - w) + 255 * w;
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = Bc; raw[i + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
const png256 = render(256);
fs.writeFileSync(path.join(root, 'src', 'assets', 'icon.png'), png256);
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png256);

// ICO com imagens PNG embutidas
const sizes = [16, 32, 48, 256];
const imgs = sizes.map((s) => (s === 256 ? png256 : render(s)));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(offset, 12); offset += imgs[i].length;
  return e;
});
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...dir, ...imgs]));
console.log('ícones gerados');
