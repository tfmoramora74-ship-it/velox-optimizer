// MSI mode e afinidade de interrupção por dispositivo PCI (GPU, USB, rede, áudio, NVMe), estilo "MSI Utility".
// Cada mudança guarda o valor original; vale após reiniciar.
const reg = require('./reg');
const store = require('./store');
const { psJson } = require('./ps');

const CLASSES = { Display: 'Vídeo', Net: 'Rede', USB: 'Controladora USB', MEDIA: 'Áudio', SCSIAdapter: 'Armazenamento', HDC: 'Armazenamento' };
const base = (id) => `HKLM\\SYSTEM\\CurrentControlSet\\Enum\\${id}\\Device Parameters\\Interrupt Management`;

async function list() {
  const r = await psJson(`$o=@(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\\*' -and $_.Class -in @(${Object.keys(CLASSES).map((c) => `'${c}'`).join(',')}) } | ForEach-Object {
  $k = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\$($_.InstanceId)\\Device Parameters\\Interrupt Management"
  $msiKey = Test-Path "$k\\MessageSignaledInterruptProperties"
  $msi = $null; $lim = $null; if ($msiKey) { $p = Get-ItemProperty "$k\\MessageSignaledInterruptProperties" -ErrorAction SilentlyContinue; $msi = $p.MSISupported; $lim = $p.MessageNumberLimit }
  $a = Get-ItemProperty "$k\\Affinity Policy" -ErrorAction SilentlyContinue
  [ordered]@{ id=$_.InstanceId; name=$_.FriendlyName; cls=[string]$_.Class; msiKey=$msiKey; msi=$msi; limit=$lim; policy=$a.DevicePolicy; mask=@($a.AssignmentSetOverride | ForEach-Object { [int]$_ }) }
}); ConvertTo-Json -InputObject @($o) -Compress -Depth 4`, { timeout: 60000 });
  const backup = store.read('device-backup', {});
  const devs = r.ok && Array.isArray(r.data) ? r.data : [];
  return devs.map((d) => {
    const bytes = Array.isArray(d.mask) ? d.mask : [];
    let cpu = null;
    if (d.policy === 4 && bytes.length) {
      const bits = []; bytes.forEach((b, i) => { for (let j = 0; j < 8; j++) if (b & (1 << j)) bits.push(i * 8 + j); });
      cpu = bits.length === 1 ? bits[0] : bits;
    }
    return { id: d.id, name: d.name, cls: CLASSES[d.cls] || d.cls, msiSupported: !!d.msiKey, msi: d.msi === 1, limit: d.limit, cpu, saved: d.id in backup };
  }).sort((a, b) => a.cls.localeCompare(b.cls));
}

async function snapshot(id) {
  const all = store.read('device-backup', {});
  if (all[id]) return;
  const ops = [
    { key: base(id) + '\\MessageSignaledInterruptProperties', name: 'MSISupported' },
    { key: base(id) + '\\Affinity Policy', name: 'DevicePolicy' },
    { key: base(id) + '\\Affinity Policy', name: 'AssignmentSetOverride' },
  ];
  const cur = await reg.readMany(ops);
  all[id] = ops.map((o, i) => ({ key: o.key, name: o.name, exists: cur[i].exists, type: cur[i].type, value: cur[i].value }));
  store.write('device-backup', all);
}

async function setMsi(id, on) {
  await snapshot(id);
  const w = await reg.writeMany([{ key: base(id) + '\\MessageSignaledInterruptProperties', name: 'MSISupported', type: 'DWord', value: on ? 1 : 0 }]);
  store.log('devices', `MSI ${on ? 'ligado' : 'desligado'}: ${id}`, w.ok ? 'success' : 'warning', { type: 'device', id });
  return { ok: w.ok, message: w.ok ? 'Salvo. Reinicie o PC para valer.' : w.errors.join(' ') };
}

async function setAffinity(id, cpu) {
  await snapshot(id);
  let ops;
  if (cpu === null || cpu === undefined || cpu === '') {
    ops = [{ key: base(id) + '\\Affinity Policy', name: 'DevicePolicy', delete: true }, { key: base(id) + '\\Affinity Policy', name: 'AssignmentSetOverride', delete: true }];
  } else {
    const n = Number(cpu);
    const bytes = new Array(Math.floor(n / 8) + 1).fill(0);
    bytes[Math.floor(n / 8)] = 1 << (n % 8);
    ops = [{ key: base(id) + '\\Affinity Policy', name: 'DevicePolicy', type: 'DWord', value: 4 }, { key: base(id) + '\\Affinity Policy', name: 'AssignmentSetOverride', type: 'Binary', value: bytes }];
  }
  const w = await reg.writeMany(ops);
  store.log('devices', `Afinidade ${cpu === null || cpu === '' ? 'padrão' : 'CPU ' + cpu}: ${id}`, w.ok ? 'success' : 'warning', { type: 'device', id });
  return { ok: w.ok, message: w.ok ? 'Salvo. Reinicie o PC para valer.' : w.errors.join(' ') };
}

async function restore(id) {
  const all = store.read('device-backup', {});
  const b = all[id];
  if (!b) return { ok: false, message: 'Sem backup para este dispositivo.' };
  const w = await reg.writeMany(b.map((s) => (s.exists ? { key: s.key, name: s.name, type: s.type, value: s.value } : { key: s.key, name: s.name, delete: true })));
  delete all[id];
  store.write('device-backup', all);
  return { ok: w.ok, message: 'Configuração original restaurada. Reinicie o PC.' };
}

module.exports = { list, setMsi, setAffinity, restore };
