/* global velox, Pages, h, icon, pageHead, loading, toast, toastResult, fmt, modal, busy */
Pages.uninstaller = async (root) => {
  const geekBtn = h('button.btn', icon('external'), 'Abrir Geek Uninstaller');
  const refresh = h('button.btn.ghost', icon('refresh'), 'Atualizar');
  root.appendChild(pageHead('Desinstalador', 'Remova qualquer programa sem deixar rastro', 'Roda o desinstalador oficial e depois procura sobras em pastas, atalhos e registro. Pastas vão para a Lixeira e o registro é salvo em .reg antes de apagar.', refresh, geekBtn));

  const tabsEl = h('div.tabs');
  const tools = h('div.row.wrap.mt.mb');
  const listEl = h('div.card', { style: { padding: 0 } }, loading('Lendo programas instalados...'));
  root.append(tabsEl, tools, listEl);

  let data = null;
  let tab = 'programs';
  let query = '';
  let sort = 'name';

  geekBtn.onclick = async () => {
    if (!data || !data.geek) {
      const p = await velox.uninst.pickGeek();
      if (!p) return;
      data.geek = p;
    }
    toastResult(await velox.uninst.openGeek(), 'Geek Uninstaller aberto.');
  };
  refresh.onclick = () => busy(refresh, load);

  async function load() {
    data = await velox.uninst.list();
    geekBtn.title = data.geek || 'Selecionar geek.exe';
    render();
  }

  function render() {
    tabsEl.replaceChildren(
      h('div.tab' + (tab === 'programs' ? '.active' : ''), { onclick: () => { tab = 'programs'; render(); } }, 'Programas', h('span.count', data.programs.length)),
      h('div.tab' + (tab === 'store' ? '.active' : ''), { onclick: () => { tab = 'store'; render(); } }, 'Apps da Microsoft Store', h('span.count', data.store.length)));
    const search = h('input.search', { placeholder: 'Buscar programa ou fabricante...', value: query });
    search.oninput = () => { query = search.value; renderList(); };
    const sortSel = h('select.input', h('option', { value: 'name' }, 'Nome'), h('option', { value: 'size' }, 'Tamanho'), h('option', { value: 'date' }, 'Data de instalação'));
    sortSel.value = sort;
    sortSel.onchange = () => { sort = sortSel.value; renderList(); };
    const total = data.programs.reduce((s, p) => s + (p.size || 0), 0);
    tools.replaceChildren(search, sortSel, h('div.grow'), tab === 'programs' ? h('span.badge', `${fmt.bytes(total)} instalados`) : null);
    renderList();
  }

  function renderList() {
    const q = query.trim().toLowerCase();
    let items = (tab === 'programs' ? data.programs : data.store).filter((p) => !q || (p.name + ' ' + (p.publisher || '')).toLowerCase().includes(q));
    if (sort === 'size') items = [...items].sort((a, b) => (b.size || 0) - (a.size || 0));
    if (sort === 'date') items = [...items].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    listEl.innerHTML = '';
    if (!items.length) { listEl.appendChild(h('div.empty', 'Nada encontrado.')); return; }
    for (const p of items) {
      const img = h('img.prog-icon', { alt: '' });
      const ph = h('div.prog-icon.ph', (p.name || '?').slice(0, 1).toUpperCase());
      if (p.kind === 'win32') velox.uninst.icon(p).then((url) => { if (url) { img.src = url; ph.replaceWith(img); } });
      const un = h('button.btn.sm.danger', 'Desinstalar');
      un.onclick = () => doUninstall(p, un);
      const force = h('button.btn.sm.ghost', { title: 'Remove a entrada e as sobras sem rodar o desinstalador' }, 'Remoção forçada');
      force.onclick = () => doForce(p);
      listEl.appendChild(h('div.prog',
        ph,
        h('div.grow', { style: { minWidth: 0 } }, h('div.prog-name.ellipsis', p.name), h('div.prog-meta.ellipsis', [p.publisher, p.version ? 'v' + p.version : null].filter(Boolean).join(' · ') || '—')),
        h('div.prog-col.num', p.size ? fmt.bytes(p.size) : ''),
        h('div.prog-col.num.muted', p.date || ''),
        h('div.row', un, p.kind === 'win32' ? force : null)));
    }
  }

  async function doUninstall(p, btn) {
    const ok = await modal({ title: `Desinstalar ${p.name}?`, body: h('div.text2', p.kind === 'appx' ? 'O app será removido para a sua conta. Pode ser reinstalado pela Microsoft Store.' : 'O desinstalador do próprio programa vai abrir. Conclua-o normalmente; depois o Velox procura as sobras.'), confirm: 'Desinstalar', danger: true });
    if (!ok) return;
    await busy(btn, async () => {
      const r = await velox.uninst.run(p);
      if (r.missing) { toast(r.message, 'warning', 8000); return doForce(p); }
      toastResult(r);
      if (p.kind === 'win32') await showLeftovers(p, r.ok);
      await load();
    });
  }

  async function doForce(p) {
    const ok = await modal({ title: `Remoção forçada: ${p.name}`, body: h('div.text2', 'Use quando o desinstalador está quebrado ou some. O Velox não roda o desinstalador: apenas lista a entrada e as sobras para você escolher o que apagar.'), confirm: 'Procurar sobras' });
    if (ok) { await showLeftovers(p, false, true); await load(); }
  }

  async function showLeftovers(p, uninstalled, forced = false) {
    const r = await velox.uninst.leftovers(p);
    const items = r.items.filter((i) => forced || i.path !== p.key || !uninstalled);
    if (!items.length) { toast('Nenhuma sobra encontrada. Tudo limpo.', 'success'); return; }
    // Pastas grandes (ex.: biblioteca de jogos do Steam) vêm desmarcadas para não ir nada importante por engano
    const checks = items.map((i) => h('input', { type: 'checkbox', checked: !(i.size > 1024 ** 3) }));
    const TYPES = { folder: ['Pasta', 'folder'], file: ['Atalho', 'link'], registry: ['Registro', 'layers'] };
    const body = h('div',
      h('div.text2.mb', `${items.length} item(ns) relacionados a "${p.name}" ainda existem. Desmarque o que quiser manter.`),
      h('div.leftovers', items.map((it, i) => h('label.check.leftover', checks[i], h('span.badge', TYPES[it.type][0]), h('span.grow.ellipsis', { title: it.path }, it.path), it.size ? h('span.muted.small.num', fmt.bytes(it.size)) : null))),
      items.some((i) => i.size > 1024 ** 3) ? h('div.banner.mt', icon('alert'), h('div.small', 'Pastas com mais de 1 GB vieram desmarcadas: confira se não guardam jogos ou arquivos seus.')) : null,
      h('div.muted.small.mt', 'Pastas e atalhos vão para a Lixeira. Chaves de registro são exportadas para a pasta reg-backups antes de apagar.'));
    if (!(await modal({ title: forced ? 'Remoção forçada' : 'Sobras encontradas', body, confirm: 'Remover selecionados', danger: true }))) return;
    const chosen = items.filter((_, i) => checks[i].checked);
    if (chosen.length) toastResult(await velox.uninst.remove(chosen));
  }

  await load();
};
