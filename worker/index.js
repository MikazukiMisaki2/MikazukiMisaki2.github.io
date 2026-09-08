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

// Match ids and timestamps identify an upload instance, not the match
// content.  Excluding them lets an accidental re-export of the same game
// collapse to one public sample even when the client generated a new id.
const NON_CONTENT_RECORD_FIELDS = new Set([
  "id", "at", "end", "uploaded_at", "uploadedAt", "received_at", "receivedAt",
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordContent(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !NON_CONTENT_RECORD_FIELDS.has(key)),
  );
}

function recordFingerprint(record) {
  return canonicalJson(recordContent(record));
}

async function recordHash(record) {
  const bytes = new TextEncoder().encode(recordFingerprint(record));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function deduplicateRecords(records) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const record of records) {
    const fingerprint = recordFingerprint(record);
    if (seen.has(fingerprint)) {
      duplicates += 1;
      continue;
    }
    seen.add(fingerprint);
    unique.push(record);
  }
  return { records: unique, duplicates };
}

function formatKind(value) {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value)) return { 1: "rotation", 2: "unlimited" }[value] || null;
  const text = String(value).trim().toLocaleLowerCase("en-US");
  if (["2", "unlimited", "unlimit", "unlimited_mode", "无限", "无限模式"].includes(text)) return "unlimited";
  if (["1", "rotation", "rotation_mode", "轮换", "轮换模式"].includes(text)) return "rotation";
  return null;
}

function recordFormat(record) {
  const deck = record?.deck;
  const values = [];
  if (deck && typeof deck === "object") {
    values.push(deck.f, deck.format, deck.deck_format, deck.format_version, deck.formatVersion);
  }
  values.push(
    record?.deck_format,
    record?.format,
    record?.format_version,
    record?.formatVersion,
    record?.battle_format,
  );
  // ``g`` is normally the battle mode (ranked/practice).  Only an explicit
  // text label can identify it as a deck format.
  if (typeof record?.g === "string") values.push(record.g);
  for (const value of values) {
    const kind = formatKind(value);
    if (kind) return kind;
  }
  return null;
}

function isUnlimitedRecord(record) {
  return recordFormat(record) === "unlimited";
}

function resultOf(record) {
  const value = record?.r?.v;
  if (value === "胜利" || value === "WIN" || value === "WON") return "win";
  if (value === "失败" || value === "LOSS" || value === "LOST") return "loss";
  return null;
}

function oppositeResult(result) {
  if (result === "win") return "loss";
  if (result === "loss") return "win";
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

function cleanLabel(value, fallback = "未命名卡组") {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, 128) : fallback;
}

function normalizedLabel(value) {
  return cleanLabel(value, "").toLocaleLowerCase("zh-CN");
}

function deckArchetype(record) {
  const deck = record?.deck;
  return cleanLabel(
    deck?.archetype ?? deck?.a ?? deck?.group ?? deck?.type ?? deck?.deck_name ?? deck?.name
      ?? record?.deck_archetype ?? record?.deck_name,
    "未命名卡组",
  );
}

function deckName(record) {
  return deckArchetype(record);
}

function ownClass(record) {
  return classId(record?.deck?.cl ?? record?.deck?.class_id ?? record?.deck?.classId ?? record?.p?.[0]?.c);
}

function opponentClass(record) {
  return classId(record?.p?.[1]?.c);
}

function isUnknownOpponentLabel(value) {
  const label = normalizedLabel(value);
  return !label || /其他|未知|未能|无法识别|识别失败|unknown|unrecognized/.test(label);
}

function recordTimestamp(record) {
  const value = Date.parse(record?.end || record?.at || "");
  return Number.isFinite(value) ? value : null;
}

function recordCr(record) {
  const before = asNumber(record?.cr_before);
  if (Number.isInteger(before)) return before;
  const after = asNumber(record?.cr_after);
  return Number.isInteger(after) ? after : null;
}

function recordsAtLeastCr(records, minimum) {
  if (minimum === null || minimum === undefined) return records;
  return records.filter((record) => {
    const cr = recordCr(record);
    return cr !== null && cr >= minimum;
  });
}

function deckArchetypeKey(record) {
  return `archetype:${normalizedLabel(deckArchetype(record)) || "unknown"}`;
}

function deckGroupKey(record) {
  return `${deckArchetypeKey(record)}\u0000class:${ownClass(record) ?? "?"}`;
}

function namedDeckGroupKey(label, classValue) {
  return `archetype:${normalizedLabel(label) || "unknown"}\u0000class:${classValue ?? "?"}`;
}

function deckCards(record) {
  const deck = record?.deck;
  const compact = deck?.c;
  const verbose = deck?.cards;
  const cards = Array.isArray(compact) ? compact : verbose;
  const entries = Array.isArray(cards)
    ? cards
    : cards && typeof cards === "object"
      ? Object.entries(cards).map(([cardId, count]) => [cardId, count])
      : [];
  return entries
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const cardId = item[0];
        const count = asNumber(item[1]);
        return cardId === null || cardId === undefined || count === null || count <= 0 ? null : [cardId, count];
      }
      if (!item || typeof item !== "object") return null;
      const cardId = item.cardId ?? item.card_id ?? item.id ?? item.i;
      const count = asNumber(item.count ?? item.copies ?? item.n ?? item.amount);
      return cardId === null || cardId === undefined || count === null || count <= 0 ? null : [cardId, count];
    })
    .filter(Boolean)
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function deckVariantKey(record) {
  const variant = record?.deck?.k ?? record?.deck?.variant_key ?? record?.deck?.variantId;
  if (typeof variant === "string" && variant.trim()) return `variant:${variant.trim().slice(0, 128)}`;
  const cards = deckCards(record);
  if (cards.length) return `cards:${cards.map(([cardId, count]) => `${cardId}:${count}`).join(",")}`;
  return `variant:${deckGroupKey(record)}`;
}

function opponentDeckKey(record) {
  const recognized = recognizedOpponentDeckKey(record);
  if (recognized) return recognized;
  return `class:${opponentClass(record) ?? "?"}`;
}

function recognizedOpponentDeckKey(record) {
  const label = record?.opponent_deck_archetype ?? record?.opponent_deck_name ?? record?.opponent_deck
    ?? record?.opponent?.deck_archetype ?? record?.opponent?.deck_name;
  if (typeof label === "string" && label.trim() && !isUnknownOpponentLabel(label)) return `archetype:${normalizedLabel(label)}`;
  return null;
}

function opponentDeckLabel(record) {
  const label = record?.opponent_deck_archetype ?? record?.opponent_deck_name ?? record?.opponent_deck
    ?? record?.opponent?.deck_archetype ?? record?.opponent?.deck_name;
  if (typeof label === "string" && label.trim() && !isUnknownOpponentLabel(label)) return label.trim().slice(0, 128);
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
  return record?.self_core_card_id ?? record?.deck?.core ?? record?.deck?.core_card_id ?? null;
}

function addRepresentativeCoreCard(bucket, record) {
  const candidates = [coreId(record), ...deckCards(record).map(([cardId]) => cardId)];
  if (!Array.isArray(bucket.coreCardIds)) bucket.coreCardIds = [];
  for (const candidate of candidates) {
    const value = asNumber(candidate);
    if (!Number.isInteger(value) || value <= 0) continue;
    if (!bucket.coreCardIds.includes(value) && bucket.coreCardIds.length < 32) bucket.coreCardIds.push(value);
    if (bucket.coreCardId === undefined || bucket.coreCardId === null) bucket.coreCardId = value;
  }
}

function cardIds(record) {
  return deckCards(record).map((item) => item[0]).filter((id) => id !== null && id !== undefined);
}

function mulliganIds(record) {
  const cards = record?.m?.r;
  if (!Array.isArray(cards)) return [];
  return cards.map((item) => Array.isArray(item) ? item[0] : item).filter((id) => id !== null && id !== undefined);
}

function mulliganCardIds(record, key) {
  const cards = record?.m?.[key];
  if (!Array.isArray(cards)) return [];
  return cards
    .map((item) => {
      if (Array.isArray(item)) return item[0];
      if (item && typeof item === "object") return item.cardId ?? item.card_id ?? item.id;
      return item;
    })
    .map((id) => asNumber(id))
    .filter((id) => Number.isInteger(id) && id > 0);
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

function analysisBucket(key, label, metadata = {}) {
  return {
    ...outcomeBucket(key, label),
    ...metadata,
    sideBuckets: {
      first: outcomeBucket("first", "先手"),
      second: outcomeBucket("second", "后手"),
    },
  };
}

function addAnalysisOutcome(bucket, record, result, turn) {
  addOutcome(bucket, record, result, turn);
  addRepresentativeCoreCard(bucket, record);
  const side = sideOf(record);
  if (side && bucket.sideBuckets?.[side]) addOutcome(bucket.sideBuckets[side], record, result, turn);
}

function compactBucket(bucket) {
  const row = finalizeBucket(bucket);
  delete row.turnTotal;
  return row;
}

function finalizeAnalysisBucket(bucket) {
  const row = compactBucket(bucket);
  delete row.sideBuckets;
  delete row.matchups;
  delete row.opponentClasses;
  delete row.cards;
  return {
    ...row,
    side: {
      first: compactBucket(bucket.sideBuckets.first),
      second: compactBucket(bucket.sideBuckets.second),
    },
  };
}

function sortedAnalysisBuckets(map, total) {
  return [...map.values()]
    .map((bucket) => ({ ...finalizeAnalysisBucket(bucket), usageRate: shareOf(bucket.games, total) }))
    .sort((a, b) => b.games - a.games || (b.winRate || 0) - (a.winRate || 0) || String(a.name).localeCompare(String(b.name)));
}

function buildAnalysisScopes(records) {
  const maps = {
    classes: new Map(),
    decks: new Map(),
    deckClasses: new Map(),
    variants: new Map(),
  };

  for (const record of records) {
    const result = resultOf(record);
    const turn = endingTurn(record);
    const ownId = ownClass(record);
    const deckKey = deckGroupKey(record);
    const variantKey = deckVariantKey(record);
    const archetype = deckArchetype(record);
    const metadata = {
      classId: ownId,
      className: className(ownId),
      archetype,
      archetypeKey: deckArchetypeKey(record),
      deckKey,
      variantKey,
    };
    const entries = [
      ["classes", String(ownId ?? "?"), className(ownId), { classId: ownId }],
      ["decks", deckKey, archetype, metadata],
      ["deckClasses", `${String(ownId ?? "?")}\u0000${deckKey}`, archetype, metadata],
      ["variants", variantKey, archetype, metadata],
    ];
    for (const [mapName, key, label, extra] of entries) {
      const map = maps[mapName];
      if (!map.has(key)) map.set(key, analysisBucket(key, label, extra));
      addAnalysisOutcome(map.get(key), record, result, turn);
    }
  }

  const total = records.length;
  return {
    classes: sortedAnalysisBuckets(maps.classes, total),
    decks: sortedAnalysisBuckets(maps.decks, total),
    deckClasses: sortedAnalysisBuckets(maps.deckClasses, total),
    variants: sortedAnalysisBuckets(maps.variants, total),
  };
}

function buildMatchupRows(records) {
  const matchups = new Map();
  for (const record of records) {
    const result = resultOf(record);
    const turn = endingTurn(record);
    const deck = deckName(record);
    const ownId = ownClass(record);
    const opponentId = opponentClass(record);
    const opponent = className(opponentId);
    const deckKey = deckGroupKey(record);
    const opponentKey = opponentDeckKey(record);
    const matchupKey = `${deckKey}\u0000${opponentKey}`;
    if (!matchups.has(matchupKey)) matchups.set(matchupKey, outcomeBucket(matchupKey, deck));
    addOutcome(matchups.get(matchupKey), record, result, turn);
    matchups.get(matchupKey).deckKey = deckKey;
    matchups.get(matchupKey).deck = deck;
    matchups.get(matchupKey).opponentKey = opponentKey;
    matchups.get(matchupKey).opponent = opponentDeckLabel(record);
    matchups.get(matchupKey).opponentClass = opponent;
    matchups.get(matchupKey).opponentClassId = opponentId;
    matchups.get(matchupKey).ownClass = className(ownId);
  }
  return sortedBuckets(matchups).map((row) => ({
    ...row,
    usageRate: shareOf(row.games, records.length),
  }));
}

function buildMatchupMatrix(records) {
  const matrixMatchups = new Map();
  const matrixDecks = new Map();
  const matrixOpponents = new Map();
  for (const record of records) {
    const result = resultOf(record);
    const turn = endingTurn(record);
    const deck = deckName(record);
    const ownId = ownClass(record);
    const opponentId = opponentClass(record);
    const opponent = className(opponentId);
    const archetypeKey = deckArchetypeKey(record);
    const recognizedOpponentKey = recognizedOpponentDeckKey(record);
    if (!recognizedOpponentKey) continue;

    const matrixMatchupKey = `${archetypeKey}\u0000${recognizedOpponentKey}`;
    if (!matrixMatchups.has(matrixMatchupKey)) {
      matrixMatchups.set(matrixMatchupKey, {
        ...outcomeBucket(matrixMatchupKey, deck),
        deckKey: archetypeKey,
        deck,
        archetypeKey,
        opponentKey: recognizedOpponentKey,
        opponent: opponentDeckLabel(record),
        opponentClass: opponent,
        opponentClassId: opponentId,
      });
    }
    addOutcome(matrixMatchups.get(matrixMatchupKey), record, result, turn);

    if (!matrixDecks.has(archetypeKey)) {
      matrixDecks.set(archetypeKey, {
        key: archetypeKey,
        archetypeKey,
        name: deck,
        classId: ownId,
        className: className(ownId),
        games: 0,
      });
    }
    matrixDecks.get(archetypeKey).games += 1;
    if (!matrixOpponents.has(recognizedOpponentKey)) {
      matrixOpponents.set(recognizedOpponentKey, {
        key: recognizedOpponentKey,
        archetypeKey: recognizedOpponentKey,
        name: opponentDeckLabel(record),
        classId: opponentId,
        className: opponent,
        games: 0,
      });
    }
    matrixOpponents.get(recognizedOpponentKey).games += 1;
  }

  const matrixDeckRows = [...matrixDecks.values()]
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const matrixOpponentRows = [...matrixOpponents.values()]
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const matrixCells = [...matrixMatchups.values()].map((row) => ({
    ...compactBucket(row),
    deckKey: row.deckKey,
    deck: row.deck,
    archetypeKey: row.archetypeKey,
    opponentKey: row.opponentKey,
    opponent: row.opponent,
    opponentClass: row.opponentClass,
    opponentClassId: row.opponentClassId,
  }));
  return { decks: matrixDeckRows, opponents: matrixOpponentRows, cells: matrixCells };
}

function buildMulliganStats(records) {
  const buckets = new Map();
  let sampleGames = 0;
  for (const record of records) {
    const initial = mulliganCardIds(record, "i");
    if (!initial.length) continue;
    sampleGames += 1;
    const replaced = mulliganCardIds(record, "r");
    const initialCounts = new Map();
    const replacedCounts = new Map();
    for (const cardId of initial) initialCounts.set(cardId, (initialCounts.get(cardId) || 0) + 1);
    for (const cardId of replaced) replacedCounts.set(cardId, (replacedCounts.get(cardId) || 0) + 1);
    for (const [cardId, seen] of initialCounts) {
      const replacedCount = Math.min(seen, replacedCounts.get(cardId) || 0);
      if (!buckets.has(cardId)) {
        buckets.set(cardId, { cardId, games: 0, seen: 0, kept: 0, replaced: 0 });
      }
      const bucket = buckets.get(cardId);
      bucket.games += 1;
      bucket.seen += seen;
      bucket.replaced += replacedCount;
      bucket.kept += seen - replacedCount;
    }
  }
  return {
    games: sampleGames,
    cards: [...buckets.values()]
      .map((row) => ({
        ...row,
        retainRate: row.seen ? row.kept / row.seen : null,
        replaceRate: row.seen ? row.replaced / row.seen : null,
      }))
      .sort((a, b) => b.seen - a.seen || (b.retainRate || 0) - (a.retainRate || 0) || String(a.cardId).localeCompare(String(b.cardId))),
  };
}

function buildDeckCatalog(records, total) {
  const typeBuckets = new Map();
  const variantBuckets = new Map();
  const typeVariants = new Map();

  for (const record of records) {
    const result = resultOf(record);
    const turn = endingTurn(record);
    const typeKey = deckGroupKey(record);
    const variantKey = deckVariantKey(record);
    const archetype = deckArchetype(record);
    const ownId = ownClass(record);
    const metadata = {
      classId: ownId,
      className: className(ownId),
      archetype,
      archetypeKey: deckArchetypeKey(record),
      deckKey: typeKey,
      variantKey,
    };

    if (!typeBuckets.has(typeKey)) typeBuckets.set(typeKey, analysisBucket(typeKey, archetype, metadata));
    addAnalysisOutcome(typeBuckets.get(typeKey), record, result, turn);
    if (!typeVariants.has(typeKey)) typeVariants.set(typeKey, new Set());
    typeVariants.get(typeKey).add(variantKey);

    if (!variantBuckets.has(variantKey)) {
      variantBuckets.set(variantKey, {
        ...analysisBucket(variantKey, archetype, metadata),
        cards: deckCards(record),
        matchups: new Map(),
        opponentClasses: new Map(),
      });
    }
    const variant = variantBuckets.get(variantKey);
    addAnalysisOutcome(variant, record, result, turn);
    // A variant may have older records without a deck snapshot.  Keep the
    // first non-empty composition so one incomplete upload does not hide the
    // deck list for every later record of the same build.
    if (!variant.cards.length) {
      const cards = deckCards(record);
      if (cards.length) variant.cards = cards;
    }

    const opponentKey = opponentDeckKey(record);
    const matchupKey = `${variantKey}\u0000${opponentKey}`;
    if (!variant.matchups.has(matchupKey)) {
      variant.matchups.set(matchupKey, {
        ...outcomeBucket(matchupKey, opponentDeckLabel(record)),
        opponentKey,
        opponent: opponentDeckLabel(record),
        opponentClass: className(opponentClass(record)),
        opponentClassId: opponentClass(record),
      });
    }
    addOutcome(variant.matchups.get(matchupKey), record, result, turn);

    const opponentClassKey = String(opponentClass(record) ?? "?");
    if (!variant.opponentClasses.has(opponentClassKey)) {
      variant.opponentClasses.set(opponentClassKey, {
        ...outcomeBucket(opponentClassKey, className(opponentClass(record))),
        classId: opponentClass(record),
      });
    }
    addOutcome(variant.opponentClasses.get(opponentClassKey), record, result, turn);
  }

  const variantRows = new Map();
  for (const [typeKey, variantKeys] of typeVariants) {
    const orderedKeys = [...variantKeys].sort((left, right) => {
      const a = variantBuckets.get(left);
      const b = variantBuckets.get(right);
      return b.games - a.games || String(left).localeCompare(String(right));
    });
    orderedKeys.forEach((variantKey, index) => {
      const bucket = variantBuckets.get(variantKey);
      const row = finalizeAnalysisBucket(bucket);
      const variantMatchups = [...bucket.matchups.values()]
        .map(compactBucket)
        .sort((a, b) => b.games - a.games || (b.winRate || 0) - (a.winRate || 0));
      const opponentClasses = [...bucket.opponentClasses.values()]
        .map(compactBucket)
        .sort((a, b) => b.games - a.games || (b.winRate || 0) - (a.winRate || 0));
      variantRows.set(variantKey, {
        ...row,
        label: orderedKeys.length === 1 ? "默认构筑" : `构筑 ${index + 1}`,
        cards: bucket.cards,
        matchups: variantMatchups,
        opponentClasses,
      });
    });
  }

  const types = [...typeBuckets.values()]
    .map((bucket) => {
      const row = finalizeAnalysisBucket(bucket);
      const variants = [...(typeVariants.get(bucket.key) || [])]
        .map((key) => variantRows.get(key))
        .filter(Boolean)
        .map((variant) => ({
          key: variant.key,
          label: variant.label,
          games: variant.games,
          wins: variant.wins,
          losses: variant.losses,
          winRate: variant.winRate,
        }))
        .sort((a, b) => b.games - a.games || String(a.label).localeCompare(String(b.label)));
      return {
        ...row,
        usageRate: shareOf(row.games, total),
        variantCount: variants.length,
        variants,
      };
    })
    .sort((a, b) => b.games - a.games || (b.winRate || 0) - (a.winRate || 0));

  return { types, variants: [...variantRows.values()] };
}

function buildAnalysisView(records) {
  return {
    games: records.length,
    analysisScopes: buildAnalysisScopes(records),
    deckCatalog: buildDeckCatalog(records, records.length),
    matchups: buildMatchupRows(records),
    matchupMatrix: buildMatchupMatrix(records),
  };
}

function buildSummary(records, source) {
  const inputRecords = Array.isArray(records) ? records : [];
  const eligibleRecords = inputRecords.filter((record) => !isUnlimitedRecord(record));
  const unlimitedRecords = inputRecords.length - eligibleRecords.length;
  const deduplicated = deduplicateRecords(eligibleRecords);
  // Keep this second guard in the summary builder as well as in R2 loading:
  // it protects direct callers and future import paths from reintroducing
  // duplicate or Unlimited records into public statistics.
  records = deduplicated.records;
  const sourceInfo = source || {};
  const complete = records.filter(isComplete);
  const decks = new Map();
  const deckVariants = new Map();
  const classUsage = new Map();
  const communityDecks = new Map();
  const communityClasses = new Map();
  const opponents = new Map();
  const opponentDecks = new Map();
  const matchups = new Map();
  const matrixMatchups = new Map();
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
  let communityDeckTotal = 0;
  let communityClassTotal = 0;

  for (const record of complete) {
    const result = resultOf(record);
    const turn = endingTurn(record);
    const deck = deckName(record);
    const ownId = ownClass(record);
    const opponentId = opponentClass(record);
    const opponent = className(opponentId);
    const deckKey = deckGroupKey(record);
    const archetypeKey = deckArchetypeKey(record);
    const opponentKey = opponentDeckKey(record);
    const recognizedOpponentKey = recognizedOpponentDeckKey(record);
    const matchupKey = `${deckKey}\u0000${opponentKey}`;
    if (result === "win") wins += 1;
    if (result === "loss") losses += 1;
    if (turn !== null) turnTotal += turn;

    if (!decks.has(deckKey)) decks.set(deckKey, outcomeBucket(deckKey, deck));
    addOutcome(decks.get(deckKey), record, result, turn);
    addRepresentativeCoreCard(decks.get(deckKey), record);
    decks.get(deckKey).classId = ownId;
    decks.get(deckKey).className = className(ownId);
    decks.get(deckKey).archetype = deck;
    decks.get(deckKey).archetypeKey = archetypeKey;
    if (!deckVariants.has(deckKey)) deckVariants.set(deckKey, new Set());
    deckVariants.get(deckKey).add(deckVariantKey(record));

    // Community meta statistics treat each side of a recognized match as a
    // separate deck/class appearance. The uploader's result is kept for the
    // uploader deck and inverted for the opponent deck/class.
    if (!communityDecks.has(deckKey)) communityDecks.set(deckKey, outcomeBucket(deckKey, deck));
    addOutcome(communityDecks.get(deckKey), record, result, turn);
    addRepresentativeCoreCard(communityDecks.get(deckKey), record);
    communityDecks.get(deckKey).classId = ownId;
    communityDecks.get(deckKey).className = className(ownId);
    communityDecks.get(deckKey).archetype = deck;
    communityDecks.get(deckKey).archetypeKey = archetypeKey;
    communityDeckTotal += 1;

    const opponentClassKey = String(opponentId ?? "?");
    if (!opponents.has(opponentClassKey)) opponents.set(opponentClassKey, outcomeBucket(opponentClassKey, opponent));
    addOutcome(opponents.get(opponentClassKey), record, oppositeResult(result), turn);
    opponents.get(opponentClassKey).classId = opponentId;

    if (!opponentDecks.has(opponentKey)) opponentDecks.set(opponentKey, outcomeBucket(opponentKey, opponentDeckLabel(record)));
    addOutcome(opponentDecks.get(opponentKey), record, oppositeResult(result), turn);
    opponentDecks.get(opponentKey).classId = opponentId;
    opponentDecks.get(opponentKey).opponentClass = opponent;

    if (ownId !== null) {
      const ownClassKey = String(ownId);
      if (!communityClasses.has(ownClassKey)) communityClasses.set(ownClassKey, outcomeBucket(ownClassKey, className(ownId)));
      addOutcome(communityClasses.get(ownClassKey), record, result, turn);
      communityClasses.get(ownClassKey).classId = ownId;
      communityClassTotal += 1;
    }
    if (opponentId !== null) {
      const opponentCommunityKey = String(opponentId);
      if (!communityClasses.has(opponentCommunityKey)) communityClasses.set(opponentCommunityKey, outcomeBucket(opponentCommunityKey, opponent));
      addOutcome(communityClasses.get(opponentCommunityKey), record, oppositeResult(result), turn);
      communityClasses.get(opponentCommunityKey).classId = opponentId;
      communityClassTotal += 1;
    }

    if (recognizedOpponentKey) {
      const opponentCommunityDeckKey = namedDeckGroupKey(opponentDeckLabel(record), opponentId);
      if (!communityDecks.has(opponentCommunityDeckKey)) communityDecks.set(opponentCommunityDeckKey, outcomeBucket(opponentCommunityDeckKey, opponentDeckLabel(record)));
      const opponentCommunityDeck = communityDecks.get(opponentCommunityDeckKey);
      addOutcome(opponentCommunityDeck, record, oppositeResult(result), turn);
      opponentCommunityDeck.classId = opponentId;
      opponentCommunityDeck.className = opponent;
      opponentCommunityDeck.archetype = opponentDeckLabel(record);
      opponentCommunityDeck.archetypeKey = recognizedOpponentKey;
      if (record.opponent_core_card_id !== null && record.opponent_core_card_id !== undefined) {
        const opponentCoreId = asNumber(record.opponent_core_card_id);
        if (Number.isInteger(opponentCoreId) && opponentCoreId > 0) {
          if (!Array.isArray(opponentCommunityDeck.coreCardIds)) opponentCommunityDeck.coreCardIds = [];
          if (!opponentCommunityDeck.coreCardIds.includes(opponentCoreId) && opponentCommunityDeck.coreCardIds.length < 32) opponentCommunityDeck.coreCardIds.push(opponentCoreId);
          if (opponentCommunityDeck.coreCardId === undefined || opponentCommunityDeck.coreCardId === null) opponentCommunityDeck.coreCardId = opponentCoreId;
        }
      }
      communityDeckTotal += 1;
    }

    const ownClassKey = String(ownId ?? "?");
    if (!classUsage.has(ownClassKey)) classUsage.set(ownClassKey, outcomeBucket(ownClassKey, className(ownId)));
    addOutcome(classUsage.get(ownClassKey), record, result, turn);
    addRepresentativeCoreCard(classUsage.get(ownClassKey), record);
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

    // The matrix is intentionally stricter than the general matchup report:
    // an unidentified opponent deck must not become a fake class column.
    if (recognizedOpponentKey) {
      const matrixMatchupKey = `${archetypeKey}\u0000${recognizedOpponentKey}`;
      if (!matrixMatchups.has(matrixMatchupKey)) {
        matrixMatchups.set(matrixMatchupKey, {
          ...outcomeBucket(matrixMatchupKey, deck),
          deckKey: archetypeKey,
          deck: deck,
          archetypeKey,
          opponentKey: recognizedOpponentKey,
          opponent: opponentDeckLabel(record),
          opponentClass: opponent,
          opponentClassId: opponentId,
        });
      }
      addOutcome(matrixMatchups.get(matrixMatchupKey), record, result, turn);

      if (!matrixDecks.has(archetypeKey)) matrixDecks.set(archetypeKey, { key: archetypeKey, archetypeKey, name: deck, classId: ownId, className: className(ownId), games: 0 });
      matrixDecks.get(archetypeKey).games += 1;
      if (!matrixOpponents.has(recognizedOpponentKey)) matrixOpponents.set(recognizedOpponentKey, { key: recognizedOpponentKey, archetypeKey: recognizedOpponentKey, name: opponentDeckLabel(record), classId: opponentId, className: opponent, games: 0 });
      matrixOpponents.get(recognizedOpponentKey).games += 1;
    }

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
  const communityDeckRows = sortedBuckets(communityDecks).map((row) => ({
    ...row,
    usageRate: shareOf(row.games, communityDeckTotal),
  }));
  const maxUsage = Math.max(...communityDeckRows.map((row) => row.usageRate || 0), 0) || 1;
  const bestDecks = communityDeckRows.map((row) => {
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
  const communityClassUsageRows = sortedBuckets(communityClasses).map((row) => ({ ...row, usageRate: shareOf(row.games, communityClassTotal) }));
  const communityClassWinRateRows = communityClassUsageRows.slice().sort((a, b) => (b.winRate || 0) - (a.winRate || 0) || b.games - a.games);
  const opponentDeckRows = sortedBuckets(opponentDecks).map((row) => ({ ...row, usageRate: shareOf(row.games, total) }));
  const matchupRows = sortedBuckets(matchups).map((row) => ({ ...row, usageRate: shareOf(row.games, total) }));
  const matrixDeckRows = [...matrixDecks.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const matrixOpponentRows = [...matrixOpponents.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const matrixCells = [...matrixMatchups.values()].map((row) => ({
    ...compactBucket(row),
    deckKey: row.deckKey,
    deck: row.deck,
    archetypeKey: row.archetypeKey,
    opponentKey: row.opponentKey,
    opponent: row.opponent,
    opponentClass: row.opponentClass,
    opponentClassId: row.opponentClassId,
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
  const analysisScopes = buildAnalysisScopes(complete);
  const deckCatalog = buildDeckCatalog(complete, total);
  const mulliganStats = buildMulliganStats(complete);
  const analysisByCr = Object.fromEntries(
    [["1650", 1650], ["1850", 1850]].map(([key, minimum]) => {
      const filtered = recordsAtLeastCr(complete, minimum);
      return [key, { crMinimum: minimum, ...buildAnalysisView(filtered) }];
    }),
  );
  return {
    schema: 2,
    generatedAt: new Date().toISOString(),
    source: {
      scannedRecords: sourceInfo.scannedRecords,
      validRecords: records.length,
      completeRecords: total,
      incompleteRecords: records.length - total,
      duplicateRecords: Number(sourceInfo.duplicateRecords || 0) + deduplicated.duplicates,
      unlimitedRecords: Number(sourceInfo.unlimitedRecords || 0) + unlimitedRecords,
      truncated: sourceInfo.truncated,
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
    deckCatalog,
    analysisScopes,
    classUsage: classUsageRows,
    classWinRate: classWinRateRows,
    communityDecks: communityDeckRows,
    communityDeckWinRate: communityDeckRows,
    communityDeckTotal,
    communityClassUsage: communityClassUsageRows,
    communityClassWinRate: communityClassWinRateRows,
    communityClassTotal,
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
    mulliganStats,
    analysisByCr,
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
  const seenFingerprints = new Set();
  let cursor;
  let scannedRecords = 0;
  let duplicateRecords = 0;
  let unlimitedRecords = 0;
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
        if (value) {
          if (isUnlimitedRecord(value)) {
            unlimitedRecords += 1;
            continue;
          }
          const fingerprint = recordFingerprint(value);
          if (seenFingerprints.has(fingerprint)) {
            duplicateRecords += 1;
            continue;
          }
          seenFingerprints.add(fingerprint);
          records.push(value);
        }
        if (records.length >= limit) break;
      }
      if (records.length >= limit) break;
    }
    truncated = Boolean(page.truncated) && records.length >= limit;
    cursor = page.truncated && page.cursor && records.length < limit ? page.cursor : undefined;
  } while (cursor);
  return { records, scannedRecords, duplicateRecords, unlimitedRecords, truncated };
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
  if (isUnlimitedRecord(record)) {
    // Treat this as an accepted no-op so an older client queue cannot retry
    // an out-of-scope match forever.  No Unlimited record is written to R2.
    return jsonResponse({ ok: true, skipped: true, reason: "unlimited" }, 200, "no-store");
  }
  const hash = await recordHash(record);
  // New writes are content-addressed.  Re-uploading the same match (even
  // with a new client id or timestamp) therefore addresses the same R2 object
  // instead of creating another public sample.
  const key = `matches/dedup/${hash}.json`;
  const existing = typeof env.MATCHES.head === "function" ? await env.MATCHES.head(key) : null;
  if (existing) return jsonResponse({ ok: true, duplicate: true, key }, 200, "no-store");
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
        return jsonResponse(buildSummary(loaded.records, {
          scannedRecords: loaded.scannedRecords,
          duplicateRecords: loaded.duplicateRecords,
          unlimitedRecords: loaded.unlimitedRecords,
          truncated: loaded.truncated,
        }), 200, "public, max-age=60, s-maxage=60");
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
