// Escalação — Worker único (modo "avançado" do Cloudflare Pages).
// Serve o index.html normalmente e responde a API em /api/players,
// tudo num arquivo só, pra dar pra subir por arrastar-e-soltar no
// painel do Cloudflare (sem precisar de GitHub nem linha de comando).
//
// Guarda o cadastro e o caixa no KV (nome do binding: PLAYERS_KV).
// Qualquer um pode ler (action "list"). Só quem manda a senha certa
// pode adicionar, atualizar, remover jogador ou mudar o caixa.

const ADMIN_PASSWORD = "capitao10"; // troque aqui quando quiser (veja o LEIA-ME)
const KV_KEY_PLAYERS = "players";
const KV_KEY_CASH = "cash";
const MAX_NAME_LEN = 40;
const DEFAULT_CASH_CENTS = 66520; // usado só antes do primeiro "cash_set"

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clampStars(v) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = 4;
  if (n < 1) n = 1;
  if (n > 7) n = 7;
  return n;
}

function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var equal = true;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) equal = false;
  return equal;
}

async function readPlayers(kv) {
  var raw = await kv.get(KV_KEY_PLAYERS);
  if (!raw) return [];
  try {
    var data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function writePlayers(kv, players) {
  await kv.put(KV_KEY_PLAYERS, JSON.stringify(players));
}

async function readCash(kv) {
  var raw = await kv.get(KV_KEY_CASH);
  if (!raw) return { amountCents: DEFAULT_CASH_CENTS, updatedAt: null };
  try {
    var data = JSON.parse(raw);
    if (!data || typeof data.amountCents !== "number") {
      return { amountCents: DEFAULT_CASH_CENTS, updatedAt: null };
    }
    return data;
  } catch (e) {
    return { amountCents: DEFAULT_CASH_CENTS, updatedAt: null };
  }
}

async function writeCash(kv, cash) {
  await kv.put(KV_KEY_CASH, JSON.stringify(cash));
}

async function handleApi(request, env) {
  var kv = env.PLAYERS_KV;
  if (!kv) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  var input;
  try {
    input = await request.json();
  } catch (e) {
    input = {};
  }
  var action = input && input.action ? input.action : "";

  if (action === "list") {
    var players = await readPlayers(kv);
    var cash = await readCash(kv);
    return json({ ok: true, players: players, cash: cash });
  }

  // Ativar/desativar quem vai jogar hoje é liberado pra qualquer pessoa com o
  // link (sem senha) — só isso, nada mais. Nome, estrelas, forma e remover
  // continuam exigindo a senha de admin logo abaixo.
  if (action === "set_active") {
    var players = await readPlayers(kv);
    var id = input.id ? String(input.id) : "";
    var found = false;
    players = players.map(function (p) {
      if (p.id !== id) return p;
      found = true;
      var next = Object.assign({}, p);
      next.active = !!input.active;
      return next;
    });
    if (!found) return json({ ok: false, error: "not_found" }, 404);
    await writePlayers(kv, players);
    return json({ ok: true, players: players });
  }

  var password = input && input.password ? String(input.password) : "";
  if (!timingSafeEqual(ADMIN_PASSWORD, password)) {
    return json({ ok: false, error: "unauthorized" }, 403);
  }

  if (action === "auth_check") {
    return json({ ok: true });
  }

  if (action === "add") {
    var players = await readPlayers(kv);
    var name = input.name ? String(input.name).trim().slice(0, MAX_NAME_LEN) : "";
    if (!name) return json({ ok: false, error: "invalid_name" }, 400);
    var stars = input.stars !== undefined ? clampStars(input.stars) : 4;
    var player = {
      id: "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9),
      name: name,
      stars: stars,
      active: true,
      trend: null, // "up" | "down" | null — forma recente do jogador, só admin edita
      createdAt: Date.now(),
    };
    players.push(player);
    await writePlayers(kv, players);
    return json({ ok: true, players: players });
  }

  if (action === "update") {
    var players = await readPlayers(kv);
    var id = input.id ? String(input.id) : "";
    var found = false;
    players = players.map(function (p) {
      if (p.id !== id) return p;
      found = true;
      var next = Object.assign({}, p);
      if (input.name !== undefined) {
        var n = String(input.name).trim().slice(0, MAX_NAME_LEN);
        if (n) next.name = n;
      }
      if (input.stars !== undefined) next.stars = clampStars(input.stars);
      if (input.active !== undefined) next.active = !!input.active;
      if (input.trend !== undefined) next.trend = (input.trend === "up" || input.trend === "down") ? input.trend : null;
      return next;
    });
    if (!found) return json({ ok: false, error: "not_found" }, 404);
    await writePlayers(kv, players);
    return json({ ok: true, players: players });
  }

  if (action === "remove") {
    var players = await readPlayers(kv);
    var idToRemove = input.id ? String(input.id) : "";
    players = players.filter(function (p) { return p.id !== idToRemove; });
    await writePlayers(kv, players);
    return json({ ok: true, players: players });
  }

  if (action === "cash_set") {
    var amountCents = input.amountCents;
    if (typeof amountCents !== "number" || isNaN(amountCents) || amountCents < 0) {
      return json({ ok: false, error: "invalid_amount" }, 400);
    }
    var cashData = { amountCents: Math.round(amountCents), updatedAt: Date.now() };
    await writeCash(kv, cashData);
    return json({ ok: true, cash: cashData });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    if (url.pathname === "/api/players") {
      return handleApi(request, env);
    }
    // qualquer outra rota: serve os arquivos estáticos enviados (index.html etc.)
    return env.ASSETS.fetch(request);
  },
};
