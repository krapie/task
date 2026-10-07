# Task

Personal daily task board that combines recurring routines, one-off tasks, calendar events, email, and news into a single interface. Works offline in guest mode (localStorage) and syncs across devices when signed in. **Live:** [task.kevinprk.com](https://task.kevinprk.com)

## Getting Started

```bash
# Frontend
npm install
npm run dev   # http://localhost:5173, proxies /api → localhost:3000

# API (separate terminal)
node server/index.js
```

## Features

- **Routine board** — 6 day slots (Mon–Fri + Weekend) with recurring daily tasks that auto-reset at a configurable hour; drag to reorder; hide a routine for just the active day (it reappears at the next reset, is excluded from progress and the daily reminder, and can be restored from the collapsible "Hidden today" list)
- **Bonus tasks** — one-off task additions per day slot, separate from the recurring routine
- **Tasks** — global todo list with optional due dates shown alongside the routine board
- **Multi-day add** — add a daily task to multiple day slots at once from the quick-add input
- **Calendar** — monthly view with event management; supports weekly, monthly, and yearly recurring events
- **Goals** — three side-by-side columns of categorized goal lists: General (bucket list), Year, and Half (H1/H2 of the selected year), driven by a shared year selector with an add-year control. The Year column consolidates the selected year's half-year goals into its annual list by category name (shown read-only with an H1/H2 badge). Items support completion, strikethrough, and inline comments. Narrow screens collapse the columns into a General/Year/Half tab switcher
- **Mail** — IMAP inbox: add multiple accounts, read HTML email in a sandboxed iframe with dark mode, mark read/unread, mark all read. Syncs `INBOX` plus a `청구·결제` (bills/payments) folder where present, since some providers (Naver) auto-file statements there instead of INBOX. Sync runs in the background in mail-bridge, one at a time across all accounts in parallel (60s per-account timeout): every 5 minutes, on opening the Mail tab (skipped if the last sync finished under a minute ago), and on the Sync button (forced). `POST /api/mail/sync` (`{account_id?, force?}`) returns `202` at once; the UI polls `GET /api/mail/sync` until `running` is false
- **News** — GeekNews feed reader with article preview expansion and a flag/save-for-later list
- **Guest mode** — routine board (daily + bonus tasks) and calendar work with no account, stored in localStorage; News shows the public feed without flagging. Account-only features (Mail, Assets, Goals, Tasks) are hidden from the nav, and a deep link to one shows a sign-in prompt
- **Push notifications** — Web Push for new email, the daily task digest and finance reminders. Each browser subscribes on its own (iOS needs the home-screen PWA); Settings → Mail lists every subscribed device (`GET /api/push/subscriptions`, labeled from the stored user agent), can remove any of them, and sends a test push to all of them (`POST /api/push/test`)
- **Sync** — sign in to persist data server-side and sync across devices
- **Sign-in** — central SSO at [auth.kevinprk.com](https://auth.kevinprk.com) (client `task`, `admins` group only). The web app exchanges the auth session for a 15-minute access token kept in memory (`GET /api/token?aud=task`); the API verifies it against the auth JWKS (`AUTH_ISSUER`)
- **Asset step-up** — `/api/assets/*` needs a `step_up` token (`aud=task&step_up=1`), which auth issues only after a passkey check in the last 5 minutes and which expires 5 minutes after it. Passkeys are managed on the auth account page
- **Import / Export** — JSON export of all templates and board settings
- **Dark mode** — manual toggle; PWA install supported with status bar following theme
