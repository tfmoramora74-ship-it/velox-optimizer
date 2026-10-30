// Gerenciador de inicialização: chaves Run e pasta Inicializar, com o mesmo mecanismo
// do Gerenciador de Tarefas (StartupApproved) — desativar não apaga nada.
const fs = require('fs');
const path = require('path');
const reg = require('./reg');
const store = require('./store');

const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\';
const SOURCES = [
  { loc: 'hkcu-run', label: 'Usuário (registro)', key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKCU\\' + APPROVED + 'Run' },
  { loc: 'hklm-run', label: 'Todos os usuários (registro)', key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKLM\\' + APPROVED + 'Run' },
  { loc: 'hklm-run32', label: 'Todos os usuários (32 bits)', key: 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKLM\\' + APPROVED + 'Run32' },
];
const FOLDERS = [
  { loc: 'user-folder', label: 'Pasta Inicializar (usuário)', dir: path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'), approved: 'HKCU\\' + APPROVED + 'StartupFolder' },
  { loc: 'common-folder', label: 'Pasta Inicializar (todos)', dir: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'), approved: 'HKLM\\' + APPROVED + 'StartupFolder' },
];

async function valuesOf(key) {
  const { psJson } = require('./ps');
  const i = key.indexOf('\\');
  const h = key.slice(0, i); const p = key.slice(i + 1).replace(/'/g, "''");
  const hive = { HKLM: 'LocalMachine', HKCU: 'CurrentUser' }[h];
  const r = await psJson(`$b=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::${hive},[Microsoft.Win32.RegistryView]::Registry64); $k=$b.OpenSubKey('${p}'); $o=@(); if($k){ foreach($n in $k.GetValueNames()){ $v=$k.GetValue($n,$null,'DoNotExpandEnvironmentNames'); if($v -is [byte[]]){ $v=@($v | ForEach-Object {[int]$_}) }; $o+= ,@{ n=$n; v=$v } } }; ConvertTo-Json -InputObject @($o) -Compress -Depth 3`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

function exeOf(cmd) {
  const s = String(cmd || '').trim();
  const m = s.match(/^"([^"]+)"/) || s.match(/^(.+?\.exe)\b/i) || s.match(/^(\S+)/);
  return m ? m[1] : s;
}

async function list() {
  const out = [];
  for (const s of SOURCES) {
    const [vals, appr] = await Promise.all([valuesOf(s.key), valuesOf(s.approved)]);
    for (const v of vals) {
      if (!v.n) continue;
      const a = appr.find((x) => x.n === v.n);
      const enabled = !a || !Array.isArray(a.v) || (a.v[0] & 1) === 0;
      out.push({ id: `${s.loc}:${v.n}`, name: v.n, command: v.v, exe: exeOf(v.v), location: s.label, loc: s.loc, enabled });
    }
  }
  for (const f of FOLDERS) {
    let files = [];
    try { files = fs.readdirSync(f.dir).filter((x) => !/^desktop\.ini$/i.test(x)); } catch {}
    const appr = await valuesOf(f.approved);
    for (const file of files) {
      const a = appr.find((x) => x.n === file);
      const enabled = !a || !Array.isArray(a.v) || (a.v[0] & 1) === 0;
      out.push({ id: `${f.loc}:${file}`, name: file.replace(/\.lnk$/i, ''), command: path.join(f.dir, file), exe: path.join(f.dir, file), location: f.label, loc: f.loc, enabled });
    }
  }
  return out;
}

function approvedBytes(enabled) {
  const b = new Array(12).fill(0);
  b[0] = enabled ? 2 : 3;
  if (!enabled) {
    // FILETIME atual (opcional, o Windows mostra como "desativado em")
    const ft = BigInt(Date.now()) * 10000n + 116444736000000000n;
    for (let i = 0; i < 8; i++) b[4 + i] = Number((ft >> BigInt(8 * i)) & 0xffn);
  }
  return b;
}

async function setEnabled(id, enabled) {
  const idx = id.indexOf(':');
  const loc = id.slice(0, idx); const name = id.slice(idx + 1);
  const src = SOURCES.find((s) => s.loc === loc) || FOLDERS.find((s) => s.loc === loc);
  if (!src) return { ok: false, message: 'Local desconhecido.' };
  const w = await reg.writeMany([{ key: src.approved, name, type: 'Binary', value: approvedBytes(enabled) }]);
  store.log('startup', `${enabled ? 'Habilitado' : 'Desabilitado'} na inicialização: ${name}`, w.ok ? 'success' : 'warning', { type: 'startup', id, enabled: !enabled });
  return { ok: w.ok, message: w.ok ? (enabled ? 'Habilitado.' : 'Desabilitado.') : w.errors.join(' ') };
}

module.exports = { list, setEnabled, SOURCES };
