// Leitura/escrita em lote do registro usando a API .NET (visão 64 bits).
const { psJson, ps } = require('./ps');

const PRELUDE = `
function BK($h){ $hv = switch($h){ 'HKLM' {[Microsoft.Win32.RegistryHive]::LocalMachine} 'HKCU' {[Microsoft.Win32.RegistryHive]::CurrentUser} 'HKCR' {[Microsoft.Win32.RegistryHive]::ClassesRoot} 'HKU' {[Microsoft.Win32.RegistryHive]::Users} }; [Microsoft.Win32.RegistryKey]::OpenBaseKey($hv,[Microsoft.Win32.RegistryView]::Registry64) }
`;

function split(key) {
  const i = key.indexOf('\\');
  return { h: key.slice(0, i), p: key.slice(i + 1) };
}

function toUnsigned(v, t) {
  if (t === 'DWord' && typeof v === 'number' && v < 0) return v + 4294967296;
  return v;
}

// items: [{ key, name }] -> [{ exists, type, value }]
async function readMany(items) {
  if (!items.length) return [];
  const payload = JSON.stringify(items.map((i) => ({ ...split(i.key), n: i.name })));
  const script = PRELUDE + `
$items = ConvertFrom-Json @'
${payload}
'@
$out = @()
foreach($i in $items){
  $e=$false; $v=$null; $t=$null
  try {
    $k = (BK $i.h).OpenSubKey($i.p)
    if($k -ne $null){
      if($k.GetValueNames() -contains $i.n){
        $e=$true; $t=$k.GetValueKind($i.n).ToString()
        $v=$k.GetValue($i.n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if($t -eq 'Binary'){ $v=@([byte[]]$v | ForEach-Object { [int]$_ }) }
        if($t -eq 'MultiString'){ $v=@([string[]]$v) }
      }
      $k.Close()
    }
  } catch {}
  $out += ,([pscustomobject]@{ e=$e; t=$t; v=$v })
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
`;
  const r = await psJson(script);
  if (!r.ok || !r.data) return items.map(() => ({ exists: false, type: null, value: null }));
  const arr = Array.isArray(r.data) ? r.data : [r.data];
  return arr.map((x) => ({ exists: !!x.e, type: x.t, value: toUnsigned(x.v, x.t) }));
}

// ops: [{ key, name, type, value } | { key, name, delete: true } | { key, deleteKey: true }]
async function writeMany(ops) {
  if (!ops.length) return { ok: true, errors: [] };
  const payload = JSON.stringify(ops.map((o) => ({
    ...split(o.key), n: o.name ?? null, t: o.type ?? null,
    v: o.type === 'DWord' && typeof o.value === 'number' && o.value > 2147483647 ? o.value - 4294967296 : o.value ?? null,
    d: !!o.delete, dk: !!o.deleteKey,
  })));
  const script = PRELUDE + `
$ops = ConvertFrom-Json @'
${payload}
'@
$errs = @()
foreach($o in $ops){
  try {
    $b = BK $o.h
    if($o.dk){ try { $b.DeleteSubKeyTree($o.p,$false) } catch {}; continue }
    if($o.d){ $k=$b.OpenSubKey($o.p,$true); if($k){ $k.DeleteValue($o.n,$false); $k.Close() }; continue }
    $k = $b.CreateSubKey($o.p)
    $kind = [Microsoft.Win32.RegistryValueKind]::($o.t)
    # atribuição direta: um switch "desenrolaria" byte[]/string[] em object[]
    if($o.t -eq 'DWord'){ $k.SetValue($o.n, [int32]$o.v, $kind) }
    elseif($o.t -eq 'QWord'){ $k.SetValue($o.n, [int64]$o.v, $kind) }
    elseif($o.t -eq 'Binary'){ [byte[]]$bytes = @($o.v | ForEach-Object { [byte]$_ }); $k.SetValue($o.n, $bytes, $kind) }
    elseif($o.t -eq 'MultiString'){ [string[]]$strs = @($o.v | ForEach-Object { [string]$_ }); $k.SetValue($o.n, $strs, $kind) }
    else { $k.SetValue($o.n, [string]$o.v, $kind) }
    $k.Close()
  } catch { $errs += ($o.p + '\\' + $o.n + ': ' + $_.Exception.Message) }
}
ConvertTo-Json -InputObject @($errs) -Compress
`;
  const r = await psJson(script);
  const errors = r.ok && Array.isArray(r.data) ? r.data : r.ok ? [] : [r.error];
  return { ok: errors.length === 0, errors };
}

// Lista subchaves (com valores selecionados) de uma chave.
async function listSubkeys(key, names = []) {
  const { h, p } = split(key);
  const script = PRELUDE + `
$names = ConvertFrom-Json '${JSON.stringify(names)}'
$out=@()
$k=(BK '${h}').OpenSubKey('${p.replace(/'/g, "''")}')
if($k){ foreach($s in $k.GetSubKeyNames()){ $o=[ordered]@{ name=$s }; try { $sk=$k.OpenSubKey($s); foreach($n in $names){ $o[$n]=$sk.GetValue($n) }; $sk.Close() } catch {}; $out+= ,([pscustomobject]$o) } }
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
`;
  const r = await psJson(script);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}

module.exports = { readMany, writeMany, listSubkeys, same, ps };
