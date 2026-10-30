// Desinstalador universal: lista programas (Win32 + Store), roda o desinstalador oficial,
// procura sobras (pastas, atalhos, registro) e faz remoção forçada. Pastas vão para a Lixeira
// e chaves de registro são exportadas para .reg antes de apagar.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec, ps, psJson, q } = require('./ps');
const store = require('./store');

const ENV = (k) => process.env[k] || '';
const ROOTS = [
  ['HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
];

const LIST_SCRIPT = `
$roots = @(@('LocalMachine','${ROOTS[0][1]}','HKLM'),@('LocalMachine','${ROOTS[1][1]}','HKLM'),@('CurrentUser','${ROOTS[2][1]}','HKCU'))
$out = @()
foreach($r in $roots){
  $b=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::($r[0]),[Microsoft.Win32.RegistryView]::Registry64)
  $k=$b.OpenSubKey($r[1]); if(-not $k){ continue }
  foreach($s in $k.GetSubKeyNames()){
    $e=$k.OpenSubKey($s); if(-not $e){ continue }
    $n=$e.GetValue('DisplayName'); $u=$e.GetValue('UninstallString')
    if($n -and ($u -or $e.GetValue('QuietUninstallString')) -and -not $e.GetValue('SystemComponent') -and -not $e.GetValue('ParentKeyName') -and $e.GetValue('ReleaseType') -notmatch 'Update|Hotfix'){
      $out += ,([ordered]@{ key=($r[2] + '\\' + $r[1] + '\\' + $s); name=[string]$n; version=[string]$e.GetValue('DisplayVersion'); publisher=[string]$e.GetValue('Publisher');
        date=[string]$e.GetValue('InstallDate'); size=[double]($e.GetValue('EstimatedSize')); location=[string]$e.GetValue('InstallLocation');
        uninstall=[string]$u; quiet=[string]$e.GetValue('QuietUninstallString'); icon=[string]$e.GetValue('DisplayIcon'); msi=($s -match '^\\{[0-9A-F-]+\\}$' -and [string]$u -match 'msiexec') })
    }
    $e.Close()
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3`;

const APPX_SCRIPT = `$o=@(Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' } | ForEach-Object {
  [ordered]@{ key=$_.PackageFullName; name=$_.Name; version=[string]$_.Version; publisher=($_.Publisher -replace '^CN=([^,]+).*','$1'); location=$_.InstallLocation; family=$_.PackageFamilyName } })
ConvertTo-Json -InputObject @($o) -Compress -Depth 3`;

function dateFmt(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function list() {
  const [w, a] = await Promise.all([psJson(LIST_SCRIPT, { timeout: 60000 }), psJson(APPX_SCRIPT, { timeout: 60000 })]);
  const seen = new Set();
  const programs = (w.ok && Array.isArray(w.data) ? w.data : []).filter((p) => {
    const id = (p.name + '|' + p.version).toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).map((p) => ({ ...p, kind: 'win32', id: p.key, size: p.size ? p.size * 1024 : null, date: dateFmt(p.date) }));
  const store_ = (a.ok && Array.isArray(a.data) ? a.data : []).map((p) => ({ ...p, kind: 'appx', id: p.key, name: prettyAppx(p.name), size: null, date: null }));
  return { programs: programs.sort((x, y) => x.name.localeCompare(y.name, 'pt-BR')), store: store_.sort((x, y) => x.name.localeCompare(y.name, 'pt-BR')), geek: geekPath() };
}

function prettyAppx(n) {
  return n.replace(/^[0-9A-F]{6,}\./i, '').replace(/^Microsoft\./, 'Microsoft ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' ');
}

// Caminho do executável a partir de DisplayIcon / UninstallString
function exePath(s) {
  if (!s) return null;
  let t = String(s).trim();
  const m = t.match(/^"([^"]+)"/) || t.match(/^(.+?\.(exe|ico|dll))/i);
  t = m ? m[1] : t;
  t = t.replace(/,-?\d+$/, '').replace(/%([^%]+)%/g, (_, v) => ENV(v));
  return fs.existsSync(t) ? t : null;
}

const iconCache = new Map();
async function icon(p) {
  const key = p.icon || p.uninstall;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  const file = exePath(p.icon) || exePath(p.uninstall);
  if (file && !/\.ico$/i.test(file)) { try { url = (await app.getFileIcon(file, { size: 'normal' })).toDataURL(); } catch {} }
  else if (file) { try { url = 'data:image/x-icon;base64,' + fs.readFileSync(file).toString('base64'); } catch {} }
  iconCache.set(key, url);
  return url;
}

// Separa executável e argumentos de um UninstallString
function parseCommand(cmd) {
  const s = String(cmd).trim();
  const msi = s.match(/msiexec(\.exe)?\s+\/[IX]\s*(\{[0-9A-F-]+\})/i);
  if (msi) return { file: 'msiexec.exe', args: `/x ${msi[2]}` };
  let m = s.match(/^"([^"]+)"\s*(.*)$/);
  if (m) return { file: m[1], args: m[2] };
  m = s.match(/^(.+?\.exe)\s*(.*)$/i);
  if (m) return { file: m[1], args: m[2] };
  return { file: s, args: '' };
}

async function uninstall(p, { quiet = false } = {}) {
  store.log('uninstaller', `Desinstalando: ${p.name}`, 'info');
  if (p.kind === 'appx') {
    const r = await ps(`Remove-AppxPackage -Package ${q(p.key)} -ErrorAction Stop`, { timeout: 300000 });
    const ok = r.ok && !r.stderr.trim();
    return { ok, message: ok ? `${p.name} removido.` : r.stderr.trim().slice(0, 300) };
  }
  const cmd = quiet && p.quiet ? p.quiet : p.uninstall;
  if (!cmd) return { ok: false, message: 'Este programa não tem desinstalador registrado. Use a remoção forçada.' };
  const { file, args } = parseCommand(cmd);
  if (file !== 'msiexec.exe' && !fs.existsSync(file)) return { ok: false, missing: true, message: 'O desinstalador do programa não existe mais. Use a remoção forçada.' };
  // Espera o desinstalador e também os processos filhos que ele relança a partir do %TEMP% (Inno/NSIS)
  const r = await ps(`$p = Start-Process -FilePath ${q(file)}${args ? ` -ArgumentList ${q(args)}` : ''} -PassThru -Wait
$t=0; while((Get-Process | Where-Object { $_.Path -and ($_.Path -like "$env:TEMP\\*" -and ($_.ProcessName -match '^(Au_|Un_A|_iu|is-|unins|nsu)')) }) -and $t -lt 1800){ Start-Sleep 1; $t++ }
"exit=$($p.ExitCode)"`, { timeout: 60 * 60 * 1000 });
  const still = await exists(p);
  return { ok: !still, stillInstalled: still, message: still ? 'O desinstalador terminou, mas o programa ainda aparece instalado (cancelado ou pendente de reinício).' : `${p.name} desinstalado.`, detail: r.stdout.trim() };
}

async function exists(p) {
  if (p.kind === 'appx') {
    const r = await ps(`[bool](Get-AppxPackage | Where-Object { $_.PackageFullName -eq ${q(p.key)} })`);
    return /True/i.test(r.stdout);
  }
  const r = await exec('reg.exe', ['query', p.key, '/v', 'DisplayName']);
  return r.ok;
}

// ───────── Sobras
const GENERIC = new Set(['microsoft', 'microsoft corporation', 'windows', 'common files', 'program files', 'programs', 'google', 'google llc', 'intel', 'intel corporation', 'nvidia', 'nvidia corporation', 'amd', 'advanced micro devices, inc.', 'packages', 'temp', 'system32', 'users', 'public', 'appdata', 'local', 'roaming', 'programdata', 'software', 'classes', 'policies', 'wow6432node', 'inc', 'llc', 'ltd', 'corporation']);

function cleanName(n) {
  return String(n || '')
    .replace(/\s*\((x64|x86|64-bit|32-bit|64 bits|32 bits|remove only|user|machine)\)\s*/gi, ' ')
    .replace(/\s+v?\d+(\.\d+)+.*$/i, '')
    .replace(/\s+(x64|x86)$/i, '')
    .trim();
}
function usable(n) {
  return n && n.length >= 3 && !GENERIC.has(n.toLowerCase());
}

function safeFolder(p) {
  const norm = path.resolve(p).toLowerCase();
  const forbidden = [ENV('SystemRoot'), ENV('ProgramFiles'), ENV('ProgramFiles(x86)'), ENV('ProgramData'), ENV('APPDATA'), ENV('LOCALAPPDATA'), ENV('USERPROFILE'), path.join(ENV('LOCALAPPDATA'), 'Programs'), 'C:\\', 'C:\\Users']
    .filter(Boolean).map((x) => path.resolve(x).toLowerCase());
  if (forbidden.includes(norm)) return false;
  if (norm.startsWith(path.resolve(ENV('SystemRoot') || 'C:\\Windows').toLowerCase() + '\\')) return false;
  return norm.split('\\').length >= 3;
}

function folderSize(d, depth = 0) {
  let s = 0;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) { if (depth < 25) s += folderSize(p, depth + 1); }
      else { try { s += fs.statSync(p).size; } catch {} }
    }
  } catch {}
  return s;
}

async function leftovers(p) {
  const names = new Set();
  const n = cleanName(p.name);
  if (usable(n)) names.add(n);
  if (usable(p.name)) names.add(p.name.trim());
  if (p.location && usable(path.basename(p.location.replace(/[\\/]+$/, '')))) names.add(path.basename(p.location.replace(/[\\/]+$/, '')));
  const pub = cleanName(p.publisher).replace(/,?\s+(inc|llc|ltd|gmbh|corp(oration)?|s\.a\.|co\.)\.?$/i, '').trim();
  const pubs = [p.publisher, pub].filter((x) => x && x.length >= 2);

  const folders = new Set();
  if (p.location && fs.existsSync(p.location) && safeFolder(p.location)) folders.add(path.resolve(p.location));
  const unExe = exePath(p.uninstall);
  if (unExe) {
    const d = path.dirname(unExe);
    if (safeFolder(d) && [...names].some((x) => path.basename(d).toLowerCase() === x.toLowerCase())) folders.add(d);
  }
  const bases = [ENV('ProgramFiles'), ENV('ProgramFiles(x86)'), ENV('ProgramData'), ENV('APPDATA'), ENV('LOCALAPPDATA'), path.join(ENV('LOCALAPPDATA'), 'Programs'),
    path.join(ENV('APPDATA'), 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(ENV('ProgramData'), 'Microsoft\\Windows\\Start Menu\\Programs')].filter(Boolean);
  for (const b of bases) {
    for (const nm of names) {
      for (const cand of [path.join(b, nm), ...pubs.map((pb) => path.join(b, pb, nm))]) {
        if (fs.existsSync(cand) && safeFolder(cand)) folders.add(path.resolve(cand));
      }
    }
  }
  // Atalhos soltos no Menu Iniciar / Área de Trabalho
  const files = new Set();
  for (const b of [path.join(ENV('APPDATA'), 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(ENV('ProgramData'), 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(ENV('USERPROFILE'), 'Desktop'), path.join(ENV('PUBLIC'), 'Desktop')]) {
    for (const nm of names) { const f = path.join(b, nm + '.lnk'); if (fs.existsSync(f)) files.add(f); }
  }

  const regCands = new Set();
  for (const nm of names) {
    for (const root of ['HKCU\\Software', 'HKLM\\SOFTWARE', 'HKLM\\SOFTWARE\\WOW6432Node']) {
      regCands.add(`${root}\\${nm}`);
      for (const pb of pubs) regCands.add(`${root}\\${pb}\\${nm}`);
    }
  }
  if (p.kind === 'win32') regCands.add(p.key);
  const regs = [];
  for (const k of regCands) {
    const parts = k.split('\\');
    if (parts.length < 3 || GENERIC.has(parts[parts.length - 1].toLowerCase())) continue;
    if ((await exec('reg.exe', ['query', k])).ok) regs.push(k);
  }

  // Remove pastas que estão dentro de outra já listada
  const fl = [...folders].sort((a, b) => a.length - b.length).filter((f, i, arr) => !arr.slice(0, i).some((x) => f.toLowerCase().startsWith(x.toLowerCase() + '\\')));
  return {
    items: [
      ...fl.map((f) => ({ type: 'folder', path: f, size: folderSize(f) })),
      ...[...files].map((f) => ({ type: 'file', path: f, size: (() => { try { return fs.statSync(f).size; } catch { return 0; } })() })),
      ...regs.map((k) => ({ type: 'registry', path: k })),
    ],
  };
}

async function removeLeftovers(items) {
  const backupDir = path.join(store.dir(), 'reg-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  let ok = 0; const failed = [];
  for (const it of items) {
    try {
      if (it.type === 'registry') {
        const file = path.join(backupDir, `${Date.now()}-${it.path.replace(/[\\/:*?"<>|]+/g, '_').slice(-120)}.reg`);
        const e = await exec('reg.exe', ['export', it.path, file, '/y']);
        if (!e.ok) throw new Error('backup falhou');
        const d = await exec('reg.exe', ['delete', it.path, '/f']);
        if (!d.ok) throw new Error((d.stdout + d.stderr).trim());
      } else {
        if (it.type === 'folder' && !safeFolder(it.path)) throw new Error('caminho protegido');
        await shell.trashItem(it.path);
      }
      ok++;
    } catch (e) { failed.push(`${it.path}: ${e.message || e}`); }
  }
  store.log('uninstaller', `Sobras removidas: ${ok}${failed.length ? `, ${failed.length} falharam` : ''}`, failed.length ? 'warning' : 'success');
  return { ok: failed.length === 0, removed: ok, failed, message: failed.length ? `${ok} removidos, ${failed.length} falharam (em uso ou protegidos).` : `${ok} sobra(s) removida(s). Pastas foram para a Lixeira; registro tem backup em reg-backups.` };
}

// ───────── Geek Uninstaller (opcional, o usuário fornece o .exe)
function geekPath() {
  const saved = store.read('settings', {}).geekPath;
  if (saved && fs.existsSync(saved)) return saved;
  const cands = [path.join(ENV('USERPROFILE'), 'Desktop', 'geek.exe'), path.join(ENV('USERPROFILE'), 'Downloads', 'geek.exe'),
    path.join(ENV('ProgramFiles'), 'Geek Uninstaller', 'geek.exe'), path.join(ENV('ProgramFiles(x86)'), 'Geek Uninstaller', 'geek.exe'),
    path.join(path.dirname(app.getPath('exe')), 'tools', 'geek.exe')];
  return cands.find((c) => fs.existsSync(c)) || null;
}
function setGeekPath(p) { store.update('settings', {}, (s) => ({ ...s, geekPath: p })); return geekPath(); }
function openGeek() {
  const g = geekPath();
  if (!g) return { ok: false, message: 'Geek Uninstaller não encontrado.' };
  require('child_process').spawn(g, [], { detached: true, stdio: 'ignore', cwd: path.dirname(g) }).unref();
  return { ok: true };
}

module.exports = { list, icon, uninstall, leftovers, removeLeftovers, geekPath, setGeekPath, openGeek };
