const API_BASE = "https://sephies-lab-upload.mikazukimisakijp.workers.dev";
const SUMMARY_URL = `${API_BASE}/api/summary?limit=500`;
const CARD_NAMES_URL = "./card-names.json";

let cardNames = Object.create(null);
let currentData = null;
let metaSort = "balancedScore";
let trendClass = "";

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
  const games = Number(overview.games || 0);
  $("metric-games").textContent = games.toLocaleString("zh-CN");
  $("metric-games-foot").textContent = `${Number(overview.totalRecords || games).toLocaleString("zh-CN")} 条记录已扫描`;
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

function renderInsights(data) {
  const overview = data.overview || {};
  const items = [];
  const games = Number(overview.games || 0);
  if (!games) {
    items.push("还没有可用于统计的完整对局。完成一局后，数据会自动出现在这里。");
  } else {
    const bestDeck = (data.decks || []).filter((row) => row.games >= 2).sort((a, b) => b.winRate - a.winRate)[0];
    const bestOpponent = (data.opponentClasses || []).filter((row) => row.games >= 2).sort((a, b) => b.winRate - a.winRate)[0];
    const side = overview.side || {};
    const first = side.first;
    const second = side.second;
    if (bestDeck) items.push(`<strong>${escapeHtml(bestDeck.name)}</strong> 当前样本胜率为 ${percent(bestDeck.winRate)}，共 ${bestDeck.games} 场。`);
    if (bestOpponent) items.push(`对阵 <strong>${escapeHtml(bestOpponent.name)}</strong> 的样本胜率为 ${percent(bestOpponent.winRate)}。`);
    if (first && second && first.games && second.games) {
      items.push(`先手 ${percent(first.winRate)}（${first.games} 场），后手 ${percent(second.winRate)}（${second.games} 场）。`);
    }
    if (!items.length) items.push("样本仍在积累中，暂时不对卡组强弱下结论。");
  }
  $("insight-list").innerHTML = items.map((item) => `<div class="insight-item"><span class="insight-bullet">◆</span><span>${item}</span></div>`).join("");
}

function renderSide(data) {
  const side = data.overview?.side || {};
  const rows = [
    ["先手", side.first],
    ["后手", side.second],
  ];
  $("side-comparison").innerHTML = rows.map(([label, row]) => {
    const value = row?.winRate ?? 0;
    return `<div class="side-row"><span class="side-row-label">${label}</span><div class="bar-track"><div class="bar-fill" style="width:${safeWidth(value)}"></div></div><span class="side-row-value">${percent(row?.winRate)} </span></div>`;
  }).join("");
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
    <tr><td class="card-label"><strong>${escapeHtml(cardName(row.cardId))}</strong><small class="card-id-inline">${escapeHtml(row.cardId)}</small></td>
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

function renderUsageList(id, rows, data, label) {
  const container = $(id);
  const visible = rows.slice().sort((a, b) => (usageRate(b, data) || 0) - (usageRate(a, data) || 0) || Number(b.games || 0) - Number(a.games || 0)).slice(0, 8);
  const max = Math.max(...visible.map((row) => usageRate(row, data) || 0), 0) || 1;
  container.innerHTML = visible.length ? visible.map((row) => {
    const rate = usageRate(row, data);
    const name = label === "class" ? row.className || row.name : row.name;
    return `<div class="usage-row"><span class="usage-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${safeWidth((rate || 0) / max)}"></div></div><span class="usage-value">${percent(rate)} · ${row.games ?? 0}场</span></div>`;
  }).join("") : '<div class="empty-state">暂无数据</div>';
}

function renderUsage(data) {
  renderUsageList("class-usage-list", data.classUsage || [], data, "class");
  renderUsageList("deck-usage-list", data.decks || [], data, "deck");
}

function renderClassWinRates(data) {
  const rows = data.classWinRate || data.classUsage || [];
  $("class-win-rate-list").innerHTML = rows.length ? rows.map((row) => `
    <article class="class-win-card"><div class="class-win-top"><h3>${escapeHtml(row.className || row.name)}</h3><strong class="class-win-rate">${percent(row.winRate)}</strong></div>
    <div class="bar-track"><div class="bar-fill" style="width:${safeWidth(row.winRate)}"></div></div>
    <div class="class-win-foot"><span>${row.wins ?? 0} 胜 / ${row.losses ?? 0} 负</span><span>${row.games ?? 0} 场</span></div></article>`).join("") : '<div class="empty-state">暂无职业胜率数据</div>';
}

function renderMatchupMatrix(data) {
  const matrix = data.matchupMatrix || {};
  const decks = (matrix.decks || []).slice(0, 12);
  const opponents = (matrix.opponents || []).slice(0, 10);
  const cellMap = new Map((matrix.cells || []).map((cell) => [`${cell.deckKey}\u0000${cell.opponentKey}`, cell]));
  $("matchup-matrix-head").innerHTML = `<tr><th>我的卡组</th>${opponents.map((row) => `<th title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</th>`).join("")}</tr>`;
  if (!decks.length || !opponents.length) {
    $("matchup-matrix-body").innerHTML = `<tr><td colspan="${Math.max(opponents.length + 1, 2)}" class="empty-cell">暂无足够的对局矩阵数据</td></tr>`;
    return;
  }
  $("matchup-matrix-body").innerHTML = decks.map((deck) => `<tr><td title="${escapeHtml(deck.name)}"><strong>${escapeHtml(deck.name)}</strong><small class="matrix-class">${escapeHtml(deck.className || "")}</small></td>${opponents.map((opponent) => {
    const cell = cellMap.get(`${deck.key}\u0000${opponent.key}`);
    return cell && cell.games ? `<td class="matrix-cell"><div class="matrix-rate">${percent(cell.winRate)}</div><small>${cell.games} 场</small></td>` : '<td class="matrix-cell muted">—</td>';
  }).join("")}</tr>`).join("");
}

function renderCards(data) {
  const rows = data.cards || [];
  $("cards-table").innerHTML = rows.length ? rows.slice(0, 14).map((row) => `
    <tr><td class="card-name-cell"><strong>${escapeHtml(cardName(row.cardId))}</strong></td><td class="card-id-cell">${escapeHtml(row.cardId)}</td><td>${row.games}</td><td>${percent(row.winRate)}</td><td>${row.wins} / ${row.losses}</td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">暂无关键牌数据</td></tr>';
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

function render(data) {
  currentData = data;
  renderOverview(data);
  renderInsights(data);
  renderSide(data);
  renderBestDecks(data);
  renderTrendingCards(data);
  renderUsage(data);
  renderClassWinRates(data);
  renderMatchupMatrix(data);
  renderCards(data);
  renderTurns(data);
  renderRecent(data);
  $("api-label").textContent = `分析服务：${API_BASE.replace("https://", "")}`;
}

async function loadSummary() {
  const button = $("refresh-button");
  button.disabled = true;
  button.innerHTML = '<span aria-hidden="true">…</span> 加载中';
  $("error-box").hidden = true;
  setConnection("", "正在读取对局分析…");
  try {
    await loadCardNames();
    const response = await fetch(SUMMARY_URL, { headers: { Accept: "application/json" } });
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
    // The analysis page remains usable with IDs if the optional lookup file is unavailable.
  }
}

$("refresh-button").addEventListener("click", loadSummary);
document.querySelectorAll("[data-meta-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    metaSort = button.dataset.metaSort || "balancedScore";
    document.querySelectorAll("[data-meta-sort]").forEach((item) => item.classList.toggle("is-active", item === button));
    if (currentData) renderBestDecks(currentData);
  });
});
$("trend-class").addEventListener("change", (event) => {
  trendClass = event.target.value;
  if (currentData) renderTrendingCards(currentData);
});
loadSummary();
