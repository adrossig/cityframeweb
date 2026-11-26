# CityFrame web host

Everything CityFrame needs from the web: the public landing page plus the
shared-link fallback that opens spots and shoot plan invites in the app.
Deployed on Vercel at `cityframe-eight.vercel.app`, which is the
`SHARE_LINK_DOMAIN` and `AUTH_REDIRECT_DOMAIN` baked into every shipped build.
The app, the association files and the host all have to agree, so moving to
another domain (for example `cityframe.io`, which has no DNS today) means a new
store build with the new domain *and* keeping this one serving for installed
builds.

| Path                                     | Purpose                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                             | Public landing page served at `/`.                                                                                                                             |
| `assets/*`                               | Landing-page images and favicon.                                                                                                                               |
| `.well-known/apple-app-site-association` | Lets iOS open `/s/*` and `/j/*` in the app (Universal Links). Must be served over HTTPS, as `application/json`, with **no redirect** and no `.json` extension. |
| `.well-known/assetlinks.json`            | Same for Android (App Links), verified against the app's signing certificate.                                                                                  |
| `link.html`                              | What a browser gets for a spot link (`/s/*`) when the app is not installed: tries the custom scheme, copies the link to the clipboard, then sends the visitor to the store. |
| `api/plan.js`                            | The web plan view: server-renders a plan invite link (`/j/*`) as a page, with a link preview for chat apps. See "Web plan view" below.                          |
| `tests/`                                 | `node --test tests/` — tests for `api/plan.js`, no dependencies. Not deployed (`.vercelignore`).                                                               |
| `vercel.json`                            | Rewrites `/s/:id` onto `link.html` and `/j/:token` onto `api/plan.js`, and pins the content types. Translate to your host's equivalent if you are not on Vercel. |

## Vercel setup

Preferred setup: create the Vercel project with this `web` folder as the root
directory. There is no build command and no output directory; Vercel can serve
the files as a static site.

If the Vercel project is pointed at the repository root instead, the root
`.vercelignore` and `vercel.json` deploy only this `web` folder and route `/`,
`/assets/*`, `/s/*`, `/j/*`, and `.well-known/*` to the right files.

## Link shapes

- `https://cityframe-eight.vercel.app/s/<spotId>` — a spot
- `https://cityframe-eight.vercel.app/j/<token>` — a shoot plan invite

Both are also reachable as `com.aequinovare.cityframe://s/<spotId>` and
`com.aequinovare.cityframe://j/<token>`, which is what `link.html` and the plan
page's join button fall back to, and what the deferred-install hand-off uses.

## Web plan view

People with the app never see this page: Universal Links and App Links open
`/j/*` in the app. Everyone else gets the plan as a page, so a crew member can
read it before (or without) installing.

- **Rendering.** `api/plan.js` is a Vercel Node function (CommonJS, no build
  step). It renders on the server so WhatsApp, iMessage and Slack show the plan
  title, date and first stop photo in the link preview.
- **Data.** It calls the Supabase edge function `plan-invite-preview`
  (`PLAN_PREVIEW_URL` overrides the default URL), which returns a fixed set of
  fields: plan title, date, status and notes; each stop's name, place, time,
  notes and published photo; the owner's name and avatar; a crew count; and the
  golden hour for the plan date. Crew names are never sent.
- **Privacy.** The page is `noindex` and `no-store`, and sends no referrer.
  The invite token is the only credential, the same one the app uses to join.
  A revoked, expired or unknown token gets a 410 or 404 page with no plan data.
- **Join.** The button copies the link to the clipboard (the deferred-install
  hand-off, same contract as `link.html`), tries the custom scheme, then opens
  the store.
- **Metrics.** Each render logs a row in `shoot_plan_link_views` with source
  `web` (a person) or `link_preview` (a chat app fetching the card; detected by
  user agent). A HEAD request logs nothing.
- **Fallback.** If the edge function is down or slow (3.5 s timeout), the page
  still renders a plain "Open in CityFrame" screen with the join button.

## Production setup status

1. **Android fingerprints.** `assetlinks.json` lists three SHA-256
   fingerprints, all from Play Console → _Test and release_ → _App integrity_
   → _App signing_ (added 2026-11-26):

   - `8A:1C:CA:…:F8:A2`: the original Play app-signing key, listed under
     _Previous app signing keys_ and used in Play's own Digital Asset Links
     snippet. It signs every Play install made before the key upgrade.
   - `58:05:20:…:42:45`: the upgraded Play app-signing key ("In use", the
     classical key of the quantum-ready pair). It signs Play installs made
     after the upgrade.
   - `64:84:B2:…:5D:6D`: the EAS upload key, which covers release builds
     installed outside Google Play.

   If Play's app-signing key is upgraded again, add the new classical SHA-256
   and keep the old ones while installs signed with them remain.

   Do **not** add the Android debug keystore fingerprint here. That key ships
   with the SDK and is identical on every machine, so listing it would let any
   app signed with it claim these links.

2. **Store URLs.** Done 2026-11-24. `link.html` and the landing page use
   `https://apps.apple.com/app/id6792087013` and the Google Play listing for
   `com.aequinovare.cityframe`. The app's `IOS_APP_URL` / `ANDROID_APP_URL`
   (EAS production and preview) and `app_config.store_url_*` in Supabase hold
   the same URLs.

3. **Verify.** After deploying:

   ```sh
   curl -sI https://cityframe-eight.vercel.app/.well-known/apple-app-site-association   # 200, application/json, no redirect
   curl -s  https://cityframe-eight.vercel.app/.well-known/assetlinks.json | jq .
   ```

   Android's verifier: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://cityframe-eight.vercel.app&relation=delegate_permission/common.handle_all_urls`

   iOS caches the association file at install time — reinstall the app after
   changing it, and note that Universal Links do not open the app when the URL
   is typed into Safari's address bar or opened from the same domain; test by
   tapping a link in Notes or Messages.
