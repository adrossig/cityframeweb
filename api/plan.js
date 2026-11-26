// GET /j/:token, rewritten here by vercel.json (/api/plan?token=:token).
//
// The web plan view: a shared shoot-plan invite rendered as a page, so the
// crew can read the plan without installing the app. People who have the app
// never reach this page; Universal Links and App Links open /j/* in the app.
//
// The page is server-rendered so chat apps (WhatsApp, iMessage, Slack) show
// the plan's title, date and first photo in the link preview. Plan data comes
// from the Supabase edge function `plan-invite-preview`, which returns a fixed,
// minimal set of fields: plan, stops, notes, the owner's name and a crew count.
// Crew names never leave the app.
//
// The page is noindex and never cached: it names the plan owner, and the plan
// can change or the invite can be revoked at any time.
//
// CommonJS on purpose: this project has no package.json or build step, and
// Vercel runs a CommonJS function in /api without configuration.

const SITE = 'https://cityframe-eight.vercel.app';
const PREVIEW_ENDPOINT =
  process.env.PLAN_PREVIEW_URL ||
  'https://ujshsywocmfjapphhdzt.supabase.co/functions/v1/plan-invite-preview';
const PREVIEW_TIMEOUT_MS = 3500;

const APP_SCHEME = 'com.aequinovare.cityframe';
const IOS_STORE_URL = 'https://apps.apple.com/app/id6792087013';
const ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.aequinovare.cityframe';
const DEFAULT_IMAGE = SITE + '/assets/cityframe-hero.jpg';

// Matches generate_invite_token(): base64url of 16 random bytes.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// Chat apps and crawlers fetching a link preview. iMessage identifies as
// facebookexternalhit + Twitterbot. Counted apart from people opening the page.
const PREVIEW_AGENT =
  /facebookexternalhit|facebot|whatsapp|slackbot|twitterbot|telegrambot|discordbot|linkedinbot|skypeuripreview|applebot|googlebot|bingbot|redditbot|embedly|pinterest|vkshare|bot\b|crawler|spider/i;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * Asks the edge function for the plan. Resolves { ok: true, data } or
 * { ok: false } on a network error, timeout or non-200; the page then falls
 * back to a plain "open in CityFrame" screen instead of failing.
 */
async function fetchPreview(token, source, fetchImpl = fetch) {
  const url =
    PREVIEW_ENDPOINT +
    '?token=' +
    encodeURIComponent(token) +
    '&source=' +
    encodeURIComponent(source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    const data = await response.json();
    if (!data || typeof data.status !== 'string') return { ok: false };
    return { ok: true, data };
  } catch (error) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ESCAPES[c]);
}

function validZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return timeZone;
  } catch (error) {
    return 'UTC';
  }
}

function formatDate(iso, timeZone, now = new Date()) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const zone = validZone(timeZone);
  // Built from parts: ICU versions disagree on the comma after the weekday.
  const parts = d =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
        .formatToParts(d)
        .map(p => [p.type, p.value])
    );
  const p = parts(date);
  const label = p.weekday + ' ' + p.day + ' ' + p.month;
  return p.year === parts(now).year ? label : label + ' ' + p.year;
}

function formatTime(iso, timeZone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: validZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

function possessive(name) {
  return /s$/i.test(name) ? name + '’' : name + '’s';
}

function mapsUrl(stop) {
  if (typeof stop.latitude !== 'number' || typeof stop.longitude !== 'number') return null;
  return (
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(stop.latitude + ',' + stop.longitude)
  );
}

/** "Golden hour 18:32–19:01" style lines for the plan header. */
function lightLines(light) {
  if (!light) return [];
  const zone = light.timezone;
  const lines = [];
  const eveningStart = formatTime(light.golden_evening_start, zone);
  const sunset = formatTime(light.sunset, zone);
  const sunrise = formatTime(light.sunrise, zone);
  const morningEnd = formatTime(light.golden_morning_end, zone);
  if (eveningStart && sunset) lines.push({ label: 'Evening golden hour', value: eveningStart + '–' + sunset });
  if (sunrise && morningEnd) lines.push({ label: 'Morning golden hour', value: sunrise + '–' + morningEnd });
  return lines;
}

// ---------------------------------------------------------------------------
// Page pieces
// ---------------------------------------------------------------------------

function shareUrl(token) {
  return SITE + '/j/' + encodeURIComponent(token);
}

function head({ title, description, image, url }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="CityFrame" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(image)}" />
    ${url ? `<meta property="og:url" content="${esc(url)}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="theme-color" content="#0c0d0d" />
    <link rel="icon" href="/assets/favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Serif&display=swap"
    />
    <style>${STYLES}</style>
  </head>`;
}

const STYLES = `
      :root {
        color-scheme: dark;
        --bg: #0c0d0d;
        --raise: #141616;
        --fg: #f4f2ed;
        --muted: #a4a9a6;
        --line: rgba(244, 242, 237, 0.13);
        --amber: #f4b860;
        --coral: #f07a62;
        --radius: 14px;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--fg); }
      body {
        font: 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      main { max-width: 560px; margin: 0 auto; padding: 28px 16px 48px; }
      .brand { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; text-decoration: none; }
      .brand img { width: 22px; height: 22px; border-radius: 6px; }
      h1 {
        font-family: "Instrument Serif", Georgia, serif;
        font-weight: 400;
        font-size: clamp(34px, 9vw, 46px);
        line-height: 1.05;
        margin: 22px 0 10px;
        overflow-wrap: anywhere;
      }
      .date { font-size: 17px; margin: 0; }
      .muted { color: var(--muted); }
      .owner { display: flex; align-items: center; gap: 10px; margin: 16px 0 0; color: var(--muted); font-size: 15px; }
      .avatar {
        width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex: none;
        background: var(--raise); border: 1px solid var(--line);
        display: inline-flex; align-items: center; justify-content: center; color: var(--fg); font-size: 14px;
      }
      .banner { margin: 18px 0 0; padding: 12px 14px; border-radius: var(--radius); background: rgba(240, 122, 98, 0.12); color: var(--coral); }
      .light { display: grid; gap: 8px; margin: 22px 0 0; padding: 14px 16px; border-radius: var(--radius); background: var(--raise); border: 1px solid var(--line); }
      .light div { display: flex; justify-content: space-between; gap: 12px; }
      .light dt { color: var(--muted); }
      .light dd { margin: 0; color: var(--amber); font-variant-numeric: tabular-nums; }
      .notes { margin: 22px 0 0; white-space: pre-line; overflow-wrap: anywhere; }
      h2 { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 34px 0 12px; }
      ol.stops { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
      .stop { border-radius: var(--radius); background: var(--raise); border: 1px solid var(--line); overflow: hidden; }
      .stop img { display: block; width: 100%; aspect-ratio: 3 / 2; object-fit: cover; background: #1c1f1f; }
      .stop .body { padding: 14px 16px 16px; }
      .stop .top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .stop h3 { font-size: 18px; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
      .stop time { color: var(--amber); font-variant-numeric: tabular-nums; flex: none; }
      .stop p { margin: 4px 0 0; }
      .stop .note { margin-top: 10px; white-space: pre-line; overflow-wrap: anywhere; }
      .stop a.maps { display: inline-block; margin-top: 10px; color: var(--fg); font-size: 14px; }
      .empty { color: var(--muted); }
      .cta {
        position: sticky; bottom: 0; margin: 34px -16px 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
        background: linear-gradient(to top, var(--bg) 70%, rgba(12, 13, 13, 0));
      }
      .button {
        display: block; width: 100%; padding: 15px 20px; border: 0; border-radius: 999px;
        background: var(--fg); color: #0c0d0d; font-family: inherit; font-size: 16px; font-weight: 600; line-height: 1.2; text-align: center; text-decoration: none; cursor: pointer;
      }
      .button:focus-visible, a:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }
      .hint { margin: 10px 0 0; text-align: center; color: var(--muted); font-size: 14px; }
      .stores { display: flex; justify-content: center; gap: 18px; margin: 12px 0 0; font-size: 14px; }
      .stores a { color: var(--fg); }
      .center { text-align: center; padding-top: 18vh; }
      .center p { max-width: 34ch; margin: 0 auto; }
      .center .stores { margin-top: 22px; }
`;

function storeLinks() {
  return `<p class="stores">
        <a href="${IOS_STORE_URL}" rel="noreferrer">App Store</a>
        <a href="${ANDROID_STORE_URL}" rel="noreferrer">Google Play</a>
      </p>`;
}

/**
 * The join button tries the app's custom scheme and falls back to the store.
 * The click is a user gesture, so Safari lets the page copy the link to the
 * clipboard first: the app reads it on first launch and opens this plan, so an
 * install started here still lands on the invite (same contract as link.html).
 */
function joinScript(token) {
  return `<script>
      (function () {
        var button = document.getElementById('join');
        if (!button) return;
        var deepLink = ${JSON.stringify(APP_SCHEME + '://j/' + token)};
        var link = ${JSON.stringify(shareUrl(token))};
        var ua = navigator.userAgent || '';
        var isAndroid = /Android/.test(ua);
        var isIOS = !isAndroid && (/iPad|iPhone|iPod/.test(ua) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
        var storeUrl = isIOS ? ${JSON.stringify(IOS_STORE_URL)} : isAndroid ? ${JSON.stringify(ANDROID_STORE_URL)} : '';

        button.addEventListener('click', function (event) {
          event.preventDefault();
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(link).catch(function () {});
            }
          } catch (error) { /* best effort */ }

          if (!storeUrl) {
            document.getElementById('hint').textContent =
              'Open this link on your phone to join. CityFrame is on the App Store and Google Play.';
            return;
          }

          var timer = setTimeout(function () {
            if (document.visibilityState === 'hidden') return;
            window.location.href = storeUrl;
          }, 1500);
          function cancel() {
            if (document.visibilityState === 'hidden') clearTimeout(timer);
          }
          document.addEventListener('visibilitychange', cancel);
          window.addEventListener('pagehide', cancel);
          window.location.href = deepLink;
        });
      })();
    </script>`;
}

function stopItem(stop, planZone) {
  const zone = stop.timezone || planZone;
  const time = formatTime(stop.scheduled_at, zone);
  const place = [stop.city, stop.address && stop.address !== stop.city ? stop.address : null]
    .filter(Boolean)
    .join(' · ');
  const maps = mapsUrl(stop);
  return `<li class="stop">
          ${stop.photo_url ? `<img src="${esc(stop.photo_url)}" alt="${esc(stop.name)}" loading="lazy" width="640" height="427" />` : ''}
          <div class="body">
            <div class="top">
              <h3>${esc(stop.name)}</h3>
              ${time ? `<time datetime="${esc(stop.scheduled_at)}">${esc(time)}</time>` : ''}
            </div>
            ${place ? `<p class="muted">${esc(place)}</p>` : ''}
            ${stop.notes ? `<p class="note">${esc(stop.notes)}</p>` : ''}
            ${maps ? `<a class="maps" href="${esc(maps)}" rel="noreferrer">Directions</a>` : ''}
          </div>
        </li>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function renderPlan(token, data, now = new Date()) {
  const plan = data.plan || {};
  const stops = Array.isArray(data.stops) ? data.stops : [];
  const zone = data.timezone || 'UTC';
  const ownerName = (data.owner && data.owner.display_name) || 'A photographer';
  const title = plan.title || possessive(ownerName) + ' shoot plan';
  const date = formatDate(plan.scheduled_for, zone, now);
  const going = plural(data.crew_count || 1, 'person', 'people') + ' going';
  const light = lightLines(data.light);
  const image = (stops.find(s => s.photo_url) || {}).photo_url || DEFAULT_IMAGE;

  const description = [
    date || 'Date to be set',
    plural(stops.length, 'stop', 'stops'),
    going,
    light[0] ? light[0].label + ' ' + light[0].value : null
  ]
    .filter(Boolean)
    .join(' · ');

  const banner =
    plan.status === 'cancelled'
      ? 'This shoot was cancelled.'
      : plan.status === 'completed'
        ? 'This shoot has already happened.'
        : null;

  const avatar =
    data.owner && data.owner.avatar_url
      ? `<img class="avatar" src="${esc(data.owner.avatar_url)}" alt="" width="32" height="32" />`
      : `<span class="avatar" aria-hidden="true">${esc(ownerName.trim().charAt(0).toUpperCase() || '?')}</span>`;

  const cta = data.can_join
    ? `<a class="button" id="join" href="${esc(shareUrl(token))}">Join ${esc(possessive(ownerName))} crew</a>
        <p class="hint" id="hint">Opens in the CityFrame app. No app yet? You’ll go to the store, and the plan opens after you install.</p>`
    : `<a class="button" href="${IOS_STORE_URL}" rel="noreferrer">Get CityFrame</a>
        <p class="hint" id="hint">This invite has no places left. Ask ${esc(ownerName)} for a new link.</p>`;

  const html = `${head({ title, description, image, url: shareUrl(token) })}
  <body>
    <main>
      <a class="brand" href="/"><img src="/assets/favicon.png" alt="" />CityFrame</a>
      <h1>${esc(title)}</h1>
      <p class="date">${esc(date || 'Date to be set')}</p>
      <p class="owner">${avatar}<span>Planned by ${esc(ownerName)} · ${esc(going)}</span></p>
      ${banner ? `<p class="banner">${esc(banner)}</p>` : ''}
      ${
        light.length
          ? `<dl class="light">${light
              .map(l => `<div><dt>${esc(l.label)}</dt><dd>${esc(l.value)}</dd></div>`)
              .join('')}</dl>`
          : ''
      }
      ${plan.notes ? `<p class="notes">${esc(plan.notes)}</p>` : ''}
      <h2>${esc(plural(stops.length, 'stop', 'stops'))}</h2>
      ${
        stops.length
          ? `<ol class="stops">${stops.map(s => stopItem(s, zone)).join('')}</ol>`
          : '<p class="empty">No stops yet.</p>'
      }
      <div class="cta">
        ${cta}
        ${storeLinks()}
      </div>
    </main>
    ${data.can_join ? joinScript(token) : ''}
  </body>
</html>`;

  return { status: 200, html };
}

const UNAVAILABLE = {
  expired: { status: 410, title: 'This invite has expired' },
  revoked: { status: 410, title: 'This invite was turned off' },
  not_found: { status: 404, title: 'This invite link doesn’t work' }
};

function renderUnavailable(reason) {
  const page = UNAVAILABLE[reason] || UNAVAILABLE.not_found;
  const description = 'Ask whoever sent it for a new link.';
  const html = `${head({ title: page.title, description, image: DEFAULT_IMAGE })}
  <body>
    <main class="center">
      <a class="brand" href="/"><img src="/assets/favicon.png" alt="" />CityFrame</a>
      <h1>${esc(page.title)}</h1>
      <p class="muted">${esc(description)} CityFrame is the shoot planner for photographers and their crews.</p>
      ${storeLinks()}
    </main>
  </body>
</html>`;
  return { status: page.status, html };
}

/** Plan data unavailable (network, timeout): still let the visitor join. */
function renderFallback(token) {
  const title = 'Join this shoot plan on CityFrame';
  const description = 'Open the plan in the CityFrame app to see the stops, times and crew.';
  const html = `${head({ title, description, image: DEFAULT_IMAGE, url: shareUrl(token) })}
  <body>
    <main class="center">
      <a class="brand" href="/"><img src="/assets/favicon.png" alt="" />CityFrame</a>
      <h1>${esc(title)}</h1>
      <p class="muted">${esc(description)}</p>
      <div class="cta">
        <a class="button" id="join" href="${esc(shareUrl(token))}">Open in CityFrame</a>
        <p class="hint" id="hint">No app yet? You’ll go to the store, and the plan opens after you install.</p>
        ${storeLinks()}
      </div>
    </main>
    ${joinScript(token)}
  </body>
</html>`;
  return { status: 200, html };
}

function buildPage(token, result, now = new Date()) {
  if (!result.ok) return renderFallback(token);
  if (result.data.status !== 'ok') return renderUnavailable(result.data.status);
  return renderPlan(token, result.data, now);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req, res) {
  const raw = req.query && req.query.token;
  const token = Array.isArray(raw) ? raw[0] : String(raw || '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // A HEAD probe (some chat apps send one before the GET) gets headers only,
  // and does not count as a view.
  if (req.method === 'HEAD') {
    res.statusCode = TOKEN_PATTERN.test(token) ? 200 : 404;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }

  if (!TOKEN_PATTERN.test(token)) {
    const page = renderUnavailable('not_found');
    res.statusCode = page.status;
    return res.end(page.html);
  }

  const agent = String(req.headers['user-agent'] || '');
  const source = PREVIEW_AGENT.test(agent) ? 'link_preview' : 'web';
  const page = buildPage(token, await fetchPreview(token, source));
  res.statusCode = page.status;
  return res.end(page.html);
}

module.exports = handler;
module.exports.buildPage = buildPage;
module.exports.fetchPreview = fetchPreview;
module.exports.formatDate = formatDate;
module.exports.formatTime = formatTime;
module.exports.esc = esc;
module.exports.PREVIEW_AGENT = PREVIEW_AGENT;
