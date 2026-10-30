/* global velox, Pages, h, icon, pageHead, loading */
Pages.bios = async (root) => {
  root.appendChild(pageHead('BIOS', 'Guia de BIOS para o seu PC', 'O Velox não grava nada na BIOS (gravar a NVRAM pelo Windows pode inutilizar a placa-mãe). Aqui você vê o que está detectado e o que mudar manualmente, com onde encontrar cada opção.'));
  const area = h('div', loading('Lendo firmware e placa-mãe...'));
  root.appendChild(area);
  const [hw, b] = await Promise.all([velox.hw.detect(), velox.hw.bios()]);
  const bi = b || {};
  const vendor = String(bi.boardVendor || hw.system.manufacturer || '').toLowerCase();
  const V = /gigabyte/.test(vendor) ? 'gigabyte' : /asus/.test(vendor) ? 'asus' : /micro-star|msi/.test(vendor) ? 'msi' : /asrock/.test(vendor) ? 'asrock' : 'other';
  const KEY = { gigabyte: 'Del (F2 alterna modo fácil/avançado)', asus: 'Del ou F2 (F7 = modo avançado)', msi: 'Del (F7 = modo avançado)', asrock: 'F2 ou Del', other: 'Del, F2 ou F10 durante o boot' }[V];
  const where = (m) => m[V] || m.other;

  const mem = Array.isArray(bi.mem) ? bi.mem : bi.mem ? [bi.mem] : [];
  const rated = Math.max(0, ...mem.map((m) => m.Speed || 0));
  const configured = Math.max(0, ...mem.map((m) => m.ConfiguredClockSpeed || 0));
  const board = String(bi.board || '').trim();
  const lockedChipset = hw.cpu.vendor === 'intel' && /\b(H[34567]\d0|B[34]60)\b/i.test(board) && !/\d{4,5}K/i.test(hw.cpu.name);
  const biosAge = bi.biosDate ? (Date.now() - new Date(bi.biosDate)) / (365 * 864e5) : null;

  const items = [
    {
      title: 'Perfil de memória (XMP / EXPO / DOCP)', state: configured && rated ? (configured >= rated ? 'ok' : 'todo') : 'info',
      now: configured ? `RAM rodando a ${configured} MT/s${rated ? ` (pentes suportam ${rated})` : ''}` : 'Não detectado',
      rec: lockedChipset ? `Sua placa (${board}) com CPU Intel sem "K" limita a memória (geralmente 2666–2933 MT/s). Ative o XMP mesmo assim para aplicar as latências corretas.` : 'Ative o perfil XMP/EXPO para a RAM rodar na velocidade anunciada. Costuma dar 5–15% de FPS em jogos que dependem de CPU.',
      where: where({ gigabyte: 'Tweaker > Extreme Memory Profile (X.M.P.)', asus: 'Ai Tweaker > Ai Overclock Tuner > XMP/DOCP', msi: 'OC > A-XMP / Extreme Memory Profile', asrock: 'OC Tweaker > DRAM Configuration > Load XMP Setting', other: 'Menu de overclock/memória > XMP/EXPO' }),
    },
    {
      title: 'Resizable BAR + Above 4G Decoding', state: 'info', now: hw.discrete ? hw.discrete.name : 'Sem GPU dedicada',
      rec: 'Ligue os dois (exigem CSM desligado). A CPU acessa toda a VRAM de uma vez; ganho de 0–10% dependendo do jogo. GTX 16/10 e mais antigas não suportam — nesse caso não faz diferença.',
      where: where({ gigabyte: 'Settings > IO Ports > Above 4G Decoding / Re-Size BAR Support', asus: 'Advanced > PCI Subsystem Settings', msi: 'Settings > Advanced > PCI Subsystem Settings', asrock: 'Advanced > Chipset Configuration', other: 'Configurações de PCI/PCIe' }),
    },
    {
      title: 'Modo UEFI (CSM desligado)', state: bi.firmware ? (/uefi/i.test(bi.firmware) ? 'ok' : 'todo') : 'info', now: bi.firmware ? `Boot em modo ${bi.firmware}` : 'Não detectado',
      rec: 'Use boot UEFI com CSM desligado: necessário para Resizable BAR, Secure Boot e Windows 11. Se o Windows foi instalado em modo Legacy/MBR, converta o disco com mbr2gpt antes.',
      where: where({ gigabyte: 'Boot > CSM Support > Disabled', asus: 'Boot > CSM > Launch CSM: Disabled', msi: 'Settings > Advanced > Windows OS Configuration > BIOS CSM/UEFI Mode: UEFI', asrock: 'Boot > CSM: Disabled', other: 'Boot > CSM / Legacy Support' }),
    },
    {
      title: 'Secure Boot', state: bi.secureBoot === true ? 'ok' : bi.secureBoot === false ? 'todo' : 'info', now: bi.secureBoot === true ? 'Ligado' : bi.secureBoot === false ? 'Desligado' : 'Não detectado',
      rec: 'Valorant (Vanguard) no Windows 11, Battlefield 6 e Call of Duty exigem Secure Boot ligado. Não afeta desempenho.',
      where: where({ gigabyte: 'Boot > Secure Boot > Enabled (modo Standard)', asus: 'Boot > Secure Boot > OS Type: Windows UEFI mode', msi: 'Settings > Security > Secure Boot', asrock: 'Security > Secure Boot', other: 'Boot/Security > Secure Boot' }),
    },
    {
      title: 'TPM 2.0 (fTPM / Intel PTT)', state: bi.tpm === true ? 'ok' : bi.tpm === false ? 'todo' : 'info', now: bi.tpm === true ? 'Ativo' : bi.tpm === false ? 'Inativo' : 'Não detectado',
      rec: 'Necessário para Windows 11 e anti-cheats (Vanguard, FACEIT). Mantenha ligado.',
      where: where({ gigabyte: 'Settings > Miscellaneous > Intel Platform Trust Technology (PTT) / AMD CPU fTPM', asus: 'Advanced > PCH-FW Configuration > PTT / AMD fTPM', msi: 'Settings > Security > Trusted Computing', asrock: 'Security > Intel PTT / AMD fTPM', other: 'Security > TPM / PTT / fTPM' }),
    },
    {
      title: 'C-States e Turbo Boost', state: 'info', now: hw.cpu.name,
      rec: hw.cpu.vendor === 'intel' && !/\d{4,5}K/i.test(hw.cpu.name)
        ? 'Em Intel sem "K" (como o seu), deixe C-States e Turbo Boost LIGADOS: o turbo usa a folga dos núcleos ociosos para subir o clock. Desligar C-states costuma baixar o FPS.'
        : 'Turbo/Precision Boost sempre ligado. C-states: ligado para clocks de boost máximos; desligue só se fizer overclock fixo em todos os núcleos.',
      where: where({ gigabyte: 'Tweaker > Advanced CPU Settings', asus: 'Ai Tweaker > Internal CPU Power Management', msi: 'OC > Advanced CPU Configuration', asrock: 'OC Tweaker > CPU Configuration', other: 'Configurações avançadas de CPU' }),
    },
    {
      title: 'Virtualização (VT-x / SVM)', state: 'info', now: bi.vt === true ? 'Ligada' : bi.vt === false ? 'Desligada' : 'Não detectado',
      rec: 'Deixe ligada se usa WSL, Docker ou emuladores Android (BlueStacks, LDPlayer). Se não usa nada disso, desligar libera um pouquinho de overhead — o ganho é pequeno.',
      where: where({ gigabyte: 'Tweaker > Advanced CPU Settings > Intel Virtualization Technology / SVM Mode', asus: 'Advanced > CPU Configuration', msi: 'OC > CPU Features', asrock: 'Advanced > CPU Configuration', other: 'Configurações de CPU' }),
    },
    {
      title: 'ASPM e economia de energia do PCIe', state: 'info', now: '—',
      rec: 'Desligue "Native ASPM" / "PCIe ASPM" e "DMI/PEG ASPM" para a GPU e o SSD não entrarem em economia agressiva (o tweak de PCIe do Velox faz a parte do Windows).',
      where: where({ gigabyte: 'Settings > Platform Power > ASPM / Native ASPM', asus: 'Advanced > Platform Misc Configuration', msi: 'Settings > Advanced > Power Management Setup', asrock: 'Advanced > Chipset Configuration', other: 'Configurações de energia / PCIe' }),
    },
    {
      title: 'Spread Spectrum', state: 'info', now: '—',
      rec: 'Desligue (Disabled). Ele varia o clock de base para reduzir interferência eletromagnética; sem utilidade em PC de mesa.',
      where: where({ gigabyte: 'Tweaker > Advanced CPU Settings > CPU/PCIe Spread Spectrum', asus: 'Ai Tweaker > BCLK Spread Spectrum', msi: 'OC > Spread Spectrum', asrock: 'OC Tweaker > Spread Spectrum', other: 'Menu de overclock' }),
    },
    {
      title: 'Atualização da BIOS', state: biosAge === null ? 'info' : biosAge > 2 ? 'todo' : 'ok',
      now: bi.biosVersion ? `${bi.biosVersion}${bi.biosDate ? ` de ${new Date(bi.biosDate).toLocaleDateString('pt-BR')}` : ''}` : 'Não detectado',
      rec: 'BIOS nova traz correções de estabilidade, microcódigo e compatibilidade de memória. Baixe SÓ do site da fabricante da placa, para o modelo exato, e nunca desligue o PC durante a atualização.',
      where: where({ gigabyte: 'Q-Flash (tecla End no boot) com o arquivo num pendrive FAT32', asus: 'Tool > ASUS EZ Flash', msi: 'M-Flash', asrock: 'Tool > Instant Flash', other: 'Ferramenta de flash da BIOS' }),
    },
  ];

  const STATE = { ok: ['Ok', 'green'], todo: ['Ajustar', 'amber'], info: ['Verificar', ''] };
  area.replaceChildren(
    h('div.grid.g3',
      h('div.card.hero.span2', h('h2', 'Sua placa'), h('dl.kv', h('dt', 'Placa-mãe'), h('dd', board || '—'), h('dt', 'BIOS'), h('dd', `${bi.biosVendor || ''} ${bi.biosVersion || ''}`), h('dt', 'Processador'), h('dd', hw.cpu.name), h('dt', 'Entrar na BIOS'), h('dd', KEY))),
      h('div.card', h('h2', 'Antes de mexer'), h('div.text2.small', 'Tire foto das telas ou salve um perfil da BIOS antes de mudar. Se o PC não ligar depois de um ajuste, use "Load Optimized Defaults" ou limpe o CMOS.'))),
    h('div.card.mt', { style: { padding: 0 } }, items.map((i) => {
      const [label, color] = STATE[i.state];
      return h('div.tweak', h('div.grow',
        h('div.t-title', i.title, h('span.badge' + (color ? '.' + color : ''), label)),
        h('div.t-desc', h('b', 'Agora: '), i.now),
        h('div.t-desc', i.rec),
        h('div.t-rule', { style: { color: 'var(--text-3)' } }, icon('info'), i.where)));
    })));
};
