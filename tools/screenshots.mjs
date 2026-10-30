// Gera as capturas de tela do README em docs/screenshots.
// Roda o app em modo seguro (VELOX_SAFE=1: nenhuma ação automática no sistema) e com uma pasta de dados
// temporária e vazia, para não misturar histórico pessoal nas imagens.
//   node tools/screenshots.mjs [pagina:esperaMs ...]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'screenshots');
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['dashboard:15000', 'boost:9000', 'tweaks:10000', 'gamemode:4000', 'network:8000', 'nvidia:5000', 'power:4000', 'benchmark:4000'];
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'velox-shots-'));
fs.mkdirSync(out, { recursive: true });

const PORT = 9335;
const proc = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), [root, `--remote-debugging-port=${PORT}`], {
  stdio: 'ignore', env: { ...process.env, VELOX_SAFE: '1', VELOX_USERDATA: userData },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(500);
}
if (!ws) { console.error('O app não abriu.'); process.exit(1); }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
});
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cmd('Runtime.enable'); await cmd('Page.enable');
await sleep(4000);
for (const p of pages) {
  const [name, wait] = p.split(':');
  await cmd('Runtime.evaluate', { expression: `location.hash='${name}'` });
  await sleep(Number(wait || 6000));
  const r = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log('ok', name);
}
try { execFileSync('taskkill', ['/f', '/t', '/pid', String(proc.pid)], { stdio: 'ignore' }); } catch {}
fs.rmSync(userData, { recursive: true, force: true });
if (errors.length) { console.error('Erros no console:', errors); process.exit(1); }
process.exit(0);
