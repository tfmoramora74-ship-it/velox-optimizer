// Game Mode: ao detectar um jogo aplica ajustes temporários e desfaz tudo quando ele fecha.
const { EventEmitter } = require('events');
const { exec, ps, psJson, q } = require('./ps');
const reg = require('./reg');
const store = require('./store');
const procwatch = require('./procwatch');
const memory = require('./memory');
const { GAMES } = require('./tweaks/catalog');
const TOAST_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';

const KNOWN_GAMES = [
  ...Object.values(GAMES).flatMap((g) => g.exes),
  'LeagueClient.exe', 'League of Legends.exe', 'dota2.exe', 'RainbowSix.exe', 'RainbowSix_Vulkan.exe', 'cod.exe', 'ModernWarfare.exe',
  'Overwatch.exe', 'RocketLeague.exe', 'PUBG.exe', 'TslGame.exe', 'EscapeFromTarkov.exe', 'destiny2.exe', 'eldenring.exe',
  'Cyberpunk2077.exe', 'RDR2.exe', 'FC25.exe', 'FC26.exe', 'Minecraft.Windows.exe', 'javaw.exe', 'RobloxPlayerBeta.exe',
  'MarvelRivals-Win64-Shipping.exe', 'deadlock.exe', 'TheFinals.exe', 'Discovery.exe', 'bf6.exe', 'BF2042.exe', 'GenshinImpact.exe',
  'ZenlessZoneZero.exe', 'StarRail.exe', 'Warframe.x64.exe', 'PathOfExile.exe', 'PathOfExile_x64Steam.exe', 'wow.exe', 'Wow.exe',
  'Palworld-Win64-Shipping.exe', 'HELLDIVERS2.exe', 'r5apex_dx12.exe', 'FreeFire.exe', 'HD-Player.exe',
];

// Processos de fundo que podem ter prioridade reduzida durante o jogo (nunca sistema, anti-cheat ou drivers).
const BACKGROUND = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'spotify', 'onedrive', 'googledrivefs', 'dropbox',
  'msteams', 'teams', 'slack', 'whatsapp', 'telegram', 'skype', 'steamwebhelper', 'epicwebhelper', 'epicgameslauncher',
  'eadesktop', 'ubisoftconnect', 'battle.net', 'galaxyclient', 'wallpaper32', 'wallpaper64', 'lghub', 'razer synapse', 'steelseriesgg',
  'armourycrate', 'searchhost', 'phoneexperiencehost', 'widgets', 'widgetservice'];

const UPDATE_SERVICES = ['wuauserv', 'UsoSvc', 'DoSvc', 'BITS'];

// Serviços que não fazem falta durante uma partida (parados só se estiverem rodando; voltam ao fechar o jogo)
const SESSION_SERVICES = ['WSearch', 'SysMain', 'Spooler', 'DiagTrack', 'dmwappushservice', 'WerSvc', 'MapsBroker', 'lfsvc', 'TrkWks', 'PhoneSvc', 'wisvc', 'RetailDemo', 'Fax', 'PcaSvc', 'WpcMonSvc', 'SEMgrSvc'];

const DEFAULT_OPTIONS = {
  autoDetect: true, silenceNotifications: true, gamePriority: true, lowerBackground: false,
  cleanMemory: true, timerResolution: true, pauseUpdates: false, adaptive: true,
  stopServices: false, pCoreAffinity: true,
};

// Núcleos de desempenho (P-cores) em CPUs híbridas — EfficiencyClass mais alta via GetSystemCpuSetInformation
let cpuTopology = null;
async function topology() {
  if (cpuTopology) return cpuTopology;
  const r = await ps(`if (-not ('VCpu' -as [type])) { Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VCpu {
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetSystemCpuSetInformation(IntPtr info, uint len, out uint ret, IntPtr proc, uint flags);
  public static string Classes(){
    uint len; GetSystemCpuSetInformation(IntPtr.Zero, 0, out len, IntPtr.Zero, 0);
    IntPtr buf = Marshal.AllocHGlobal((int)len);
    try {
      if (!GetSystemCpuSetInformation(buf, len, out len, IntPtr.Zero, 0)) return "";
      var sb = new System.Text.StringBuilder(); int off = 0;
      while (off < len) { int size = Marshal.ReadInt32(buf, off); sb.Append(Marshal.ReadByte(buf, off + 14)).Append(':').Append(Marshal.ReadByte(buf, off + 18)).Append(','); off += size; }
      return sb.ToString();
    } finally { Marshal.FreeHGlobal(buf); }
  }
}
"@ }; [VCpu]::Classes()`);
  const pairs = r.stdout.trim().split(',').filter(Boolean).map((x) => x.split(':').map(Number));
  const classes = [...new Set(pairs.map((p) => p[1]))];
  const top = Math.max(...classes);
  const pcores = pairs.filter((p) => p[1] === top && p[0] < 64).map((p) => p[0]);
  cpuTopology = { hybrid: classes.length > 1, pcores, mask: pcores.reduce((m, i) => m + 2 ** i, 0), total: pairs.length };
  return cpuTopology;
}

class GameMode extends EventEmitter {
  constructor() {
    super();
    this.session = null;
    this.poll = null;
    this.adaptive = null;
  }

  options() { return { ...DEFAULT_OPTIONS, ...store.read('gamemode-options', {}) }; }
  setOptions(o) { store.write('gamemode-options', { ...this.options(), ...o }); this.ensurePolling(); return this.options(); }
  customGames() { return store.read('gamemode-games', []); }
  setCustomGames(list) { store.write('gamemode-games', list); this.gameSet = new Set(this.gameList()); return list; }
  gameList() { return [...new Set([...KNOWN_GAMES, ...this.customGames()].map((x) => x.toLowerCase()))]; }

  state() {
    return { active: !!this.session, session: this.session ? { ...this.session, restore: undefined } : null, options: this.options(), customGames: this.customGames(), knownGames: KNOWN_GAMES, lastReport: store.read('gamemode-report', null), hybrid: cpuTopology ? cpuTopology.hybrid : null };
  }

  ensurePolling() {
    this.gameSet = new Set(this.gameList());
    procwatch.subscribe('gamemode', this.options().autoDetect ? (list) => this.tick(list) : null);
  }

  async tick(list) {
    if (!this.session) {
      const found = list.find((p) => this.gameSet.has(p.name.toLowerCase()));
      if (found) await this.start(found);
    } else if (this.session.auto) {
      if (!list.some((p) => p.pid === this.session.pid)) await this.stop('O jogo foi fechado.');
    }
  }

  async start(game, manual = false) {
    if (this.session) return { ok: false, message: 'Já existe uma sessão ativa.' };
    const opt = this.options();
    const restore = {};
    const actions = [];
    this.session = { game: game ? game.name : 'Sessão manual', pid: game ? game.pid : null, auto: !manual && !!game, startedAt: Date.now(), actions, samples: [] };

    if (opt.silenceNotifications) {
      const [v] = await reg.readMany([{ key: TOAST_KEY, name: 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' }]);
      restore.toasts = v;
      await reg.writeMany([{ key: TOAST_KEY, name: 'NOC_GLOBAL_SETTING_TOASTS_ENABLED', type: 'DWord', value: 0 }]);
      actions.push('Notificações silenciadas');
    }
    if (opt.gamePriority && game) {
      await ps(`try { (Get-Process -Id ${game.pid}).PriorityClass = 'AboveNormal' } catch {}`);
      actions.push(`Prioridade acima do normal para ${game.name}`);
    }
    if (opt.lowerBackground) {
      const r = await psJson(`$names = ConvertFrom-Json '${JSON.stringify(BACKGROUND)}'; $o=@(); Get-Process | Where-Object { $names -contains $_.ProcessName.ToLower() } | ForEach-Object { try { $o += ,@{ id=$_.Id; p=$_.PriorityClass.ToString() }; $_.PriorityClass='BelowNormal' } catch {} }; ConvertTo-Json -InputObject @($o) -Compress`);
      restore.priorities = r.ok && Array.isArray(r.data) ? r.data : [];
      if (restore.priorities.length) actions.push(`${restore.priorities.length} apps de fundo com prioridade reduzida`);
    }
    if (opt.pauseUpdates) {
      const r = await psJson(`$o=@(); foreach($s in ${UPDATE_SERVICES.map(q).join(',')}){ $x=Get-Service -Name $s -ErrorAction SilentlyContinue; if($x -and $x.Status -eq 'Running'){ $o+=$s; Stop-Service -Name $s -Force -ErrorAction SilentlyContinue } }; ConvertTo-Json -InputObject @($o) -Compress`);
      restore.services = r.ok && Array.isArray(r.data) ? r.data : [];
      actions.push('Windows Update pausado durante o jogo');
    }
    if (opt.stopServices) {
      const r = await psJson(`$o=@(); foreach($s in ${SESSION_SERVICES.map(q).join(',')}){ $x=Get-Service -Name $s -ErrorAction SilentlyContinue; if($x -and $x.Status -eq 'Running' -and $x.StartType -ne 'Disabled'){ Stop-Service -Name $s -Force -ErrorAction SilentlyContinue; if((Get-Service -Name $s).Status -ne 'Running'){ $o+=$s } } }; ConvertTo-Json -InputObject @($o) -Compress`);
      const stopped = r.ok && Array.isArray(r.data) ? r.data : [];
      restore.services = [...(restore.services || []), ...stopped];
      if (stopped.length) actions.push(`${stopped.length} serviço(s) de fundo pausados`);
    }
    if (opt.pCoreAffinity && game) {
      const topo = await topology();
      if (topo.hybrid && topo.mask) {
        const r = await ps(`$p = Get-Process -Id ${game.pid} -ErrorAction SilentlyContinue; if ($p) { $old = [int64]$p.ProcessorAffinity; $p.ProcessorAffinity = [IntPtr][int64]${topo.mask}; "$old" }`);
        const old = parseInt(r.stdout.trim(), 10);
        if (!isNaN(old)) { restore.affinity = { pid: game.pid, mask: old }; actions.push(`${game.name} fixado nos ${topo.pcores.length} threads de P-core`); }
      }
    }
    if (opt.timerResolution) { memory.timerEnable(5000); restore.timer = true; actions.push('Timer de 0,5 ms'); }
    if (opt.cleanMemory) {
      const r = await memory.clean('standby');
      actions.push(`Memória limpa (${(r.freed / 1024 ** 2).toFixed(0)} MB)`);
    }

    this.session.restore = restore;
    store.write('gamemode-pending', restore);
    if (opt.adaptive) this.startAdaptive();
    store.log('gamemode', `Game Mode iniciado: ${this.session.game}`, 'success');
    this.emit('change', this.state());
    return { ok: true, actions };
  }

  startAdaptive() {
    // Durante o jogo só lê memória, a cada 5 s: ler contadores de GPU (WMI/nvidia-smi) causa micro-engasgos
    memory.demand('gamemode', { ms: 5000, full: false });
    this.adaptive = setInterval(async () => {
      if (!this.session) return;
      const s = memory.sample();
      this.session.samples.push({
        ts: s.ts, cpu: Math.round(s.cpu), gpu: s.gpu === null ? null : Math.round(s.gpu), ram: Math.round((s.ramUsed / s.ramTotal) * 100),
        gpuTemp: s.gpuInfo ? s.gpuInfo.temp : null, gpuThrottle: !!(s.gpuInfo && s.gpuInfo.thermalThrottle), cpuThrottle: !!s.cpuThrottle,
      });
      if (this.session.samples.length > 1200) this.session.samples.shift();
      // RAM disponível baixa: libera a lista standby
      const availPct = 100 - (s.ramUsed / s.ramTotal) * 100;
      const now = Date.now();
      if (availPct < 12 && (!this.session.lastPurge || now - this.session.lastPurge > 60000)) {
        this.session.lastPurge = now;
        await memory.clean('standby');
        this.session.actions.push(`Motor adaptativo: standby liberado (${new Date().toLocaleTimeString('pt-BR')})`);
      }
      this.emit('change', this.state());
    }, 3000);
  }

  async stop(reason = 'Encerrado manualmente.') {
    if (!this.session) return { ok: false, message: 'Nenhuma sessão ativa.' };
    if (this.adaptive) { clearInterval(this.adaptive); this.adaptive = null; }
    memory.demand('gamemode', null);
    await this.restore(this.session.restore || {});
    const s = this.session;
    const avg = (k) => { const v = s.samples.map((x) => x[k]).filter((x) => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const peak = (k) => { const v = s.samples.map((x) => x[k]).filter((x) => x !== null); return v.length ? Math.max(...v) : null; };
    const report = { game: s.game, startedAt: s.startedAt, endedAt: Date.now(), reason, actions: s.actions, cpuAvg: avg('cpu'), cpuPeak: peak('cpu'), gpuAvg: avg('gpu'), gpuPeak: peak('gpu'), ramAvg: avg('ram'), ramPeak: peak('ram'), gpuTempPeak: peak('gpuTemp'),
      gpuThrottlePct: s.samples.length ? Math.round((s.samples.filter((x) => x.gpuThrottle).length / s.samples.length) * 100) : 0,
      cpuThrottlePct: s.samples.length ? Math.round((s.samples.filter((x) => x.cpuThrottle).length / s.samples.length) * 100) : 0, samples: s.samples.filter((_, i) => i % 3 === 0) };
    store.write('gamemode-report', report);
    this.session = null;
    store.log('gamemode', `Game Mode encerrado: ${s.game}. ${reason}`, 'info');
    this.emit('change', this.state());
    return { ok: true, report };
  }

  async restore(r) {
    if (r.plan) await exec('powercfg.exe', ['/setactive', r.plan]);
    if (r.affinity) await ps(`$p = Get-Process -Id ${Number(r.affinity.pid)} -ErrorAction SilentlyContinue; if ($p) { $p.ProcessorAffinity = [IntPtr][int64]${Number(r.affinity.mask)} }`);
    if (r.toasts) {
      await reg.writeMany([r.toasts.exists
        ? { key: TOAST_KEY, name: 'NOC_GLOBAL_SETTING_TOASTS_ENABLED', type: 'DWord', value: r.toasts.value }
        : { key: TOAST_KEY, name: 'NOC_GLOBAL_SETTING_TOASTS_ENABLED', delete: true }]);
    }
    if (r.priorities && r.priorities.length) {
      await ps(r.priorities.map((p) => `try { (Get-Process -Id ${Number(p.id)} -ErrorAction Stop).PriorityClass = ${q(p.p)} } catch {}`).join(';'));
    }
    if (r.services && r.services.length) await ps(r.services.map((s) => `Start-Service -Name ${q(s)} -ErrorAction SilentlyContinue`).join(';'));
    if (r.timer) memory.timerDisable();
    store.write('gamemode-pending', null);
  }

  // Se o app fechou no meio de uma sessão, desfaz na próxima abertura.
  allGames() { return [...new Set([...KNOWN_GAMES, ...this.customGames()])]; }

  async recover() {
    topology().catch(() => {});
    const pending = store.read('gamemode-pending', null);
    if (pending) { await this.restore(pending); store.log('gamemode', 'Sessão anterior interrompida foi restaurada.', 'warning'); }
    this.ensurePolling();
  }

  async shutdown() {
    procwatch.subscribe('gamemode', null);
    if (this.session) await this.stop('O app foi fechado.');
  }
}

const instance = new GameMode();
instance.topology = topology;
module.exports = instance;
