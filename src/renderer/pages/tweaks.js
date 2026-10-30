/* global velox, Pages, h, icon, pageHead, loading, toast, toastResult, modal, sw, riskBadge */
Pages.tweaks = async (root, App) => {
  const revertAll = h('button.btn', icon('undo'), 'Reverter tudo');
  const applySel = h('button.btn.primary', icon('check'), 'Aplicar selecionados');
  root.appendChild(pageHead('Tweaks', 'Otimizações profundas do Windows', 'Cada ajuste guarda o valor original antes de mudar e pode ser revertido a qualquer momento. Passe o olho na descrição antes de ligar os avançados.', revertAll, applySel));
  const area = h('div', loading('Verificando o estado de cada tweak...'));
  root.appendChild(area);

  const cat = await velox.tweaks.catalog();
  let status = await velox.tweaks.status();
  const settings = await velox.settings.get();
  let current = 'all';
  let query = '';
  let filter = 'all';
  const selected = new Set();

  const STATE = { applied: ['Ativo', 'green'], partial: ['Parcial', 'amber'], off: ['Inativo', ''], absent: ['Removido', 'green'], unavailable: ['Indisponível', ''] };

  revertAll.onclick = async () => {
    const n = Object.values(status).filter((s) => s.hasBackup).length;
    if (!n) { toast('Nenhum tweak aplicado pelo Velox para reverter.', 'info'); return; }
    if (!(await modal({ title: 'Reverter tudo?', body: h('div.text2', `${n} tweak(s) aplicados pelo Velox voltarão ao valor original.`), confirm: 'Reverter tudo', danger: true }))) return;
    const r = await velox.tweaks.revertAll();
    toast(`${r.filter((x) => x.ok).length} revertidos.`, 'success');
    status = await velox.tweaks.status(); render();
  };
  applySel.onclick = async () => {
    if (!selected.size) { toast('Marque os tweaks que quer aplicar.', 'info'); return; }
    const r = await App.applyTweaks([...selected]);
    if (r) { selected.clear(); status = await velox.tweaks.status(); render(); }
  };

  async function toggle(t, on, input) {
    if (on && t.risk === 'high' && settings.confirmRisky) {
      const ok = await modal({ title: t.title, body: h('div', h('div.banner.red', icon('alert'), h('div.small', 'Ajuste avançado. Leia com atenção:')), h('div.text2', t.desc)), confirm: 'Aplicar mesmo assim', danger: true });
      if (!ok) { input.checked = false; return; }
    }
    const r = on ? await velox.tweaks.apply(t.id) : await velox.tweaks.revert(t.id);
    toastResult(r);
    status = await velox.tweaks.status();
    if (!r.ok) input.checked = ['applied', 'absent'].includes(status[t.id].state);
    renderList();
  }

  const tabsEl = h('div.tabs');
  const listEl = h('div.card', { style: { padding: 0 } });
  const tools = h('div.row.wrap.mb');

  function render() {
    area.innerHTML = '';
    const counts = {};
    for (const t of cat.tweaks) counts[t.cat] = (counts[t.cat] || 0) + 1;
    const active = cat.tweaks.filter((t) => ['applied'].includes(status[t.id].state)).length;
    tabsEl.replaceChildren(
      h('div.tab' + (current === 'all' ? '.active' : ''), { onclick: () => { current = 'all'; render(); } }, 'Todos', h('span.count', cat.tweaks.length)),
      ...cat.categories.map((c) => h('div.tab' + (current === c.id ? '.active' : ''), { onclick: () => { current = c.id; render(); } }, c.name, h('span.count', counts[c.id] || 0))));
    const search = h('input.search', { placeholder: 'Buscar tweak...', value: query });
    search.oninput = () => { query = search.value; renderList(); };
    const sel = h('select.input', h('option', { value: 'all' }, 'Todos os estados'), h('option', { value: 'on' }, 'Ativos'), h('option', { value: 'off' }, 'Inativos'), h('option', { value: 'safe' }, 'Só seguros'));
    sel.value = filter;
    sel.onchange = () => { filter = sel.value; renderList(); };
    tools.replaceChildren(search, sel, h('div.grow'), h('span.badge.green', `${active} ativos`), h('span.badge', `${Object.values(status).filter((s) => s.hasBackup).length} com backup`));
    area.append(tabsEl, h('div.mt', tools), listEl);
    renderList();
  }

  function renderList() {
    const q = query.trim().toLowerCase();
    const items = cat.tweaks.filter((t) => (current === 'all' || t.cat === current)
      && (!q || (t.title + ' ' + t.desc + ' ' + t.id).toLowerCase().includes(q))
      && (filter === 'all' || (filter === 'on' && ['applied', 'absent'].includes(status[t.id].state)) || (filter === 'off' && !['applied', 'absent'].includes(status[t.id].state)) || (filter === 'safe' && t.risk === 'low')));
    listEl.innerHTML = '';
    if (!items.length) { listEl.appendChild(h('div.empty', 'Nenhum tweak encontrado.')); return; }
    let lastCat = null;
    for (const t of items) {
      if (current === 'all' && t.cat !== lastCat) {
        lastCat = t.cat;
        const c = cat.categories.find((x) => x.id === t.cat);
        listEl.appendChild(h('div', { style: { padding: '14px 16px 6px', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--text-3)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' } }, c ? c.name : t.cat));
      }
      const s = status[t.id];
      const on = ['applied', 'absent'].includes(s.state);
      const blocked = s.rule.level === 'block';
      const [stLabel, stColor] = STATE[s.state] || STATE.off;
      const check = h('input', { type: 'checkbox', checked: selected.has(t.id), disabled: on || blocked || s.state === 'unavailable' });
      check.onchange = () => { if (check.checked) selected.add(t.id); else selected.delete(t.id); };
      const toggleEl = sw(on, (v, input) => toggle(t, v, input));
      if ((blocked && !on) || (s.state === 'unavailable')) toggleEl.style.visibility = 'hidden';
      listEl.appendChild(h('div.tweak' + (blocked && !on ? '.blocked' : ''), check,
        h('div.grow',
          h('div.t-title', t.title, riskBadge(t.risk), h('span.badge' + (stColor ? '.' + stColor : ''), stLabel), t.restart ? h('span.badge.blue', 'Reiniciar') : null),
          h('div.t-desc', t.desc),
          s.rule.level !== 'ok' && s.rule.reason ? h('div.t-rule', { style: { color: blocked ? 'var(--danger)' : 'var(--warning)' } }, icon(blocked ? 'x' : 'alert'), s.rule.reason) : null),
        toggleEl));
    }
  }
  render();
};
