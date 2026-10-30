// Salvaguardas do sistema:
//  • Restauração do Sistema detectada → os backups do Velox ficam obsoletos; arquiva para não oferecer "reaplicar".
//  • Vigia de vídeo → se o driver de vídeo travar/reiniciar (tela preta), avisa e oferece reverter os ajustes de vídeo recentes.
const fs = require('fs');
const path = require('path');
const { psJson } = require('./ps');
const store = require('./store');

const STATE_FILES = ['rollback', 'services-backup', 'device-backup', 'apptuner', 'nvidia-backup', 'dns-backup', 'nic-backup', 'tcp-backup', 'drift', 'drift-meta', 'bootguard-pending', 'gamemode-pending'];

function lastChangeTs() {
  const rb = store.read('rollback', {});
  return Math.max(0, ...Object.values(rb).map((b) => b.ts || 0), store.read('last-system-change', 0));
}

// Ponto do tipo 6 = "Operação de restauração" (o Windows cria ao restaurar)
async function checkSystemRestore() {
  const since = lastChangeTs();
  if (!since) return null;
  const r = await psJson("$p = Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Where-Object { $_.RestorePointType -eq 6 } | Sort-Object SequenceNumber -Descending | Select-Object -First 1; if ($p) { ConvertTo-Json -Compress @{ t = $p.ConvertToDateTime($p.CreationTime).ToUniversalTime().ToString('o') } } else { 'null' }");
  if (!r.ok || !r.data || !r.data.t) return null;
  const restoredAt = new Date(r.data.t).getTime();
  if (restoredAt <= since) return null;
  const dir = store.dir();
  const arch = path.join(dir, `antes-da-restauracao-${new Date(restoredAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
  fs.mkdirSync(arch, { recursive: true });
  for (const f of STATE_FILES) {
    const p = path.join(dir, f + '.json');
    if (fs.existsSync(p)) fs.renameSync(p, path.join(arch, f + '.json'));
  }
  store.log('system', 'Restauração do Sistema detectada: registros de otimizações anteriores foram arquivados (o Windows já voltou ao estado anterior).', 'warning');
  return { restoredAt };
}

// ───────── Vigia de vídeo
// 4101 = driver de vídeo parou de responder e foi recuperado (TDR); 14/13 do nvlddmkm e erros do dxgkrnl também contam
const VIDEO_QUERY = (sinceIso) => `$s = [datetime]::Parse('${sinceIso}').ToLocalTime()
$e = @(Get-WinEvent -FilterHashtable @{ LogName='System'; StartTime=$s; Level=1,2,3 } -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 4101 -or $_.ProviderName -match '^(nvlddmkm|amdkmdag|amdkmdap|igfx|Display|Microsoft-Windows-DxgKrnl|dxgkrnl)$' } | Select-Object -First 20 | ForEach-Object { @{ t=$_.TimeCreated.ToUniversalTime().ToString('o'); id=$_.Id; p=$_.ProviderName } })
ConvertTo-Json -InputObject $e -Compress`;

// Ajustes que mexem com vídeo, energia da GPU ou interrupções: os suspeitos se o driver travar
const VIDEO_TWEAKS = new Set(['gpu-hardware-scheduling', 'compositor-latency-off', 'msi-mode-gpu', 'interrupt-affinity-gpu', 'tdr-delay-extended', 'nvidia-pstate-fixed', 'nvidia-hdcp-off', 'gpu-preemption-off', 'windowed-game-optimizations', 'vrr-optimizations', 'fullscreen-optimizations', 'pcie-aspm-off', 'amd-ulps-off', 'idle-states-off', 'bcd-disable-dynamic-tick', 'platform-tick']);

async function checkVideo() {
  const last = store.read('video-watch', { since: new Date(Date.now() - 3600e3).toISOString(), events: [] });
  const r = await psJson(VIDEO_QUERY(last.since));
  const now = new Date().toISOString();
  const events = r.ok && Array.isArray(r.data) ? r.data : [];
  const fresh = events.filter((e) => e.t > last.since);
  store.write('video-watch', { since: now, events: [...fresh, ...(last.events || [])].slice(0, 50) });
  if (!fresh.length) return null;
  // Suspeitos: ajustes de vídeo aplicados nas últimas 48 h
  const rb = store.read('rollback', {});
  const recent = Object.entries(rb).filter(([id, b]) => VIDEO_TWEAKS.has(id) && Date.now() - (b.ts || 0) < 48 * 3600e3).map(([id]) => id);
  const devices = Object.keys(store.read('device-backup', {}));
  const nvidia = Object.keys(store.read('nvidia-backup', {})).length > 0;
  store.log('system', `Driver de vídeo travou/reiniciou ${fresh.length}x (evento ${fresh.map((e) => e.id).join(', ')}).`, 'error');
  return { events: fresh, suspects: { tweaks: recent, devices, nvidia } };
}

module.exports = { checkSystemRestore, checkVideo, VIDEO_TWEAKS };
