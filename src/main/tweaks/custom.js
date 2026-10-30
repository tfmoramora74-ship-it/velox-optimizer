// Tweaks com lógica própria (comandos do sistema). Cada um: status(hw) -> bool|null, apply(hw) -> { ok, message, backup }, revert(hw, backup).
const os = require('os');
const { exec, ps, psJson, q } = require('../ps');
const reg = require('../reg');

// O Velox não gerencia mais plano de energia (o usuário escolhe o dele, ex.: QuickCPU).
// Remove o plano "Velox Desempenho" criado por versões antigas, se não estiver ativo.
const LEGACY_PLAN = 'b7e1c3a2-5d4f-4e8a-9c21-7f3e6a0d9b51';
async function removeLegacyPlan() {
  const r = await exec('powercfg.exe', ['/getactivescheme']);
  if (r.stdout.toLowerCase().includes(LEGACY_PLAN)) return false;
  if (!(await exec('powercfg.exe', ['/query', LEGACY_PLAN])).ok) return false;
  return (await exec('powercfg.exe', ['/delete', LEGACY_PLAN])).ok;
}

const hibernation = {
  async status() {
    const [v] = await reg.readMany([{ key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power', name: 'HibernateEnabled' }]);
    return v.exists ? Number(v.value) === 0 : false;
  },
  async apply() { const r = await exec('powercfg.exe', ['/h', 'off']); return { ok: r.ok, message: r.ok ? '' : 'powercfg /h off falhou.', backup: {} }; },
  async revert() { const r = await exec('powercfg.exe', ['/h', 'on']); return { ok: r.ok, message: r.ok ? '' : 'powercfg /h on falhou.' }; },
};

const NIC_STATUS = `$a = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
if (-not $a) { 'unknown'; return }
$pm = Get-NetAdapterPowerManagement -Name $a.Name -ErrorAction SilentlyContinue
if ($pm -and ($pm.AllowComputerToTurnOffDevice -eq 'Enabled' -or $pm.SelectiveSuspend -eq 'Enabled' -or $pm.DeviceSleepOnDisconnect -eq 'Enabled')) { 'on' } else { 'off' }`;
const nicPower = {
  async status() { const r = await ps(NIC_STATUS); const s = r.stdout.trim(); return s === 'unknown' ? null : s === 'off'; },
  async apply() {
    const r = await ps("Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { try { Disable-NetAdapterPowerManagement -Name $_.Name -NoRestart -ErrorAction Stop } catch {} }");
    return { ok: r.ok, message: r.ok ? '' : 'Falha ao alterar o adaptador.', backup: {} };
  },
  async revert() {
    const r = await ps("Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { try { Enable-NetAdapterPowerManagement -Name $_.Name -NoRestart -ErrorAction Stop } catch {} }");
    return { ok: r.ok, message: r.ok ? '' : 'Falha ao restaurar o adaptador.' };
  },
};

const memoryCompression = {
  async status() { const r = await ps("if ((Get-MMAgent).MemoryCompression) { 'on' } else { 'off' }"); const s = r.stdout.trim(); return s ? s === 'off' : null; },
  async apply() { const r = await ps('Disable-MMAgent -MemoryCompression -ErrorAction Stop'); return { ok: r.ok && !r.stderr.trim(), message: r.stderr.trim(), backup: {} }; },
  async revert() { const r = await ps('Enable-MMAgent -MemoryCompression -ErrorAction Stop'); return { ok: r.ok && !r.stderr.trim(), message: r.stderr.trim() }; },
};

async function lastAccessValue() {
  const r = await exec('fsutil.exe', ['behavior', 'query', 'disablelastaccess']);
  const m = r.stdout.match(/=\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
const lastAccess = {
  async status() { const v = await lastAccessValue(); return v === null ? null : v === 1 || v === 3; },
  async apply() {
    const original = await lastAccessValue();
    const r = await exec('fsutil.exe', ['behavior', 'set', 'disablelastaccess', '1']);
    return { ok: r.ok, message: r.ok ? '' : 'fsutil falhou.', backup: { original } };
  },
  async revert(hw, b) {
    const v = b && b.original !== null && b.original !== undefined ? b.original : 2;
    const r = await exec('fsutil.exe', ['behavior', 'set', 'disablelastaccess', String(v)]);
    return { ok: r.ok, message: r.ok ? '' : 'fsutil falhou.' };
  },
};

const MMKEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management';
const pagefile = {
  async status() {
    const r = await ps('(Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile');
    if (r.stdout.trim() !== 'False') return false;
    const [v] = await reg.readMany([{ key: MMKEY, name: 'PagingFiles' }]);
    const line = Array.isArray(v.value) ? v.value[0] : v.value;
    const m = String(line || '').match(/pagefile\.sys\s+(\d+)\s+(\d+)/i);
    return !!(m && m[1] === m[2] && Number(m[1]) > 0);
  },
  async apply() {
    const ramMb = Math.round(os.totalmem() / 1024 / 1024);
    const size = Math.round(ramMb * 1.5);
    const free = await psJson(`ConvertTo-Json @{ f=(Get-PSDrive C).Free }`);
    const freeMb = free.ok ? free.data.f / 1024 / 1024 : 0;
    if (freeMb && freeMb < size + 10240) return { ok: false, message: `Espaço livre insuficiente em C: (${(freeMb / 1024).toFixed(1)} GB) para pagefile de ${(size / 1024).toFixed(1)} GB.`, backup: null };
    const auto = (await ps('(Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile')).stdout.trim() === 'True';
    const [cur] = await reg.readMany([{ key: MMKEY, name: 'PagingFiles' }]);
    const backup = { auto, paging: cur.exists ? cur.value : null };
    await ps('$cs = Get-CimInstance Win32_ComputerSystem; if ($cs.AutomaticManagedPagefile) { Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false } }');
    const w = await reg.writeMany([{ key: MMKEY, name: 'PagingFiles', type: 'MultiString', value: [`C:\\pagefile.sys ${size} ${size}`] }]);
    if (!w.ok) {
      await ps('$cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }');
      return { ok: false, message: 'Falha ao gravar pagefile fixo; gerenciamento automático reativado.', backup };
    }
    return { ok: true, message: `Pagefile fixo em ${size} MB.`, backup };
  },
  async revert(hw, b) {
    if (b && b.paging) await reg.writeMany([{ key: MMKEY, name: 'PagingFiles', type: 'MultiString', value: Array.isArray(b.paging) ? b.paging : [b.paging] }]);
    else await reg.writeMany([{ key: MMKEY, name: 'PagingFiles', type: 'MultiString', value: ['?:\\pagefile.sys'] }]);
    const auto = !b || b.auto !== false;
    await ps(`$cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $${auto} }`);
    return { ok: true, message: '' };
  },
};

const DEV_PATHS = ['source\\repos', 'git', 'Projects', 'go', '.cargo', '.nuget'].map((p) => `${os.homedir()}\\${p}`).concat(['*\\node_modules']);
const defenderExclusions = {
  async status() {
    const r = await ps("(Get-MpPreference).ExclusionPath -join '|'");
    if (!r.ok) return null;
    const have = r.stdout.trim().toLowerCase().split('|');
    return DEV_PATHS.every((p) => have.includes(p.toLowerCase()));
  },
  async apply() {
    const r = await ps(DEV_PATHS.map((p) => `Add-MpPreference -ExclusionPath ${q(p)} -ErrorAction SilentlyContinue`).join(';'));
    return { ok: r.ok, message: r.ok ? '' : 'Falha no Defender (proteção contra violação pode bloquear).', backup: {} };
  },
  async revert() {
    const r = await ps(DEV_PATHS.map((p) => `Remove-MpPreference -ExclusionPath ${q(p)} -ErrorAction SilentlyContinue`).join(';'));
    return { ok: r.ok, message: r.ok ? '' : 'Falha no Defender.' };
  },
};

// "Permitir que o computador desligue este dispositivo" em hubs USB e dispositivos HID
const DEV_FILTER = "Where-Object { $_.InstanceName -match '^(USB|HID)\\\\' }";
const devicePowerSaving = {
  async status() {
    const r = await psJson(`$d=@(Get-CimInstance -Namespace root\\wmi -ClassName MSPower_DeviceEnable -ErrorAction SilentlyContinue | ${DEV_FILTER}); ConvertTo-Json -Compress @{ total=$d.Count; on=@($d | Where-Object { $_.Enable }).Count }`);
    if (!r.ok || !r.data || !r.data.total) return null;
    return r.data.on === 0;
  },
  async apply() {
    const r = await psJson(`$ch=@(); Get-CimInstance -Namespace root\\wmi -ClassName MSPower_DeviceEnable | ${DEV_FILTER} | Where-Object { $_.Enable } | ForEach-Object { try { Set-CimInstance -InputObject $_ -Property @{ Enable = $false } -ErrorAction Stop; $ch += $_.InstanceName } catch {} }; ConvertTo-Json -InputObject @($ch) -Compress`);
    const changed = r.ok && Array.isArray(r.data) ? r.data : [];
    return { ok: r.ok, message: r.ok ? `${changed.length} dispositivo(s) ajustados.` : 'Falha ao alterar dispositivos.', backup: { changed } };
  },
  async revert(hw, b) {
    const names = b && b.changed ? b.changed : null;
    const filter = names ? `Where-Object { (ConvertFrom-Json ${q(JSON.stringify(names))}) -contains $_.InstanceName }` : DEV_FILTER;
    const r = await ps(`Get-CimInstance -Namespace root\\wmi -ClassName MSPower_DeviceEnable | ${filter} | ForEach-Object { try { Set-CimInstance -InputObject $_ -Property @{ Enable = $true } -ErrorAction Stop } catch {} }`);
    return { ok: r.ok, message: r.ok ? '' : 'Falha ao restaurar dispositivos.' };
  },
};

const oneDriveExe = () => [
  `${process.env.LOCALAPPDATA}\\Microsoft\\OneDrive\\OneDrive.exe`,
  `${process.env.ProgramFiles}\\Microsoft OneDrive\\OneDrive.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft OneDrive\\OneDrive.exe`,
].find((p) => require('fs').existsSync(p));
const onedrive = {
  async status() { return !oneDriveExe(); },
  async apply() {
    await exec('taskkill.exe', ['/f', '/im', 'OneDrive.exe']);
    const r = await ps(`$u = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OneDriveSetup.exe','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OneDriveSetup.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).UninstallString
$setup = @("$env:SystemRoot\\System32\\OneDriveSetup.exe","$env:SystemRoot\\SysWOW64\\OneDriveSetup.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($u) { $exe = ($u -replace '^"([^"]+)".*','$1') -replace '\\s+/.*$',''; Start-Process -FilePath $exe -ArgumentList '/uninstall' -Wait }
elseif ($setup) { Start-Process -FilePath $setup -ArgumentList '/uninstall' -Wait }`, { timeout: 300000 });
    const gone = !oneDriveExe();
    return { ok: gone, message: gone ? 'OneDrive desinstalado.' : (r.stderr.trim() || 'O OneDrive ainda está instalado.'), backup: {} };
  },
  async revert() {
    const r = await ps(`$setup = @("$env:SystemRoot\\System32\\OneDriveSetup.exe","$env:SystemRoot\\SysWOW64\\OneDriveSetup.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($setup) { Start-Process -FilePath $setup -Wait; 'ok' } else { 'missing' }`, { timeout: 300000 });
    const ok = r.stdout.includes('ok') && !!oneDriveExe();
    return { ok, message: ok ? '' : 'Instalador do OneDrive não encontrado neste Windows. Baixe em onedrive.com/download.' };
  },
};

async function memoryUsageValue() {
  const r = await exec('fsutil.exe', ['behavior', 'query', 'memoryusage']);
  const m = r.stdout.match(/=\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
const ntfsMemoryUsage = {
  async status() { const v = await memoryUsageValue(); return v === null ? null : v === 2; },
  async apply() {
    const original = await memoryUsageValue();
    const r = await exec('fsutil.exe', ['behavior', 'set', 'memoryusage', '2']);
    return { ok: r.ok, message: r.ok ? '' : 'fsutil falhou.', backup: { original } };
  },
  async revert(hw, b) {
    const v = b && b.original ? b.original : 1;
    const r = await exec('fsutil.exe', ['behavior', 'set', 'memoryusage', String(v)]);
    return { ok: r.ok, message: r.ok ? '' : 'fsutil falhou.' };
  },
};

// DirectXUserGlobalSettings é uma string composta ("A=1;B=0;"): mexe só na chave pedida e preserva as outras
const DX_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
function dxSetting(name, value) {
  const read = async () => {
    const [v] = await reg.readMany([{ key: DX_KEY, name: 'DirectXUserGlobalSettings' }]);
    return v.exists ? String(v.value) : null;
  };
  const parse = (s) => Object.fromEntries(String(s || '').split(';').filter(Boolean).map((p) => p.split('=')));
  const build = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(';') + ';';
  return {
    async status() { return parse(await read())[name] === String(value); },
    async apply() {
      const original = await read();
      const o = parse(original); o[name] = String(value);
      const w = await reg.writeMany([{ key: DX_KEY, name: 'DirectXUserGlobalSettings', type: 'String', value: build(o) }]);
      return { ok: w.ok, message: w.errors.join(' '), backup: { had: original !== null && name in parse(original), old: parse(original)[name] } };
    },
    async revert(hw, b) {
      const o = parse(await read());
      if (b && b.had) o[name] = b.old; else delete o[name];
      const w = await reg.writeMany([Object.keys(o).length ? { key: DX_KEY, name: 'DirectXUserGlobalSettings', type: 'String', value: build(o) } : { key: DX_KEY, name: 'DirectXUserGlobalSettings', delete: true }]);
      return { ok: w.ok, message: w.errors.join(' ') };
    },
  };
}

// Tarefas agendadas de telemetria/diagnóstico (só desativa; guarda quais estavam ligadas)
const TELEMETRY_TASKS = [
  '\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser',
  '\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater',
  '\\Microsoft\\Windows\\Application Experience\\StartupAppTask',
  '\\Microsoft\\Windows\\Application Experience\\PcaPatchDbTask',
  '\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator',
  '\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip',
  '\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector',
  '\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient',
  '\\Microsoft\\Windows\\Feedback\\Siuf\\DmClientOnScenarioDownload',
  '\\Microsoft\\Windows\\Windows Error Reporting\\QueueReporting',
  '\\Microsoft\\Windows\\PI\\Sqm-Tasks',
  '\\Microsoft\\Windows\\Maps\\MapsUpdateTask',
  '\\Microsoft\\Windows\\Power Efficiency Diagnostics\\AnalyzeSystem',
  '\\Microsoft\\Windows\\Autochk\\Proxy',
];
const TASK_STATE = `$o=@{}; foreach($t in (ConvertFrom-Json ${q(JSON.stringify(TELEMETRY_TASKS))})){ $p = Split-Path $t -Parent; $n = Split-Path $t -Leaf; $x = Get-ScheduledTask -TaskPath ($p + '\\') -TaskName $n -ErrorAction SilentlyContinue; if($x){ $o[$t] = [string]$x.State } }; ConvertTo-Json -Compress $o`;
const telemetryTasks = {
  async status() {
    const r = await psJson(TASK_STATE);
    if (!r.ok || !r.data || !Object.keys(r.data).length) return null;
    return Object.values(r.data).every((s) => s === 'Disabled');
  },
  async apply() {
    const r = await psJson(TASK_STATE);
    const enabled = r.ok && r.data ? Object.entries(r.data).filter(([, s]) => s !== 'Disabled').map(([t]) => t) : [];
    await ps(enabled.map((t) => `Disable-ScheduledTask -TaskPath ${q(t.slice(0, t.lastIndexOf('\\') + 1))} -TaskName ${q(t.slice(t.lastIndexOf('\\') + 1))} -ErrorAction SilentlyContinue | Out-Null`).join(';') || '$null');
    return { ok: true, message: `${enabled.length} tarefa(s) desativada(s).`, backup: { enabled } };
  },
  async revert(hw, b) {
    const list = b && b.enabled ? b.enabled : TELEMETRY_TASKS;
    await ps(list.map((t) => `Enable-ScheduledTask -TaskPath ${q(t.slice(0, t.lastIndexOf('\\') + 1))} -TaskName ${q(t.slice(t.lastIndexOf('\\') + 1))} -ErrorAction SilentlyContinue | Out-Null`).join(';') || '$null');
    return { ok: true, message: '' };
  },
};

module.exports = { dxSwapEffect: dxSetting('SwapEffectUpgradeEnable', 1), dxVrr: dxSetting('VRROptimizeEnable', 1), dxAutoHdrOff: dxSetting('AutoHDREnable', 0), telemetryTasks, ntfsMemoryUsage, devicePowerSaving, onedrive, hibernation, nicPower, memoryCompression, lastAccess, pagefile, defenderExclusions, removeLegacyPlan };
