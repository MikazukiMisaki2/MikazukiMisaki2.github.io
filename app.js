const API_BASE = "https://sephies-lab-upload.mikazukimisakijp.workers.dev";
const SUMMARY_URL = `${API_BASE}/api/summary?limit=500`;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function renderDecks(data) {
  const rows = data.decks || [];
  $("decks-table").innerHTML = rows.length ? rows.slice(0, 12).map((row) => `
    <tr><td title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td><td>${row.games}</td>
    <td class="win-rate"><div class="inline-bar"><div class="bar-track"><div class="bar-fill" style="width:${safeWidth(row.winRate)}"></div></div><span>${percent(row.winRate)}</span></div></td>
    <td>${number(row.averageEndingTurn, 1)}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">暂无数据</td></tr>';
}

function renderOpponents(data) {
  const rows = data.opponentClasses || [];
  $("opponents-table").innerHTML = rows.length ? rows.slice(0, 12).map((row) => `
    <tr><td>${escapeHtml(row.name)}</td><td>${row.games}</td>
    <td>${percent(row.winRate)}</td><td><span class="result-win">${row.wins}</span> / <span class="result-loss">${row.losses}</span></td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">暂无数据</td></tr>';
}

function renderMatchups(data) {
  const rows = data.matchups || [];
  $("matchups-grid").innerHTML = rows.length ? rows.slice(0, 24).map((row) => `
    <div class="matchup-card"><div class="matchup-top"><span class="matchup-deck" title="${escapeHtml(row.deck)}">${escapeHtml(row.deck)}</span><span class="matchup-rate">${percent(row.winRate)}</span></div>
    <div class="matchup-opponent">对阵 ${escapeHtml(row.opponent)} · ${row.games} 场 · ${row.wins} 胜 ${row.losses} 负</div>
    <div class="bar-track"><div class="bar-fill" style="width:${safeWidth(row.winRate)}"></div></div></div>`).join("") : '<div class="empty-state">暂无足够的对局矩阵数据</div>';
}

function renderCards(data) {
  const rows = data.cards || [];
  $("cards-table").innerHTML = rows.length ? rows.slice(0, 14).map((row) => `
    <tr><td>${escapeHtml(row.cardId)}</td><td>${row.games}</td><td>${percent(row.winRate)}</td><td>${row.wins} / ${row.losses}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-cell">暂无关键牌数据</td></tr>';
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
    return `<tr><td>${formatDate(row.end || row.at)}</td><td title="${escapeHtml(row.deck)}">${escapeHtml(row.deck)}</td><td>${escapeHtml(row.opponentClass)}</td><td>${sideLabel(row.side)}</td><td>${resultLabel(row.result)}</td><td>T${escapeHtml(row.turn ?? "—")}</td><td>${cr}</td></tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">暂无已完成对局</td></tr>';
}

function render(data) {
  renderOverview(data);
  renderInsights(data);
  renderSide(data);
  renderDecks(data);
  renderOpponents(data);
  renderMatchups(data);
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

$("refresh-button").addEventListener("click", loadSummary);
loadSummary();
