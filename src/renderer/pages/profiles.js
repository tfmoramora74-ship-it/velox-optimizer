/* global velox, Pages, h, icon, pageHead, toast, toastResult, modal, sw, busy */
Pages.profiles = async (root) => {
  const add = h('button.btn.primary', icon('plus'), 'Novo perfil');
  root.appendChild(pageHead('Perfis de jogo', 'Regras que valem sempre que o jogo abre', 'Prioridade de CPU e de disco, núcleos usados, GPU de alto desempenho e tela cheia exclusiva — por executável. O Velox aplica sozinho quando o processo aparece, mesmo sem o Game Mode.', add));
  const area = h('div');
  root.appendChild(area);
  let data = await velox.prof.list();

  const PRIO = [['High', 'Alta'], ['AboveNormal', 'Acima do normal'], ['Normal', 'Normal'], ['BelowNormal', 'Abaixo do normal']];
  const AFF = [['all', 'Todos os núcleos (padrão)'], ['pcores', 'Só P-cores (Intel híbrido)'], ['skip0', 'Todos menos o núcleo 0'], ['custom', 'Escolher núcleos']];

  async function editor(p) {
    const cur = { ...data.defaults, ...(p || {}) };
    const exe = h('input.input', { value: cur.exe || '', placeholder: 'jogo.exe', style: { flex: 1 } });
    const pathIn = h('input.input', { value: cur.path || '', placeholder: 'Caminho completo (para GPU e tela cheia)', style: { flex: 1 } });
    const pick = h('button.btn.sm', icon('folder'), 'Procurar');
    pick.onclick = async () => { const f = await velox.prof.pickExe(); if (f) { pathIn.value = f; exe.value = f.split('\\').pop(); } };
    const prio = h('select.input', PRIO.map(([v, l]) => h('option', { value: v }, l))); prio.value = cur.priority;
    const aff = h('select.input', AFF.map(([v, l]) => h('option', { value: v }, l))); aff.value = cur.affinity;
    const cores = h('div.row.wrap.mt-s', { style: { gap: '6px' } }, Array.from({ length: data.threads }, (_, i) => h('label.chip', h('input', { type: 'checkbox', checked: (cur.cores || []).includes(i), value: i }), `CPU ${i}`)));
    const showCores = () => { cores.style.display = aff.value === 'custom' ? 'flex' : 'none'; };
    aff.onchange = showCores; showCores();
    const chk = (label, val, hint) => { const c = h('input', { type: 'checkbox', checked: !!val }); return [c, h('label.check', c, h('div', h('div', label), h('div.muted.small', hint)))]; };
    const [persist, persistEl] = chk('Gravar a prioridade no Windows', cur.persistent, 'Vale até sem o Velox aberto (Image File Execution Options).');
    const [io, ioEl] = chk('Prioridade alta de disco', cur.ioHigh, 'O jogo passa na frente na fila de leitura do SSD/HD.');
    const [gpu, gpuEl] = chk('GPU de alto desempenho', cur.gpuHigh, 'Força a placa dedicada em notebooks com duas GPUs. Precisa do caminho completo.');
    const [fso, fsoEl] = chk('Desligar otimizações de tela cheia só para este jogo', cur.fsoOff, 'Mesmo efeito do tweak global, mas só aqui. Precisa do caminho completo.');
    const body = h('div.col', { style: { gap: '12px' } },
      h('div.row', exe, pick), pathIn,
      h('div.row', h('div.grow', h('div.small.muted', 'Prioridade de CPU'), prio), h('div.grow', h('div.small.muted', 'Núcleos'), aff)), cores,
      persistEl, ioEl, gpuEl, fsoEl);
    if (!(await modal({ title: p ? `Editar ${p.exe}` : 'Novo perfil', body, confirm: 'Salvar' }))) return;
    const r = await velox.prof.save({
      exe: exe.value.trim(), path: pathIn.value.trim(), priority: prio.value, affinity: aff.value,
      cores: [...cores.querySelectorAll('input:checked')].map((c) => Number(c.value)), persistent: persist.checked, ioHigh: io.checked, gpuHigh: gpu.checked, fsoOff: fso.checked, enabled: cur.enabled,
    });
    toastResult(r);
    if (r.ok) { data = await velox.prof.list(); render(); }
  }
  add.onclick = () => editor(null);

  let detected = [];
  const detectBtn = h('button.btn.sm.ghost', icon('refresh'), 'Detectar jogos instalados');
  detectBtn.onclick = () => busy(detectBtn, async () => { detected = await velox.lib.scan(); render(); toast(`${detected.length} jogos encontrados.`, 'info'); });
  const SUGGEST = [['VALORANT-Win64-Shipping.exe', 'Valorant'], ['cs2.exe', 'CS2'], ['FortniteClient-Win64-Shipping.exe', 'Fortnite'], ['r5apex_dx12.exe', 'Apex'], ['obs64.exe', 'OBS']];
  function render() {
    const prioName = Object.fromEntries(PRIO);
    const affName = Object.fromEntries(AFF);
    area.replaceChildren(
      data.profiles.length ? h('div.card', { style: { padding: 0 } }, data.profiles.map((p) => {
        const edit = h('button.btn.sm', 'Editar'); edit.onclick = () => editor(p);
        const del = h('button.btn.sm.ghost', icon('trash'));
        del.onclick = async () => { if (await modal({ title: `Remover perfil de ${p.exe}?`, body: h('div.text2', 'As mudanças no registro voltam ao que eram antes.'), confirm: 'Remover', danger: true })) { toastResult(await velox.prof.remove(p.exe)); data = await velox.prof.list(); render(); } };
        const tags = [`CPU ${prioName[p.priority]}`, affName[p.affinity].split(' (')[0], p.ioHigh ? 'Disco alta' : null, p.gpuHigh ? 'GPU dedicada' : null, p.fsoOff ? 'Sem FSO' : null, p.persistent ? 'Gravado no Windows' : null].filter(Boolean);
        return h('div.tweak', h('div.grow', h('div.t-title', p.exe, p.enabled ? h('span.badge.green', 'Ativo') : h('span.badge', 'Pausado')), h('div.row.wrap.mt-s', { style: { gap: '6px' } }, tags.map((t) => h('span.badge', t)))),
          h('div.row', sw(p.enabled, async (on) => { toastResult(await velox.prof.save({ ...p, enabled: on })); data = await velox.prof.list(); render(); }), edit, del));
      })) : h('div.card', h('div.empty', 'Nenhum perfil ainda. Crie um para o seu jogo principal.')),
      h('div.card.mt', h('div.row.between', h('h2', { style: { margin: 0 } }, 'Sugestões rápidas'), detectBtn),
        h('div.row.wrap.mt', [...detected.map((g) => [g.exe, g.name, g.path]), ...SUGGEST].filter(([e], i, arr) => arr.findIndex((x) => x[0].toLowerCase() === e.toLowerCase()) === i && !data.profiles.some((p) => p.exe.toLowerCase() === e.toLowerCase()))
          .map(([e, n, p]) => h('button.btn.sm', { onclick: () => editor({ exe: e, path: p || '' }) }, icon('plus'), n)))),
      h('div.muted.small.mt', 'Dica: "Todos menos o núcleo 0" ajuda em alguns jogos porque o Windows atende muitas interrupções no núcleo 0. Meça com o Benchmark antes de manter.'));
  }
  render();
};
