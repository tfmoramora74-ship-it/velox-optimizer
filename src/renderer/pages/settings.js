/* global velox, Pages, h, icon, pageHead, toast, toastResult, sw, fmt, modal, busy */
Pages.settings = async (root, App) => {
  root.appendChild(pageHead('Configurações', 'Preferências do app', 'Tudo fica salvo localmente neste PC. Sem conta, sem servidor, sem anúncios.'));
  let s = await velox.settings.get();
  const info = await velox.app.info();
  const set = async (patch) => { s = await velox.settings.set(patch); if (s.error) toast(s.error, 'warning'); };

  const opt = (title, desc, key) => h('div.opt', h('div', h('div.o-title', title), h('div.o-desc', desc)), sw(s[key], (v) => set({ [key]: v })));
  const prefs = h('div.card', h('h2', 'Geral'),
    opt('Iniciar com o Windows', 'Abre minimizado na bandeja, para o Game Mode detectar jogos depois de reiniciar.', 'startWithWindows'),
    opt('Minimizar para a bandeja ao fechar', 'O X esconde a janela; para sair use o menu da bandeja.', 'minimizeToTray'),
    opt('Ponto de restauração antes de aplicar em lote', 'Marcado por padrão no diálogo de confirmação.', 'restorePointBeforeBatch'),
    opt('Confirmar tweaks avançados', 'Pede confirmação extra antes de ligar itens de risco alto.', 'confirmRisky'),
    opt('Proteção contra boot quebrado', 'Se o Windows não chegar à área de trabalho 2 vezes seguidas depois de ajustes que exigem reinício, desfaz tudo sozinho e reinicia uma única vez.', 'bootGuard'),
    h('div.opt', h('div', h('div.o-title', 'Aparência'), h('div.o-desc', 'Moderno: materiais translúcidos e controles no estilo Apple. Clássico: o visual anterior.')),
      (() => {
        const t = h('div.tabs', ['modern', 'classic'].map((id) => h('div.tab' + ((s.theme || 'modern') === id ? '.active' : ''), { onclick: async () => { await set({ theme: id }); App.setTheme(id); t.querySelectorAll('.tab').forEach((x, i) => x.classList.toggle('active', ['modern', 'classic'][i] === id)); } }, id === 'modern' ? 'Moderno' : 'Clássico')));
        return t;
      })()),
    h('div.opt', h('div', h('div.o-title', 'Atalho global'), h('div.o-desc', 'Ctrl+Shift+M mostra/esconde o app.')), h('span.badge', 'Ctrl+Shift+M')));

  const about = h('div.card', h('h2', 'Sobre'),
    h('dl.kv', h('dt', 'Versão'), h('dd', info.version), h('dt', 'Privilégios'), h('dd', info.isAdmin ? 'Administrador' : 'Usuário comum'), h('dt', 'Dados'), h('dd', { title: info.dataDir }, info.dataDir)),
    h('div.row.mt', h('button.btn.sm', { onclick: () => velox.shell.openPath(info.dataDir) }, icon('folder'), 'Abrir pasta de dados'),
      info.isAdmin ? null : h('button.btn.sm.primary', { onclick: () => velox.app.relaunchAdmin() }, 'Reabrir como admin')),
    h('div.muted.small.mt', 'Os backups dos tweaks ficam em rollback.json nessa pasta. Não apague se quiser poder reverter.'));

  const actList = h('div.feed');
  const CATS = { tweaks: 'Tweaks', gamemode: 'Game Mode', memory: 'Memória', network: 'Rede', cleaner: 'Limpeza', startup: 'Inicialização', apptuner: 'App Tuner', system: 'Sistema', latency: 'Latência', services: 'Serviços', devices: 'Dispositivos', profiles: 'Perfis', power: 'Energia', uninstaller: 'Desinstalador', benchmark: 'Benchmark', apps: 'Instalar apps', boot: 'Proteção de boot', nvidia: 'NVIDIA' };
  let catFilter = 'all';
  const filterSel = h('select.input', h('option', { value: 'all' }, 'Todas as categorias'), Object.entries(CATS).map(([k, v]) => h('option', { value: k }, v)));
  filterSel.onchange = () => { catFilter = filterSel.value; renderAct(); };
  let acts = await velox.activity.list();
  function renderAct() {
    const list = acts.filter((a) => catFilter === 'all' || a.category === catFilter);
    actList.replaceChildren(...(list.length ? list.slice(0, 200).map((a) => {
      let undo = null;
      if (a.undo && !a.undone) {
        undo = h('button.btn.sm.ghost', icon('undo'), 'Desfazer');
        undo.onclick = () => busy(undo, async () => { toastResult(await velox.activity.undo(a.id)); acts = await velox.activity.list(); renderAct(); });
      } else if (a.undone) undo = h('span.badge', 'Desfeito');
      return h('div.item', { style: { alignItems: 'center' } }, h('span.badge', CATS[a.category] || a.category), h('div.grow', { style: a.undone ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {} }, a.message), undo, h('span.time', fmt.time(a.ts)));
    }) : [h('div.empty', 'Nenhuma atividade registrada.')]));
  }
  const clear = h('button.btn.sm.ghost', 'Limpar histórico');
  clear.onclick = async () => { if (await modal({ title: 'Limpar todo o histórico?', body: h('div.text2', 'Remove o registro de atividades (não desfaz nenhuma otimização).'), confirm: 'Limpar', danger: true })) { acts = await velox.activity.clear(); renderAct(); } };
  const activity = h('div.card.mt', h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, 'Histórico de atividades'), h('div.muted.small', 'Tudo o que o app fez neste PC.')), h('div.row', filterSel, clear)), actList);
  renderAct();

  // Automações
  const a = await velox.auto.get();
  const when = (ts) => (ts ? fmt.time(ts) : 'nunca');
  const autoOpt = (title, desc, key) => h('div.opt', h('div', h('div.o-title', title), h('div.o-desc', desc)), sw(a[key], async (v) => { await velox.auto.set({ [key]: v }); }));
  const days = h('select.input', [7, 14, 30].map((d) => h('option', { value: d }, `A cada ${d} dias`)));
  days.value = String(a.intervalDays);
  days.onchange = () => velox.auto.set({ intervalDays: Number(days.value) });
  const runNow = h('button.btn.sm', icon('play'), 'Rodar agora');
  runNow.onclick = () => busy(runNow, async () => { await velox.auto.runNow(); toast('Automações executadas.', 'success'); });
  const autoCard = h('div.card', h('h2', 'Automações'),
    autoOpt('Limpeza automática', `Temporários, miniaturas, dumps e caches de atualização. Última: ${when(a.lastClean)}`, 'weeklyClean'),
    autoOpt('Ponto de restauração automático', `Um backup do Windows periódico, para sempre ter um ponto recente. Último: ${when(a.lastRestore)}`, 'weeklyRestore'),
    h('div.row.mt', days, h('div.grow'), runNow),
    h('div.muted.small.mt-s', 'Rodam com o Velox aberto ou na bandeja, e nunca durante uma sessão do Game Mode. A verificação de tweaks desfeitos pelo Windows Update roda sempre que o Velox abre.'));

  // Exportar / importar setup
  const exp = h('button.btn.primary', icon('external'), 'Exportar setup');
  exp.onclick = () => busy(exp, async () => toastResult(await velox.setup.export()));
  const imp = h('button.btn', icon('folder'), 'Importar setup');
  imp.onclick = () => busy(imp, async () => {
    const d = await velox.setup.open();
    if (!d) return;
    if (d.error) { toast(d.error, 'warning'); return; }
    const ok = await modal({ title: 'Importar este setup?', body: h('div', h('div.text2', `Exportado em ${new Date(d.exportedAt).toLocaleString('pt-BR')} (Velox ${d.version}).`),
      h('ul', h('li', `${d.tweaks.length} tweaks`), h('li', `${d.services.length} serviços`), h('li', `${d.apps.length} apps no App Tuner`), h('li', `${(d.profiles || []).length} perfis de jogo`), h('li', 'Preferências, Game Mode e limpeza automática de standby')),
      h('div.muted.small', 'Os tweaks passam pela confirmação normal (com ponto de restauração). Itens que não fazem sentido neste hardware são pulados.')), confirm: 'Importar' });
    if (!ok) return;
    await velox.setup.importBasics(d);
    if (d.tweaks.length) await App.applyTweaks(d.tweaks, 'Tweaks do setup importado');
    if (d.services.length) toastResult(await velox.svc.apply(d.services));
    for (const id of d.apps) await velox.apps.apply(id);
    toast('Setup importado.', 'success');
  });
  const setupCard = h('div.card', h('h2', 'Levar o setup para outro PC'),
    h('div.text2.small', 'Gera um arquivo .velox com seus tweaks, serviços, App Tuner, perfis de jogo e preferências. Importe depois de formatar ou em outro PC.'),
    h('div.row.mt', exp, imp),
    info.portable ? h('div.banner.mt', { style: { borderColor: 'rgba(34,197,94,.3)', background: 'rgba(34,197,94,.07)' } }, icon('check'), h('div.small', h('b', 'Modo portátil: '), 'todos os dados ficam na pasta Velox-Data ao lado do executável.'))
      : h('div.muted.small.mt', 'Para usar em pendrive, rode o arquivo "Velox Optimizer ... (portatil).exe": ele guarda os dados numa pasta Velox-Data ao lado dele.'));

  root.append(h('div.grid.g2', prefs, about), h('div.grid.g2.mt', autoCard, setupCard), activity);
};
