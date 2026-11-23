# Handoff: McGrath Holiday Home

Read this first. Then read `SETUP.md` (deployment steps) and the code. Language in docs: plain hyphens, no em dashes.

## Goal
A private website for the McGrath family where admins can see two holiday homes on a calendar and manage stay requests. Gav sets it up as the initial admin, adds the two owners as admins, then steps back to a regular member once they're comfortable. Free hosting only.

## Hard constraints (from the owner - do not change)
- No credit card on any service. This rules out Firebase Blaze, Cloud Functions, and paid email services.
- No custom domain. Email goes out from the deploying admin's Gmail via Apps Script `MailApp` (Apps Script has no free way to send "as" a different admin - see Architecture).
- Push notifications are required (Firebase Cloud Messaging on the free Spark plan).
- Everything admin-related happens on the website. The Google Sheet is hidden storage and nobody edits it by hand.
- Mobile first. The owner wants to work from his phone where possible.
- Owner style: brief, direct, assertive. No em dashes in professional writing.
- New-request alerts go to every admin. Decision emails (approve/decline) name the deciding admin and set Reply-To to them, since all mail physically sends from the one deploying Gmail account.

## Requirements (all implemented)
- Two homes to start (renamable, admins can add/remove more any time), each with a name, address, photo and calendar colour. Calendar with 6 and 12 month views on the landing page, plus list view and per-home filter; selecting one home shows its photo/address/notes above the calendar (its "dedicated calendar" view).
- Families contain several adult members, each with their own email. A member can only book for their own family.
- Admins can add, rename and remove families, add and remove members, promote and demote admins (last admin is protected), manage homes (name, address, photo, colour, notes), approve or decline requests, cancel stays, and book on behalf of a family.
- Emails: welcome, request confirmation, admin alert on request, decision email to requester and their family, cancellation notices.
- Push: same events, opt-in per device, email is the fallback and the record.
- No weekly digest (the landing page replaces it).
- Property photos: admin picks an image file in the browser; it's resized/compressed client-side (max 1600px, JPEG) then stored in a "Holiday Homes photos" Google Drive folder owned by the deploying account (free, no card - see Gotchas for the Drive permission prompt this causes).

## Architecture
```
Browser PWA (GitHub Pages, /docs)  --POST text/plain JSON-->  Apps Script web app (bound to a Google Sheet)
   docs/index.html, docs/config.js                              Code.gs: auth, rules, MailApp, FCM HTTP v1 push
   docs/firebase-messaging-sw.js  <---- FCM push --------------  service account JWT (SA_JSON in Script Properties)
```
- API calls use `Content-Type: text/plain` so the browser sends no CORS preflight (Apps Script cannot answer OPTIONS).
- Auth: emailed 6-digit code (CacheService, 10 min, 5 attempts, 60s rate limit) returns an HMAC-signed session token (30 days). Every request re-checks the member still exists, so removal revokes access at once. Unknown emails get the same response as known ones.
- Every mutation takes a script lock and returns the full fresh state, so the client needs one round trip per action.
- Sheet tabs and columns are defined in `TABS` at the top of `Code.gs`. All cells are plain text (`@` format) so dates stay `YYYY-MM-DD`.
- Stay end date is the check-out day and is exclusive. Overlap test: `a.start < b.end && b.start < a.end`.
- Booking statuses: `pending`, `approved`, `declined`, `cancelled`. Members see approved and pending stays of everyone, but notes, guest counts and requester only for their own family. Admins see everything.
- Push uses data-only FCM messages and the service worker builds the notification, so there are no duplicate notifications.

## Files
- `Code.gs` - backend, paste into Apps Script (repo root). Config constants at the top: `ADMIN_EMAIL`, `APP_URL`, `APP_NAME`, `MAX_NIGHTS`.
- `docs/index.html` - whole frontend (vanilla JS, no build step). Views: login, calendar, request, my family, admin (requests, bookings, families, homes). Lives in `docs/` so GitHub Pages serves only the frontend, never `Code.gs`.
- `docs/config.js` - API URL, Firebase web config, VAPID key. Shared by the page and the service worker (`self.CFG`).
- `docs/firebase-messaging-sw.js`, `docs/manifest.json`, `docs/icon-*.png` - PWA and push.
- `SETUP.md` - manual deployment steps for the owner, including an optional `clasp` workflow for faster `Code.gs` re-deploys after the initial link.
- `tests/` - `npm install && npm test`. `backend.test.js` runs `Code.gs` against mocked Apps Script services (21 checks: auth, permissions, overlap, last-admin guard, session revocation, decision-email attribution). `frontend.smoke.js` renders every view in jsdom with a mocked API, reading `docs/index.html`.

## Status
- Code is complete and passes both test files.
- **Not deployed yet.** Nothing has run against real Google Sheets, MailApp, FCM or a real iPhone. Expect small integration issues on first deploy.
- Placeholders still to fill: `ADMIN_EMAIL`, `APP_URL` (Code.gs); `API`, `VAPID`, `FIREBASE.*` (docs/config.js); `SA_JSON` (Script Property).

## Next steps
1. Help the owner deploy by following `SETUP.md`. Account steps (Firebase console, Google auth prompts, GitHub Pages toggle) need the owner. `SETUP.md` has an optional `clasp` section for faster `Code.gs` re-deploys once the script exists.
2. First real test, in order: request a code and sign in; add a family and member (welcome email); request a stay (confirmation + admin alert to every admin); approve (decision email naming the deciding admin, Reply-To set to them); enable push on Android and on iPhone (Home Screen install), then "Send a test".
3. Fix whatever breaks on real services. Likely suspects: `UrlFetchApp` FCM auth (check the Executions log and that the FCM V1 API is enabled), HTML email rendering, service worker scope on a GitHub project-page path.
4. Optional improvements, only if asked: admin edit of stay dates, push via admin-only broadcast, a printable schedule, bookings export, a per-family colour.

## Gotchas
- After any `Code.gs` change: Deploy, Manage deployments, edit, Version "New version". Otherwise the old code keeps serving.
- Apps Script runs about 1 to 2 seconds per call. The UI shows a disabled button while busy. Do not add chatty calls.
- Gmail send limit is about 100 recipients a day for a personal account. Fine for this use.
- iPhone push only works from a Home Screen web app on iOS 16.4 or later. The welcome email says so.
- Never commit the service account JSON. The Firebase web config and the script URL are public by design.
- Frontend lives in `docs/` so GitHub Pages (deployed from `/docs`) never serves `Code.gs`.
- Keep all sheet writes going through `put_` and `del_` (they keep cells as text). Do not write dates with raw `setValue`.
- Saving a property photo calls `DriveApp` for the first time, so the admin will see a one-off Google permission prompt (Advanced, then "Go to project") the first time they upload one, same as the initial `setup` run. Photos live in a "Holiday Homes photos" Drive folder; deleting a property or replacing its photo trashes the old file so it doesn't accumulate.
