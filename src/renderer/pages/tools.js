/* global velox, Pages, h, icon, pageHead */
Pages.tools = async (root) => {
  root.appendChild(pageHead('Ferramentas', 'Ferramentas que complementam o Velox', 'Programas gratuitos e confiáveis, sempre pelo site oficial. O Velox só abre o link no navegador.'));
  const GROUPS = [
    ['Drivers', [
      ['DDU (Display Driver Uninstaller)', 'Remove drivers de vídeo por completo antes de instalar outro. Use no Modo de Segurança.', 'https://www.guru3d.com/download/display-driver-uninstaller-download/'],
      ['NVCleanstall', 'Instala o driver NVIDIA só com o essencial (sem telemetria e extras).', 'https://www.techpowerup.com/nvcleanstall/'],
      ['NVIDIA App / drivers', 'Driver oficial NVIDIA.', 'https://www.nvidia.com/pt-br/drivers/'],
      ['AMD Software', 'Driver oficial AMD Radeon / chipset Ryzen.', 'https://www.amd.com/pt/support/download/drivers.html'],
      ['Intel Driver & Support Assistant', 'Drivers Intel de vídeo, rede e chipset.', 'https://www.intel.com.br/content/www/br/pt/support/detect.html'],
    ]],
    ['GPU e monitor', [
      ['NVIDIA Profile Inspector', 'Configurações avançadas do driver NVIDIA que o painel não mostra.', 'https://github.com/Orbmu2k/nvidiaProfileInspector/releases'],
      ['MSI Afterburner', 'Overclock/undervolt da GPU e overlay de FPS (com RTSS).', 'https://www.msi.com/Landing/afterburner/graphics-cards'],
      ['CRU (Custom Resolution Utility)', 'Resoluções e taxas de atualização personalizadas para o monitor.', 'https://www.monitortests.com/forum/Thread-Custom-Resolution-Utility-CRU'],
    ]],
    ['Medição e diagnóstico', [
      ['PresentMon', 'Medidor de FPS e frametime da Intel (usado pela página Latência do Velox).', 'https://github.com/GameTechDev/PresentMon/releases'],
      ['CapFrameX', 'Grava e compara benchmarks de frametime entre configurações.', 'https://www.capframex.com/'],
      ['LatencyMon', 'Encontra drivers que causam picos de latência DPC (estalos de áudio, stutter).', 'https://www.resplendence.com/latencymon'],
      ['HWiNFO', 'Sensores completos: temperaturas, clocks, consumo, throttling.', 'https://www.hwinfo.com/download/'],
      ['Teste de bufferbloat (Waveform)', 'Mede quanto o ping sobe quando a internet está carregada.', 'https://www.waveform.com/tools/bufferbloat'],
    ]],
    ['CPU e sistema', [
      ['AMD Ryzen Master', 'Curve Optimizer, PBO e monitoramento para Ryzen.', 'https://www.amd.com/pt/products/software/ryzen-master.html'],
      ['Rufus', 'Cria pendrive de instalação do Windows (opções para pular exigências e conta online).', 'https://rufus.ie/pt_BR/'],
      ['Autoruns (Microsoft)', 'Tudo o que inicia com o Windows: serviços, tarefas, drivers, extensões.', 'https://learn.microsoft.com/sysinternals/downloads/autoruns'],
      ['Process Explorer (Microsoft)', 'Gerenciador de tarefas avançado.', 'https://learn.microsoft.com/sysinternals/downloads/process-explorer'],
    ]],
  ];
  for (const [title, tools] of GROUPS) {
    root.appendChild(h('h2.mt', title));
    root.appendChild(h('div.grid.g3', tools.map(([name, desc, url]) => h('div.card', h('h3', name), h('div.text2.small.mt-s', desc),
      h('button.btn.sm.mt', { onclick: () => velox.shell.open(url) }, icon('external'), new URL(url).hostname.replace(/^www\./, ''))))));
  }
};
