// Manutenção do Windows: pontos de restauração (listar/criar/excluir/restaurar), reparos do sistema e otimização de unidades.
const { ps, psJson } = require('./ps');
const store = require('./store');

const TYPES = { 0: 'Instalação de app', 1: 'Desinstalação de app', 10: 'Instalação de driver', 12: 'Alteração de configurações', 13: 'Cancelamento' };

async function restorePoints() {
  const r = await psJson(`$st = 'unknown'
try { $c = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -ErrorAction Stop; $st = if ($c.RPSessionInterval -eq 0 -and $c.DisableSR -eq 1) { 'disabled' } else { 'enabled' } } catch {}
$p = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ seq=$_.SequenceNumber; desc=$_.Description; type=[int]$_.RestorePointType; time=$_.ConvertToDateTime($_.CreationTime).ToString('o') } })
ConvertTo-Json -Compress -Depth 3 @{ points=@($p); status=$st }`);
  const d = r.ok && r.data ? r.data : { points: [], status: 'unknown' };
  const points = (Array.isArray(d.points) ? d.points : []).map((p) => ({ ...p, typeName: TYPES[p.type] || 'Ponto de restauração' })).sort((a, b) => b.seq - a.seq);
  return { points, enabled: d.status !== 'disabled' && (points.length > 0 || d.status === 'enabled') };
}

async function enableRestore() {
  const r = await ps('Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction Stop; vssadmin resize shadowstorage /for=$env:SystemDrive /on=$env:SystemDrive /maxsize=5% | Out-Null');
  const ok = r.ok && !r.stderr.trim();
  store.log('system', ok ? 'Restauração do Sistema ativada' : 'Falha ao ativar Restauração do Sistema', ok ? 'success' : 'warning');
  return { ok, message: ok ? 'Restauração do Sistema ativada (até 5% do disco).' : r.stderr.trim().slice(0, 300) };
}

async function deleteRestorePoint(seq) {
  const n = Number(seq);
  if (!Number.isInteger(n)) return { ok: false, message: 'Ponto inválido.' };
  const r = await ps(`if (-not ('V.SR' -as [type])) { Add-Type -Namespace V -Name SR -MemberDefinition '[DllImport("srclient.dll")] public static extern int SRRemoveRestorePoint(int index);' }; [V.SR]::SRRemoveRestorePoint(${n})`);
  const code = parseInt(r.stdout.trim(), 10);
  const ok = code === 0;
  store.log('system', `Ponto de restauração #${n} ${ok ? 'excluído' : 'não pôde ser excluído'}`, ok ? 'info' : 'warning');
  return { ok, message: ok ? 'Ponto de restauração excluído.' : `O Windows recusou a exclusão (código ${r.stdout.trim()}).` };
}

async function restoreTo(seq) {
  const n = Number(seq);
  if (!Number.isInteger(n)) return { ok: false, message: 'Ponto inválido.' };
  store.log('system', `Restaurando o sistema para o ponto #${n} (o PC vai reiniciar)`, 'warning');
  const r = await ps(`Restore-Computer -RestorePoint ${n} -Confirm:$false -ErrorAction Stop`, { timeout: 600000 });
  return { ok: r.ok && !r.stderr.trim(), message: r.ok ? 'Restauração iniciada. O PC vai reiniciar.' : r.stderr.trim().slice(0, 300) };
}

// ───────── Reparos
const REPAIRS = {
  sfc: { label: 'Verificar arquivos do sistema (SFC)', desc: 'Procura e corrige arquivos corrompidos do Windows. Leva de 5 a 20 minutos.', timeout: 3600000,
    script: '$p = Start-Process -FilePath "$env:SystemRoot\\System32\\sfc.exe" -ArgumentList "/scannow" -Wait -PassThru -WindowStyle Hidden; "exit=$($p.ExitCode)"' },
  dism: { label: 'Reparar imagem do Windows (DISM)', desc: 'Restaura a imagem do sistema usada pelo SFC (baixa arquivos do Windows Update). Leva de 10 a 30 minutos.', timeout: 5400000,
    script: '$p = Start-Process -FilePath "$env:SystemRoot\\System32\\dism.exe" -ArgumentList "/Online","/Cleanup-Image","/RestoreHealth" -Wait -PassThru -WindowStyle Hidden; "exit=$($p.ExitCode)"' },
  winsxs: { label: 'Limpar componentes antigos (WinSxS)', desc: 'Remove versões antigas de componentes substituídas por updates. Pode liberar vários GB.', timeout: 3600000,
    script: '$p = Start-Process -FilePath "$env:SystemRoot\\System32\\dism.exe" -ArgumentList "/Online","/Cleanup-Image","/StartComponentCleanup" -Wait -PassThru -WindowStyle Hidden; "exit=$($p.ExitCode)"' },
  wureset: { label: 'Resetar Windows Update', desc: 'Para os serviços, renomeia SoftwareDistribution e catroot2 e religa. Resolve updates travados.', timeout: 300000,
    script: `$s='wuauserv','bits','cryptsvc','msiserver'; foreach($x in $s){ Stop-Service $x -Force -ErrorAction SilentlyContinue }
$t=Get-Date -Format yyyyMMddHHmmss
Rename-Item "$env:SystemRoot\\SoftwareDistribution" "SoftwareDistribution.old$t" -ErrorAction SilentlyContinue
Rename-Item "$env:SystemRoot\\System32\\catroot2" "catroot2.old$t" -ErrorAction SilentlyContinue
foreach($x in $s){ Start-Service $x -ErrorAction SilentlyContinue }; "exit=0"` },
  store: { label: 'Resetar Microsoft Store', desc: 'Limpa o cache da Store (resolve downloads presos).', timeout: 180000,
    script: '$p = Start-Process -FilePath "$env:SystemRoot\\System32\\wsreset.exe" -ArgumentList "-i" -Wait -PassThru; "exit=$($p.ExitCode)"' },
  icons: { label: 'Reconstruir cache de ícones', desc: 'Corrige ícones em branco ou errados. O Explorer reinicia.', timeout: 120000,
    script: `Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep 1
Remove-Item "$env:LOCALAPPDATA\\IconCache.db" -Force -ErrorAction SilentlyContinue
Get-ChildItem "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer" -Filter 'iconcache_*.db' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Start-Process explorer.exe; "exit=0"` },
  explorer: { label: 'Reiniciar Explorer', desc: 'Recarrega barra de tarefas e área de trabalho (aplica tweaks de interface).', timeout: 60000,
    script: 'Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep 1; if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }; "exit=0"' },
  drives: { label: 'Otimizar unidades', desc: 'TRIM nos SSDs e desfragmentação nos HDDs, para todas as unidades fixas.', timeout: 7200000,
    script: `$o=@(); Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter } | ForEach-Object { try { Optimize-Volume -DriveLetter $_.DriveLetter -ErrorAction Stop; $o += $_.DriveLetter } catch {} }; "exit=0 ($($o -join ','))"` },
};

async function repair(id) {
  const x = REPAIRS[id];
  if (!x) return { ok: false, message: 'Ação desconhecida.' };
  const r = await ps(x.script, { timeout: x.timeout });
  const m = r.stdout.match(/exit=(-?\d+)(.*)/);
  const code = m ? Number(m[1]) : -1;
  const ok = code === 0;
  store.log('system', `${x.label}: ${ok ? 'concluído' : `terminou com código ${code}`}`, ok ? 'success' : 'warning');
  const extra = id === 'sfc' && ok ? ' Detalhes em C:\\Windows\\Logs\\CBS\\CBS.log.' : '';
  return { ok, message: ok ? `${x.label}: concluído.${extra}` : `${x.label}: terminou com código ${code}. ${(r.stderr || '').trim().slice(0, 200)}` };
}

function repairList() {
  return Object.entries(REPAIRS).map(([id, x]) => ({ id, label: x.label, desc: x.desc, long: x.timeout > 600000 }));
}

module.exports = { restorePoints, enableRestore, deleteRestorePoint, restoreTo, repair, repairList };
