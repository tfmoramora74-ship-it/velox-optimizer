// Catálogo de tweaks. Cada item descreve O QUE muda; o engine cuida do backup/reversão.
//
// Campos:
//   reg     [{ key, name, type, value }]       valores de registro (type: DWord|String|QWord|Binary|MultiString)
//   svc     ['Nome']                           serviços a desativar (Start=4 + parar)
//   power   [{ sub, set, value }]              índices do plano de energia atual (AC e DC)
//   bcd     [{ name, value }]                  bcdedit /set
//   appx    'Pacote'                           remove pacote AppX
//   ifeo    ['jogo.exe']                       prioridade alta via Image File Execution Options
//   resolve async (hw) => reg[]                registro calculado em tempo de execução (GPU, interfaces...)
//   custom  { apply, revert, status }          lógica própria (ver custom.js)
//   rule    (hw) => ({ level: 'ok'|'warn'|'block', reason })
//   restart true se precisar reiniciar

const HKLM = 'HKLM\\';
const HKCU = 'HKCU\\';
const MM = HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management';
const SP = HKLM + 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const POL = HKLM + 'SOFTWARE\\Policies\\Microsoft\\Windows\\';
const CDM = HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';
const ADV = HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';

const dw = (key, name, value, ifExists) => ({ key, name, type: 'DWord', value, ...(ifExists ? { ifExists: true } : {}) });
const sz = (key, name, value) => ({ key, name, type: 'String', value });

const laptopBattery = (hw, msg) => (hw.system.onBattery ? { level: 'warn', reason: msg || 'Notebook na bateria: isso reduz a autonomia.' } : null);

const CATEGORIES = [
  { id: 'input', name: 'Entrada e latência', icon: 'mouse' },
  { id: 'cpu', name: 'CPU e agendador', icon: 'cpu' },
  { id: 'gpu', name: 'GPU e vídeo', icon: 'gpu' },
  { id: 'power', name: 'Energia', icon: 'bolt' },
  { id: 'network', name: 'Rede', icon: 'wifi' },
  { id: 'memory', name: 'Memória e disco', icon: 'disk' },
  { id: 'services', name: 'Serviços', icon: 'layers' },
  { id: 'privacy', name: 'Privacidade e telemetria', icon: 'eye' },
  { id: 'ui', name: 'Interface do Windows', icon: 'window' },
  { id: 'debloat', name: 'Apps nativos', icon: 'trash' },
  { id: 'priority', name: 'Prioridade de jogos e apps', icon: 'rocket' },
  { id: 'update', name: 'Windows Update', icon: 'refresh' },
  { id: 'security', name: 'Segurança (trade-offs)', icon: 'shield' },
];

const GAMES = {
  valorant: { name: 'Valorant', exes: ['VALORANT.exe', 'VALORANT-Win64-Shipping.exe'] },
  cs2: { name: 'CS2', exes: ['cs2.exe'] },
  apex: { name: 'Apex Legends', exes: ['r5apex.exe', 'r5apex_dx12.exe'] },
  fortnite: { name: 'Fortnite', exes: ['FortniteClient-Win64-Shipping.exe'] },
  gta5: { name: 'GTA V', exes: ['GTA5.exe', 'GTA5_Enhanced.exe'] },
};

const T = [];
const add = (t) => T.push({ risk: 'low', restart: false, ...t });

// ───────── Entrada e latência
add({
  id: 'mouse-acceleration', cat: 'input', title: 'Desligar aceleração do mouse',
  desc: 'Remove o "Aumentar precisão do ponteiro": o cursor anda sempre a mesma distância para o mesmo movimento. Essencial em FPS.',
  reg: [sz(HKCU + 'Control Panel\\Mouse', 'MouseSpeed', '0'), sz(HKCU + 'Control Panel\\Mouse', 'MouseThreshold1', '0'), sz(HKCU + 'Control Panel\\Mouse', 'MouseThreshold2', '0')],
  refresh: 'mouse',
});
add({
  id: 'keyboard-input-delay', cat: 'input', title: 'Teclado mais responsivo',
  desc: 'Atraso de repetição mínimo e taxa de repetição máxima nas teclas.',
  reg: [sz(HKCU + 'Control Panel\\Keyboard', 'KeyboardDelay', '0'), sz(HKCU + 'Control Panel\\Keyboard', 'KeyboardSpeed', '31')],
  refresh: 'keyboard',
});
add({
  id: 'input-queue-delay-off', cat: 'input', title: 'Janela ativa responde na hora',
  desc: 'Zera o tempo de bloqueio de foco e o atraso de abertura de menus.',
  reg: [dw(HKCU + 'Control Panel\\Desktop', 'ForegroundLockTimeout', 0), sz(HKCU + 'Control Panel\\Desktop', 'MenuShowDelay', '0')],
});
add({
  id: 'global-timer-resolution-requests', cat: 'input', title: 'Timer de alta resolução global',
  desc: 'No Windows 11 o pedido de timer de 0,5 ms de um app volta a valer para todo o sistema, melhorando o ritmo de frames e input.',
  reg: [dw(MM.replace('Memory Management', 'kernel'), 'GlobalTimerResolutionRequests', 1)], restart: true,
});
add({
  id: 'usb-selective-suspend-off', cat: 'input', title: 'Sem suspensão seletiva de USB',
  desc: 'O Windows deixa de colocar mouse/teclado/headset USB em economia de energia, evitando engasgos de input.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\USB', 'DisableSelectiveSuspend', 1)],
  power: [{ sub: '2a737441-1930-4402-8d77-b2bebba308a3', set: '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', value: 0 }],
  rule: (hw) => laptopBattery(hw),
});

// ───────── CPU e agendador
add({
  id: 'win32-priority-separation', cat: 'cpu', title: 'Prioridade de CPU ao app em foco',
  desc: 'Quantum curto e variável com mais tempo de CPU para a janela em primeiro plano (o jogo). Efeito imediato.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl', 'Win32PrioritySeparation', 38)],
  rule: (hw) => laptopBattery(hw),
});
add({
  id: 'mmcss-games', cat: 'cpu', title: 'MMCSS: prioridade máxima para jogos',
  desc: 'Eleva prioridade de GPU, CPU e I/O da categoria "Games" do agendador multimídia.',
  reg: [
    dw(SP + '\\Tasks\\Games', 'GPU Priority', 8), dw(SP + '\\Tasks\\Games', 'Priority', 6),
    sz(SP + '\\Tasks\\Games', 'Scheduling Category', 'High'), sz(SP + '\\Tasks\\Games', 'SFIO Priority', 'High'),
  ],
});
add({
  id: 'mmcss-system-responsiveness', cat: 'cpu', title: 'Menos CPU reservada pelo MMCSS',
  desc: 'SystemResponsiveness de 20 para 10: o Windows reserva 10% da CPU para tarefas de fundo em vez de 20%.',
  reg: [dw(SP, 'SystemResponsiveness', 10)],
});
add({
  id: 'power-throttling', cat: 'cpu', title: 'Desligar Power Throttling',
  desc: 'Impede o Windows de reduzir o clock de processos em segundo plano (inclui launchers e o próprio jogo minimizado).',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff', 1)],
  rule: (hw) => laptopBattery(hw, 'Notebook na bateria: o throttling preserva a autonomia.'),
});
add({
  id: 'core-parking', cat: 'cpu', title: 'Desligar core parking',
  desc: 'Mantém 100% dos núcleos disponíveis no plano atual, reduzindo a latência para "acordar" núcleos. Vale para o plano ativo: se trocar de plano, aplique de novo.',
  // Alguns otimizadores travam o máximo permitido dessa configuração em 0; liberamos para 100 (reversível)
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c1-47b60b740d00\\0cc5b647-c1df-4637-891a-dec35c318583', 'ValueMax', 100)],
  power: [{ sub: '54533251-82be-4824-96c1-47b60b740d00', set: '0cc5b647-c1df-4637-891a-dec35c318583', value: 100 }],
  unhide: true,
  rule: (hw) => (hw.cpu.cores < 6 ? { level: 'block', reason: `CPU com ${hw.cpu.cores} núcleos: só compensa a partir de 6.` } : laptopBattery(hw)),
});
add({
  id: 'idle-states-off', cat: 'cpu', title: 'Desligar estados ociosos da CPU (C-states)', risk: 'high',
  desc: 'EXPERIMENTAL. A CPU nunca entra em repouso: latência mais firme, mas esquenta bastante e costuma REDUZIR o Turbo Boost (o turbo depende de núcleos ociosos), o que pode baixar o FPS em jogos que dependem de CPU.',
  power: [{ sub: '54533251-82be-4824-96c1-47b60b740d00', set: '5d76a2ca-e8c0-402f-a133-2158492d58ad', value: 1 }],
  unhide: true,
  rule: (hw) => (hw.cpu.vendor === 'amd' ? { level: 'block', reason: 'Em Ryzen piora o Precision Boost.' } : hw.system.isLaptop ? { level: 'block', reason: 'Em notebook só esquenta e gasta bateria.' } : { level: 'warn', reason: 'Pode baixar o clock de turbo e o FPS. Meça antes e depois.' }),
});
add({
  id: 'bcd-disable-dynamic-tick', cat: 'cpu', title: 'Desligar Dynamic Tick', risk: 'medium',
  desc: 'bcdedit disabledynamictick yes: timer do kernel em ritmo constante, reduz picos de latência DPC.',
  bcd: [{ name: 'disabledynamictick', value: 'yes' }], restart: true,
  rule: (hw) => laptopBattery(hw),
});

// ───────── GPU e vídeo
add({
  id: 'gpu-hardware-scheduling', cat: 'gpu', title: 'Agendamento de GPU por hardware (HAGS)',
  desc: 'A própria GPU gerencia sua fila de trabalho, reduzindo overhead de CPU. Requer Windows 10 2004+ e GPU compatível.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode', 2)], restart: true,
  rule: (hw) => (hw.os.build < 19041 ? { level: 'block', reason: 'Requer Windows build 19041 ou superior.' } : !hw.discrete ? { level: 'block', reason: 'Nenhuma GPU dedicada detectada.' } : hw.discrete.kind === 'amd' ? { level: 'warn', reason: 'Em AMD o resultado varia por driver; teste com e sem.' } : null),
});
add({
  id: 'fullscreen-optimizations', cat: 'gpu', title: 'Desligar "otimizações de tela cheia"',
  desc: 'Força tela cheia exclusiva real nos jogos, tirando o compositor do caminho. Vale ao reabrir o jogo.',
  reg: [
    dw(HKCU + 'System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 2), dw(HKCU + 'System\\GameConfigStore', 'GameDVR_FSEBehavior', 2),
    dw(HKCU + 'System\\GameConfigStore', 'GameDVR_HonorUserFSEBehaviorMode', 1), dw(HKCU + 'System\\GameConfigStore', 'GameDVR_DXGIHonorFSEWindowsCompatible', 1),
  ],
});
add({
  id: 'compositor-latency-off', cat: 'gpu', title: 'Desligar Multiplane Overlay (MPO)', risk: 'medium',
  desc: 'Desativa o MPO do DWM, causa comum de flicker e stutter em alguns drivers. Experimental: teste com e sem.',
  reg: [dw(HKLM + 'SOFTWARE\\Microsoft\\Windows\\Dwm', 'OverlayTestMode', 5)], restart: true,
  rule: (hw) => (hw.discrete && /rtx\s*[45]0\d/i.test(hw.discrete.name) ? { level: 'warn', reason: 'Em RTX 40/50 pode piorar o frame pacing.' } : null),
});
add({
  id: 'msi-mode-gpu', cat: 'gpu', title: 'MSI mode na GPU', risk: 'medium',
  desc: 'Interrupções por mensagem (MSI) em vez de linha na placa de vídeo: menos jitter de render e input.',
  resolve: 'gpuMsi', restart: true,
  rule: (hw) => (!hw.discrete ? { level: 'block', reason: 'Nenhuma GPU dedicada detectada.' } : null),
});
add({
  id: 'interrupt-affinity-gpu', cat: 'gpu', title: 'Afinidade de IRQ da GPU', risk: 'high',
  desc: 'Direciona as interrupções da GPU para os últimos núcleos, liberando o núcleo 0. Avançado.',
  resolve: 'gpuAffinity', restart: true,
  rule: (hw) => (!hw.discrete ? { level: 'block', reason: 'Nenhuma GPU dedicada detectada.' } : hw.cpu.threads < 8 ? { level: 'block', reason: 'CPU com menos de 8 threads: atrapalha.' } : null),
});
add({
  id: 'tdr-delay-extended', cat: 'gpu', title: 'TdrDelay de 10 segundos',
  desc: 'Aumenta o tempo antes do Windows resetar a GPU de 2 s para 10 s. Menos "driver parou de responder" em jogos pesados.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'TdrDelay', 10), dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'TdrDdiDelay', 10)],
  restart: true,
});
add({
  id: 'game-dvr-off', cat: 'gpu', title: 'Desligar Game DVR',
  desc: 'Desativa a gravação em segundo plano do Xbox em todo o sistema (3 chaves).',
  reg: [
    dw(HKCU + 'System\\GameConfigStore', 'GameDVR_Enabled', 0),
    dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled', 0),
    dw(POL + 'GameDVR', 'AllowGameDVR', 0),
  ],
});
add({
  id: 'fullscreen-overlays-off', cat: 'gpu', title: 'Sem painel da Game Bar sobre o jogo',
  desc: 'Esconde o painel de início da Game Bar que aparece por cima dos jogos.',
  reg: [dw(HKCU + 'Software\\Microsoft\\GameBar', 'ShowStartupPanel', 0)],
});
add({
  id: 'game-mode-on', cat: 'gpu', title: 'Ativar Modo de Jogo do Windows',
  desc: 'Liga o Game Mode nativo: segura updates e notificações quando um jogo é detectado.',
  reg: [dw(HKCU + 'Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1), dw(HKCU + 'Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1)],
});
add({
  id: 'amd-ulps-off', cat: 'gpu', title: 'AMD: desligar ULPS',
  desc: 'Desativa o Ultra Low Power State das Radeon, que causa atraso ao sair do repouso e problemas em multi-GPU.',
  resolve: 'amdUlps', restart: true,
  rule: (hw) => (!hw.gpus.some((g) => g.kind === 'amd' || g.kind === 'amd-igpu') ? { level: 'block', reason: 'Nenhuma GPU AMD encontrada.' } : null),
});

// ───────── Energia
add({
  id: 'pcie-aspm-off', cat: 'power', title: 'Desligar economia de energia do PCIe',
  desc: 'Link State Power Management desligado: GPU e SSD NVMe não entram em economia agressiva no barramento.',
  power: [{ sub: '501a4d13-42af-4429-9fd1-a8218c268e20', set: 'ee12f906-d277-404b-b6da-e5fa1a576df5', value: 0 }],
  rule: (hw) => laptopBattery(hw),
});
add({
  id: 'hibernation-off', cat: 'power', title: 'Desligar hibernação',
  desc: 'powercfg /h off: apaga o hiberfil.sys (libera espaço do tamanho da RAM). Também desativa a Inicialização Rápida.',
  custom: 'hibernation',
  rule: (hw) => (hw.system.isLaptop ? { level: 'warn', reason: 'Em notebook a hibernação salva seu trabalho quando a bateria acaba.' } : null),
});

// ───────── Rede
add({
  id: 'network-throttling-off', cat: 'network', title: 'Desligar Network Throttling',
  desc: 'NetworkThrottlingIndex = 0xFFFFFFFF: o MMCSS para de limitar pacotes de rede durante reprodução multimídia/jogos.',
  reg: [dw(SP, 'NetworkThrottlingIndex', 0xffffffff)],
});
add({
  id: 'tcp-nagle-off', cat: 'network', title: 'Desligar algoritmo de Nagle', risk: 'medium',
  desc: 'TcpAckFrequency=1 e TCPNoDelay=1 nas interfaces com gateway: pacotes pequenos saem na hora. Pode afetar streaming em casos raros.',
  resolve: 'nagle',
});
add({
  id: 'nic-power-mgmt-off', cat: 'network', title: 'Placa de rede sem economia de energia',
  desc: 'Desativa o gerenciamento de energia dos adaptadores físicos ativos (evita micro-quedas de rede).',
  custom: 'nicPower',
  rule: (hw) => laptopBattery(hw),
});
add({
  id: 'delivery-optimization-off', cat: 'network', title: 'Desligar P2P do Windows Update',
  desc: 'O Windows para de baixar e enviar atualizações para outros PCs (DODownloadMode=0).',
  reg: [dw(POL + 'DeliveryOptimization', 'DODownloadMode', 0)],
});
add({
  id: 'ipv6-off', cat: 'network', title: 'Desabilitar IPv6', risk: 'medium',
  desc: 'Desliga o IPv6 em todas as interfaces. A Microsoft recomenda mantê-lo ligado; use só se sua rede é apenas IPv4.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters', 'DisabledComponents', 0xff)], restart: true,
});

// ───────── Memória e disco
add({
  id: 'paging-behavior-optimized', cat: 'memory', title: 'Kernel sempre na RAM',
  desc: 'DisablePagingExecutive=1: drivers e kernel não vão para o pagefile.',
  reg: [dw(MM, 'DisablePagingExecutive', 1), dw(MM, 'LargeSystemCache', 0)], restart: true,
  rule: (hw) => (hw.ram.gb < 8 ? { level: 'block', reason: `Só ${hw.ram.gb} GB de RAM: aperta demais a memória.` } : null),
});
add({
  id: 'prefetch-off', cat: 'memory', title: 'Desligar Prefetch (SSD)',
  desc: 'EnablePrefetcher=0. Em SSD não acelera nada e gera escrita desnecessária.',
  reg: [dw(MM + '\\PrefetchParameters', 'EnablePrefetcher', 0)],
  rule: (hw) => (hw.disk.type === 'HDD' ? { level: 'block', reason: 'Sistema em HDD: o Prefetch ainda ajuda.' } : null),
});
add({
  id: 'memory-compression-off', cat: 'memory', title: 'Desligar compressão de memória',
  desc: 'Disable-MMAgent -MemoryCompression. Com 16 GB+ devolve a CPU gasta comprimindo páginas. Vale após reiniciar.',
  custom: 'memoryCompression', restart: true,
  rule: (hw) => (hw.ram.gb < 16 ? { level: 'block', reason: `${hw.ram.gb} GB de RAM: abaixo de 16 GB a compressão ajuda.` } : null),
});
add({
  id: 'ntfs-last-access-off', cat: 'memory', title: 'Desligar carimbo de último acesso (NTFS)',
  desc: 'O disco para de gravar data de acesso a cada arquivo lido.',
  custom: 'lastAccess',
});
add({
  id: 'pagefile-fixed', cat: 'memory', title: 'Pagefile fixo (1,5x a RAM)', risk: 'medium',
  desc: 'Tamanho fixo em vez de automático, evitando redimensionamentos que causam engasgos em jogos de mundo aberto e edição.',
  custom: 'pagefile', restart: true,
});
add({
  id: 'performance-counters-off', cat: 'memory', title: 'Desligar contadores de desempenho', risk: 'medium',
  desc: 'Corta a coleta contínua de contadores do Perflib. QUEBRA overlays de monitoramento (Afterburner/RTSS) e o Gerenciador de Tarefas pode mostrar menos dados.',
  reg: [dw(HKLM + 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Perflib', 'Disable Performance Counters', 1)],
});

// ───────── Serviços
const svc = (id, title, desc, names, extra = {}) => add({ id, cat: 'services', title, desc, svc: names, ...extra });
svc('service-diagtrack', 'Desativar DiagTrack (telemetria)', 'Principal serviço de telemetria do Windows ("Experiências do Usuário Conectado").', ['DiagTrack']);
svc('service-dmwappush', 'Desativar dmwappushservice', 'Roteamento de mensagens WAP usado pela telemetria. Inútil em desktop.', ['dmwappushservice']);
svc('service-sysmain', 'Desativar SysMain (Superfetch)', 'Pré-carregamento de apps na RAM. Em SSD quase não ajuda e pode causar uso alto de disco/RAM.', ['SysMain'], {
  rule: (hw) => (hw.disk.type === 'HDD' ? { level: 'warn', reason: 'Sistema em HDD: o SysMain ainda ajuda a abrir apps.' } : null),
});
svc('service-wsearch', 'Desativar Windows Search', 'Para o indexador. Libera disco e CPU, mas a busca do Iniciar fica mais lenta.', ['WSearch'], { risk: 'medium' });
svc('xbox-services-off', 'Desativar serviços do Xbox', 'Autenticação, saves na nuvem e rede do Xbox Live. Não afeta jogos fora da Xbox/Game Pass.', ['XblAuthManager', 'XblGameSave', 'XboxNetApiSvc', 'XboxGipSvc'], { risk: 'medium' });
svc('gamebar-presence-off', 'Desativar serviço de presença da Game Bar', 'BcastDVRUserService fica rodando mesmo com a Game Bar fechada.', ['BcastDVRUserService']);
svc('startup-services-off', 'Serviços raros na inicialização', 'Desativa Mapas offline e Modo de Demonstração de Loja.', ['MapsBroker', 'RetailDemo']);
svc('service-print-spooler', 'Desativar Spooler de impressão', 'Só se você NÃO usa impressora. Também fecha a porta do PrintNightmare.', ['Spooler'], { risk: 'medium' });
svc('service-fax', 'Desativar serviço de Fax', 'Ninguém usa fax em PC moderno.', ['Fax']);
svc('service-remote-registry', 'Desativar Registro Remoto', 'Fecha um vetor clássico de ataque remoto.', ['RemoteRegistry']);
svc('service-wer', 'Desativar Relatório de Erros', 'Para de gerar e enviar dumps de travamento para a Microsoft.', ['WerSvc']);

// ───────── Privacidade
add({ id: 'allow-telemetry', cat: 'privacy', title: 'Telemetria no mínimo', desc: 'Política AllowTelemetry=0 (nível Segurança).', reg: [dw(POL + 'DataCollection', 'AllowTelemetry', 0)] });
add({ id: 'cortana-off', cat: 'privacy', title: 'Desligar Cortana', desc: 'Política AllowCortana=0.', reg: [dw(POL + 'Windows Search', 'AllowCortana', 0)] });
add({
  id: 'web-search-off', cat: 'privacy', title: 'Sem busca web no Iniciar',
  desc: 'O Iniciar para de consultar o Bing: busca local mais rápida e menos dados enviados.',
  reg: [dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 0), dw(HKCU + 'Software\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions', 1)],
});
add({
  id: 'activity-history-off', cat: 'privacy', title: 'Desligar Histórico de Atividades',
  desc: 'O Windows para de registrar e enviar o que você abre.',
  reg: [dw(POL + 'System', 'EnableActivityFeed', 0), dw(POL + 'System', 'PublishUserActivities', 0), dw(POL + 'System', 'UploadUserActivities', 0)],
});
add({
  id: 'recall-off', cat: 'privacy', title: 'Desligar Recall',
  desc: 'Impede o Recall (Copilot+ PCs) de capturar e analisar sua tela. Inofensivo onde não existe.',
  reg: [dw(POL + 'WindowsAI', 'DisableAIDataAnalysis', 1), dw(HKCU + 'Software\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis', 1)],
});
add({
  id: 'input-speech-collection-off', cat: 'privacy', title: 'Bloquear coleta de digitação e voz',
  desc: 'Desliga a coleta implícita de texto, escrita à mão e voz online para "personalização".',
  reg: [
    dw(HKCU + 'Software\\Microsoft\\InputPersonalization', 'RestrictImplicitTextCollection', 1),
    dw(HKCU + 'Software\\Microsoft\\InputPersonalization', 'RestrictImplicitInkCollection', 1),
    dw(HKCU + 'Software\\Microsoft\\InputPersonalization\\TrainedDataStore', 'HarvestContacts', 0),
    dw(HKCU + 'Software\\Microsoft\\Personalization\\Settings', 'AcceptedPrivacyPolicy', 0),
    dw(HKCU + 'Software\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy', 'HasAccepted', 0),
  ],
});
add({
  id: 'background-apps-off', cat: 'privacy', title: 'Sem apps da Store em segundo plano',
  desc: 'LetAppsRunInBackground=2: apps UWP não rodam escondidos. Mail/Calendário param de notificar.',
  reg: [dw(POL + 'AppPrivacy', 'LetAppsRunInBackground', 2)],
});
add({
  id: 'consumer-features-off', cat: 'privacy', title: 'Bloquear reinstalação de bloatware',
  desc: 'DisableWindowsConsumerFeatures=1: o Windows para de instalar e sugerir apps promovidos.',
  reg: [dw(POL + 'CloudContent', 'DisableWindowsConsumerFeatures', 1)],
});

// ───────── Interface
add({
  id: 'windows-tips-off', cat: 'ui', title: 'Sem dicas e sugestões',
  desc: 'Remove sugestões, dicas e conteúdo promovido do Iniciar e da tela de bloqueio.',
  reg: [dw(CDM, 'SubscribedContent-338389Enabled', 0), dw(CDM, 'SoftLandingEnabled', 0), dw(CDM, 'SystemPaneSuggestionsEnabled', 0), dw(CDM, 'SubscribedContent-338388Enabled', 0), dw(CDM, 'SilentInstalledAppsEnabled', 0)],
});
add({
  id: 'windows-notifications-off', cat: 'ui', title: 'Desligar notificações (toasts)', risk: 'medium',
  desc: 'Nenhum balão de notificação aparece sobre o jogo. Você deixa de ver avisos de apps.',
  reg: [dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled', 0)],
});
add({
  id: 'visual-effects-performance', cat: 'ui', title: 'Efeitos visuais: desempenho',
  desc: 'Desliga animações e transparência mantendo o ClearType. Interface mais direta, útil em PCs modestos.',
  reg: [
    dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 3),
    sz(HKCU + 'Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', '0'),
    dw(ADV, 'TaskbarAnimations', 0), dw(ADV, 'ListviewAlphaSelect', 0),
    dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 0),
    dw(HKCU + 'Software\\Microsoft\\Windows\\DWM', 'EnableAeroPeek', 0),
  ],
});
add({
  id: 'taskbar-search-taskview-off', cat: 'ui', title: 'Barra sem busca e Visão de Tarefas',
  desc: 'Esconde a caixa de busca e o botão de Visão de Tarefas. Vale ao reiniciar o Explorer.',
  reg: [dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'SearchboxTaskbarMode', 0), dw(ADV, 'ShowTaskViewButton', 0)],
});
add({
  id: 'widgets-off', cat: 'ui', title: 'Desligar Widgets',
  desc: 'Desativa Widgets / Notícias e Interesses do Windows 11.',
  reg: [dw(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Dsh', 'AllowNewsAndInterests', 0)],
  rule: (hw) => (!hw.os.isWin11 ? { level: 'block', reason: 'Recurso do Windows 11.' } : null),
});

// ───────── Apps nativos
const appx = (id, title, desc, pkg) => add({ id, cat: 'debloat', title, desc, appx: pkg });
appx('uninstall-xbox-gamebar', 'Remover Xbox Game Bar', 'Overlay Win+G, com impacto medido em FPS. Reinstalável pela Microsoft Store.', 'Microsoft.XboxGamingOverlay');
appx('uninstall-candy-crush', 'Remover Candy Crush', 'Jogo pré-instalado. Reinstalável pela Store.', 'king.com.');
appx('uninstall-solitaire', 'Remover Solitaire Collection', 'Paciência com anúncios. Reinstalável pela Store.', 'Microsoft.MicrosoftSolitaireCollection');
appx('uninstall-bing-weather', 'Remover Clima (Bing)', 'App de clima pré-instalado.', 'Microsoft.BingWeather');
appx('uninstall-bing-news', 'Remover Notícias (Bing)', 'App de notícias pré-instalado.', 'Microsoft.BingNews');
appx('uninstall-get-started', 'Remover "Introdução/Dicas"', 'App de boas-vindas que abre periodicamente.', 'Microsoft.Getstarted');
appx('uninstall-teams-consumer', 'Remover Teams pessoal', 'Teams Chat do Windows 11. Não afeta o Teams corporativo.', 'MicrosoftTeams');
appx('uninstall-feedback-hub', 'Remover Hub de Feedback', 'App de envio de feedback para a Microsoft.', 'Microsoft.WindowsFeedbackHub');
appx('uninstall-office-hub', 'Remover "Microsoft 365 (Office)"', 'Atalho promocional do Office.', 'Microsoft.MicrosoftOfficeHub');
appx('uninstall-clipchamp', 'Remover Clipchamp', 'Editor de vídeo pré-instalado.', 'Clipchamp.Clipchamp');
const appxR = (id, title, desc, pkg, risk) => add({ id, cat: 'debloat', title, desc, appx: pkg, risk: risk || 'low' });
appxR('uninstall-3d-builder', 'Remover 3D Builder', 'Editor 3D antigo.', 'Microsoft.3DBuilder');
appxR('uninstall-3d-viewer', 'Remover Visualizador 3D', 'Visualizador de modelos 3D.', 'Microsoft.Microsoft3DViewer');
appxR('uninstall-paint3d', 'Remover Paint 3D', 'Editor 3D descontinuado (o Paint comum continua).', 'Microsoft.MSPaint');
appxR('uninstall-mail-calendar', 'Remover Email e Calendário', 'App de email antigo do Windows.', 'microsoft.windowscommunicationsapps');
appxR('uninstall-outlook-new', 'Remover novo Outlook', 'Outlook pré-instalado do Windows 11.', 'Microsoft.OutlookForWindows');
appxR('uninstall-movies-tv', 'Remover Filmes e TV', 'Player de vídeo da loja.', 'Microsoft.ZuneVideo');
appxR('uninstall-groove', 'Remover Groove / Media Player (Store)', 'Player de música da loja. O Windows Media Player clássico não é afetado.', 'Microsoft.ZuneMusic', 'medium');
appxR('uninstall-people', 'Remover Pessoas', 'App de contatos.', 'Microsoft.People');
appxR('uninstall-get-help', 'Remover Obter Ajuda', 'App de suporte da Microsoft.', 'Microsoft.GetHelp');
appxR('uninstall-sticky-notes', 'Remover Notas Autoadesivas', 'Notas da área de trabalho.', 'Microsoft.MicrosoftStickyNotes', 'medium');
appxR('uninstall-sound-recorder', 'Remover Gravador de Som', 'Gravador de áudio simples.', 'Microsoft.WindowsSoundRecorder', 'medium');
appxR('uninstall-onenote', 'Remover OneNote (Store)', 'Versão da loja do OneNote.', 'Microsoft.Office.OneNote');
appxR('uninstall-power-automate', 'Remover Power Automate', 'Automação de tarefas.', 'Microsoft.PowerAutomateDesktop');
appxR('uninstall-todo', 'Remover Microsoft To Do', 'Lista de tarefas.', 'Microsoft.Todos');
appxR('uninstall-whiteboard', 'Remover Whiteboard', 'Quadro branco colaborativo.', 'Microsoft.Whiteboard');
appxR('uninstall-family', 'Remover Family Safety', 'Controle parental da Microsoft.', 'MicrosoftCorporationII.MicrosoftFamily');
appxR('uninstall-dev-home', 'Remover Dev Home', 'Painel para desenvolvedores (descontinuado).', 'Microsoft.Windows.DevHome');
appxR('uninstall-quick-assist', 'Remover Assistência Rápida', 'Acesso remoto da Microsoft. Golpistas costumam usá-lo.', 'MicrosoftCorporationII.QuickAssist');
appxR('uninstall-xbox-console', 'Remover Xbox Console Companion', 'App antigo do Xbox (substituído pelo app Xbox).', 'Microsoft.XboxApp');
appxR('uninstall-xbox-speech', 'Remover Xbox Speech Window', 'Sobreposição de fala para texto do Xbox.', 'Microsoft.XboxSpeechToTextOverlay');
appxR('uninstall-xbox-tcui', 'Remover Xbox Live (TCUI)', 'Interface social do Xbox Live. QUEBRA login de jogos Xbox/Game Pass e Minecraft Bedrock.', 'Microsoft.Xbox.TCUI', 'high');
appxR('uninstall-xbox-identity', 'Remover Xbox Identity Provider', 'Login da conta Xbox em jogos. QUEBRA Game Pass, Minecraft Bedrock e Forza.', 'Microsoft.XboxIdentityProvider', 'high');
appxR('uninstall-phone-link', 'Remover Vincular ao Celular', 'Integração com celular (Phone Link).', 'Microsoft.YourPhone', 'medium');
appxR('uninstall-mahjong', 'Remover Mahjong', 'Jogo pré-instalado.', 'Microsoft.MicrosoftMahjong');
appxR('uninstall-minesweeper', 'Remover Campo Minado', 'Jogo pré-instalado.', 'Microsoft.MicrosoftMinesweeper');
appxR('uninstall-alarms', 'Remover Alarmes e Relógio', 'Alarmes, cronômetro e timer.', 'Microsoft.WindowsAlarms', 'medium');
appxR('uninstall-maps', 'Remover Mapas', 'Mapas offline do Windows.', 'Microsoft.WindowsMaps');
appxR('uninstall-skype', 'Remover Skype (Store)', 'Skype pré-instalado.', 'Microsoft.SkypeApp');
appxR('uninstall-mixed-reality', 'Remover Portal de Realidade Misturada', 'Só serve para óculos Windows MR.', 'Microsoft.MixedReality.Portal');
appxR('uninstall-cortana', 'Remover Cortana', 'App da Cortana (descontinuada).', 'Microsoft.549981C3F5F10');
appxR('uninstall-msn-money', 'Remover MSN Dinheiro', 'App de finanças do Bing.', 'Microsoft.BingFinance');
appxR('uninstall-msn-sports', 'Remover MSN Esportes', 'App de esportes do Bing.', 'Microsoft.BingSports');
appxR('uninstall-msn-travel', 'Remover MSN Viagens', 'App de viagens do Bing.', 'Microsoft.BingTravel');
appxR('uninstall-bing-search', 'Remover Bing Search', 'Pacote de busca do Bing.', 'Microsoft.BingSearch');
appxR('uninstall-oneconnect', 'Remover Planos Pagos / OneConnect', 'Conectividade móvel paga.', 'Microsoft.OneConnect');
appxR('uninstall-copilot', 'Remover Copilot', 'Assistente de IA da Microsoft.', 'Microsoft.Copilot');
appxR('uninstall-journal', 'Remover Microsoft Journal', 'Caderno para caneta.', 'Microsoft.MicrosoftJournal');
appxR('uninstall-widgets-pack', 'Remover pacote de Widgets', 'Remove o Web Experience Pack que alimenta os Widgets do Windows 11.', 'MicrosoftWindows.Client.WebExperience', 'medium');
appxR('uninstall-teams-work', 'Remover Teams (novo)', 'Novo Teams pré-instalado. Não remova se usa no trabalho.', 'MSTeams', 'medium');
add({
  id: 'uninstall-onedrive', cat: 'debloat', title: 'Desinstalar OneDrive', risk: 'medium',
  desc: 'Remove o cliente do OneDrive (seus arquivos na nuvem não são apagados). Arquivos que estavam "só online" deixam de aparecer no PC.',
  custom: 'onedrive',
});

// ───────── Prioridade de jogos e apps
for (const [key, g] of Object.entries(GAMES)) {
  add({ id: 'game-priority-' + key, cat: 'priority', risk: 'medium', title: `Prioridade alta: ${g.name}`, desc: `CPU em prioridade alta para ${g.exes.join(', ')} (IFEO). Em alguns PCs rouba tempo do áudio, do mouse e do Discord e causa engasgos — meça com o Benchmark; para algo mais suave use Perfis de jogo (acima do normal).`, ifeo: g.exes, game: key });
}
add({ id: 'work-priority-streamer', cat: 'priority', title: 'Prioridade alta: OBS / Streamlabs', desc: 'O encoder não perde frames quando o jogo pede CPU.', ifeo: ['obs64.exe', 'obs32.exe', 'Streamlabs OBS.exe'] });
add({ id: 'work-priority-video', cat: 'priority', title: 'Prioridade alta: editores de vídeo', desc: 'Premiere, After Effects, Media Encoder e DaVinci Resolve.', ifeo: ['Adobe Premiere Pro.exe', 'AfterFX.exe', 'Adobe Media Encoder.exe', 'Resolve.exe'] });
add({ id: 'work-priority-design', cat: 'priority', title: 'Prioridade alta: apps de design', desc: 'Photoshop, Illustrator, Lightroom e Figma.', ifeo: ['Photoshop.exe', 'Illustrator.exe', 'Lightroom.exe', 'Figma.exe'] });
add({ id: 'work-priority-programming', cat: 'priority', title: 'Prioridade alta: IDEs', desc: 'VS Code e JetBrains (IDEA, PyCharm, Rider, WebStorm, GoLand).', ifeo: ['Code.exe', 'idea64.exe', 'pycharm64.exe', 'rider64.exe', 'webstorm64.exe', 'goland64.exe'] });
add({
  id: 'defender-dev-exclusions', cat: 'priority', title: 'Exclusões do Defender para pastas de dev', risk: 'medium',
  desc: 'source\\repos, git, Projects, go, .cargo, .nuget e node_modules deixam de ser escaneados em tempo real. Builds mais rápidos, menos proteção nessas pastas.',
  custom: 'defenderExclusions',
});

// ───────── Segurança (trade-offs)
add({
  id: 'vbs-off', cat: 'security', title: 'Desligar VBS', risk: 'high',
  desc: 'Segurança baseada em virtualização desligada: alguns % de FPS e compatibilidade com anti-cheats. PERDE proteção de kernel.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard', 'EnableVirtualizationBasedSecurity', 0)], restart: true,
});
add({
  id: 'hvci-off', cat: 'security', title: 'Desligar Integridade de Memória (HVCI)', risk: 'high',
  desc: 'Isolamento de núcleo desligado: menos overhead no kernel. PERDE proteção contra drivers maliciosos.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity', 'Enabled', 0)], restart: true,
});
add({
  id: 'hyper-v-off', cat: 'security', title: 'Desligar hypervisor (Hyper-V)', risk: 'high',
  desc: 'bcdedit hypervisorlaunchtype off. QUEBRA WSL2, Docker e máquinas virtuais até reverter.',
  bcd: [{ name: 'hypervisorlaunchtype', value: 'off' }], restart: true,
});
add({
  id: 'cpu-mitigations-off', cat: 'security', title: 'Desligar mitigações Spectre/Meltdown', risk: 'high',
  desc: 'FeatureSettingsOverride=3. Recupera alguns % de CPU, mas REMOVE a proteção contra execução especulativa.',
  reg: [dw(MM, 'FeatureSettingsOverride', 3), dw(MM, 'FeatureSettingsOverrideMask', 3)], restart: true,
});

// ───────── Adicionados na v1.1 (privacidade, memória, periféricos, Windows Update)
add({
  id: 'advertising-id-off', cat: 'privacy', title: 'Desligar ID de anúncios',
  desc: 'Apps deixam de receber um identificador para anúncios personalizados.',
  reg: [dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 0), dw(POL + 'AdvertisingInfo', 'DisabledByGroupPolicy', 1)],
});
add({
  id: 'tailored-experiences-off', cat: 'privacy', title: 'Sem "experiências personalizadas"',
  desc: 'A Microsoft não usa seus dados de diagnóstico para dicas e anúncios.',
  reg: [dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled', 0)],
});
add({
  id: 'feedback-requests-off', cat: 'privacy', title: 'Sem pedidos de feedback',
  desc: 'O Windows para de perguntar sua opinião (pop-ups do Hub de Feedback).',
  reg: [dw(HKCU + 'Software\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod', 0), dw(POL + 'DataCollection', 'DoNotShowFeedbackNotifications', 1)],
});
add({
  id: 'app-launch-tracking-off', cat: 'privacy', title: 'Sem rastreio de apps abertos',
  desc: 'O Iniciar deixa de registrar quais programas você abre.',
  reg: [dw(ADV, 'Start_TrackProgs', 0)],
});
add({
  id: 'copilot-off', cat: 'privacy', title: 'Desligar Copilot',
  desc: 'Política que desativa o Copilot do Windows e esconde o botão da barra.',
  reg: [dw(HKCU + 'Software\\Policies\\Microsoft\\Windows\\WindowsCopilot', 'TurnOffWindowsCopilot', 1), dw(POL + 'WindowsCopilot', 'TurnOffWindowsCopilot', 1), dw(ADV, 'ShowCopilotButton', 0)],
});
add({
  id: 'svchost-split', cat: 'memory', title: 'Agrupar processos svchost', risk: 'medium', restart: true,
  desc: 'SvcHostSplitThresholdInKB = tamanho da RAM: o Windows agrupa serviços em menos processos svchost, reduzindo overhead. Se um serviço travar, leva o grupo junto.',
  resolve: 'svchostSplit',
  rule: (hw) => (hw.ram.gb < 8 ? { level: 'block', reason: 'Com menos de 8 GB o ganho é irrelevante.' } : null),
});
add({
  id: 'fast-startup-off', cat: 'power', title: 'Desligar Inicialização Rápida',
  desc: 'O "desligar" passa a ser um desligamento real: evita drivers presos em estado ruim e uptime acumulado. O boot fica alguns segundos mais lento.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', 'HiberbootEnabled', 0)],
});
add({
  id: 'input-queue-size', cat: 'input', title: 'Fila de mouse e teclado menor', risk: 'medium', restart: true,
  desc: 'MouseDataQueueSize e KeyboardDataQueueSize = 30 (padrão 100): o buffer de entrada é processado mais rápido. Valores muito baixos podem perder eventos em mouses de 4-8 kHz.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters', 'MouseDataQueueSize', 30), dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters', 'KeyboardDataQueueSize', 30)],
});
add({
  id: 'usb-hid-power-off', cat: 'input', title: 'USB e HID sem economia de energia',
  desc: 'Desmarca "permitir que o computador desligue este dispositivo" em hubs USB, mouse, teclado e headset. Evita desconexões e engasgos de input.',
  custom: 'devicePowerSaving',
  rule: (hw) => laptopBattery(hw),
});
add({
  id: 'wu-no-drivers', cat: 'update', title: 'Windows Update sem drivers',
  desc: 'O Windows Update para de instalar drivers por conta própria (ex.: trocar o driver da sua placa de vídeo por um mais velho).',
  reg: [dw(POL + 'WindowsUpdate', 'ExcludeWUDriversInQualityUpdate', 1), dw(HKLM + 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DriverSearching', 'SearchOrderConfig', 0)],
});
add({
  id: 'wu-no-auto-restart', cat: 'update', title: 'Sem reinício automático por updates',
  desc: 'O Windows não reinicia sozinho enquanto você está logado (nem no meio de uma partida).',
  reg: [dw(POL + 'WindowsUpdate\\AU', 'NoAutoRebootWithLoggedOnUsers', 1)],
});
add({
  id: 'wu-no-p2p-store-updates', cat: 'update', title: 'Store não atualiza apps sozinha',
  desc: 'Atualizações automáticas da Microsoft Store desligadas (atualize manualmente quando quiser).',
  reg: [dw(HKLM + 'SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'AutoDownload', 2)],
});

// ───────── Tweaks de registro populares (verificados um a um; os sem efeito real ficaram de fora)
const PWR = HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Power';
const PSET = PWR + '\\PowerSettings\\54533251-82be-4824-96c1-47b60b740d00\\';
const ACC = HKCU + 'Control Panel\\Accessibility\\';
add({
  id: 'ndu-off', cat: 'services', title: 'Desligar monitor de uso de rede (Ndu)',
  desc: 'O driver Ndu contabiliza dados por app em tempo real; em algumas máquinas vaza memória e gasta CPU. Você perde o histórico de "uso de dados" por app nas Configurações.',
  svc: ['Ndu'], restart: true,
});
add({
  id: 'timer-coalescing-off', cat: 'cpu', title: 'Desligar agrupamento de timers',
  desc: 'CoalescingTimerInterval = 0: o Windows deixa de atrasar timers para dispará-los em lote (economia de energia). Timers mais pontuais, um pouco mais de consumo.',
  reg: [dw(PWR, 'CoalescingTimerInterval', 0), dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel', 'CoalescingTimerInterval', 0)], restart: true,
  rule: (hw) => laptopBattery(hw),
});
add({
  id: 'modern-standby-off', cat: 'power', title: 'Desligar Modern Standby (S0)', risk: 'medium', restart: true,
  desc: 'CsEnabled = 0: volta ao modo de suspensão clássico (S3) quando a placa suporta. Evita o PC "acordar" sozinho e gastar energia dormindo.',
  reg: [dw(PWR, 'CsEnabled', 0), dw(PWR, 'PlatformAoAcOverride', 0)],
  rule: (hw) => (hw.system.isLaptop ? { level: 'block', reason: 'Em notebook pode deixar a suspensão inutilizável.' } : null),
});
add({
  id: 'power-advanced-visible', cat: 'power', title: 'Mostrar opções avançadas de CPU no plano de energia',
  desc: 'Exibe em "Opções de energia > Alterar configurações avançadas" itens escondidos: modo de boost, política de aumento de desempenho, core parking e outros. Não muda desempenho sozinho.',
  reg: [
    dw(PSET + 'be337238-0d82-4146-a960-4f3749d470c7', 'Attributes', 2, true), dw(PSET + '943c8cb6-6f93-4227-ad87-e9a3feec08d1', 'Attributes', 2, true),
    dw(PSET + '0cc5b647-c1df-4637-891a-dec35c318583', 'Attributes', 2, true), dw(PSET + '45bcc044-d885-43e2-8605-ee0ec6e96b59', 'Attributes', 2, true),
    dw(PSET + '4d2b0152-7d5c-498b-88e2-34345392a2c5', 'Attributes', 2, true),
  ],
});
add({
  id: 'platform-tick', cat: 'cpu', title: 'Usar o timer da plataforma', risk: 'medium', restart: true,
  desc: 'bcdedit useplatformtick yes: o kernel usa o relógio de hardware (HPET/ACPI) em vez do TSC. Em alguns PCs firma o frametime, em outros piora — meça.',
  bcd: [{ name: 'useplatformtick', value: 'yes' }],
});
add({
  id: 'mouse-hover-time', cat: 'ui', title: 'Dicas do mouse instantâneas',
  desc: 'MouseHoverTime = 10 ms (padrão 400): balões e pré-visualizações aparecem na hora.',
  reg: [sz(HKCU + 'Control Panel\\Mouse', 'MouseHoverTime', '10')],
});
add({
  id: 'startup-delay-off', cat: 'ui', title: 'Apps de inicialização sem atraso',
  desc: 'StartupDelayInMSec = 0: o Windows deixa de esperar ~10 s antes de abrir os programas da inicialização.',
  reg: [dw(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize', 'StartupDelayInMSec', 0)],
});
add({
  id: 'fast-shutdown', cat: 'ui', title: 'Desligamento mais rápido',
  desc: 'WaitToKillServiceTimeout = 3000 ms (padrão 5000): o Windows espera menos por serviços travados ao desligar.',
  reg: [sz(HKLM + 'SYSTEM\\CurrentControlSet\\Control', 'WaitToKillServiceTimeout', '3000')],
});
add({
  id: 'accessibility-hotkeys-off', cat: 'input', title: 'Sem atalhos de acessibilidade no jogo',
  desc: 'Desliga Teclas de Aderência (Shift 5x), Teclas de Filtro, Teclas de Alternância e Teclas do Mouse — nada de pop-up tirando você do jogo.',
  reg: [sz(ACC + 'StickyKeys', 'Flags', '506'), sz(ACC + 'Keyboard Response', 'Flags', '122'), sz(ACC + 'ToggleKeys', 'Flags', '58'), sz(ACC + 'MouseKeys', 'Flags', '0'),
    sz(ACC + 'HighContrast', 'Flags', '4194'), dw(HKCU + 'Software\\Microsoft\\Narrator\\NoRoam', 'WinEnterLaunchEnabled', 0)],
});
add({
  id: 'screensaver-off', cat: 'ui', title: 'Desligar protetor de tela',
  desc: 'ScreenSaveActive = 0.',
  reg: [sz(HKCU + 'Control Panel\\Desktop', 'ScreenSaveActive', '0')],
});
add({
  id: 'auto-maintenance-off', cat: 'services', title: 'Desligar manutenção automática', risk: 'medium',
  desc: 'MaintenanceDisabled = 1: o Windows para de rodar tarefas pesadas (verificações, otimização de disco, diagnósticos) quando o PC fica ocioso — inclusive no meio de uma partida. Rode "Otimizar unidades" em Windows > Reparos de vez em quando.',
  reg: [dw(HKLM + 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\Maintenance', 'MaintenanceDisabled', 1)],
});
add({
  id: 'boot-trace-off', cat: 'memory', title: 'Sem Superfetch e boot trace',
  desc: 'EnableSuperfetch = 0 e EnableBootTrace = 0: complementa "Desligar Prefetch" parando o rastreamento de boot.',
  reg: [dw(MM + '\\PrefetchParameters', 'EnableSuperfetch', 0), dw(MM + '\\PrefetchParameters', 'EnableBootTrace', 0)],
  rule: (hw) => (hw.disk.type === 'HDD' ? { level: 'block', reason: 'Sistema em HDD: o pré-carregamento ainda ajuda.' } : null),
});
add({
  id: 'ntfs-memory-usage', cat: 'memory', title: 'Mais memória para o cache do NTFS',
  desc: 'fsutil memoryusage 2: aumenta o pool de memória do sistema de arquivos. Ajuda quem abre muitos arquivos (jogos com muitos assets). Requer 16 GB+.',
  custom: 'ntfsMemoryUsage', restart: true,
  rule: (hw) => (hw.ram.gb < 16 ? { level: 'block', reason: `${hw.ram.gb} GB de RAM: melhor deixar a memória para os apps.` } : null),
});
add({
  id: 'lanman-server', cat: 'network', title: 'Compartilhamento de rede local mais rápido',
  desc: 'IRPStackSize = 32 e SizReqBuf = 17424 no LanmanServer. Só afeta quando OUTROS PCs acessam pastas compartilhadas deste PC; não muda ping de jogo.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', 'IRPStackSize', 32), dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', 'SizReqBuf', 17424)],
  restart: true,
});
add({
  id: 'tcp-timed-wait', cat: 'network', title: 'Portas TCP liberadas mais rápido',
  desc: 'TcpTimedWaitDelay = 30 s (padrão 120): conexões fechadas liberam a porta antes. Útil com muitos downloads/conexões simultâneas.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', 'TcpTimedWaitDelay', 30)],
  restart: true,
});
add({
  id: 'wpf-no-msaa', cat: 'gpu', title: 'Apps WPF sem antialiasing',
  desc: 'Mantém a aceleração por GPU dos apps WPF (launchers, ferramentas .NET) e desliga o antialiasing deles (MaxMultisampleType = 0).',
  reg: [dw(HKCU + 'Software\\Microsoft\\Avalon.Graphics', 'DisableHWAcceleration', 0), dw(HKCU + 'Software\\Microsoft\\Avalon.Graphics', 'MaxMultisampleType', 0)],
});
const nvidiaRule = (hw) => (!hw.gpus.some((g) => g.kind === 'nvidia') ? { level: 'block', reason: 'Nenhuma GPU NVIDIA encontrada.' } : null);
add({
  id: 'nvidia-pstate-fixed', cat: 'gpu', title: 'NVIDIA: clock fixo no máximo (P-state)', risk: 'high', restart: true,
  desc: 'DisableDynamicPstate = 1: a placa não baixa o clock em repouso. Elimina a demora para "subir" o clock em picos, mas a GPU fica quente e gastando energia o tempo todo.',
  resolve: 'nvidiaPstate',
  rule: (hw) => nvidiaRule(hw) || (hw.system.isLaptop ? { level: 'block', reason: 'Em notebook só esquenta e drena bateria.' } : null),
});
add({
  id: 'nvidia-hdcp-off', cat: 'gpu', title: 'NVIDIA: desligar HDCP', risk: 'high', restart: true,
  desc: 'RMHdcpKeyglobZero = 1: remove a negociação HDCP com o monitor. QUEBRA reprodução de conteúdo protegido (Netflix/Prime em alta resolução, Blu-ray).',
  resolve: 'nvidiaHdcp', rule: nvidiaRule,
});
add({
  id: 'gpu-preemption-off', cat: 'gpu', title: 'Desligar preempção da GPU', risk: 'high', restart: true,
  desc: 'EnablePreemption = 0: o Windows não interrompe tarefas da GPU para outras. Pode reduzir micro-latência, mas aumenta o risco de travamentos e "driver parou de responder". Teste com cuidado.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\\Scheduler', 'EnablePreemption', 0)],
});

// ───────── Pesquisa em fóruns (PC-Tuning, Winhance, Blur Busters) — itens com efeito documentado
add({
  id: 'windowed-game-optimizations', cat: 'gpu', title: 'Otimizações para jogos em janela',
  desc: 'Recurso oficial do Windows 11: jogos DirectX 10/11 em janela ou sem bordas passam a usar o modelo "flip", com latência de tela cheia e suporte a VRR. Vale ao reabrir o jogo.',
  custom: 'dxSwapEffect',
  rule: (hw) => (!hw.os.isWin11 ? { level: 'block', reason: 'Recurso do Windows 11.' } : null),
});
add({
  id: 'vrr-optimizations', cat: 'gpu', title: 'Otimizações de taxa de atualização variável',
  desc: 'Liga o suporte do Windows a G-Sync/FreeSync em jogos que não o ativam sozinhos. Só tem efeito em monitor com VRR.',
  custom: 'dxVrr',
  rule: (hw) => (!hw.gpus.some((g) => g.hz >= 100) ? { level: 'warn', reason: 'Útil apenas em monitores de alta taxa com G-Sync/FreeSync.' } : null),
});
add({
  id: 'auto-hdr-off', cat: 'gpu', title: 'Desligar Auto HDR',
  desc: 'O Auto HDR converte jogos SDR para HDR com um pequeno custo de GPU. Desligue se não usa monitor HDR ou prefere as cores originais.',
  custom: 'dxAutoHdrOff',
  rule: (hw) => (!hw.os.isWin11 ? { level: 'block', reason: 'Recurso do Windows 11.' } : null),
});
add({
  id: 'telemetry-tasks-off', cat: 'privacy', title: 'Desligar tarefas agendadas de telemetria',
  desc: 'Desativa 14 tarefas que rodam em segundo plano coletando dados de compatibilidade, uso e diagnóstico (Compatibility Appraiser, CEIP, Feedback, DiskDiagnostic...). O Appraiser é famoso por picos de CPU e disco.',
  custom: 'telemetryTasks',
});
add({
  id: 'ntfs-8dot3-off', cat: 'memory', title: 'Desligar nomes curtos 8.3 (NTFS)',
  desc: 'O NTFS deixa de criar nomes no estilo MSDOS (PROGRA~1) para cada arquivo novo: listagem de pastas grandes fica mais rápida. Não afeta arquivos já existentes.',
  reg: [dw(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'NtfsDisable8dot3NameCreation', 1)],
});
add({
  id: 'alt-tab-windows-only', cat: 'ui', title: 'Alt+Tab só com janelas',
  desc: 'O Alt+Tab deixa de mostrar abas do Edge misturadas com os programas — alternar para o jogo fica mais rápido.',
  reg: [dw(ADV, 'MultiTaskingAltTabFilter', 3)],
  rule: (hw) => (!hw.os.isWin11 ? { level: 'block', reason: 'Opção do Windows 11.' } : null),
});
add({
  id: 'wallpaper-full-quality', cat: 'ui', title: 'Papel de parede sem compressão',
  desc: 'O Windows deixa de recomprimir o papel de parede JPEG (qualidade 100%). Cosmético.',
  reg: [dw(HKCU + 'Control Panel\\Desktop', 'JPEGImportQuality', 100)],
});

// ───────── Presets por objetivo (Game Boost)
const BASE_GAMING = [
  'mouse-acceleration', 'keyboard-input-delay', 'input-queue-delay-off', 'win32-priority-separation', 'mmcss-games',
  'mmcss-system-responsiveness', 'power-throttling', 'fullscreen-optimizations', 'game-dvr-off', 'fullscreen-overlays-off',
  'gamebar-presence-off', 'game-mode-on', 'network-throttling-off', 'tdr-delay-extended',
  'usb-selective-suspend-off', 'windows-tips-off', 'service-diagtrack', 'service-dmwappush', 'allow-telemetry',
  'delivery-optimization-off', 'background-apps-off', 'consumer-features-off', 'activity-history-off', 'global-timer-resolution-requests',
  'windowed-game-optimizations', 'accessibility-hotkeys-off', 'telemetry-tasks-off',
];

const PRESETS = [
  { id: 'competitive', name: 'FPS competitivo', desc: 'Valorant, CS2 e afins: responsividade de CPU, input e ping.', accent: '#e63329',
    tweaks: [...BASE_GAMING, 'core-parking', 'gpu-hardware-scheduling', 'tcp-nagle-off', 'nic-power-mgmt-off', 'pcie-aspm-off', 'msi-mode-gpu', 'prefetch-off', 'service-sysmain'] },
  { id: 'battle-royale', name: 'Battle Royale', desc: 'Fortnite, Apex, Warzone: equilíbrio CPU/GPU e rede estável.', accent: '#f59e0b',
    tweaks: [...BASE_GAMING, 'core-parking', 'gpu-hardware-scheduling', 'tcp-nagle-off', 'nic-power-mgmt-off', 'pagefile-fixed', 'msi-mode-gpu'] },
  { id: 'open-world', name: 'Mundo aberto', desc: 'GTA V, RPGs: streaming de assets, memória e disco.', accent: '#22c55e',
    tweaks: [...BASE_GAMING, 'gpu-hardware-scheduling', 'pagefile-fixed', 'paging-behavior-optimized', 'memory-compression-off', 'ntfs-last-access-off'] },
  { id: 'streaming', name: 'Jogar e transmitir', desc: 'OBS/Streamlabs: encoder estável sem roubar o jogo.', accent: '#8b5cf6',
    tweaks: BASE_GAMING.filter((x) => x !== 'win32-priority-separation').concat(['work-priority-streamer', 'nic-power-mgmt-off']) },
  { id: 'video-editing', name: 'Edição de vídeo', desc: 'Premiere, DaVinci, After Effects: GPU, RAM e disco.', accent: '#3b82f6',
    tweaks: ['power-throttling', 'work-priority-video', 'pagefile-fixed', 'ntfs-last-access-off', 'gpu-hardware-scheduling', 'tdr-delay-extended', 'windows-tips-off', 'service-diagtrack', 'allow-telemetry'] },
  { id: 'programming', name: 'Programação', desc: 'IDEs, builds e git mais rápidos.', accent: '#06b6d4',
    tweaks: ['work-priority-programming', 'defender-dev-exclusions', 'ntfs-last-access-off', 'windows-tips-off', 'service-diagtrack', 'allow-telemetry', 'web-search-off'] },
  { id: 'design', name: 'Design', desc: 'Photoshop, Illustrator, Figma.', accent: '#ec4899',
    tweaks: ['work-priority-design', 'gpu-hardware-scheduling', 'ntfs-last-access-off', 'windows-tips-off', 'service-diagtrack', 'allow-telemetry'] },
  { id: 'clean', name: 'Windows limpo', desc: 'Privacidade, menos bloatware e serviços inúteis. Seguro para qualquer PC.', accent: '#a8b0bb',
    tweaks: ['windows-tips-off', 'allow-telemetry', 'service-diagtrack', 'service-dmwappush', 'service-fax', 'service-remote-registry', 'service-wer', 'startup-services-off', 'web-search-off', 'activity-history-off', 'recall-off', 'input-speech-collection-off', 'consumer-features-off', 'cortana-off', 'uninstall-candy-crush', 'uninstall-solitaire', 'uninstall-get-started', 'uninstall-bing-news', 'telemetry-tasks-off', 'advertising-id-off', 'feedback-requests-off'] },
];

module.exports = { TWEAKS: T, CATEGORIES, PRESETS, GAMES };
