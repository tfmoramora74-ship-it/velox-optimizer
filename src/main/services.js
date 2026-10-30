// Gerenciador de serviços: lista curada do que pode ser desligado/posto em manual para jogos,
// com o estado atual, backup do tipo de inicialização original e reversão.
const { ps, psJson, q } = require('./ps');
const store = require('./store');

// level: safe = seguro para quase todo mundo; cond = só se você não usa o recurso; adv = avançado
// rec: 4 = Desativado, 3 = Manual (inicia só quando algo pede)
const S = (name, title, desc, level, rec, keepIf, group) => ({ name, title, desc, level, rec, keepIf, group });
const LIST = [
  // Telemetria e diagnóstico
  S('DiagTrack', 'Telemetria (Experiências do Usuário Conectado)', 'Coleta e envia dados de uso para a Microsoft o tempo todo.', 'safe', 4, null, 'Telemetria'),
  S('dmwappushservice', 'Roteamento de mensagens WAP', 'Usado pela telemetria para receber comandos. Sem uso em PC doméstico.', 'safe', 4, null, 'Telemetria'),
  S('WerSvc', 'Relatório de Erros do Windows', 'Gera e envia relatórios de travamento.', 'safe', 4, null, 'Telemetria'),
  S('diagnosticshub.standardcollector.service', 'Coletor do Hub de Diagnósticos', 'Coleta rastreamentos para o Visual Studio/diagnósticos.', 'safe', 4, 'você depura apps com o Visual Studio', 'Telemetria'),
  S('PcaSvc', 'Assistente de Compatibilidade de Programas', 'Monitora programas antigos e sugere correções; gera atividade de fundo.', 'safe', 3, null, 'Telemetria'),
  S('WdiServiceHost', 'Host do Serviço de Diagnóstico', 'Diagnósticos automáticos do Windows.', 'cond', 3, 'você usa as solucionadoras de problemas do Windows', 'Telemetria'),
  S('WdiSystemHost', 'Host do Sistema de Diagnóstico', 'Diagnósticos automáticos do Windows.', 'cond', 3, 'você usa as solucionadoras de problemas do Windows', 'Telemetria'),
  S('TrkWks', 'Cliente de Rastreamento de Link Distribuído', 'Mantém atalhos atualizados quando arquivos mudam de lugar na rede.', 'safe', 4, null, 'Telemetria'),
  S('wisvc', 'Windows Insider', 'Só serve para quem participa do programa Insider.', 'safe', 4, 'você está no programa Windows Insider', 'Telemetria'),

  // Recursos que pouca gente usa
  S('RetailDemo', 'Modo de Demonstração de Loja', 'Modo de demonstração das lojas de varejo.', 'safe', 4, null, 'Recursos raros'),
  S('MapsBroker', 'Gerenciador de Mapas Baixados', 'Mapas offline do app Mapas.', 'safe', 4, 'você usa mapas offline', 'Recursos raros'),
  S('Fax', 'Fax', 'Envio e recebimento de fax.', 'safe', 4, null, 'Recursos raros'),
  S('PhoneSvc', 'Serviço de Telefone', 'Estado de telefonia para apps de chamada.', 'safe', 4, 'você liga pelo PC via Phone Link', 'Recursos raros'),
  S('SmsRouter', 'Roteador de SMS', 'Roteia mensagens SMS para apps.', 'safe', 4, null, 'Recursos raros'),
  S('WalletService', 'Carteira', 'Objetos de pagamento da carteira do Windows.', 'safe', 4, null, 'Recursos raros'),
  S('SEMgrSvc', 'Pagamentos e NFC', 'Elementos seguros e pagamentos por NFC.', 'safe', 4, 'seu notebook paga por aproximação', 'Recursos raros'),
  S('WpcMonSvc', 'Controle dos Pais', 'Aplica as regras do Family Safety.', 'safe', 4, 'este PC usa controle parental', 'Recursos raros'),
  S('WMPNetworkSvc', 'Compartilhamento de rede do Windows Media Player', 'Compartilha a biblioteca de mídia via UPnP.', 'safe', 4, null, 'Recursos raros'),
  S('RemoteRegistry', 'Registro Remoto', 'Permite editar o registro deste PC pela rede. Risco de segurança.', 'safe', 4, null, 'Recursos raros'),
  S('AJRouter', 'Roteador AllJoyn', 'Protocolo de IoT praticamente abandonado.', 'safe', 4, null, 'Recursos raros'),
  S('NetTcpPortSharing', 'Compartilhamento de Porta Net.Tcp', 'Usado por serviços WCF de servidor.', 'safe', 4, null, 'Recursos raros'),
  S('shpamsvc', 'Gerenciador de Contas de PC Compartilhado', 'Modo de PC compartilhado de escolas/empresas.', 'safe', 4, null, 'Recursos raros'),
  S('workfolderssvc', 'Pastas de Trabalho', 'Sincronização com servidor corporativo.', 'safe', 4, 'sua empresa usa Pastas de Trabalho', 'Recursos raros'),
  S('AxInstSV', 'Instalador de ActiveX', 'Instala controles ActiveX (tecnologia do Internet Explorer).', 'safe', 3, null, 'Recursos raros'),
  S('lfsvc', 'Geolocalização', 'Localização para apps (clima, Encontrar meu dispositivo).', 'cond', 4, 'você usa clima automático ou "Encontrar meu dispositivo"', 'Recursos raros'),
  S('icssvc', 'Hotspot Móvel', 'Compartilha a internet do PC como roteador Wi-Fi.', 'cond', 3, 'você usa o PC como hotspot', 'Recursos raros'),
  S('WwanSvc', 'Configuração Automática de WWAN', 'Modems 4G/5G internos.', 'cond', 3, 'você usa chip/modem 4G no PC', 'Recursos raros'),
  S('RmSvc', 'Gerenciamento de Rádio', 'Modo avião e rádios sem fio.', 'cond', 3, 'você usa modo avião (notebook)', 'Recursos raros'),

  // Hardware que você pode não ter
  S('Spooler', 'Spooler de Impressão', 'Fila de impressão. Também fecha a falha PrintNightmare.', 'cond', 4, 'você imprime ou usa "Imprimir para PDF"', 'Hardware'),
  S('PrintNotify', 'Notificações de Impressora', 'Avisos de extensões de impressora.', 'cond', 3, 'você usa impressora', 'Hardware'),
  S('stisvc', 'Aquisição de Imagens (WIA)', 'Scanners e algumas câmeras.', 'cond', 3, 'você usa scanner', 'Hardware'),
  S('SCardSvr', 'Cartão Inteligente', 'Leitores de smart card (e-CPF, e-CNPJ, token).', 'cond', 3, 'você usa certificado digital em token/cartão', 'Hardware'),
  S('ScDeviceEnum', 'Enumeração de Dispositivos de Cartão Inteligente', 'Detecta leitores de smart card.', 'cond', 3, 'você usa certificado digital em token/cartão', 'Hardware'),
  S('SCPolicySvc', 'Política de Remoção de Cartão Inteligente', 'Bloqueia o PC ao remover o cartão.', 'safe', 3, null, 'Hardware'),
  S('CertPropSvc', 'Propagação de Certificado', 'Copia certificados de smart cards.', 'cond', 3, 'você usa certificado digital em token/cartão', 'Hardware'),
  S('WbioSrvc', 'Biometria do Windows', 'Windows Hello por digital ou rosto.', 'cond', 3, 'você entra com digital ou reconhecimento facial', 'Hardware'),
  S('FrameServer', 'Servidor de Quadros da Câmera', 'Compartilha a webcam entre apps.', 'cond', 3, 'você usa webcam', 'Hardware'),
  S('SensorService', 'Serviço de Sensores', 'Sensores (rotação de tela, luz ambiente).', 'cond', 3, 'seu PC é notebook/tablet com rotação automática', 'Hardware'),
  S('SensrSvc', 'Monitoramento de Sensores', 'Ajusta brilho pela luz ambiente.', 'cond', 3, 'seu notebook ajusta brilho sozinho', 'Hardware'),
  S('SensorDataService', 'Dados de Sensores', 'Entrega dados de sensores para apps.', 'cond', 3, 'seu PC é notebook/tablet com sensores', 'Hardware'),

  // Rede e acesso remoto
  S('TermService', 'Serviços de Área de Trabalho Remota', 'Permite acessar ESTE PC por Área de Trabalho Remota.', 'cond', 3, 'você acessa este PC remotamente (RDP)', 'Rede e acesso remoto'),
  S('SessionEnv', 'Configuração da Área de Trabalho Remota', 'Sessões de Área de Trabalho Remota.', 'cond', 3, 'você acessa este PC remotamente (RDP)', 'Rede e acesso remoto'),
  S('UmRdpService', 'Redirecionador de Porta da Área de Trabalho Remota', 'Redireciona impressoras/drives no RDP.', 'cond', 3, 'você acessa este PC remotamente (RDP)', 'Rede e acesso remoto'),
  S('WinRM', 'Gerenciamento Remoto do Windows', 'Administração remota via PowerShell.', 'safe', 3, null, 'Rede e acesso remoto'),
  S('RasAuto', 'Conexão Automática de Acesso Remoto', 'Conecta sozinho a redes discadas/VPN antigas.', 'safe', 3, null, 'Rede e acesso remoto'),
  S('RasMan', 'Gerenciador de Conexão de Acesso Remoto', 'VPNs nativas do Windows e conexões discadas.', 'adv', 3, 'você usa VPN (muitas dependem dele)', 'Rede e acesso remoto'),
  S('lmhosts', 'Auxiliar NetBIOS do TCP/IP', 'Resolução de nomes NetBIOS em redes antigas.', 'cond', 3, 'você acessa PCs antigos da rede local pelo nome', 'Rede e acesso remoto'),
  S('LanmanServer', 'Servidor (compartilhamento de arquivos)', 'Compartilha pastas e impressoras DESTE PC na rede.', 'cond', 3, 'outros PCs acessam pastas compartilhadas deste PC', 'Rede e acesso remoto'),
  S('SharedAccess', 'Compartilhamento de Conexão com a Internet', 'Compartilha a internet via ICS.', 'cond', 3, 'você compartilha a internet deste PC', 'Rede e acesso remoto'),
  S('iphlpsvc', 'Auxiliar de IP', 'Túneis IPv6 (Teredo, 6to4) e IP-HTTPS.', 'adv', 3, 'você usa Xbox party chat, Teredo ou certas VPNs', 'Rede e acesso remoto'),
  S('wcncsvc', 'Windows Connect Now', 'Configuração WPS de redes Wi-Fi.', 'safe', 3, null, 'Rede e acesso remoto'),

  // Desempenho e busca
  S('SysMain', 'SysMain (Superfetch)', 'Pré-carrega apps na RAM. Em SSD quase não ajuda e gera uso de disco.', 'cond', 4, 'seu Windows está num HD mecânico', 'Desempenho'),
  S('WSearch', 'Windows Search (indexação)', 'Indexa arquivos para busca rápida; gera uso de disco e CPU.', 'cond', 4, 'você busca arquivos pelo Iniciar com frequência', 'Desempenho'),

  // Sincronização e apps
  S('CDPSvc', 'Plataforma de Dispositivos Conectados', 'Phone Link, compartilhamento por proximidade, área de transferência na nuvem.', 'cond', 3, 'você usa Phone Link, Nearby Share ou histórico de transferência na nuvem', 'Sincronização'),
  S('OneSyncSvc', 'Sincronização de Host', 'Sincroniza email, contatos e calendário.', 'cond', 3, 'você usa os apps Email/Calendário do Windows', 'Sincronização'),
  S('PimIndexMaintenanceSvc', 'Dados de Contatos', 'Índice de contatos para busca.', 'safe', 3, null, 'Sincronização'),
  S('MessagingService', 'Serviço de Mensagens', 'Mensagens de texto vinculadas ao celular.', 'safe', 3, null, 'Sincronização'),

  // Xbox
  S('XblAuthManager', 'Autenticação do Xbox Live', 'Login Xbox em jogos.', 'cond', 3, 'você joga títulos Xbox/Game Pass/Minecraft Bedrock/Forza', 'Xbox'),
  S('XblGameSave', 'Salvamento de Jogos Xbox Live', 'Saves na nuvem de jogos Xbox.', 'cond', 3, 'você joga títulos Xbox/Game Pass', 'Xbox'),
  S('XboxNetApiSvc', 'Rede do Xbox Live', 'Multiplayer de jogos Xbox.', 'cond', 3, 'você joga online títulos Xbox/Game Pass', 'Xbox'),
  S('XboxGipSvc', 'Gerenciamento de Acessórios Xbox', 'Atualização de firmware de controles Xbox.', 'cond', 3, 'você usa controle Xbox (o controle funciona mesmo em manual)', 'Xbox'),
  S('BcastDVRUserService', 'Gravação de jogos (Game Bar)', 'Gravação e presença da Game Bar.', 'cond', 3, 'você grava clipes com a Game Bar (Win+G)', 'Xbox'),

  // Avançado
  S('TabletInputService', 'Teclado Virtual e Painel de Manuscrito', 'Teclado touch, caneta e painel de emojis (Win+.).', 'adv', 3, 'você usa tela touch, caneta, painel de emojis ou teclados de idiomas asiáticos', 'Avançado'),
  S('seclogon', 'Logon Secundário', '"Executar como outro usuário".', 'adv', 3, 'você usa "Executar como outro usuário"', 'Avançado'),
  S('SDRSVC', 'Backup do Windows', 'Backup e restauração antigos do Windows 7.', 'safe', 3, null, 'Avançado'),
  S('TapiSrv', 'Telefonia', 'API de telefonia (modems, softphones antigos).', 'safe', 3, null, 'Avançado'),
  S('QWAVE', 'Experiência de Áudio e Vídeo de Qualidade', 'QoS para streaming em redes domésticas antigas.', 'safe', 3, null, 'Avançado'),
];

// Serviços que listas da internet mandam desligar mas que NÃO devem ser tocados
const DONT = [
  { name: 'VSS', title: 'Cópias de Sombra de Volume', why: 'Necessário para pontos de restauração e backups.' },
  { name: 'BITS', title: 'Transferência Inteligente em Segundo Plano', why: 'Windows Update, Store e Defender dependem dele.' },
  { name: 'DusmSvc', title: 'Uso de Dados', why: 'Desligar quebra o ícone e as configurações de rede em várias versões.' },
  { name: 'Audiosrv', title: 'Áudio do Windows', why: 'Sem ele não há som.' },
  { name: 'Dnscache', title: 'Cliente DNS', why: 'Protegido; desligar quebra a resolução de nomes.' },
  { name: 'BFE', title: 'Mecanismo de Filtragem Base', why: 'Firewall e VPNs dependem dele.' },
  { name: 'LanmanWorkstation', title: 'Estação de trabalho', why: 'Acesso a pastas de rede e muitos apps dependem dele.' },
  { name: 'BDESVC', title: 'BitLocker', why: 'Se algum disco estiver criptografado, desligar pode impedir o desbloqueio.' },
];

const START = { 0: 'Boot', 1: 'Sistema', 2: 'Automático', 3: 'Manual', 4: 'Desativado' };

async function list() {
  const names = LIST.map((s) => s.name);
  const r = await psJson(`$names = ConvertFrom-Json ${q(JSON.stringify(names))}
$o = @{}
foreach($n in $names){
  $k = Get-Item -LiteralPath "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$n" -ErrorAction SilentlyContinue
  if(-not $k){ continue }
  $st = $k.GetValue('Start'); $delayed = $k.GetValue('DelayedAutostart')
  $svc = Get-Service -Name $n -ErrorAction SilentlyContinue
  if(-not $svc){ $svc = Get-Service -Name ($n + '_*') -ErrorAction SilentlyContinue | Select-Object -First 1 }
  $o[$n] = @{ start=$st; delayed=[bool]$delayed; status=$(if($svc){ [string]$svc.Status } else { 'Stopped' }) }
}
ConvertTo-Json -Compress -Depth 3 $o`, { timeout: 60000 });
  const state = r.ok && r.data ? r.data : {};
  const backup = store.read('services-backup', {});
  return {
    services: LIST.filter((s) => state[s.name]).map((s) => {
      const st = state[s.name];
      return { ...s, start: st.start, startName: START[st.start] || '?', running: st.status === 'Running', optimized: st.start >= s.rec, hasBackup: s.name in backup };
    }),
    dont: DONT,
  };
}

async function apply(names) {
  const cur = await list();
  const todo = cur.services.filter((s) => names.includes(s.name) && !s.optimized);
  if (!todo.length) return { ok: true, message: 'Nada para mudar.' };
  store.update('services-backup', {}, (b) => { for (const s of todo) if (!(s.name in b)) b[s.name] = s.start; return b; });
  const r = await psJson(`$err=@()
${todo.map((s) => `try { Set-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${s.name}' -Name Start -Value ${s.rec} -Type DWord -ErrorAction Stop; ${s.rec === 4 ? `Stop-Service -Name ${q(s.name)} -Force -ErrorAction SilentlyContinue; Get-Service -Name ${q(s.name + '_*')} -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue` : '$null'} } catch { $err += ${q(s.name)} }`).join('\n')}
ConvertTo-Json -InputObject @($err) -Compress`, { timeout: 180000 });
  const errs = r.ok && Array.isArray(r.data) ? r.data : [];
  store.log('services', `Serviços otimizados: ${todo.length - errs.length}${errs.length ? ` (${errs.length} protegidos pelo Windows)` : ''}`, errs.length ? 'warning' : 'success', { type: 'services', names: todo.map((s) => s.name), action: 'revert' });
  return { ok: !errs.length, message: errs.length ? `${todo.length - errs.length} ajustados. O Windows protege: ${errs.join(', ')}.` : `${todo.length} serviço(s) ajustado(s).` };
}

// Tipo de inicialização padrão de fábrica (usado quando o serviço foi alterado fora do Velox e não há backup)
const DEFAULT_START = {
  DiagTrack: 2, WSearch: 2, SysMain: 2, Spooler: 2, TrkWks: 2, PcaSvc: 2, CDPSvc: 2, LanmanServer: 2, iphlpsvc: 2, MapsBroker: 2,
  OneSyncSvc: 2, RemoteRegistry: 4, NetTcpPortSharing: 4, shpamsvc: 4,
};

async function revert(names) {
  const backup = { ...Object.fromEntries(names.map((n) => [n, DEFAULT_START[n] ?? 3])), ...store.read('services-backup', {}) };
  const todo = names.filter((n) => n in backup);
  if (!todo.length) return { ok: false, message: 'Nada para restaurar.' };
  const r = await ps(todo.map((n) => `try { Set-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${n}' -Name Start -Value ${Number(backup[n])} -Type DWord -ErrorAction Stop; ${Number(backup[n]) === 2 ? `Start-Service -Name ${q(n)} -ErrorAction SilentlyContinue` : '$null'} } catch {}`).join(';'), { timeout: 180000 });
  store.update('services-backup', {}, (b) => { for (const n of todo) delete b[n]; return b; });
  store.log('services', `Serviços restaurados: ${todo.length}`, 'info', { type: 'services', names: todo, action: 'apply' });
  return { ok: r.ok, message: `${todo.length} serviço(s) restaurado(s) ao original.` };
}

module.exports = { list, apply, revert };
