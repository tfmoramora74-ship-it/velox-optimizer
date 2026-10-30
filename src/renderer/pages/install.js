/* global velox, Pages, h, icon, pageHead, loading, toast, modal, busy */
Pages.install = async (root) => {
  const go = h('button.btn.primary', icon('package'), 'Instalar selecionados');
  root.appendChild(pageHead('Instalar apps', 'Apps essenciais em um clique', 'Usa o winget, gerenciador oficial do Windows: cada app é baixado da fonte oficial, na versão mais nova, e instalado em silêncio. Pós-formatação em minutos.', go));
  const area = h('div', loading('Consultando o winget (pode levar alguns segundos)...'));
  root.appendChild(area);
  const data = await velox.wg.list();
  if (!data.version) {
    area.replaceChildren(h('div.card', h('h2', 'winget não encontrado'), h('div.text2', 'Instale ou atualize o "Instalador de Aplicativo" pela Microsoft Store e reabra esta página.'),
      h('button.btn.mt', { onclick: () => velox.shell.open('ms-windows-store://pdp/?productid=9NBLGGH4NNS1') }, 'Abrir na Microsoft Store')));
    return;
  }
  const checks = new Map();
  area.replaceChildren(h('div.muted.small.mb', `winget ${data.version} · ao instalar você aceita os termos de licença de cada app.`),
    h('div.grid.g3', data.groups.map((g) => h('div.card', h('h2', g.group), h('div.col', { style: { gap: '6px' } }, g.items.map((it) => {
      const c = h('input', { type: 'checkbox', disabled: it.installed });
      checks.set(it.id, c);
      return h('label.check', c, h('span.grow', it.name), it.installed ? h('span.badge.green', 'Instalado') : null);
    }))))));
  go.onclick = async () => {
    const ids = [...checks.entries()].filter(([, c]) => c.checked).map(([id]) => id);
    if (!ids.length) { toast('Marque os apps que quer instalar.', 'info'); return; }
    if (!(await modal({ title: `Instalar ${ids.length} app(s)?`, body: h('div.text2', 'Cada um é baixado do site oficial pelo winget. Pode demorar alguns minutos; você pode continuar usando o PC.'), confirm: 'Instalar' }))) return;
    await busy(go, async () => {
      const r = await velox.wg.install(ids);
      const fails = r.filter((x) => !x.ok);
      toast(fails.length ? `${r.length - fails.length} instalados, ${fails.length} falharam: ${fails.map((f) => f.name).join(', ')}` : `${r.length} app(s) instalados.`, fails.length ? 'warning' : 'success', 10000);
      Pages.install((root.innerHTML = '', root));
    });
  };
};
