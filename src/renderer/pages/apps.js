/* global velox, Pages, h, icon, pageHead, loading, toastResult, fmt, busy */
Pages.apps = async (root) => {
  root.appendChild(pageHead('App Tuner', 'Otimize seus apps com 1 clique', 'Discord, navegadores, launchers, OBS e mais: menos coisa abrindo com o Windows, menos processo em segundo plano e menos cache acumulado. Tudo reversível.'));
  const area = h('div', loading('Procurando apps instalados...'));
  root.appendChild(area);

  const COLORS = { discord: '#5865f2', chrome: '#1a73e8', edge: '#0c8ce9', brave: '#fb542b', opera: '#d6141e', steam: '#1b2838', epic: '#2a2a2a', ea: '#ff4747', ubisoft: '#0070ff', battlenet: '#148eff', spotify: '#1db954', whatsapp: '#25d366', obs: '#302e31', firefox: '#ff7139', streamlabs: '#31c3a2', adobe: '#da1f26' };
  const LETTERS = { discord: 'Dc', chrome: 'Ch', edge: 'Ed', brave: 'Br', opera: 'GX', steam: 'St', epic: 'Ep', ea: 'EA', ubisoft: 'Ub', battlenet: 'B', spotify: 'Sp', whatsapp: 'Wa', obs: 'OBS', firefox: 'Ff', streamlabs: 'SL', adobe: 'Cc' };

  async function render() {
    const apps = await velox.apps.list();
    const installed = apps.filter((a) => a.installed);
    const missing = apps.filter((a) => !a.installed);
    area.innerHTML = '';
    area.appendChild(h('div.row.mb', h('span.badge.green', `${installed.filter((a) => a.optimized).length} otimizados`), h('span.badge', `${installed.length} instalados`), h('span.badge', `${fmt.bytes(installed.reduce((s, a) => s + a.cacheBytes, 0))} em cache`)));
    const card = (a) => {
      const apply = h('button.btn.sm' + (a.optimized ? '' : '.primary'), a.optimized ? 'Reverter' : 'Otimizar');
      apply.disabled = !a.installed;
      apply.onclick = () => busy(apply, async () => { toastResult(a.optimized ? await velox.apps.revert(a.id) : await velox.apps.apply(a.id)); render(); });
      const cache = h('button.btn.sm.ghost', icon('broom'), 'Limpar cache');
      cache.disabled = !a.installed || !a.cacheBytes;
      cache.onclick = () => busy(cache, async () => { toastResult(await velox.apps.clearCache(a.id)); render(); });
      return h('div.card.app-card', { style: { opacity: a.installed ? 1 : 0.5 } },
        h('div.row', h('div.app-icon', { style: { background: COLORS[a.icon] || '#333' } }, LETTERS[a.icon] || a.name[0]),
          h('div.grow', h('h3', a.name), h('div.muted.small', a.installed ? `${fmt.bytes(a.cacheBytes)} de cache` : 'Não instalado')),
          a.optimized ? h('span.badge.green', 'Otimizado') : null),
        h('div.text2.small', a.desc),
        h('div.muted.small', a.note),
        h('div.row', { style: { marginTop: 'auto' } }, apply, cache));
    };
    area.appendChild(h('div.grid.g3', installed.map(card)));
    if (missing.length) area.appendChild(h('div.mt', h('h2.muted', 'Não encontrados neste PC'), h('div.grid.g3', missing.map(card))));
  }
  await render();
};
