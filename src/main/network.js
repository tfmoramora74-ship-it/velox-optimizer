// Rede: adaptadores, benchmark e troca de DNS, ping e reparos.
const dgram = require('dgram');
const { exec, ps, psJson, q } = require('./ps');
const store = require('./store');

const PROVIDERS = [
  { id: 'cloudflare', name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
  { id: 'google', name: 'Google', servers: ['8.8.8.8', '8.8.4.4'] },
  { id: 'quad9', name: 'Quad9', servers: ['9.9.9.9', '149.112.112.112'] },
  { id: 'opendns', name: 'OpenDNS', servers: ['208.67.222.222', '208.67.220.220'] },
  { id: 'adguard', name: 'AdGuard', servers: ['94.140.14.14', '94.140.15.15'] },
  { id: 'cleanbrowsing', name: 'CleanBrowsing', servers: ['185.228.168.9', '185.228.169.9'] },
  { id: 'controld', name: 'Control D', servers: ['76.76.2.0', '76.76.10.0'] },
  { id: 'level3', name: 'Level3', servers: ['4.2.2.1', '4.2.2.2'] },
];

const DOMAINS = ['google.com', 'youtube.com', 'discord.com', 'riotgames.com', 'steampowered.com', 'epicgames.com', 'microsoft.com', 'cloudflare.com', 'amazon.com', 'twitch.tv'];

async function adapters() {
  const r = await psJson(`$o=@(); Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $c = Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue
  $d = Get-DnsClientServerAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
  $o += ,([ordered]@{ index=$_.ifIndex; name=$_.Name; desc=$_.InterfaceDescription; speed=$_.LinkSpeed; mac=$_.MacAddress; media=$_.MediaType;
    ipv4=@($c.IPv4Address | ForEach-Object { $_.IPAddress }); gateway=@($c.IPv4DefaultGateway | ForEach-Object { $_.NextHop }); dns=@($d.ServerAddresses) })
}
ConvertTo-Json -InputObject @($o) -Compress -Depth 4`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

// Consulta DNS tipo A crua via UDP (o resolver do Node tem cache e mascararia a latência).
function resolveOnce(server, host) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 65535);
    const qname = Buffer.concat([...host.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
    const header = Buffer.from([id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    const msg = Buffer.concat([header, qname, Buffer.from([0, 1, 0, 1])]);
    const sock = dgram.createSocket('udp4');
    const t0 = process.hrtime.bigint();
    const done = (v) => { clearTimeout(timer); try { sock.close(); } catch {} resolve(v); };
    const timer = setTimeout(() => done(null), 2000);
    sock.on('message', (m) => {
      if (m.readUInt16BE(0) !== id) return;
      const rcode = m[3] & 15;
      done(rcode === 0 ? Number(process.hrtime.bigint() - t0) / 1e6 : null);
    });
    sock.on('error', () => done(null));
    sock.send(msg, 53, server);
  });
}

async function benchmark(onProgress) {
  const results = [];
  const current = await adapters();
  const currentDns = current[0] && current[0].dns && current[0].dns.length ? current[0].dns : [];
  const list = [...PROVIDERS];
  if (currentDns.length && !PROVIDERS.some((p) => p.servers[0] === currentDns[0])) list.unshift({ id: 'current', name: 'Atual (operadora/roteador)', servers: currentDns.slice(0, 2) });
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    onProgress && onProgress({ index: i, total: list.length, name: p.name });
    const times = [];
    let fails = 0;
    for (const d of DOMAINS) {
      // 1ª consulta pode ir ao autoritativo; a 2ª mede a latência do servidor em si
      await resolveOnce(p.servers[0], d);
      const t = await resolveOnce(p.servers[0], d);
      if (t === null) fails++; else times.push(t);
    }
    times.sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : null;
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    results.push({ ...p, median, avg, best: times[0] ?? null, fails, reliability: Math.round(((DOMAINS.length - fails) / DOMAINS.length) * 100) });
  }
  results.sort((a, b) => (a.median ?? 9999) + a.fails * 100 - ((b.median ?? 9999) + b.fails * 100));
  const best = results.find((r) => r.id !== 'current' && r.median !== null) || null;
  const report = { ts: Date.now(), results, recommended: best ? best.id : null };
  store.write('dns-benchmark', report);
  store.log('network', `Benchmark de DNS: melhor ${best ? best.name : '—'}`, 'info');
  return report;
}

async function applyDns(providerId, index, { flush = true, renew = false } = {}) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return { ok: false, message: 'Provedor desconhecido.' };
  const ads = await adapters();
  const targets = index ? ads.filter((a) => a.index === index) : ads;
  if (!targets.length) return { ok: false, message: 'Nenhum adaptador ativo.' };
  // Backup do DNS original (DHCP ou estático)
  const backup = store.read('dns-backup', {});
  for (const a of targets) {
    if (!backup[a.index]) {
      const r = await psJson(`$i = Get-NetIPInterface -InterfaceIndex ${a.index} -AddressFamily IPv4; $s = (Get-DnsClientServerAddress -InterfaceIndex ${a.index} -AddressFamily IPv4).ServerAddresses; $reg = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\$((Get-NetAdapter -InterfaceIndex ${a.index}).InterfaceGuid)" -ErrorAction SilentlyContinue).NameServer; ConvertTo-Json -Compress @{ dhcp=[string]::IsNullOrEmpty($reg); servers=@($s) }`);
      backup[a.index] = r.ok ? r.data : { dhcp: true, servers: [] };
    }
  }
  store.write('dns-backup', backup);
  const script = targets.map((a) => `Set-DnsClientServerAddress -InterfaceIndex ${a.index} -ServerAddresses ('${p.servers[0]}','${p.servers[1]}')`).join(';')
    + (flush ? ';Clear-DnsClientCache' : '') + (renew ? ';ipconfig /renew | Out-Null' : '');
  const r = await ps(script);
  const ok = r.ok && !r.stderr.trim();
  store.log('network', `DNS ${p.name} aplicado em ${targets.length} adaptador(es)`, ok ? 'success' : 'warning', { type: 'dns' });
  return { ok, message: ok ? `DNS ${p.name} aplicado.` : r.stderr.trim().slice(0, 300) };
}

async function restoreDns() {
  const backup = store.read('dns-backup', {});
  const ads = await adapters();
  const parts = ads.map((a) => {
    const b = backup[a.index];
    if (!b || b.dhcp || !b.servers || !b.servers.length) return `Set-DnsClientServerAddress -InterfaceIndex ${a.index} -ResetServerAddresses`;
    return `Set-DnsClientServerAddress -InterfaceIndex ${a.index} -ServerAddresses (${b.servers.map((s) => `'${s}'`).join(',')})`;
  });
  const r = await ps(parts.join(';') + ';Clear-DnsClientCache');
  store.write('dns-backup', {});
  store.log('network', 'DNS restaurado ao padrão', 'info');
  return { ok: r.ok, message: r.ok ? 'DNS restaurado.' : r.stderr.trim() };
}

async function ping(host = '1.1.1.1', count = 10) {
  if (!/^[a-zA-Z0-9.\-:]+$/.test(host)) return { ok: false, message: 'Host inválido.' };
  const r = await exec('ping.exe', ['-n', String(Math.min(50, Math.max(1, count))), '-w', '1500', host], { timeout: 90000 });
  // "tempo=12ms" / "time<1ms" — o resumo usa "= 12ms" (com espaço) e não entra aqui
  const vals = [...r.stdout.matchAll(/[=<](\d+)ms/gi)].map((m) => Number(m[1]));
  const sent = Math.min(50, Math.max(1, count));
  if (!vals.length) return { ok: false, host, sent, lost: sent, message: 'Sem resposta.' };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const jitter = vals.length > 1 ? vals.slice(1).reduce((a, v, i) => a + Math.abs(v - vals[i]), 0) / (vals.length - 1) : 0;
  return { ok: true, host, sent, received: vals.length, lost: Math.max(0, sent - vals.length), min: Math.min(...vals), max: Math.max(...vals), avg, jitter, samples: vals };
}

const REPAIRS = {
  flush: { label: 'Limpar cache DNS', script: 'Clear-DnsClientCache; ipconfig /flushdns | Out-Null' },
  renew: { label: 'Renovar IP', script: 'ipconfig /release | Out-Null; ipconfig /renew | Out-Null' },
  winsock: { label: 'Resetar Winsock', script: 'netsh winsock reset | Out-Null', restart: true },
  tcpip: { label: 'Resetar pilha TCP/IP', script: 'netsh int ip reset | Out-Null', restart: true },
};
async function repair(id) {
  const x = REPAIRS[id];
  if (!x) return { ok: false, message: 'Ação desconhecida.' };
  const r = await ps(x.script, { timeout: 120000 });
  store.log('network', x.label, r.ok ? 'success' : 'warning');
  return { ok: r.ok, restart: !!x.restart, message: r.ok ? `${x.label}: concluído.${x.restart ? ' Reinicie o PC.' : ''}` : r.stderr.trim() };
}

// ───────── Adapter Tuner: propriedades avançadas da placa de rede
// Recomendações para jogos (latência acima de economia de energia/CPU). target = valor desejado do RegistryValue.
const NIC_RULES = [
  { kw: '*InterruptModeration', target: '0', label: 'Moderação de interrupção', why: 'Entrega cada pacote na hora em vez de agrupar (menos latência, um pouco mais de CPU).' },
  { kw: '*FlowControl', target: '0', label: 'Controle de fluxo', why: 'Evita pausas forçadas na transmissão.' },
  { kw: '*EEE', target: '0', label: 'Energy Efficient Ethernet', why: 'Economia de energia que causa micro-atrasos.' },
  { kw: 'EEELinkAdvertisement', target: '0', label: 'EEE (anúncio de link)', why: 'Economia de energia que causa micro-atrasos.' },
  { kw: 'AdvancedEEE', target: '0', label: 'Advanced EEE', why: 'Economia de energia que causa micro-atrasos.' },
  { kw: 'EnableGreenEthernet', target: '0', label: 'Green Ethernet', why: 'Reduz potência do link em cabos curtos; pode causar quedas.' },
  { kw: 'GigaLite', target: '0', label: 'Giga Lite', why: 'Reduz a velocidade do link para economizar energia.' },
  { kw: 'PowerSavingMode', target: '0', label: 'Modo de economia de energia', why: 'Desliga partes da placa em ociosidade.' },
  { kw: '*SelectiveSuspend', target: '0', label: 'Suspensão seletiva', why: 'Placa entra em suspensão e demora para acordar.' },
  { kw: 'AutoPowerSaveModeEnabled', target: '0', label: 'Auto power saving', why: 'Economia de energia automática.' },
  { kw: '*LsoV2IPv4', target: '0', label: 'Large Send Offload v2 (IPv4)', why: 'Agrupa pacotes grandes na placa; pode atrasar pacotes pequenos.' },
  { kw: '*LsoV2IPv6', target: '0', label: 'Large Send Offload v2 (IPv6)', why: 'Agrupa pacotes grandes na placa; pode atrasar pacotes pequenos.' },
  { kw: '*WakeOnMagicPacket', target: '0', label: 'Wake on Magic Packet', why: 'Não precisa ligar o PC pela rede.' },
  { kw: '*WakeOnPattern', target: '0', label: 'Wake on Pattern', why: 'Não precisa ligar o PC pela rede.' },
  { kw: '*RSS', target: '1', label: 'Receive Side Scaling', why: 'Distribui o processamento de rede entre núcleos.' },
];

async function nicProperties(index) {
  const ads = await adapters();
  const a = index ? ads.find((x) => x.index === index) : ads[0];
  if (!a) return { adapter: null, items: [] };
  const r = await psJson(`$o=@(Get-NetAdapterAdvancedProperty -Name ${q(a.name)} -AllProperties -ErrorAction SilentlyContinue | Where-Object { $_.RegistryKeyword -notlike 'NetCfg*' } | ForEach-Object { [ordered]@{ kw=$_.RegistryKeyword; name=$_.DisplayName; value=[string]($_.RegistryValue -join ','); display=[string]$_.DisplayValue; valid=@($_.ValidRegistryValues); validDisplay=@($_.ValidDisplayValues) } }); ConvertTo-Json -InputObject @($o) -Compress -Depth 3`);
  const props = r.ok && Array.isArray(r.data) ? r.data : [];
  const backup = store.read('nic-backup', {})[a.name] || {};
  const items = props.map((p) => {
    const rule = NIC_RULES.find((x) => x.kw.toLowerCase() === String(p.kw).toLowerCase());
    const can = rule && (!p.valid || !p.valid.length || p.valid.map(String).includes(rule.target));
    return { ...p, rule: can ? { target: rule.target, label: rule.label, why: rule.why, targetDisplay: p.valid && p.validDisplay ? p.validDisplay[p.valid.map(String).indexOf(rule.target)] : rule.target } : null, ok: can ? p.value === rule.target : null, saved: p.kw in backup };
  });
  return { adapter: a, items };
}

async function nicApply(name, kws) {
  const { adapter, items } = await nicProperties();
  if (!adapter || adapter.name !== name) return { ok: false, message: 'Adaptador não encontrado.' };
  const todo = items.filter((i) => i.rule && !i.ok && (!kws || kws.includes(i.kw)));
  if (!todo.length) return { ok: true, message: 'Tudo já está no valor recomendado.' };
  store.update('nic-backup', {}, (b) => { b[name] = b[name] || {}; for (const i of todo) if (!(i.kw in b[name])) b[name][i.kw] = i.value; return b; });
  const r = await ps(todo.map((i) => `try { Set-NetAdapterAdvancedProperty -Name ${q(name)} -RegistryKeyword ${q(i.kw)} -RegistryValue ${q(i.rule.target)} -NoRestart -ErrorAction Stop } catch { Write-Output ("ERR " + ${q(i.kw)}) }`).join(';') + `; Restart-NetAdapter -Name ${q(name)} -Confirm:$false`, { timeout: 120000 });
  const errs = (r.stdout.match(/ERR .+/g) || []);
  store.log('network', `Adapter Tuner: ${todo.length - errs.length} propriedade(s) ajustada(s) em ${name}`, errs.length ? 'warning' : 'success', { type: 'nic', name });
  return { ok: !errs.length, message: errs.length ? `Algumas propriedades não aceitaram o valor: ${errs.join(', ')}` : `${todo.length} propriedade(s) ajustada(s). A conexão caiu por alguns segundos para aplicar.` };
}

async function nicRevert(name) {
  const all = store.read('nic-backup', {});
  const b = all[name];
  if (!b || !Object.keys(b).length) return { ok: false, message: 'Nada para reverter neste adaptador.' };
  const r = await ps(Object.entries(b).map(([kw, v]) => `try { Set-NetAdapterAdvancedProperty -Name ${q(name)} -RegistryKeyword ${q(kw)} -RegistryValue ${q(v)} -NoRestart -ErrorAction Stop } catch {}`).join(';') + `; Restart-NetAdapter -Name ${q(name)} -Confirm:$false`, { timeout: 120000 });
  delete all[name];
  store.write('nic-backup', all);
  store.log('network', `Adapter Tuner revertido em ${name}`, 'info');
  return { ok: r.ok, message: 'Propriedades do adaptador restauradas.' };
}

// ───────── Bufferbloat / pilha TCP
const TCP_READ = `$t = Get-NetTCPSetting -SettingName Internet -ErrorAction SilentlyContinue
$o = Get-NetOffloadGlobalSetting -ErrorAction SilentlyContinue
ConvertTo-Json -Compress @{ autotuning=[string]$t.AutoTuningLevelLocal; ecn=[string]$t.EcnCapability; timestamps=[string]$t.Timestamps; congestion=[string]$t.CongestionProvider; rss=[string]$o.ReceiveSideScaling; rsc=[string]$o.ReceiveSegmentCoalescing }`;

const TCP_PRESETS = {
  latency: { name: 'Baixa latência (jogos)', desc: 'Prioriza resposta: sem coalescência de recebimento, sem timestamps e com CTCP, que reage rápido a filas cheias.', set: { autotuning: 'normal', ecn: 'disabled', timestamps: 'disabled', rss: 'enabled', rsc: 'disabled', congestion: 'ctcp' } },
  speed: { name: 'Alta velocidade (downloads)', desc: 'Prioriza vazão: janela TCP automática, coalescência de recebimento e ECN ligados.', set: { autotuning: 'normal', ecn: 'enabled', timestamps: 'disabled', rss: 'enabled', rsc: 'enabled', congestion: 'cubic' } },
  default: { name: 'Padrão do Windows', desc: 'Volta aos valores de fábrica da pilha TCP.', set: { autotuning: 'normal', ecn: 'disabled', timestamps: 'disabled', rss: 'enabled', rsc: 'enabled', congestion: 'cubic' } },
};

async function tcpState() {
  const r = await psJson(TCP_READ);
  return { current: r.ok ? r.data : null, presets: TCP_PRESETS, backup: store.read('tcp-backup', null) };
}

function tcpScript(s) {
  const map = (v) => (/^(enabled|true|on)$/i.test(v) ? 'enabled' : 'disabled');
  return [
    `netsh int tcp set global autotuninglevel=${s.autotuning.toLowerCase()}`,
    `netsh int tcp set global ecncapability=${map(s.ecn)}`,
    `netsh int tcp set global timestamps=${map(s.timestamps)}`,
    `netsh int tcp set global rss=${map(s.rss)}`,
    `netsh int tcp set global rsc=${map(s.rsc)}`,
    `netsh int tcp set supplemental template=internet congestionprovider=${s.congestion.toLowerCase()}`,
  ].map((c) => `${c} | Out-Null`).join(';');
}

async function tcpApply(id) {
  const p = TCP_PRESETS[id];
  if (!p) return { ok: false, message: 'Preset desconhecido.' };
  const cur = await tcpState();
  if (id !== 'default' && !store.read('tcp-backup', null) && cur.current) store.write('tcp-backup', cur.current);
  let target = p.set;
  if (id === 'default' && store.read('tcp-backup', null)) target = { ...p.set, ...normalizeTcp(store.read('tcp-backup', null)) };
  const r = await ps(tcpScript(target));
  if (id === 'default') store.write('tcp-backup', null);
  store.log('network', `Pilha TCP: ${p.name}`, r.ok ? 'success' : 'warning', id === 'default' ? null : { type: 'tcp' });
  return { ok: r.ok, message: r.ok ? `${p.name} aplicado.` : r.stderr.trim().slice(0, 300) };
}

// Converte a leitura do PowerShell para os valores aceitos pelo netsh
function normalizeTcp(c) {
  const al = { normal: 'normal', disabled: 'disabled', restricted: 'restricted', highlyrestricted: 'highlyrestricted', experimental: 'experimental' };
  const cong = /ctcp|compound/i.test(c.congestion) ? 'ctcp' : /dctcp/i.test(c.congestion) ? 'dctcp' : /newreno/i.test(c.congestion) ? 'newreno' : /bbr2/i.test(c.congestion) ? 'bbr2' : 'cubic';
  return { autotuning: al[String(c.autotuning).toLowerCase()] || 'normal', ecn: c.ecn, timestamps: c.timestamps, rss: c.rss, rsc: c.rsc, congestion: cong };
}

// ───────── Prioridade de rede para jogos (QoS / DSCP 46)
async function qosList() {
  const r = await psJson(`$o=@(Get-NetQosPolicy -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Velox - *' } | ForEach-Object { [ordered]@{ name=$_.Name; app=$_.AppPathName; dscp=$_.DSCPValue } }); ConvertTo-Json -InputObject @($o) -Compress`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function qosApply(exes) {
  const list = [...new Set(exes.filter((e) => /^[\w .()+-]+\.exe$/i.test(e)))];
  const script = [
    "New-Item -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\QoS' -Force | Out-Null",
    "New-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\QoS' -Name 'Do not use NLA' -Value '1' -PropertyType String -Force | Out-Null",
    "Get-NetQosPolicy -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Velox - *' } | Remove-NetQosPolicy -Confirm:$false -ErrorAction SilentlyContinue",
    ...list.map((e) => `New-NetQosPolicy -Name ${q('Velox - ' + e)} -AppPathNameMatchCondition ${q(e)} -DSCPAction 46 -NetworkProfile All -IPProtocolMatchCondition Both -ErrorAction SilentlyContinue | Out-Null`),
  ].join(';');
  const r = await ps(script, { timeout: 120000 });
  store.log('network', `Prioridade QoS (DSCP 46) para ${list.length} jogo(s)`, r.ok ? 'success' : 'warning', { type: 'qos' });
  return { ok: r.ok, message: r.ok ? `Prioridade de rede ativa para ${list.length} jogo(s).` : r.stderr.trim().slice(0, 300) };
}

async function qosRemove() {
  const r = await ps("Get-NetQosPolicy -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Velox - *' } | Remove-NetQosPolicy -Confirm:$false; Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\QoS' -Name 'Do not use NLA' -ErrorAction SilentlyContinue");
  store.log('network', 'Prioridade QoS removida', 'info');
  return { ok: r.ok, message: 'Políticas de prioridade removidas.' };
}

// ───────── DNS criptografado (DNS over HTTPS, nativo do Windows 11)
const DOH = {
  '1.1.1.1': 'https://cloudflare-dns.com/dns-query', '1.0.0.1': 'https://cloudflare-dns.com/dns-query',
  '8.8.8.8': 'https://dns.google/dns-query', '8.8.4.4': 'https://dns.google/dns-query',
  '9.9.9.9': 'https://dns.quad9.net/dns-query', '149.112.112.112': 'https://dns.quad9.net/dns-query',
  '208.67.222.222': 'https://doh.opendns.com/dns-query', '208.67.220.220': 'https://doh.opendns.com/dns-query',
  '94.140.14.14': 'https://dns.adguard-dns.com/dns-query', '94.140.15.15': 'https://dns.adguard-dns.com/dns-query',
  '76.76.2.0': 'https://freedns.controld.com/p0', '76.76.10.0': 'https://freedns.controld.com/p0',
  '185.228.168.9': 'https://doh.cleanbrowsing.org/doh/security-filter/', '185.228.169.9': 'https://doh.cleanbrowsing.org/doh/security-filter/',
};

async function dohState() {
  const ads = await adapters();
  const r = await psJson(`$o=@(); foreach($a in Get-NetAdapter -Physical | Where-Object Status -eq 'Up'){ $g=$a.InterfaceGuid; $k="HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\$g\\DohInterfaceSettings\\Doh"; $ips=@(); if(Test-Path $k){ $ips=@(Get-ChildItem $k | ForEach-Object { $_.PSChildName }) }; $o+= ,@{ index=$a.ifIndex; ips=$ips } }; ConvertTo-Json -InputObject @($o) -Compress -Depth 3`);
  const enc = r.ok && Array.isArray(r.data) ? r.data : [];
  const servers = ads.flatMap((a) => a.dns || []);
  const supported = servers.filter((s) => DOH[s]);
  const on = supported.length > 0 && supported.every((s) => enc.some((e) => (e.ips || []).includes(s)));
  return { on, servers, supported, win11: true };
}

async function dohSet(enable) {
  const st = await dohState();
  if (enable && !st.supported.length) return { ok: false, message: 'Seu DNS atual não tem versão criptografada conhecida. Aplique Cloudflare, Google, Quad9, AdGuard ou OpenDNS no benchmark acima.' };
  const lines = [];
  for (const ip of st.supported) {
    const t = DOH[ip];
    if (enable) lines.push(`if (Get-DnsClientDohServerAddress -ServerAddress ${q(ip)} -ErrorAction SilentlyContinue) { Set-DnsClientDohServerAddress -ServerAddress ${q(ip)} -DohTemplate ${q(t)} -AllowFallbackToUdp $true -AutoUpgrade $true | Out-Null } else { Add-DnsClientDohServerAddress -ServerAddress ${q(ip)} -DohTemplate ${q(t)} -AllowFallbackToUdp $true -AutoUpgrade $true | Out-Null }`);
  }
  lines.push(`foreach($a in Get-NetAdapter -Physical | Where-Object Status -eq 'Up'){ $g=$a.InterfaceGuid; $base="HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\$g\\DohInterfaceSettings\\Doh"
  foreach($ip in ConvertFrom-Json ${q(JSON.stringify(st.supported))}){ $k = "$base\\$ip"
    ${enable ? "New-Item -Path $k -Force | Out-Null; New-ItemProperty -Path $k -Name DohFlags -PropertyType QWord -Value 1 -Force | Out-Null" : 'Remove-Item -Path $k -Recurse -Force -ErrorAction SilentlyContinue'} } }`);
  lines.push('Clear-DnsClientCache');
  const r = await ps(lines.join('\n'));
  const after = await dohState();
  store.log('network', `DNS criptografado ${enable ? 'ligado' : 'desligado'}`, after.on === enable ? 'success' : 'warning');
  return { ok: after.on === enable, message: after.on === enable ? (enable ? 'DNS criptografado ligado: suas consultas vão por HTTPS.' : 'DNS criptografado desligado.') : (r.stderr.trim().slice(0, 200) || 'O Windows não aceitou a mudança.') };
}

// ───────── Monitor de ping contínuo (ping -t por host; cada resposta vira uma amostra)
const monitors = new Map();
function pingMonitorStart(hosts, onSample) {
  pingMonitorStop();
  for (const host of hosts.filter((x) => /^[a-zA-Z0-9.\-:]+$/.test(x)).slice(0, 4)) {
    const p = require('child_process').spawn('ping.exe', ['-t', '-w', '1000', host], { windowsHide: true });
    let buf = '';
    p.stdout.on('data', (b) => {
      buf += String(b);
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/[=<](\d+)ms/i);
        if (m) onSample({ host, ts: Date.now(), ms: Number(m[1]) });
        else if (/tempo limite|timed out|inacess|unreachable|falha|failure/i.test(l)) onSample({ host, ts: Date.now(), ms: null });
      }
    });
    monitors.set(host, p);
  }
  return { ok: true, hosts: [...monitors.keys()] };
}
function pingMonitorStop() {
  for (const p of monitors.values()) { try { p.kill(); } catch {} }
  monitors.clear();
  return { ok: true };
}

module.exports = {
  dohState, dohSet,
  pingMonitorStart, pingMonitorStop, pingMonitorActive: () => [...monitors.keys()],
  nicProperties, nicApply, nicRevert, tcpState, tcpApply, qosList, qosApply, qosRemove, PROVIDERS, adapters, benchmark, applyDns, restoreDns, ping, repair, lastBenchmark: () => store.read('dns-benchmark', null) };
