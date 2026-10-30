/* global velox, Pages, h, icon, pageHead, loading, toast, toastResult, fmt, busy, sparkline, modal */
Pages.network = async (root, App) => {
  root.appendChild(pageHead('Rede', 'Conexão mais rápida e estável', 'Encontre o DNS mais rápido para a sua conexão, teste ping e jitter e aplique os ajustes de rede para jogos.'));
  const top = h('div.grid.g3');
  const dnsCard = h('div.card.span2');
  const adapterCard = h('div.card', loading());
  top.append(dnsCard, adapterCard);
  const mid = h('div.grid.g3.mt');
  const pingCard = h('div.card.span2');
  const toolsCard = h('div.card');
  mid.append(pingCard, toolsCard);
  root.append(top, mid);

  let bench = await velox.net.lastBenchmark();
  let adapters = [];

  async function loadAdapters() {
    adapters = await velox.net.adapters();
    adapterCard.replaceChildren(h('h2', 'Adaptador ativo'),
      ...(adapters.length ? adapters.map((a) => h('div.mb', h('div.row', h('span.dot'), h('b', a.name), h('span.badge', a.speed)),
        h('dl.kv.mt-s', h('dt', 'Placa'), h('dd', a.desc), h('dt', 'IP local'), h('dd', (a.ipv4 || []).join(', ') || '—'), h('dt', 'Gateway'), h('dd', (a.gateway || []).join(', ') || '—'), h('dt', 'DNS atual'), h('dd', (a.dns || []).join(', ') || 'automático')))) : [h('div.empty', 'Nenhum adaptador de rede ativo.')]));
  }

  // DNS criptografado (DoH): a operadora deixa de ver/alterar as consultas DNS
  const dohRow = h('div.opt', { style: { marginBottom: '12px', borderBottom: '1px solid var(--border)' } });
  async function renderDoh() {
    const st = await velox.net.dohState();
    dohRow.replaceChildren(h('div', h('div.o-title', 'DNS criptografado (DNS over HTTPS)'),
      h('div.o-desc', st.supported.length ? `As consultas DNS vão criptografadas por HTTPS: a operadora não vê nem altera os sites que você acessa. Não muda ping de jogo. Servidores: ${st.supported.join(', ')}.` : 'Disponível com Cloudflare, Google, Quad9, AdGuard, OpenDNS, Control D ou CleanBrowsing. Aplique um deles abaixo para ligar.')),
      sw(st.on, async (on, input) => { const r = await velox.net.dohSet(on); toastResult(r); if (!r.ok) input.checked = !on; }));
  }
  renderDoh();

  function renderDns() {
    const run = h('button.btn.primary', icon('activity'), bench ? 'Testar de novo' : 'Testar DNS');
    run.onclick = () => busy(run, async () => { bench = await velox.net.benchmark(); renderDns(); toast('Benchmark de DNS concluído.', 'success'); });
    const restore = h('button.btn', icon('undo'), 'Voltar ao padrão');
    restore.onclick = () => busy(restore, async () => { toastResult(await velox.net.restoreDns()); loadAdapters(); });
    const head = h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, 'Benchmark de DNS'), h('div.muted.small', bench ? `Último teste: ${fmt.time(bench.ts)}` : 'Mede a resposta de 8 provedores públicos com domínios de jogos e serviços comuns.')), h('div.row', restore, run));
    if (!bench) { dnsCard.replaceChildren(head, dohRow, h('div.empty', 'Nenhum teste ainda.')); return; }
    const rec = bench.results.find((r) => r.id === bench.recommended);
    const applyBtn = (r) => {
      if (r.id === 'current') return h('span.muted.small', 'em uso');
      const b = h('button.btn.sm' + (r.id === bench.recommended ? '.primary' : ''), 'Aplicar');
      b.onclick = () => busy(b, async () => {
        const ok = await modal({ title: `Usar DNS ${r.name}?`, body: h('div.text2', `Os adaptadores ativos passarão a usar ${r.servers.join(' e ')}. O DNS original fica salvo para "Voltar ao padrão".`), confirm: 'Aplicar' });
        if (!ok) return;
        toastResult(await velox.net.applyDns(r.id, null, { flush: true }));
        await loadAdapters();
        renderDoh();
      });
      return b;
    };
    dnsCard.replaceChildren(head, dohRow,
      rec ? h('div.banner', { style: { borderColor: 'rgba(34,197,94,.3)', background: 'rgba(34,197,94,.07)' } }, icon('star'), h('div.grow', h('b', `Recomendado: ${rec.name}`), h('span.text2', ` · ${fmt.ms(rec.median)} de mediana, ${rec.reliability}% de respostas`)), applyBtn(rec)) : null,
      h('table', h('thead', h('tr', h('th', 'Provedor'), h('th', 'Servidores'), h('th', 'Mediana'), h('th', 'Melhor'), h('th', 'Respostas'), h('th', ''))),
        h('tbody', bench.results.map((r) => h('tr' + (r.id === bench.recommended ? '.best' : ''), h('td', h('b', r.name)), h('td.muted.small', r.servers.join(' · ')), h('td.num', fmt.ms(r.median)), h('td.num', fmt.ms(r.best)), h('td.num', r.reliability + '%'), h('td', applyBtn(r)))))));
  }

  function renderPing(result) {
    const host = h('input.input', { value: result ? result.host : '1.1.1.1', style: { width: '200px' } });
    const presets = [['Cloudflare', '1.1.1.1'], ['Google', '8.8.8.8'], ['Gateway', adapters[0] && adapters[0].gateway[0]]].filter((p) => p[1]);
    const run = h('button.btn.primary', icon('play'), 'Testar ping');
    run.onclick = () => busy(run, async () => { const r = await velox.net.ping(host.value.trim(), 20); if (!r.ok) toast(r.message || 'Sem resposta.', 'warning'); renderPing(r.ok ? r : null); });
    const s = (label, v, hint) => h('div.stat', h('div.label', label), h('div.value', { style: { fontSize: '22px' } }, v), hint ? h('div.hint', hint) : null);
    pingCard.replaceChildren(
      h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, 'Ping e jitter'), h('div.muted.small', '20 pacotes ICMP. Jitter é a variação entre respostas — quanto menor, mais estável.')), h('div.row', presets.map(([n, ip]) => h('button.btn.sm.ghost', { onclick: () => { host.value = ip; } }, n)), host, run)),
      result ? h('div',
        h('div.grid.g4', s('Média', fmt.ms(result.avg)), s('Mínimo / máximo', `${result.min} / ${result.max} ms`), s('Jitter', fmt.ms(result.jitter), result.jitter < 5 ? 'Excelente' : result.jitter < 15 ? 'Bom' : 'Instável'), s('Perda', `${Math.round((result.lost / result.sent) * 100)}%`, `${result.received}/${result.sent} respostas`)),
        h('div.mt', sparkline(result.samples, { max: Math.max(...result.samples) * 1.2 || 10, height: 70 }))) : h('div.empty', 'Rode um teste para ver a qualidade da conexão.'));
  }

  function renderTools() {
    const act = (id, label, sub) => {
      const b = h('button.btn.block', { style: { justifyContent: 'flex-start', height: '48px' } }, h('div', { style: { textAlign: 'left' } }, h('div', label), h('div.muted.small', { style: { fontWeight: 400 } }, sub)));
      b.onclick = () => busy(b, async () => toastResult(await velox.net.repair(id)));
      return b;
    };
    const boost = h('button.btn.primary.block', icon('rocket'), 'Aplicar tweaks de rede para jogos');
    boost.onclick = () => App.applyTweaks(['network-throttling-off', 'tcp-nagle-off', 'nic-power-mgmt-off', 'delivery-optimization-off'], 'Otimização de rede');
    toolsCard.replaceChildren(h('h2', 'Ferramentas'), h('div.col', boost,
      act('flush', 'Limpar cache DNS', 'Resolve sites que não abrem após troca de DNS'),
      act('renew', 'Renovar IP', 'Libera e pede um novo endereço ao roteador'),
      act('winsock', 'Resetar Winsock', 'Corrige conexões quebradas por apps/VPNs (reiniciar)'),
      act('tcpip', 'Resetar TCP/IP', 'Restaura a pilha de rede ao padrão (reiniciar)')));
  }

  // ───────── Monitor de ping contínuo
  const monCard = h('div.card.mt');
  root.append(monCard);
  const COLORS = ['var(--accent)', 'var(--info)', 'var(--success)', 'var(--warning)'];
  async function renderMon() {
    const active = await velox.net.monActive();
    const gw = adapters[0] && adapters[0].gateway[0];
    const input = h('input.input', { value: active.length ? active.join(', ') : ['1.1.1.1', '8.8.8.8', gw].filter(Boolean).join(', '), style: { flex: 1 } });
    const btn = h('button.btn' + (active.length ? '.danger' : '.primary'), icon(active.length ? 'stop' : 'play'), active.length ? 'Parar' : 'Monitorar');
    btn.onclick = async () => {
      if (active.length) await velox.net.monStop();
      else { App.ping = {}; await velox.net.monStart(input.value.split(/[,\s]+/).filter(Boolean)); }
      renderMon();
    };
    const statsEl = h('div.grid.g4.mt');
    const chartEl = h('div.mt');
    monCard.replaceChildren(
      h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, 'Monitor de ping contínuo'), h('div.muted.small', 'Deixe rodando enquanto joga para ver picos e perda de pacotes ao longo do tempo. Gateway = seu roteador (se ele oscila, o problema é a rede de casa ou o Wi-Fi).')), h('div.row', { style: { flex: '1 1 380px' } }, input, btn)),
      statsEl, chartEl);
    const draw = () => {
      const hosts = Object.keys(App.ping);
      if (!hosts.length) { statsEl.replaceChildren(h('div.muted.small', active.length ? 'Aguardando respostas...' : 'Parado.')); chartEl.replaceChildren(); return; }
      statsEl.replaceChildren(...hosts.map((hst, i) => {
        const s = App.ping[hst]; const ok = s.filter((x) => x.ms !== null).map((x) => x.ms);
        const loss = s.length ? ((s.length - ok.length) / s.length) * 100 : 0;
        const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
        const jit = ok.length > 1 ? ok.slice(1).reduce((a, v, j) => a + Math.abs(v - ok[j]), 0) / (ok.length - 1) : 0;
        return h('div.stat', h('div.label', { style: { color: COLORS[i % 4] } }, hst), h('div.value', { style: { fontSize: '22px' } }, avg === null ? '—' : Math.round(avg), h('small', 'ms')),
          h('div.hint', `máx ${ok.length ? Math.max(...ok) : '—'} · jitter ${jit.toFixed(1)} · perda ${loss.toFixed(1)}%`));
      }));
      const max = Math.max(20, ...hosts.flatMap((hst) => App.ping[hst].map((x) => x.ms || 0))) * 1.15;
      chartEl.replaceChildren(sparkline(hosts.map((hst, i) => ({ data: App.ping[hst].slice(-180).map((x) => (x.ms === null ? max : x.ms)), color: COLORS[i % 4] })), { max, height: 120 }), h('div.muted.small', 'Últimos ~3 minutos · picos no topo do gráfico = pacote perdido'));
    };
    draw();
    monCard._draw = draw;
  }
  let monTick = 0;
  const unsubMon = App.subscribe((ev) => { if (ev.type === 'ping' && monCard._draw && ++monTick % 2 === 0) monCard._draw(); });

  // ───────── Adapter Tuner, pilha TCP e prioridade QoS
  const nicCard = h('div.card.span2');
  const side = h('div.col', { style: { gap: '16px' } });
  const tcpCard = h('div.card');
  const qosCard = h('div.card');
  side.append(tcpCard, qosCard);
  root.append(h('div.grid.g3.mt', nicCard, side));

  async function renderNic() {
    nicCard.replaceChildren(loading('Lendo propriedades da placa de rede...'));
    const { adapter, items } = await velox.net.nicProps();
    if (!adapter) { nicCard.replaceChildren(h('h2', 'Adapter Tuner'), h('div.empty', 'Nenhum adaptador ativo.')); return; }
    const tuned = items.filter((i) => i.rule);
    const pending = tuned.filter((i) => !i.ok);
    const apply = h('button.btn.primary', icon('sliders'), `Aplicar ${pending.length} recomendados`);
    apply.disabled = !pending.length;
    apply.onclick = () => busy(apply, async () => {
      if (!(await modal({ title: 'Ajustar a placa de rede?', body: h('div.text2', `${pending.length} propriedade(s) de "${adapter.desc}" serão alteradas. A conexão cai por alguns segundos enquanto a placa reinicia. Os valores originais ficam salvos.`), confirm: 'Aplicar' }))) return;
      toastResult(await velox.net.nicApply(adapter.name)); renderNic();
    });
    const revert = h('button.btn', icon('undo'), 'Reverter');
    revert.disabled = !items.some((i) => i.saved);
    revert.onclick = () => busy(revert, async () => { toastResult(await velox.net.nicRevert(adapter.name)); renderNic(); });
    nicCard.replaceChildren(
      h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, 'Adapter Tuner'), h('div.muted.small', `${adapter.desc} · ${tuned.length} ajustes conhecidos de ${items.length} propriedades`)), h('div.row', revert, apply)),
      tuned.length ? h('table', h('thead', h('tr', h('th', 'Propriedade'), h('th', 'Atual'), h('th', 'Recomendado'), h('th', ''))),
        h('tbody', tuned.map((i) => h('tr', h('td', h('div', h('b', i.name)), h('div.muted.small', i.rule.why)), h('td.small', i.display || i.value), h('td.small', i.rule.targetDisplay || i.rule.target), h('td', i.ok ? h('span.badge.green', 'OK') : h('span.badge.amber', 'Ajustar'))))))
        : h('div.empty', 'O driver desta placa não expõe ajustes conhecidos.'),
      h('details.mt', h('summary.muted.small', { style: { cursor: 'pointer' } }, `Ver todas as ${items.length} propriedades do driver`),
        h('table.mt-s', h('tbody', items.map((i) => h('tr', h('td.small', i.name), h('td.small.muted', i.kw), h('td.small', i.display)))))));
  }

  async function renderTcp() {
    const st = await velox.net.tcpState();
    const c = st.current || {};
    const row = (k, v) => h('div.row.between.small', h('span.text2', k), h('span', v || '—'));
    tcpCard.replaceChildren(h('h2', 'Pilha TCP (bufferbloat)'),
      h('div.col', { style: { gap: '4px' } }, row('Auto-tuning', c.autotuning), row('Controle de congestionamento', c.congestion), row('ECN', c.ecn), row('RSC (coalescência)', c.rsc), row('RSS', c.rss)),
      h('div.col.mt', Object.entries(st.presets).map(([id, p]) => {
        const b = h('button.btn.block' + (id === 'latency' ? '.primary' : ''), { style: { justifyContent: 'flex-start', height: 'auto', padding: '10px 14px' } }, h('div', { style: { textAlign: 'left' } }, h('div', p.name), h('div.muted.small', { style: { fontWeight: 400, whiteSpace: 'normal' } }, p.desc)));
        b.onclick = () => busy(b, async () => { toastResult(await velox.net.tcpApply(id)); renderTcp(); });
        return b;
      })),
      h('div.muted.small.mt', 'Bufferbloat de verdade se resolve no roteador (SQM/QoS). Teste em waveform.com/tools/bufferbloat.'));
  }

  async function renderQos() {
    const list = await velox.net.qosList();
    const on = h('button.btn.primary.sm', icon('rocket'), list.length ? 'Atualizar lista' : 'Ativar prioridade');
    on.onclick = () => busy(on, async () => { toastResult(await velox.net.qosApply()); renderQos(); });
    const off = h('button.btn.sm', 'Remover');
    off.disabled = !list.length;
    off.onclick = () => busy(off, async () => { toastResult(await velox.net.qosRemove()); renderQos(); });
    qosCard.replaceChildren(h('h2', 'Prioridade de rede para jogos'),
      h('div.text2.small', 'Marca os pacotes dos jogos da biblioteca do Game Mode com DSCP 46 (tráfego em tempo real). Roteadores com QoS/WMM passam esses pacotes na frente de downloads e streams.'),
      h('div.row.mt', list.length ? h('span.badge.green', `${list.length} jogos priorizados`) : h('span.badge', 'Desligado'), h('div.grow'), off, on));
  }

  renderDns();
  renderTools();
  await loadAdapters();
  renderPing(null);
  renderNic(); renderTcp(); renderQos(); renderMon();
  return () => unsubMon();
};
