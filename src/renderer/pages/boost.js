/* global velox, Pages, h, icon, pageHead, loading, toast, riskBadge */
Pages.boost = async (root, App) => {
  root.appendChild(pageHead('Game Boost', 'Otimização em 1 clique', 'Escolha o objetivo do PC. O Velox seleciona as otimizações certas para ele e pula as que não fazem sentido no seu hardware.'));
  const area = h('div', loading('Lendo o estado do sistema...'));
  root.appendChild(area);

  const PRESET_ICONS = { competitive: 'target', 'battle-royale': 'rocket', 'open-world': 'globe', streaming: 'cast', 'video-editing': 'video', programming: 'code', design: 'pen', clean: 'sparkles' };
  const [cat, status, settings] = await Promise.all([velox.tweaks.catalog(), velox.tweaks.status(), velox.settings.get()]);
  let selected = settings.goal;
  const byId = new Map(cat.tweaks.map((t) => [t.id, t]));

  function render() {
    area.innerHTML = '';
    area.appendChild(h('div.grid.g4', cat.presets.map((p) => {
      const ids = p.tweaks;
      const active = ids.filter((id) => status[id] && ['applied', 'absent'].includes(status[id].state)).length;
      return h('div.card.preset' + (p.id === selected ? '.selected' : ''), { style: { '--preset': p.accent }, onclick: async () => { selected = p.id; await velox.settings.set({ goal: p.id }); render(); } },
        h('div.p-icon', icon(PRESET_ICONS[p.id] || 'star')),
        h('h3', p.name), h('div.text2.small.mt-s', p.desc),
        h('div.row.between.mt', h('span.muted.small', `${active}/${ids.length} ativos`), p.id === selected ? h('span.badge.green', 'Selecionado') : null));
    })));

    const preset = cat.presets.find((p) => p.id === selected) || cat.presets[0];
    const todo = [], done = [], blocked = [];
    for (const id of preset.tweaks) {
      const t = byId.get(id); const s = status[id];
      if (!t || !s) continue;
      if (['applied', 'absent'].includes(s.state)) done.push(t);
      else if (s.rule.level === 'block' || s.state === 'unavailable') blocked.push({ t, reason: s.rule.reason || 'Não disponível neste PC.' });
      else todo.push({ t, warn: s.rule.level === 'warn' ? s.rule.reason : null });
    }
    const checks = new Map();
    const applyBtn = h('button.btn.primary.lg', icon('rocket'), 'Otimizar agora');
    applyBtn.disabled = !todo.length;
    applyBtn.onclick = async () => {
      const ids = [...checks.entries()].filter(([, c]) => c.checked).map(([id]) => id);
      const r = await App.applyTweaks(ids, `Game Boost: ${preset.name}`);
      if (r) App.go('boost');
    };
    area.appendChild(h('div.grid.g3.mt',
      h('div.card.span2',
        h('div.card-head', h('div', h('h2', { style: { margin: 0 } }, `O que o perfil "${preset.name}" vai fazer`), h('div.muted.small', 'Desmarque o que não quiser aplicar.')), applyBtn),
        todo.length ? h('div', todo.map(({ t, warn }) => {
          const c = h('input', { type: 'checkbox', checked: t.risk !== 'high' });
          checks.set(t.id, c);
          return h('div.tweak', c, h('div.grow',
            h('div.t-title', t.title, riskBadge(t.risk), t.restart ? h('span.badge.blue', 'Reiniciar') : null),
            h('div.t-desc', t.desc),
            warn ? h('div.t-rule', { style: { color: 'var(--warning)' } }, icon('alert'), warn) : null));
        })) : h('div.empty', 'Tudo deste perfil já está aplicado.')),
      h('div.col',
        h('div.card', h('h2', `Já ativas (${done.length})`), done.length ? h('div.col', done.map((t) => h('div.row.small', icon('check', 'ok'), h('span.text2', t.title)))) : h('div.muted.small', 'Nenhuma ainda.')),
        h('div.card', h('h2', `Puladas neste PC (${blocked.length})`), h('div.muted.small.mb', 'Otimizações que não fazem sentido para este hardware e por quê.'),
          blocked.length ? h('div.col', blocked.map(({ t, reason }) => h('div.small', h('div', t.title), h('div.muted', reason)))) : h('div.muted.small', 'Nenhuma.')))));
    area.querySelectorAll('svg.ok').forEach((s) => { s.style.cssText = 'width:14px;height:14px;stroke:var(--success);fill:none;stroke-width:2.4;flex-shrink:0'; });
  }
  render();
};
