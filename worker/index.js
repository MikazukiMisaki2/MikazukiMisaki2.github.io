const MAX_UPLOAD_BYTES = 256 * 1024;
const DEFAULT_READ_LIMIT = 500;
const MAX_READ_LIMIT = 1000;

const CLASS_NAMES = {
  1: "精灵",
  2: "皇家护卫",
  3: "巫师",
  4: "龙族",
  5: "梦魔",
  6: "主教",
  7: "超越者",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(value, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
    },
  });
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function classId(value) {
  const number = asNumber(value);
  return Number.isInteger(number) ? number : null;
}

function className(value) {
  const id = classId(value);
  return id === null ? "未知职业" : CLASS_NAMES[id] || `职业 ${id}`;
}

function resultOf(record) {
  const value = record?.r?.v;
  if (value === "胜利" || value === "WIN" || value === "WON") return "win";
  if (value === "失败" || value === "LOSS" || value === "LOST") return "loss";
  return null;
}

function isComplete(record) {
  return record?.z === 1 && resultOf(record) !== null;
}

function outcomeBucket(key, label) {
  return { key, name: label, games: 0, wins: 0, losses: 0, turnTotal: 0 };
}

function addOutcome(bucket, record, result, turn) {
  bucket.games += 1;
  if (result === "win") bucket.wins += 1;
  if (result === "loss") bucket.losses += 1;
  if (turn !== null) bucket.turnTotal += turn;
}

function finalizeBucket(bucket) {
  return {
    ...bucket,
    winRate: bucket.games ? bucket.wins / bucket.games : null,
    averageEndingTurn: bucket.games && bucket.turnTotal ? bucket.turnTotal / bucket.games : null,
  };
}

function deckName(record) {
  const deck = record?.deck;
  if (deck && typeof deck.name === "string" && deck.name.trim()) return deck.name.trim().slice(0, 128);
  if (deck && typeof deck.k === "string" && deck.k.trim()) return `卡组 ${deck.k.slice(0, 12)}`;
  return "未命名卡组";
}

function ownClass(record) {
  return classId(record?.deck?.cl ?? record?.p?.[0]?.c);
}

function opponentClass(record) {
  return classId(record?.p?.[1]?.c);
}

function recordTimestamp(record) {
  const value = Date.parse(record?.end || record?.at || "");
  return Number.isFinite(value) ? value : null;
}

function deckGroupKey(record) {
  return `${deckName(record)}\u0000${ownClass(record) ?? "?"}`;
}

function opponentDeckKey(record) {
  const profileId = record?.opponent_deck_profile_id;
  if (typeof profileId === "string" && profileId.trim()) return `profile:${profileId.trim().slice(0, 128)}`;
  const label = record?.opponent_deck_name ?? record?.opponent_deck;
  if (typeof label === "string" && label.trim()) return `name:${label.trim().slice(0, 128)}`;
  return `class:${opponentClass(record) ?? "?"}`;
}

function opponentDeckLabel(record) {
  const label = record?.opponent_deck_name ?? record?.opponent_deck;
  if (typeof label === "string" && label.trim()) return label.trim().slice(0, 128);
  const profileId = record?.opponent_deck_profile_id;
  if (typeof profileId === "string" && profileId.trim()) return profileId.trim().slice(0, 128);
  return className(opponentClass(record));
}

function sideOf(record) {
  const value = record?.p?.[0]?.o;
  if (value === 1) return "first";
  if (value === 0) return "second";
  return null;
}

function endingTurn(record) {
  return asNumber(record?.r?.t);
}

function coreId(record) {
  return record?.self_core_card_id ?? record?.deck?.core ?? null;
}

function cardIds(record) {
  const cards = record?.deck?.c;
  if (!Array.isArray(cards)) return [];
  return cards.map((item) => Array.isArray(item) ? item[0] : null).filter((id) => id !== null && id !== undefined);
}

function mulliganIds(record) {
  const cards = record?.m?.r;
  if (!Array.isArray(cards)) return [];
  return cards.map((item) => Array.isArray(item) ? item[0] : item).filter((id) => id !== null && id !== undefined);
}

function shareOf(games, total) {
  return total ? games / total : null;
}

function cardSet(record) {
  return [...new Set(cardIds(record).map((id) => String(id)))];
}

function trendCards(records) {
  const dated = records.map(recordTimestamp).filter((value) => value !== null);
  if (!dated.length) return { recentDays: 14, recentGames: 0, previousGames: 0, cards: [] };
  const latest = Math.max(...dated);
  const day = 24 * 60 * 60 * 1000;
  const recentStart = latest - 14 * day;
  const previousStart = latest - 28 * day;
  const recentRecords = records.filter((record) => {
    const time = recordTimestamp(record);
    return time !== null && time >= recentStart && time <= latest;
  });
  const previousRecords = records.filter((record) => {
    const time = recordTimestamp(record);
    return time !== null && time >= previousStart && time < recentStart;
  });

  function collect(windowRecords) {
    const result = new Map();
    for (const record of windowRecords) {
      const resultIds = cardSet(record);
      for (const id of resultIds) {
        if (!result.has(id)) result.set(id, { cardId: id, games: 0, wins: 0, losses: 0, classIds: new Set() });
        const bucket = result.get(id);
        bucket.games += 1;
        if (resultOf(record) === "win") bucket.wins += 1;
        if (resultOf(record) === "loss") bucket.losses += 1;
        const classIdValue = ownClass(record);
        if (classIdValue !== null) bucket.classIds.add(classIdValue);
      }
    }
    return result;
  }

  const recent = collect(recentRecords);
  const previous = collect(previousRecords);
  const allIds = new Set([...recent.keys(), ...previous.keys()]);
  const cards = [...allIds].map((id) => {
    const current = recent.get(id) || { cardId: id, games: 0, wins: 0, losses: 0, classIds: new Set() };
    const before = previous.get(id) || { games: 0, wins: 0, losses: 0, classIds: new Set() };
    const recentUsageRate = shareOf(current.games, recentRecords.length);
    const previousUsageRate = shareOf(before.games, previousRecords.length);
    const usageDelta = recentUsageRate !== null && previousUsageRate !== null
      ? recentUsageRate - previousUsageRate
      : null;
    const direction = usageDelta === null
      ? (current.games ? "new" : "stable")
      : usageDelta >= 0.03 ? "rising" : usageDelta <= -0.03 ? "falling" : "stable";
    return {
      cardId: current.cardId,
      recentGames: current.games,
      previousGames: before.games,
      recentUsageRate,
      previousUsageRate,
      usageDelta,
      recentWinRate: current.games ? current.wins / current.games : null,
      previousWinRate: before.games ? before.wins / before.games : null,
      classIds: [...new Set([...current.classIds, ...before.classIds])].sort((a, b) => a - b),
      direction,
      trendScore: usageDelta === null ? current.games : Math.abs(usageDelta) * Math.sqrt(current.games),
    };
  }).sort((a, b) => (b.usageDelta ?? -2) - (a.usageDelta ?? -2) || b.recentGames - a.recentGames).slice(0, 80);
  return {
    recentDays: 14,
    recentGames: recentRecords.length,
    previousGames: previousRecords.length,
    recentFrom: new Date(recentStart).toISOString(),
    recentTo: new Date(latest).toISOString(),
    previousFrom: new Date(previousStart).toISOString(),
    previousTo: new Date(recentStart).toISOString(),
    cards,
  };
}

function sortedBuckets(map) {
  return [...map.values()].map(finalizeBucket).sort((a, b) => b.games - a.games || (b.winRate || 0) - (a.winRate || 0));
}

function coreBucket(map, value) {
  const key = String(value);
  if (!map.has(key)) map.set(key, outcomeBucket(key, `卡牌 ${key}`));
  return map.get(key);
}

function buildSummary(records, source) {
  const complete = records.filter(isComplete);
  const decks = new Map();
  const deckVariants = new Map();
  const classUsage = new Map();
  const opponents = new Map();
  const opponentDecks = new Map();
  const matchups = new Map();
  const matrixDecks = new Map();
  const matrixOpponents = new Map();
  const sides = { first: outcomeBucket("first", "先手"), second: outcomeBucket("second", "后手") };
  const cores = new Map();
  const cards = new Map();
  const mulligans = new Map();
  const turns = new Map();
  let wins = 0;
  let losses = 0;
  let turnTotal = 0;

  for (const record of complete) {
    const result = resultOf(record);
    const turn = endingTurn(record);
    const deck = deckName(record);
    const ownId = ownClass(record);
    const opponentId = opponentClass(record);
    const opponent = className(opponentId);
    const deckKey = deckGroupKey(record);
    const opponentKey = opponentDeckKey(record);
    const matchupKey = `${deckKey}\u0000${opponentKey}`;
    if (result === "win") wins += 1;
    if (result === "loss") losses += 1;
    if (turn !== null) turnTotal += turn;

    if (!decks.has(deckKey)) decks.set(deckKey, outcomeBucket(deckKey, deck));
    addOutcome(decks.get(deckKey), record, result, turn);
    decks.get(deckKey).classId = ownId;
    decks.get(deckKey).className = className(ownId);
    if (!deckVariants.has(deckKey)) deckVariants.set(deckKey, new Set());
    const variantKey = record?.deck?.k;
    if (typeof variantKey === "string" && variantKey.trim()) deckVariants.get(deckKey).add(variantKey.trim());

    const opponentClassKey = String(opponentId ?? "?");
    if (!opponents.has(opponentClassKey)) opponents.set(opponentClassKey, outcomeBucket(opponentClassKey, opponent));
    addOutcome(opponents.get(opponentClassKey), record, result, turn);
    opponents.get(opponentClassKey).classId = opponentId;

    if (!opponentDecks.has(opponentKey)) opponentDecks.set(opponentKey, outcomeBucket(opponentKey, opponentDeckLabel(record)));
    addOutcome(opponentDecks.get(opponentKey), record, result, turn);
    opponentDecks.get(opponentKey).classId = opponentId;
    opponentDecks.get(opponentKey).opponentClass = opponent;

    const ownClassKey = String(ownId ?? "?");
    if (!classUsage.has(ownClassKey)) classUsage.set(ownClassKey, outcomeBucket(ownClassKey, className(ownId)));
    addOutcome(classUsage.get(ownClassKey), record, result, turn);
    classUsage.get(ownClassKey).classId = ownId;

    if (!matchups.has(matchupKey)) matchups.set(matchupKey, outcomeBucket(matchupKey, deck));
    addOutcome(matchups.get(matchupKey), record, result, turn);
    matchups.get(matchupKey).deckKey = deckKey;
    matchups.get(matchupKey).deck = deck;
    matchups.get(matchupKey).opponentKey = opponentKey;
    matchups.get(matchupKey).opponent = opponentDeckLabel(record);
    matchups.get(matchupKey).opponentClass = opponent;
    matchups.get(matchupKey).opponentClassId = opponentId;
    matchups.get(matchupKey).ownClass = className(ownId);

    if (!matrixDecks.has(deckKey)) matrixDecks.set(deckKey, { key: deckKey, name: deck, classId: ownId, className: className(ownId), games: 0 });
    matrixDecks.get(deckKey).games += 1;
    if (!matrixOpponents.has(opponentKey)) matrixOpponents.set(opponentKey, { key: opponentKey, name: opponentDeckLabel(record), classId: opponentId, className: opponent, games: 0 });
    matrixOpponents.get(opponentKey).games += 1;

    const side = sideOf(record);
    if (side) addOutcome(sides[side], record, result, turn);

    const core = coreId(record);
    if (core !== null && core !== undefined && core !== "") addOutcome(coreBucket(cores, core), record, result, turn);

    for (const id of cardIds(record)) {
      const bucket = coreBucket(cards, id);
      addOutcome(bucket, record, result, turn);
      bucket.cardId = id;
    }
    for (const id of mulliganIds(record)) {
      const bucket = coreBucket(mulligans, id);
      addOutcome(bucket, record, result, turn);
      bucket.cardId = id;
    }
    if (turn !== null) {
      const key = String(turn);
      if (!turns.has(key)) turns.set(key, { turn, games: 0, wins: 0, losses: 0 });
      turns.get(key).games += 1;
      if (result === "win") turns.get(key).wins += 1;
      if (result === "loss") turns.get(key).losses += 1;
    }
  }

  const total = complete.length;
  const deckRows = sortedBuckets(decks).map((row) => ({
    ...row,
    usageRate: shareOf(row.games, total),
    variants: deckVariants.get(row.key)?.size || 0,
  }));
  const maxUsage = Math.max(...deckRows.map((row) => row.usageRate || 0), 0) || 1;
  const bestDecks = deckRows.map((row) => {
    const usageIndex = (row.usageRate || 0) / maxUsage;
    const winRate = row.winRate || 0;
    const balancedScore = winRate * 0.65 + usageIndex * 0.35;
    return {
      ...row,
      usageIndex,
      usageScore: usageIndex * 0.65 + winRate * 0.35,
      balancedScore,
      winScore: winRate * 0.8 + usageIndex * 0.2,
      tier: row.games < 3 ? "样本" : balancedScore >= 0.75 ? "S" : balancedScore >= 0.6 ? "A" : balancedScore >= 0.45 ? "B" : "C",
    };
  }).sort((a, b) => b.balancedScore - a.balancedScore || b.games - a.games);
  const classUsageRows = sortedBuckets(classUsage).map((row) => ({ ...row, usageRate: shareOf(row.games, total) }));
  const classWinRateRows = classUsageRows.slice().sort((a, b) => (b.winRate || 0) - (a.winRate || 0) || b.games - a.games);
  const opponentDeckRows = sortedBuckets(opponentDecks).map((row) => ({ ...row, usageRate: shareOf(row.games, total) }));
  const matchupRows = sortedBuckets(matchups).map((row) => ({ ...row, usageRate: shareOf(row.games, total) }));
  const matrixDeckRows = [...matrixDecks.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const matrixOpponentRows = [...matrixOpponents.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const matrixCells = matchupRows.map((row) => ({
    deckKey: row.deckKey,
    deck: row.deck,
    opponentKey: row.opponentKey,
    opponent: row.opponent,
    opponentClass: row.opponentClass,
    opponentClassId: row.opponentClassId,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    winRate: row.winRate,
  }));
  const trends = trendCards(complete);
  const cardsRows = sortedBuckets(cards).map((row) => ({ cardId: row.cardId, games: row.games, wins: row.wins, losses: row.losses, winRate: row.winRate })).slice(0, 40);
  const recent = complete
    .slice()
    .sort((a, b) => (recordTimestamp(b) || 0) - (recordTimestamp(a) || 0))
    .slice(0, 30)
    .map((record) => ({
      id: record.id,
      at: record.at || null,
      end: record.end || null,
      deck: deckName(record),
      opponentDeck: opponentDeckLabel(record),
      opponentClass: className(opponentClass(record)),
      opponentDeckProfileId: record.opponent_deck_profile_id ?? null,
      side: sideOf(record),
      result: resultOf(record),
      turn: endingTurn(record),
      selfCoreCardId: coreId(record),
      opponentCoreCardId: record.opponent_core_card_id ?? null,
      crChange: asNumber(record.cr_change),
    }));

  const turnsRows = [...turns.values()].sort((a, b) => a.turn - b.turn);
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    source: {
      scannedRecords: source.scannedRecords,
      validRecords: records.length,
      completeRecords: total,
      incompleteRecords: records.length - total,
      truncated: source.truncated,
    },
    overview: {
      games: total,
      wins,
      losses,
      winRate: total ? wins / total : null,
      averageEndingTurn: total && turnTotal ? turnTotal / total : null,
      totalRecords: records.length,
      side: {
        first: finalizeBucket(sides.first),
        second: finalizeBucket(sides.second),
      },
    },
    decks: deckRows,
    bestDecks,
    classUsage: classUsageRows,
    classWinRate: classWinRateRows,
    opponentClasses: sortedBuckets(opponents),
    opponentDecks: opponentDeckRows,
    matchups: matchupRows,
    matchupMatrix: {
      decks: matrixDeckRows,
      opponents: matrixOpponentRows,
      cells: matrixCells,
    },
    cores: sortedBuckets(cores).map((row) => ({ cardId: row.key, games: row.games, wins: row.wins, losses: row.losses, winRate: row.winRate })),
    cards: cardsRows,
    mulligans: sortedBuckets(mulligans).map((row) => ({ cardId: row.cardId, games: row.games, wins: row.wins, losses: row.losses, winRate: row.winRate })).slice(0, 40),
    turns: turnsRows,
    trendingCards: trends.cards,
    trendWindow: {
      recentDays: trends.recentDays,
      recentGames: trends.recentGames,
      previousGames: trends.previousGames,
      recentFrom: trends.recentFrom || null,
      recentTo: trends.recentTo || null,
      previousFrom: trends.previousFrom || null,
      previousTo: trends.previousTo || null,
    },
    recent,
  };
}

async function loadRecords(env, limit) {
  const records = [];
  let cursor;
  let scannedRecords = 0;
  let truncated = false;
  do {
    const page = await env.MATCHES.list({ prefix: "matches/", limit: Math.min(1000, limit), ...(cursor ? { cursor } : {}) });
    scannedRecords += page.objects.length;
    for (let offset = 0; offset < page.objects.length; offset += 24) {
      const batch = page.objects.slice(offset, offset + 24);
      const values = await Promise.all(batch.map(async (object) => {
        if (!object.key.endsWith(".json")) return null;
        const stored = await env.MATCHES.get(object.key);
        if (!stored) return null;
        try {
          const value = await stored.json();
          return value && typeof value === "object" ? value : null;
        } catch {
          return null;
        }
      }));
      for (const value of values) {
        if (value) records.push(value);
        if (records.length >= limit) break;
      }
      if (records.length >= limit) break;
    }
    truncated = Boolean(page.truncated) && records.length >= limit;
    cursor = page.truncated && page.cursor && records.length < limit ? page.cursor : undefined;
  } while (cursor);
  return { records, scannedRecords, truncated };
}

function parseReadLimit(url) {
  const requested = Number(url.searchParams.get("limit") || DEFAULT_READ_LIMIT);
  if (!Number.isFinite(requested)) return DEFAULT_READ_LIMIT;
  return Math.max(1, Math.min(MAX_READ_LIMIT, Math.floor(requested)));
}

async function handleUpload(request, env) {
  if (!env.UPLOAD_TOKEN) return jsonResponse({ error: "Upload is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (authorization !== `Bearer ${env.UPLOAD_TOKEN}`) return jsonResponse({ error: "Unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) return jsonResponse({ error: "Payload too large" }, 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return jsonResponse({ error: "Payload too large" }, 413);
  let record;
  try {
    record = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  if (!record || record.v !== 3 || typeof record.id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(record.id)) {
    return jsonResponse({ error: "Invalid training record" }, 400);
  }
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const key = `matches/${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${record.id}.json`;
  await env.MATCHES.put(key, JSON.stringify(record), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  return jsonResponse({ ok: true, key }, 201, "no-store");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/") return handleUpload(request, env);
    if (request.method === "GET" && (url.pathname === "/api/health" || url.pathname === "/health")) {
      return jsonResponse({ ok: true, service: "sephies-lab-upload", analysis: true }, 200, "public, max-age=30");
    }
    if (request.method === "GET" && (url.pathname === "/api/summary" || url.pathname === "/api/analysis")) {
      try {
        const loaded = await loadRecords(env, parseReadLimit(url));
        return jsonResponse(buildSummary(loaded.records, { scannedRecords: loaded.scannedRecords, truncated: loaded.truncated }), 200, "public, max-age=60, s-maxage=60");
      } catch (error) {
        return jsonResponse({ error: "Unable to read analysis data", detail: String(error?.message || error) }, 500);
      }
    }
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Sephie's Lab upload and analysis API", { status: 200, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" } });
    }
    return jsonResponse({ error: "Not found" }, 404);
  },
};
