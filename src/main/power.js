// Planos de energia: lista/ativa/exporta/importa/apaga planos do Windows e cria receitas populares da comunidade.
// As receitas são recriadas pelos próprios valores (powercfg), sem copiar arquivos .pow de terceiros.
const fs = require('fs');
const { exec } = require('./ps');
const store = require('./store');

const BUILTIN = {
  '381b4222-f694-41f0-9685-ff5bb260df2e': 'Equilibrado (Windows)',
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'Alto desempenho (Windows)',
  'a1841308-3541-4fab-bc81-f71556f20b4a': 'Economia de energia (Windows)',
  'e9a42b02-d5df-448d-aa00-03f14749eb61': 'Desempenho Máximo (modelo oculto)',
};
const GUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+\((.+?)\)(\s*\*)?\s*$/i;

const USB = ['2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226'];
const common = [
  ['SUB_PROCESSOR', 'CPMINCORES', 100], ['SUB_PROCESSOR', 'PERFBOOSTMODE', 2],
  ['SUB_PCIEXPRESS', 'ASPM', 0], [USB[0], USB[1], 0], ['SUB_DISK', 'DISKIDLE', 0],
  ['SUB_SLEEP', 'STANDBYIDLE', 0], ['SUB_SLEEP', 'HIBERNATEIDLE', 0],
];

// Receitas inspiradas nos planos mais citados na comunidade (valores próprios, documentados abaixo)
const RECIPES = [
  {
    id: 'ultimate', guid: 'f1e2d3c4-0001-4a5b-9c8d-7e6f5a4b3c21', base: 'e9a42b02-d5df-448d-aa00-03f14749eb61', name: 'Desempenho Máximo (Microsoft)',
    desc: 'O plano "Ultimate Performance" que a Microsoft esconde em PCs comuns. Remove micro-latências de gerenciamento de energia. Sem ajustes extras.',
    settings: [], tag: 'Microsoft',
  },
  {
    id: 'highest', guid: 'f1e2d3c4-0002-4a5b-9c8d-7e6f5a4b3c22', base: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'Velox Clock Máximo (estilo Bitsum Highest Performance)',
    desc: 'CPU sempre a 100% do clock (mínimo e máximo), todos os núcleos ativos, boost agressivo, sem economia no PCIe, USB e disco. Mesma ideia do plano da Bitsum. Esquenta mais em repouso.',
    settings: [['SUB_PROCESSOR', 'PROCTHROTTLEMIN', 100], ['SUB_PROCESSOR', 'PROCTHROTTLEMAX', 100], ['SUB_PROCESSOR', 'PERFINCPOL', 2], ['SUB_PROCESSOR', 'PERFDECPOL', 1], ...common], tag: 'Comunidade',
  },
  {
    id: 'latency', guid: 'f1e2d3c4-0003-4a5b-9c8d-7e6f5a4b3c23', base: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'Velox Baixa Latência (estilo planos de latência)',
    desc: 'Tudo do Clock Máximo + CPU sem estados ociosos (C-states), como os planos "low latency" populares. Latência mais firme, MAS pode reduzir o Turbo Boost em CPUs Intel sem "K" e Ryzen. Meça com o Benchmark.',
    settings: [['SUB_PROCESSOR', 'PROCTHROTTLEMIN', 100], ['SUB_PROCESSOR', 'PROCTHROTTLEMAX', 100], ['SUB_PROCESSOR', 'IDLEDISABLE', 1], ['SUB_PROCESSOR', 'PERFINCPOL', 2], ...common], tag: 'Avançado',
  },
  {
    id: 'balanced-gaming', guid: 'f1e2d3c4-0004-4a5b-9c8d-7e6f5a4b3c24', base: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Velox Equilibrado para Jogos',
    desc: 'Clock baixo em repouso (mais frio e silencioso) e boost agressivo sob carga, com todos os núcleos disponíveis e sem economia no PCIe/USB. Ver o clock baixo no Gerenciador de Tarefas em repouso é normal.',
    settings: [['SUB_PROCESSOR', 'PROCTHROTTLEMIN', 5], ['SUB_PROCESSOR', 'PROCTHROTTLEMAX', 100], ...common], tag: 'Comunidade',
  },
];

async function list() {
  // chcp 65001: o powercfg escreve na página de código do console; assim os acentos chegam certos
  const r = await exec('cmd.exe', ['/d', '/c', 'chcp 65001>nul & powercfg /list']);
  const plans = r.stdout.split(/\r?\n/).map((l) => l.match(GUID_RE)).filter(Boolean)
    .map((m) => ({ guid: m[1].toLowerCase(), name: m[2], active: !!m[3], builtin: !!BUILTIN[m[1].toLowerCase()], recipe: (RECIPES.find((x) => x.guid === m[1].toLowerCase()) || {}).id || null }));
  return { plans, recipes: RECIPES.map(({ settings, ...x }) => ({ ...x, installed: plans.some((p) => p.guid === x.guid), changes: settings.length })) };
}

async function activate(guid) {
  if (!/^[0-9a-f-]{36}$/i.test(guid)) return { ok: false, message: 'Plano inválido.' };
  const before = (await list()).plans.find((p) => p.active);
  const r = await exec('powercfg.exe', ['/setactive', guid]);
  if (r.ok) store.log('power', `Plano ativado: ${guid}`, 'success', before ? { type: 'powerplan', guid: before.guid } : null);
  return { ok: r.ok, message: r.ok ? 'Plano ativado.' : (r.stdout + r.stderr).trim() };
}

async function install(id, activateNow = true) {
  const rec = RECIPES.find((x) => x.id === id);
  if (!rec) return { ok: false, message: 'Receita desconhecida.' };
  await exec('powercfg.exe', ['/delete', rec.guid]);
  const d = await exec('powercfg.exe', ['/duplicatescheme', rec.base, rec.guid]);
  if (!d.ok) return { ok: false, message: 'O Windows não permitiu criar o plano a partir do modelo base.' };
  await exec('powercfg.exe', ['/changename', rec.guid, rec.name, rec.desc.slice(0, 200)]);
  const failed = [];
  for (const [sub, set, v] of rec.settings) {
    const a = await exec('powercfg.exe', ['/setacvalueindex', rec.guid, sub, set, String(v)]);
    await exec('powercfg.exe', ['/setdcvalueindex', rec.guid, sub, set, String(v)]);
    if (!a.ok) failed.push(set);
  }
  if (activateNow) await activate(rec.guid);
  store.log('power', `Plano criado: ${rec.name}`, failed.length ? 'warning' : 'success');
  return { ok: true, message: `"${rec.name}" criado${activateNow ? ' e ativado' : ''}.${failed.length ? ` Itens não suportados neste PC: ${failed.join(', ')}.` : ''}` };
}

async function remove(guid) {
  const all = (await list()).plans;
  const p = all.find((x) => x.guid === guid);
  if (!p) return { ok: false, message: 'Plano não encontrado.' };
  if (p.builtin) return { ok: false, message: 'Planos do Windows não podem ser apagados.' };
  if (p.active) return { ok: false, message: 'Ative outro plano antes de apagar este.' };
  const r = await exec('powercfg.exe', ['/delete', guid]);
  store.log('power', `Plano apagado: ${p.name}`, 'info');
  return { ok: r.ok, message: r.ok ? 'Plano apagado.' : (r.stdout + r.stderr).trim() };
}

async function importPow(file) {
  if (!fs.existsSync(file)) return { ok: false, message: 'Arquivo não encontrado.' };
  const r = await exec('powercfg.exe', ['-import', file]);
  const m = r.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  store.log('power', `Plano importado: ${require('path').basename(file)}`, r.ok ? 'success' : 'warning');
  return { ok: r.ok && !!m, guid: m ? m[0] : null, message: r.ok && m ? 'Plano importado.' : (r.stdout + r.stderr).trim() || 'Falha ao importar.' };
}

async function exportPow(guid, file) {
  const r = await exec('powercfg.exe', ['-export', file, guid]);
  return { ok: r.ok, message: r.ok ? `Plano exportado para ${file}` : (r.stdout + r.stderr).trim() };
}


module.exports = { list, activate, install, remove, importPow, exportPow };
