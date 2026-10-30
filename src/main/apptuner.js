// App Tuner: otimiza apps comuns (inicialização, políticas, configurações e cache), com backup e reversão.
const fs = require('fs');
const path = require('path');
const { exec } = require('./ps');
const reg = require('./reg');
const store = require('./store');
const startup = require('./startup');

const A = process.env.APPDATA || '';
const L = process.env.LOCALAPPDATA || '';
const PD = process.env.ProgramData || 'C:\\ProgramData';
const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const dw = (key, name, value) => ({ key, name, type: 'DWord', value });

const browserPolicies = (key) => [
  dw(key, 'BackgroundModeEnabled', 0), dw(key, 'HardwareAccelerationModeEnabled', 0),
  dw(key, 'NetworkPredictionOptions', 2), dw(key, 'HighEfficiencyModeEnabled', 1),
];
const chromiumCaches = (userData) => [`${userData}\\*\\Cache`, `${userData}\\*\\Code Cache`, `${userData}\\*\\GPUCache`, `${userData}\\*\\DawnGraphiteCache`, `${userData}\\*\\DawnWebGPUCache`, `${userData}\\ShaderCache`, `${userData}\\GrShaderCache`, `${userData}\\component_crx_cache`];

const APPS = [
  {
    id: 'discord', name: 'Discord', icon: 'discord', processes: ['Discord.exe'],
    detect: [`${A}\\discord`],
    desc: 'Desliga a aceleração de hardware, tira da inicialização, segura atualizações em segundo plano e limpa o cache.',
    note: 'O Discord é fechado para aplicar. O overlay fica salvo na sua conta: desligue em Configurações > Overlay do jogo.',
    close: true, reopen: `${L}\\Discord\\Update.exe|--processStart Discord.exe`,
    startup: /discord/i,
    json: [{ file: `${A}\\discord\\settings.json`, set: { enableHardwareAcceleration: false, OPEN_ON_STARTUP: false, SKIP_HOST_UPDATE: true } }],
    caches: [`${A}\\discord\\Cache`, `${A}\\discord\\Code Cache`, `${A}\\discord\\GPUCache`, `${A}\\discord\\DawnGraphiteCache`, `${A}\\discord\\DawnWebGPUCache`],
  },
  {
    id: 'chrome', name: 'Google Chrome', icon: 'chrome', processes: ['chrome.exe'],
    detect: [`${PF}\\Google\\Chrome\\Application\\chrome.exe`, `${PF86}\\Google\\Chrome\\Application\\chrome.exe`, `${L}\\Google\\Chrome\\Application\\chrome.exe`],
    desc: 'Sem rodar em segundo plano, sem aceleração de hardware e sem pré-carregamento; economia de memória ligada, telemetria desligada e cache limpo.',
    note: 'Vale na próxima vez que o navegador abrir. O cache só é limpo com o Chrome fechado.',
    policies: [...browserPolicies('HKLM\\SOFTWARE\\Policies\\Google\\Chrome'), dw('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'MetricsReportingEnabled', 0)],
    caches: chromiumCaches(`${L}\\Google\\Chrome\\User Data`),
  },
  {
    id: 'edge', name: 'Microsoft Edge', icon: 'edge', processes: ['msedge.exe'],
    detect: [`${PF86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${PF}\\Microsoft\\Edge\\Application\\msedge.exe`],
    desc: 'Desliga Startup Boost, segundo plano, aceleração de hardware, barra lateral, compras e telemetria; liga guias adormecidas.',
    note: 'Vale na próxima vez que o Edge abrir.',
    policies: [
      ...browserPolicies('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge'),
      ...[['StartupBoostEnabled', 0], ['DiagnosticData', 0], ['SleepingTabsEnabled', 1], ['EdgeShoppingAssistantEnabled', 0], ['HubsSidebarEnabled', 0], ['WebWidgetAllowed', 0]].map(([n, v]) => dw('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', n, v)),
    ],
    caches: chromiumCaches(`${L}\\Microsoft\\Edge\\User Data`),
  },
  {
    id: 'brave', name: 'Brave', icon: 'brave', processes: ['brave.exe'],
    detect: [`${PF}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${L}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`],
    desc: 'Mesmo pacote dos navegadores e ainda desliga Rewards, Wallet, VPN e Leo (IA).',
    note: 'Se você usa Rewards/Wallet, basta reverter.',
    policies: [
      ...browserPolicies('HKLM\\SOFTWARE\\Policies\\BraveSoftware\\Brave'),
      ...[['BraveRewardsDisabled', 1], ['BraveWalletDisabled', 1], ['BraveVPNDisabled', 1], ['BraveAIChatEnabled', 0], ['MetricsReportingEnabled', 0]].map(([n, v]) => dw('HKLM\\SOFTWARE\\Policies\\BraveSoftware\\Brave', n, v)),
    ],
    caches: chromiumCaches(`${L}\\BraveSoftware\\Brave-Browser\\User Data`),
  },
  {
    id: 'opera-gx', name: 'Opera GX', icon: 'opera', processes: ['opera.exe'],
    detect: [`${A}\\Opera Software\\Opera GX Stable`],
    desc: 'Desliga segundo plano, aceleração de hardware e pré-carregamento; limpa o cache.',
    note: 'O Opera GX precisa estar FECHADO (ele regrava as configurações ao sair).',
    requireClosed: true, startup: /opera\s*gx|opera.*--scheduledautoupdate/i,
    json: [
      { file: `${A}\\Opera Software\\Opera GX Stable\\Preferences`, set: { 'background_mode.enabled': false, 'hardware_acceleration_mode.enabled': false, 'net.network_prediction_options': 2 }, optional: true },
      { file: `${A}\\Opera Software\\Opera GX Stable\\Default\\Preferences`, set: { 'background_mode.enabled': false, 'hardware_acceleration_mode.enabled': false, 'net.network_prediction_options': 2 }, optional: true },
      { file: `${A}\\Opera Software\\Opera GX Stable\\Local State`, set: { 'background_mode.enabled': false, 'hardware_acceleration_mode.enabled': false }, optional: true },
    ],
    caches: [`${L}\\Opera Software\\Opera GX Stable\\Cache`, `${A}\\Opera Software\\Opera GX Stable\\Code Cache`, `${A}\\Opera Software\\Opera GX Stable\\GPUCache`, `${A}\\Opera Software\\Opera GX Stable\\ShaderCache`],
  },
  {
    id: 'firefox', name: 'Mozilla Firefox', icon: 'firefox', processes: ['firefox.exe'],
    detect: [`${PF}\\Mozilla Firefox\\firefox.exe`, `${PF86}\\Mozilla Firefox\\firefox.exe`],
    desc: 'Desliga telemetria, estudos, pré-carregamento de links e processos extras de segundo plano; limpa o cache.',
    note: 'O Firefox precisa estar fechado. As preferências ficam num user.js separado, removido ao reverter.',
    requireClosed: true,
    userjs: {
      profiles: `${A}\\Mozilla\\Firefox\\Profiles\\*`,
      prefs: {
        'toolkit.telemetry.enabled': false, 'toolkit.telemetry.unified': false, 'datareporting.healthreport.uploadEnabled': false,
        'datareporting.policy.dataSubmissionEnabled': false, 'app.shield.optoutstudies.enabled': false, 'app.normandy.enabled': false,
        'browser.newtabpage.activity-stream.feeds.telemetry': false, 'browser.newtabpage.activity-stream.telemetry': false,
        'browser.ping-centre.telemetry': false, 'network.prefetch-next': false, 'network.predictor.enabled': false,
        'network.dns.disablePrefetch': true, 'browser.tabs.unloadOnLowMemory': true, 'browser.newtabpage.activity-stream.showSponsored': false,
        'browser.newtabpage.activity-stream.showSponsoredTopSites': false, 'extensions.pocket.enabled': false,
      },
    },
    caches: [`${L}\\Mozilla\\Firefox\\Profiles\\*\\cache2`, `${L}\\Mozilla\\Firefox\\Profiles\\*\\startupCache`],
  },
  {
    id: 'streamlabs', name: 'Streamlabs Desktop', icon: 'streamlabs', processes: ['Streamlabs OBS.exe', 'Streamlabs Desktop.exe'],
    detect: [`${PF}\\Streamlabs OBS\\Streamlabs OBS.exe`, `${A}\\slobs-client`],
    desc: 'Tira da inicialização e limpa os caches do navegador interno.',
    note: 'O Streamlabs precisa estar fechado (não fechamos para não derrubar uma live). Cenas e configurações não são tocadas.',
    requireClosed: true, startup: /streamlabs|slobs/i,
    caches: [`${A}\\slobs-client\\Cache`, `${A}\\slobs-client\\Code Cache`, `${A}\\slobs-client\\GPUCache`, `${A}\\slobs-plugins\\cef-cache`],
  },
  {
    id: 'adobe-cc', name: 'Adobe Creative Cloud', icon: 'adobe', processes: ['Creative Cloud.exe', 'CCXProcess.exe', 'Adobe Desktop Service.exe', 'CoreSync.exe'],
    detect: [`${PF}\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe`, `${PF86}\\Adobe\\Adobe Creative Cloud`],
    desc: 'Tira o Creative Cloud e o CCXProcess da inicialização e deixa os serviços de atualização e verificação da Adobe em modo manual.',
    note: 'Os apps da Adobe continuam funcionando; o Creative Cloud abre quando você abrir um deles.',
    startup: /adobe|ccxprocess|creative cloud|coresync/i,
    policies: [
      { key: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\AdobeUpdateService', name: 'Start', type: 'DWord', value: 3, ifExists: true },
      { key: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\AGSService', name: 'Start', type: 'DWord', value: 3, ifExists: true },
      { key: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\AGMService', name: 'Start', type: 'DWord', value: 3, ifExists: true },
    ],
    caches: [`${L}\\Adobe\\OOBE\\cache`, `${A}\\Adobe\\Common\\Media Cache Files`],
  },
  {
    id: 'steam', name: 'Steam', icon: 'steam', processes: ['steam.exe'],
    detect: [`${PF86}\\Steam\\steam.exe`, `${PF}\\Steam\\steam.exe`],
    desc: 'Tira da inicialização, desliga o overlay in-game e limpa os caches do navegador interno.',
    note: 'O Steam precisa estar fechado (não fechamos para não derrubar jogo ou download).',
    requireClosed: true, startup: /^steam$|steam\.exe/i,
    vdfOverlay: true,
    caches: [`${L}\\Steam\\htmlcache`, '{steam}\\appcache\\httpcache', '{steam}\\dumps', '{steam}\\logs'],
  },
  {
    id: 'epic', name: 'Epic Games Launcher', icon: 'epic', processes: ['EpicGamesLauncher.exe', 'EpicWebHelper.exe'],
    detect: [`${PF86}\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe`, `${PF}\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe`],
    desc: 'Tira da inicialização e limpa o webcache (pode ter centenas de MB) e logs.',
    note: 'O Epic é fechado para limpar o cache. Login e jogos não são tocados.',
    close: true, startup: /epic\s*games|EpicGamesLauncher/i,
    caches: [`${L}\\EpicGamesLauncher\\Saved\\webcache*`, `${L}\\EpicGamesLauncher\\Saved\\Logs`],
  },
  {
    id: 'ea', name: 'EA App', icon: 'ea', processes: ['EADesktop.exe', 'EABackgroundService.exe', 'EALauncher.exe', 'EACefSubProcess.exe'],
    detect: [`${PF}\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe`],
    desc: 'Tira da inicialização, fecha processos de fundo e limpa o cache do navegador interno.',
    note: 'O EA App é fechado para aplicar. Login e jogos não são tocados.',
    close: true, startup: /EA ?Desktop|EADM|EALauncher/i,
    caches: [`${L}\\Electronic Arts\\EA Desktop\\CEF\\BrowserCache`, `${L}\\Electronic Arts\\EA Desktop\\CEF\\GPUCache`, `${L}\\Electronic Arts\\EA Desktop\\cache`, `${PD}\\EA Desktop\\cache`],
  },
  {
    id: 'ubisoft', name: 'Ubisoft Connect', icon: 'ubisoft', processes: ['UbisoftConnect.exe', 'upc.exe'],
    detect: [`${PF86}\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe`],
    desc: 'Tira da inicialização e limpa o cache.',
    note: 'O Ubisoft Connect é fechado para aplicar.',
    close: true, startup: /ubisoft|uplay|upc\.exe/i,
    text: [{ file: `${L}\\Ubisoft Game Launcher\\settings.yaml`, replace: [[/start_on_windows_start:\s*true/g, 'start_on_windows_start: false']], optional: true }],
    caches: [`${L}\\Ubisoft Game Launcher\\cache`, `${PF86}\\Ubisoft\\Ubisoft Game Launcher\\cache\\http2`, `${PF86}\\Ubisoft\\Ubisoft Game Launcher\\logs`],
  },
  {
    id: 'battlenet', name: 'Battle.net', icon: 'battlenet', processes: ['Battle.net.exe', 'Agent.exe'],
    detect: [`${PF86}\\Battle.net\\Battle.net.exe`, `${PF}\\Battle.net\\Battle.net.exe`],
    desc: 'Tira da inicialização e limpa o cache do navegador interno.',
    note: 'O Battle.net é fechado para aplicar. Seu login não é tocado.',
    close: true, startup: /battle\.net/i,
    caches: [`${L}\\Battle.net\\Cache`, `${L}\\Battle.net\\BrowserCache`, `${L}\\Blizzard Entertainment\\Battle.net\\Cache`, `${PD}\\Battle.net\\Agent\\data\\cache`],
  },
  {
    id: 'spotify', name: 'Spotify', icon: 'spotify', processes: ['Spotify.exe'],
    detect: [`${A}\\Spotify\\Spotify.exe`, `${L}\\Microsoft\\WindowsApps\\Spotify.exe`],
    desc: 'Tira da inicialização e limpa o cache do navegador interno.',
    note: 'Músicas offline, playlists e login NÃO são tocados. O cache só é limpo com o Spotify fechado.',
    startup: /spotify/i,
    caches: [`${L}\\Spotify\\Browser\\Cache`, `${L}\\Spotify\\Browser\\Code Cache`, `${L}\\Spotify\\Browser\\GPUCache`],
  },
  {
    id: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp', processes: ['WhatsApp.exe'],
    detect: [`${L}\\Packages\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm`],
    desc: 'Tira da inicialização do Windows e limpa o cache do navegador interno.',
    note: 'Conversas, mídia e login NÃO são tocados. O cache só é limpo com o WhatsApp fechado.',
    policies: [dw('HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\SystemAppData\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\\WhatsAppStartupTask', 'State', 1)],
    caches: [`${L}\\Packages\\5319275A.WhatsAppDesktop_*\\LocalCache\\EBWebView\\Default\\Cache`, `${L}\\Packages\\5319275A.WhatsAppDesktop_*\\LocalCache\\EBWebView\\Default\\Code Cache`, `${L}\\Packages\\5319275A.WhatsAppDesktop_*\\LocalCache\\EBWebView\\GrShaderCache`],
  },
  {
    id: 'obs', name: 'OBS Studio', icon: 'obs', processes: ['obs64.exe', 'obs32.exe'],
    detect: [`${A}\\obs-studio`],
    desc: 'Desliga aceleração de hardware do Browser Source e atualização automática; limpa o cache para pesar menos durante o jogo.',
    note: 'O OBS precisa estar fechado (não fechamos para não interromper gravação ou live). Cenas e perfis não são tocados.',
    requireClosed: true,
    ini: [{ file: `${A}\\obs-studio\\global.ini`, section: 'General', set: { BrowserHWAccel: 'false', EnableAutoUpdates: 'false' } }],
    caches: [`${A}\\obs-studio\\plugin_config\\obs-browser\\Cache`, `${A}\\obs-studio\\plugin_config\\obs-browser\\GPUCache`, `${A}\\obs-studio\\plugin_config\\obs-browser\\Code Cache`, `${A}\\obs-studio\\crashes`],
  },
];

// ───────── utilitários
async function running(names) {
  const r = await exec('tasklist.exe', ['/fo', 'csv', '/nh']);
  const set = new Set(r.stdout.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((x) => x.toLowerCase()));
  return names.filter((n) => set.has(n.toLowerCase()));
}

async function steamPath() {
  const [v] = await reg.readMany([{ key: 'HKCU\\Software\\Valve\\Steam', name: 'SteamPath' }]);
  return v.exists ? String(v.value).replace(/\//g, '\\') : `${PF86}\\Steam`;
}

// Expande um único segmento com "*" (ex.: ...\User Data\*\Cache ou webcache*)
function expand(p) {
  const parts = p.split('\\');
  const i = parts.findIndex((x) => x.includes('*'));
  if (i < 0) return fs.existsSync(p) ? [p] : [];
  const base = parts.slice(0, i).join('\\');
  const re = new RegExp('^' + parts[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  let names = [];
  try { names = fs.readdirSync(base).filter((n) => re.test(n)); } catch { return []; }
  return names.flatMap((n) => expand([base, n, ...parts.slice(i + 1)].join('\\')));
}

function dirSize(d) {
  let s = 0;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) s += dirSize(p); else { try { s += fs.statSync(p).size; } catch {} }
    }
  } catch {}
  return s;
}

function clearDir(d) {
  let freed = 0;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const size = e.isDirectory() ? dirSize(p) : (() => { try { return fs.statSync(p).size; } catch { return 0; } })();
      try { fs.rmSync(p, { recursive: true, force: true }); freed += size; } catch {}
    }
  } catch {}
  return freed;
}

function setDeep(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

function editIni(text, section, set) {
  const lines = text.split(/\r?\n/);
  let start = lines.findIndex((l) => l.trim().toLowerCase() === `[${section.toLowerCase()}]`);
  if (start < 0) { lines.push(`[${section}]`); start = lines.length - 1; }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  for (const [k, v] of Object.entries(set)) {
    const idx = lines.findIndex((l, i) => i > start && i < end && l.split('=')[0].trim() === k);
    if (idx >= 0) lines[idx] = `${k}=${v}`; else { lines.splice(end, 0, `${k}=${v}`); end++; }
  }
  return lines.join('\r\n');
}

async function cachePaths(app) {
  const sp = app.id === 'steam' ? await steamPath() : '';
  return (app.caches || []).flatMap((c) => expand(c.replace('{steam}', sp)));
}

// ───────── API
async function list() {
  const backups = store.read('apptuner', {});
  const out = [];
  for (const app of APPS) {
    const installed = app.detect.some((p) => fs.existsSync(p));
    let cache = 0;
    if (installed) for (const d of await cachePaths(app)) cache += dirSize(d);
    out.push({ id: app.id, name: app.name, icon: app.icon, desc: app.desc, note: app.note, installed, optimized: !!backups[app.id], cacheBytes: cache, requireClosed: !!app.requireClosed, close: !!app.close });
  }
  return out;
}

async function apply(id) {
  const app = APPS.find((a) => a.id === id);
  if (!app) return { ok: false, message: 'App desconhecido.' };
  const backups = store.read('apptuner', {});
  if (backups[id]) return { ok: true, message: `${app.name} já está otimizado.` };
  const run = await running(app.processes);
  if (app.requireClosed && run.length) return { ok: false, message: `Feche o ${app.name} e tente de novo.` };
  let wasRunning = false;
  if (app.close && run.length) {
    wasRunning = true;
    for (const p of app.processes) await exec('taskkill.exe', ['/f', '/im', p]);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const b = { ts: Date.now(), startup: [], reg: null, files: [] };
  const warnings = [];

  if (app.startup) {
    const entries = await startup.list();
    for (const e of entries.filter((x) => x.enabled && (app.startup.test(x.name) || app.startup.test(x.command)))) {
      const r = await startup.setEnabled(e.id, false);
      if (r.ok) b.startup.push(e.id);
    }
  }
  if (app.policies) {
    const cur = await reg.readMany(app.policies);
    // ifExists: só mexe em serviços que existem (não cria chaves de serviço fantasmas)
    const pol = app.policies.map((o, i) => ({ o, c: cur[i] })).filter(({ o, c }) => !(o.ifExists && !c.exists));
    b.reg = pol.map(({ o, c }) => ({ key: o.key, name: o.name, exists: c.exists, type: c.type, value: c.value }));
    const w = await reg.writeMany(pol.map(({ o }) => o));
    warnings.push(...w.errors);
  }
  if (app.userjs) {
    const MARK = '// ==== Velox Optimizer ====';
    const block = [MARK, ...Object.entries(app.userjs.prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`), MARK].join('\n');
    for (const dir of expand(app.userjs.profiles)) {
      if (!fs.existsSync(path.join(dir, 'prefs.js'))) continue;
      const file = path.join(dir, 'user.js');
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      b.files.push({ file, content: old });
      fs.writeFileSync(file, (old ? old.trimEnd() + '\n\n' : '') + block + '\n');
    }
  }
  for (const j of app.json || []) {
    if (!fs.existsSync(j.file)) { if (!j.optional) warnings.push(`Arquivo não encontrado: ${path.basename(j.file)}`); continue; }
    const text = fs.readFileSync(j.file, 'utf8');
    try {
      const obj = JSON.parse(text);
      for (const [k, v] of Object.entries(j.set)) { if (k.includes('.')) setDeep(obj, k, v); else obj[k] = v; }
      b.files.push({ file: j.file, content: text });
      fs.writeFileSync(j.file, JSON.stringify(obj, null, j.file.endsWith('settings.json') ? 2 : 0));
    } catch { warnings.push(`${path.basename(j.file)} em formato inesperado.`); }
  }
  for (const x of app.ini || []) {
    if (!fs.existsSync(x.file)) { warnings.push('Configuração não encontrada.'); continue; }
    const text = fs.readFileSync(x.file, 'utf8').replace(/^\uFEFF/, '');
    b.files.push({ file: x.file, content: text });
    fs.writeFileSync(x.file, '\uFEFF' + editIni(text, x.section, x.set));
  }
  for (const x of app.text || []) {
    if (!fs.existsSync(x.file)) continue;
    const text = fs.readFileSync(x.file, 'utf8');
    let next = text;
    for (const [re, rep] of x.replace) next = next.replace(re, rep);
    if (next !== text) { b.files.push({ file: x.file, content: text }); fs.writeFileSync(x.file, next); }
  }
  if (app.vdfOverlay) {
    const sp = await steamPath();
    for (const f of expand(`${sp}\\userdata\\*\\config\\localconfig.vdf`)) {
      const text = fs.readFileSync(f, 'utf8');
      const next = text.replace(/("EnableGameOverlay"\s*")1(")/g, '$10$2');
      if (next !== text) { b.files.push({ file: f, content: text }); fs.writeFileSync(f, next); }
    }
  }

  let freed = 0;
  const stillRunning = await running(app.processes);
  if (!stillRunning.length) for (const d of await cachePaths(app)) freed += clearDir(d);

  if (wasRunning && app.reopen) {
    const [exe, args] = app.reopen.split('|');
    if (fs.existsSync(exe)) require('child_process').spawn(exe, args.split(' '), { detached: true, stdio: 'ignore' }).unref();
  }

  backups[id] = b;
  store.write('apptuner', backups);
  const msg = `${app.name} otimizado${freed ? ` (${(freed / 1024 ** 2).toFixed(0)} MB de cache limpos)` : ''}.`;
  store.log('apptuner', msg, warnings.length ? 'warning' : 'success', { type: 'app', id, action: 'revert' });
  return { ok: warnings.length === 0, message: warnings.length ? msg + ' Avisos: ' + warnings.join(' | ') : msg, freed };
}

async function revert(id) {
  const app = APPS.find((a) => a.id === id);
  const backups = store.read('apptuner', {});
  const b = backups[id];
  if (!app || !b) return { ok: false, message: 'Nada a reverter.' };
  if ((app.requireClosed || (b.files && b.files.length)) && (await running(app.processes)).length) return { ok: false, message: `Feche o ${app.name} e tente de novo para reverter.` };
  for (const sid of b.startup || []) await startup.setEnabled(sid, true);
  if (b.reg) await reg.writeMany(b.reg.map((s) => (s.exists ? { key: s.key, name: s.name, type: s.type, value: s.value } : { key: s.key, name: s.name, delete: true })));
  for (const f of b.files || []) {
    try { if (f.content === null) fs.rmSync(f.file, { force: true }); else fs.writeFileSync(f.file, f.content); } catch {}
  }
  delete backups[id];
  store.write('apptuner', backups);
  store.log('apptuner', `${app.name}: otimizações revertidas`, 'info', { type: 'app', id, action: 'apply' });
  return { ok: true, message: `${app.name}: otimizações revertidas.` };
}

async function clearCache(id) {
  const app = APPS.find((a) => a.id === id);
  if (!app) return { ok: false, message: 'App desconhecido.' };
  if ((await running(app.processes)).length) return { ok: false, message: `Feche o ${app.name} para limpar o cache.` };
  let freed = 0;
  for (const d of await cachePaths(app)) freed += clearDir(d);
  store.log('apptuner', `${app.name}: ${(freed / 1024 ** 2).toFixed(0)} MB de cache limpos`, 'success');
  return { ok: true, freed, message: `${(freed / 1024 ** 2).toFixed(0)} MB liberados.` };
}

module.exports = { list, apply, revert, clearCache };
