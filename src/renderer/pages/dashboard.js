/* global velox, Pages, h, icon, fmt, meter, sparkline, ring, pageHead, loading, toast, toastResult, busy */
Pages.dashboard = async (root, App) => {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  root.appendChild(pageHead('Painel', greet, 'Visão geral do seu PC, o que já está otimizado e o que ainda dá pra melhorar.'));

  // Avisos carregam depois: os cartões ao vivo aparecem sem esperar por eles
  const banners = h('div');
  root.appendChild(banners);
  (async () => {
    // Salvaguardas: driver de vídeo travou / Restauração do Sistema detectada
    const notices = await velox.safety.notices();
    if (notices.video) {
      const v = notices.video;
      const fix = h('button.btn.sm.primary', icon('undo'), 'Reverter ajustes de vídeo');
      fix.onclick = () => busy(fix, async () => { toastResult(await velox.safety.revertVideo()); App.go('dashboard'); });
      const ok = h('button.btn.sm.ghost', 'Ignorar');
      ok.onclick = async () => { await velox.safety.dismiss('video'); App.go('dashboard'); };
      const n = (v.suspects.tweaks || []).length + (v.suspects.devices || []).length + (v.suspects.nvidia ? 1 : 0);
      banners.appendChild(h('div.banner.red', icon('alert'), h('div.grow', h('b', `O driver de vídeo travou ou reiniciou ${v.events.length}x. `),
        h('span.text2.small', n ? `Isso pode causar tela preta ou piscadas. Há ${n} ajuste(s) de vídeo aplicados nas últimas 48 h — reverter é o mais seguro.` : 'Nenhum ajuste de vídeo do Velox foi aplicado recentemente; a causa provavelmente é outra (driver, cabo, overclock).')), n ? fix : null, ok));
    }
    if (notices.restore) {
      const ok = h('button.btn.sm.ghost', 'Entendi');
      ok.onclick = async () => { await velox.safety.dismiss('restore'); App.go('dashboard'); };
      banners.appendChild(h('div.banner', icon('info'), h('div.grow', h('b', 'Restauração do Sistema detectada. '), h('span.text2.small', 'O Windows voltou a um estado anterior, então os registros de otimizações antigas foram arquivados. Nada será reaplicado sozinho. Se quiser otimizar de novo, vá aos poucos e meça com o Benchmark.')), ok));
    }
  
    // Proteção de boot: avisa se a última reinicialização foi revertida ou se está armada
    const boot = await velox.boot.check();
    if (boot.status === 'reverted') {
      banners.appendChild(h('div.banner.red', icon('shield'), h('div.grow', h('b', 'O Windows não conseguiu iniciar depois dos últimos ajustes. '), h('span.text2.small', `A proteção de boot desfez ${(boot.items.tweaks || []).length + (boot.items.devices || []).length} ajuste(s) automaticamente. Evite reaplicar os mesmos itens.`))));
    } else if (boot.status === 'armed') {
      const dis = h('button.btn.sm.ghost', 'Desarmar');
      dis.onclick = async () => { await velox.boot.disarm(); dis.closest('.banner').remove(); };
      banners.appendChild(h('div.banner', { style: { borderColor: 'rgba(59,130,246,.3)', background: 'rgba(59,130,246,.07)' } }, icon('shield'), h('div.grow', h('b', 'Proteção de boot armada. '), h('span.text2.small', 'Reinicie para os ajustes valerem. Se o Windows não chegar à área de trabalho 2 vezes seguidas, tudo é desfeito sozinho; ao entrar normalmente, ela se desarma em 2 minutos.')), dis));
    }
  })();

  // Tweaks aplicados pelo Velox que algo (geralmente uma atualização do Windows) desfez
  const drift = App.drift && App.drift.items ? App.drift.items : [];
  if (drift.length) {
    const fix = h('button.btn.sm.primary', icon('refresh'), 'Reaplicar');
    fix.onclick = () => busy(fix, async () => {
      const r = await velox.tweaks.applyMany(drift.map((d) => d.id), { restorePoint: false });
      toast(`${r.filter((x) => x.ok).length} de ${r.length} reaplicadas.`, 'success');
      App.drift = await velox.tweaks.drift();
      App.go('dashboard');
    });
    root.appendChild(h('div.banner', icon('alert'), h('div.grow', h('b', `${drift.length} otimização(ões) foram desfeitas. `), h('span.text2.small', 'Provavelmente por uma atualização do Windows: ' + drift.slice(0, 4).map((d) => d.title).join(', ') + (drift.length > 4 ? '...' : ''))), fix));
  }

  // Linha de monitoramento ao vivo
  const live = {};
  const mk = (key, label, ic, color) => {
    const value = h('div.value', '—');
    const hint = h('div.hint', ' ');
    const bar = h('div');
    const chart = h('div');
    live[key] = { value, hint, bar, chart, color };
    return h('div.card', h('div.stat', h('div.label', icon(ic), label), value, hint, bar), h('div.mt-s', chart));
  };
  root.appendChild(h('div.grid.g4', mk('cpu', 'CPU', 'cpu', ''), mk('gpu', 'GPU', 'gpu', 'purple'), mk('ram', 'Memória', 'ram', 'blue'), mk('disk', 'Disco do sistema', 'disk', 'amber')));

  const body = h('div.grid.g3.mt');
  root.appendChild(body);
  const recCard = h('div.card.hero.span2', loading('Analisando o sistema...'));
  const hwCard = h('div.card', loading());
  const quick = h('div.card');
  const actCard = h('div.card.span2');
  body.append(recCard, hwCard, actCard, quick);

  // Ações rápidas
  const qa = (ic, title, sub, fn) => {
    const b = h('button.btn.block', { style: { justifyContent: 'flex-start', height: '52px' } }, icon(ic), h('div', { style: { textAlign: 'left' } }, h('div', title), h('div.muted.small', { style: { fontWeight: 400 } }, sub)));
    b.onclick = () => busy(b, fn);
    return b;
  };
  quick.append(h('h2', 'Ações rápidas'), h('div.col',
    qa('memory', 'Limpar memória', 'Standby, páginas modificadas e working sets', async () => toastResult(await velox.memory.clean('full'))),
    qa('broom', 'Limpar temporários', 'Temp do usuário e do Windows', async () => { const r = await velox.cleaner.clean(['user-temp', 'win-temp', 'thumbs', 'dumps']); toast(`${fmt.bytes(r.freed)} removidos.`, 'success'); }),
    qa('gamepad', App.gm && App.gm.active ? 'Encerrar Game Mode' : 'Iniciar Game Mode', 'Sessão manual sem jogo específico', async () => { if (App.gm.active) await velox.gamemode.stop(); else toastResult(await velox.gamemode.start(), 'Game Mode iniciado.'); }),
    qa('shield', 'Criar ponto de restauração', 'Volte a este estado se algo não agradar', async () => toastResult(await velox.system.restorePoint('Velox Optimizer - manual'))),
    qa('info', 'Relatório do PC', 'Hardware, otimizações e medições num arquivo', async () => toastResult(await velox.report.save()))));

  const unsub = App.subscribe((ev) => { if (ev.type === 'sample') renderLive(); });
  let hw = null;
  function renderLive() {
    const s = App.samples;
    const last = s[s.length - 1];
    if (!last) return;
    const set = (k, pct, hint) => {
      live[k].value.innerHTML = ''; live[k].value.append(pct === null ? '—' : Math.round(pct), pct === null ? '' : h('small', '%'));
      live[k].hint.textContent = hint;
      live[k].bar.replaceChildren(meter(pct, live[k].color));
    };
    const g = last.gpuInfo;
    set('cpu', last.cpu, [last.cpuMhz ? `${(last.cpuMhz / 1000).toFixed(2)} GHz` : hw ? `${hw.cpu.cores} núcleos` : '', last.boardTemp ? `${last.boardTemp}°C (ACPI)` : null, last.cpuThrottle ? '⚠ limitada' : null].filter(Boolean).join(' · '));
    set('gpu', last.gpu, g ? [g.temp ? `${g.temp}°C` : null, g.clock ? `${g.clock} MHz` : null, g.power ? `${g.power.toFixed(0)} W` : null, g.thermalThrottle ? '⚠ limitada por temperatura' : g.powerThrottle && last.gpu > 90 ? 'no limite de potência' : null].filter(Boolean).join(' · ') : hw && hw.discrete ? hw.discrete.name : hw && hw.gpus[0] ? hw.gpus[0].name : '');
    set('ram', (last.ramUsed / last.ramTotal) * 100, `${fmt.bytes(last.ramUsed)} de ${fmt.bytes(last.ramTotal)} · standby ${fmt.bytes(last.standby)}`);
    live.cpu.chart.replaceChildren(sparkline(s.map((x) => x.cpu)));
    live.gpu.chart.replaceChildren(sparkline(s.map((x) => x.gpu), { color: 'var(--purple)' }));
    live.ram.chart.replaceChildren(sparkline(s.map((x) => (x.ramUsed / x.ramTotal) * 100), { color: 'var(--info)' }));
  }

  hw = await velox.hw.detect();
  const sysDisk = hw.disks.find((d) => /^c:/i.test(d.id)) || hw.disks[0];
  if (sysDisk) {
    const used = ((sysDisk.size - sysDisk.free) / sysDisk.size) * 100;
    live.disk.value.replaceChildren(String(Math.round(used)), h('small', '%'));
    live.disk.hint.textContent = `${fmt.bytes(sysDisk.free)} livres · ${hw.disk.type}`;
    live.disk.bar.replaceChildren(meter(used, 'amber'));
    live.disk.chart.replaceChildren(h('div.muted.small', hw.disk.name || sysDisk.id));
  }
  renderLive();

  hwCard.replaceChildren(h('div.card-head', h('h2', { style: { margin: 0 } }, 'Seu PC'), h('span.badge', hw.system.isLaptop ? 'Notebook' : 'Desktop')),
    h('dl.kv',
      h('dt', 'Sistema'), h('dd', `${hw.os.name} ${hw.os.display || ''} (build ${hw.os.build})`),
      h('dt', 'Processador'), h('dd', { title: hw.cpu.name }, hw.cpu.name),
      h('dt', 'Placa de vídeo'), h('dd', hw.gpus.map((g) => g.name).join(' + ') || '—'),
      h('dt', 'Memória'), h('dd', `${hw.ram.gb} GB${hw.ram.speed ? ` · ${hw.ram.speed} MT/s` : ''}${hw.ram.sticks ? ` · ${hw.ram.sticks} pente(s)` : ''}`),
      h('dt', 'Disco do sistema'), h('dd', `${hw.disk.type}${hw.disk.name ? ' · ' + hw.disk.name : ''}`),
      h('dt', 'Monitor'), h('dd', hw.gpus[0] && hw.gpus[0].width ? `${hw.gpus[0].width}×${hw.gpus[0].height} @ ${hw.gpus[0].hz} Hz` : '—'),
      hw.system.isLaptop ? [h('dt', 'Energia'), h('dd', hw.system.onBattery ? `Na bateria (${hw.system.battery}%)` : 'Na tomada')] : null));

  // Atividade
  const acts = await velox.activity.list();
  actCard.append(h('div.card-head', h('h2', { style: { margin: 0 } }, 'Últimas ações'), h('a.muted.small', { href: '#settings', style: { color: 'var(--text-3)' } }, 'Ver histórico')),
    acts.length ? h('div.feed', acts.slice(0, 7).map((a) => h('div.item', h('span.dot' + (a.level === 'warning' || a.level === 'error' ? '.warn' : ''), { style: { marginTop: '6px' } }), h('div.grow', a.message), h('span.time', fmt.time(a.ts))))) : h('div.empty', 'Nenhuma ação ainda. Comece pelo Game Boost.'));

  // Recomendações
  const rec = await velox.tweaks.recommendations();
  const recBtn = h('button.btn.primary.lg', icon('sparkles'), `Ativar ${rec.recommended.length} recomendados`);
  recBtn.disabled = !rec.recommended.length;
  recBtn.onclick = async () => { const r = await App.applyTweaks(rec.recommended.map((x) => x.id), `Otimizar para "${rec.preset.name}"`); if (r) App.go('dashboard'); };
  recCard.replaceChildren(
    h('div.row', { style: { gap: '24px', alignItems: 'center' } },
      ring(rec.score, 'otimizado'),
      h('div.grow',
        h('div.eyebrow', `Objetivo: ${rec.preset.name}`),
        h('h2', { style: { fontSize: '20px', margin: '0 0 6px' } }, rec.recommended.length ? 'Recomendado para este PC' : 'Tudo certo por aqui'),
        h('div.text2', rec.recommended.length
          ? `${rec.active.length} otimizações já ativas, ${rec.recommended.length} recomendadas e ${rec.skipped.length} que não fazem sentido neste hardware.`
          : 'Todas as otimizações do seu objetivo já estão ativas.'),
        h('div.row.mt', recBtn, h('button.btn', { onclick: () => { location.hash = 'boost'; } }, 'Trocar objetivo')))),
    rec.recommended.length ? h('div.mt', h('div.row.wrap', rec.recommended.slice(0, 10).map((r) => h('span.badge' + (r.warn ? '.amber' : ''), { title: r.warn || r.desc }, r.title)), rec.recommended.length > 10 ? h('span.badge', `+${rec.recommended.length - 10}`) : null)) : null);

  return () => unsub();
};
