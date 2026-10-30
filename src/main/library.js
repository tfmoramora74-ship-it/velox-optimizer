// Detecta jogos instalados (Steam, Epic, Riot, EA, Battle.net, Ubisoft, GOG e outros) e descobre o executável principal de cada um.
const fs = require('fs');
const path = require('path');
const reg = require('./reg');
const { psJson } = require('./ps');

const SKIP = /crash|report|setup|unins|redist|launcher|helper|update|^vc_|dxsetup|easyanticheat|battleye|eac_|server|unitycrash|cefprocess|ue4prereq|ueprereq|dotnet|vcredist|errorreporter|install|bootstrap|benchmark|editor|7z|python|java\.exe|node\.exe|overlay|cleanup|activation|touchup|dxwebsetup|oalinst|physx|uplaywebcore|socialclub|pbsvc|beservice|gamebarpresencewriter|vconsole|resourcecompiler|hammer|workshop|steamerrorreporter/i;

const norm = (s) => String(s || '').toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');

// Executável principal: prefere *-Win64-Shipping.exe (Unreal), depois o de nome parecido com o jogo, depois o maior
function mainExe(dir, gameName) {
  const found = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4 && !/^(_commonredist|redist|redistributables|directx|support|__installer|engine\\extras)$/i.test(e.name)) walk(p, depth + 1); }
      else if (/\.exe$/i.test(e.name) && !SKIP.test(e.name)) { try { found.push({ name: e.name, path: p, size: fs.statSync(p).size }); } catch {} }
    }
  };
  walk(dir, 0);
  if (!found.length) return null;
  const shipping = found.find((f) => /-win64-shipping\.exe$/i.test(f.name));
  if (shipping) return shipping;
  const keys = [norm(gameName), norm(path.basename(dir))].filter((k) => k.length >= 3);
  const named = found.filter((f) => keys.some((k) => { const n = norm(f.name); return n.length >= 3 && (k.includes(n) || n.includes(k)); }));
  return (named.length ? named : found).sort((a, b) => b.size - a.size)[0];
}

function parseVdfPaths(text) { return [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\')); }

async function steam() {
  const [v] = await reg.readMany([{ key: 'HKCU\\Software\\Valve\\Steam', name: 'SteamPath' }]);
  if (!v.exists) return [];
  const root = String(v.value).replace(/\//g, '\\');
  let libs = [root];
  try { libs = [...new Set([root, ...parseVdfPaths(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'))])]; } catch {}
  const out = [];
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      const t = fs.readFileSync(path.join(apps, f), 'utf8');
      const name = (t.match(/"name"\s+"([^"]+)"/) || [])[1];
      const dir = (t.match(/"installdir"\s+"([^"]+)"/) || [])[1];
      if (!name || !dir || /redistributable|proton|steamworks|soundtrack|dedicated server|sdk/i.test(name)) continue;
      const exe = mainExe(path.join(apps, 'common', dir), name);
      if (exe) out.push({ name, exe: exe.name, path: exe.path, source: 'Steam' });
    }
  }
  return out;
}

function epic() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch { return []; }
  return files.map((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!j.LaunchExecutable || !j.InstallLocation || /UE_\d|Unreal Engine/i.test(j.DisplayName)) return null;
      // Fortnite e outros usam um bootstrapper; o processo real costuma ser o *-Shipping
      const launch = path.join(j.InstallLocation, j.LaunchExecutable);
      const shipping = mainExe(j.InstallLocation, j.DisplayName);
      const exe = shipping && /shipping/i.test(shipping.name) ? shipping : { name: path.basename(launch), path: launch };
      return { name: j.DisplayName, exe: exe.name, path: exe.path, source: 'Epic' };
    } catch { return null; }
  }).filter(Boolean);
}

// Riot, EA, Battle.net, Ubisoft, GOG, Rockstar etc. via entradas de desinstalação
async function fromUninstall() {
  const r = await psJson(`$o=@(); foreach($k in 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'){ Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.InstallLocation -and ($_.Publisher -match 'Riot|Electronic Arts|Blizzard|Ubisoft|GOG|Rockstar|Activision|Bethesda|Mojang|Roblox|Garena|Tencent|miHoYo|HoYoverse|Krafton|Bungie|Wargaming|Grinding Gear' -or $_.PSChildName -match '^(Riot Game|Steam App|Uplay Install)') } | ForEach-Object { $o += ,@{ n=$_.DisplayName; l=$_.InstallLocation; p=$_.Publisher } } }; ConvertTo-Json -InputObject @($o) -Compress`);
  const KNOWN = { valorant: 'VALORANT-Win64-Shipping.exe', 'league of legends': 'League of Legends.exe' };
  const out = [];
  for (const g of r.ok && Array.isArray(r.data) ? r.data : []) {
    if (/launcher|connect|battle\.net|ea app|desktop app|client|galaxy|riot client|social club|updater|redistributable|anticheat|vanguard/i.test(g.n)) continue;
    const known = Object.entries(KNOWN).find(([k]) => g.n.toLowerCase().includes(k));
    let exe = null;
    if (known) {
      const hit = mainExeNamed(g.l, known[1]);
      exe = hit || { name: known[1], path: '' };
    } else exe = fs.existsSync(g.l) ? mainExe(g.l, g.n) : null;
    if (exe) out.push({ name: g.n, exe: exe.name, path: exe.path, source: g.p || 'Outro' });
  }
  return out;
}

function mainExeNamed(dir, name) {
  let hit = null;
  const walk = (d, depth) => {
    if (hit || depth > 5) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.toLowerCase() === name.toLowerCase()) { hit = { name: e.name, path: p }; return; }
    }
  };
  walk(dir, 0);
  return hit;
}

async function scan() {
  const all = [...await steam(), ...epic(), ...await fromUninstall()];
  const seen = new Set();
  return all.filter((g) => { const k = g.exe.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

module.exports = { scan };
