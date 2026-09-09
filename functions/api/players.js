// API da Escalação para Cloudflare Pages Functions.
// Guarda o cadastro no KV (chave "players", um JSON com a lista toda).
// Qualquer um pode ler (action "list"). Só quem manda a senha certa
// pode adicionar, atualizar ou remover.

const ADMIN_PASSWORD = "capitao10"; // troque aqui quando quiser (veja o LEIA-ME)
const KV_KEY = "players";
const CASH_KEY = "cash";
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
  if (a.length !== b.length) {
    // still compare something of equal length to avoid an obvious
    // length-based timing shortcut, then fail.
    var pad = "x".repeat(Math.abs(a.length - b.length));
    if (a.length < b.length) a += pad; else b += pad;
    var eq = true;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) eq = false;
    return false;
  }
  var equal = true;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) equal = false;
  return equal;
}

async function readPlayers(kv) {
  var raw = await kv.get(KV_KEY);
  if (!raw) return [];
  try {
    var data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function writePlayers(kv, players) {
  await kv.put(KV_KEY, JSON.stringify(players));
}

async function readCash(kv) {
  var raw = await kv.get(CASH_KEY);
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
  await kv.put(CASH_KEY, JSON.stringify(cash));
}

export async function onRequestPost(context) {
  var env = context.env;
  var kv = env.PLAYERS_KV;
  if (!kv) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  var input;
  try {
    input = await context.request.json();
  } catch (e) {
    input = {};
  }
  var action = input && input.action ? input.action : "";

  if (action === "list") {
    var players = await readPlayers(kv);
    var cash = await readCash(kv);
    return json({ ok: true, players: players, cash: cash });
  }

  var password = input && input.password ? String(input.password) : "";
  if (!timingSafeEqual(ADMIN_PASSWORD, password)) {
    return json({ ok: false, error: "unauthorized" }, 403);
  }

  if (action === "auth_check") {
    return json({ ok: true });
  }

  var players = await readPlayers(kv);

  if (action === "add") {
    var name = input.name ? String(input.name).trim().slice(0, MAX_NAME_LEN) : "";
    if (!name) return json({ ok: false, error: "invalid_name" }, 400);
    var stars = input.stars !== undefined ? clampStars(input.stars) : 4;
    var player = {
      id: "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9),
      name: name,
      stars: stars,
      active: true,
      createdAt: Date.now(),
    };
    players.push(player);
    await writePlayers(kv, players);
    return json({ ok: true, players: players });
  }

  if (action === "update") {
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
      return next;
    });
    if (!found) return json({ ok: false, error: "not_found" }, 404);
    await writePlayers(kv, players);
    return json({ ok: true, players: players });
  }

  if (action === "remove") {
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

export async function onRequestGet(context) {
  // Facilita testar no navegador direto; front-end sempre usa POST.
  var players = await readPlayers(context.env.PLAYERS_KV);
  var cash = await readCash(context.env.PLAYERS_KV);
  return json({ ok: true, players: players, cash: cash });
}
