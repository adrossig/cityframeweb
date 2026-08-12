# cityframe.io web host

Everything CityFrame needs from the web: the public landing page plus the
shared-link fallback that opens spots and shoot plan invites in the app.
Deploy the contents of this folder at the root of `cityframe.io` (or whatever
`SHARE_LINK_DOMAIN` is set to in the app's env files; the app, the association
files and the host all have to agree).

| Path                                     | Purpose                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                             | Public landing page served at `/`.                                                                                                                             |
| `assets/*`                               | Landing-page images and favicon.                                                                                                                               |
| `.well-known/apple-app-site-association` | Lets iOS open `/s/*` and `/j/*` in the app (Universal Links). Must be served over HTTPS, as `application/json`, with **no redirect** and no `.json` extension. |
| `.well-known/assetlinks.json`            | Same for Android (App Links), verified against the app's signing certificate.                                                                                  |
| `link.html`                              | What a browser gets when the app is not installed: tries the custom scheme, copies the link to the clipboard, then sends the visitor to the store.             |
| `vercel.json`                            | Rewrites `/s/:id` and `/j/:token` onto `link.html` and pins the content types. Translate to your host's equivalent if you are not on Vercel.                   |

## Vercel setup

Preferred setup: create the Vercel project with this `web` folder as the root
directory. There is no build command and no output directory; Vercel can serve
the files as a static site.

If the Vercel project is pointed at the repository root instead, the root
`.vercelignore` and `vercel.json` deploy only this `web` folder and route `/`,
`/assets/*`, `/s/*`, `/j/*`, and `.well-known/*` to the right files.

## Link shapes

- `https://cityframe.io/s/<spotId>` — a spot
- `https://cityframe.io/j/<token>` — a shoot plan invite

Both are also reachable as `com.aequinovare.cityframe://s/<spotId>` and
`com.aequinovare.cityframe://j/<token>`, which is what `link.html` falls back to
and what the deferred-install hand-off uses.

## Before this works in production

1. **Android fingerprint.** Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` in
   `assetlinks.json` with the SHA-256 of the certificate Google actually signs
   the app with: Play Console → _Test and release_ → _App integrity_ → _App
   signing key certificate_, or `eas credentials -p android`. Add the upload
   certificate's fingerprint too if you sideload release builds.

   Do **not** add the Android debug keystore fingerprint here. That key ships
   with the SDK and is identical on every machine, so listing it would let any
   app signed with it claim cityframe.io links.

2. **App Store id.** Set `IOS_STORE_URL` in `link.html` once the iOS listing
   exists, and set `IOS_APP_URL` / `ANDROID_APP_URL` in the app's env files to
   the same URLs. Until then, iOS visitors are sent back to the landing page
   instead of a broken App Store placeholder.

3. **Verify.** After deploying:

   ```sh
   curl -sI https://cityframe.io/.well-known/apple-app-site-association   # 200, application/json, no redirect
   curl -s  https://cityframe.io/.well-known/assetlinks.json | jq .
   ```

   Android's verifier: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://cityframe.io&relation=delegate_permission/common.handle_all_urls`

   iOS caches the association file at install time — reinstall the app after
   changing it, and note that Universal Links do not open the app when the URL
   is typed into Safari's address bar or opened from the same domain; test by
   tapping a link in Notes or Messages.
