// Memória (limpeza de standby / working sets), timer de alta resolução e monitor de GPU/memória.
const os = require('os');
const { ps, psJson, spawnPs } = require('./ps');
const store = require('./store');

const NATIVE = `
if (-not ('VMem' -as [type])) {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class VMem {
  [DllImport("ntdll.dll")] static extern int NtSetSystemInformation(int c, ref int i, int l);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr h, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool LookupPrivilegeValue(string s, string n, out long l);
  [StructLayout(LayoutKind.Sequential, Pack=4)] struct TP { public int Count; public long Luid; public int Attr; }
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr t, bool d, ref TP n, int l, IntPtr p, IntPtr r);
  [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr h);
  static void Priv(string n){ IntPtr t; OpenProcessToken(Process.GetCurrentProcess().Handle, 0x28, out t); TP tp = new TP(); tp.Count=1; LookupPrivilegeValue(null,n,out tp.Luid); tp.Attr=2; AdjustTokenPrivileges(t,false,ref tp,0,IntPtr.Zero,IntPtr.Zero); }
  public static int List(int cmd){ Priv("SeProfileSingleProcessPrivilege"); Priv("SeIncreaseQuotaPrivilege"); int c=cmd; return NtSetSystemInformation(80, ref c, 4); }
  public static int TrimAll(){ int n=0; foreach(var p in Process.GetProcesses()){ try { if(EmptyWorkingSet(p.Handle)) n++; } catch {} } return n; }
}
"@
}
`;

const COUNTERS = `$m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
ConvertTo-Json -Compress @{ avail=[double]$m.AvailableBytes; standby=[double]($m.StandbyCacheNormalPriorityBytes + $m.StandbyCacheReserveBytes + $m.StandbyCacheCoreBytes); modified=[double]$m.ModifiedPageListBytes; cache=[double]$m.CacheBytes; free=[double]$m.FreeAndZeroPageListBytes }`;

async function counters() {
  const r = await psJson(COUNTERS);
  const d = r.ok ? r.data : {};
  return { total: os.totalmem(), free: os.freemem(), available: d.avail ?? os.freemem(), standby: d.standby ?? 0, modified: d.modified ?? 0, cache: d.cache ?? 0, zero: d.free ?? 0 };
}

// level: 'standby' | 'full'
async function clean(level = 'full') {
  const before = await counters();
  const steps = level === 'full'
    ? '$a=[VMem]::TrimAll(); $b=[VMem]::List(3); $c=[VMem]::List(4); ConvertTo-Json -Compress @{ trimmed=$a; modified=$b; standby=$c }'
    : '$c=[VMem]::List(4); ConvertTo-Json -Compress @{ standby=$c }';
  const r = await psJson(NATIVE + steps, { timeout: 60000 });
  const after = await counters();
  const freed = Math.max(0, after.available - before.available);
  const ok = r.ok && r.data && (r.data.standby === 0);
  store.log('memory', `Limpeza de memória: ${(freed / 1024 ** 2).toFixed(0)} MB liberados`, ok ? 'success' : 'warning');
  return { ok, freed, before, after, detail: r.data, message: ok ? `${(freed / 1024 ** 2).toFixed(0)} MB liberados.` : 'Limpeza parcial (execute como administrador).' };
}

// ───────── Timer de alta resolução (mantido por um processo filho)
let timerProc = null;
let timerValue = null;
function timerEnable(resolution100ns = 5000) {
  timerDisable();
  const script = `
Add-Type -Namespace V -Name T -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSetTimerResolution(uint d, bool s, out uint c); [DllImport("ntdll.dll")] public static extern int NtQueryTimerResolution(out uint mn, out uint mx, out uint c);'
$c=0; [V.T]::NtSetTimerResolution(${resolution100ns}, $true, [ref]$c) | Out-Null
$a=0;$b=0;$d=0; [V.T]::NtQueryTimerResolution([ref]$a,[ref]$b,[ref]$d) | Out-Null
[Console]::Out.WriteLine("$d"); [Console]::Out.Flush()
while($true){ Start-Sleep -Seconds 3600 }`;
  timerProc = spawnPs(script);
  timerProc.stdout.on('data', (b) => { const v = parseInt(String(b).trim(), 10); if (!isNaN(v)) timerValue = v / 10000; });
  timerProc.on('exit', () => { timerProc = null; timerValue = null; });
  store.log('latency', `Timer de alta resolução ativado (${resolution100ns / 10000} ms)`, 'success');
  return { ok: true };
}
function timerDisable() {
  if (timerProc) { try { timerProc.kill(); } catch {} timerProc = null; timerValue = null; }
  return { ok: true };
}
async function timerStatus() {
  const r = await ps(`if (-not ('V.Q' -as [type])) { Add-Type -Namespace V -Name Q -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtQueryTimerResolution(out uint mn, out uint mx, out uint c);' }; $a=0;$b=0;$c=0; [V.Q]::NtQueryTimerResolution([ref]$a,[ref]$b,[ref]$c) | Out-Null; "$a|$b|$c"`);
  const [min, max, cur] = r.stdout.trim().split('|').map((x) => parseInt(x, 10) / 10000);
  return { active: !!timerProc, held: timerValue, min, max, current: cur };
}

// Mede a precisão real do Sleep(1): quanto mais perto de 1,000 ms e menor a variação, melhor o timer.
async function measureSleep(samples = 60) {
  const n = Math.max(10, Math.min(300, samples));
  const r = await ps(`if (-not ('VSleep' -as [type])) { Add-Type -TypeDefinition @"
using System; using System.Diagnostics; using System.Threading;
public static class VSleep { public static string Run(int n){ var sw = new Stopwatch(); var d = new double[n]; Thread.Sleep(1); for (int i = 0; i < n; i++){ sw.Restart(); Thread.Sleep(1); d[i] = sw.Elapsed.TotalMilliseconds; } return string.Join(";", Array.ConvertAll(d, x => x.ToString("F4", System.Globalization.CultureInfo.InvariantCulture))); } }
"@ }; [VSleep]::Run(${n})`, { timeout: 60000 });
  const vals = r.stdout.trim().split(';').map(Number).filter((x) => !isNaN(x) && x > 0);
  if (!vals.length) return { ok: false, message: 'Falha ao medir.' };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length);
  return { ok: true, samples: vals, avg, sd, min: Math.min(...vals), max: Math.max(...vals), delta: avg - 1 };
}

// ───────── Monitor contínuo (GPU + memória) com CPU calculada no Node
let monitor = null;
let last = { gpu: null, avail: null, standby: null };
let cpuPrev = os.cpus();
function cpuPercent() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const p = cpuPrev[i] || c;
    const t = (o) => o.times.user + o.times.nice + o.times.sys + o.times.idle + o.times.irq;
    total += t(c) - t(p); idle += c.times.idle - p.times.idle;
  });
  cpuPrev = now;
  return total > 0 ? Math.max(0, Math.min(100, 100 - (idle / total) * 100)) : 0;
}
// O monitor só roda enquanto alguém precisa dele (janela visível, sessão de jogo, limpeza automática).
// 'full' lê GPU, clock e temperatura; 'light' só memória (bem mais barato, para segundo plano).
const demands = new Map(); // chave -> { ms, full }
let monitorMode = null;
let smiTimer = null;
function demand(key, opts) {
  if (opts) demands.set(key, opts); else demands.delete(key);
  const list = [...demands.values()];
  const want = list.length ? { ms: Math.min(...list.map((d) => d.ms)), full: list.some((d) => d.full) } : null;
  const sig = want ? `${want.ms}${want.full ? 'f' : 'l'}` : null;
  if (sig === monitorMode) return;
  if (monitor) { try { monitor.kill(); } catch {} monitor = null; }
  monitorMode = sig;
  clearInterval(smiTimer); smiTimer = null;
  if (!want) return;
  startMonitor(want.ms, want.full);
  if (want.full) { pollSmi(); smiTimer = setInterval(pollSmi, 3000); }
}

function startMonitor(ms, full) {
  // Com NVIDIA o uso da GPU vem do nvidia-smi; os contadores WMI de GPU (pesados, causam engasgos) só sem ela
  const gpuWmi = SMI ? '$g=$null' : `$g=$null; try { $g = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -like '*engtype_3D' } | Measure-Object -Property UtilizationPercentage -Sum).Sum } catch {}`;
  const gpuPart = full
    ? `${gpuWmi}
  $pi = $null; try { $pi = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction Stop } catch {}
  $tz = $null; try { $tz = (Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction Stop | Measure-Object -Property HighPrecisionTemperature -Maximum).Maximum } catch {}`
    : '$g=$null; $pi=$null; $tz=$null';
  const script = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
while($true){
  ${gpuPart}
  $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ gpu=$g; avail=[double]$m.AvailableBytes; standby=[double]($m.StandbyCacheNormalPriorityBytes + $m.StandbyCacheReserveBytes + $m.StandbyCacheCoreBytes); perf=$(if($pi){[double]$pi.PercentProcessorPerformance}); limit=$(if($pi){[double]$pi.PercentPerformanceLimit}); base=$(if($pi){[double]$pi.ProcessorFrequency}); tz=$tz }))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${ms}
}`;
  monitor = spawnPs(script);
  // monitor nunca deve competir com o jogo pela CPU
  try { os.setPriority(monitor.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  let buf = '';
  monitor.stdout.on('data', (b) => {
    buf += String(b);
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    for (const l of lines) {
      try {
        const d = JSON.parse(l);
        last = {
          gpu: d.gpu === null ? null : Math.min(100, d.gpu), avail: d.avail, standby: d.standby,
          cpuMhz: d.perf && d.base ? Math.round((d.base * d.perf) / 100) : null, cpuLimit: d.limit ?? null,
          // HighPrecisionTemperature vem em décimos de Kelvin
          boardTemp: d.tz ? Math.round(d.tz / 10 - 273.15) : null,
        };
      } catch {}
    }
  });
  monitor.on('exit', () => { monitor = null; });
}
// GPU NVIDIA: temperatura, clock, consumo e ventoinha pelo nvidia-smi (vem com o driver)
const fs = require('fs');
const SMI = [`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\nvidia-smi.exe`, `${process.env.ProgramFiles}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`].find((p) => fs.existsSync(p));
let gpuInfo = null;
let smiBusy = false;
// O nome do campo de limitação mudou entre versões do driver; tenta o novo, depois o antigo, depois sem ele
const REASON_FIELDS = ['clocks_event_reasons.active', 'clocks_throttle_reasons.active', null];
let reasonIdx = 0;
function pollSmi() {
  if (!SMI || smiBusy) return;
  smiBusy = true;
  const field = REASON_FIELDS[reasonIdx];
  require('child_process').execFile(SMI, [`--query-gpu=temperature.gpu,clocks.gr,clocks.max.gr,power.draw,fan.speed,utilization.gpu${field ? ',' + field : ''}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    smiBusy = false;
    if (err) { if (reasonIdx < REASON_FIELDS.length - 1) reasonIdx++; return; }
    const [temp, clock, maxClock, power, fan, util, reasons] = String(out).split('\n')[0].split(',').map((x) => x.trim());
    const r = parseInt(reasons, 16);
    gpuInfo = {
      util: Number.isFinite(Number(util)) ? Number(util) : null,
      temp: Number(temp) || null, clock: Number(clock) || null, maxClock: Number(maxClock) || null, power: parseFloat(power) || null, fan: Number(fan) || null,
      // bits de limitação: 0x20/0x40 térmico (SW/HW slowdown), 0x4 limite de potência
      thermalThrottle: !isNaN(r) && (r & 0x60) !== 0, powerThrottle: !isNaN(r) && (r & 0x4) !== 0,
    };
  });
}

function sample() {
  return {
    ts: Date.now(), cpu: cpuPercent(), gpu: last.gpu ?? (gpuInfo ? gpuInfo.util : null),
    ramTotal: os.totalmem(), ramUsed: os.totalmem() - (last.avail ?? os.freemem()), standby: last.standby,
    cpuMhz: last.cpuMhz ?? null, cpuThrottle: last.cpuLimit !== null && last.cpuLimit !== undefined && last.cpuLimit < 99,
    boardTemp: last.boardTemp ?? null, gpuInfo,
  };
}
// ───────── Limpeza automática da lista standby (quando o standby incha e a memória livre acaba)
let autoTimer = null;
let lastAuto = 0;
const AUTO_DEFAULT = { enabled: false, standbyMb: 1024, freeMb: 1024, count: 0 };
function autoGet() { return { ...AUTO_DEFAULT, ...store.read('auto-standby', {}) }; }
function autoSet(patch) {
  const s = { ...autoGet(), ...patch };
  store.write('auto-standby', s);
  autoStart();
  return s;
}
function autoStart() {
  const s = autoGet();
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  demand('autoStandby', s.enabled ? { ms: 5000, full: false } : null);
  if (!s.enabled) return;
  autoTimer = setInterval(async () => {
    if (last.standby === null || last.avail === null) return;
    const now = Date.now();
    if (now - lastAuto < 30000) return;
    if (last.standby / 1024 ** 2 > s.standbyMb && last.avail / 1024 ** 2 < s.freeMb) {
      lastAuto = now;
      const r = await ps(NATIVE + '[VMem]::List(4)');
      if (r.ok) store.update('auto-standby', AUTO_DEFAULT, (x) => ({ ...x, count: (x.count || 0) + 1, lastRun: now }));
    }
  }, 5000);
}

function stopAll() {
  if (autoTimer) clearInterval(autoTimer);
  timerDisable();
  demands.clear();
  clearInterval(smiTimer);
  if (monitor) { try { monitor.kill(); } catch {} monitor = null; }
}

module.exports = { autoGet, autoSet, autoStart, measureSleep, counters, clean, timerEnable, timerDisable, timerStatus, demand, sample, stopAll, NATIVE };
