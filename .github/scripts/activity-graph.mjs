// Renders a tokyo-night activity graph SVG from the last 31 days of contributions.
// Replaces github-readme-activity-graph.vercel.app, which is down for all users.
// Run: node activity-graph.mjs <user> <out.svg>   |   self-check: node activity-graph.mjs --demo

// No title inside the SVG — the README already has a "Contribution Activity" heading.
const W = 840, H = 240, PAD_L = 46, PAD_R = 20, PAD_T = 34, PAD_B = 40;
const BG = '#1a1b27', TITLE = '#8B5CF6', LINE = '#6C63FF', POINT = '#A78BFA', GRID = '#2c2f45', AXIS = '#7a7fa8';

async function fetchDays(user, token) {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400000);
  const query = `query($user:String!,$from:DateTime!,$to:DateTime!){
    user(login:$user){ contributionsCollection(from:$from,to:$to){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { user, from: from.toISOString(), to: to.toISOString() } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error(`No contribution calendar for user "${user}"`);

  const days = cal.weeks.flatMap((w) => w.contributionDays);
  if (days.length === 0) throw new Error('Contribution calendar came back empty');
  return days.slice(-31);
}

// Catmull-Rom through every point, emitted as cubic beziers. Keeps the curve
// passing through real data instead of smoothing it away.
const smoothPath = (pts) =>
  pts.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const p0 = pts[i - 2] ?? pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] ?? p;
    const c1 = { x: p1.x + (p.x - p0.x) / 6, y: p1.y + (p.y - p0.y) / 6 };
    const c2 = { x: p.x - (p3.x - p1.x) / 6, y: p.y - (p3.y - p1.y) / 6 };
    return `${d} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, '');

// A single contribution starts this far above the baseline, so "1" reads as
// clearly off zero instead of hugging the axis.
const MIN_FRAC = 0.22;

const heightFrac = (count, max) => {
  if (count === 0) return 0;
  if (max === 1) return 1;
  return MIN_FRAC + ((1 - MIN_FRAC) * (count - 1)) / (max - 1);
};

function toPoints(days) {
  const max = Math.max(1, ...days.map((d) => d.contributionCount));
  const span = Math.max(1, days.length - 1);
  return days.map((d, i) => ({
    x: PAD_L + (i * (W - PAD_L - PAD_R)) / span,
    y: PAD_T + (1 - heightFrac(d.contributionCount, max)) * (H - PAD_T - PAD_B),
    ...d,
  }));
}

const label = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function render(days) {
  const pts = toPoints(days);
  const max = Math.max(1, ...days.map((d) => d.contributionCount));
  const baseline = H - PAD_B;
  const gridY = [0, 0.5, 1].map((f) => PAD_T + f * (H - PAD_T - PAD_B));
  const ticks = [0, Math.floor(pts.length / 2), pts.length - 1];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Ubuntu, sans-serif">
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${LINE}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${LINE}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="8" fill="${BG}"/>
  <text x="${W - PAD_R}" y="22" fill="${AXIS}" font-size="12" text-anchor="end">last 31 days</text>
${gridY.map((y) => `  <line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`).join('\n')}
  <text x="${PAD_L - 10}" y="${(PAD_T + 4).toFixed(1)}" fill="${AXIS}" font-size="11" text-anchor="end">${max}</text>
  <text x="${PAD_L - 10}" y="${(baseline + 4).toFixed(1)}" fill="${AXIS}" font-size="11" text-anchor="end">0</text>
  <path d="${smoothPath(pts)} L ${pts.at(-1).x.toFixed(1)} ${baseline} L ${pts[0].x.toFixed(1)} ${baseline} Z" fill="url(#area)"/>
  <path d="${smoothPath(pts)}" fill="none" stroke="${LINE}" stroke-width="2.5" stroke-linecap="round"/>
${pts.map((p) => `  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${POINT}"><title>${p.date}: ${p.contributionCount}</title></circle>`).join('\n')}
${ticks.map((i) => `  <text x="${pts[i].x.toFixed(1)}" y="${H - 14}" fill="${AXIS}" font-size="11" text-anchor="middle">${label(pts[i].date)}</text>`).join('\n')}
</svg>
`;
}

const assert = (ok, msg) => { if (!ok) throw new Error(`self-check failed: ${msg}`); };

function demo() {
  const days = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-07-${String((i % 30) + 1).padStart(2, '0')}`,
    contributionCount: i % 7,
  }));
  const pts = toPoints(days);
  assert(pts.length === 31, 'expected 31 points');
  assert(pts.every((p, i) => i === 0 || p.x > pts[i - 1].x), 'x must increase');
  assert(pts.every((p) => p.y >= PAD_T - 0.01 && p.y <= H - PAD_B + 0.01), 'y within plot area');
  assert(pts.find((p) => p.contributionCount === 6).y === PAD_T, 'max maps to plot top');
  assert(pts.find((p) => p.contributionCount === 0).y === H - PAD_B, 'zero maps to baseline');

  // A single contribution must sit visibly clear of the baseline.
  const one = pts.find((p) => p.contributionCount === 1).y;
  const gap = (H - PAD_B) - one;
  assert(gap > 30, `1 too close to baseline (gap ${gap})`);
  assert(one > pts.find((p) => p.contributionCount === 2).y, '1 must draw lower than 2');
  assert(heightFrac(3, 1) === 1, 'single-level history pins to top');

  const svg = render(days);
  assert(svg.startsWith('<svg') && svg.includes('</svg>'), 'svg well-formed');
  assert((svg.match(/<circle/g) ?? []).length === 31, 'one dot per day');

  // Flat history must not divide by zero.
  const flat = render(days.map((d) => ({ ...d, contributionCount: 0 })));
  assert(!flat.includes('NaN'), 'flat history produced NaN');
  console.log('activity-graph self-check OK');
}

const [arg1, out] = process.argv.slice(2);
if (arg1 === '--demo') {
  demo();
} else {
  const token = process.env.GITHUB_TOKEN;
  if (!arg1 || !out) throw new Error('usage: activity-graph.mjs <user> <out.svg>');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, render(await fetchDays(arg1, token)));
  console.log(`wrote ${out}`);
}
