// Proteção contra boot quebrado.
// Ao aplicar ajustes que só valem após reiniciar, o Velox arma duas tarefas do Windows:
//   • VeloxBootGuard (na inicialização, como SYSTEM, antes do login): conta as inicializações.
//     Se o PC iniciar 3 vezes sem chegar à área de trabalho, desfaz os ajustes e reinicia UMA vez.
//   • VeloxBootGuardOk (2 min após o login): confirma que está tudo bem e desarma tudo.
// Depois de desfazer ou confirmar, as tarefas se apagam — não existe loop nem modo de segurança.
const fs = require('fs');
const path = require('path');
const { exec } = require('./ps');
const store = require('./store');

const DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'VeloxBootGuard');
const TASK = 'VeloxBootGuard';
const TASK_OK = 'VeloxBootGuardOk';

const APPLY_PS = `
function BK($h){ $hv = switch($h){ 'HKLM' {[Microsoft.Win32.RegistryHive]::LocalMachine} 'HKCU' {[Microsoft.Win32.RegistryHive]::CurrentUser} }; [Microsoft.Win32.RegistryKey]::OpenBaseKey($hv,[Microsoft.Win32.RegistryView]::Registry64) }
$data = Get-Content -Raw -LiteralPath "$PSScriptRoot\\revert.json" | ConvertFrom-Json
foreach($o in $data.reg){
  try {
    $i = $o.key.IndexOf('\\'); $h = $o.key.Substring(0,$i); $p = $o.key.Substring($i+1)
    if ($h -eq 'HKCU') { continue }  # na inicialização não há usuário logado; HKCU não quebra boot
    $b = BK $h
    if (-not $o.exists) { $k = $b.OpenSubKey($p, $true); if ($k) { $k.DeleteValue($o.name, $false); $k.Close() }; continue }
    $k = $b.CreateSubKey($p); $kind = [Microsoft.Win32.RegistryValueKind]::($o.type)
    if ($o.type -eq 'DWord') { $v = [int64]$o.value; if ($v -gt 2147483647) { $v = $v - 4294967296 }; $k.SetValue($o.name, [int32]$v, $kind) }
    elseif ($o.type -eq 'QWord') { $k.SetValue($o.name, [int64]$o.value, $kind) }
    elseif ($o.type -eq 'Binary') { [byte[]]$bb = @($o.value | ForEach-Object { [byte]$_ }); $k.SetValue($o.name, $bb, $kind) }
    elseif ($o.type -eq 'MultiString') { [string[]]$ss = @($o.value | ForEach-Object { [string]$_ }); $k.SetValue($o.name, $ss, $kind) }
    else { $k.SetValue($o.name, [string]$o.value, $kind) }
    $k.Close()
  } catch {}
}
foreach($c in $data.bcd){ if ($c.existed) { bcdedit /set '{current}' $c.name $c.value | Out-Null } else { bcdedit /deletevalue '{current}' $c.name | Out-Null } }
`;

const GUARD_PS = `$d = $PSScriptRoot
$sf = Join-Path $d 'state.json'
if (-not (Test-Path $sf)) { exit 0 }
$s = Get-Content -Raw $sf | ConvertFrom-Json
$s.boots = [int]$s.boots + 1
$s | ConvertTo-Json | Set-Content -LiteralPath $sf -Encoding UTF8
Add-Content -LiteralPath (Join-Path $d 'log.txt') -Value ("$(Get-Date -Format s) inicializacao " + $s.boots)
if ($s.boots -ge 3) {
  & (Join-Path $d 'revert.ps1')
  Add-Content -LiteralPath (Join-Path $d 'log.txt') -Value "$(Get-Date -Format s) REVERTIDO"
  Set-Content -LiteralPath (Join-Path $d 'reverted.flag') -Value (Get-Date -Format s)
  Remove-Item -LiteralPath $sf -Force
  schtasks /delete /tn ${TASK} /f | Out-Null
  schtasks /delete /tn ${TASK_OK} /f | Out-Null
  shutdown /r /t 15 /c "Velox Optimizer: ajustes desfeitos porque o Windows nao conseguiu iniciar. Reiniciando..."
}`;

const OK_PS = `$d = $PSScriptRoot
if (Test-Path (Join-Path $d 'state.json')) {
  Remove-Item -LiteralPath (Join-Path $d 'state.json') -Force
  Add-Content -LiteralPath (Join-Path $d 'log.txt') -Value "$(Get-Date -Format s) CONFIRMADO"
  Set-Content -LiteralPath (Join-Path $d 'confirmed.flag') -Value (Get-Date -Format s)
}
schtasks /delete /tn ${TASK} /f | Out-Null
schtasks /delete /tn ${TASK_OK} /f | Out-Null`;

function enabled() { return store.read('settings', {}).bootGuard !== false; }

// Junta os backups de registro/BCD dos ajustes que precisam de reinício e arma as tarefas
async function arm({ tweakIds = [], deviceIds = [] } = {}) {
  if (!enabled()) return { armed: false };
  const pending = store.update('bootguard-pending', { tweaks: [], devices: [] }, (p) => ({
    tweaks: [...new Set([...(p.tweaks || []), ...tweakIds])], devices: [...new Set([...(p.devices || []), ...deviceIds])],
  }));
  const rollback = store.read('rollback', {});
  const devBackup = store.read('device-backup', {});
  const data = { reg: [], bcd: [] };
  for (const id of pending.tweaks) {
    const b = rollback[id];
    if (!b) continue;
    if (b.reg) data.reg.push(...b.reg);
    if (b.bcd) data.bcd.push(...b.bcd);
  }
  for (const id of pending.devices) if (devBackup[id]) data.reg.push(...devBackup[id]);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'revert.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(DIR, 'revert.ps1'), '\uFEFF' + APPLY_PS);
  fs.writeFileSync(path.join(DIR, 'guard.ps1'), '\uFEFF' + GUARD_PS);
  fs.writeFileSync(path.join(DIR, 'ok.ps1'), '\uFEFF' + OK_PS);
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify({ boots: 0, armedAt: new Date().toISOString(), tweaks: pending.tweaks, devices: pending.devices }));
  for (const f of ['reverted.flag', 'confirmed.flag']) fs.rmSync(path.join(DIR, f), { force: true });
  const ps = (f) => `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(DIR, f)}"`;
  const a = await exec('schtasks.exe', ['/create', '/tn', TASK, '/tr', ps('guard.ps1'), '/sc', 'onstart', '/ru', 'SYSTEM', '/rl', 'highest', '/f']);
  const b = await exec('schtasks.exe', ['/create', '/tn', TASK_OK, '/tr', ps('ok.ps1'), '/sc', 'onlogon', '/delay', '0002:00', '/rl', 'highest', '/f']);
  const ok = a.ok && b.ok;
  store.log('boot', ok ? `Proteção de boot armada (${pending.tweaks.length + pending.devices.length} ajuste(s))` : 'Falha ao armar a proteção de boot', ok ? 'info' : 'warning');
  return { armed: ok };
}

// Chamado quando o Velox abre: informa se a última reinicialização foi confirmada ou revertida
function check() {
  const reverted = fs.existsSync(path.join(DIR, 'reverted.flag'));
  const confirmed = fs.existsSync(path.join(DIR, 'confirmed.flag'));
  const armed = fs.existsSync(path.join(DIR, 'state.json'));
  if (reverted) {
    const pending = store.read('bootguard-pending', { tweaks: [], devices: [] });
    // Os ajustes foram desfeitos pelo script: tira do rollback para não serem oferecidos como "desfeitos pelo Windows Update"
    store.update('rollback', {}, (r) => { for (const id of pending.tweaks) delete r[id]; return r; });
    store.update('device-backup', {}, (r) => { for (const id of pending.devices) delete r[id]; return r; });
    store.write('bootguard-pending', { tweaks: [], devices: [] });
    store.log('boot', `O Windows não conseguiu iniciar: ${pending.tweaks.length + pending.devices.length} ajuste(s) foram desfeitos automaticamente`, 'error');
    fs.rmSync(path.join(DIR, 'reverted.flag'), { force: true });
    return { status: 'reverted', items: pending };
  }
  if (confirmed) {
    store.write('bootguard-pending', { tweaks: [], devices: [] });
    fs.rmSync(path.join(DIR, 'confirmed.flag'), { force: true });
    store.log('boot', 'Reinicialização confirmada: tudo funcionando', 'success');
    return { status: 'confirmed' };
  }
  return { status: armed ? 'armed' : 'idle' };
}

// Se as tarefas sumiram (ex.: uma Restauração do Sistema as apagou), o estado armado é só sobra: limpa
async function sanityCheck() {
  if (!fs.existsSync(path.join(DIR, 'state.json'))) return;
  const r = await exec('schtasks.exe', ['/query', '/tn', TASK]);
  if (!r.ok) { fs.rmSync(path.join(DIR, 'state.json'), { force: true }); store.write('bootguard-pending', { tweaks: [], devices: [] }); }
}

async function disarm() {
  await exec('schtasks.exe', ['/delete', '/tn', TASK, '/f']);
  await exec('schtasks.exe', ['/delete', '/tn', TASK_OK, '/f']);
  fs.rmSync(path.join(DIR, 'state.json'), { force: true });
  store.write('bootguard-pending', { tweaks: [], devices: [] });
  return { ok: true };
}

module.exports = { arm, check, disarm, enabled, sanityCheck };
