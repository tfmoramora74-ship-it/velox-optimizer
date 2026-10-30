// Configurações 3D globais da NVIDIA (perfil base do driver) via NVAPI — os mesmos valores do Painel de Controle da NVIDIA.
// IDs e valores vêm do cabeçalho público NvApiDriverSettings.h (github.com/NVIDIA/nvapi). Cada mudança guarda o valor anterior.
const { ps } = require('./ps');
const store = require('./store');

const SETTINGS = [
  { key: 'power', id: 0x1057EB71, name: 'Modo de gerenciamento de energia', desc: 'Preferir desempenho máximo mantém a GPU em clock alto durante o jogo (sem demora para subir).', options: [[5, 'Ideal (padrão)'], [0, 'Adaptável'], [1, 'Preferir desempenho máximo']], rec: 1, def: 5 },
  { key: 'prerender', id: 0x007BA09E, name: 'Modo de baixa latência', desc: '"Ligado" limita a 1 quadro pré-renderizado na fila da CPU: menos input lag em jogos que não têm Reflex.', options: [[0, 'Desligado / controlado pelo app (padrão)'], [1, 'Ligado (1 quadro)']], rec: 1, def: 0 },
  { key: 'texq', id: 0x00CE2691, name: 'Filtragem de textura – qualidade', desc: 'Alto desempenho troca um pouco de nitidez em ângulos por alguns FPS.', options: [[0, 'Qualidade (padrão)'], [0xfffffff6, 'Alta qualidade'], [10, 'Desempenho'], [0x14, 'Alto desempenho']], rec: 0x14, def: 0 },
  { key: 'aniso', id: 0x00E73211, name: 'Otimização de amostra anisotrópica', desc: 'Reduz amostras de filtragem anisotrópica.', options: [[0, 'Desligada (padrão)'], [1, 'Ligada']], rec: 1, def: 0 },
  { key: 'trilin', id: 0x002ECAF2, name: 'Otimização trilinear', desc: 'Filtragem trilinear mais barata.', options: [[0, 'Desligada (padrão)'], [1, 'Ligada']], rec: 1, def: 0 },
  { key: 'thread', id: 0x20C1221E, name: 'Otimização em threads', desc: 'Usa mais núcleos da CPU para o driver em jogos OpenGL/antigos.', options: [[0, 'Automático (padrão)'], [1, 'Ligada'], [2, 'Desligada']], rec: 1, def: 0 },
  { key: 'shader', id: 0x00AC8497, name: 'Tamanho do cache de shaders', desc: 'Ilimitado evita que o driver apague shaders compilados — menos travadas ao entrar em mapas.', options: [[0x4000, 'Padrão do driver'], [0xffffffff, 'Ilimitado']], rec: 0xffffffff, def: 0x4000 },
  { key: 'refresh', id: 0x0064B541, name: 'Taxa de atualização preferida', desc: 'Garante que o jogo use a taxa máxima do monitor.', options: [[0, 'Controlada pelo app (padrão)'], [1, 'Mais alta disponível']], rec: 1, def: 0 },
  { key: 'vsync', id: 0x00A879CF, name: 'Sincronização vertical', desc: 'Forçar desligada elimina o atraso do V-Sync em todos os jogos (pode aparecer tearing).', options: [[0x60925292, 'Usar configuração do app (padrão)'], [0x08416747, 'Forçar desligada'], [0x47814940, 'Forçar ligada']], rec: null, def: 0x60925292 },
  { key: 'fps', id: 0x10835002, name: 'Limite de FPS global', desc: 'Limitar alguns FPS abaixo da taxa do monitor (ex.: 162 em 165 Hz) com G-Sync dá a menor latência sem tearing. 0 = sem limite.', type: 'number', rec: null, def: 0 },
];

const CS = `
if (-not ('VNv' -as [type])) { Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VNv {
  [DllImport("nvapi64.dll", EntryPoint="nvapi_QueryInterface", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr QI(uint id);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int D0();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DOut(out IntPtr h);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DH(IntPtr h);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DHOut(IntPtr h, out IntPtr p);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DGet(IntPtr h, IntPtr p, uint id, IntPtr s);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DSet(IntPtr h, IntPtr p, IntPtr s);
  static Delegate F(uint id, Type t) { IntPtr p = QI(id); if (p == IntPtr.Zero) throw new Exception("nvapi 0x" + id.ToString("X")); return Marshal.GetDelegateForFunctionPointer(p, t); }
  const int SZ = 12320;
  static IntPtr hS, hP;
  static void Open() {
    int r = ((D0)F(0x0150E828, typeof(D0)))(); if (r != 0) throw new Exception("init " + r);
    r = ((DOut)F(0x0694D52E, typeof(DOut)))(out hS); if (r != 0) throw new Exception("session " + r);
    r = ((DH)F(0x375DBD6B, typeof(DH)))(hS); if (r != 0) throw new Exception("load " + r);
    r = ((DHOut)F(0xDA8466A0, typeof(DHOut)))(hS, out hP); if (r != 0) throw new Exception("base " + r);
  }
  static void Close() { try { ((DH)F(0xDAD9CFF8, typeof(DH)))(hS); } catch {} }
  static void Zero(IntPtr b) { for (int i = 0; i < SZ; i += 4) Marshal.WriteInt32(b, i, 0); }
  public static string Get(uint[] ids) {
    Open(); var sb = new System.Text.StringBuilder(); IntPtr b = Marshal.AllocHGlobal(SZ);
    try { var get = (DGet)F(0x73BF8338, typeof(DGet));
      foreach (var id in ids) { Zero(b); Marshal.WriteInt32(b, 0, SZ | (1 << 16)); int r = get(hS, hP, id, b); sb.Append(id).Append(':').Append(r == 0 ? ((uint)Marshal.ReadInt32(b, 8220)).ToString() : ("x" + r)).Append(';'); }
    } finally { Marshal.FreeHGlobal(b); Close(); }
    return sb.ToString();
  }
  public static string Set(uint[] ids, uint[] vals) {
    Open(); IntPtr b = Marshal.AllocHGlobal(SZ); var sb = new System.Text.StringBuilder();
    try { var set = (DSet)F(0x577DD202, typeof(DSet));
      for (int i = 0; i < ids.Length; i++) { Zero(b); Marshal.WriteInt32(b, 0, SZ | (1 << 16)); Marshal.WriteInt32(b, 4100, (int)ids[i]); Marshal.WriteInt32(b, 4104, 0); Marshal.WriteInt32(b, 8220, unchecked((int)vals[i])); sb.Append(ids[i]).Append(':').Append(set(hS, hP, b)).Append(';'); }
      sb.Append("save:").Append(((DH)F(0xFCBC7E14, typeof(DH)))(hS));
    } finally { Marshal.FreeHGlobal(b); Close(); }
    return sb.ToString();
  }
}
"@ }
`;

const hasNvapi = () => require('fs').existsSync(`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\nvapi64.dll`);

async function read() {
  if (!hasNvapi()) return { ok: false, message: 'Driver NVIDIA não encontrado.' };
  const r = await ps(CS + `try { [VNv]::Get(@(${SETTINGS.map((s) => s.id).join(',')})) } catch { 'ERR ' + $_.Exception.Message }`);
  const out = r.stdout.trim();
  if (!out || out.startsWith('ERR')) return { ok: false, message: 'Não foi possível ler o driver NVIDIA: ' + (out || r.stderr.trim()).slice(0, 200) };
  const map = Object.fromEntries(out.split(';').filter(Boolean).map((p) => p.split(':')));
  const backup = store.read('nvidia-backup', {});
  return {
    ok: true,
    settings: SETTINGS.map((s) => {
      const raw = map[s.id];
      // -160 = NVAPI_SETTING_NOT_FOUND: o driver está usando o padrão
      const value = raw === undefined || raw.startsWith('x') ? s.def : Number(raw);
      return { ...s, value, isDefault: raw === undefined || raw.startsWith('x'), saved: String(s.id) in backup };
    }),
  };
}

async function write(changes) {
  const cur = await read();
  if (!cur.ok) return cur;
  const valid = changes.filter((c) => SETTINGS.some((s) => s.id === c.id) && Number.isFinite(Number(c.value)));
  if (!valid.length) return { ok: true, message: 'Nada para mudar.' };
  store.update('nvidia-backup', {}, (b) => { for (const c of valid) if (!(String(c.id) in b)) b[c.id] = cur.settings.find((s) => s.id === c.id).value; return b; });
  const r = await ps(CS + `try { [VNv]::Set(@(${valid.map((c) => c.id).join(',')}), [uint32[]]@(${valid.map((c) => Number(c.value) >>> 0).join(',')})) } catch { 'ERR ' + $_.Exception.Message }`);
  const out = r.stdout.trim();
  const ok = /save:0$/.test(out) && !/:-\d+;/.test(out);
  store.log('nvidia', `Configurações NVIDIA alteradas: ${valid.length}`, ok ? 'success' : 'warning', ok ? { type: 'nvidia' } : null);
  return { ok, message: ok ? `${valid.length} configuração(ões) aplicada(s). Vale ao abrir o próximo jogo.` : `O driver recusou parte das mudanças (${out.slice(0, 160)}).` };
}

async function restore() {
  const b = store.read('nvidia-backup', {});
  const ids = Object.keys(b);
  if (!ids.length) return { ok: false, message: 'Nada para restaurar.' };
  const r = await write(ids.map((id) => ({ id: Number(id), value: b[id] })));
  if (r.ok) store.write('nvidia-backup', {});
  return { ok: r.ok, message: r.ok ? 'Configurações NVIDIA restauradas.' : r.message };
}

module.exports = { read, write, restore, available: hasNvapi };
