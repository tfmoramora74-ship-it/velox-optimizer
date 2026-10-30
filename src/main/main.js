const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Modo portátil: o .exe portátil (ou um arquivo "portable.txt" ao lado do executável) guarda tudo numa pasta vizinha
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || (fs.existsSync(path.join(path.dirname(process.execPath), 'portable.txt')) ? path.dirname(process.execPath) : null);
if (PORTABLE_DIR) app.setPath('userData', path.join(PORTABLE_DIR, 'Velox-Data'));
// Desenvolvimento/capturas: pasta de dados alternativa (não conflita com o Velox instalado aberto)
if (process.env.VELOX_USERDATA) app.setPath('userData', process.env.VELOX_USERDATA);
const { exec, ps, psJson, q } = require('./ps');
const store = require('./store');
const hardware = require('./hardware');
const tweaks = require('./tweaks/engine');
const memory = require('./memory');
const gamemode = require('./gamemode');
const network = require('./network');
const cleaner = require('./cleaner');
const startup = require('./startup');
const apptuner = require('./apptuner');
const fps = require('./fps');
const uninstaller = require('./uninstaller');
const maintenance = require('./maintenance');
const services = require('./services');
const bench = require('./bench');
const profiles = require('./profiles');
const devices = require('./devices');
const appinstall = require('./appinstall');
const power = require('./power');
const library = require('./library');
const bootguard = require('./bootguard');
const nvidia = require('./nvidia');
const safety = require('./safety');
const SAFE = process.env.VELOX_SAFE === '1';
let bootState = { status: 'idle' };

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const DEFAULT_SETTINGS = { bootGuard: true, dohEnabled: false, startWithWindows: false, minimizeToTray: true, restorePointBeforeBatch: true, confirmRisky: true, goal: 'competitive', onboarded: false, notifications: true };

let win = null;
let tray = null;
let quitting = false;
let isAdmin = false;

const settings = () => ({ ...DEFAULT_SETTINGS, ...store.read('settings', {}) });

// Menos processos e memória do Chromium: sem renderer "reserva" pré-aberto, sem integração de mídia/teclas de mídia
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,HardwareMediaKeyHandling,MediaSessionService,WidgetLayering');
app.commandLine.appendSwitch('disable-http-cache');

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1100, minHeight: 700, frame: false, backgroundColor: '#0b0c0f', show: false,
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.show(); uiOn(); });
  // Fechar com "minimizar para a bandeja" ativo DESTRÓI a janela (libera ~150 MB); o app continua na bandeja
  // e recria a janela em ~0,5 s quando você abre de novo (window-all-closed não encerra o app nesse caso).
  // Com jogo rodando (sessão do Game Mode), a janela aberta só lê memória: nada de consultar a GPU no meio da partida
  const uiOn = () => memory.demand('ui', { ms: 3000, full: !gamemode.session });
  const uiOff = () => memory.demand('ui', null);
  win.on('show', uiOn); win.on('restore', uiOn); win.on('focus', uiOn);
  win.on('hide', uiOff); win.on('minimize', uiOff);
  win.on('closed', () => { win = null; uiOff(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  if (!fs.existsSync(ICON)) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Velox Optimizer');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir Velox Optimizer', click: showWindow },
    { label: gamemode.session ? 'Encerrar Game Mode' : 'Iniciar Game Mode', click: () => (gamemode.session ? gamemode.stop() : gamemode.start(null, true)) },
    { label: 'Limpar memória agora', click: () => memory.clean('full') },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  gamemode.on('change', () => tray && tray.setContextMenu(menu()));
  tray.on('click', showWindow);
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

async function checkAdmin() {
  const r = await exec('net.exe', ['session']);
  return r.ok;
}

async function relaunchAsAdmin() {
  const exe = process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const argList = args.length ? ` -ArgumentList ${args.map((a) => q(`"${a}"`)).join(',')}` : '';
  const r = await ps(`Start-Process -FilePath ${q(exe)}${argList} -Verb RunAs`);
  if (r.ok && !r.stderr.trim()) { quitting = true; app.quit(); }
  return { ok: r.ok };
}

async function createRestorePoint(description = 'Velox Optimizer') {
  const script = `
$k='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'
$old=(Get-ItemProperty -Path $k -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
New-ItemProperty -Path $k -Name SystemRestorePointCreationFrequency -Value 0 -PropertyType DWord -Force | Out-Null
$ok=$true; $msg=''
try { Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description ${q(description)} -RestorePointType MODIFY_SETTINGS -ErrorAction Stop } catch { $ok=$false; $msg=$_.Exception.Message }
if ($old -eq $null) { Remove-ItemProperty -Path $k -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $k -Name SystemRestorePointCreationFrequency -Value $old }
ConvertTo-Json -Compress @{ ok=$ok; msg=$msg }`;
  const r = await psJson(script, { timeout: 300000 });
  const ok = r.ok && r.data && r.data.ok;
  store.log('system', ok ? 'Ponto de restauração criado' : 'Falha ao criar ponto de restauração', ok ? 'success' : 'error');
  return { ok, message: ok ? 'Ponto de restauração criado.' : (r.data && r.data.msg) || 'Falha ao criar ponto de restauração.' };
}

async function setStartWithWindows(on) {
  const name = 'VeloxOptimizer';
  if (!on) { await exec('schtasks.exe', ['/delete', '/tn', name, '/f']); return { ok: true }; }
  const target = app.isPackaged ? `"${process.execPath}" --tray` : `"${process.execPath}" "${app.getAppPath()}" --tray`;
  const r = await exec('schtasks.exe', ['/create', '/tn', name, '/tr', target, '/sc', 'onlogon', '/rl', 'highest', '/f']);
  return { ok: r.ok, message: r.ok ? '' : 'Não foi possível criar a tarefa de inicialização (execute como administrador).' };
}

async function recommendations() {
  const hw = await hardware.detect();
  const status = await tweaks.statusAll();
  const cat = tweaks.catalog();
  const goal = settings().goal;
  const preset = cat.presets.find((p) => p.id === goal) || cat.presets[0];
  const recommended = [], skipped = [], active = [];
  for (const id of preset.tweaks) {
    const t = cat.tweaks.find((x) => x.id === id);
    const s = status[id];
    if (!t || !s) continue;
    if (s.state === 'applied' || s.state === 'absent') active.push({ id, title: t.title });
    else if (s.rule.level === 'block' || s.state === 'unavailable') skipped.push({ id, title: t.title, reason: s.rule.reason || 'Não disponível neste PC.' });
    else recommended.push({ id, title: t.title, desc: t.desc, risk: t.risk, warn: s.rule.level === 'warn' ? s.rule.reason : null });
  }
  const score = Math.round((active.length / Math.max(1, active.length + recommended.length)) * 100);
  return { preset: { id: preset.id, name: preset.name }, recommended, skipped, active, score, hw };
}

async function processes() {
  const r = await psJson("$o=@(Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle,@{n='ws';e={$_.WorkingSet64}}); ConvertTo-Json -InputObject @($o) -Compress");
  return r.ok && Array.isArray(r.data) ? r.data.map((p) => ({ pid: p.Id, name: p.ProcessName + '.exe', title: p.MainWindowTitle, ws: p.ws })) : [];
}

// ───────── Automações (rodam enquanto o Velox estiver aberto ou na bandeja)
const AUTO_DEFAULT = { weeklyClean: false, cleanCats: ['user-temp', 'win-temp', 'thumbs', 'dumps', 'wu', 'do'], weeklyRestore: false, intervalDays: 7, lastClean: 0, lastRestore: 0 };
const automation = () => ({ ...AUTO_DEFAULT, ...store.read('automation', {}) });
async function runAutomations() {
  const a = automation();
  const due = (last) => Date.now() - (last || 0) > a.intervalDays * 864e5;
  if (gamemode.session) return; // nunca no meio de uma partida
  if (a.weeklyRestore && due(a.lastRestore)) {
    const r = await createRestorePoint('Velox Optimizer - automático');
    store.update('automation', {}, (x) => ({ ...x, lastRestore: Date.now(), lastRestoreOk: r.ok }));
  }
  if (a.weeklyClean && due(a.lastClean)) {
    const r = await cleaner.clean(a.cleanCats);
    store.update('automation', {}, (x) => ({ ...x, lastClean: Date.now(), lastCleanFreed: r.freed }));
  }
}

async function checkDrift(notify) {
  const r = await tweaks.drift();
  send('drift', r);
  if (notify && r.items.length && settings().notifications && Notification.isSupported()) {
    const n = new Notification({ title: 'Velox Optimizer', body: `${r.items.length} otimização(ões) foram desfeitas (provavelmente por uma atualização do Windows). Clique para reaplicar.`, icon: fs.existsSync(ICON) ? ICON : undefined });
    n.on('click', () => { showWindow(); send('navigate', 'dashboard'); });
    n.show();
  }
  return r;
}

// ───────── IPC
const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
  try { return await fn(...args); } catch (err) { return { ok: false, message: String((err && err.message) || err) }; }
});

function registerIpc() {
  handle('app:info', async () => ({ version: app.getVersion(), isAdmin, dataDir: store.dir(), packaged: app.isPackaged, portable: !!PORTABLE_DIR }));
  handle('auto:get', () => automation());
  handle('auto:set', (p) => { store.write('automation', { ...automation(), ...p }); return automation(); });
  handle('auto:runNow', async () => { store.update('automation', {}, (x) => ({ ...x, lastClean: 0, lastRestore: 0 })); await runAutomations(); return automation(); });
  handle('setup:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Exportar setup do Velox', defaultPath: `velox-setup-${new Date().toISOString().slice(0, 10)}.velox`, filters: [{ name: 'Setup do Velox', extensions: ['velox'] }] });
    if (r.canceled || !r.filePath) return { ok: false, message: 'Cancelado.' };
    const { presentMon, geekPath, ...cleanSettings } = settings();
    const data = {
      format: 'velox-setup', version: app.getVersion(), exportedAt: new Date().toISOString(),
      settings: cleanSettings,
      tweaks: Object.keys(store.read('rollback', {})),
      services: Object.keys(store.read('services-backup', {})),
      apps: Object.keys(store.read('apptuner', {})),
      gamemode: { options: store.read('gamemode-options', {}), games: store.read('gamemode-games', []) },
      profiles: profiles.list().map(({ backup, ...p }) => p),
      autoStandby: store.read('auto-standby', {}),
    };
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
    store.log('system', `Setup exportado: ${path.basename(r.filePath)}`, 'success');
    return { ok: true, message: `Setup salvo em ${r.filePath}` };
  });
  handle('setup:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar setup do Velox', filters: [{ name: 'Setup do Velox', extensions: ['velox', 'json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { const d = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); return d.format === 'velox-setup' ? d : { error: 'Arquivo não é um setup do Velox.' }; } catch { return { error: 'Arquivo inválido.' }; }
  });
  handle('setup:importBasics', async (d) => {
    const { onboarded, ...s } = d.settings || {};
    store.write('settings', { ...settings(), ...s });
    if (d.gamemode) { gamemode.setOptions(d.gamemode.options || {}); gamemode.setCustomGames(d.gamemode.games || []); }
    if (d.autoStandby) memory.autoSet(d.autoStandby);
    for (const p of d.profiles || []) await profiles.save(p);
    store.log('system', 'Setup importado (preferências, Game Mode e perfis)', 'success');
    return { ok: true };
  });
  handle('app:relaunchAdmin', relaunchAsAdmin);
  handle('win:minimize', () => win && win.minimize());
  handle('win:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win && win.close());
  handle('shell:open', (url) => /^(https?:\/\/|ms-windows-store:\/\/)/.test(url) && shell.openExternal(url));
  handle('shell:openPath', (p) => shell.openPath(p));

  handle('settings:get', () => settings());
  handle('settings:set', async (patch) => {
    const next = { ...settings(), ...patch };
    store.write('settings', next);
    if ('startWithWindows' in patch) { const r = await setStartWithWindows(!!patch.startWithWindows); if (!r.ok) return { ...next, error: r.message }; }
    return next;
  });

  handle('hw:detect', (force) => hardware.detect(!!force));
  handle('hw:bios', () => hardware.bios());
  handle('monitor:sample', () => memory.sample());
  handle('activity:list', () => store.read('activity', []));
  handle('activity:clear', () => { store.write('activity', []); return []; });
  handle('activity:undo', async (entryId) => {
    const entry = store.read('activity', []).find((a) => a.id === entryId);
    if (!entry || !entry.undo || entry.undone) return { ok: false, message: 'Esta ação não pode ser desfeita.' };
    const u = entry.undo;
    let r;
    switch (u.type) {
      case 'tweak': r = u.action === 'revert' ? await tweaks.revert(u.id) : await tweaks.apply(u.id); break;
      case 'services': r = u.action === 'revert' ? await services.revert(u.names) : await services.apply(u.names); break;
      case 'startup': r = await startup.setEnabled(u.id, u.enabled); break;
      case 'app': r = u.action === 'revert' ? await apptuner.revert(u.id) : await apptuner.apply(u.id); break;
      case 'dns': r = await network.restoreDns(); break;
      case 'nic': r = await network.nicRevert(u.name); break;
      case 'tcp': r = await network.tcpApply('default'); break;
      case 'qos': r = await network.qosRemove(); break;
      case 'device': r = await devices.restore(u.id); break;
      case 'profile': r = await profiles.remove(u.exe); break;
      case 'powerplan': r = await power.activate(u.guid); break;
      case 'nvidia': r = await nvidia.restore(); break;
      default: r = { ok: false, message: 'Tipo de ação desconhecido.' };
    }
    if (r && r.ok !== false) store.update('activity', [], (list) => list.map((a) => (a.id === entryId ? { ...a, undone: true } : a)));
    return r && r.message ? r : { ok: r ? r.ok !== false : false, message: 'Desfeito.' };
  });
  handle('system:restorePoint', (d) => createRestorePoint(d));
  handle('system:processes', processes);
  handle('system:restart', () => exec('shutdown.exe', ['/r', '/t', '5', '/c', 'Reiniciando para aplicar as otimizações do Velox Optimizer']));

  handle('tweaks:catalog', () => tweaks.catalog());
  handle('tweaks:status', () => tweaks.statusAll());
  handle('tweaks:apply', async (id) => {
    const r = await tweaks.apply(id);
    if (r.ok && r.restart) await bootguard.arm({ tweakIds: [id] });
    return r;
  });
  handle('tweaks:revert', (id) => tweaks.revert(id));
  handle('tweaks:applyMany', async (ids, opts = {}) => {
    if (opts.restorePoint) { send('progress', { label: 'Criando ponto de restauração...' }); await createRestorePoint('Velox Optimizer - antes dos tweaks'); }
    const r = await tweaks.applyMany(ids, (p) => send('progress', { ...p, label: 'Aplicando otimizações...' }));
    send('progress', null);
    const needBoot = r.filter((x) => x.ok && x.restart).map((x) => x.id);
    if (needBoot.length) await bootguard.arm({ tweakIds: needBoot });
    return r;
  });
  handle('tweaks:revertAll', async () => { const r = await tweaks.revertAll((p) => send('progress', { ...p, label: 'Revertendo...' })); send('progress', null); return r; });
  handle('tweaks:recommendations', recommendations);
  handle('tweaks:drift', () => checkDrift(false));
  handle('tweaks:driftCached', () => store.read('drift', { items: [] }));

  handle('memory:counters', () => memory.counters());
  handle('memory:clean', (level) => memory.clean(level));
  handle('timer:enable', (v) => memory.timerEnable(v));
  handle('timer:disable', () => memory.timerDisable());
  handle('timer:status', () => memory.timerStatus());

  handle('gamemode:state', () => gamemode.state());
  handle('gamemode:start', async (pid, name) => gamemode.start(pid ? { pid, name } : null, true));
  handle('gamemode:stop', () => gamemode.stop());
  handle('gamemode:options', (o) => gamemode.setOptions(o));
  handle('gamemode:games', (list) => gamemode.setCustomGames(list));

  handle('net:adapters', () => network.adapters());
  handle('net:providers', () => network.PROVIDERS);
  handle('net:benchmark', async () => { const r = await network.benchmark((p) => send('progress', { ...p, label: `Testando ${p.name}...` })); send('progress', null); return r; });
  handle('net:lastBenchmark', () => network.lastBenchmark());
  handle('net:applyDns', async (id, index, opts) => {
    const r = await network.applyDns(id, index, opts);
    if (r.ok && settings().dohEnabled) await network.dohSet(true);
    return r;
  });
  handle('net:dohState', () => network.dohState());
  handle('net:dohSet', async (on) => { const r = await network.dohSet(on); if (r.ok) store.write('settings', { ...settings(), dohEnabled: on }); return r; });
  handle('net:restoreDns', () => network.restoreDns());
  handle('net:ping', (host, count) => network.ping(host, count));
  handle('net:repair', (id) => network.repair(id));

  handle('net:monStart', (hosts) => network.pingMonitorStart(hosts, (s) => send('pingSample', s)));
  handle('net:monStop', () => network.pingMonitorStop());
  handle('net:monActive', () => network.pingMonitorActive());
  handle('net:nicProps', (i) => network.nicProperties(i));
  handle('net:nicApply', (name, kws) => network.nicApply(name, kws));
  handle('net:nicRevert', (name) => network.nicRevert(name));
  handle('net:tcpState', () => network.tcpState());
  handle('net:tcpApply', (id) => network.tcpApply(id));
  handle('net:qosList', () => network.qosList());
  handle('net:qosApply', (exes) => network.qosApply(exes || gamemode.allGames()));
  handle('net:qosRemove', () => network.qosRemove());
  handle('timer:measure', (n) => memory.measureSleep(n));
  handle('memory:autoGet', () => memory.autoGet());
  handle('memory:autoSet', (p) => memory.autoSet(p));

  handle('maint:points', () => maintenance.restorePoints());
  handle('maint:enable', () => maintenance.enableRestore());
  handle('maint:delete', (seq) => maintenance.deleteRestorePoint(seq));
  handle('maint:restore', (seq) => maintenance.restoreTo(seq));
  handle('maint:repairs', () => maintenance.repairList());
  handle('maint:repair', async (id) => { const x = maintenance.repairList().find((r) => r.id === id); send('progress', { label: `${x ? x.label : id}... (pode demorar)` }); try { return await maintenance.repair(id); } finally { send('progress', null); } });

  handle('svc:list', () => services.list());
  handle('svc:apply', (names) => services.apply(names));
  handle('svc:revert', (names) => services.revert(names));

  handle('cleaner:scan', () => cleaner.scan());
  handle('cleaner:clean', (ids) => cleaner.clean(ids));

  handle('startup:list', () => startup.list());
  handle('startup:set', (id, on) => startup.setEnabled(id, on));

  handle('apps:list', () => apptuner.list());
  handle('apps:apply', (id) => apptuner.apply(id));
  handle('apps:revert', (id) => apptuner.revert(id));
  handle('apps:clearCache', (id) => apptuner.clearCache(id));

  handle('uninst:list', () => uninstaller.list());
  handle('uninst:icon', (p) => uninstaller.icon(p));
  handle('uninst:run', async (p, opts) => { send('progress', { label: `Desinstalando ${p.name}... (conclua a janela do desinstalador)` }); try { return await uninstaller.uninstall(p, opts); } finally { send('progress', null); } });
  handle('uninst:leftovers', async (p) => { send('progress', { label: 'Procurando sobras...' }); try { return await uninstaller.leftovers(p); } finally { send('progress', null); } });
  handle('uninst:remove', (items) => uninstaller.removeLeftovers(items));
  handle('uninst:openGeek', () => uninstaller.openGeek());
  handle('uninst:pickGeek', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Selecione o geek.exe', filters: [{ name: 'Geek Uninstaller', extensions: ['exe'] }], properties: ['openFile'] });
    return r.canceled || !r.filePaths[0] ? uninstaller.geekPath() : uninstaller.setGeekPath(r.filePaths[0]);
  });

  handle('lib:scan', () => library.scan());
  handle('nv:read', () => nvidia.read());
  handle('nv:write', (changes) => nvidia.write(changes));
  handle('nv:restore', () => nvidia.restore());
  handle('nv:available', () => nvidia.available());
  handle('report:save', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Salvar relatório do PC', defaultPath: `relatorio-pc-${new Date().toISOString().slice(0, 10)}.html`, filters: [{ name: 'Página HTML', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return { ok: false, message: 'Cancelado.' };
    send('progress', { label: 'Montando o relatório...' });
    try {
      fs.writeFileSync(r.filePath, await require('./report').build(app.getVersion()));
      shell.openPath(r.filePath);
      return { ok: true, message: 'Relatório salvo e aberto no navegador.' };
    } finally { send('progress', null); }
  });
  handle('pw:list', () => power.list());
  handle('pw:activate', (g) => power.activate(g));
  handle('pw:install', (id) => power.install(id, true));
  handle('pw:remove', (g) => power.remove(g));
  handle('pw:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar plano de energia (.pow)', filters: [{ name: 'Plano de energia', extensions: ['pow'] }], properties: ['openFile'] });
    return r.canceled || !r.filePaths[0] ? { ok: false, message: 'Cancelado.' } : power.importPow(r.filePaths[0]);
  });
  handle('pw:export', async (g, name) => {
    const r = await dialog.showSaveDialog(win, { title: 'Exportar plano de energia', defaultPath: `${(name || 'plano').replace(/[\\/:*?"<>|]/g, '')}.pow`, filters: [{ name: 'Plano de energia', extensions: ['pow'] }] });
    return r.canceled || !r.filePath ? { ok: false, message: 'Cancelado.' } : power.exportPow(g, r.filePath);
  });
  handle('wg:list', () => appinstall.list());
  handle('wg:install', async (ids) => { try { return await appinstall.install(ids, (p) => send('progress', p)); } finally { send('progress', null); } });
  handle('dev:list', () => devices.list());
  handle('dev:msi', async (id, on) => { const r = await devices.setMsi(id, on); if (r.ok) await bootguard.arm({ deviceIds: [id] }); return r; });
  handle('dev:affinity', async (id, cpu) => { const r = await devices.setAffinity(id, cpu); if (r.ok) await bootguard.arm({ deviceIds: [id] }); return r; });
  handle('boot:check', () => bootState);
  handle('safety:notices', () => ({ restore: store.read('restore-notice', null), video: store.read('video-alert', null) }));
  handle('safety:dismiss', (kind) => { store.write(kind === 'video' ? 'video-alert' : 'restore-notice', null); return true; });
  handle('safety:revertVideo', async () => {
    const a = store.read('video-alert', null);
    if (!a) return { ok: false, message: 'Nada para reverter.' };
    const done = [];
    for (const id of a.suspects.tweaks || []) { const r = await tweaks.revert(id); if (r.ok) done.push(id); }
    for (const id of a.suspects.devices || []) await devices.restore(id);
    if (a.suspects.nvidia) await nvidia.restore();
    store.write('video-alert', null);
    store.log('system', `Ajustes de vídeo revertidos após falha do driver: ${done.length} tweak(s), ${(a.suspects.devices || []).length} dispositivo(s)${a.suspects.nvidia ? ', NVIDIA' : ''}`, 'warning');
    return { ok: true, message: 'Ajustes de vídeo revertidos. Reinicie o PC para garantir.' };
  });
  handle('boot:disarm', () => bootguard.disarm());
  handle('dev:restore', (id) => devices.restore(id));
  handle('prof:list', () => ({ profiles: profiles.list(), defaults: profiles.DEFAULT, threads: require('os').cpus().length }));
  handle('prof:save', (p) => profiles.save(p));
  handle('prof:remove', (exe) => profiles.remove(exe));
  handle('prof:pickExe', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Escolha o executável do jogo/app', filters: [{ name: 'Programas', extensions: ['exe'] }], properties: ['openFile'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  handle('bench:run', async (opts) => { try { return await bench.run(opts, (p) => send('progress', p)); } finally { send('progress', null); } });
  handle('bench:list', () => bench.list());
  handle('bench:remove', (id) => bench.remove(id));

  handle('fps:status', () => fps.status());
  handle('fps:pickExe', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Selecione o PresentMon.exe', filters: [{ name: 'PresentMon', extensions: ['exe'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return fps.status();
    return fps.setExe(r.filePaths[0]);
  });
  handle('fps:start', (pid) => fps.start(pid));
  handle('fps:stop', () => fps.stop());
  handle('fps:live', () => fps.live());
}

app.whenReady().then(async () => {
  isAdmin = await checkAdmin();
  try { await bootguard.sanityCheck(); bootState = bootguard.check(); } catch {}
  registerIpc();
  // Iniciado com o Windows (--tray): não cria janela nenhuma até você abrir pela bandeja
  if (!process.argv.includes('--tray')) createWindow();
  createTray();
  gamemode.on('change', (s) => {
    send('gamemode', s);
    if (win && win.isVisible() && !win.isMinimized()) memory.demand('ui', { ms: 3000, full: !s.active });
  });
  if (!SAFE) {
    memory.autoStart();
    profiles.start();
    gamemode.recover().catch(() => {});
  }
  // VELOX_SAFE=1: modo de teste — nenhuma ação automática no sistema (Game Mode, perfis, automações, migrações)
  if (SAFE) return;
  // Tarefas de fundo começam depois que a interface já abriu, para não disputar CPU com ela
  setTimeout(async () => {
    try {
      const restored = await safety.checkSystemRestore();
      if (restored) { store.write('restore-notice', restored); send('restored', restored); }
    } catch {}
    tweaks.migrate().catch(() => {}); hardware.detect().catch(() => {});
    // "Iniciar com o Windows" ligado mas a tarefa sumiu (ex.: Restauração do Sistema): recria
    if (settings().startWithWindows && !(await exec('schtasks.exe', ['/query', '/tn', 'VeloxOptimizer'])).ok) setStartWithWindows(true).catch(() => {});
  }, 4000);
  setTimeout(() => videoWatch(), 10000);
  setInterval(() => videoWatch(), 3 * 60 * 1000);
  setTimeout(() => driftIfNeeded().catch(() => {}), 60000);
  setTimeout(() => runAutomations().catch(() => {}), 120000);
  setInterval(() => runAutomations().catch(() => {}), 6 * 3600 * 1000);
  globalShortcut.register('Control+Shift+M', () => { if (win && win.isVisible() && win.isFocused()) win.close(); else showWindow(); });
});

// Vigia de vídeo: se o driver travou/reiniciou desde a última olhada, avisa na hora
async function videoWatch() {
  try {
    const r = await safety.checkVideo();
    if (!r) return;
    store.write('video-alert', { ...r, ts: Date.now() });
    send('video', r);
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Velox Optimizer — problema no vídeo', body: 'O driver de vídeo travou ou reiniciou. Clique para ver e reverter os ajustes de vídeo recentes.', icon: fs.existsSync(ICON) ? ICON : undefined });
      n.on('click', () => { showWindow(); send('navigate', 'dashboard'); });
      n.show();
    }
  } catch {}
}

// A verificação completa de tweaks é pesada: roda só quando o Windows foi atualizado (build/UBR mudou) ou 1x por dia
async function driftIfNeeded() {
  const hw = await hardware.detect(true);
  const meta = store.read('drift-meta', {});
  const ver = `${hw.os.build}.${hw.os.ubr}`;
  if (meta.ver === ver && Date.now() - (meta.ts || 0) < 864e5) return;
  await checkDrift(true);
  store.write('drift-meta', { ver, ts: Date.now() });
}

app.on('before-quit', async (e) => {
  quitting = true;
  if (gamemode.session) { e.preventDefault(); await gamemode.shutdown(); app.quit(); return; }
  fps.stop();
  network.pingMonitorStop();
  memory.stopAll();
  require('./ps').shutdown();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => { if (!settings().minimizeToTray) app.quit(); });
