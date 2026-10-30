// Perfis por jogo/app (estilo Process Lasso): regras que valem sempre que o executável abrir.
// Persistentes no registro: prioridade de CPU e de disco (IFEO), GPU de alto desempenho, sem otimização de tela cheia.
// Em tempo real (vigia a cada 5 s): prioridade e afinidade de núcleos.
const os = require('os');
const reg = require('./reg');
const store = require('./store');
const { ps, q } = require('./ps');
const gamemode = require('./gamemode');
const procwatch = require('./procwatch');

const IFEO = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\';
const GPU_PREF = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const LAYERS = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
const PRIO_CLASS = { BelowNormal: 5, Normal: 2, AboveNormal: 6, High: 3 };

const DEFAULT = { enabled: true, priority: 'AboveNormal', persistent: false, ioHigh: false, affinity: 'all', cores: [], gpuHigh: false, fsoOff: false, path: '' };

function list() { return store.read('game-profiles', []); }

function opsFor(p) {
  const ops = [];
  if (p.persistent && PRIO_CLASS[p.priority]) ops.push({ key: IFEO + p.exe + '\\PerfOptions', name: 'CpuPriorityClass', type: 'DWord', value: PRIO_CLASS[p.priority] });
  if (p.ioHigh) ops.push({ key: IFEO + p.exe + '\\PerfOptions', name: 'IoPriority', type: 'DWord', value: 3 });
  if (p.gpuHigh && p.path) ops.push({ key: GPU_PREF, name: p.path, type: 'String', value: 'GpuPreference=2;' });
  if (p.fsoOff && p.path) ops.push({ key: LAYERS, name: p.path, type: 'String', value: '~ DISABLEDXMAXIMIZEDWINDOWEDMODE' });
  return ops;
}

async function save(profile) {
  const p = { ...DEFAULT, ...profile, exe: String(profile.exe || '').trim() };
  if (!/^[\w .()+-]+\.exe$/i.test(p.exe)) return { ok: false, message: 'Executável inválido.' };
  const all = list();
  const old = all.find((x) => x.exe.toLowerCase() === p.exe.toLowerCase());
  // Desfaz o registro antigo antes de gravar o novo
  if (old) await unapply(old);
  const ops = p.enabled ? opsFor(p) : [];
  if (ops.length) {
    const cur = await reg.readMany(ops);
    p.backup = ops.map((o, i) => ({ key: o.key, name: o.name, exists: cur[i].exists, type: cur[i].type, value: cur[i].value }));
    const w = await reg.writeMany(ops);
    if (!w.ok) return { ok: false, message: w.errors.join(' ') };
  } else p.backup = [];
  store.write('game-profiles', [...all.filter((x) => x !== old), p].sort((a, b) => a.exe.localeCompare(b.exe)));
  start();
  seen.clear();
  store.log('profiles', `Perfil salvo: ${p.exe}`, 'success', old ? null : { type: 'profile', exe: p.exe });
  return { ok: true, message: `Perfil de ${p.exe} salvo. Vale na próxima vez que ele abrir.` };
}

async function unapply(p) {
  if (!p.backup || !p.backup.length) return;
  await reg.writeMany(p.backup.map((b) => (b.exists ? { key: b.key, name: b.name, type: b.type, value: b.value } : { key: b.key, name: b.name, delete: true })));
}

async function remove(exe) {
  const all = list();
  const p = all.find((x) => x.exe.toLowerCase() === exe.toLowerCase());
  if (!p) return { ok: false, message: 'Perfil não encontrado.' };
  await unapply(p);
  store.write('game-profiles', all.filter((x) => x !== p));
  start();
  store.log('profiles', `Perfil removido: ${exe}`, 'info');
  return { ok: true, message: `Perfil de ${exe} removido e registro restaurado.` };
}

// ───────── Vigia em tempo real
const seen = new Map(); // pid -> exe já ajustado


async function affinityMask(p) {
  const n = os.cpus().length;
  const all = n >= 64 ? null : 2 ** n - 1;
  if (p.affinity === 'pcores') { const t = await gamemode.topology(); return t.hybrid && t.mask ? t.mask : null; }
  if (p.affinity === 'skip0' && all) return all - 1;
  if (p.affinity === 'custom' && p.cores && p.cores.length) return p.cores.filter((c) => c < n && c < 63).reduce((m, c) => m + 2 ** c, 0) || null;
  return null;
}

async function tick(all) {
  const profiles = list().filter((p) => p.enabled);
  if (!profiles.length) return;
  const procs = all.map((x) => ({ name: x.name.toLowerCase(), pid: x.pid }));
  const alive = new Set(procs.map((x) => x.pid));
  for (const pid of [...seen.keys()]) if (!alive.has(pid)) seen.delete(pid);
  const cmds = [];
  for (const p of profiles) {
    for (const pr of procs.filter((x) => x.name === p.exe.toLowerCase() && !seen.has(x.pid))) {
      seen.set(pr.pid, p.exe);
      const mask = await affinityMask(p);
      cmds.push(`$x = Get-Process -Id ${pr.pid} -ErrorAction SilentlyContinue; if ($x) { try { $x.PriorityClass = ${q(p.priority)} } catch {}; ${mask ? `try { $x.ProcessorAffinity = [IntPtr][int64]${mask} } catch {}` : ''} }`);
      store.log('profiles', `Perfil aplicado: ${p.exe} (PID ${pr.pid})`, 'info');
    }
  }
  if (cmds.length) await ps(cmds.join(';'));
}

// Só se inscreve no vigia compartilhado quando existe algum perfil ativo
function start() { procwatch.subscribe('profiles', list().some((p) => p.enabled) ? (procs) => tick(procs) : null); }
function stop() { procwatch.subscribe('profiles', null); }

module.exports = { list, save, remove, start, stop, DEFAULT };
