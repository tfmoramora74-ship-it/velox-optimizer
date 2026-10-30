const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const CHANNELS = [
  'auto:get', 'auto:set', 'auto:runNow', 'app:info','setup:export', 'setup:open', 'setup:importBasics','app:relaunchAdmin', 'win:minimize', 'win:maximize', 'win:close', 'shell:open', 'shell:openPath',
  'settings:get', 'settings:set', 'hw:detect', 'hw:bios', 'monitor:sample', 'activity:list', 'activity:clear', 'activity:undo',
  'system:restorePoint', 'system:processes', 'system:restart',
  'tweaks:catalog', 'tweaks:status', 'tweaks:apply', 'tweaks:revert', 'tweaks:applyMany', 'tweaks:revertAll', 'tweaks:recommendations', 'tweaks:drift', 'tweaks:driftCached',
  'memory:counters', 'memory:clean', 'timer:enable', 'timer:disable', 'timer:status',
  'gamemode:state', 'gamemode:start', 'gamemode:stop', 'gamemode:options', 'gamemode:games',
  'net:adapters', 'net:providers', 'net:benchmark', 'net:lastBenchmark', 'net:applyDns', 'net:restoreDns', 'net:ping', 'net:repair',
  'net:dohState', 'net:dohSet',
  'net:monStart', 'net:monStop', 'net:monActive',
  'net:nicProps', 'net:nicApply', 'net:nicRevert', 'net:tcpState', 'net:tcpApply', 'net:qosList', 'net:qosApply', 'net:qosRemove', 'timer:measure', 'memory:autoGet', 'memory:autoSet',
  'maint:points', 'maint:enable', 'maint:delete', 'maint:restore', 'maint:repairs', 'maint:repair',
  'svc:list', 'svc:apply', 'svc:revert',
  'cleaner:scan', 'cleaner:clean', 'startup:list', 'startup:set',
  'apps:list', 'apps:apply', 'apps:revert', 'apps:clearCache',
  'uninst:list', 'uninst:icon', 'uninst:run', 'uninst:leftovers', 'uninst:remove', 'uninst:openGeek', 'uninst:pickGeek',
  'lib:scan', 'report:save', 'nv:read', 'nv:write', 'nv:restore', 'nv:available',
  'pw:list', 'pw:activate', 'pw:install', 'pw:remove', 'pw:import', 'pw:export',
  'wg:list', 'wg:install',
  'boot:check', 'boot:disarm', 'safety:notices', 'safety:dismiss', 'safety:revertVideo',
  'dev:list', 'dev:msi', 'dev:affinity', 'dev:restore',
  'prof:list', 'prof:save', 'prof:remove', 'prof:pickExe',
  'bench:run', 'bench:list', 'bench:remove',
  'fps:status', 'fps:pickExe', 'fps:start', 'fps:stop', 'fps:live',
];

const api = {};
for (const ch of CHANNELS) {
  const [ns, fn] = ch.split(':');
  (api[ns] = api[ns] || {})[fn] = call(ch);
}
api.on = (ch, cb) => {
  if (!['progress', 'gamemode', 'drift', 'navigate', 'pingSample', 'video', 'restored'].includes(ch)) return () => {};
  const l = (_e, d) => cb(d);
  ipcRenderer.on(ch, l);
  return () => ipcRenderer.removeListener(ch, l);
};

contextBridge.exposeInMainWorld('velox', api);
