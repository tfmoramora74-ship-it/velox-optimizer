/* global Pages, h, icon, pageHead, sparkline */
Pages.tests = async (root) => {
  root.appendChild(pageHead('Testes', 'Mouse, cliques e monitor', 'Confira se o mouse entrega a taxa de polling configurada, se o botão tem clique duplo indesejado e se o monitor está na taxa de atualização certa.'));
  const grid = h('div.grid.g2');
  root.appendChild(grid);
  const cleanups = [];

  // ───────── Polling do mouse
  const pollArea = h('div', { style: { height: '220px', borderRadius: '10px', border: '1px dashed var(--border-strong)', display: 'grid', placeItems: 'center', color: 'var(--text-3)', cursor: 'crosshair', marginTop: '12px' } }, 'Mova o mouse rápido em círculos aqui dentro');
  const pollNow = h('div.value', '—');
  const pollStats = h('div.hint', ' ');
  const pollChart = h('div');
  grid.appendChild(h('div.card', h('h2', 'Taxa de polling do mouse'), h('div.stat', pollNow, pollStats), pollChart, pollArea));
  let stamps = [];
  const history = [];
  let peak = 0;
  const onRaw = (e) => {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const x of evs) stamps.push(x.timeStamp);
  };
  const evName = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
  pollArea.addEventListener(evName, onRaw);
  const pollTimer = setInterval(() => {
    const now = performance.now();
    stamps = stamps.filter((t) => t > now - 1000);
    const hz = stamps.length;
    if (hz > 20) { history.push(hz); if (history.length > 60) history.shift(); peak = Math.max(peak, hz); }
    const intervals = stamps.slice(1).map((t, i) => t - stamps[i]);
    const avgInt = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const sd = intervals.length ? Math.sqrt(intervals.reduce((a, b) => a + (b - avgInt) ** 2, 0) / intervals.length) : 0;
    pollNow.replaceChildren(String(hz), h('small', 'Hz'));
    const nominal = [125, 250, 500, 1000, 2000, 4000, 8000].reduce((best, v) => (Math.abs(v - peak) < Math.abs(best - peak) ? v : best), 125);
    pollStats.textContent = peak ? `Pico ${peak} Hz (provável configuração: ${nominal} Hz) · estabilidade ±${sd.toFixed(2)} ms` : 'Aguardando movimento...';
    if (history.length > 1) pollChart.replaceChildren(sparkline(history, { max: Math.max(1100, peak * 1.1), height: 50 }));
  }, 250);
  cleanups.push(() => { clearInterval(pollTimer); });

  // ───────── Teste de clique
  const clickArea = h('div', { style: { height: '160px', borderRadius: '10px', background: 'var(--bg-elevated)', display: 'grid', placeItems: 'center', cursor: 'pointer', marginTop: '12px', userSelect: 'none' } }, 'Clique aqui (botão esquerdo ou direito)');
  const clickInfo = h('div.col', { style: { gap: '4px' } });
  grid.appendChild(h('div.card', h('h2', 'Clique duplo indesejado e CPS'), h('div.text2.small', 'Dois cliques com menos de 80 ms de intervalo, sem você querer, indicam switch gasto (double click).'), clickArea, clickInfo));
  const clicks = { 0: [], 2: [] };
  let doubles = 0;
  const renderClicks = () => {
    const now = performance.now();
    const last5 = [...clicks[0], ...clicks[2]].filter((t) => t > now - 5000).length;
    clickInfo.replaceChildren(
      h('div.row.between.small.mt', h('span.text2', 'Cliques (esq / dir)'), h('b', `${clicks[0].length} / ${clicks[2].length}`)),
      h('div.row.between.small', h('span.text2', 'Cliques por segundo (últimos 5 s)'), h('b', (last5 / 5).toFixed(1))),
      h('div.row.between.small', h('span.text2', 'Suspeitas de clique duplo'), h('span.badge' + (doubles ? '.red' : '.green'), String(doubles))));
  };
  clickArea.addEventListener('contextmenu', (e) => e.preventDefault());
  clickArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const list = clicks[e.button];
    const t = e.timeStamp;
    if (list.length && t - list[list.length - 1] < 80) doubles++;
    list.push(t);
    renderClicks();
  });
  renderClicks();

  // ───────── Monitor
  const hzEl = h('div.value', '—');
  const hzInfo = h('div.hint', ' ');
  const lane = h('div', { style: { position: 'relative', height: '70px', background: 'var(--bg-elevated)', borderRadius: '10px', overflow: 'hidden', marginTop: '12px' } });
  const block = h('div', { style: { position: 'absolute', top: '15px', width: '40px', height: '40px', borderRadius: '8px', background: 'var(--accent)' } });
  lane.appendChild(block);
  grid.appendChild(h('div.card.span2', h('h2', 'Taxa de atualização do monitor'),
    h('div.stat', hzEl, hzInfo),
    h('div.text2.small', 'O bloco deve andar liso, sem pulos. Pulos regulares = quadros perdidos (V-Sync, cabo ou taxa errada no Windows/driver).'), lane));
  let last = performance.now();
  const deltas = [];
  let x = 0;
  let raf;
  let skipped = 0;
  const loop = (t) => {
    const d = t - last; last = t;
    if (d > 0 && d < 200) { deltas.push(d); if (deltas.length > 240) deltas.shift(); }
    const med = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 16.7;
    if (d > med * 1.7 && deltas.length > 60) skipped++;
    x = (x + 6) % Math.max(1, lane.clientWidth - 40);
    block.style.transform = `translateX(${x}px)`;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const hzTimer = setInterval(() => {
    if (deltas.length < 30) return;
    const sorted = [...deltas].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const hz = 1000 / med;
    hzEl.replaceChildren(String(Math.round(hz)), h('small', 'Hz'));
    hzInfo.textContent = `Quadros perdidos desde a abertura: ${skipped}${hz < 70 && screen && window.devicePixelRatio ? ' · se seu monitor é de 144 Hz ou mais, confira em Configurações > Tela > Tela avançada' : ''}`;
  }, 500);
  cleanups.push(() => { cancelAnimationFrame(raf); clearInterval(hzTimer); });

  return () => cleanups.forEach((c) => c());
};
