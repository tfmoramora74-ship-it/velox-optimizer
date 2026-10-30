/* global velox, Pages, h, icon, pageHead, loading, toastResult, modal, busy */
Pages.power = async (root) => {
  const imp = h('button.btn', icon('folder'), 'Importar .pow');
  root.appendChild(pageHead('Energia', 'Planos de energia', 'Ative o plano que preferir — os do Windows, os que você já tem (QuickCPU e outros) ou recriações dos planos mais conhecidos da comunidade. O Velox nunca troca de plano sozinho.', imp));
  const area = h('div', loading());
  root.appendChild(area);

  imp.onclick = () => busy(imp, async () => {
    const r = await velox.pw.import();
    toastResult(r);
    if (r.ok && r.guid && (await modal({ title: 'Ativar o plano importado?', body: h('div.text2', 'O plano foi adicionado à lista do Windows.'), confirm: 'Ativar agora', cancel: 'Depois' }))) await velox.pw.activate(r.guid);
    render();
  });

  async function render() {
    const d = await velox.pw.list();
    const active = d.plans.find((p) => p.active);
    const planRow = (p) => {
      const act = h('button.btn.sm' + (p.active ? '' : '.primary'), p.active ? 'Ativo' : 'Ativar');
      act.disabled = p.active;
      act.onclick = () => busy(act, async () => { toastResult(await velox.pw.activate(p.guid)); render(); });
      const exp = h('button.btn.sm.ghost', { title: 'Exportar .pow' }, icon('external'));
      exp.onclick = async () => toastResult(await velox.pw.export(p.guid, p.name));
      const del = h('button.btn.sm.ghost', { title: 'Apagar' }, icon('trash'));
      del.disabled = p.builtin || p.active;
      del.onclick = async () => { if (await modal({ title: `Apagar "${p.name}"?`, body: h('div.text2', 'Exporte antes se quiser guardar uma cópia.'), confirm: 'Apagar', danger: true })) { toastResult(await velox.pw.remove(p.guid)); render(); } };
      return h('div.tweak', h('div.grow', h('div.t-title', p.name, p.active ? h('span.badge.green', 'Em uso') : null, p.builtin ? h('span.badge', 'Windows') : p.recipe ? h('span.badge.blue', 'Velox') : h('span.badge.purple', 'Personalizado')), h('div.t-desc.muted', p.guid)), h('div.row', act, exp, del));
    };
    const TAG = { Microsoft: 'blue', Comunidade: 'green', Avançado: 'red' };
    area.replaceChildren(
      h('div.card', { style: { padding: 0 } }, h('div.card-head', { style: { padding: '16px 16px 0' } }, h('div', h('h2', { style: { margin: 0 } }, 'Seus planos'), h('div.muted.small', active ? `Em uso: ${active.name}` : ''))), d.plans.map(planRow)),
      h('h2.mt', 'Planos populares da comunidade'),
      h('div.muted.small.mb', 'Recriados pelos próprios valores (não são cópias dos arquivos originais). Criar não apaga nenhum plano seu, e você volta para o anterior quando quiser.'),
      h('div.grid.g2', d.recipes.map((r) => {
        const b = h('button.btn.sm.primary', icon('bolt'), r.installed ? 'Recriar e ativar' : 'Criar e ativar');
        b.onclick = () => busy(b, async () => {
          if (r.tag === 'Avançado' && !(await modal({ title: r.name, body: h('div', h('div.banner.red', icon('alert'), h('div.small', 'Desliga os estados ociosos da CPU: em CPUs Intel sem "K" (como o i5-10400F) isso costuma baixar o turbo e o FPS.')), h('div.text2', r.desc)), confirm: 'Criar mesmo assim', danger: true }))) return;
          toastResult(await velox.pw.install(r.id)); render();
        });
        return h('div.card', h('div.row.between', h('h3', r.name), h('span.badge.' + TAG[r.tag], r.tag)), h('div.text2.small.mt-s', r.desc),
          h('div.row.mt', b, r.installed ? h('span.badge.green', 'Já criado') : null, r.changes ? h('span.muted.small', `${r.changes} ajustes`) : null));
      })),
      h('div.card.mt', h('h2', 'Quer o arquivo original?'), h('div.text2.small', 'Planos como o Bitsum Highest Performance (vem com o ParkControl) ou os de criadores de conteúdo são distribuídos como arquivo .pow. Baixe do site oficial e use "Importar .pow" acima.'),
        h('button.btn.sm.mt', { onclick: () => velox.shell.open('https://bitsum.com/parkcontrol/') }, icon('external'), 'bitsum.com/parkcontrol')));
  }
  render();
};
