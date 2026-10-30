/* global velox, Pages, h, icon, pageHead, loading, toast, toastResult, fmt, busy, sw, modal */
Pages.windows = async (root) => {
  root.appendChild(pageHead('Windows', 'Limpeza, inicialização e apps nativos', 'Libere espaço, controle o que abre junto com o Windows e remova bloatware — com ponto de restauração a um clique.'));

  const tabs = [['clean', 'Limpeza', 'broom'], ['startup', 'Inicialização', 'power'], ['debloat', 'Apps nativos', 'trash'], ['repair', 'Reparos', 'settings'], ['restore', 'Backups', 'shield']];
  let current = 'clean';
  const tabsEl = h('div.tabs.mb');
  const body = h('div');
  root.append(tabsEl, body);

  function renderTabs() {
    tabsEl.replaceChildren(...tabs.map(([id, label, ic]) => h('div.tab' + (current === id ? '.active' : ''), { onclick: () => { current = id; renderTabs(); show(); } }, icon(ic), label)));
    tabsEl.querySelectorAll('svg').forEach((s) => { s.style.cssText = 'width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2'; });
  }

  async function show() {
    body.replaceChildren(loading());
    if (current === 'clean') return renderClean();
    if (current === 'startup') return renderStartup();
    if (current === 'debloat') return renderDebloat();
    if (current === 'repair') return renderRepair();
    return renderRestore();
  }

  async function renderClean() {
    const cats = await velox.cleaner.scan();
    const checks = new Map();
    const total = h('b');
    const update = () => { total.textContent = fmt.bytes(cats.filter((c) => checks.get(c.id).checked).reduce((s, c) => s + c.size, 0)); };
    const btn = h('button.btn.primary', icon('broom'), 'Limpar selecionados');
    btn.onclick = () => busy(btn, async () => {
      const ids = cats.filter((c) => checks.get(c.id).checked).map((c) => c.id);
      if (!ids.length) return;
      if (ids.includes('recycle') && !(await modal({ title: 'Esvaziar a Lixeira?', body: h('div.text2', 'Os arquivos da Lixeira serão apagados permanentemente.'), confirm: 'Esvaziar', danger: true }))) return;
      const r = await velox.cleaner.clean(ids);
      toast(`${fmt.bytes(r.freed)} liberados${r.locked ? ` · ${r.locked} itens em uso foram ignorados` : ''}.`, 'success', 6000);
      show();
    });
    body.replaceChildren(h('div.card', { style: { padding: 0 } },
      h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Limpeza de disco'), h('div.muted.small', 'Arquivos em uso são pulados automaticamente.')), h('div.row', h('span.text2', 'Selecionado: '), total, btn)),
      cats.map((c) => {
        const cb = h('input', { type: 'checkbox', checked: c.default && c.size > 0 });
        cb.onchange = update;
        checks.set(c.id, cb);
        return h('div.tweak', cb, h('div.grow', h('div.t-title', c.name), h('div.t-desc', c.desc)), h('div.num', { style: { fontWeight: 600 } }, fmt.bytes(c.size)));
      })));
    update();
  }

  async function renderStartup() {
    const items = await velox.startup.list();
    const enabled = items.filter((i) => i.enabled).length;
    body.replaceChildren(h('div.card', { style: { padding: 0 } },
      h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Apps na inicialização'), h('div.muted.small', 'Desabilitar não apaga nada — usa o mesmo mecanismo do Gerenciador de Tarefas.')), h('span.badge', `${enabled} de ${items.length} habilitados`)),
      items.length ? items.map((i) => h('div.tweak', h('div.grow', h('div.t-title', i.name, h('span.badge', i.location)), h('div.t-desc.ellipsis', { title: i.command }, i.command)),
        sw(i.enabled, async (v) => toastResult(await velox.startup.set(i.id, v))))) : h('div.empty', 'Nada configurado para iniciar com o Windows.')));
  }

  async function renderDebloat() {
    const [cat, status] = await Promise.all([velox.tweaks.catalog(), velox.tweaks.status()]);
    const items = cat.tweaks.filter((t) => t.cat === 'debloat');
    const installed = items.filter((t) => status[t.id].state !== 'absent');
    const removeAll = h('button.btn.primary', icon('trash'), `Remover todos (${installed.length})`);
    removeAll.disabled = !installed.length;
    removeAll.onclick = async () => { const r = await window.App.applyTweaks(installed.map((t) => t.id), 'Remover apps nativos'); if (r) show(); };
    const reinstallAll = h('button.btn', icon('undo'), 'Reinstalar todos');
    reinstallAll.onclick = () => busy(reinstallAll, async () => { for (const t of items.filter((x) => status[x.id].state === 'absent')) await velox.tweaks.revert(t.id); toast('Reinstalação concluída (o que não voltar, baixe pela Store).', 'info'); show(); });
    body.replaceChildren(h('div.card', { style: { padding: 0 } },
      h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Apps nativos do Windows'), h('div.muted.small', 'Todos podem ser reinstalados pela Microsoft Store.')), h('div.row', reinstallAll, removeAll)),
      items.map((t) => {
        const absent = status[t.id].state === 'absent';
        const b = h('button.btn.sm' + (absent ? '' : '.danger'), absent ? 'Reinstalar' : 'Remover');
        b.onclick = () => busy(b, async () => { toastResult(absent ? await velox.tweaks.revert(t.id) : await velox.tweaks.apply(t.id)); show(); });
        return h('div.tweak', h('div.grow', h('div.t-title', t.title, absent ? h('span.badge.green', 'Removido') : h('span.badge', 'Instalado')), h('div.t-desc', t.desc)), b);
      })));
  }

  async function renderRepair() {
    const list = await velox.maint.repairs();
    body.replaceChildren(h('div.grid.g2', list.map((r) => {
      const b = h('button.btn.sm' + (r.long ? '' : '.primary'), icon('play'), 'Executar');
      b.onclick = () => busy(b, async () => {
        if (r.long && !(await modal({ title: r.label, body: h('div.text2', `${r.desc} Você pode continuar usando o PC enquanto roda.`), confirm: 'Executar' }))) return;
        toastResult(await velox.maint.repair(r.id));
      });
      return h('div.card', h('div.row.between', h('h3', r.label), r.long ? h('span.badge.amber', 'Demorado') : null), h('div.text2.small.mt-s', r.desc), h('div.mt', b));
    })));
  }

  async function renderRestore() {
    const data = await velox.maint.points();
    const create = h('button.btn.primary', icon('plus'), 'Criar ponto agora');
    create.onclick = () => busy(create, async () => { toastResult(await velox.system.restorePoint('Velox Optimizer - manual')); renderRestore(); });
    const enable = h('button.btn', icon('shield'), 'Ativar Restauração do Sistema');
    enable.onclick = () => busy(enable, async () => { toastResult(await velox.maint.enable()); renderRestore(); });
    const row = (p) => {
      const del = h('button.btn.sm.ghost', icon('trash'));
      del.title = 'Excluir';
      del.onclick = async () => { if (await modal({ title: 'Excluir ponto de restauração?', body: h('div.text2', `"${p.desc}" de ${new Date(p.time).toLocaleString('pt-BR')} será apagado.`), confirm: 'Excluir', danger: true })) { toastResult(await velox.maint.delete(p.seq)); renderRestore(); } };
      const res = h('button.btn.sm.danger', icon('undo'), 'Restaurar');
      res.onclick = async () => {
        if (await modal({ title: 'Restaurar o sistema?', body: h('div', h('div.banner.red', icon('alert'), h('div.small', 'O PC vai REINICIAR. Salve tudo antes.')), h('div.text2', `O Windows volta ao estado de ${new Date(p.time).toLocaleString('pt-BR')} ("${p.desc}"). Programas instalados depois disso serão removidos; seus arquivos pessoais não são afetados.`)), confirm: 'Restaurar e reiniciar', danger: true })) toastResult(await velox.maint.restore(p.seq));
      };
      return h('div.prog', h('div.prog-icon.ph', icon('shield')), h('div.grow', h('div.prog-name', p.desc), h('div.prog-meta', `${p.typeName} · #${p.seq}`)), h('div.prog-col.num.muted', { style: { width: '150px' } }, new Date(p.time).toLocaleString('pt-BR')), h('div.row', res, del));
    };
    body.replaceChildren(
      h('div.card', { style: { padding: 0 } },
        h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Pontos de restauração'), h('div.muted.small', data.enabled ? `${data.points.length} ponto(s) salvos pelo Windows` : 'A Restauração do Sistema está desligada neste PC.')), h('div.row', data.enabled ? null : enable, create)),
        data.points.length ? data.points.map(row) : h('div.empty', 'Nenhum ponto de restauração ainda.')),
      h('div.card.mt', h('h2', 'Reversão do Velox'), h('div.text2', 'Além do ponto de restauração, cada tweak guarda o valor original. Em Tweaks > "Reverter tudo" você desfaz só o que o Velox mudou, sem perder outras alterações.'),
        h('div.row.mt', h('button.btn', { onclick: () => { location.hash = 'tweaks'; } }, 'Ir para Tweaks'))));
    body.querySelectorAll('.prog-icon svg').forEach((s) => { s.style.cssText = 'width:16px;height:16px;stroke:var(--text-3);fill:none;stroke-width:2'; });
  }

  renderTabs();
  show();
};
