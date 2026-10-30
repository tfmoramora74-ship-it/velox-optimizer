// Benchmark de antes/depois: FPS e frametime (PresentMon), uso de CPU/GPU, ping e precisão do timer.
const store = require('./store');
const fps = require('./fps');
const memory = require('./memory');
const network = require('./network');

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; }

function stats(frames) {
  const avgMs = frames.reduce((a, b) => a + b, 0) / frames.length;
  const sorted = [...frames].sort((a, b) => a - b);
  const median = pct(sorted, 0.5);
  const sd = Math.sqrt(frames.reduce((a, b) => a + (b - avgMs) ** 2, 0) / frames.length);
  return {
    fps: 1000 / avgMs,
    low1: 1000 / pct(sorted, 0.99),
    low01: 1000 / pct(sorted, 0.999),
    ftAvg: avgMs, ftSd: sd,
    stutters: frames.filter((f) => f > median * 2.5).length,
    frames: frames.length,
  };
}

async function run({ pid, name, seconds = 30, label, pingHost = '1.1.1.1' }, onProgress) {
  const samples = [];
  const t = setInterval(() => samples.push(memory.sample()), 1000);
  onProgress && onProgress({ label: `Medindo ${name} por ${seconds}s... jogue normalmente` });
  const cap = await fps.capture(pid, seconds);
  clearInterval(t);
  if (!cap.ok) return cap;
  onProgress && onProgress({ label: 'Medindo ping e timer...' });
  const [ping, sleep] = await Promise.all([network.ping(pingHost, 15), memory.measureSleep(60)]);
  const s = stats(cap.frames);
  const avg = (k) => { const v = samples.map((x) => x[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const step = Math.max(1, Math.floor(cap.frames.length / 400));
  const result = {
    id: Date.now().toString(36), ts: Date.now(), label: label || 'Sem nome', game: name, seconds, ...s,
    cpu: avg('cpu'), gpu: avg('gpu'),
    ping: ping.ok ? ping.avg : null, jitter: ping.ok ? ping.jitter : null, sleep: sleep.ok ? sleep.avg : null,
    tweaks: Object.keys(store.read('rollback', {})).length,
    history: cap.frames.filter((_, i) => i % step === 0),
  };
  store.update('benchmarks', [], (list) => [result, ...list].slice(0, 50));
  store.log('benchmark', `Benchmark "${result.label}" em ${name}: ${result.fps.toFixed(0)} FPS, 1% low ${result.low1.toFixed(0)}`, 'info');
  return { ok: true, result };
}

function list() { return store.read('benchmarks', []); }
function remove(id) { return store.update('benchmarks', [], (l) => l.filter((x) => x.id !== id)); }

module.exports = { run, list, remove };
