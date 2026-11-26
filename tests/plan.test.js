// Run with: node --test tests/
// No dependencies: node:test and node:assert only, like the rest of this repo.

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan.js');
const { buildPage, fetchPreview, formatDate, formatTime, PREVIEW_AGENT } = handler;

const TOKEN = 'abcdefghijklmnopqrstuv__';
const NOW = new Date('2026-11-26T12:00:00Z');

const okPreview = (overrides = {}) => ({
  status: 'ok',
  can_join: true,
  plan: {
    title: 'Marina sunset',
    status: 'scheduled',
    scheduled_for: '2026-12-05T16:00:00Z',
    notes: 'Meet at exit B'
  },
  owner: { display_name: 'Lena', avatar_url: null },
  crew_count: 3,
  timezone: 'Asia/Singapore',
  light: {
    date: '2026-12-06',
    timezone: 'Asia/Singapore',
    sunrise: '2026-12-05T22:57:00Z',
    golden_morning_end: '2026-12-05T23:24:00Z',
    golden_evening_start: '2026-12-06T10:35:00Z',
    sunset: '2026-12-06T11:03:00Z'
  },
  stops: [
    {
      name: 'Helix Bridge',
      address: null,
      city: 'Singapore',
      country_code: 'SG',
      timezone: 'Asia/Singapore',
      latitude: 1.2876,
      longitude: 103.8607,
      scheduled_at: '2026-12-06T10:40:00Z',
      notes: 'Sunflare at 18:40',
      photo_url: 'https://cdn.example/h_640.webp?v=2'
    },
    {
      name: 'Rooftop draft',
      address: null,
      city: 'Singapore',
      country_code: 'SG',
      timezone: 'Asia/Singapore',
      latitude: 1.29,
      longitude: 103.85,
      scheduled_at: null,
      notes: null,
      photo_url: null
    }
  ],
  ...overrides
});

const render = data => buildPage(TOKEN, { ok: true, data }, NOW);

test('a live plan renders title, date, light, stops and notes', () => {
  const { status, html } = render(okPreview());
  assert.equal(status, 200);
  assert.match(html, /<h1>Marina sunset<\/h1>/);
  // Stored as local midnight: 16:00 UTC on the 5th is Sunday 6 December in Singapore.
  assert.match(html, /Sunday 6 December/);
  assert.match(html, /Evening golden hour<\/dt><dd>18:35–19:03/);
  assert.match(html, /Morning golden hour<\/dt><dd>06:57–07:24/);
  assert.match(html, /Meet at exit B/);
  assert.match(html, /Sunflare at 18:40/);
  assert.match(html, /<time datetime="2026-12-06T10:40:00Z">18:40<\/time>/);
  assert.ok(html.indexOf('Helix Bridge') < html.indexOf('Rooftop draft'), 'stops keep their order');
  assert.match(html, /Planned by Lena · 3 people going/);
});

test('the page is noindex and carries a link preview', () => {
  const { html } = render(okPreview());
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(html, /<meta property="og:title" content="Marina sunset" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn.example\/h_640.webp\?v=2" \/>/);
  assert.match(html, /og:description" content="Sunday 6 December · 2 stops · 3 people going · Evening golden hour 18:35–19:03"/);
  assert.match(html, new RegExp('og:url" content="https://cityframe-eight.vercel.app/j/' + TOKEN));
});

test('the preview image falls back to the site image without a stop photo', () => {
  const data = okPreview();
  data.stops.forEach(s => { s.photo_url = null; });
  assert.match(render(data).html, /og:image" content="https:\/\/cityframe-eight.vercel.app\/assets\/cityframe-hero.jpg"/);
});

test('the join button opens the app scheme with this token', () => {
  const { html } = render(okPreview());
  assert.match(html, /id="join"/);
  assert.match(html, /Join Lena’s crew/);
  assert.ok(html.includes(JSON.stringify('com.aequinovare.cityframe://j/' + TOKEN)));
});

test('a full invite renders without the join button', () => {
  const { status, html } = render(okPreview({ can_join: false }));
  assert.equal(status, 200);
  assert.doesNotMatch(html, /id="join"/);
  assert.match(html, /no places left\. Ask Lena for a new link/);
});

test('user content is escaped', () => {
  const data = okPreview();
  data.plan.title = '<script>alert(1)</script>';
  data.plan.notes = '"quoted" & <b>bold</b>';
  data.owner.display_name = '<img src=x onerror=alert(1)>';
  data.stops[0].name = '"><svg onload=alert(1)>';
  const { html } = render(data);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<svg onload/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;\/b&gt;/);
});

test('cancelled and completed plans say so', () => {
  const cancelled = okPreview();
  cancelled.plan.status = 'cancelled';
  assert.match(render(cancelled).html, /This shoot was cancelled\./);
  const completed = okPreview();
  completed.plan.status = 'completed';
  assert.match(render(completed).html, /This shoot has already happened\./);
});

test('a plan without a date or stops still renders', () => {
  const data = okPreview({ light: null, stops: [], timezone: 'UTC' });
  data.plan.scheduled_for = null;
  const { status, html } = render(data);
  assert.equal(status, 200);
  assert.match(html, /Date to be set/);
  assert.match(html, /No stops yet\./);
  assert.doesNotMatch(html, /class="light"/);
});

test('dead links reveal nothing and use 404 / 410', () => {
  for (const [reason, code, title] of [
    ['expired', 410, 'This invite has expired'],
    ['revoked', 410, 'This invite was turned off'],
    ['not_found', 404, 'This invite link doesn’t work']
  ]) {
    const { status, html } = buildPage(TOKEN, { ok: true, data: { status: reason } }, NOW);
    assert.equal(status, code, reason);
    assert.match(html, new RegExp(title));
    assert.match(html, /noindex/);
    assert.doesNotMatch(html, /id="join"/);
  }
});

test('an unreachable backend falls back to a plain join screen', () => {
  const { status, html } = buildPage(TOKEN, { ok: false }, NOW);
  assert.equal(status, 200);
  assert.match(html, /Join this shoot plan on CityFrame/);
  assert.match(html, /id="join"/);
});

test('dates and times read in the given zone', () => {
  assert.equal(formatTime('2026-12-06T10:40:00Z', 'Asia/Singapore'), '18:40');
  assert.equal(formatTime('2026-07-01T17:00:00Z', 'Europe/London'), '18:00');
  assert.equal(formatTime(null, 'UTC'), null);
  assert.equal(formatTime('2026-12-06T10:40:00Z', 'Not/AZone'), '10:40');
  assert.equal(formatDate('2027-01-02T10:00:00Z', 'UTC', NOW), 'Saturday 2 January 2027');
});

test('chat preview agents are told apart from people', () => {
  for (const ua of [
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'TelegramBot (like TwitterBot)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
  ]) {
    assert.ok(PREVIEW_AGENT.test(ua), ua);
  }
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
  ]) {
    assert.ok(!PREVIEW_AGENT.test(ua), ua);
  }
});

// ---------------------------------------------------------------------------
// fetchPreview and the handler
// ---------------------------------------------------------------------------

const response = (status, body) => ({ ok: status === 200, status, json: async () => body });

test('fetchPreview passes the token and source, and survives failures', async () => {
  let seen;
  const ok = await fetchPreview(TOKEN, 'web', async url => {
    seen = url;
    return response(200, { status: 'expired' });
  });
  assert.deepEqual(ok, { ok: true, data: { status: 'expired' } });
  assert.match(seen, new RegExp('\\?token=' + TOKEN + '&source=web$'));

  assert.deepEqual(await fetchPreview(TOKEN, 'web', async () => response(500, {})), { ok: false });
  assert.deepEqual(await fetchPreview(TOKEN, 'web', async () => { throw new Error('down'); }), { ok: false });
  assert.deepEqual(await fetchPreview(TOKEN, 'web', async () => response(200, null)), { ok: false });
});

const fakeRes = () => {
  const res = { headers: {}, statusCode: 0, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = body => { res.body = body; return res; };
  return res;
};

const withFetch = async (impl, run) => {
  const original = global.fetch;
  global.fetch = impl;
  try { return await run(); } finally { global.fetch = original; }
};

test('the handler rejects a malformed token without calling the backend', async () => {
  let called = false;
  const res = fakeRes();
  await withFetch(async () => { called = true; }, () =>
    handler({ method: 'GET', query: { token: 'bad token!' }, headers: {} }, res));
  assert.equal(called, false);
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
});

test('the handler counts a chat preview as link_preview and a person as web', async () => {
  const sources = [];
  const fetchImpl = async url => {
    sources.push(new URL(url).searchParams.get('source'));
    return response(200, okPreview());
  };
  await withFetch(fetchImpl, async () => {
    const bot = fakeRes();
    await handler({ method: 'GET', query: { token: TOKEN }, headers: { 'user-agent': 'WhatsApp/2.23' } }, bot);
    const person = fakeRes();
    await handler({ method: 'GET', query: { token: TOKEN }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari' } }, person);
    assert.equal(person.statusCode, 200);
    assert.match(person.body, /Marina sunset/);
  });
  assert.deepEqual(sources, ['link_preview', 'web']);
});

test('a HEAD probe gets headers only and records no view', async () => {
  let called = false;
  const res = fakeRes();
  await withFetch(async () => { called = true; }, () =>
    handler({ method: 'HEAD', query: { token: TOKEN }, headers: {} }, res));
  assert.equal(called, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, undefined);
});
