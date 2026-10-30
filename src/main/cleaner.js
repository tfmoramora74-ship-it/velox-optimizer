// Limpeza de arquivos temporários e caches.
const fs = require('fs');
const path = require('path');
const { ps } = require('./ps');
const store = require('./store');

const env = (k) => process.env[k] || '';
const L = env('LOCALAPPDATA');
const W = env('SystemRoot') || 'C:\\Windows';

const CATEGORIES = [
  { id: 'user-temp', name: 'Temporários do usuário', desc: '%TEMP%', paths: [env('TEMP')], default: true },
  { id: 'win-temp', name: 'Temporários do Windows', desc: 'Windows\\Temp', paths: [path.join(W, 'Temp')], default: true },
  { id: 'shader', name: 'Caches de shader (DirectX/NVIDIA/AMD)', desc: 'Os jogos recompilam na próxima abertura', paths: [path.join(L, 'D3DSCache'), path.join(L, 'NVIDIA', 'DXCache'), path.join(L, 'NVIDIA', 'GLCache'), path.join(L, 'AMD', 'DxCache'), path.join(L, 'AMD', 'DxcCache'), path.join(L, 'AMD', 'VkCache')], default: false },
  { id: 'thumbs', name: 'Cache de miniaturas', desc: 'thumbcache do Explorer', paths: [path.join(L, 'Microsoft', 'Windows', 'Explorer')], filter: /^(thumbcache|iconcache)_.*\.db$/i, default: true },
  { id: 'dumps', name: 'Dumps de travamento e relatórios de erro', desc: 'CrashDumps, Minidump, WER', paths: [path.join(L, 'CrashDumps'), path.join(W, 'Minidump'), 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive', 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue', path.join(L, 'Microsoft', 'Windows', 'WER')], default: true },
  { id: 'wu', name: 'Downloads do Windows Update', desc: 'SoftwareDistribution\\Download', paths: [path.join(W, 'SoftwareDistribution', 'Download')], stopServices: ['wuauserv', 'bits'], default: true },
  { id: 'do', name: 'Cache de Otimização de Entrega', desc: 'Atualizações compartilhadas P2P', paths: [path.join(W, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache')], default: true },
  { id: 'logs', name: 'Logs antigos do Windows', desc: 'Windows\\Logs (CBS, DISM)', paths: [path.join(W, 'Logs', 'CBS'), path.join(W, 'Logs', 'DISM')], filter: /\.(log|cab)$/i, default: false },
  { id: 'prefetch', name: 'Prefetch do Windows', desc: 'Rastros de abertura de programas (o Windows recria os que precisar)', paths: [path.join(W, 'Prefetch')], filter: /\.pf$/i, default: false },
  { id: 'browser-cache', name: 'Cache dos navegadores', desc: 'Chrome, Edge, Brave e Firefox (feche-os antes; arquivos em uso são pulados)', paths: [
    ...['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser'].flatMap((b) => ['Default', 'Profile 1', 'Profile 2'].flatMap((p) => [path.join(L, b, 'User Data', p, 'Cache'), path.join(L, b, 'User Data', p, 'Code Cache'), path.join(L, b, 'User Data', p, 'GPUCache')])),
    path.join(L, 'Mozilla', 'Firefox', 'Profiles')], firefoxCache: true, default: false },
  { id: 'browser-history', name: 'Histórico dos navegadores', desc: 'Apaga o histórico de navegação do Chrome, Edge e Brave (privacidade). Não mexe em senhas nem favoritos.', paths: ['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser'].map((b) => path.join(L, b, 'User Data', 'Default')), filter: /^(History|History-journal|Visited Links|Top Sites|Top Sites-journal)$/, default: false },
  { id: 'eventlogs', name: 'Logs de eventos do Windows', desc: 'Visualizador de Eventos (perde o histórico de diagnóstico)', special: 'eventlogs', default: false },
  { id: 'recycle', name: 'Lixeira', desc: 'Esvazia a Lixeira de todas as unidades (permanente)', special: 'recycle', default: false },
];

function walk(dir, filter, depth = 0, acc = { size: 0, files: 0 }) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!filter && depth < 30) walk(p, filter, depth + 1, acc); }
    else if (!filter || filter.test(e.name)) {
      try { acc.size += fs.statSync(p).size; acc.files++; } catch {}
    }
  }
  return acc;
}

// Firefox: só a pasta cache2 de cada perfil (nunca o perfil inteiro)
function expandFirefox(c) {
  if (!c.firefoxCache) return c.paths || [];
  const base = path.join(L, 'Mozilla', 'Firefox', 'Profiles');
  let profiles = [];
  try { profiles = fs.readdirSync(base).map((p) => path.join(base, p, 'cache2')); } catch {}
  return [...c.paths.filter((p) => p !== base), ...profiles];
}

async function recycleSize() {
  const r = await ps("$s=0; Get-ChildItem -LiteralPath 'C:\\$Recycle.Bin' -Force -Recurse -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | ForEach-Object { $s += $_.Length }; $s");
  return { size: Number(r.stdout.trim()) || 0, files: 0 };
}

async function scan() {
  const out = [];
  for (const c of CATEGORIES) {
    let acc = { size: 0, files: 0 };
    if (c.special === 'recycle') acc = await recycleSize();
    else if (c.special === 'eventlogs') walk(path.join(W, 'System32', 'winevt', 'Logs'), null, 0, acc);
    else for (const p of expandFirefox(c)) if (p && fs.existsSync(p)) walk(p, c.filter, 0, acc);
    out.push({ id: c.id, name: c.name, desc: c.desc, default: c.default, size: acc.size, files: acc.files });
    await new Promise((r) => setImmediate(r));
  }
  return out;
}

function removeContents(dir, filter, stats) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (filter) {
        if (e.isFile() && filter.test(e.name)) { const s = fs.statSync(p).size; fs.unlinkSync(p); stats.freed += s; stats.files++; }
        continue;
      }
      if (e.isDirectory() && !e.isSymbolicLink()) {
        const sub = walk(p, null);
        fs.rmSync(p, { recursive: true, force: true });
        if (!fs.existsSync(p)) { stats.freed += sub.size; stats.files += sub.files; }
        else removeContents(p, null, stats);
      } else {
        const s = fs.statSync(p).size; fs.unlinkSync(p); stats.freed += s; stats.files++;
      }
    } catch { stats.locked++; }
  }
}

async function clean(ids) {
  const stats = { freed: 0, files: 0, locked: 0 };
  for (const c of CATEGORIES.filter((x) => ids.includes(x.id))) {
    if (c.special === 'recycle') {
      const before = await recycleSize();
      await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
      stats.freed += before.size;
      continue;
    }
    if (c.special === 'eventlogs') {
      const before = walk(path.join(W, 'System32', 'winevt', 'Logs'), null);
      await ps("wevtutil el | ForEach-Object { wevtutil cl \"$_\" 2>$null }", { timeout: 300000 });
      const after = walk(path.join(W, 'System32', 'winevt', 'Logs'), null);
      stats.freed += Math.max(0, before.size - after.size);
      continue;
    }
    if (c.stopServices) await ps(c.stopServices.map((s) => `Stop-Service -Name '${s}' -Force -ErrorAction SilentlyContinue`).join(';'));
    if (c.id === 'do') await ps('Delete-DeliveryOptimizationCache -Force -ErrorAction SilentlyContinue');
    for (const p of expandFirefox(c)) if (p && fs.existsSync(p)) removeContents(p, c.filter, stats);
    if (c.stopServices) await ps(c.stopServices.map((s) => `Start-Service -Name '${s}' -ErrorAction SilentlyContinue`).join(';'));
  }
  store.log('cleaner', `Limpeza: ${(stats.freed / 1024 ** 2).toFixed(0)} MB removidos (${stats.files} arquivos)`, 'success');
  return { ok: true, ...stats };
}

module.exports = { scan, clean, CATEGORIES };
