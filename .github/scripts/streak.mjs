// Renders the streak stats SVG for the profile README.
// Replaces streak-stats.demolab.com, whose cold starts take ~23s — well past
// GitHub camo's proxy timeout, so camo caches a 504 and the card shows broken.
// Serving our own SVG from raw.githubusercontent.com skips camo entirely,
// same as .github/scripts/activity-graph.mjs already does.
//
// Run: node streak.mjs <user> <out.svg>   |   self-check: node streak.mjs --demo

// Card geometry: matches upstream's 495x195 three-panel layout.
const W = 495, H = 195;
const COL = W / 3;
const RING_CX = COL * 1.5, RING_CY = 74, RING_R = 40;

// The middle column runs taller than the side columns (flame above the ring,
// label and dates below it). Derive the side baselines from the middle block's
// centre so all three columns sit on one axis instead of the sides riding high.
const FIRE_H = 26;                                  // 24px glyph at scale 1.1
const FIRE_TOP = RING_CY - RING_R - 15;             // flame straddles the ring
const CURR_LABEL_Y = RING_CY + 66, CURR_DATE_Y = RING_CY + 88;
const MID_TOP = FIRE_TOP, MID_BOT = CURR_DATE_Y + 4;
const MID_CENTER = (MID_TOP + MID_BOT) / 2;

// Side column: 28px number, then label and dates. Cap height ~20 above the
// number's baseline, descender ~3 below the dates'.
const NUM_CAP = 20, DATE_DESC = 3, LABEL_GAP = 28, DATE_GAP = 52;
const SIDE_NUM_Y = MID_CENTER - (DATE_GAP + DATE_DESC - NUM_CAP) / 2;
const SIDE_LABEL_Y = SIDE_NUM_Y + LABEL_GAP, SIDE_DATE_Y = SIDE_NUM_Y + DATE_GAP;

// Colors from the README's original query string (theme=tokyonight with
// background/ring/fire/currStreakLabel overridden, hide_border=true).
const BG = '#1a1b27', RING = '#8B5CF6', FIRE = '#6C63FF';
const NUM = '#c9d1d9', LABEL = '#c9d1d9', CURR_LABEL = '#8B5CF6', DATE = '#8b949e';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

async function graphql(query, variables, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// contributionsCollection caps each query at one year, so walk the account
// lifetime a year at a time.
async function fetchDays(user, token) {
  const { user: u } = await graphql(
    `query($user:String!){ user(login:$user){ createdAt } }`, { user }, token);
  if (!u) throw new Error(`No such user "${user}"`);

  const created = new Date(u.createdAt);
  const today = new Date(`${iso(new Date())}T23:59:59Z`);
  const query = `query($user:String!,$from:DateTime!,$to:DateTime!){
    user(login:$user){ contributionsCollection(from:$from,to:$to){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`;

  const byDate = new Map();
  for (let from = created; from < today; from = new Date(from.getTime() + 365 * DAY)) {
    const to = new Date(Math.min(from.getTime() + 365 * DAY, today.getTime()));
    const data = await graphql(query, { user, from: from.toISOString(), to: to.toISOString() }, token);
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) byDate.set(d.date, d.contributionCount);
  }
  if (byDate.size === 0) throw new Error('Contribution calendar came back empty');

  const cutoff = iso(new Date());
  return [...byDate]
    .filter(([date]) => date <= cutoff)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, contributionCount]) => ({ date, contributionCount }));
}

// Today scoring zero does not end the streak — the day is not over yet.
export function currentStreak(days) {
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  let length = 0, start = null, end = null;
  while (i >= 0 && days[i].contributionCount > 0) {
    end ??= days[i].date;
    start = days[i].date;
    length++; i--;
  }
  const fallback = days.at(-1)?.date ?? null;
  return { length, start: start ?? fallback, end: end ?? fallback };
}

export function longestStreak(days) {
  let best = { length: 0, start: null, end: null }, run = 0, start = null;
  for (const d of days) {
    if (d.contributionCount === 0) { run = 0; continue; }
    if (run === 0) start = d.date;
    run++;
    if (run > best.length) best = { length: run, start, end: d.date };
  }
  if (best.length === 0) {
    const fallback = days.at(-1)?.date ?? null;
    return { length: 0, start: fallback, end: fallback };
  }
  return best;
}

// Upstream drops the year on dates in the current year, keeps it otherwise.
const fmt = (isoDate) => {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

const range = (a, b) => (a === b ? fmt(a) : `${fmt(a)} - ${fmt(b)}`);

export function render(days) {
  if (days.length === 0) throw new Error('need at least 1 day of history');

  const total = days.reduce((n, d) => n + d.contributionCount, 0);
  const curr = currentStreak(days);
  const longest = longestStreak(days);

  const panel = (cx, num, label, dates) => `
  <g>
    <text class="num" x="${cx}" y="${SIDE_NUM_Y}">${num}</text>
    <text class="label" x="${cx}" y="${SIDE_LABEL_Y}">${label}</text>
    <text class="date" x="${cx}" y="${SIDE_DATE_Y}">${dates}</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
  <style>
    svg { font-family: 'Segoe UI', Ubuntu, Sans-Serif; user-select: none; }
    text { text-anchor: middle; }
    .num { fill: ${NUM}; font-size: 28px; font-weight: 700; }
    .label { fill: ${LABEL}; font-size: 14px; font-weight: 700; }
    .curr-label { fill: ${CURR_LABEL}; font-size: 14px; font-weight: 700; }
    .date { fill: ${DATE}; font-size: 12px; }
    .divider { stroke: ${DATE}; stroke-width: 1px; stroke-opacity: 0.3; }
    .ring { stroke: ${RING}; stroke-width: 5px; fill: none; }
    .fire { fill: ${FIRE}; }
  </style>
  <rect x="0" y="0" width="100%" height="100%" fill="${BG}"/>
  <line class="divider" x1="${COL}" y1="34" x2="${COL}" y2="${H - 34}"/>
  <line class="divider" x1="${COL * 2}" y1="34" x2="${COL * 2}" y2="${H - 34}"/>
${panel(COL * 0.5, total, 'Total Contributions', `${fmt(days[0].date)} - Present`)}
${panel(COL * 2.5, longest.length, 'Longest Streak', range(longest.start, longest.end))}
  <g>
    <circle class="ring" cx="${RING_CX}" cy="${RING_CY}" r="${RING_R}"/>
    <text class="num" x="${RING_CX}" y="${RING_CY + 10}">${curr.length}</text>
    <text class="curr-label" x="${RING_CX}" y="${CURR_LABEL_Y}">Current Streak</text>
    <text class="date" x="${RING_CX}" y="${CURR_DATE_Y}">${range(curr.start, curr.end)}</text>
    <g transform="translate(${RING_CX - 13}, ${FIRE_TOP}) scale(1.1)">
      <!-- Punches a hole in the ring so the flame sits on the ring, not over it. -->
      <rect x="0" y="9" width="24" height="10" fill="${BG}"/>
      <path class="fire" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
    </g>
  </g>
</svg>
`;
}

const assert = (ok, msg) => { if (!ok) throw new Error(`self-check failed: ${msg}`); };

function demo() {
  const mk = (counts, from = Date.UTC(2026, 0, 1)) =>
    counts.map((contributionCount, i) => ({ date: iso(new Date(from + i * DAY)), contributionCount }));

  assert(currentStreak(mk([1, 1, 1])).length === 3, 'unbroken history is all streak');
  assert(currentStreak(mk([1, 0, 1, 1])).length === 2, 'zero breaks the streak');
  // A quiet today must not zero out a live streak, or the card flips every morning.
  assert(currentStreak(mk([1, 1, 1, 0])).length === 3, 'todays zero is not a break');
  assert(currentStreak(mk([1, 1, 0, 0])).length === 0, 'yesterdays zero does break it');
  assert(currentStreak(mk([0, 0, 0])).length === 0, 'no history, no streak');
  assert(currentStreak(mk([0, 0, 0])).start !== null, 'empty streak still gets a date');

  const c = currentStreak(mk([0, 1, 1]));
  assert(c.start === '2026-01-02' && c.end === '2026-01-03', 'streak bounds');

  const l = longestStreak(mk([1, 1, 1, 0, 1]));
  assert(l.length === 3 && l.start === '2026-01-01' && l.end === '2026-01-03', 'longest run wins');
  assert(longestStreak(mk([0, 0])).length === 0, 'flat history has no longest streak');
  // Ties must keep the first run, so the range matches the number shown.
  assert(longestStreak(mk([1, 1, 0, 1, 1])).start === '2026-01-01', 'first run wins a tie');

  // The side columns rode high above the ring once; keep all three on one axis.
  const sideCenter = ((SIDE_NUM_Y - NUM_CAP) + (SIDE_DATE_Y + DATE_DESC)) / 2;
  assert(Math.abs(sideCenter - MID_CENTER) < 0.51, 'side columns off the middle axis');
  assert(FIRE_TOP + FIRE_H > RING_CY - RING_R, 'flame must reach the ring');
  assert(MID_BOT < H && SIDE_DATE_Y + DATE_DESC < H, 'content inside the card');

  assert(fmt('2026-08-15') === 'Aug 15', 'current year drops the year');
  assert(fmt('2025-10-20') === 'Oct 20, 2025', 'past year keeps the year');
  assert(range('2026-01-01', '2026-01-01') === 'Jan 1', 'single day is not a range');

  const svg = render(mk([2, 0, 3, 4, 1]));
  assert(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), 'svg well-formed');
  assert(!svg.includes('NaN') && !svg.includes('undefined'), 'no NaN/undefined leaked');
  assert(svg.includes('>10<'), 'total contributions rendered');
  assert(svg.includes('Current Streak') && svg.includes('Longest Streak'), 'panel labels present');
  assert((svg.match(/class="divider"/g) ?? []).length === 2, 'two panel dividers');
  assert(!render(mk([0])).includes('NaN'), 'single quiet day still renders');
  console.log('streak self-check OK');
}

const [arg1, out] = process.argv.slice(2);
if (arg1 === '--demo') {
  demo();
} else if (arg1) {
  const token = process.env.GITHUB_TOKEN;
  if (!out) throw new Error('usage: streak.mjs <user> <out.svg>');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, render(await fetchDays(arg1, token)));
  console.log(`wrote ${out}`);
}
