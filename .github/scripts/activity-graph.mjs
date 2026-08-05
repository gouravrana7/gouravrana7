// Renders the activity graph SVG for the profile README.
// Visual spec mirrors Ashutosh00710/github-readme-activity-graph (the vercel host
// that is down for every user): 1200x420, dashed grid, axis titles, 4px animated
// line, 10px round points. No card title — the README already has a heading.
// Six months of daily points would smear those 10px dots into a band, so days are
// bucketed into weeks. Same look, wider range.
//
// Run: node activity-graph.mjs <user> <out.svg>   |   self-check: node activity-graph.mjs --demo

const DAYS = 183; // ~6 months

// Upstream card + chartist geometry.
const W = 1200, H = 420;
const PAD_T = 40, PAD_R = 50, PAD_B = 20;
const AXIS_X_OFFSET = 50, AXIS_Y_OFFSET = 70, PAD_L = 20;
const PLOT_L = PAD_L + AXIS_Y_OFFSET, PLOT_R = W - PAD_R;
const PLOT_T = PAD_T, PLOT_B = H - PAD_B - AXIS_X_OFFSET;

// Colors from the README's original query string.
const BG = '#1a1b27', LABEL = '#8B5CF6', LINE = '#6C63FF', POINT = '#A78BFA';

async function fetchDays(user, token) {
  const to = new Date();
  const from = new Date(to.getTime() - (DAYS - 1) * 86400000);
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
  return days.slice(-DAYS);
}

// Whole weeks only — a partial trailing week would dip and read as a drop-off.
export function toWeeks(days) {
  const weeks = [];
  for (let i = days.length % 7; i + 7 <= days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    weeks.push({
      date: chunk[0].date,
      contributionCount: chunk.reduce((sum, d) => sum + d.contributionCount, 0),
    });
  }
  return weeks;
}

// Integer ticks starting at zero, like chartist's onlyInteger + low:0.
function yTicks(max) {
  const step = Math.max(1, Math.ceil(max / 5));
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  // Always leave a non-zero top tick, so an all-quiet history still has a scale.
  if (ticks.at(-1) !== max || ticks.length < 2) ticks.push(ticks.at(-1) + step);
  return ticks;
}

function toPoints(weeks, top) {
  const span = Math.max(1, weeks.length - 1);
  return weeks.map((w, i) => ({
    x: PLOT_L + (i * (PLOT_R - PLOT_L)) / span,
    y: PLOT_B - (w.contributionCount / top) * (PLOT_B - PLOT_T),
    ...w,
  }));
}

// Cardinal spline through every point, matching chartist's default smoothing.
const smoothPath = (pts) =>
  pts.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    const p0 = pts[i - 2] ?? pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] ?? p;
    const c1 = { x: p1.x + (p.x - p0.x) / 6, y: p1.y + (p.y - p0.y) / 6 };
    const c2 = { x: p.x - (p3.x - p1.x) / 6, y: p.y - (p3.y - p1.y) / 6 };
    return `${d} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, '');

const label = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function render(days) {
  const weeks = toWeeks(days);
  if (weeks.length < 2) throw new Error(`need at least 2 full weeks, got ${weeks.length}`);

  const ticks = yTicks(Math.max(1, ...weeks.map((w) => w.contributionCount)));
  const top = ticks.at(-1);
  const pts = toPoints(weeks, top);
  // One x label per month or so; every week's date would collide.
  const every = Math.ceil(pts.length / 8);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
  <style>
    svg { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; user-select: none; }
    .label { fill: ${LABEL}; font-size: .75rem; line-height: 1; }
    .axis-title { fill: ${LABEL}; font-size: .75rem; }
    .grid { stroke: ${LABEL}; stroke-width: 1px; stroke-opacity: 0.3; stroke-dasharray: 2px; }
    /* Resting state is the finished drawing, so the graph is still visible if a
       renderer ignores CSS animation. The keyframes only replay the reveal. */
    .line { fill: none; stroke: ${LINE}; stroke-width: 4px; stroke-dasharray: 5000; stroke-dashoffset: 0; animation: dash 5s ease-in-out forwards; }
    .point { stroke: ${POINT}; stroke-width: 10px; stroke-linecap: round; opacity: 1; animation: blink 1s ease-in-out forwards; }
    @keyframes dash { from { stroke-dashoffset: 5000; } to { stroke-dashoffset: 0; } }
    @keyframes blink { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
  </style>
  <rect x="0" y="0" width="100%" height="100%" fill="${BG}"/>
${ticks.map((v) => {
  const y = PLOT_B - (v / top) * (PLOT_B - PLOT_T);
  return `  <line class="grid" x1="${PLOT_L}" y1="${y.toFixed(1)}" x2="${PLOT_R}" y2="${y.toFixed(1)}"/>
  <text class="label" x="${PLOT_L - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
}).join('\n')}
${pts.map((p, i) => (i % every || p.x > PLOT_R - 30 ? '' :
  `  <line class="grid" x1="${p.x.toFixed(1)}" y1="${PLOT_T}" x2="${p.x.toFixed(1)}" y2="${PLOT_B}"/>
  <text class="label" x="${p.x.toFixed(1)}" y="${PLOT_B + 24}" text-anchor="middle">${label(p.date)}</text>`)).filter(Boolean).join('\n')}
  <text class="axis-title" x="${(PLOT_L + PLOT_R) / 2}" y="${H - 6}" text-anchor="middle">Weeks</text>
  <text class="axis-title" x="${-(PLOT_T + PLOT_B) / 2}" y="24" text-anchor="middle" transform="rotate(-90)">Contributions</text>
  <path class="line" d="${smoothPath(pts)}"/>
${pts.map((p) => `  <line class="point" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"><title>week of ${p.date}: ${p.contributionCount}</title></line>`).join('\n')}
</svg>
`;
}

const assert = (ok, msg) => { if (!ok) throw new Error(`self-check failed: ${msg}`); };

function demo() {
  const days = Array.from({ length: DAYS }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    contributionCount: i % 7,
  }));

  const weeks = toWeeks(days);
  assert(weeks.length === Math.floor(DAYS / 7), `expected ${Math.floor(DAYS / 7)} weeks`);
  assert(weeks.every((w) => w.contributionCount === 21), 'each week sums its 7 days');
  // A ragged tail must be dropped, not rendered as a fake dip.
  assert(toWeeks(days.slice(0, 17)).length === 2, 'partial trailing week dropped');

  assert(yTicks(18).at(-1) >= 18, 'top tick covers max');
  assert(yTicks(18)[0] === 0, 'axis starts at zero');
  assert(yTicks(0).length >= 2, 'flat history still gets an axis');

  const pts = toPoints(weeks, yTicks(21).at(-1));
  assert(pts.every((p, i) => i === 0 || p.x > pts[i - 1].x), 'x must increase');
  assert(pts.every((p) => p.y >= PLOT_T - 0.01 && p.y <= PLOT_B + 0.01), 'y within plot area');

  const svg = render(days);
  assert(svg.startsWith('<svg') && svg.includes('</svg>'), 'svg well-formed');
  assert((svg.match(/class="point"/g) ?? []).length === weeks.length, 'one point per week');
  assert(svg.includes('Contributions') && svg.includes('Weeks'), 'axis titles present');
  assert(!svg.includes('Contribution Graph'), 'no card title, README supplies the heading');

  const flat = render(days.map((d) => ({ ...d, contributionCount: 0 })));
  assert(!flat.includes('NaN'), 'flat history produced NaN');
  console.log('activity-graph self-check OK');
}

const [arg1, out] = process.argv.slice(2);
if (arg1 === '--demo') {
  demo();
} else if (arg1) {
  const token = process.env.GITHUB_TOKEN;
  if (!out) throw new Error('usage: activity-graph.mjs <user> <out.svg>');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, render(await fetchDays(arg1, token)));
  console.log(`wrote ${out}`);
}
