/* global velox, Pages, h, icon, pageHead, loading, toast, toastResult, modal, busy */
Pages.nvidia = async (root) => {
  const recBtn = h('button.btn.primary', icon('sparkles'), 'Aplicar recomendados');
  const restoreBtn = h('button.btn', icon('undo'), 'Restaurar anteriores');
  root.appendChild(pageHead('NVIDIA', 'Painel da NVIDIA, sem abrir o painel', 'Configurações 3D globais do driver (valem para todos os jogos que não têm perfil próprio). O Velox guarda os valores anteriores de cada item.', restoreBtn, recBtn));
  const area = h('div.card', { style: { padding: 0 } }, loading('Lendo o driver NVIDIA...'));
  root.appendChild(area);

  let data = await velox.nv.read();
  if (!data.ok) { area.replaceChildren(h('div.empty', data.message)); recBtn.disabled = restoreBtn.disabled = true; return; }

  recBtn.onclick = () => busy(recBtn, async () => {
    const todo = data.settings.filter((s) => s.rec !== null && s.value >>> 0 !== s.rec >>> 0);
    if (!todo.length) { toast('Tudo já está no valor recomendado.', 'info'); return; }
    const label = (s, v) => (s.options.find(([o]) => o >>> 0 === v >>> 0) || [0, String(v)])[1];
    if (!(await modal({ title: 'Aplicar configurações recomendadas?', body: h('ul', todo.map((s) => h('li', `${s.name}: ${label(s, s.value)} → ${label(s, s.rec)}`))), confirm: 'Aplicar' }))) return;
    toastResult(await velox.nv.write(todo.map((s) => ({ id: s.id, value: s.rec }))));
    render(await velox.nv.read());
  });
  restoreBtn.onclick = () => busy(restoreBtn, async () => { toastResult(await velox.nv.restore()); render(await velox.nv.read()); });

  function render(d) {
    data = d;
    area.replaceChildren(...d.settings.map((s) => {
      let control;
      if (s.type === 'number') {
        control = h('input.input', { type: 'number', min: 0, max: 1023, value: s.value, style: { width: '110px' } });
        control.onchange = async () => { toastResult(await velox.nv.write([{ id: s.id, value: Math.max(0, Math.min(1023, Number(control.value) || 0)) }])); render(await velox.nv.read()); };
      } else {
        control = h('select.input', s.options.map(([v, l]) => h('option', { value: v >>> 0 }, l)));
        if (!s.options.some(([v]) => v >>> 0 === s.value >>> 0)) control.appendChild(h('option', { value: s.value >>> 0 }, `Personalizado (0x${(s.value >>> 0).toString(16)})`));
        control.value = String(s.value >>> 0);
        control.onchange = async () => { toastResult(await velox.nv.write([{ id: s.id, value: Number(control.value) }])); render(await velox.nv.read()); };
      }
      const isRec = s.rec !== null && s.value >>> 0 === s.rec >>> 0;
      return h('div.tweak', h('div.grow', h('div.t-title', s.name, isRec ? h('span.badge.green', 'Recomendado') : s.rec !== null ? h('span.badge.amber', 'Pode melhorar') : h('span.badge', 'Preferência'), s.saved ? h('span.badge.blue', 'Alterado pelo Velox') : null),
        h('div.t-desc', s.desc)), control);
    }));
  }
  render(data);
};
