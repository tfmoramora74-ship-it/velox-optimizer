/* global velox, Pages, h, icon */
const NAV = [
  { section: 'Geral' },
  { id: 'dashboard', title: 'Dashboard', icon: 'home' },
  { id: 'boost', title: 'Game Boost', icon: 'rocket' },
  { id: 'apps', title: 'App Tuner', icon: 'apps' },
  { id: 'install', title: 'Instalar apps', icon: 'plus' },
  { section: 'Otimização' },
  { id: 'tweaks', title: 'Tweaks', icon: 'sliders' },
  { id: 'gamemode', title: 'Game Mode', icon: 'gamepad' },
  { id: 'profiles', title: 'Perfis de jogo', icon: 'target' },
  { id: 'power', title: 'Energia', icon: 'bolt' },
  { id: 'nvidia', title: 'NVIDIA', icon: 'gpu', nvidiaOnly: true },
  { id: 'network', title: 'Rede', icon: 'wifi' },
  { id: 'latency', title: 'Latência', icon: 'gauge' },
  { id: 'services', title: 'Serviços', icon: 'layers' },
  { id: 'windows', title: 'Windows', icon: 'windows' },
  { id: 'uninstaller', title: 'Desinstalador', icon: 'package' },
  { section: 'Medição' },
  { id: 'benchmark', title: 'Benchmark', icon: 'activity' },
  { id: 'tests', title: 'Testes', icon: 'mouse' },
  { section: 'Sistema' },
  { id: 'bios', title: 'BIOS', icon: 'cpu' },
  { id: 'tools', title: 'Ferramentas', icon: 'external' },
  { id: 'settings', title: 'Configurações', icon: 'settings' },
];

const App = {
  info: null,
  current: null,
  cleanup: null,
  samples: [],
  listeners: new Set(),
  gm: null,

  async init() {
    document.getElementById('tb-min').onclick = () => velox.win.minimize();
    document.getElementById('tb-max').onclick = () => velox.win.maximize();
    document.getElementById('tb-close').onclick = () => velox.win.close();
    this.info = await velox.app.info();
    const s = await velox.settings.get();
    this.setTheme(s.theme || 'modern');
    this.gm = await velox.gamemode.state();
    velox.on('progress', (p) => this.progress(p));
    velox.on('navigate', (id) => { location.hash = id; });
    velox.on('video', () => { if (this.current === 'dashboard') this.go('dashboard'); else toast('O driver de vídeo travou ou reiniciou. Veja o Dashboard.', 'error', 10000); });
    velox.on('restored', () => { if (this.current === 'dashboard') this.go('dashboard'); });
    // Amostras do monitor de ping ficam aqui para sobreviver à troca de página
    this.ping = {};
    velox.on('pingSample', (s) => {
      (this.ping[s.host] = this.ping[s.host] || []).push(s);
      if (this.ping[s.host].length > 600) this.ping[s.host].shift();
      this.listeners.forEach((l) => l({ type: 'ping', sample: s }));
    });
    velox.on('drift', (d) => { this.drift = d; if (this.current === 'dashboard' && d.items.length) this.go('dashboard'); });
    this.drift = await velox.tweaks.driftCached();
    this.hasNvidia = await velox.nv.available();
    velox.on('gamemode', (s) => { this.gm = s; this.renderSidebar(); this.listeners.forEach((l) => l({ type: 'gamemode', state: s })); });
    this.renderSidebar();
    this.loop();
    window.addEventListener('hashchange', () => this.go(location.hash.slice(1)));
    this.go(location.hash.slice(1) || 'dashboard');
  },

  async loop() {
    // Minimizada: não pede amostras (o monitor do sistema também para nesse caso)
    if (document.hidden) { setTimeout(() => this.loop(), 3000); return; }
    try {
      const s = await velox.monitor.sample();
      this.samples.push(s);
      if (this.samples.length > 90) this.samples.shift();
      this.listeners.forEach((l) => l({ type: 'sample', sample: s }));
    } catch {}
    setTimeout(() => this.loop(), 2000);
  },

  setTheme(theme) { document.getElementById('modern-css').disabled = theme === 'classic'; },

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },

  renderSidebar() {
    const sb = document.getElementById('sidebar');
    sb.innerHTML = '';
    sb.appendChild(h('div.sb-logo', h('div.mark', icon('logo')), h('div', h('b', 'Velox'), h('small', 'Optimizer · offline'))));
    for (const n of NAV) {
      if (n.section) { sb.appendChild(h('div.sb-section', n.section)); continue; }
      if (n.nvidiaOnly && !this.hasNvidia) continue;
      const pill = n.id === 'gamemode' && this.gm && this.gm.active ? h('span.pill', 'AO VIVO') : null;
      sb.appendChild(h('div.nav' + (this.current === n.id ? '.active' : ''), { onclick: () => { location.hash = n.id; } }, icon(n.icon), n.title, pill));
    }
    const admin = this.info && this.info.isAdmin;
    sb.appendChild(h('div.sb-footer',
      h('div.row', h('span.dot' + (admin ? '' : '.warn')), admin ? 'Administrador' : 'Sem privilégios de admin'),
      h('div.row.mt-s', h('span.dot' + (this.gm && this.gm.active ? '.live' : '.off')), this.gm && this.gm.active ? `Game Mode: ${this.gm.session.game}` : 'Game Mode em espera'),
      h('div.muted.small.mt-s', `v${this.info ? this.info.version : ''} · sem conta, sem anúncios`)));
  },

  async go(id) {
    if (!Pages[id]) id = 'dashboard';
    if (this.cleanup) { try { this.cleanup(); } catch {} this.cleanup = null; }
    this.current = id;
    this.renderSidebar();
    const root = document.getElementById('content');
    root.innerHTML = '';
    root.scrollTop = 0;
    if (this.info && !this.info.isAdmin) {
      root.appendChild(h('div.banner.red', icon('shield'),
        h('div.grow', h('b', 'Execute como administrador. '), h('span.text2', 'Sem privilégios elevados a maioria das otimizações não pode ser aplicada.')),
        h('button.btn.sm.primary', { onclick: () => velox.app.relaunchAdmin() }, 'Reabrir como admin')));
    }
    const container = h('div');
    root.appendChild(container);
    try {
      this.cleanup = await Pages[id](container, this) || null;
    } catch (e) {
      container.appendChild(h('div.card', h('h2', 'Erro ao carregar a página'), h('pre.small.muted', String(e && e.stack || e))));
    }
  },

  progress(p) {
    const el = document.getElementById('progress');
    if (!p) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    document.getElementById('progress-label').textContent = p.label + (p.total ? ` (${p.index + 1}/${p.total})` : '');
    el.querySelector('.bar i').style.width = p.total ? ((p.index + 1) / p.total) * 100 + '%' : '30%';
  },

  // Aplica uma lista de tweaks com confirmação e ponto de restauração opcional
  async applyTweaks(ids, title = 'Aplicar otimizações') {
    const [cat, settings] = await Promise.all([velox.tweaks.catalog(), velox.settings.get()]);
    const items = ids.map((id) => cat.tweaks.find((t) => t.id === id)).filter(Boolean);
    if (!items.length) { toast('Nada para aplicar.', 'info'); return null; }
    const rp = h('input', { type: 'checkbox', checked: settings.restorePointBeforeBatch });
    const risky = items.filter((t) => t.risk === 'high');
    const ok = await modal({
      title,
      body: h('div',
        h('div.text2', `${items.length} otimização(ões) serão aplicadas:`),
        h('ul', items.slice(0, 14).map((t) => h('li', t.title, t.risk !== 'low' ? ' ' : '', t.risk !== 'low' ? riskBadge(t.risk) : null)), items.length > 14 ? h('li', `+ ${items.length - 14} outras`) : null),
        risky.length ? h('div.banner.red.mt', icon('alert'), h('div.small', 'Inclui itens avançados que reduzem segurança ou estabilidade. Leia a descrição de cada um.')) : null,
        items.some((t) => t.restart) ? h('div.small.muted.mt-s', 'Algumas só valem depois de reiniciar o PC.') : null,
        h('label.check.mt', rp, 'Criar ponto de restauração antes (recomendado)')),
      confirm: 'Aplicar',
    });
    if (!ok) return null;
    const res = await velox.tweaks.applyMany(ids, { restorePoint: rp.checked });
    const fails = res.filter((r) => !r.ok);
    if (fails.length) toast(`${res.length - fails.length} aplicadas, ${fails.length} com avisos: ${fails.map((f) => f.message).join(' | ').slice(0, 300)}`, 'warning', 10000);
    else toast(`${res.length} otimizações aplicadas.`, 'success');
    if (res.some((r) => r.restart && r.ok)) {
      const again = await modal({ title: 'Reiniciar agora?', body: h('div.text2', 'Algumas otimizações precisam de reinicialização para ter efeito completo.'), confirm: 'Reiniciar', cancel: 'Depois' });
      if (again) velox.system.restart();
    }
    return res;
  },
};

window.App = App;
App.init();
