/* global velox, Pages, h, icon, pageHead, loading, toast, toastResult, modal, sw, busy */
Pages.services = async (root) => {
  const applySafe = h('button.btn.primary', icon('check'), 'Aplicar todos os seguros');
  const restoreAll = h('button.btn', icon('undo'), 'Restaurar tudo');
  root.appendChild(pageHead('Serviços', 'Serviços que você pode desligar', 'Lista curada a partir de guias técnicos (PC-Tuning, Winhance, comunidades de baixa latência) e conferida um a um. Cada item diz o que faz e quando você deve mantê-lo. Desativar guarda o tipo de inicialização original.', restoreAll, applySafe));
  const filters = h('div.tabs.mb');
  const area = h('div', loading('Lendo serviços...'));
  root.append(filters, area);

  const LEVEL = { safe: ['Seguro', 'green', 'Pode desligar sem preocupação na grande maioria dos PCs.'], cond: ['Depende do uso', 'amber', 'Desligue só se você não usa o recurso indicado.'], adv: ['Avançado', 'red', 'Pode quebrar algo útil; leia antes.'] };
  let data = null;
  let filter = 'all';

  async function load() { data = await velox.svc.list(); render(); }

  applySafe.onclick = async () => {
    const todo = data.services.filter((s) => s.level === 'safe' && !s.optimized);
    if (!todo.length) { toast('Todos os serviços seguros já estão otimizados.', 'info'); return; }
    if (!(await modal({ title: `Otimizar ${todo.length} serviços seguros?`, body: h('div', h('ul', todo.map((s) => h('li', s.title, ' → ', s.rec === 4 ? 'Desativado' : 'Manual')))), confirm: 'Aplicar' }))) return;
    await busy(applySafe, async () => { toastResult(await velox.svc.apply(todo.map((s) => s.name))); await load(); });
  };
  restoreAll.onclick = async () => {
    const todo = data.services.filter((s) => s.hasBackup);
    if (!todo.length) { toast('Nenhum serviço alterado pelo Velox.', 'info'); return; }
    if (!(await modal({ title: 'Restaurar serviços?', body: h('div.text2', `${todo.length} serviço(s) alterados pelo Velox voltam ao tipo de inicialização original.`), confirm: 'Restaurar' }))) return;
    await busy(restoreAll, async () => { toastResult(await velox.svc.revert(todo.map((s) => s.name))); await load(); });
  };

  function render() {
    const count = (lv) => data.services.filter((s) => lv === 'all' || s.level === lv).length;
    filters.replaceChildren(...[['all', 'Todos'], ['safe', 'Seguros'], ['cond', 'Depende do uso'], ['adv', 'Avançados'], ['dont', 'Não mexa']].map(([id, label]) =>
      h('div.tab' + (filter === id ? '.active' : ''), { onclick: () => { filter = id; render(); } }, label, h('span.count', id === 'dont' ? data.dont.length : count(id)))));

    if (filter === 'dont') {
      area.replaceChildren(h('div.card', { style: { padding: 0 } }, h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Não desligue estes'), h('div.muted.small', 'Aparecem em listas "otimizadoras" na internet, mas quebram coisas importantes.'))),
        data.dont.map((d) => h('div.tweak', h('div.grow', h('div.t-title', d.title, h('span.badge', d.name)), h('div.t-desc', d.why))))));
      return;
    }
    const items = data.services.filter((s) => filter === 'all' || s.level === filter);
    const optimized = data.services.filter((s) => s.optimized).length;
    const groups = [...new Set(items.map((s) => s.group))];
    area.replaceChildren(
      h('div.row.mb', h('span.badge.green', `${optimized} de ${data.services.length} já otimizados`), h('span.badge', `${data.services.filter((s) => s.running).length} rodando agora`), filter !== 'all' ? h('span.muted.small', LEVEL[filter][2]) : null),
      h('div.card', { style: { padding: 0 } }, groups.map((g) => [
        h('div', { style: { padding: '14px 16px 6px', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'var(--text-3)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' } }, g),
        ...items.filter((s) => s.group === g).map((s) => {
          const [lv, color] = LEVEL[s.level];
          const toggle = sw(s.optimized, async (on, input) => {
            if (on && s.level === 'adv' && !(await modal({ title: s.title, body: h('div', h('div.banner.red', icon('alert'), h('div.small', `Mantenha ligado se ${s.keepIf}.`)), h('div.text2', s.desc)), confirm: 'Desligar mesmo assim', danger: true }))) { input.checked = false; return; }
            const r = on ? await velox.svc.apply([s.name]) : await velox.svc.revert([s.name]);
            toastResult(r);
            await load();
          });
          return h('div.tweak', h('div.grow',
            h('div.t-title', s.title, h('span.badge.' + color, lv), h('span.badge', s.startName), s.running ? h('span.badge.blue', 'Rodando') : null),
            h('div.t-desc', s.desc, h('span.muted', ` (${s.name})`)),
            s.keepIf ? h('div.t-rule', { style: { color: 'var(--warning)' } }, icon('info'), `Mantenha ligado se ${s.keepIf}.`) : null,
            h('div.muted.small', { style: { marginTop: '4px' } }, `Recomendado: ${s.rec === 4 ? 'Desativado' : 'Manual (inicia só quando algo precisa)'}`)), toggle);
        }),
      ])));
  }
  await load();
};
