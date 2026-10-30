// Relatório do PC em HTML (autossuficiente) para guardar ou mandar para alguém que vai ajudar.
const store = require('./store');
const hardware = require('./hardware');
const tweaks = require('./tweaks/engine');
const memory = require('./memory');
const network = require('./network');
const power = require('./power');
const services = require('./services');
const startup = require('./startup');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gb = (b) => (b ? (b / 1024 ** 3).toFixed(1) + ' GB' : '—');

async function build(version) {
  const [hw, bios, st, ads, pw, sv, su] = await Promise.all([
    hardware.detect(), hardware.bios(), tweaks.statusAll(), network.adapters(), power.list(), services.list(), startup.list(),
  ]);
  const s = memory.sample();
  const cat = tweaks.catalog();
  const applied = cat.tweaks.filter((t) => st[t.id] && st[t.id].state === 'applied');
  const removed = cat.tweaks.filter((t) => st[t.id] && st[t.id].state === 'absent');
  const benches = store.read('benchmarks', []).slice(0, 4);
  const gm = store.read('gamemode-report', null);
  const drift = store.read('drift', { items: [] });
  const rows = (pairs) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const byCat = {};
  for (const t of applied) (byCat[t.cat] = byCat[t.cat] || []).push(t.title);
  const catName = Object.fromEntries(cat.categories.map((c) => [c.id, c.name]));

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório do PC — Velox Optimizer</title>
<style>body{font:14px/1.5 'Segoe UI',system-ui,sans-serif;background:#0b0c0f;color:#e8ebef;margin:0;padding:32px}main{max-width:980px;margin:auto}
h1{font-size:26px;margin:0}h2{font-size:16px;margin:28px 0 10px;color:#ff6b62}.sub{color:#8b93a0}section{background:#14161b;border:1px solid #23262d;border-radius:12px;padding:16px 18px;margin-top:14px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #22252c;vertical-align:top}th{color:#8b93a0;font-weight:600;width:240px}
.tag{display:inline-block;background:#1d2027;border-radius:99px;padding:2px 9px;margin:2px;font-size:12px}.warn{color:#fbc463}</style></head><body><main>
<h1>Relatório do PC</h1><div class="sub">Gerado pelo Velox Optimizer ${esc(version)} em ${new Date().toLocaleString('pt-BR')}</div>
<h2>Hardware e sistema</h2><section><table>${rows([
    ['Sistema', `${hw.os.name} ${hw.os.display} (build ${hw.os.build})`],
    ['Processador', `${hw.cpu.name} — ${hw.cpu.cores} núcleos / ${hw.cpu.threads} threads`],
    ['Placa de vídeo', hw.gpus.map((g) => `${g.name} (driver ${g.driver})`).join(' + ')],
    ['Monitor', hw.gpus[0] && hw.gpus[0].width ? `${hw.gpus[0].width}×${hw.gpus[0].height} @ ${hw.gpus[0].hz} Hz` : '—'],
    ['Memória', `${hw.ram.gb} GB · ${hw.ram.speed || '?'} MT/s · ${hw.ram.sticks} pente(s)`],
    ['Disco do sistema', `${hw.disk.type} · ${hw.disk.name}`],
    ['Discos', hw.disks.map((d) => `${d.id} ${gb(d.free)} livres de ${gb(d.size)}`).join(' · ')],
    ['Placa-mãe / BIOS', bios ? `${bios.board} · BIOS ${bios.biosVersion} (${bios.biosDate || '?'})` : '—'],
    ['Secure Boot / TPM / UEFI', bios ? `${bios.secureBoot ? 'sim' : 'não'} / ${bios.tpm ? 'sim' : 'não'} / ${bios.firmware || '?'}` : '—'],
    ['Tipo', hw.system.isLaptop ? `Notebook (${hw.system.onBattery ? 'na bateria' : 'na tomada'})` : 'Desktop'],
  ])}</table></section>
<h2>Agora</h2><section><table>${rows([
    ['CPU', `${Math.round(s.cpu)}% · ${s.cpuMhz ? (s.cpuMhz / 1000).toFixed(2) + ' GHz' : '—'}${s.cpuThrottle ? ' · LIMITADA' : ''}`],
    ['GPU', s.gpuInfo ? `${s.gpu === null ? '—' : Math.round(s.gpu) + '%'} · ${s.gpuInfo.temp}°C · ${s.gpuInfo.clock} MHz · ${s.gpuInfo.power ? s.gpuInfo.power.toFixed(0) + ' W' : ''}${s.gpuInfo.thermalThrottle ? ' · LIMITADA POR TEMPERATURA' : ''}` : '—'],
    ['Memória', `${gb(s.ramUsed)} de ${gb(s.ramTotal)} em uso · standby ${gb(s.standby)}`],
    ['Plano de energia', (pw.plans.find((p) => p.active) || {}).name || '—'],
    ['Rede', ads.map((a) => `${a.name} (${a.desc}) ${a.speed} · DNS ${(a.dns || []).join(', ') || 'automático'}`).join(' | ') || '—'],
  ])}</table></section>
<h2>Otimizações ativas (${applied.length})</h2><section>${Object.entries(byCat).map(([c, list]) => `<div><b>${esc(catName[c] || c)}</b><br>${list.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`).join('<br>') || 'Nenhuma.'}
${removed.length ? `<br><b>Apps nativos removidos (${removed.length})</b><br>${removed.map((t) => `<span class="tag">${esc(t.title.replace(/^Remover /, ''))}</span>`).join('')}` : ''}
${drift.items.length ? `<p class="warn">${drift.items.length} otimização(ões) aplicadas pelo Velox foram desfeitas: ${esc(drift.items.map((d) => d.title).join(', '))}</p>` : ''}</section>
<h2>Serviços</h2><section>${sv.services.filter((x) => x.optimized).length} de ${sv.services.length} serviços da lista curada estão desligados ou em manual.<br>
${sv.services.filter((x) => !x.optimized && x.level === 'safe').length ? `Ainda ligados (seguros para desligar): ${esc(sv.services.filter((x) => !x.optimized && x.level === 'safe').map((x) => x.title).join(', '))}` : ''}</section>
<h2>Inicialização</h2><section>${su.filter((x) => x.enabled).map((x) => `<span class="tag">${esc(x.name)}</span>`).join('') || 'Nada inicia com o Windows.'}</section>
${benches.length ? `<h2>Benchmarks recentes</h2><section><table><tr><th>Medição</th><td><b>FPS · 1% low · 0,1% low · travadas · ping</b></td></tr>${benches.map((b) => `<tr><th>${esc(b.label)} — ${esc(b.game)}<br><span class="sub">${new Date(b.ts).toLocaleString('pt-BR')}</span></th><td>${b.fps.toFixed(0)} · ${b.low1.toFixed(0)} · ${b.low01.toFixed(0)} · ${b.stutters} · ${b.ping ? b.ping.toFixed(0) + ' ms' : '—'}</td></tr>`).join('')}</table></section>` : ''}
${gm ? `<h2>Última sessão do Game Mode</h2><section><table>${rows([['Jogo', gm.game], ['Duração', Math.round((gm.endedAt - gm.startedAt) / 60000) + ' min'], ['CPU média/pico', `${gm.cpuAvg}% / ${gm.cpuPeak}%`], ['GPU média/pico', `${gm.gpuAvg}% / ${gm.gpuPeak}%`], ['RAM média/pico', `${gm.ramAvg}% / ${gm.ramPeak}%`], ['GPU temp. pico', gm.gpuTempPeak ? gm.gpuTempPeak + '°C' : '—']])}</table></section>` : ''}
</main></body></html>`;
}

module.exports = { build };
