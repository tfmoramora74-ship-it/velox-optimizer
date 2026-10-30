/* global velox, Pages, h, icon, pageHead, toast, fmt, sparkline, modal, busy */
Pages.benchmark = async (root) => {
  root.appendChild(pageHead('Benchmark', 'Meça, aplique, meça de novo', 'Grave uma medição ANTES de otimizar e outra DEPOIS, no mesmo jogo e na mesma cena. O Velox compara FPS médio, 1% e 0,1% low, estabilidade do frametime, travadas, ping e timer.'));
  const setup = h('div.card');
  const results = h('div.card.mt', { style: { padding: 0 } });
  const compare = h('div.mt');
  root.append(setup, compare, results);
  let list = await velox.bench.list();
  const selected = new Set(list.slice(0, 2).map((r) => r.id));

  async function renderSetup() {
    const st = await velox.fps.status();
    if (!st.exe) {
      setup.replaceChildren(h('h2', 'Antes de começar'), h('div.text2', 'O benchmark usa o PresentMon (gratuito, da Intel) para ler cada quadro do jogo.'),
        h('div.row.mt', h('button.btn.primary', { onclick: async () => { await velox.fps.pickExe(); renderSetup(); } }, icon('folder'), 'Selecionar PresentMon.exe'), h('button.btn.ghost', { onclick: () => velox.shell.open('https://github.com/GameTechDev/PresentMon/releases') }, 'Baixar PresentMon')));
      return;
    }
    const procs = await velox.system.processes();
    const game = h('select.input', { style: { minWidth: '280px' } }, procs.length ? procs.map((p) => h('option', { value: p.pid + '|' + p.name }, `${p.name} — ${p.title.slice(0, 40)}`)) : h('option', { value: '' }, 'Abra o jogo primeiro'));
    const secs = h('select.input', h('option', { value: 30 }, '30 segundos'), h('option', { value: 60 }, '60 segundos'), h('option', { value: 120 }, '2 minutos'));
    const label = h('input.input', { placeholder: 'Nome (ex.: Antes, Depois do preset)', value: list.length ? 'Depois' : 'Antes', style: { minWidth: '220px' } });
    const go = h('button.btn.primary', icon('play'), 'Iniciar medição');
    go.onclick = () => busy(go, async () => {
      if (!game.value) { toast('Abra o jogo e clique em atualizar.', 'warning'); return; }
      const ok = await modal({ title: 'Iniciar benchmark', body: h('div.text2', `Volte para o jogo em até 5 segundos e jogue a mesma cena de sempre durante ${secs.value} segundos. O Velox avisa quando terminar.`), confirm: 'Começar' });
      if (!ok) return;
      await new Promise((r) => setTimeout(r, 5000));
      const [pid, name] = game.value.split('|');
      const r = await velox.bench.run({ pid: Number(pid), name, seconds: Number(secs.value), label: label.value.trim() || 'Sem nome' });
      if (!r.ok) { toast(r.message, 'warning', 8000); return; }
      toast(`Medição "${r.result.label}": ${r.result.fps.toFixed(0)} FPS, 1% low ${r.result.low1.toFixed(0)}.`, 'success', 8000);
      list = await velox.bench.list();
      selected.clear(); list.slice(0, 2).forEach((x) => selected.add(x.id));
      renderAll();
    });
    setup.replaceChildren(h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, 'Nova medição'), h('div.muted.small', 'Para comparar de forma justa: mesma cena, mesma resolução, mesmas configurações gráficas.')), h('button.btn.ghost.sm', { onclick: renderSetup }, icon('refresh'), 'Atualizar jogos')),
      h('div.row.wrap', game, secs, label, go));
  }

  const METRICS = [
    ['fps', 'FPS médio', (v) => v.toFixed(0), 1], ['low1', '1% low', (v) => v.toFixed(0), 1], ['low01', '0,1% low', (v) => v.toFixed(0), 1],
    ['ftSd', 'Variação do frametime', (v) => v.toFixed(2) + ' ms', -1], ['stutters', 'Travadas (quadros > 2,5x a mediana)', (v) => String(v), -1],
    ['cpu', 'Uso de CPU', (v) => v.toFixed(0) + '%', 0], ['gpu', 'Uso de GPU', (v) => v.toFixed(0) + '%', 0],
    ['ping', 'Ping', (v) => v.toFixed(0) + ' ms', -1], ['jitter', 'Jitter', (v) => v.toFixed(1) + ' ms', -1], ['sleep', 'Sleep(1) real', (v) => v.toFixed(3) + ' ms', -1],
  ];

  function renderCompare() {
    const pick = list.filter((r) => selected.has(r.id)).sort((a, b) => a.ts - b.ts);
    if (pick.length !== 2) { compare.replaceChildren(list.length >= 2 ? h('div.muted.small', 'Marque duas medições na lista para comparar.') : ''); return; }
    const [a, b] = pick;
    const delta = (k, dir) => {
      if (a[k] === null || b[k] === null || a[k] === undefined || b[k] === undefined || !a[k]) return h('td');
      const d = ((b[k] - a[k]) / Math.abs(a[k])) * 100;
      const good = dir === 0 ? null : dir * d > 1 ? true : dir * d < -1 ? false : null;
      return h('td.num', h('span.badge' + (good === true ? '.green' : good === false ? '.red' : ''), `${d > 0 ? '+' : ''}${d.toFixed(1)}%`));
    };
    compare.replaceChildren(h('div.card',
      h('h2', `${a.label} → ${b.label}`), h('div.muted.small.mb', `${a.game} · ${fmt.time(a.ts)} vs ${fmt.time(b.ts)} · ${a.tweaks} → ${b.tweaks} tweaks do Velox ativos`),
      h('table', h('thead', h('tr', h('th', 'Métrica'), h('th', a.label), h('th', b.label), h('th', 'Diferença'))),
        h('tbody', METRICS.map(([k, n, f, dir]) => h('tr', h('td', n), h('td.num', a[k] === null || a[k] === undefined ? '—' : f(a[k])), h('td.num', b[k] === null || b[k] === undefined ? '—' : f(b[k])), delta(k, dir))))),
      h('div.mt', h('div.legend', h('span', { style: { '--c': 'var(--text-3)' } }, a.label), h('span', { style: { '--c': 'var(--accent)' } }, b.label)),
        sparkline([{ data: a.history, color: 'var(--text-3)' }, { data: b.history, color: 'var(--accent)' }], { max: Math.max(...a.history, ...b.history) * 1.1, height: 110 }),
        h('div.muted.small', 'Frametime ao longo da medição (mais baixo e mais reto = melhor)')),
      verdict(a, b)));
  }

  function verdict(a, b) {
    const f = ((b.fps - a.fps) / a.fps) * 100;
    const l = ((b.low1 - a.low1) / a.low1) * 100;
    let text;
    if (Math.abs(f) < 3 && Math.abs(l) < 5) text = 'Diferença dentro da margem de erro (menos de 3% no FPS médio). As mudanças não afetaram este jogo de forma mensurável.';
    else if (f > 0 && l >= 0) text = `Melhorou: +${f.toFixed(1)}% de FPS médio e ${l >= 0 ? '+' : ''}${l.toFixed(1)}% no 1% low.`;
    else if (f < 0 && l < 0) text = `Piorou: ${f.toFixed(1)}% de FPS médio e ${l.toFixed(1)}% no 1% low. Reverta os últimos tweaks aplicados e meça de novo.`;
    else text = `Resultado misto: FPS médio ${f > 0 ? '+' : ''}${f.toFixed(1)}% e 1% low ${l > 0 ? '+' : ''}${l.toFixed(1)}%. Repita a medição para confirmar.`;
    return h('div.banner.mt', { style: f < -3 ? {} : { borderColor: 'rgba(59,130,246,.3)', background: 'rgba(59,130,246,.07)' } }, icon('info'), h('div.small', text));
  }

  function renderResults() {
    results.replaceChildren(h('div.card-head', { style: { padding: '16px 16px 0' } }, h('h2', { style: { margin: 0 } }, `Medições (${list.length})`)),
      list.length ? list.map((r) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(r.id) });
        cb.onchange = () => { if (cb.checked) { selected.add(r.id); if (selected.size > 2) selected.delete([...selected][0]); } else selected.delete(r.id); renderAll(); };
        const del = h('button.btn.sm.ghost', icon('trash'));
        del.onclick = async () => { list = await velox.bench.remove(r.id); selected.delete(r.id); renderAll(); };
        return h('div.tweak', cb, h('div.grow', h('div.t-title', r.label, h('span.badge', r.game)), h('div.t-desc', `${fmt.time(r.ts)} · ${r.seconds}s · ${r.frames} quadros`)),
          h('div.num', { style: { textAlign: 'right' } }, h('b', `${r.fps.toFixed(0)} FPS`), h('div.muted.small', `1% ${r.low1.toFixed(0)} · 0,1% ${r.low01.toFixed(0)}`)), del);
      }) : h('div.empty', 'Nenhuma medição ainda.'));
  }

  function renderAll() { renderCompare(); renderResults(); }
  await renderSetup();
  renderAll();
};
