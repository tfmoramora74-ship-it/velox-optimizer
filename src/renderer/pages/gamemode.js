/* global velox, Pages, h, icon, pageHead, toast, toastResult, sw, sparkline, fmt, modal, busy */
Pages.gamemode = async (root, App) => {
  root.appendChild(pageHead('Game Mode', 'Desempenho máximo enquanto você joga', 'Detecta o jogo automaticamente, aplica ajustes temporários e desfaz tudo quando ele fecha. Nada fica permanente.'));
  const top = h('div.grid.g3');
  const bottom = h('div.grid.g2.mt');
  root.append(top, bottom);
  let state = await velox.gamemode.state();

  const OPTIONS = [
    ['autoDetect', 'Detecção automática', 'Inicia sozinho quando um jogo conhecido abre e encerra quando ele fecha.'],
    ['gamePriority', 'Prioridade acima do normal para o jogo', 'O jogo ganha um pouco de prioridade de CPU. "Alta" foi evitada de propósito: pode roubar tempo do áudio e do mouse e causar engasgos.'],
    ['lowerBackground', 'Rebaixar apps de fundo', 'Navegadores, Spotify, launchers etc. ficam abaixo do normal. Desligado por padrão: pode deixar o Discord picotando a voz.'],
    ['silenceNotifications', 'Silenciar notificações', 'Nenhum toast aparece por cima do jogo.'],
    ['cleanMemory', 'Liberar memória em espera ao iniciar', 'Libera só a lista standby (cache) antes de começar. Não mexe na memória dos programas abertos, para não causar engasgos.'],
    ['timerResolution', 'Timer de 0,5 ms', 'Mantém a resolução de timer do Windows no mínimo durante a sessão.'],
    ['pauseUpdates', 'Pausar Windows Update', 'Para Windows Update, BITS e Otimização de Entrega durante o jogo; volta tudo ao fechar.'],
    ['stopServices', 'Pausar serviços de fundo', 'Para temporariamente serviços que não fazem falta no jogo (busca, SysMain, spooler, telemetria, relatórios de erro...) e religa ao fechar.'],
    ['pCoreAffinity', 'Afinidade para P-cores', 'Em CPUs híbridas (Intel 12ª geração ou mais nova) fixa o jogo nos núcleos de desempenho. Sem efeito em CPUs comuns.'],
    ['adaptive', 'Motor adaptativo', 'Monitora CPU/GPU/RAM e libera memória automaticamente se ela apertar.'],
  ];

  function statusCard() {
    const active = state.active;
    const s = state.session;
    const startBtn = h('button.btn.lg' + (active ? '.danger' : '.primary'), icon(active ? 'stop' : 'play'), active ? 'Encerrar sessão' : 'Iniciar agora');
    startBtn.onclick = () => busy(startBtn, async () => {
      if (active) { await velox.gamemode.stop(); return; }
      const procs = await velox.system.processes();
      const sel = h('select.input', { style: { width: '100%' } }, h('option', { value: '' }, 'Sem jogo específico (sessão geral)'), procs.map((p) => h('option', { value: p.pid + '|' + p.name }, `${p.name} — ${p.title.slice(0, 50)}`)));
      if (!(await modal({ title: 'Iniciar Game Mode', body: h('div', h('div.text2.mb', 'Escolha a janela do jogo para dar prioridade a ele (opcional):'), sel), confirm: 'Iniciar' }))) return;
      const [pid, name] = sel.value ? sel.value.split('|') : [null, null];
      toastResult(await velox.gamemode.start(pid ? Number(pid) : null, name), 'Game Mode iniciado.');
    });
    return h('div.card.hero.span2',
      h('div.gm-status',
        h('div.gm-orb' + (active ? '' : '.off'), icon('gamepad')),
        h('div.grow',
          h('div.row', h('span.dot' + (active ? '.live' : '.off')), h('span.eyebrow', { style: { margin: 0 } }, active ? 'Sessão ativa' : 'Em espera')),
          h('h2', { style: { fontSize: '22px', margin: '4px 0' } }, active ? s.game : state.options.autoDetect ? 'Aguardando um jogo abrir' : 'Detecção automática desligada'),
          h('div.text2', active ? `Há ${fmt.dur(Date.now() - s.startedAt)} · ${s.actions.length} ajustes ativos` : `${state.knownGames.length + state.customGames.length} jogos reconhecidos`)),
        startBtn),
      active ? h('div.mt', h('div.legend', h('span', { style: { '--c': 'var(--accent)' } }, 'CPU'), h('span', { style: { '--c': 'var(--purple)' } }, 'GPU'), h('span', { style: { '--c': 'var(--info)' } }, 'RAM')),
        sparkline([{ data: s.samples.map((x) => x.cpu), color: 'var(--accent)' }, { data: s.samples.map((x) => x.gpu), color: 'var(--purple)' }, { data: s.samples.map((x) => x.ram), color: 'var(--info)' }], { height: 90 })) : null,
      active ? h('div.mt', h('h3', 'O que está ativo'), h('div.col.mt-s', s.actions.map((a) => h('div.row.small.text2', h('span.dot'), a)))) : null);
  }

  function reportCard() {
    const r = state.lastReport;
    if (!r) return h('div.card', h('h2', 'Última sessão'), h('div.empty', 'Quando uma sessão terminar, o resumo aparece aqui.'));
    const stat = (label, v) => h('div.stat', h('div.label', label), h('div.value', { style: { fontSize: '20px' } }, v === null ? '—' : v + '%'));
    let thief = null;
    if (r.gpuThrottlePct >= 10) thief = `GPU limitada por temperatura em ${r.gpuThrottlePct}% da sessão (pico ${r.gpuTempPeak}°C): melhore a ventilação ou a curva das ventoinhas.`;
    else if (r.cpuThrottlePct >= 10) thief = `CPU abaixo do clock máximo em ${r.cpuThrottlePct}% da sessão (temperatura ou limite de energia).`;
    else if (r.ramPeak >= 90) thief = 'Memória cheia: feche apps ou ative "Limpar memória".';
    else if (r.cpuPeak >= 95 && (r.gpuAvg || 0) < 80) thief = 'CPU no limite: o jogo é limitado pela CPU.';
    else if ((r.gpuPeak || 0) >= 97) thief = 'GPU no limite: reduza gráficos ou resolução para mais FPS.';
    return h('div.card',
      h('div.card-head', h('h2', { style: { margin: 0 } }, 'Última sessão'), h('span.muted.small', fmt.time(r.endedAt))),
      h('div.text2', `${r.game} · ${fmt.dur(r.endedAt - r.startedAt)}`),
      h('div.grid.g3.mt', stat('CPU média', r.cpuAvg), stat('GPU média', r.gpuAvg), stat('RAM média', r.ramAvg)),
      h('div.grid.g3.mt-s', stat('CPU pico', r.cpuPeak), stat('GPU pico', r.gpuPeak), stat('RAM pico', r.ramPeak)),
      thief ? h('div.banner.mt', icon('alert'), h('div.small', h('b', 'Maior gargalo: '), thief)) : h('div.muted.small.mt', 'Sessão estável, sem gargalo dominante.'));
  }

  function optionsCard() {
    return h('div.card', h('h2', 'O que o Game Mode faz'), OPTIONS.map(([k, t, d]) => h('div.opt', h('div', h('div.o-title', t), h('div.o-desc', d)),
      sw(state.options[k], async (v) => { state.options = await velox.gamemode.options({ [k]: v }); }))));
  }

  function gamesCard() {
    const input = h('input.input.grow', { placeholder: 'ex.: MeuJogo.exe' });
    const add = h('button.btn', icon('plus'), 'Adicionar');
    add.onclick = async () => {
      const v = input.value.trim();
      if (!/\.exe$/i.test(v)) { toast('Informe o nome do executável terminado em .exe', 'warning'); return; }
      state.customGames = await velox.gamemode.games([...new Set([...state.customGames, v])]);
      render();
    };
    const detect = h('button.btn.sm.primary', icon('refresh'), 'Detectar meus jogos');
    detect.onclick = () => busy(detect, async () => {
      const found = await velox.lib.scan();
      const known = new Set([...state.knownGames, ...state.customGames].map((x) => x.toLowerCase()));
      const fresh = found.filter((g) => !known.has(g.exe.toLowerCase()));
      if (!fresh.length) { toast(`${found.length} jogos encontrados — todos já estão na biblioteca.`, 'info'); return; }
      const checks = fresh.map(() => h('input', { type: 'checkbox', checked: true }));
      const ok = await modal({ title: `${fresh.length} jogo(s) novo(s) encontrados`, body: h('div.leftovers', fresh.map((g, i) => h('label.check.leftover', checks[i], h('span.grow', h('b', g.name), h('div.muted.small', `${g.exe} · ${g.source}`))))), confirm: 'Adicionar' });
      if (!ok) return;
      state.customGames = await velox.gamemode.games([...new Set([...state.customGames, ...fresh.filter((_, i) => checks[i].checked).map((g) => g.exe)])]);
      toast('Biblioteca atualizada. O Game Mode e a prioridade de rede já reconhecem esses jogos.', 'success');
      render();
    });
    return h('div.card',
      h('div.row.between', h('h2', { style: { margin: 0 } }, 'Biblioteca de jogos'), detect),
      h('div.muted.small.mb', 'Executáveis que disparam o Game Mode automaticamente. Adicione os seus.'),
      h('div.row', input, add),
      state.customGames.length ? h('div.row.wrap.mt', state.customGames.map((g) => h('span.chip', g, h('button', { onclick: async () => { state.customGames = await velox.gamemode.games(state.customGames.filter((x) => x !== g)); render(); } }, '×')))) : null,
      h('div.mt', h('div.muted.small.mb', 'Já reconhecidos:'), h('div.row.wrap', state.knownGames.slice(0, 60).map((g) => h('span.badge', g)))));
  }

  function render() {
    top.replaceChildren(statusCard(), reportCard());
    bottom.replaceChildren(optionsCard(), gamesCard());
  }
  render();
  let tick = 0;
  const unsub = App.subscribe((ev) => {
    if (ev.type === 'gamemode') { state = ev.state; render(); }
    else if (state.active && ++tick % 2 === 0) top.firstChild.replaceWith(statusCard());
  });
  return () => unsub();
};
