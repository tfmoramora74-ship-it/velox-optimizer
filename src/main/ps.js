// Helpers para executar PowerShell e processos nativos.
//
// Os comandos PowerShell rodam num pequeno pool de processos persistentes: abrir um powershell.exe custa
// ~0,4 s e ~60 MB cada vez, e tipos compilados com Add-Type ficam em cache. Os processos se encerram sozinhos
// depois de alguns segundos ociosos, então o app não fica segurando memória quando não está fazendo nada.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function exec(file, args = [], { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

// Laço do processo persistente: lê "id base64(script)" por linha e devolve "id base64(json)".
// Cada script roda no próprio escopo; o fluxo de erro vira stderr (erros com SilentlyContinue não aparecem, como antes).
const HOST = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Continue'
[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine(); if ($line -eq $null) { break }
  $sp = $line.IndexOf(' '); $id = $line.Substring(0, $sp)
  $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring($sp + 1)))
  $errs = New-Object System.Collections.Generic.List[string]; $ok = $true; $out = ''
  try {
    # Texto passa intacto (JSON longo não pode ser quebrado em linhas); objetos são formatados como no console
    $parts = & ([scriptblock]::Create($code)) 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $errs.Add($_.ToString()) }
      elseif ($_ -is [string]) { $_ }
      elseif ($_ -ne $null) { ($_ | Out-String -Width 4096).TrimEnd() }
    }
    $out = (@($parts) -join [Environment]::NewLine)
  } catch { $ok = $false; $errs.Add($_.ToString()) }
  $res = @{ ok = $ok; out = [string]$out; err = ($errs -join [Environment]::NewLine) } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($id + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($res)))
  [Console]::Out.Flush()
}`;

const POOL_MAX = 2;
const IDLE_MS = 12000;
const MAX_JOBS = 60; // recicla o processo depois de N comandos para a memória não crescer
const workers = [];
const queue = [];
let seq = 0;

function newWorker() {
  const proc = spawn('powershell.exe', [...PS_ARGS, '-EncodedCommand', Buffer.from(HOST, 'utf16le').toString('base64')], { windowsHide: true });
  const w = { proc, job: null, buf: '', idleTimer: null, dead: false };
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    w.buf += chunk;
    let nl;
    while ((nl = w.buf.indexOf('\n')) >= 0) {
      const line = w.buf.slice(0, nl).trim(); w.buf = w.buf.slice(nl + 1);
      const sp = line.indexOf(' ');
      if (sp < 0 || !w.job || line.slice(0, sp) !== w.job.id) continue;
      let res;
      try { res = JSON.parse(Buffer.from(line.slice(sp + 1), 'base64').toString('utf8')); } catch { res = { ok: false, out: '', err: 'resposta inválida' }; }
      finish(w, { ok: !!res.ok, code: res.ok ? 0 : 1, stdout: res.out || '', stderr: res.err || '' });
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('exit', () => {
    w.dead = true;
    clearTimeout(w.idleTimer);
    const i = workers.indexOf(w); if (i >= 0) workers.splice(i, 1);
    if (w.job) finish(w, { ok: false, code: -1, stdout: '', stderr: 'PowerShell encerrou inesperadamente' });
    pump();
  });
  workers.push(w);
  return w;
}

function finish(w, result) {
  const job = w.job;
  if (!job) return;
  w.job = null;
  clearTimeout(job.timer);
  job.resolve(result);
  // Ocioso por um tempo (ou já usado demais) → encerra para devolver a memória
  clearTimeout(w.idleTimer);
  w.jobs = (w.jobs || 0) + 1;
  if (w.jobs >= MAX_JOBS) { w.dead = true; try { w.proc.stdin.end(); } catch {} }
  else w.idleTimer = setTimeout(() => { if (!w.job && !w.dead) w.proc.kill(); }, IDLE_MS);
  pump();
}

function pump() {
  while (queue.length) {
    let w = workers.find((x) => !x.job && !x.dead);
    if (!w && workers.length < POOL_MAX) w = newWorker();
    if (!w) return;
    const job = queue.shift();
    clearTimeout(w.idleTimer);
    w.job = job;
    job.timer = setTimeout(() => {
      // Estourou o tempo: mata o processo (o resultado sai pelo evento 'exit')
      job.timedOut = true;
      try { w.proc.kill(); } catch {}
    }, job.timeout);
    try { w.proc.stdin.write(`${job.id} ${Buffer.from(job.script, 'utf8').toString('base64')}\n`); }
    catch { finish(w, { ok: false, code: -1, stdout: '', stderr: 'falha ao enviar comando' }); }
  }
}

// Executa um script PowerShell e devolve { ok, code, stdout, stderr }.
function ps(script, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    queue.push({ id: (++seq).toString(36), script, timeout, resolve });
    pump();
  });
}

// Execução isolada num processo novo (para scripts que precisam de um console próprio).
async function psIsolated(script, { timeout = 120000 } = {}) {
  const full = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Continue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" + script;
  const file = path.join(os.tmpdir(), `velox-${process.pid}-${crypto.randomBytes(6).toString('hex')}.ps1`);
  fs.writeFileSync(file, '﻿' + full, 'utf8');
  try { return await exec('powershell.exe', [...PS_ARGS, '-File', file], { timeout }); }
  finally { fs.rm(file, { force: true }, () => {}); }
}

// Executa e interpreta a última linha JSON da saída.
async function psJson(script, opts) {
  const r = await ps(script, opts);
  const text = r.stdout.trim();
  if (!text) return { ok: false, data: null, error: r.stderr.trim() || 'sem saída' };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    const lines = text.split(/\r?\n/).filter(Boolean);
    try { return { ok: true, data: JSON.parse(lines[lines.length - 1]) }; }
    catch { return { ok: false, data: null, error: text.slice(0, 500) }; }
  }
}

// Literal seguro para strings dentro de scripts PowerShell (aspas simples).
function q(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// Processo PowerShell de longa duração (timer, monitor).
function spawnPs(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawn('powershell.exe', [...PS_ARGS, '-EncodedCommand', encoded], { windowsHide: true });
}

function shutdown() { for (const w of workers) { try { w.proc.kill(); } catch {} } }

module.exports = { exec, ps, psJson, psIsolated, q, spawnPs, shutdown };
