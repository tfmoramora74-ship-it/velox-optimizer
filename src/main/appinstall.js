// Instalação em lote de apps pelo winget (gerenciador oficial da Microsoft). Baixa sempre da fonte oficial de cada app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('./ps');
const store = require('./store');

const CATALOG = [
  { group: 'Jogos', items: [['Valve.Steam', 'Steam'], ['EpicGames.EpicGamesLauncher', 'Epic Games Launcher'], ['ElectronicArts.EADesktop', 'EA App'], ['Blizzard.BattleNet', 'Battle.net'], ['Ubisoft.Connect', 'Ubisoft Connect'], ['GOG.Galaxy', 'GOG Galaxy']] },
  { group: 'Comunicação', items: [['Discord.Discord', 'Discord'], ['Spotify.Spotify', 'Spotify'], ['TeamSpeakSystems.TeamSpeakClient', 'TeamSpeak']] },
  { group: 'Navegadores', items: [['Google.Chrome', 'Google Chrome'], ['Mozilla.Firefox', 'Firefox'], ['Brave.Brave', 'Brave']] },
  { group: 'Streaming e mídia', items: [['OBSProject.OBSStudio', 'OBS Studio'], ['VideoLAN.VLC', 'VLC'], ['Audacity.Audacity', 'Audacity']] },
  { group: 'Desempenho e diagnóstico', items: [['Guru3D.Afterburner', 'MSI Afterburner'], ['REALiX.HWiNFO', 'HWiNFO'], ['CPUID.CPU-Z', 'CPU-Z'], ['TechPowerUp.GPU-Z', 'GPU-Z'], ['Wagnardsoft.DisplayDriverUninstaller', 'DDU'], ['TechPowerUp.NVCleanstall', 'NVCleanstall'], ['Orbmu2k.nvidiaProfileInspector', 'NVIDIA Profile Inspector'], ['Resplendence.LatencyMon', 'LatencyMon']] },
  { group: 'Utilitários', items: [['7zip.7zip', '7-Zip'], ['RARLab.WinRAR', 'WinRAR'], ['Notepad++.Notepad++', 'Notepad++'], ['qBittorrent.qBittorrent', 'qBittorrent'], ['ShareX.ShareX', 'ShareX'], ['Microsoft.PowerToys', 'PowerToys'], ['Rufus.Rufus', 'Rufus']] },
  { group: 'Runtimes (muitos jogos precisam)', items: [['Microsoft.VCRedist.2015+.x64', 'Visual C++ 2015-2022 (x64)'], ['Microsoft.VCRedist.2015+.x86', 'Visual C++ 2015-2022 (x86)'], ['Microsoft.DirectX', 'DirectX (End-User Runtime)'], ['Microsoft.DotNet.DesktopRuntime.8', '.NET Desktop Runtime 8'], ['Oracle.JavaRuntimeEnvironment', 'Java (Minecraft Java e outros)']] },
];

const AGREE = ['--accept-source-agreements', '--disable-interactivity'];

// O atalho "winget" pode ter sido removido por debloaters; nesse caso usa o executável do pacote App Installer
let WINGET = null;
async function wingetPath() {
  if (WINGET) return WINGET;
  const alias = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget.exe');
  if (fs.existsSync(alias)) return (WINGET = alias);
  const r = await require('./ps').ps("$p = Get-AppxPackage Microsoft.DesktopAppInstaller | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { Join-Path $p.InstallLocation 'winget.exe' }");
  const p = r.stdout.trim();
  return (WINGET = p && fs.existsSync(p) ? p : 'winget.exe');
}

async function available() {
  const r = await exec(await wingetPath(), ['--version'], { timeout: 20000 });
  return r.ok ? r.stdout.trim() : null;
}

async function installedIds() {
  const file = path.join(os.tmpdir(), `velox-winget-${Date.now()}.json`);
  await exec(await wingetPath(), ['export', '-o', file, ...AGREE], { timeout: 180000 });
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set((j.Sources || []).flatMap((s) => s.Packages || []).map((p) => String(p.PackageIdentifier).toLowerCase()));
  } catch { return new Set(); } finally { fs.rm(file, { force: true }, () => {}); }
}

async function list() {
  const version = await available();
  if (!version) return { version: null, groups: [] };
  const inst = await installedIds();
  return { version, groups: CATALOG.map((g) => ({ group: g.group, items: g.items.map(([id, name]) => ({ id, name, installed: inst.has(id.toLowerCase()) })) })) };
}

async function install(ids, onProgress) {
  const valid = new Set(CATALOG.flatMap((g) => g.items.map((i) => i[0])));
  const todo = ids.filter((id) => valid.has(id));
  const results = [];
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    const name = CATALOG.flatMap((g) => g.items).find((x) => x[0] === id)[1];
    onProgress && onProgress({ index: i, total: todo.length, label: `Instalando ${name}...` });
    const r = await exec(await wingetPath(), ['install', '--id', id, '-e', '--silent', '--accept-package-agreements', ...AGREE], { timeout: 1800000 });
    const already = /already installed|já está instalado|No newer package/i.test(r.stdout);
    const ok = r.ok || already;
    results.push({ id, name, ok, message: ok ? (already ? 'já instalado' : 'instalado') : (r.stdout.split(/\r?\n/).filter(Boolean).pop() || 'falhou') });
    store.log('apps', `winget ${name}: ${ok ? 'ok' : 'falhou'}`, ok ? 'success' : 'warning');
  }
  return results;
}

module.exports = { list, install };
