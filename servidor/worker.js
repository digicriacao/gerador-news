// Gerador de News Prudential: servidor (Cloudflare Worker)
// -----------------------------------------------------------------------------
// Faz duas coisas:
//   1. Guarda o HISTÓRICO compartilhado de news no Workers KV (binding "NEWS").
//   2. Repassa os pedidos de imagem com IA para a OpenAI e a Gemini, guardando
//      as chaves aqui (secrets), nunca no navegador.
//
// O Worker só repassa os dados: não lê nem converte imagens. Assim o consumo de
// CPU fica baixo e tudo cabe no plano gratuito da Cloudflare.
//
// Variáveis (Settings → Variables and Secrets):
//   OPENAI_API_KEY      secret  · chave da OpenAI (opcional)
//   GEMINI_API_KEY      secret  · chave da Gemini/Google AI Studio (opcional)
//   TEAM_PASSWORD       secret  · senha da equipe (recomendado)
//   OPENAI_IMAGE_MODEL  texto   · padrão: gpt-image-2
//   GEMINI_IMAGE_MODEL  texto   · padrão: gemini-3.1-flash-image
//   ALLOWED_ORIGINS     texto   · ex: https://digicriacao.github.io (padrão: *)
// Binding KV (Settings → Bindings): nome da variável "NEWS".
// -----------------------------------------------------------------------------

const DEF_OPENAI = 'gpt-image-2';
const DEF_GEMINI = 'gemini-3.1-flash-image';

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    } catch (err) {
      return json({ error: 'Erro interno no servidor: ' + (err && err.message || err) }, 500, cors);
    }
  },
};

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Team-Key,X-Meta,X-Base-Version,X-Force',
    'Access-Control-Expose-Headers': 'X-Meta',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
const err = (msg, status = 400, extra) => json({ error: msg, ...(extra || {}) }, status);

function authOk(req, env) {
  const pw = env.TEAM_PASSWORD;
  if (!pw) return true;
  const got = req.headers.get('X-Team-Key') || '';
  if (got.length !== pw.length) return false;
  let d = 0;
  for (let i = 0; i < pw.length; i++) d |= pw.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

const encMeta = (m) => encodeURIComponent(JSON.stringify(m));
const decMeta = (s) => { try { return JSON.parse(decodeURIComponent(s || '')); } catch { return null; } };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

function cleanMeta(m) {
  m = m || {};
  return {
    name: clip(m.name, 90), number: clip(m.number, 12), date: clip(m.date, 24), cards: Number(m.cards) || 0,
    titles: Array.isArray(m.titles) ? m.titles.slice(0, 3).map((t) => clip(t, 70)) : [],
    by: clip(m.by, 40), createdBy: clip(m.createdBy, 40), createdAt: m.createdAt || null, updatedAt: m.updatedAt || null,
    version: Number(m.version) || 1, deleted: m.deleted || null, thumb: !!m.thumb,
  };
}

async function readMeta(env, id) {
  const r = await env.NEWS.getWithMetadata('news:' + id, { type: 'stream' });
  if (r.value) r.value.cancel().catch(() => {});
  return r.value === null ? null : (r.metadata || {});
}

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;

  if (p === '' || p === '/' || p === '/api' || p === '/api/health') {
    return json({
      ok: true, app: 'digi-news-prudential',
      storage: !!env.NEWS, authRequired: !!env.TEAM_PASSWORD, authOk: authOk(req, env),
      providers: { openai: !!env.OPENAI_API_KEY, gemini: !!env.GEMINI_API_KEY },
      models: { openai: env.OPENAI_IMAGE_MODEL || DEF_OPENAI, gemini: env.GEMINI_IMAGE_MODEL || DEF_GEMINI },
    });
  }
  if (!p.startsWith('/api/')) return err('Rota não encontrada.', 404);
  if (!authOk(req, env)) return err('Senha da equipe incorreta ou ausente.', 401);

  // ---------------- IA ----------------
  if (p.startsWith('/api/ai/')) return proxyAI(req, env, p.slice(8));

  if (!env.NEWS) return err('O armazenamento (KV "NEWS") não está configurado no Worker.', 503);
  const KV = env.NEWS;
  const seg = p.split('/').slice(2); // ['news', id, action]

  // ---------------- imagens (endereçadas por hash) ----------------
  if (seg[0] === 'img') {
    if (m === 'POST' && seg[1] === 'missing') {
      const { hashes } = await req.json();
      const list = (Array.isArray(hashes) ? hashes : []).filter((h) => /^[a-f0-9]{64}$/.test(h)).slice(0, 200);
      const missing = [];
      await Promise.all(list.map(async (h) => {
        const r = await KV.get('img:' + h, { type: 'stream' });
        if (r) r.cancel().catch(() => {}); else missing.push(h);
      }));
      return json({ missing });
    }
    const h = seg[1];
    if (!/^[a-f0-9]{64}$/.test(h || '')) return err('Hash de imagem inválido.');
    if (m === 'PUT') { await KV.put('img:' + h, req.body); return json({ ok: true }); }
    if (m === 'GET') {
      const v = await KV.get('img:' + h, { type: 'stream' });
      if (!v) return err('Imagem não encontrada.', 404);
      return new Response(v, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
  }

  // ---------------- miniaturas ----------------
  if (seg[0] === 'thumb' && seg[1]) {
    const k = 'thumb:' + seg[1];
    if (m === 'PUT') { await KV.put(k, req.body); return json({ ok: true }); }
    if (m === 'GET') {
      const v = await KV.get(k, { type: 'stream' });
      if (!v) return err('Sem miniatura.', 404);
      return new Response(v, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' } });
    }
  }

  // ---------------- histórico ----------------
  if (seg[0] === 'news') {
    const id = seg[1];
    if (!id) {
      if (m === 'GET') {
        const trash = url.searchParams.get('trash') === '1';
        const items = []; let cursor;
        do {
          const r = await KV.list({ prefix: 'news:', cursor, limit: 1000 });
          for (const k of r.keys) {
            const meta = cleanMeta(k.metadata);
            if (!!meta.deleted === trash) items.push({ id: k.name.slice(5), ...meta });
          }
          cursor = r.list_complete ? null : r.cursor;
        } while (cursor);
        items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return json({ items });
      }
      if (m === 'POST') {
        const now = new Date().toISOString();
        const nid = newId();
        const meta = cleanMeta({ ...decMeta(req.headers.get('X-Meta')), version: 1, createdAt: now, updatedAt: now, deleted: null });
        meta.createdBy = meta.by;
        await KV.put('news:' + nid, req.body, { metadata: meta });
        return json({ id: nid, ...meta });
      }
    }
    if (!/^[a-z0-9]{6,32}$/.test(id || '')) return err('Identificador inválido.');
    const key = 'news:' + id;
    const act = seg[2] || '';

    if (m === 'GET' && !act) {
      const r = await KV.getWithMetadata(key, { type: 'stream' });
      if (r.value === null) return err('Esta news não existe mais no histórico.', 404);
      return new Response(r.value, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Meta': encMeta(cleanMeta(r.metadata)), 'Cache-Control': 'no-store' } });
    }
    if (m === 'PUT' && !act) {
      const cur = await readMeta(env, id);
      if (!cur) return err('Esta news foi apagada do histórico. Salve como nova.', 404);
      const base = Number(req.headers.get('X-Base-Version')) || 0;
      const force = req.headers.get('X-Force') === '1';
      if (!force && base && Number(cur.version) !== base) {
        req.body && req.body.cancel().catch(() => {});
        return err('Outra pessoa salvou uma versão mais nova desta news.', 409, { current: cleanMeta(cur) });
      }
      const inc = decMeta(req.headers.get('X-Meta')) || {};
      const meta = cleanMeta({ ...cur, ...inc, createdAt: cur.createdAt, createdBy: cur.createdBy, version: (Number(cur.version) || 1) + 1, updatedAt: new Date().toISOString(), deleted: null });
      await KV.put(key, req.body, { metadata: meta });
      return json({ id, ...meta });
    }
    if (m === 'POST' && (act === 'restore' || act === 'trash')) {
      const r = await KV.getWithMetadata(key, { type: 'text' });
      if (r.value === null) return err('Não encontrada.', 404);
      const meta = cleanMeta({ ...r.metadata, deleted: act === 'trash' ? new Date().toISOString() : null });
      await KV.put(key, r.value, { metadata: meta });
      return json({ id, ...meta });
    }
    if (m === 'POST' && act === 'copy') {
      const r = await KV.getWithMetadata(key, { type: 'text' });
      if (r.value === null) return err('Não encontrada.', 404);
      const inc = decMeta(req.headers.get('X-Meta')) || {};
      const now = new Date().toISOString();
      const nid = newId();
      const src = cleanMeta(r.metadata);
      const meta = cleanMeta({ ...src, name: inc.name || ('Cópia de ' + (src.name || 'news')), by: inc.by || src.by, createdBy: inc.by || src.by, version: 1, createdAt: now, updatedAt: now, deleted: null });
      await KV.put('news:' + nid, r.value, { metadata: meta });
      const th = await KV.get('thumb:' + id, { type: 'text' });
      if (th) await KV.put('thumb:' + nid, th);
      return json({ id: nid, ...meta });
    }
    if (m === 'DELETE' && !act) {
      const cur = await readMeta(env, id);
      if (!cur) return json({ ok: true });
      if (!cur.deleted) return err('Mova para a lixeira antes de apagar de vez.', 400);
      await KV.delete(key); await KV.delete('thumb:' + id);
      return json({ ok: true });
    }
  }
  return err('Rota não encontrada.', 404);
}

// ---------------- proxy de IA ----------------
async function proxyAI(req, env, sub) {
  if (req.method !== 'POST') return err('Use POST.', 405);
  const ct = req.headers.get('Content-Type') || 'application/json';
  if (sub === 'openai/generations' || sub === 'openai/edits') {
    if (!env.OPENAI_API_KEY) return err('A chave da OpenAI não está configurada no servidor.', 503);
    const up = await fetch('https://api.openai.com/v1/images/' + sub.split('/')[1], {
      method: 'POST', body: req.body, headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': ct },
    });
    return new Response(up.body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') || 'application/json' } });
  }
  if (sub === 'gemini') {
    if (!env.GEMINI_API_KEY) return err('A chave da Gemini não está configurada no servidor.', 503);
    const model = env.GEMINI_IMAGE_MODEL || DEF_GEMINI;
    const up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', body: req.body, headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    });
    return new Response(up.body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') || 'application/json' } });
  }
  return err('Rota de IA desconhecida.', 404);
}
