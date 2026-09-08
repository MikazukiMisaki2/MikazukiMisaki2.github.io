const API_BASE = "https://sephies-lab-upload.mikazukimisakijp.workers.dev";
const SUMMARY_URL = `${API_BASE}/api/summary?limit=1000`;
const CARD_NAMES_URL = "./card-names.json";
const CORE_CARD_ART_URL = "./assets/core-card-art.json";

let cardNames = Object.create(null);
let coreCardArt = Object.create(null);
let currentData = null;
let metaSort = "balancedScore";
let trendClass = "";
let selectedClass = "";
let selectedDeck = "";
let selectedVariant = "";
let selectedCr = "all";

const CLASS_NAMES = Object.freeze({
  1: "精灵",
  2: "皇家护卫",
  3: "巫师",
  4: "龙族",
  5: "梦魔",
  6: "主教",
  7: "超越者",
});

const CLASS_GLYPHS = Object.freeze({
  1: "◒",
  2: "♛",
  3: "✥",
  4: "♞",
  5: "☽",
  6: "♜",
  7: "◉",
});

const CLASS_COLORS = Object.freeze({
  1: "#439159",
  2: "#797b1b",
  3: "#535fa3",
  4: "#a05a12",
  5: "#8d1e41",
  6: "#b0a98d",
  7: "#5bcce3",
});

const CHART_COLORS = Object.freeze([
  "#f6c344", "#58c27d", "#7f9bea", "#e88a42", "#d982d8",
  "#5bcce3", "#ec6d91", "#b5c5d2", "#f0a05a", "#a9b9ff",
]);

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cardName(cardId) {
  const rawId = String(cardId ?? "");
  if (cardNames[rawId]) return cardNames[rawId];
  const numericId = Number(rawId);
  if (Number.isFinite(numericId)) {
    const baseId = String(Math.floor(numericId / 10) * 10);
    if (cardNames[baseId]) return cardNames[baseId];
  }
  const variantId = rawId.replace(/@\d+$/, "");
  return cardNames[variantId] || "未知卡牌";
}

function coreCardArtKey(cardId) {
  const rawId = String(cardId ?? "").trim();
  return rawId.length === 9 && rawId.endsWith("0") ? rawId.slice(0, -1) : rawId;
}

function coreCardArtUrl(cardId) {
  const candidates = Array.isArray(cardId) ? cardId : [cardId];
  for (const candidate of candidates) {
    const key = coreCardArtKey(candidate);
    if (key && typeof coreCardArt[key] === "string" && coreCardArt[key]) return coreCardArt[key];
  }
  return "";
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function number(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function safeWidth(value) {
  const normalized = Math.max(0, Math.min(100, Number(value || 0) * 100));
  return `${normalized.toFixed(1)}%`;
}

function deltaPoints(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const points = Number(value) * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}pp`;
}

function usageRate(row, data) {
  if (row?.usageRate !== null && row?.usageRate !== undefined) return Number(row.usageRate);
  const total = Number(data?.overview?.games || 0);
  return total ? Number(row?.games || 0) / total : null;
}

function classLabel(classId) {
  return CLASS_NAMES[String(classId)] || `职业 ${classId}`;
}

function analysisCrLabel() {
  if (selectedCr === "1650") return "对局开始 CR ≥ 1650";
  if (selectedCr === "1850") return "对局开始 CR ≥ 1850";
  return "全部 CR";
}

function activeAnalysisData(data) {
  if (!data || selectedCr === "all") return data;
  const view = data.analysisByCr?.[selectedCr];
  return view ? { ...data, ...view } : data;
}

function classIconUrl(classId) {
  const id = String(classId ?? "");
  return CLASS_NAMES[id] ? `assets/class-${id}.svg` : "";
}

function chartColor(row, index, kind) {
  if (kind === "class" && row?.classId !== null && row?.classId !== undefined) {
    return CLASS_COLORS[String(row.classId)] || CHART_COLORS[index % CHART_COLORS.length];
  }
  return CHART_COLORS[index % CHART_COLORS.length];
}

function usageMarker(row, index, kind) {
  const color = chartColor(row, index, kind);
  const glyph = kind === "class"
    ? CLASS_GLYPHS[String(row?.classId)] || "?"
    : "◆";
  const iconUrl = kind === "class" ? classIconUrl(row?.classId) : "";
  const artUrl = coreCardArtUrl(row?.coreCardIds || row?.coreCardId);
  const content = artUrl
    ? `<img class="usage-marker-art" src="${escapeHtml(artUrl)}" alt="">`
    : iconUrl
      ? `<img src="${iconUrl}" alt="">`
      : escapeHtml(glyph);
  return `<span class="usage-marker ${kind === "class" ? "usage-marker-class" : "usage-marker-deck"}" style="--marker-color:${color}" aria-hidden="true">${content}</span>`;
}

function winRateColor(rate, games) {
  if (!games) return "#dfe6eb";
  const value = Math.max(0, Math.min(100, Number(rate || 0) * 100));
  const red = [226, 75, 75];
  const yellow = [230, 189, 63];
  const green = [67, 166, 83];
  const start = value <= 50 ? red : yellow;
  const end = value <= 50 ? yellow : green;
  const amount = value <= 50 ? Math.max(0, Math.min(1, (value - 30) / 20)) : Math.max(0, Math.min(1, (value - 50) / 20));
  const channels = start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount));
  return `rgb(${channels.join(",")})`;
}

function tierLabel(value) {
  const text = String(value || "—");
  const classKey = text === "S" || text === "A" || text === "B" || text === "C" ? text.toLowerCase() : "sample";
  return `<span class="tier tier-${classKey}">${escapeHtml(text)}</span>`;
}

function trendLabel(value) {
  if (value === "rising") return '<span class="trend-up">上升</span>';
  if (value === "falling") return '<span class="trend-down">下降</span>';
  if (value === "new") return '<span class="trend-new">新出现</span>';
  return '<span class="trend-neutral">稳定</span>';
}

function resultLabel(value) {
  if (value === "win") return '<span class="result-win">胜利</span>';
  if (value === "loss") return '<span class="result-loss">失败</span>';
  return '<span class="result-unknown">未完成</span>';
}

function sideLabel(value) {
  if (value === "first") return "先手";
  if (value === "second") return "后手";
  return "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function setConnection(kind, text) {
  $("connection-dot").className = `status-dot ${kind}`;
  $("connection-status").textContent = text;
}

function renderOverview(data) {
  const overview = data.overview || {};
  const source = data.source || {};
  const games = Number(overview.games || 0);
  $("metric-games").textContent = games.toLocaleString("zh-CN");
  const scanned = Number(source.scannedRecords ?? overview.totalRecords ?? games);
  const duplicateRecords = Number(source.duplicateRecords || 0);
  const unlimitedRecords = Number(source.unlimitedRecords || 0);
  const filters = [];
  if (duplicateRecords > 0) filters.push(`去重 ${duplicateRecords} 条`);
  if (unlimitedRecords > 0) filters.push(`排除无限 ${unlimitedRecords} 条`);
  $("metric-games-foot").textContent = `${scanned.toLocaleString("zh-CN")} 条记录已扫描${filters.length ? ` · ${filters.join(" · ")}` : ""}`;
  $("metric-win-rate").textContent = percent(overview.winRate);
  $("metric-win-rate-foot").textContent = `${Number(overview.wins || 0)} 胜 / ${Number(overview.losses || 0)} 负`;
  $("metric-record").textContent = `${Number(overview.wins || 0)} / ${Number(overview.losses || 0)}`;
  $("metric-turn").textContent = number(overview.averageEndingTurn, 1);
  $("updated-at").textContent = data.generatedAt ? `更新于 ${formatDateTime(data.generatedAt)}` : "—";

  const note = $("sample-note");
  if (games < 20) {
    note.hidden = false;
    note.textContent = `目前只有 ${games} 场有效对局，页面仅展示观察结果；样本达到 20 场后再参考趋势，达到更大规模后再用于模型训练。`;
  } else {
    note.hidden = true;
  }
}

function renderBestDecks(data) {
  const rows = (data.bestDecks || data.decks || []).slice().sort((a, b) => {
    const left = Number(a?.[metaSort]);
    const right = Number(b?.[metaSort]);
    return (Number.isFinite(right) ? right : -1) - (Number.isFinite(left) ? left : -1) || Number(b.games || 0) - Number(a.games || 0);
  });
  $("best-decks-table").innerHTML = rows.length ? rows.slice(0, 18).map((row, index) => {
    const rate = usageRate(row, data);
    return `<tr><td class="rank-cell">${index + 1}</td><td title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td><td>${escapeHtml(row.className || "—")}</td><td>${percent(rate)}</td><td>${row.games ?? "—"}</td><td>${percent(row.winRate)}</td><td>${tierLabel(row.tier)}</td></tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">暂无完整对局数据</td></tr>';
}

function renderTrendingCards(data) {
  const select = $("trend-class");
  const classRows = (data.classUsage || []).filter((row) => row.classId !== null && row.classId !== undefined);
  select.innerHTML = '<option value="">全部职业</option>' + classRows.map((row) => `<option value="${escapeHtml(row.classId)}">${escapeHtml(row.className || row.name)}</option>`).join("");
  if (!classRows.some((row) => String(row.classId) === String(trendClass))) trendClass = "";
  select.value = trendClass;

  const rows = (data.trendingCards || []).filter((row) => {
    if (!trendClass) return true;
    return (row.classIds || []).some((id) => String(id) === String(trendClass));
  });
  $("trending-cards-table").innerHTML = rows.length ? rows.slice(0, 14).map((row) => `
    <tr><td class="card-label"><strong>${escapeHtml(cardName(row.cardId))}</strong></td>
    <td class="stack-cell"><strong>${percent(row.recentUsageRate)}</strong><small>${row.recentGames ?? 0} 场</small></td>
    <td>${deltaPoints(row.usageDelta)}</td><td>${percent(row.recentWinRate)}</td><td>${trendLabel(row.direction)}</td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">暂无可比较的趋势数据</td></tr>';

  const window = data.trendWindow || {};
  const recentGames = Number(window.recentGames || 0);
  const previousGames = Number(window.previousGames || 0);
  $("trend-window-note").textContent = recentGames && previousGames
    ? `最近 ${window.recentDays || 14} 天 ${recentGames} 场，对比此前 ${previousGames} 场；变化以使用率百分点（pp）表示。`
    : recentGames
      ? `最近 ${window.recentDays || 14} 天有 ${recentGames} 场，但此前没有可比较的对局；趋势会在样本积累后稳定。`
      : "暂无带时间戳的完整对局，暂时无法计算趋势。";
}

function renderUsagePie(pieId, legendId, rows, data, kind) {
  const pie = $(pieId);
  const legend = $(legendId);
  const sorted = rows.slice()
    .filter((row) => Number(row?.games || 0) > 0)
    .sort((a, b) => (usageRate(b, data) || 0) - (usageRate(a, data) || 0) || Number(b.games || 0) - Number(a.games || 0));
  const maxVisible = kind === "deck" ? 8 : 7;
  const visible = sorted.slice(0, maxVisible);
  const totalKey = kind === "class" ? "communityClassTotal" : "communityDeckTotal";
  const hasCommunityStats = data && data[totalKey] !== null && data[totalKey] !== undefined;
  const unit = hasCommunityStats ? "侧" : "场";
  const totalGames = hasCommunityStats
    ? Number(data[totalKey] || 0)
    : Number(data?.overview?.games || sorted.reduce((sum, row) => sum + Number(row.games || 0), 0));
  const omittedGames = Math.max(0, totalGames - visible.reduce((sum, row) => sum + Number(row.games || 0), 0));
  if (omittedGames > 0) {
    visible.push({
      name: kind === "class" ? "其他职业" : "其他卡组",
      games: omittedGames,
      usageRate: totalGames ? omittedGames / totalGames : null,
    });
  }
  const total = visible.reduce((sum, row) => sum + Number(row.games || 0), 0);

  if (!visible.length || !total) {
    pie.style.setProperty("--pie-gradient", "#dfe6eb");
    pie.setAttribute("aria-label", "暂无使用率数据");
    pie.innerHTML = `<div class="usage-pie-total"><strong>—</strong><span>${unit}</span></div>`;
    legend.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }

  let cursor = 0;
  const stops = visible.map((row, index) => {
    const end = cursor + Number(row.games || 0) / total * 100;
    const gap = Math.min(0.42, Math.max(0.08, (end - cursor) / 8));
    const colorEnd = index === visible.length - 1 ? end : Math.max(cursor, end - gap);
    const stop = index === visible.length - 1
      ? `${chartColor(row, index, kind)} ${cursor.toFixed(3)}% ${end.toFixed(3)}%`
      : `${chartColor(row, index, kind)} ${cursor.toFixed(3)}% ${colorEnd.toFixed(3)}%, #edf4f8 ${colorEnd.toFixed(3)}% ${end.toFixed(3)}%`;
    cursor = end;
    return stop;
  });
  pie.style.setProperty("--pie-gradient", `conic-gradient(from -90deg, ${stops.join(", ")})`);
  pie.setAttribute("aria-label", `${kind === "class" ? "职业" : "卡组"}使用率饼图，共 ${total} ${unit}`);
  pie.innerHTML = `${renderPieSvg(pieId, visible, total, kind)}<div class="usage-pie-total"><strong>${total.toLocaleString("zh-CN")}</strong><span>${unit}</span></div>`;
  legend.innerHTML = visible.map((row, index) => {
    const name = kind === "class" ? row.className || row.name : row.name;
    const rate = usageRate(row, data);
    return `<div class="usage-legend-row" title="${escapeHtml(name)}"><span>${usageMarker(row, index, kind)}</span><span class="usage-legend-name">${escapeHtml(name)}</span><span class="usage-legend-value">${percent(rate)}<small>${row.games ?? 0}${unit}</small></span></div>`;
  }).join("");
}

function piePoint(angle, radius = 50) {
  const radians = angle * Math.PI / 180;
  return { x: 50 + Math.cos(radians) * radius, y: 50 + Math.sin(radians) * radius };
}

function pieWedgePath(startAngle, endAngle) {
  const start = piePoint(startAngle);
  const end = piePoint(endAngle);
  const largeArc = endAngle - startAngle >= 180 ? 1 : 0;
  return `M 50 50 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 50 50 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function sliceArtOffset(startAngle, spanAngle) {
  const span = Math.min(360, Math.abs(spanAngle));
  let fraction;
  if (span >= 330) {
    fraction = 0;
  } else if (span >= 180) {
    fraction = Math.max(0.06, 0.24 - (span - 180) / 500);
  } else {
    fraction = Math.min(0.30, Math.max(0.20, 0.42 - span / 600));
  }
  const shift = 50 * fraction;
  const midpoint = (startAngle + spanAngle / 2) * Math.PI / 180;
  return {
    dx: Math.cos(midpoint) * shift,
    dy: Math.sin(midpoint) * shift,
    overscan: shift + 50 * 0.06,
  };
}

function renderPieSvg(pieId, rows, total, kind) {
  const prefix = `pie-${String(pieId).replace(/[^a-z0-9_-]/gi, "-")}`;
  const backgrounds = [];
  const clips = [];
  const arts = [];
  const separators = [];
  let cursor = -90;
  rows.forEach((row, index) => {
    const span = Number(row.games || 0) / total * 360;
    const end = cursor + span;
    const path = pieWedgePath(cursor, end);
    const clipId = `${prefix}-slice-${index}`;
    backgrounds.push(`<path d="${path}" fill="${chartColor(row, index, kind)}"></path>`);
    clips.push(`<clipPath id="${clipId}"><path d="${path}"></path></clipPath>`);
    const artUrl = coreCardArtUrl(row.coreCardIds || row.coreCardId);
    if (artUrl) {
      const offset = sliceArtOffset(cursor, span);
      const size = 100 + offset.overscan * 2;
      arts.push(`<image href="${escapeHtml(artUrl)}" x="${(-offset.overscan + offset.dx).toFixed(3)}" y="${(-offset.overscan + offset.dy).toFixed(3)}" width="${size.toFixed(3)}" height="${size.toFixed(3)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"></image>`);
    }
    separators.push(`<path d="${path}" fill="none" stroke="#edf4f8" stroke-width="0.65" stroke-linejoin="round"></path>`);
    cursor = end;
  });
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet"><defs>${clips.join("")}</defs>${backgrounds.join("")}${arts.join("")}${separators.join("")}</svg>`;
}

function renderUsage(data) {
  const deckRows = data.communityDecks || data.deckCatalog?.types || data.decks || [];
  const classRows = data.communityClassUsage || data.classUsage || [];
  renderUsagePie("class-usage-pie", "class-usage-list", classRows, data, "class");
  renderUsagePie("deck-usage-pie", "deck-usage-list", deckRows, data, "deck");
}

function renderWinRateBars(containerId, rows, kind) {
  const container = $(containerId);
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) {
    container.innerHTML = `<div class="empty-state">暂无${kind === "class" ? "职业" : "卡组"}胜率数据</div>`;
    return;
  }

  const chartRows = kind === "class"
    ? Object.entries(CLASS_NAMES).map(([id, fallbackName]) => {
      const row = sourceRows.find((item) => String(item.classId) === id) || {};
      return { ...row, classId: Number(id), className: row.className || fallbackName };
    })
    : sourceRows
      .filter((row) => Number(row.games || 0) > 0)
      .slice()
      .sort((a, b) => Number(b.games || 0) - Number(a.games || 0) || Number(b.winRate || 0) - Number(a.winRate || 0) || String(a.name || "").localeCompare(String(b.name || "")))
      .slice(0, 8);
  if (!chartRows.length) {
    container.innerHTML = `<div class="empty-state">暂无${kind === "class" ? "职业" : "卡组"}胜率数据</div>`;
    return;
  }

  const bars = chartRows.map((row, index) => {
    const id = String(row.classId ?? "");
    const name = kind === "class" ? row.className || CLASS_NAMES[id] || "未知职业" : row.name || "未命名卡组";
    const games = Number(row.games || 0);
    const wins = Number(row.wins || 0);
    const rate = games ? wins / games : Number(row.winRate || 0);
    const height = games ? Math.max(0, Math.min(100, rate * 100)) : 0;
    const color = winRateColor(rate, games);
    const ratio = games ? `${wins}/${games}` : "0/0";
    const markerColor = kind === "class" ? CLASS_COLORS[id] : CHART_COLORS[index % CHART_COLORS.length];
    const artUrl = kind === "deck" ? coreCardArtUrl(row.coreCardIds || row.coreCardId) : "";
    const iconUrl = kind === "class" ? classIconUrl(id) : "";
    const marker = artUrl
      ? `<img class="rate-marker-art" src="${escapeHtml(artUrl)}" alt="">`
      : iconUrl
        ? `<img src="${iconUrl}" alt="">`
        : escapeHtml(kind === "class" ? CLASS_GLYPHS[id] || "?" : "◆");
    return `<div class="class-win-bar" title="${escapeHtml(name)}：${games ? percent(rate) : "暂无数据"}">
      <div class="class-win-value">${games ? percent(rate) : "—"}</div>
      <div class="class-win-track"><div class="class-win-fill" style="height:${height.toFixed(1)}%;background:${color}">${height >= 25 ? `<span>${ratio}</span>` : ""}</div></div>
      <div class="class-win-marker" style="--marker-color:${markerColor}">${marker}</div>
      <div class="class-win-name">${escapeHtml(name)}</div>
    </div>`;
  }).join("");
  container.innerHTML = `<div class="class-win-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div><div class="class-win-plot"><div class="class-win-bars" style="--bar-count:${chartRows.length}">${bars}</div></div>`;
}

function renderClassWinRates(data) {
  renderWinRateBars("class-win-rate-list", data.communityClassWinRate || data.classWinRate || data.classUsage || [], "class");
  renderWinRateBars("deck-win-rate-list", data.communityDeckWinRate || data.communityDecks || data.bestDecks || data.decks || [], "deck");
}

function renderCards(data) {
  const rows = data.cards || [];
  $("cards-table").innerHTML = rows.length ? rows.slice(0, 14).map((row) => `
    <tr><td class="card-name-cell"><strong>${escapeHtml(cardName(row.cardId))}</strong></td><td>${row.games}</td><td>${percent(row.winRate)}</td><td>${row.wins} / ${row.losses}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">暂无关键牌数据</td></tr>';
}

function renderMulliganStats(data) {
  const stats = data.mulliganStats || {};
  const rows = Array.isArray(stats.cards) ? stats.cards : [];
  const sampleGames = Number(stats.games || 0);
  $("mulligan-note").textContent = sampleGames
    ? `已记录 ${sampleGames} 局完整起手牌；保留率按卡牌次数计算`
    : "暂无完整起手牌记录";
  $("mulligan-stats-table").innerHTML = rows.length ? rows.map((row) => `
    <tr><td class="card-name-cell"><strong>${escapeHtml(cardName(row.cardId))}</strong></td><td>${row.games}</td><td>${row.seen}</td><td>${row.kept}</td><td>${row.replaced}</td><td><strong>${percent(row.retainRate)}</strong></td><td>${percent(row.replaceRate)}</td></tr>`).join("") : '<tr><td colspan="7" class="empty-cell">暂无可计算保留率的换牌记录</td></tr>';
}

function renderTurns(data) {
  const rows = data.turns || [];
  const max = Math.max(...rows.map((row) => row.games), 1);
  $("turn-bars").innerHTML = rows.length ? rows.slice(0, 16).map((row) => `
    <div class="turn-row"><span class="turn-label">T${escapeHtml(row.turn)}</span><div class="bar-track"><div class="bar-fill" style="width:${((row.games / max) * 100).toFixed(1)}%"></div></div><span class="turn-count">${row.games}</span></div>`).join("") : '<div class="empty-state">暂无结束回合数据</div>';
}

function renderRecent(data) {
  const rows = data.recent || [];
  $("recent-table").innerHTML = rows.length ? rows.map((row) => {
    const cr = row.crChange === null || row.crChange === undefined ? "—" : `${row.crChange > 0 ? "+" : ""}${row.crChange}`;
    return `<tr><td>${formatDate(row.end || row.at)}</td><td title="${escapeHtml(row.deck)}">${escapeHtml(row.deck)}</td><td title="${escapeHtml(row.opponentDeck || row.opponentClass)}">${escapeHtml(row.opponentDeck || row.opponentClass)}</td><td>${sideLabel(row.side)}</td><td>${resultLabel(row.result)}</td><td>T${escapeHtml(row.turn ?? "—")}</td><td>${cr}</td></tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">暂无已完成对局</td></tr>';
}

async function loadSummary() {
  const button = $("refresh-button");
  button.disabled = true;
  button.innerHTML = '<span aria-hidden="true">…</span> 加载中';
  $("error-box").hidden = true;
  setConnection("", "正在读取对局分析…");
  try {
    await Promise.all([loadCardNames(), loadCoreCardArt()]);
    const response = await fetch(SUMMARY_URL, { cache: "no-store", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `分析服务返回 ${response.status}`);
    render(payload);
    setConnection("ok", `已同步 ${payload.source?.completeRecords ?? payload.overview?.games ?? 0} 场有效对局`);
  } catch (error) {
    setConnection("error", "分析服务暂时不可用");
    const box = $("error-box");
    box.hidden = false;
    box.textContent = `暂时无法读取分析数据：${error.message}。如果这是首次部署，请稍等 GitHub Pages 和 Worker 完成更新。`;
  } finally {
    button.disabled = false;
    button.innerHTML = '<span aria-hidden="true">↻</span> 刷新数据';
  }
}

async function loadCardNames() {
  try {
    const response = await fetch(CARD_NAMES_URL, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) cardNames = payload;
  } catch {
    // The analysis page remains usable with unknown card names if the optional lookup file is unavailable.
  }
}

async function loadCoreCardArt() {
  try {
    const response = await fetch(CORE_CARD_ART_URL, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) coreCardArt = payload;
  } catch {
    // The charts remain usable with the same solid-color fallback as before.
  }
}
function encodeKey(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodeKey(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

function findType(data, key = selectedDeck) {
  return (data.deckCatalog?.types || []).find((row) => row.key === key)
    || (data.decks || []).find((row) => row.key === key)
    || null;
}

function findVariant(data, key = selectedVariant) {
  return (data.deckCatalog?.variants || []).find((row) => row.key === key)
    || (data.analysisScopes?.variants || []).find((row) => row.key === key)
    || null;
}

function sideStats(records) {
  const buckets = {
    first: { key: "first", name: "先手", games: 0, wins: 0, losses: 0, winRate: null, averageEndingTurn: null },
    second: { key: "second", name: "后手", games: 0, wins: 0, losses: 0, winRate: null, averageEndingTurn: null },
  };
  for (const record of records || []) {
    const bucket = buckets[record.side];
    if (!bucket || !["win", "loss"].includes(record.result)) continue;
    bucket.games += 1;
    bucket.wins += record.result === "win" ? 1 : 0;
    bucket.losses += record.result === "loss" ? 1 : 0;
    bucket._turnTotal = (bucket._turnTotal || 0) + (Number(record.turn) || 0);
  }
  for (const bucket of Object.values(buckets)) {
    bucket.winRate = bucket.games ? bucket.wins / bucket.games : null;
    bucket.averageEndingTurn = bucket.games ? bucket._turnTotal / bucket.games : null;
    delete bucket._turnTotal;
  }
  return buckets;
}

function legacyAnalysisScopes(data) {
  if (data.analysisScopes) return data.analysisScopes;
  const records = (data.recent || []).filter((record) => ["win", "loss"].includes(record.result));
  const classRows = (data.classUsage || data.classWinRate || []).filter((row) => row.classId !== null && row.classId !== undefined);
  const classDeckNames = new Map();
  for (const deck of data.decks || []) {
    const key = String(deck.classId);
    if (!classDeckNames.has(key)) classDeckNames.set(key, new Set());
    classDeckNames.get(key).add(deck.name);
  }
  const classes = classRows.map((row) => ({
    ...row,
    side: sideStats(records.filter((record) => String(record.classId) === String(row.classId) || classDeckNames.get(String(row.classId))?.has(record.deck))),
  }));
  const decks = (data.decks || []).map((row) => ({
    ...row,
    name: row.name || "未命名卡组",
    side: sideStats(records.filter((record) => record.deck === row.name)),
  }));
  const deckClasses = decks.map((row) => ({
    ...row,
    key: String(row.classId) + "\u0000" + row.key,
  }));
  return { classes, decks, deckClasses, variants: [] };
}

function selectedScope(data) {
  const scopes = legacyAnalysisScopes(data);
  if (selectedVariant) {
    const row = (scopes.variants || []).find((item) => item.key === selectedVariant);
    if (row && (!selectedClass || String(row.classId) === String(selectedClass))) {
      const variant = findVariant(data, selectedVariant);
      return {
        row,
        kind: "variant",
        label: row.name + (variant?.label ? " · " + variant.label : ""),
      };
    }
  }
  if (selectedDeck && selectedClass) {
    const combinedKey = selectedClass + "\u0000" + selectedDeck;
    const row = (scopes.deckClasses || []).find((item) => item.key === combinedKey);
    if (!row) return { row: null, kind: "combined", label: "所选职业与卡组没有交集" };
    return { row, kind: "deck", label: row.name + " · " + (row.className || "未知职业") };
  }
  if (selectedDeck) {
    const row = (scopes.decks || []).find((item) => item.key === selectedDeck);
    if (row) return { row, kind: "deck", label: row.name };
  }
  if (selectedClass) {
    const row = (scopes.classes || []).find((item) => String(item.classId) === String(selectedClass));
    if (row) return { row, kind: "class", label: row.name || row.className || "未知职业" };
  }
  return null;
}

function renderScopedOverview(scopeInfo) {
  const row = scopeInfo?.row;
  if (!row) return;
  const games = Number(row.games || 0);
  $("metric-games").textContent = games.toLocaleString("zh-CN");
  $("metric-games-foot").textContent = games + " 场筛选样本";
  $("metric-win-rate").textContent = percent(row.winRate);
  $("metric-win-rate-foot").textContent = Number(row.wins || 0) + " 胜 / " + Number(row.losses || 0) + " 负";
  $("metric-record").textContent = Number(row.wins || 0) + " / " + Number(row.losses || 0);
  $("metric-turn").textContent = number(row.averageEndingTurn, 1);
}

function scopeMatchups(data, scopeInfo) {
  if (!scopeInfo?.row) return [];
  if (scopeInfo.kind === "variant") return findVariant(data, selectedVariant)?.matchups || [];
  return (data.matchups || []).filter((item) => {
    if (scopeInfo.kind === "deck" && item.deckKey !== selectedDeck) return false;
    if (scopeInfo.kind === "deck" && selectedClass && item.ownClass !== scopeInfo.row.className) return false;
    if (scopeInfo.kind === "class") return item.ownClass === scopeInfo.row.name;
    return true;
  });
}

function renderInsights(data, scopeInfo) {
  const row = scopeInfo?.row;
  const items = [];
  if (!row) {
    items.push("请选择职业或卡组类型后查看对应的局数、胜负与先后手表现。");
  } else if (!row.games) {
    items.push(escapeHtml(scopeInfo.label) + " 暂无完整对局。");
  } else {
    items.push("当前范围 <strong>" + escapeHtml(scopeInfo.label) + "</strong>：" + row.games + " 场，胜率 " + percent(row.winRate) + "。");
    const matchups = scopeMatchups(data, scopeInfo);
    const best = matchups.filter((item) => item.games >= 2).sort((a, b) => (b.winRate || 0) - (a.winRate || 0))[0];
    const worst = matchups.filter((item) => item.games >= 2).sort((a, b) => (a.winRate || 0) - (b.winRate || 0))[0];
    if (best) items.push("当前样本中对阵 <strong>" + escapeHtml(best.opponent || best.name) + "</strong> 胜率最高，为 " + percent(best.winRate) + "。");
    if (worst && (!best || worst.opponentKey !== best.opponentKey)) items.push("需要留意对阵 <strong>" + escapeHtml(worst.opponent || worst.name) + "</strong>，样本胜率为 " + percent(worst.winRate) + "。");
    if (row.averageEndingTurn !== null && row.averageEndingTurn !== undefined) items.push("平均结束于 T" + number(row.averageEndingTurn, 1) + "。");
  }
  $("insight-list").innerHTML = items.map((item) => '<div class="insight-item"><span class="insight-bullet">◆</span><span>' + item + "</span></div>").join("");
}

function renderSide(scopeInfo) {
  const side = scopeInfo?.row?.side || {};
  const rows = [
    ["先手", side.first],
    ["后手", side.second],
  ];
  $("side-comparison").innerHTML = rows.map(([label, row]) => {
    const value = row?.winRate ?? 0;
    return '<div class="side-row"><span class="side-row-label">' + label + '</span><div class="bar-track"><div class="bar-fill" style="width:' + safeWidth(value) + '"></div></div><span class="side-row-value">' + percent(row?.winRate) + "</span></div>";
  }).join("");
}

function renderFilteredAnalysis(data) {
  const section = $("filtered-analysis");
  const note = $("selection-note");
  const scopeInfo = selectedScope(data);
  if (!scopeInfo) {
    section.hidden = true;
    note.textContent = "请选择职业或卡组类型；选择卡组后还可以查看具体构筑。当前筛选：" + analysisCrLabel() + "。";
    return;
  }
  if (!scopeInfo.row) {
    section.hidden = true;
    note.textContent = "当前职业与卡组没有交集，请调整筛选条件。当前筛选：" + analysisCrLabel() + "。";
    return;
  }
  section.hidden = false;
  note.textContent = "当前分析范围：" + scopeInfo.label + " · " + scopeInfo.row.games + " 场 · " + analysisCrLabel() + "；下方统计不会把其他卡组混入。";
  renderScopedOverview(scopeInfo);
  renderInsights(data, scopeInfo);
  renderSide(scopeInfo);
}

function renderAnalysisControls(data) {
  if (selectedCr !== "all" && !data.analysisByCr?.[selectedCr]) selectedCr = "all";
  const analysisData = activeAnalysisData(data);
  const classSelect = $("analysis-class");
  const deckSelect = $("analysis-deck");
  const variantSelect = $("analysis-variant");
  const crSelect = $("analysis-cr");
  const classRows = (analysisData.analysisScopes?.classes || analysisData.classUsage || []).filter((row) => row.classId !== null && row.classId !== undefined);
  if (!classRows.some((row) => String(row.classId) === String(selectedClass))) selectedClass = "";
  classSelect.innerHTML = '<option value="">全部职业</option>' + classRows.map((row) => '<option value="' + escapeHtml(row.classId) + '">' + escapeHtml(row.className || row.name) + "</option>").join("");
  classSelect.value = selectedClass;

  const typeRows = analysisData.deckCatalog?.types || analysisData.analysisScopes?.decks || analysisData.decks || [];
  if (!typeRows.some((row) => row.key === selectedDeck)) selectedDeck = "";
  deckSelect.innerHTML = '<option value="">全部卡组类型</option>' + typeRows.map((row) => {
    const suffix = row.className ? " · " + row.className : "";
    return '<option value="' + escapeHtml(encodeKey(row.key)) + '">' + escapeHtml(row.name || "未命名卡组") + escapeHtml(suffix) + "</option>";
  }).join("");
  deckSelect.value = encodeKey(selectedDeck);

  const selectedType = findType(analysisData);
  const variantRows = Array.isArray(selectedType?.variants) ? selectedType.variants : [];
  if (!variantRows.some((row) => row.key === selectedVariant)) selectedVariant = "";
  variantSelect.innerHTML = selectedDeck
    ? '<option value="">按卡组类型汇总</option>' + variantRows.map((row) => '<option value="' + escapeHtml(encodeKey(row.key)) + '">' + escapeHtml(row.label || "构筑") + "</option>").join("")
    : '<option value="">选择卡组后可选</option>';
  variantSelect.disabled = !selectedDeck || !variantRows.length;
  variantSelect.value = encodeKey(selectedVariant);
  crSelect.value = selectedCr;
}

function renderDeckDetails(data) {
  const empty = $("deck-detail-empty");
  const detail = $("deck-detail");
  const type = findType(data);
  if (!selectedDeck || !type) {
    empty.hidden = false;
    detail.hidden = true;
    return;
  }
  const catalogVariants = data.deckCatalog?.variants || [];
  const typeVariants = Array.isArray(type.variants) ? type.variants : [];
  const chosenKey = selectedVariant && typeVariants.some((row) => row.key === selectedVariant)
    ? selectedVariant
    : typeVariants[0]?.key;
  const variant = catalogVariants.find((row) => row.key === chosenKey);
  empty.hidden = true;
  detail.hidden = false;
  $("deck-detail-title").textContent = variant ? type.name + " · " + (variant.label || "构筑") : type.name;
  $("deck-detail-meta").textContent = (type.className || "未知职业") + " · 卡组类型 " + type.games + " 场 · 汇总胜率 " + percent(type.winRate);
  $("deck-detail-note").textContent = variant
    ? selectedVariant ? "当前查看：" + variant.label : "展示 " + variant.label + "；统计仍按卡组类型汇总"
    : "该记录没有可公开的卡牌构成";

  const cards = variant?.cards || [];
  $("deck-cards-table").innerHTML = cards.length ? cards.map((item) => {
    const cardId = Array.isArray(item) ? item[0] : item.cardId;
    const count = Array.isArray(item) ? item[1] : item.count;
    return '<tr><td class="card-name-cell"><strong>' + escapeHtml(cardName(cardId)) + '</strong></td><td>' + escapeHtml(count) + "</td></tr>";
  }).join("") : '<tr><td colspan="2" class="empty-cell">暂无卡牌构成</td></tr>';

  const matchups = variant?.matchups || [];
  $("deck-matchups-table").innerHTML = matchups.length ? matchups.slice(0, 20).map((row) => '<tr><td title="' + escapeHtml(row.name || row.opponent) + '"><strong>' + escapeHtml(row.name || row.opponent || "未知对手") + '</strong><small class="table-subline">' + escapeHtml(row.opponentClass || "") + "</small></td><td>" + row.games + "</td><td>" + percent(row.winRate) + "</td><td>" + row.wins + " / " + row.losses + "</td></tr>").join("") : '<tr><td colspan="4" class="empty-cell">暂无对阵数据</td></tr>';
  const classMatchups = variant?.opponentClasses || [];
  $("deck-class-matchups-table").innerHTML = classMatchups.length ? classMatchups.slice(0, 12).map((row) => '<tr><td><strong>' + escapeHtml(row.name || "未知职业") + "</strong></td><td>" + row.games + "</td><td>" + percent(row.winRate) + "</td><td>" + row.wins + " / " + row.losses + "</td></tr>").join("") : '<tr><td colspan="4" class="empty-cell">暂无职业对阵数据</td></tr>';
}

function matrixTone(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  if (Number(value) >= 0.6) return "matrix-good";
  if (Number(value) <= 0.4) return "matrix-bad";
  return "matrix-even";
}

function matrixLabelKey(value) {
  const label = String(value ?? "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
  return label && !/其他|未知|未能|无法识别|识别失败|unknown|unrecognized/.test(label)
    ? `archetype:${label}`
    : "";
}

function matrixRowKey(row) {
  if (typeof row?.archetypeKey === "string" && row.archetypeKey) return row.archetypeKey;
  if (typeof row?.key === "string" && row.key.startsWith("archetype:")) return row.key;
  return matrixLabelKey(row?.name);
}

function renderMatchupMatrix(data) {
  const matrix = data.matchupMatrix || {};
  const selectedType = findType(data);
  const allDecks = matrix.decks || [];
  const decks = allDecks.filter((row) => {
    if (selectedClass && String(row.classId) !== String(selectedClass)) return false;
    if (selectedDeck) {
      const sameName = selectedType?.name && row.name === selectedType.name;
      const sameArchetype = selectedType?.archetypeKey && matrixRowKey(row) === selectedType.archetypeKey;
      if (!sameName && !sameArchetype) return false;
    }
    return true;
  }).slice(0, 12);
  const opponents = (matrix.opponents || [])
    .filter((row) => matrixRowKey(row))
    .slice(0, 10);
  const cellMap = new Map((matrix.cells || []).map((cell) => [cell.deckKey + "\u0000" + cell.opponentKey, cell]));
  const diagonal = "-";
  const matrixTitle = selectedType?.name
    ? selectedType.name + " \\ 对手类型"
    : selectedClass
      ? classLabel(selectedClass) + "卡组 \\ 对手类型"
      : "卡组类型 \\ 对手类型";
  $("matchup-matrix-head").innerHTML = '<tr><th>' + escapeHtml(matrixTitle) + '</th>' + opponents.map((row) => '<th title="' + escapeHtml(row.name) + '"><strong>' + escapeHtml(row.name) + '</strong><small class="matrix-class">' + escapeHtml(row.className || "") + "</small></th>").join("") + "</tr>";
  if (!decks.length || !opponents.length) {
    $("matchup-matrix-body").innerHTML = '<tr><td colspan="' + Math.max(opponents.length + 1, 2) + '" class="empty-cell">暂无足够的对局矩阵数据</td></tr>';
    return;
  }
  $("matchup-matrix-body").innerHTML = decks.map((deck) => '<tr><td title="' + escapeHtml(deck.name) + '"><strong>' + escapeHtml(deck.name) + '</strong><small class="matrix-class">' + escapeHtml(deck.className || "") + "</small></td>" + opponents.map((opponent) => {
    if (matrixRowKey(deck) && matrixRowKey(deck) === matrixRowKey(opponent)) return '<td class="matrix-cell matrix-diagonal" title="同种卡组">' + diagonal + "</td>";
    const cell = cellMap.get(deck.key + "\u0000" + opponent.key);
    return cell && cell.games ? '<td class="matrix-cell ' + matrixTone(cell.winRate) + '"><div class="matrix-rate">' + percent(cell.winRate) + "</div><small>" + cell.games + " 场</small></td>" : '<td class="matrix-cell muted">—</td>';
  }).join("") + "</tr>").join("");
}

function render(data) {
  currentData = data;
  renderOverview(data);
  renderAnalysisControls(data);
  const analysisData = activeAnalysisData(data);
  renderBestDecks(data);
  renderUsage(data);
  renderClassWinRates(data);
  renderFilteredAnalysis(analysisData);
  renderDeckDetails(analysisData);
  renderMatchupMatrix(analysisData);
  renderCards(data);
  renderMulliganStats(data);
  renderTrendingCards(data);
  renderTurns(data);
  renderRecent(data);
  $("api-label").textContent = "分析服务：" + API_BASE.replace("https://", "");
}

function rerenderSelection() {
  if (!currentData) return;
  renderAnalysisControls(currentData);
  const analysisData = activeAnalysisData(currentData);
  renderFilteredAnalysis(analysisData);
  renderDeckDetails(analysisData);
  renderMatchupMatrix(analysisData);
}

$("refresh-button").addEventListener("click", loadSummary);
document.querySelectorAll("[data-meta-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    metaSort = button.dataset.metaSort || "balancedScore";
    document.querySelectorAll("[data-meta-sort]").forEach((item) => item.classList.toggle("is-active", item === button));
    if (currentData) renderBestDecks(currentData);
  });
});
$("analysis-class").addEventListener("change", (event) => {
  selectedClass = event.target.value;
  rerenderSelection();
});
$("analysis-deck").addEventListener("change", (event) => {
  selectedDeck = decodeKey(event.target.value);
  selectedVariant = "";
  rerenderSelection();
});
$("analysis-variant").addEventListener("change", (event) => {
  selectedVariant = decodeKey(event.target.value);
  rerenderSelection();
});
$("analysis-cr").addEventListener("change", (event) => {
  selectedCr = event.target.value || "all";
  selectedVariant = "";
  rerenderSelection();
});
$("clear-analysis").addEventListener("click", () => {
  selectedClass = "";
  selectedDeck = "";
  selectedVariant = "";
  selectedCr = "all";
  rerenderSelection();
});
$("trend-class").addEventListener("change", (event) => {
  trendClass = event.target.value;
  if (currentData) renderTrendingCards(currentData);
});
loadSummary();
