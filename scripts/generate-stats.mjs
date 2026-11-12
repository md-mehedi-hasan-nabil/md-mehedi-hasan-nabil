#!/usr/bin/env node
/**
 * Generates themed GitHub stats cards as SVGs (no third-party services).
 *
 * Output (in OUT_DIR):
 *   stats-overview.svg   – contributions, streaks and key counters
 *   stats-languages.svg  – most used languages (public, non-fork repos)
 *   stats-activity.svg   – weekly contribution graph for the last 12 months
 *
 * Env:
 *   GH_TOKEN   – GitHub token (the workflow's GITHUB_TOKEN works; a PAT adds private contribution counts)
 *   GH_USER    – GitHub username
 *   OUT_DIR    – output directory (default: dist)
 *   HIDE_LANGS – comma-separated languages to hide (e.g. "Jupyter Notebook,Makefile")
 *
 * Local preview with fake data:  node scripts/generate-stats.mjs --mock
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USER = process.env.GH_USER || "md-mehedi-hasan-nabil";
const TOKEN = process.env.GH_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "dist";
const HIDE_LANGS = (process.env.HIDE_LANGS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const MOCK = process.argv.includes("--mock");

// ---------- Theme (matches assets/*.svg) ----------
const C = {
  bg: "#0B1224",
  bg2: "#141B3C",
  text: "#E2E8F0",
  soft: "#B6C2D6",
  muted: "#94A3B8",
  dim: "#64748B",
  cyan: "#22D3EE",
  blue: "#3B82F6",
  violet: "#8B5CF6",
  pink: "#EC4899",
  green: "#34D399",
  amber: "#FBBF24",
};
const SANS = "'Segoe UI', Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', Consolas, 'SFMono-Regular', Menlo, 'DejaVu Sans Mono', monospace";
const FALLBACK_LANG_COLORS = [C.cyan, C.blue, C.violet, C.pink, C.green, C.amber, "#F87171", "#A3E635"];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-US"));

// =====================================================================
// Data
// =====================================================================
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-generator",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GitHub API error (${res.status}): ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

const SUMMARY_QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const REPOS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: [OWNER], isFork: false, privacy: PUBLIC) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchData() {
  if (!TOKEN) throw new Error("GH_TOKEN is not set.");
  const { user } = await gql(SUMMARY_QUERY, { login: USER });
  if (!user) throw new Error(`User "${USER}" not found.`);

  let cursor = null;
  let repoCount = 0;
  let stars = 0;
  const langs = new Map();
  for (let page = 0; page < 10; page++) {
    const data = await gql(REPOS_QUERY, { login: USER, cursor });
    const repos = data.user.repositories;
    repoCount = repos.totalCount;
    for (const r of repos.nodes) {
      stars += r.stargazerCount;
      for (const { size, node } of r.languages.edges) {
        if (HIDE_LANGS.includes(node.name.toLowerCase())) continue;
        const cur = langs.get(node.name) || { name: node.name, color: node.color, size: 0 };
        cur.size += size;
        langs.set(node.name, cur);
      }
    }
    if (!repos.pageInfo.hasNextPage) break;
    cursor = repos.pageInfo.endCursor;
  }

  const cc = user.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  return {
    login: user.login,
    totalContributions: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    prs: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    followers: user.followers.totalCount,
    stars,
    repos: repoCount,
    days,
    weeks: cc.contributionCalendar.weeks.map((w) => ({
      start: w.contributionDays[0].date,
      total: w.contributionDays.reduce((a, d) => a + d.contributionCount, 0),
    })),
    languages: [...langs.values()],
  };
}

function mockData() {
  const days = [];
  const start = new Date(Date.UTC(2025, 10, 16));
  let seed = 11;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 364; i++) {
    const d = new Date(start.getTime() + i * 864e5);
    const wave = 2.5 + 2 * Math.sin(i / 25);
    const count = rnd() < 0.18 ? 0 : Math.round(wave + rnd() * 6);
    days.push({ date: d.toISOString().slice(0, 10), contributionCount: i > 350 ? 3 + (i % 4) : count });
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const w = days.slice(i, i + 7);
    weeks.push({ start: w[0].date, total: w.reduce((a, d) => a + d.contributionCount, 0) });
  }
  return {
    login: USER,
    totalContributions: days.reduce((a, d) => a + d.contributionCount, 0),
    commits: 1342,
    prs: 186,
    issues: 41,
    followers: 57,
    stars: 96,
    repos: 48,
    days,
    weeks,
    languages: [
      { name: "TypeScript", color: "#3178c6", size: 5200 },
      { name: "JavaScript", color: "#f1e05a", size: 3900 },
      { name: "CSS", color: "#563d7c", size: 900 },
      { name: "HTML", color: "#e34c26", size: 700 },
      { name: "SCSS", color: "#c6538c", size: 300 },
      { name: "Python", color: "#3572A5", size: 220 },
      { name: "Shell", color: "#89e051", size: 90 },
      { name: "Dockerfile", color: "#384d54", size: 60 },
    ],
  };
}

function streaks(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0;
  let run = 0;
  for (const d of sorted) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // current streak: allow today to be empty (the day isn't over yet)
  let i = sorted.length - 1;
  if (i >= 0 && sorted[i].contributionCount === 0) i--;
  let current = 0;
  for (; i >= 0 && sorted[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

// =====================================================================
// Shared SVG bits
// =====================================================================
const STYLE = `<style>.sans{font-family:${SANS}}.mono{font-family:${MONO}}</style>`;
const RAINBOW = `<stop offset="0" stop-color="${C.cyan}"/><stop offset="0.3" stop-color="${C.blue}"/><stop offset="0.55" stop-color="${C.violet}"/><stop offset="0.8" stop-color="${C.pink}"/><stop offset="1" stop-color="${C.cyan}"/>`;
const shimmer = (id, dur = 7) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" spreadMethod="repeat">${RAINBOW}<animateTransform attributeName="gradientTransform" type="translate" values="0 0;1 0" dur="${dur}s" repeatCount="indefinite"/></linearGradient>`;

function frame(W, H, label, inner, extraDefs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
${STYLE}
<defs>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="24"/></clipPath>
  <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg2}"/></linearGradient>
  <radialGradient id="glowA" cx="0" cy="0" r="1"><stop offset="0" stop-color="${C.violet}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="1" cy="1" r="1"><stop offset="0" stop-color="${C.cyan}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.cyan}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}" stop-opacity="0"/></linearGradient>
  ${shimmer("rainbow")}
  ${extraDefs}
</defs>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#cardBg)"/>
  <rect width="${W}" height="${H}" fill="url(#glowA)"/>
  <rect width="${W}" height="${H}" fill="url(#glowB)"/>
  <rect width="${W}" height="2" fill="url(#edge)"/>
  ${inner}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="24" fill="none" stroke="#FFFFFF" stroke-opacity="0.09"/>
</svg>`;
}

const fadeIn = (begin, dy = 10) =>
  `<animate attributeName="opacity" from="0" to="1" begin="${begin}s" dur="0.6s" fill="freeze"/>` +
  `<animateTransform attributeName="transform" type="translate" from="0 ${dy}" to="0 0" begin="${begin}s" dur="0.6s" fill="freeze"/>`;

const ICON = {
  commit: `<circle cx="20" cy="20" r="5.5"/><path d="M8 20h6.5M25.5 20H32"/>`,
  pr: `<circle cx="13" cy="11" r="3"/><circle cx="13" cy="29" r="3"/><circle cx="27" cy="29" r="3"/><path d="M13 14v12M27 26v-9a4 4 0 0 0-4-4h-5"/><path d="M20.5 10l-3 3 3 3"/>`,
  issue: `<circle cx="20" cy="20" r="10"/><circle cx="20" cy="20" r="1.8" fill="#fff" stroke="none"/>`,
  star: `<path d="M20 9l3.3 6.9 7.5 1-5.5 5.2 1.4 7.5L20 26l-6.7 3.6 1.4-7.5-5.5-5.2 7.5-1z"/>`,
  repo: `<path d="M12 10h14a2 2 0 0 1 2 2v18H14a2 2 0 0 1-2-2z"/><path d="M12 26a2 2 0 0 1 2-2h14"/><path d="M17 10v8l2.5-1.8L22 18v-8"/>`,
  users: `<circle cx="16" cy="15" r="4.5"/><path d="M8 30c0-4.4 3.6-7 8-7s8 2.6 8 7"/><circle cx="27" cy="16" r="3.5"/><path d="M26 23c3.4.2 6 2.5 6 6"/>`,
  flame: `<path d="M20 8c1 5 6 7 6 13a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6 0 2 1 3.5 2.5 3.5C19.5 15 18 12 20 8z"/>`,
  trophy: `<path d="M14 9h12v6a6 6 0 0 1-12 0z"/><path d="M14 11h-4a4 4 0 0 0 4 5M26 11h4a4 4 0 0 1-4 5M20 21v5M15 30h10M17 26h6"/>`,
};
const icon = (name, x, y, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`;

// =====================================================================
// Card 1 — overview
// =====================================================================
function overviewCard(d) {
  const W = 1200, H = 300;
  const { current, longest } = streaks(d.days);
  const tiles = [
    ["commit", "Commits · 12 mo", d.commits, [C.cyan, C.blue]],
    ["pr", "Pull Requests", d.prs, [C.violet, C.pink]],
    ["issue", "Issues", d.issues, [C.pink, "#F97316"]],
    ["star", "Stars Earned", d.stars, [C.amber, "#F97316"]],
    ["repo", "Public Repos", d.repos, [C.green, "#06B6D4"]],
    ["users", "Followers", d.followers, [C.blue, C.violet]],
  ];
  const tx0 = 470, ty0 = 30, gap = 16;
  const tw = (W - tx0 - 30 - gap * 2) / 3;
  const th = (H - ty0 * 2 - gap) / 2;
  let defs = "";
  const tileSvg = tiles
    .map(([ic, label, val, [a, b]], i) => {
      const x = tx0 + (i % 3) * (tw + gap);
      const y = ty0 + Math.floor(i / 3) * (th + gap);
      defs += `<linearGradient id="t${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
      return `<g opacity="0">${fadeIn(0.3 + i * 0.1)}
        <rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="18" fill="#FFFFFF" fill-opacity="0.035" stroke="#FFFFFF" stroke-opacity="0.08"/>
        <rect x="${x + 20}" y="${y + (th - 48) / 2}" width="48" height="48" rx="14" fill="url(#t${i})"/>
        ${icon(ic, x + 24, y + (th - 48) / 2 + 4)}
        <text x="${x + 84}" y="${y + th / 2 + 4}" class="sans" font-size="30" font-weight="800" fill="${C.text}">${esc(fmt(val))}</text>
        <text x="${x + 85}" y="${y + th / 2 + 26}" class="sans" font-size="13.5" fill="${C.muted}">${esc(label)}</text>
      </g>`;
    })
    .join("");

  const inner = `
  <g opacity="0">${fadeIn(0.1)}
    <text x="44" y="62" class="mono" font-size="13" letter-spacing="2.5" fill="${C.muted}">CONTRIBUTIONS · LAST 12 MONTHS</text>
    <text x="42" y="138" class="sans" font-size="68" font-weight="800" fill="url(#rainbow)">${esc(fmt(d.totalContributions))}</text>
  </g>
  <g opacity="0">${fadeIn(0.25)}
    <rect x="44" y="172" width="180" height="94" rx="18" fill="#FFFFFF" fill-opacity="0.035" stroke="#FFFFFF" stroke-opacity="0.08"/>
    <rect x="60" y="188" width="36" height="36" rx="11" fill="url(#flameG)"/>${icon("flame", 58, 186, 1)}
    <text x="108" y="214" class="sans" font-size="26" font-weight="800" fill="${C.text}">${esc(fmt(current))}</text>
    <text x="60" y="250" class="sans" font-size="13.5" fill="${C.muted}">Current streak · days</text>
    <rect x="240" y="172" width="180" height="94" rx="18" fill="#FFFFFF" fill-opacity="0.035" stroke="#FFFFFF" stroke-opacity="0.08"/>
    <rect x="256" y="188" width="36" height="36" rx="11" fill="url(#trophyG)"/>${icon("trophy", 254, 186, 1)}
    <text x="304" y="214" class="sans" font-size="26" font-weight="800" fill="${C.text}">${esc(fmt(longest))}</text>
    <text x="256" y="250" class="sans" font-size="13.5" fill="${C.muted}">Longest streak · days</text>
  </g>
  <rect x="445" y="34" width="1" height="${H - 68}" fill="#FFFFFF" fill-opacity="0.08"/>
  ${tileSvg}`;

  const extra = `${defs}
  <linearGradient id="flameG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F97316"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>
  <linearGradient id="trophyG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.amber}"/><stop offset="1" stop-color="#F97316"/></linearGradient>`;
  return frame(W, H, "GitHub stats overview", inner, extra);
}

// =====================================================================
// Card 2 — languages
// =====================================================================
function languagesCard(d) {
  const W = 1200, H = 240;
  const top = [...d.languages].sort((a, b) => b.size - a.size).slice(0, 8);
  const total = top.reduce((a, l) => a + l.size, 0) || 1;
  const langs = top.map((l, i) => ({ ...l, pct: (l.size / total) * 100, color: l.color || FALLBACK_LANG_COLORS[i % 8] }));

  const bx = 44, bw = W - 88, by = 92, bh = 16;
  let acc = 0;
  const segs = langs
    .map((l) => {
      const w = (l.pct / 100) * bw;
      const s = `<rect x="${(bx + acc).toFixed(1)}" y="${by}" width="${Math.max(w - 3, 1).toFixed(1)}" height="${bh}" rx="3" fill="${l.color}"/>`;
      acc += w;
      return s;
    })
    .join("");

  const colW = bw / 4;
  const legend = langs
    .map((l, i) => {
      const x = bx + (i % 4) * colW;
      const y = 160 + Math.floor(i / 4) * 44;
      return `<g opacity="0">${fadeIn(0.6 + i * 0.07, 6)}
        <circle cx="${x + 8}" cy="${y - 6}" r="7" fill="${l.color}"/>
        <text x="${x + 26}" y="${y}" class="sans" font-size="17" font-weight="600" fill="${C.text}">${esc(l.name)}</text>
        <text x="${x + colW - 28}" y="${y}" text-anchor="end" class="mono" font-size="14" fill="${C.muted}">${l.pct.toFixed(1)}%</text>
      </g>`;
    })
    .join("");

  const inner = langs.length
    ? `
  <text x="44" y="56" class="sans" font-size="24" font-weight="800" fill="url(#rainbow)">Most Used Languages</text>
  <text x="${W - 44}" y="56" text-anchor="end" class="mono" font-size="13" letter-spacing="2" fill="${C.muted}">PUBLIC REPOSITORIES</text>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="#FFFFFF" fill-opacity="0.05"/>
  <g clip-path="url(#barClip)">${segs}</g>
  ${legend}`
    : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="sans" font-size="18" fill="${C.muted}">No public language data yet</text>`;

  const extra = `<clipPath id="barClip"><rect x="${bx}" y="${by}" height="${bh}" rx="8" width="0"><animate attributeName="width" from="0" to="${bw}" begin="0.2s" dur="1.4s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></rect></clipPath>`;
  return frame(W, H, "Most used languages", inner, extra);
}

// =====================================================================
// Card 3 — weekly activity graph
// =====================================================================
function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function smoothPath(pts) {
  if (pts.length < 2) return "";
  let dStr = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    dStr += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return dStr;
}

function activityCard(d) {
  const W = 1200, H = 360;
  const weeks = d.weeks.slice(-52);
  const x0 = 84, x1 = W - 44, y0 = 112, y1 = 300;
  const max = niceMax(Math.max(1, ...weeks.map((w) => w.total)));
  const sx = (i) => x0 + (i / Math.max(weeks.length - 1, 1)) * (x1 - x0);
  const sy = (v) => y1 - (v / max) * (y1 - y0);
  const pts = weeks.map((w, i) => [sx(i), sy(w.total)]);
  const line = smoothPath(pts);
  const area = `${line} L${x1} ${y1} L${x0} ${y1} Z`;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = y1 - f * (y1 - y0);
      return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#FFFFFF" stroke-opacity="${f === 0 ? 0.14 : 0.06}" ${f === 0 ? "" : 'stroke-dasharray="4 6"'}/>
      <text x="${x0 - 14}" y="${y + 4}" text-anchor="end" class="mono" font-size="12" fill="${C.dim}">${fmt(Math.round(f * max))}</text>`;
    })
    .join("");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let lastMonth = -1;
  const months = weeks
    .map((w, i) => {
      const m = Number(w.start.slice(5, 7)) - 1;
      if (m === lastMonth) return "";
      lastMonth = m;
      if (i === 0) return "";
      return `<text x="${sx(i).toFixed(1)}" y="${y1 + 26}" text-anchor="middle" class="mono" font-size="12" fill="${C.dim}">${MONTHS[m]}</text>`;
    })
    .join("");

  const peakIdx = weeks.reduce((best, w, i) => (w.total > weeks[best].total ? i : best), 0);
  const [px, py] = pts[peakIdx] || [x0, y1];
  const [lx, ly] = pts[pts.length - 1] || [x1, y1];
  const total = weeks.reduce((a, w) => a + w.total, 0);
  const avg = weeks.length ? total / weeks.length : 0;

  const chip = (x, label, value, color) => {
    const w = (label.length + String(value).length) * 8.2 + 44;
    return {
      w,
      svg: `<rect x="${x - w}" y="34" width="${w}" height="34" rx="17" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-opacity="0.35"/>
      <text x="${x - w / 2}" y="56" text-anchor="middle" class="mono" font-size="13.5" fill="${C.soft}">${esc(label)} <tspan fill="${color}" font-weight="700">${esc(value)}</tspan></text>`,
    };
  };
  const c1 = chip(W - 44, "peak week", fmt(weeks[peakIdx]?.total || 0), C.pink);
  const c2 = chip(W - 44 - c1.w - 10, "weekly avg", avg.toFixed(1), C.cyan);

  const inner = `
  <text x="44" y="60" class="sans" font-size="24" font-weight="800" fill="url(#rainbow)">Contribution Activity</text>
  <text x="44" y="84" class="mono" font-size="13" letter-spacing="2" fill="${C.muted}">WEEKLY · LAST 12 MONTHS</text>
  ${c2.svg}${c1.svg}
  ${grid}
  ${months}
  <path d="${area}" fill="url(#areaG)" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="1.2s" dur="1s" fill="freeze"/></path>
  <path d="${line}" fill="none" stroke="url(#lineG)" stroke-width="7" stroke-linecap="round" opacity="0.25" filter="url(#lineGlow)"/>
  <path d="${line}" fill="none" stroke="url(#lineG)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">
    <animate attributeName="stroke-dashoffset" from="1" to="0" begin="0.2s" dur="2s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1"/>
  </path>
  <g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="2s" dur="0.5s" fill="freeze"/>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="${C.pink}"/>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="none" stroke="${C.pink}" stroke-width="2">
      <animate attributeName="r" values="6;16" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite"/>
    </circle>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5.5" fill="${C.cyan}"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="5.5" fill="none" stroke="${C.cyan}" stroke-width="2">
      <animate attributeName="r" values="5.5;14" dur="1.8s" begin="0.9s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="1.8s" begin="0.9s" repeatCount="indefinite"/>
    </circle>
  </g>`;

  const extra = `
  <linearGradient id="lineG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.cyan}"/><stop offset="0.5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>
  <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></linearGradient>
  <filter id="lineGlow" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>`;
  return frame(W, H, "Contribution activity", inner, extra);
}

// =====================================================================
async function main() {
  const data = MOCK ? mockData() : await fetchData();
  await mkdir(OUT_DIR, { recursive: true });
  const files = {
    "stats-overview.svg": overviewCard(data),
    "stats-languages.svg": languagesCard(data),
    "stats-activity.svg": activityCard(data),
  };
  for (const [name, svg] of Object.entries(files)) {
    await writeFile(path.join(OUT_DIR, name), svg, "utf8");
    console.log(`✔ ${name}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
