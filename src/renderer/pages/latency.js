/* global velox, Pages, h, icon, pageHead, toast, toastResult, fmt, busy, sparkline, meter, modal */
Pages.latency = async (root, App) => {
  root.appendChild(pageHead('Latency Lab', 'Input lag e frametime sob controle', 'Timer do sistema, memória standby, contador de FPS e presets de latência — tudo num lugar só.'));

  const PRESETS = [
    { id: 'input', name: 'Input lag', desc: 'Mouse 1:1, teclado, fila de entrada, USB sempre ativo e timer global.', tweaks: ['mouse-acceleration', 'keyboard-input-delay', 'input-queue-delay-off', 'usb-selective-suspend-off', 'global-timer-resolution-requests'] },
    { id: 'scheduler', name: 'Agendador', desc: 'CPU para o app em foco, MMCSS para jogos e sem throttling.', tweaks: ['win32-priority-separation', 'mmcss-games', 'mmcss-system-responsiveness', 'power-throttling', 'core-parking'] },
    { id: 'render', name: 'Render / GPU', desc: 'Tela cheia exclusiva, HAGS, MSI mode e sem Game DVR.', tweaks: ['fullscreen-optimizations', 'gpu-hardware-scheduling', 'msi-mode-gpu', 'game-dvr-off', 'fullscreen-overlays-off'] },
    { id: 'dpc', name: 'DPC / kernel', desc: 'Sem dynamic tick, PCIe sem economia e kernel fixo na RAM.', tweaks: ['bcd-disable-dynamic-tick', 'pcie-aspm-off', 'paging-behavior-optimized'] },
  ];

  const grid = h('div.grid.g3');
  const timerCard = h('div.card');
  const memCard = h('div.card');
  const fpsCard = h('div.card');
  grid.append(timerCard, memCard, fpsCard);
  root.append(grid, h('h2.mt', 'Presets de latência'), h('div.grid.g4', PRESETS.map((p) => {
    const b = h('button.btn.sm.primary', 'Aplicar');
    b.onclick = () => App.applyTweaks(p.tweaks, `Preset: ${p.name}`);
    return h('div.card', h('h3', p.name), h('div.text2.small.mt-s', p.desc), h('div.row.mt', b, h('span.muted.small', `${p.tweaks.length} ajustes`)));
  })));

  async function renderTimer() {
    const s = await velox.timer.status();
    timerCard.replaceChildren(
      h('div.card-head', h('h2', { style: { margin: 0 } }, 'Resolução do timer'), s.active ? h('span.badge.green', 'Mantido pelo Velox') : h('span.badge', 'Padrão')),
      h('div.stat', h('div.value', s.current ? s.current.toFixed(3) : '—', h('small', 'ms')), h('div.hint', `Mínimo suportado: ${s.max ? s.max.toFixed(3) : '—'} ms · padrão do Windows: ${s.min ? s.min.toFixed(2) : '15.6'} ms`)),
      h('div.text2.small.mt', 'Um timer mais fino deixa o Sleep() dos jogos mais preciso, reduzindo variação de frametime. O Game Mode já liga isto automaticamente.'),
      h('div.row.mt', customIn, h('span.muted.small', 'ms'),
        h('button.btn.primary.sm', { onclick: async () => {
          const v = parseFloat(String(customIn.value).replace(',', '.'));
          if (!(v >= 0.5 && v <= 15.6)) { toast('Use um valor entre 0,5 e 15,6 ms.', 'warning'); return; }
          await velox.timer.enable(Math.round(v * 10000)); toast(`Timer de ${v} ms ativo.`, 'success'); setTimeout(renderTimer, 600);
        } }, 'Aplicar'),
        h('button.btn.sm.ghost', { onclick: async () => { await velox.timer.disable(); setTimeout(renderTimer, 400); } }, 'Liberar')),
      h('div.muted.small.mt-s', 'Dica: 0,5 ms é o mínimo; muitos jogadores preferem 0,504–0,507 ms, que dá um Sleep(1) mais estável. Meça abaixo.'),
      sleepBox);
  }

  // Medição real: quanto um Sleep(1) demora de verdade com o timer atual
  const customIn = h('input.input', { value: '0.5', style: { width: '80px' } });
  const sleepBox = h('div.mt');
  async function measure(btn) {
    await busy(btn, async () => {
      const r = await velox.timer.measure(100);
      if (!r.ok) { toast(r.message, 'warning'); return; }
      const grade = Math.abs(r.delta) < 0.05 && r.sd < 0.05 ? ['Excelente', 'green'] : Math.abs(r.delta) < 0.2 ? ['Bom', 'blue'] : ['Impreciso', 'amber'];
      sleepBox.replaceChildren(h('div.row.wrap', h('span.badge.' + grade[1], grade[0]), h('span.small', `média ${r.avg.toFixed(3)} ms`), h('span.small.muted', `desvio ${r.sd.toFixed(3)} · máx ${r.max.toFixed(3)}`)),
        sparkline(r.samples, { max: Math.max(2, r.max * 1.1), height: 40 }), measureBtn);
    });
  }
  const measureBtn = h('button.btn.sm.ghost', icon('activity'), 'Medir Sleep(1)');
  measureBtn.onclick = () => measure(measureBtn);
  sleepBox.append(measureBtn);

  async function renderMem() {
    const c = await velox.memory.counters();
    const used = c.total - c.available;
    const row = (label, v, color) => h('div.mt-s', h('div.row.between.small', h('span.text2', label), h('span.num', fmt.bytes(v))), meter((v / c.total) * 100, color));
    const full = h('button.btn.primary.sm', icon('memory'), 'Limpeza completa');
    full.onclick = () => busy(full, async () => { toastResult(await velox.memory.clean('full')); renderMem(); });
    const sb = h('button.btn.sm', 'Só standby');
    sb.onclick = () => busy(sb, async () => { toastResult(await velox.memory.clean('standby')); renderMem(); });
    memCard.replaceChildren(h('h2', 'Memória'),
      row('Em uso', used, ''), row('Standby (cache)', c.standby, 'blue'), row('Modificada', c.modified, 'amber'), row('Livre (zerada)', c.zero, 'green'),
      h('div.text2.small.mt', 'Uma lista standby inchada pode causar engasgos quando o jogo pede memória nova.'),
      h('div.row.mt', full, sb),
      await autoBox());
  }

  // Limpeza automática: dispara quando o standby passa do limite E a memória livre fica abaixo do mínimo
  async function autoBox() {
    const a = await velox.memory.autoGet();
    const st = h('input.input', { value: a.standbyMb, style: { width: '80px' }, type: 'number' });
    const fr = h('input.input', { value: a.freeMb, style: { width: '80px' }, type: 'number' });
    const save = () => velox.memory.autoSet({ standbyMb: Math.max(256, Number(st.value) || 1024), freeMb: Math.max(256, Number(fr.value) || 1024) });
    st.onchange = save; fr.onchange = save;
    return h('div.mt', { style: { borderTop: '1px solid var(--border)', paddingTop: '12px' } },
      h('div.row.between', h('div', h('b', 'Limpeza automática'), h('div.muted.small', a.count ? `Executada ${a.count}x` : 'Fica rodando em segundo plano')), sw(a.enabled, (v) => velox.memory.autoSet({ enabled: v }))),
      h('div.row.wrap.mt-s.small.text2', 'Quando standby >', st, 'MB e livre <', fr, 'MB'));
  }

  let fpsTimer = null;
  async function renderFps() {
    const st = await velox.fps.status();
    if (!st.exe) {
      fpsCard.replaceChildren(h('h2', 'Contador de FPS'),
        h('div.text2.small', 'Usa o PresentMon da Intel (gratuito e de código aberto) para medir FPS, frametime e 1% low de qualquer jogo, sem overlay.'),
        h('div.muted.small.mt', 'Baixe o PresentMon-x64.exe na página de releases do projeto e selecione o arquivo:'),
        h('div.row.mt', h('button.btn.primary.sm', { onclick: async () => { await velox.fps.pickExe(); renderFps(); } }, icon('folder'), 'Selecionar PresentMon.exe'),
          h('button.btn.sm.ghost', { onclick: () => velox.shell.open('https://github.com/GameTechDev/PresentMon/releases') }, 'Abrir releases')));
      return;
    }
    const live = st.running ? await velox.fps.live() : null;
    const startBtn = h('button.btn.sm' + (st.running ? '' : '.primary'), icon(st.running ? 'stop' : 'play'), st.running ? 'Parar' : 'Medir jogo');
    startBtn.onclick = async () => {
      if (st.running) { await velox.fps.stop(); renderFps(); return; }
      const procs = await velox.system.processes();
      const sel = h('select.input', { style: { width: '100%' } }, procs.map((p) => h('option', { value: p.pid }, `${p.name} — ${p.title.slice(0, 50)}`)));
      if (!(await modal({ title: 'Medir FPS', body: h('div', h('div.text2.mb', 'Escolha a janela do jogo:'), sel), confirm: 'Medir' }))) return;
      const r = await velox.fps.start(Number(sel.value));
      if (!r.ok) toast(r.message, 'warning');
      renderFps();
    };
    fpsCard.replaceChildren(h('div.card-head', h('h2', { style: { margin: 0 } }, 'Contador de FPS'), startBtn),
      live && live.fps ? h('div',
        h('div.row', { style: { alignItems: 'flex-end', gap: '18px' } }, h('div.big-fps', Math.round(live.fps)), h('div.col', { style: { gap: '2px' } }, h('span.muted.small', 'FPS'), h('span.small', `${live.frametime.toFixed(2)} ms`), h('span.small.text2', `1% low: ${live.low1 ? Math.round(live.low1) : '—'}`))),
        h('div.mt', sparkline(live.history, { max: Math.max(...live.history) * 1.3, height: 60 })), h('div.muted.small', 'Frametime dos últimos quadros (menor e mais reto = melhor)'))
        : h('div.empty', st.running ? 'Aguardando quadros do jogo...' : 'Selecione um jogo aberto para medir.'));
  }

  // ───────── Dispositivos: MSI mode e afinidade de interrupção
  const devCard = h('div.card.mt', { style: { padding: 0 } });
  root.appendChild(devCard);
  async function renderDevices() {
    const list = await velox.dev.list();
    const threads = navigator.hardwareConcurrency || 8;
    devCard.replaceChildren(
      h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Interrupções por dispositivo (MSI e afinidade)'), h('div.muted.small', 'MSI troca interrupções por linha por mensagens (menos latência). Afinidade fixa as interrupções de um dispositivo num núcleo — use núcleos diferentes do jogo (ex.: GPU e USB do mouse em núcleos separados). Tudo vale após reiniciar.'))),
      list.length ? h('table', h('thead', h('tr', h('th', 'Dispositivo'), h('th', 'Tipo'), h('th', 'MSI'), h('th', 'Núcleo das interrupções'), h('th', ''))),
        h('tbody', list.map((d) => {
          // Controladoras USB atendem mouse/teclado/áudio: mexer nelas é a causa mais comum de engasgos de input
          const risky = /USB|Áudio/.test(d.cls);
          const confirmRisky = () => !risky || modal({ title: `Alterar ${d.cls.toLowerCase()}?`, body: h('div', h('div.banner.red', icon('alert'), h('div.small', 'Mouse, teclado e headset passam por aqui. Mudanças nas interrupções deste dispositivo podem causar travadinhas de input ou áudio picotando.')), h('div.text2', 'Só altere se souber o que está fazendo e meça com o Benchmark depois. Dá para voltar pelo botão de restaurar.')), confirm: 'Alterar mesmo assim', danger: true });
          const msi = d.msiSupported ? sw(d.msi, async (on, input) => { if (!(await confirmRisky())) { input.checked = !on; return; } toastResult(await velox.dev.msi(d.id, on)); }) : h('span.muted.small', 'sem suporte');
          const aff = h('select.input', { style: { height: '30px' } }, h('option', { value: '' }, 'Padrão do Windows'), Array.from({ length: threads }, (_, i) => h('option', { value: i }, `CPU ${i}`)));
          aff.value = typeof d.cpu === 'number' ? String(d.cpu) : '';
          if (Array.isArray(d.cpu)) aff.insertBefore(h('option', { value: 'multi', selected: true }, `CPUs ${d.cpu.join(',')}`), aff.firstChild.nextSibling);
          aff.onchange = async () => {
            if (aff.value === 'multi') return;
            if (aff.value !== '' && !(await confirmRisky())) { renderDevices(); return; }
            toastResult(await velox.dev.affinity(d.id, aff.value === '' ? null : Number(aff.value)));
          };
          const rest = h('button.btn.sm.ghost', { title: 'Restaurar original' }, icon('undo'));
          rest.disabled = !d.saved;
          rest.onclick = async () => { toastResult(await velox.dev.restore(d.id)); renderDevices(); };
          return h('tr', h('td', h('b', d.name)), h('td.small.muted', d.cls), h('td', msi), h('td', aff), h('td', rest));
        }))) : h('div.empty', 'Nenhum dispositivo PCI compatível encontrado.'));
  }
  renderDevices();

  await Promise.all([renderTimer(), renderMem(), renderFps()]);
  fpsTimer = setInterval(async () => { const st = await velox.fps.status(); if (st.running) renderFps(); }, 1000);
  return () => clearInterval(fpsTimer);
};
