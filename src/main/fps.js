// Contador de FPS / frametime usando o PresentMon (Intel, código aberto — o usuário fornece o .exe).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const store = require('./store');

let proc = null;
let file = null;
let offset = 0;
let header = null;
let frames = [];
let target = null;

function findExe() {
  const saved = store.read('settings', {}).presentMon;
  if (saved && fs.existsSync(saved)) return saved;
  const dirs = [path.join(store.dir(), '..', 'tools'), path.join(path.dirname(app.getPath('exe')), 'tools')];
  for (const d of dirs) {
    try { const f = fs.readdirSync(d).find((x) => /^PresentMon.*\.exe$/i.test(x)); if (f) return path.join(d, f); } catch {}
  }
  return null;
}

function status() { return { exe: findExe(), running: !!proc, target }; }

function setExe(p) {
  store.update('settings', {}, (s) => ({ ...s, presentMon: p }));
  return status();
}

function start(pid) {
  stop();
  const exe = findExe();
  if (!exe) return { ok: false, message: 'PresentMon não encontrado.' };
  file = path.join(store.dir(), `fps_${pid}.csv`);
  try { fs.unlinkSync(file); } catch {}
  offset = 0; header = null; frames = []; target = pid;
  proc = spawn(exe, ['--process_id', String(pid), '--output_file', file, '--stop_existing_session', '--terminate_on_proc_exit', '--no_console_stats', '--v1_metrics'], { windowsHide: true });
  proc.on('exit', () => { proc = null; });
  return { ok: true };
}

function stop() {
  if (proc) { try { proc.kill(); } catch {} proc = null; }
  target = null;
  return { ok: true };
}

function readNew() {
  if (!file || !fs.existsSync(file)) return;
  const size = fs.statSync(file).size;
  if (size <= offset) return;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) return;
  offset += Buffer.byteLength(text.slice(0, lastNl + 1));
  for (const line of text.slice(0, lastNl).split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split(',');
    if (!header) { header = cols; continue; }
    const i = header.indexOf('msBetweenPresents') >= 0 ? header.indexOf('msBetweenPresents') : header.indexOf('FrameTime');
    const v = parseFloat(cols[i]);
    if (v > 0 && v < 1000) frames.push({ t: Date.now(), ms: v });
  }
  const cutoff = Date.now() - 30000;
  while (frames.length && frames[0].t < cutoff) frames.shift();
}

function live() {
  readNew();
  const recent = frames.filter((f) => f.t > Date.now() - 2000);
  if (!recent.length) return { running: !!proc, target, fps: null };
  const avgMs = recent.reduce((a, f) => a + f.ms, 0) / recent.length;
  const sorted = frames.map((f) => f.ms).sort((a, b) => b - a);
  const low1 = sorted.length ? 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.01) - 1)] : null;
  return { running: !!proc, target, fps: 1000 / avgMs, frametime: avgMs, low1, history: frames.slice(-240).map((f) => f.ms) };
}

// Captura cronometrada para benchmark: roda o PresentMon por N segundos e devolve todos os frametimes (ms)
function capture(pid, seconds) {
  return new Promise((resolve) => {
    const exe = findExe();
    if (!exe) { resolve({ ok: false, message: 'PresentMon não encontrado. Selecione-o na página Latência.' }); return; }
    stop();
    const out = path.join(store.dir(), `bench_${pid}_${Date.now()}.csv`);
    const p = spawn(exe, ['--process_id', String(pid), '--output_file', out, '--stop_existing_session', '--no_console_stats', '--v1_metrics', '--timed', String(seconds), '--terminate_after_timed'], { windowsHide: true });
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, (seconds + 20) * 1000);
    p.on('exit', () => {
      clearTimeout(timer);
      let frames = [];
      try {
        const lines = fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean);
        const head = lines.shift().split(',');
        const i = head.indexOf('msBetweenPresents') >= 0 ? head.indexOf('msBetweenPresents') : head.indexOf('FrameTime');
        frames = lines.map((l) => parseFloat(l.split(',')[i])).filter((v) => v > 0 && v < 1000);
      } catch {}
      try { fs.unlinkSync(out); } catch {}
      resolve(frames.length ? { ok: true, frames } : { ok: false, message: 'Nenhum quadro capturado. O jogo estava em primeiro plano e renderizando?' });
    });
  });
}

module.exports = { status, setExe, start, stop, live, capture };
