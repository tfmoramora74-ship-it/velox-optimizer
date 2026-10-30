# Changelog

Todas as mudanças relevantes do Velox Optimizer.

## [1.5.0]
### Desempenho
- Pool de PowerShell persistente: comandos sem abrir um processo novo a cada vez; encerra sozinho quando ocioso.
- Monitor de CPU/GPU/memória sob demanda (só com a janela visível, Game Mode ou limpeza automática).
- Janela liberada da memória ao ir para a bandeja; início com o Windows sem criar janela.
- Vigia de processos único para Game Mode e Perfis.
- Na bandeja: de 6 processos / 442 MB / 2,7% de CPU para 3 processos / 258 MB / 0,05%.
- Instalador menor (apenas pt-BR e en-US, compressão máxima).
### Segurança
- Vigia de vídeo: detecta travamento/reinício do driver e oferece reverter ajustes de vídeo recentes.
- Detecção de Restauração do Sistema: arquiva registros antigos para não reaplicar nada.
- Durante o jogo nada consulta a GPU (contadores WMI/nvidia-smi podem causar micro-engasgos).
- Game Mode mais conservador: libera só a lista standby, prioridade "acima do normal", não rebaixa o Discord.
- Confirmação extra ao alterar controladoras USB/áudio.

## [1.4.0]
- Planos de energia: lista, ativa, exporta/importa `.pow` e recria planos populares da comunidade.
- Biblioteca de jogos (Steam, Epic, Riot, EA, Battle.net, Ubisoft…).
- Desfazer pelo histórico de atividades.
- Proteção contra boot quebrado.
- DNS criptografado (DoH), relatório do PC em HTML, página NVIDIA (NVAPI).
- Visual "Moderno" com alternância para o "Clássico".

## [1.3.0]
- Benchmark de antes/depois, Perfis de jogo, modo portátil, exportar/importar setup.
- Temperaturas e throttling, monitor de ping contínuo, testes de mouse e monitor.
- MSI e afinidade por dispositivo, instalação em lote via winget, automações.
- Aviso de otimizações desfeitas por atualizações do Windows.

## [1.2.0]
- Página Serviços com 59 serviços curados e lista do que não desligar.
- Otimizações para jogos em janela, VRR, Auto HDR, tarefas de telemetria e outros.

## [1.1.0]
- Adapter Tuner, presets de pilha TCP, prioridade QoS, timer personalizado e Measure Sleep.
- Pontos de restauração, reparos do sistema, limpeza ampliada, guia de BIOS, ferramentas.
- Desinstalador universal.

## [1.0.0]
- Primeira versão: Dashboard, Game Boost, App Tuner, Tweaks, Game Mode, Rede, Latência, Windows e Configurações.
