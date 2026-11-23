# McGrath Holiday Home - setup (about 45 minutes, no card, no domain)

Files: `Code.gs` (backend, repo root). Frontend lives in `docs/`: `index.html`, `config.js`, `manifest.json`, `firebase-messaging-sw.js`, three `icon-*.png`.

## 1. Google Sheet + backend
1. Go to sheets.new and create a blank sheet. Name it "Holiday Homes data".
2. Extensions, then Apps Script. Delete the default code and paste all of `Code.gs`.
3. At the top, set `ADMIN_EMAIL` (your Gmail, lowercase). Leave `APP_URL` for now.
4. Project Settings (gear icon): set the time zone to Dublin. Also note the **Script ID** here if you plan to use `clasp` for future deploys (see "Faster re-deploys" below).
5. Pick `setup` in the function dropdown and tap Run. Approve the permissions (Advanced, then "Go to project"; it's your own script). The sheet now has its tabs, you as admin, and two placeholder homes.

## 2. Firebase (free Spark plan, push only)
1. console.firebase.google.com, Add project. Decline Analytics. **Do not upgrade the plan.**
2. Project settings, General, "Add app", Web (`</>`). Copy the config values into `docs/config.js` (`apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId`).
3. Project settings, Cloud Messaging: under "Web Push certificates" generate a key pair and paste the public key into `VAPID` in `docs/config.js`. If "Firebase Cloud Messaging API (V1)" shows as disabled, enable it there.
4. Project settings, Service accounts, "Generate new private key". Open the downloaded JSON, copy **all** of it.
5. Back in Apps Script: Project Settings, Script Properties, add a property named `SA_JSON` with the JSON as its value. Never put this file in GitHub.

## 3. Deploy the backend
1. Apps Script: Deploy, New deployment, type Web app. Execute as **Me**, who has access **Anyone**. Deploy.
2. Copy the Web app URL into `API` in `docs/config.js`.

## 4. Host the frontend (GitHub Pages, free)
1. Repo is already created and pushed with the `docs/` layout.
2. Settings, Pages, deploy from branch `main`, folder `/docs`. Your link is `https://USERNAME.github.io/REPO/`.
3. Put that link in `APP_URL` in `Code.gs`, then Deploy, Manage deployments, edit (pencil), Version: New version, Deploy. (Needed after any `Code.gs` change.)

## 5. First run
1. Open your link, enter your admin email, type the 6-digit code from your inbox.
2. My family, Turn on notifications. On iPhone first: Safari, Share, Add to Home Screen, open from the icon.
3. Admin, Homes: rename the two placeholder homes, add their address, upload a photo and pick colours (add more homes here too if needed - the first photo upload will trigger a one-off Google Drive permission prompt, same as step 1.5). Admin, Families: add families and members (add both owners as admins here). Each person gets a welcome email. Share the link.

## Faster re-deploys (clasp) - already set up in this repo
This repo is already wired up for `clasp`, Google's Apps Script CLI, so future `Code.gs` changes don't need re-pasting into the browser editor:
```
npm i -g @google/clasp                            # one-time, if not already installed
clasp login                                       # one-time, opens a browser, your Google account
clasp push                                        # uploads Code.gs + appsscript.json (see .claspignore)
clasp deployments                                 # lists deployment IDs; find the one that is your live web app
clasp deploy -i <DEPLOYMENT_ID> -d "description"  # ships a new version to that *same* URL
```
`clasp login` needs a real browser session under the owning Google account (Enable the Apps Script API first at script.google.com/home/usersettings) - that step is yours to run once; after that, pushing updates is two commands and the live URL never changes. `.clasp.json` (which has the project's script ID) is machine-local and gitignored - if you set this up on another machine, re-run `clasp login` then `clasp clone <SCRIPT_ID>` (the Script ID is in Project Settings in the Apps Script editor) to recreate it.

## Good to know
- The Firebase config and the script URL are not secrets. Access is controlled by the emailed codes and the member list.
- Emails always send from the Gmail account that deployed the script (Apps Script has no free way to send "as" a different admin). Decision emails name the deciding admin in the body and set Reply-To to their address, so replies reach the right person. New-request alerts go to every admin.
- Removing a member signs them out immediately. The last admin can't be removed or demoted - so when you (the initial admin) are ready to step back, add the two owners as admins first, then demote yourself.
- Stays: no overlap with approved stays, check-in not in the past, 60 nights max (`MAX_NIGHTS`).
- Free-tier limits are far above family use. If a push stops arriving, the app cleans up dead device tokens automatically.
