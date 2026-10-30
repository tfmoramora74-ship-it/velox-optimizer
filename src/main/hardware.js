// Detecção de hardware e sistema (WMI/CIM), com cache.
const os = require('os');
const { psJson } = require('./ps');

let cache = null;

const SCRIPT = `
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,L3CacheSize
$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,DriverDate,PNPDeviceID,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate)
$mem = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed)
$cs = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,PCSystemType,TotalPhysicalMemory
$bat = @(Get-CimInstance Win32_Battery | Select-Object BatteryStatus,EstimatedChargeRemaining)
$osv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$sysLetter = $env:SystemDrive.TrimEnd(':')
$sysDisk = $null
try {
  $part = Get-Partition -DriveLetter $sysLetter -ErrorAction Stop
  $pd = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$part.DiskNumber } | Select-Object -First 1 FriendlyName,MediaType,BusType,Size
  $sysDisk = $pd
} catch {}
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace)
$hagsGpu = $null
$o = [ordered]@{
  cpu=$cpu; gpus=$gpus; mem=$mem; cs=$cs; battery=$bat; disks=$disks; sysDisk=$sysDisk
  os=[ordered]@{ product=$osv.ProductName; display=$osv.DisplayVersion; build=[int]$osv.CurrentBuildNumber; ubr=$osv.UBR }
}
ConvertTo-Json -InputObject $o -Compress -Depth 5
`;

function classifyGpu(name = '') {
  const n = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro/.test(n)) return 'nvidia';
  if (/radeon\s*rx|\brx\s*\d|radeon pro/.test(n)) return 'amd';
  if (/radeon/.test(n)) return 'amd-igpu';
  if (/intel.*arc|\barc\s*a\d/.test(n)) return 'intel-arc';
  if (/intel/.test(n)) return 'intel-igpu';
  if (/microsoft basic|virtual|parsec|meta|citrix/.test(n)) return 'virtual';
  return 'unknown';
}

async function detect(force = false) {
  if (cache && !force) return cache;
  const r = await psJson(SCRIPT, { timeout: 60000 });
  const d = r.ok ? r.data : {};
  const cpu = d.cpu || {};
  const gpus = (Array.isArray(d.gpus) ? d.gpus : d.gpus ? [d.gpus] : []).map((g) => ({
    name: g.Name, vram: g.AdapterRAM, driver: g.DriverVersion, pnp: g.PNPDeviceID,
    kind: classifyGpu(g.Name), width: g.CurrentHorizontalResolution, height: g.CurrentVerticalResolution, hz: g.CurrentRefreshRate,
  }));
  const discrete = gpus.find((g) => ['nvidia', 'amd', 'intel-arc'].includes(g.kind)) || null;
  const mem = Array.isArray(d.mem) ? d.mem : d.mem ? [d.mem] : [];
  const ramBytes = os.totalmem();
  const battery = Array.isArray(d.battery) ? d.battery : d.battery ? [d.battery] : [];
  const isLaptop = (d.cs && (d.cs.PCSystemType === 2)) || battery.length > 0;
  // BatteryStatus 1 = descarregando
  const onBattery = battery.some((b) => b.BatteryStatus === 1);
  const sd = d.sysDisk || {};
  // Get-PhysicalDisk pode devolver número (17=NVMe, 4=SSD, 3=HDD) ou o nome do enum
  const bus = String(sd.BusType ?? ''); const media = String(sd.MediaType ?? '');
  const sysDiskType = bus === '17' || /nvme/i.test(bus) ? 'NVMe' : media === '4' || /ssd/i.test(media) ? 'SSD' : media === '3' || /hdd/i.test(media) ? 'HDD' : 'desconhecido';
  const cpuName = (cpu.Name || '').trim();
  const intelGen = (() => { const m = cpuName.match(/i[3579]-(\d{4,5})/i); return m ? parseInt(m[1].slice(0, m[1].length - 3), 10) : null; })();
  const ryzen = (() => { const m = cpuName.match(/ryzen\s+[3579]\s+(\d{4})/i); return m ? parseInt(m[1], 10) : null; })();
  const build = d.os ? d.os.build : 0;
  cache = {
    cpu: {
      name: cpuName, vendor: /amd/i.test(cpu.Manufacturer || cpuName) ? 'amd' : /intel/i.test(cpu.Manufacturer || cpuName) ? 'intel' : 'other',
      cores: cpu.NumberOfCores || os.cpus().length, threads: cpu.NumberOfLogicalProcessors || os.cpus().length,
      mhz: cpu.MaxClockSpeed, l3: cpu.L3CacheSize,
      intelHybrid: intelGen !== null && intelGen >= 12, ryzenSeries: ryzen,
    },
    gpus, discrete,
    ram: { bytes: ramBytes, gb: Math.round(ramBytes / 1024 ** 3), speed: mem[0] ? mem[0].Speed : null, sticks: mem.length },
    system: { manufacturer: d.cs ? d.cs.Manufacturer : '', model: d.cs ? d.cs.Model : '', isLaptop, onBattery, battery: battery[0] ? battery[0].EstimatedChargeRemaining : null },
    disk: { type: sysDiskType, name: sd.FriendlyName || '', size: sd.Size || null },
    disks: (Array.isArray(d.disks) ? d.disks : d.disks ? [d.disks] : []).map((x) => ({ id: x.DeviceID, size: x.Size, free: x.FreeSpace })),
    os: {
      name: build >= 22000 ? 'Windows 11' : 'Windows 10', product: d.os ? d.os.product : '', display: d.os ? d.os.display : '',
      build, ubr: d.os ? d.os.ubr : 0, isWin11: build >= 22000,
    },
  };
  return cache;
}

// Estado de firmware/BIOS para o guia (somente leitura)
async function bios() {
  const r = await psJson(`$b = Get-CimInstance Win32_BIOS | Select-Object -First 1 SMBIOSBIOSVersion,Manufacturer,ReleaseDate
$bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product
$m = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Speed,ConfiguredClockSpeed,SMBIOSMemoryType)
$p = Get-CimInstance Win32_Processor | Select-Object -First 1 VirtualizationFirmwareEnabled
$sb = $null; try { $sb = Confirm-SecureBootUEFI -ErrorAction Stop } catch {}
$tpm = $null; try { $t = Get-Tpm -ErrorAction Stop; $tpm = [bool]($t.TpmPresent -and $t.TpmReady) } catch {}
$fw = $env:firmware_type
ConvertTo-Json -Compress -Depth 4 @{ biosVersion=$b.SMBIOSBIOSVersion; biosVendor=$b.Manufacturer; biosDate=$(if($b.ReleaseDate){$b.ReleaseDate.ToString('yyyy-MM-dd')}); board=($bb.Manufacturer + ' ' + $bb.Product); boardVendor=$bb.Manufacturer; mem=@($m); vt=$p.VirtualizationFirmwareEnabled; secureBoot=$sb; tpm=$tpm; firmware=$fw }`);
  return r.ok ? r.data : null;
}

module.exports = { detect, bios };
