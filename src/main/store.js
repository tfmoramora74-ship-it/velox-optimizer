// Persistência local em JSON (pasta de dados do usuário).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function dir() {
  const d = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dir(), name + '.json'), 'utf8')); }
  catch { return fallback; }
}

function write(name, value) {
  const file = path.join(dir(), name + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function update(name, fallback, fn) {
  const v = fn(read(name, fallback));
  write(name, v);
  return v;
}

// Histórico de atividades. `undo` descreve como desfazer a ação (usado pelo botão "Desfazer" do histórico).
function log(category, message, level = 'info', undo = null) {
  update('activity', [], (list) => {
    list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), category, message, level, undo });
    return list.slice(0, 500);
  });
  // Toda ação desfazível é uma mudança no sistema: marca o horário (usado para detectar Restauração do Sistema)
  if (undo) write('last-system-change', Date.now());
}

module.exports = { dir, read, write, update, log };
