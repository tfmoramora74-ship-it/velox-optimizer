// Vigia de processos compartilhado: uma única consulta (tasklist) a cada 4 s serve o Game Mode e os Perfis de jogo.
// Só roda enquanto houver alguém inscrito.
const { exec } = require('./ps');

const subs = new Map();
let timer = null;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const r = await exec('tasklist.exe', ['/fo', 'csv', '/nh']);
    const list = r.stdout.split(/\r?\n/).map((l) => l.match(/^"([^"]+)","(\d+)"/)).filter(Boolean).map((m) => ({ name: m[1], pid: Number(m[2]) }));
    for (const fn of subs.values()) { try { await fn(list); } catch {} }
  } finally { busy = false; }
}

function subscribe(key, fn) {
  if (fn) subs.set(key, fn); else subs.delete(key);
  if (subs.size && !timer) timer = setInterval(tick, 4000);
  if (!subs.size && timer) { clearInterval(timer); timer = null; }
}

async function snapshot() {
  const r = await exec('tasklist.exe', ['/fo', 'csv', '/nh']);
  return r.stdout.split(/\r?\n/).map((l) => l.match(/^"([^"]+)","(\d+)"/)).filter(Boolean).map((m) => ({ name: m[1], pid: Number(m[2]) }));
}

module.exports = { subscribe, snapshot };
