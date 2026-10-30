// Motor de tweaks: expande definições, guarda backup antes de mudar, aplica, reverte e verifica.
const reg = require('../reg');
const { exec, ps, psJson, q } = require('../ps');
const store = require('../store');
const hardware = require('../hardware');
const custom = require('./custom');
const { TWEAKS, CATEGORIES, PRESETS } = require('./catalog');

const SVC_ROOT = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\';
const IFEO = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\';

// Padrões do Windows usados para reverter quando não existe backup (ex.: aplicado por outro programa).
const DEFAULTS = {
  MouseSpeed: '1', MouseThreshold1: '6', MouseThreshold2: '10', KeyboardDelay: '1', KeyboardSpeed: '31',
  MenuShowDelay: '400', ForegroundLockTimeout: 200000, Win32PrioritySeparation: 2, SystemResponsiveness: 20,
  NetworkThrottlingIndex: 10, 'GPU Priority': 8, Priority: 2, 'Scheduling Category': 'Medium', 'SFIO Priority': 'Normal',
  EnablePrefetcher: 3, DisablePagingExecutive: 0, LargeSystemCache: 0, VisualFXSetting: 0, MinAnimate: '1',
  MouseHoverTime: '400', WaitToKillServiceTimeout: '5000', ScreenSaveActive: '1', ValueMax: 100,SvcHostSplitThresholdInKB: 3670016, MouseDataQueueSize: 100, KeyboardDataQueueSize: 100, HiberbootEnabled: 1,TaskbarAnimations: 1, ListviewAlphaSelect: 1, EnableTransparency: 1, EnableAeroPeek: 1, SearchboxTaskbarMode: 1, ShowTaskViewButton: 1,
};
const SVC_DEFAULTS = {
  DiagTrack: 2, dmwappushservice: 3, SysMain: 2, WSearch: 2, XblAuthManager: 3, XblGameSave: 3, XboxNetApiSvc: 3, XboxGipSvc: 3,
  BcastDVRUserService: 3, Ndu: 2,MapsBroker: 2, RetailDemo: 3, Spooler: 2, Fax: 3, RemoteRegistry: 4, WerSvc: 3,
};

const byId = new Map(TWEAKS.map((t) => [t.id, t]));
let resolvedCache = {};

// Subchaves de driver de vídeo NVIDIA (Class\{4d36e968...}\0000, 0001...)
async function nvidiaClassOps(name, value) {
  const root = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
  const subs = await reg.listSubkeys(root, ['ProviderName']);
  return subs.filter((s) => /^\d{4}$/.test(s.name) && /nvidia/i.test(s.ProviderName || ''))
    .map((s) => ({ key: `${root}\\${s.name}`, name, type: 'DWord', value }));
}

// ───────── Resolvers de registro dinâmico
const RESOLVERS = {
  async gpuMsi(hw) {
    return hw.gpus.filter((g) => ['nvidia', 'amd', 'intel-arc'].includes(g.kind) && /^PCI\\/i.test(g.pnp || ''))
      .map((g) => ({ key: `HKLM\\SYSTEM\\CurrentControlSet\\Enum\\${g.pnp}\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties`, name: 'MSISupported', type: 'DWord', value: 1 }));
  },
  async gpuAffinity(hw) {
    const n = hw.cpu.threads;
    const bytes = new Array(Math.ceil(n / 8)).fill(0);
    for (const bit of [n - 1, n - 2]) bytes[Math.floor(bit / 8)] |= 1 << (bit % 8);
    return hw.gpus.filter((g) => ['nvidia', 'amd', 'intel-arc'].includes(g.kind) && /^PCI\\/i.test(g.pnp || '')).flatMap((g) => {
      const k = `HKLM\\SYSTEM\\CurrentControlSet\\Enum\\${g.pnp}\\Device Parameters\\Interrupt Management\\Affinity Policy`;
      return [{ key: k, name: 'DevicePolicy', type: 'DWord', value: 4 }, { key: k, name: 'AssignmentSetOverride', type: 'Binary', value: bytes }];
    });
  },
  async nagle() {
    const root = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces';
    const subs = await reg.listSubkeys(root, ['DhcpDefaultGateway', 'DefaultGateway']);
    const hasGw = (v) => (Array.isArray(v) ? v : v ? [v] : []).some((x) => x && x !== '0.0.0.0');
    return subs.filter((s) => hasGw(s.DhcpDefaultGateway) || hasGw(s.DefaultGateway)).flatMap((s) => [
      { key: `${root}\\${s.name}`, name: 'TcpAckFrequency', type: 'DWord', value: 1 },
      { key: `${root}\\${s.name}`, name: 'TCPNoDelay', type: 'DWord', value: 1 },
    ]);
  },
  async svchostSplit(hw) {
    return [{ key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control', name: 'SvcHostSplitThresholdInKB', type: 'DWord', value: Math.round(hw.ram.bytes / 1024) }];
  },
  async nvidiaPstate() { return nvidiaClassOps('DisableDynamicPstate', 1); },
  async nvidiaHdcp() { return nvidiaClassOps('RMHdcpKeyglobZero', 1); },
  async amdUlps() {
    const root = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
    const subs = await reg.listSubkeys(root, ['ProviderName']);
    return subs.filter((s) => /^\d{4}$/.test(s.name) && /advanced micro devices|amd|ati/i.test(s.ProviderName || ''))
      .map((s) => ({ key: `${root}\\${s.name}`, name: 'EnableUlps', type: 'DWord', value: 0 }));
  },
};

async function regOps(t, hw) {
  const ops = [...(t.reg || [])];
  for (const s of t.svc || []) ops.push({ key: SVC_ROOT + s, name: 'Start', type: 'DWord', value: 4, ifExists: true, svc: s });
  for (const exe of t.ifeo || []) ops.push({ key: IFEO + exe + '\\PerfOptions', name: 'CpuPriorityClass', type: 'DWord', value: 3 });
  if (t.resolve) {
    if (!resolvedCache[t.id]) resolvedCache[t.id] = await RESOLVERS[t.resolve](hw);
    ops.push(...resolvedCache[t.id]);
  }
  return ops;
}

// ───────── Plano de energia (powercfg)
async function readPower(sub, set) {
  const r = await exec('powercfg.exe', ['/qh', 'SCHEME_CURRENT', sub, set]);
  const m = [...r.stdout.matchAll(/0x([0-9a-fA-F]{8})/g)].map((x) => parseInt(x[1], 16));
  if (m.length < 2) return null;
  return { ac: m[m.length - 2], dc: m[m.length - 1] };
}
async function writePower(sub, set, ac, dc) {
  const a = await exec('powercfg.exe', ['/setacvalueindex', 'SCHEME_CURRENT', sub, set, String(ac)]);
  const d = await exec('powercfg.exe', ['/setdcvalueindex', 'SCHEME_CURRENT', sub, set, String(dc)]);
  await exec('powercfg.exe', ['/setactive', 'SCHEME_CURRENT']);
  // confere de verdade: o Windows recusa valores fora do intervalo permitido da configuração
  const now = await readPower(sub, set);
  if (!a.ok || !d.ok || !now || now.ac !== ac) return { ok: false, message: (a.stdout + a.stderr).trim() || 'O Windows recusou o valor do plano de energia.' };
  return { ok: true };
}

// ───────── BCD
async function readBcd() {
  const r = await exec('bcdedit.exe', ['/enum', '{current}']);
  const map = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (m) map[m[1].toLowerCase()] = m[2].trim();
  }
  return { ok: r.ok, map };
}

// ───────── AppX
async function appxPresent(pkgs) {
  const r = await psJson(`$p=@(Get-AppxPackage | Select-Object -ExpandProperty Name); $n=ConvertFrom-Json '${JSON.stringify(pkgs)}'; $o=@{}; foreach($x in $n){ $o[$x] = [bool]($p | Where-Object { $_ -like ($x + '*') }) }; ConvertTo-Json $o -Compress`);
  return r.ok && r.data ? r.data : {};
}

async function refreshInput(kind) {
  const sig = `if (-not ('V.U' -as [type])) { Add-Type -Namespace V -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, int[] c, uint d); [DllImport("user32.dll", EntryPoint="SystemParametersInfo")] public static extern bool Spi(uint a, uint b, System.IntPtr c, uint d);' };`;
  if (kind === 'mouse') {
    const v = await reg.readMany([{ key: 'HKCU\\Control Panel\\Mouse', name: 'MouseThreshold1' }, { key: 'HKCU\\Control Panel\\Mouse', name: 'MouseThreshold2' }, { key: 'HKCU\\Control Panel\\Mouse', name: 'MouseSpeed' }]);
    const arr = v.map((x) => parseInt(x.value || '0', 10));
    await ps(sig + `[V.U]::SystemParametersInfo(4,0,@(${arr.join(',')}),3) | Out-Null`);
  } else if (kind === 'keyboard') {
    const v = await reg.readMany([{ key: 'HKCU\\Control Panel\\Keyboard', name: 'KeyboardDelay' }, { key: 'HKCU\\Control Panel\\Keyboard', name: 'KeyboardSpeed' }]);
    await ps(sig + `[V.U]::Spi(0x17,${parseInt(v[0].value || '1', 10)},[IntPtr]::Zero,3) | Out-Null; [V.U]::Spi(0x0B,${parseInt(v[1].value || '31', 10)},[IntPtr]::Zero,3) | Out-Null`);
  }
}

// ───────── Status em lote
// Cache curto: várias telas pedem o status ao mesmo tempo; qualquer aplicar/reverter descarta
let statusCache = null;
let statusInflight = null;
async function statusAll() {
  if (statusCache && Date.now() - statusCache.ts < 30000) return statusCache.data;
  if (!statusInflight) statusInflight = computeStatus().then((data) => { statusCache = { ts: Date.now(), data }; return data; }).finally(() => { statusInflight = null; });
  return statusInflight;
}

async function computeStatus() {
  const hw = await hardware.detect();
  const rollback = store.read('rollback', {});
  const results = {};
  const regReq = [];
  const regIdx = {};

  await Promise.all(TWEAKS.filter((t) => t.resolve && !resolvedCache[t.id]).map(async (t) => { resolvedCache[t.id] = await RESOLVERS[t.resolve](hw); }));
  for (const t of TWEAKS) {
    const ops = await regOps(t, hw);
    regIdx[t.id] = ops.map((o) => { regReq.push({ key: o.key, name: o.name }); return regReq.length - 1; });
    t._ops = ops;
  }
  const [regVals, bcd, appx] = await Promise.all([
    reg.readMany(regReq),
    readBcd(),
    appxPresent(TWEAKS.filter((t) => t.appx).map((t) => t.appx)),
  ]);

  const powerKeys = [...new Set(TWEAKS.flatMap((t) => (t.power || []).map((p) => p.sub + '|' + p.set)))];
  const powerVals = {};
  await Promise.all(powerKeys.map(async (k) => { const [s, x] = k.split('|'); powerVals[k] = await readPower(s, x); }));

  const customStatus = {};
  await Promise.all(TWEAKS.filter((t) => t.custom).map(async (t) => {
    try { customStatus[t.id] = await custom[t.custom].status(hw); } catch { customStatus[t.id] = null; }
  }));

  for (const t of TWEAKS) {
    const parts = [];
    let unavailable = false;
    const ops = t._ops;
    if ((t.resolve) && ops.length === 0) unavailable = true;
    ops.forEach((o, i) => {
      const cur = regVals[regIdx[t.id][i]] || {};
      if (o.ifExists) {
        if (!cur.exists) return;
      }
      parts.push(cur.exists && reg.same(cur.value, o.value));
    });
    if (t.svc && !ops.some((o, i) => regVals[regIdx[t.id][i]] && regVals[regIdx[t.id][i]].exists)) unavailable = true;
    for (const p of t.power || []) {
      const v = powerVals[p.sub + '|' + p.set];
      if (!v) { unavailable = unavailable || !(t.reg && t.reg.length); continue; }
      parts.push(v.ac === p.value);
    }
    for (const b of t.bcd || []) parts.push((bcd.map[b.name] || '').toLowerCase() === b.value);
    if (t.appx) {
      const present = appx[t.appx];
      if (present === false) { results[t.id] = { state: 'absent' }; }
      else parts.push(false);
    }
    if (t.custom) {
      const s = customStatus[t.id];
      if (s === null || s === undefined) unavailable = true; else parts.push(!!s);
    }
    let state;
    if (results[t.id]) state = results[t.id].state;
    else if (unavailable && parts.length === 0) state = 'unavailable';
    else if (parts.length && parts.every(Boolean)) state = 'applied';
    else if (parts.some(Boolean)) state = 'partial';
    else state = 'off';
    const rule = t.rule ? t.rule(hw) || { level: 'ok' } : { level: 'ok' };
    results[t.id] = { state, hasBackup: !!rollback[t.id], rule };
  }
  return results;
}

// ───────── Aplicar
async function apply(id) {
  const t = byId.get(id);
  if (!t) return { ok: false, message: 'Tweak desconhecido.' };
  const hw = await hardware.detect();
  const rule = t.rule ? t.rule(hw) : null;
  if (rule && rule.level === 'block') return { ok: false, message: 'Bloqueado neste PC: ' + rule.reason };

  const rollback = store.read('rollback', {});
  const prev = rollback[id];
  const backup = prev || { ts: Date.now() };
  const errors = [];

  // Registro
  let ops = await regOps(t, hw);
  if (ops.length) {
    const cur = await reg.readMany(ops);
    const kept = ops.map((o, i) => ({ o, c: cur[i] || {} })).filter(({ o, c }) => !(o.ifExists && !c.exists));
    ops = kept.map((x) => x.o);
    if (!backup.reg) backup.reg = kept.map(({ o, c }) => ({ key: o.key, name: o.name, exists: c.exists, type: c.type, value: c.value, svc: o.svc }));
    const w = await reg.writeMany(ops);
    errors.push(...w.errors);
    const svcs = ops.filter((o) => o.svc).map((o) => o.svc);
    if (svcs.length) await ps(svcs.map((s) => `Stop-Service -Name ${q(s)} -Force -ErrorAction SilentlyContinue; Get-Service -Name ${q(s + '_*')} -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue`).join(';'));
  }

  // Energia
  if (t.power) {
    const freshPower = !backup.power;
    if (freshPower) backup.power = [];
    for (const p of t.power) {
      if (t.unhide) await exec('powercfg.exe', ['-attributes', p.sub, p.set, '-ATTRIB_HIDE']);
      const cur = await readPower(p.sub, p.set);
      if (!cur) continue;
      if (freshPower) backup.power.push({ ...p, ac: cur.ac, dc: cur.dc });
      const w = await writePower(p.sub, p.set, p.value, p.value);
      if (!w.ok) errors.push(`Plano de energia: ${w.message}`);
    }
  }

  // BCD
  if (t.bcd) {
    const cur = await readBcd();
    if (!backup.bcd) backup.bcd = t.bcd.map((b) => ({ name: b.name, existed: b.name in cur.map, value: cur.map[b.name] || null }));
    for (const b of t.bcd) {
      const r = await exec('bcdedit.exe', ['/set', '{current}', b.name, b.value]);
      if (!r.ok) errors.push(`bcdedit ${b.name}: ${(r.stdout + r.stderr).trim()}`);
    }
  }

  // AppX
  if (t.appx) {
    await ps(`Get-AppxPackage -Name ${q(t.appx + '*')} | Remove-AppxPackage -ErrorAction SilentlyContinue`, { timeout: 180000 });
    const left = await appxPresent([t.appx]);
    if (left[t.appx]) errors.push('O pacote ainda está presente (pode estar em uso).');
  }

  // Custom
  if (t.custom) {
    try {
      const r = await custom[t.custom].apply(hw, prev ? prev.custom : undefined);
      if (!prev) backup.custom = r.backup;
      if (!r.ok) errors.push(r.message);
    } catch (e) { errors.push(String(e.message || e)); }
  }

  if (t.refresh) await refreshInput(t.refresh);

  statusCache = null;
  rollback[id] = backup;
  store.write('rollback', rollback);
  const ok = errors.length === 0;
  store.log('tweaks', `${ok ? 'Aplicado' : 'Aplicado com avisos'}: ${t.title}`, ok ? 'success' : 'warning', { type: 'tweak', id, action: 'revert' });
  return { ok, restart: t.restart, message: ok ? `${t.title}: aplicado.${t.restart ? ' Reinicie para efeito completo.' : ''}` : errors.join(' | ') };
}

// ───────── Reverter
async function revert(id) {
  const t = byId.get(id);
  if (!t) return { ok: false, message: 'Tweak desconhecido.' };
  const hw = await hardware.detect();
  const rollback = store.read('rollback', {});
  const b = rollback[id];
  const errors = [];

  // Registro
  const ops = await regOps(t, hw);
  if (ops.length) {
    let restore;
    if (b && b.reg) {
      restore = b.reg.map((s) => (s.exists ? { key: s.key, name: s.name, type: s.type, value: s.value, svc: s.svc } : { key: s.key, name: s.name, delete: true }));
    } else {
      restore = ops.map((o) => {
        if (o.svc) return { key: o.key, name: o.name, type: 'DWord', value: SVC_DEFAULTS[o.svc] ?? 3, svc: o.svc, ifExists: true };
        if (o.name in DEFAULTS) return { key: o.key, name: o.name, type: typeof DEFAULTS[o.name] === 'number' ? 'DWord' : 'String', value: DEFAULTS[o.name] };
        return { key: o.key, name: o.name, delete: true };
      });
      const cur = await reg.readMany(restore);
      restore = restore.filter((o, i) => !(o.ifExists && !cur[i].exists));
    }
    const w = await reg.writeMany(restore);
    errors.push(...w.errors);
    const autoStart = restore.filter((o) => o.svc && o.value === 2).map((o) => o.svc);
    if (autoStart.length) await ps(autoStart.map((s) => `Start-Service -Name ${q(s)} -ErrorAction SilentlyContinue`).join(';'));
  }

  if (t.power) {
    for (const p of t.power) {
      const saved = b && b.power ? b.power.find((x) => x.sub === p.sub && x.set === p.set) : null;
      if (saved) await writePower(p.sub, p.set, saved.ac, saved.dc);
      else await exec('powercfg.exe', ['/setacvalueindex', 'SCHEME_CURRENT', p.sub, p.set, String(defaultPower(p))]).then(() => exec('powercfg.exe', ['/setdcvalueindex', 'SCHEME_CURRENT', p.sub, p.set, String(defaultPower(p))])).then(() => exec('powercfg.exe', ['/setactive', 'SCHEME_CURRENT']));
    }
  }

  if (t.bcd) {
    for (const x of t.bcd) {
      const saved = b && b.bcd ? b.bcd.find((y) => y.name === x.name) : null;
      const r = saved && saved.existed
        ? await exec('bcdedit.exe', ['/set', '{current}', x.name, saved.value])
        : await exec('bcdedit.exe', ['/deletevalue', '{current}', x.name]);
      if (!r.ok && !/not found|não|element/i.test(r.stdout + r.stderr)) errors.push(`bcdedit ${x.name}: ${(r.stdout + r.stderr).trim()}`);
    }
  }

  if (t.appx) {
    await ps(`$pkg = Get-AppxPackage -AllUsers -Name ${q(t.appx + '*')} | Select-Object -First 1; if ($pkg) { Add-AppxPackage -DisableDevelopmentMode -Register "$($pkg.InstallLocation)\\AppXManifest.xml" -ErrorAction SilentlyContinue }`, { timeout: 180000 });
    const back = await appxPresent([t.appx]);
    if (!back[t.appx]) errors.push('Não foi possível reinstalar automaticamente. Baixe de novo pela Microsoft Store.');
  }

  if (t.custom) {
    try {
      const r = await custom[t.custom].revert(hw, b ? b.custom : undefined);
      if (!r.ok) errors.push(r.message);
    } catch (e) { errors.push(String(e.message || e)); }
  }

  if (t.refresh) await refreshInput(t.refresh);

  statusCache = null;
  delete rollback[id];
  store.write('rollback', rollback);
  const ok = errors.length === 0;
  store.log('tweaks', `${ok ? 'Revertido' : 'Revertido com avisos'}: ${t.title}`, ok ? 'success' : 'warning', { type: 'tweak', id, action: 'apply' });
  return { ok, restart: t.restart, message: ok ? `${t.title}: revertido.` : errors.join(' | ') };
}

function defaultPower(p) {
  if (p.set === '0cc5b647-c1df-4637-891a-dec35c318583') return 10; // core parking: padrão Equilibrado
  if (p.set === 'ee12f906-d277-404b-b6da-e5fa1a576df5') return 2; // ASPM economia máxima
  if (p.set === '48e6b7a6-50f5-4782-a5d4-53bb8f07e226') return 1; // suspensão USB ativada
  return 0;
}

async function applyMany(ids, onProgress) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress && onProgress({ index: i, total: ids.length, id: ids[i] });
    out.push({ id: ids[i], ...(await apply(ids[i])) });
  }
  return out;
}

async function revertAll(onProgress) {
  const ids = Object.keys(store.read('rollback', {}));
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress && onProgress({ index: i, total: ids.length, id: ids[i] });
    out.push({ id: ids[i], ...(await revert(ids[i])) });
  }
  return out;
}

function catalog() {
  return {
    tweaks: TWEAKS.map(({ rule, resolve, custom: c, _ops, ...t }) => ({ ...t, hasRule: !!rule })),
    categories: CATEGORIES,
    presets: PRESETS,
  };
}

function invalidate() { resolvedCache = {}; statusCache = null; }

// Ao abrir: limpa o que versões antigas deixaram (plano de energia próprio, backups de tweaks removidos).
async function migrate() {
  const rollback = store.read('rollback', {});
  let changed = false;
  for (const id of Object.keys(rollback)) if (!byId.has(id)) { delete rollback[id]; changed = true; }
  if (changed) store.write('rollback', rollback);
  if (await custom.removeLegacyPlan()) store.log('system', 'Plano de energia "Velox Desempenho" removido (o Velox não gerencia mais planos).', 'info');
}

// Tweaks que o Velox aplicou (têm backup) mas que não estão mais ativos — normalmente desfeitos por uma atualização do Windows
async function drift() {
  const rollback = store.read('rollback', {});
  const ids = Object.keys(rollback).filter((id) => byId.has(id));
  if (!ids.length) return { items: [], checkedAt: Date.now() };
  const st = await statusAll();
  const items = ids.filter((id) => st[id] && !['applied', 'absent', 'unavailable'].includes(st[id].state))
    .map((id) => ({ id, title: byId.get(id).title, state: st[id].state }));
  const r = { items, checkedAt: Date.now() };
  store.write('drift', r);
  return r;
}

module.exports = { catalog, statusAll, apply, revert, applyMany, revertAll, invalidate, migrate, drift };
