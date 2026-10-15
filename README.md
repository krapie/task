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

- **Routine board** — one list per day: Daily tasks, then Bonus, Tasks and today's Events as small labeled groups that only appear when they have items; a single add bar under the list switches between Daily / Bonus / Task. The list is left-aligned and at most 600px wide (full width on phones). It is sized for desktop windows from about 1000 × 680 up to 1280 × 710: the list scrolls inside while the add bar stays visible. Goals and Retro have their own tabs in the Tasks | Goals | Retro toggle. 6 day slots (Mon–Fri + Weekend) with recurring daily tasks that auto-reset at a configurable hour; drag to reorder; hide a routine for just the active day (it reappears at the next reset, is excluded from progress and the daily reminder, and can be restored from the collapsible "Hidden today" list)
- **Bonus tasks** — one-off task additions per day slot, separate from the recurring routine
- **Tasks** — global todo list with optional due dates shown alongside the routine board
- **Multi-day add** — add a daily task to multiple day slots at once from the quick-add input
- **Calendar** — monthly view with event management; supports weekly, monthly, and yearly recurring events
- **Goals** — three side-by-side columns of categorized goal lists: General (bucket list), Year, and Half (H1/H2 of the selected year), driven by a shared year selector with an add-year control. The Year column consolidates the selected year's half-year goals into its annual list by category name (shown read-only with an H1/H2 badge). Items support completion, strikethrough, and inline comments. Narrow screens collapse the columns into a General/Year/Half tab switcher
- **Mail** — IMAP inbox: add multiple accounts, read HTML email in a sandboxed iframe with dark mode, mark read/unread, mark all read. Syncs `INBOX` plus a `청구·결제` (bills/payments) folder where present, since some providers (Naver) auto-file statements there instead of INBOX. Sync runs in the background in mail-bridge, one at a time across all accounts in parallel (60s per-account timeout): every 5 minutes, on opening the Mail tab (skipped if the last sync finished under a minute ago), and on the Sync button (forced). `POST /api/mail/sync` (`{account_id?, force?}`) returns `202` at once; the UI polls `GET /api/mail/sync` until `running` is false
- **Mail conversations** — messages are grouped into one row per conversation (count badge when more than one), e.g. all comments of one GitHub PR. mail-bridge stores a `thread_id` per message: the first `References` entry, else `In-Reply-To`, else the message's own Message-ID (no subject matching, so unrelated mail never merges; threads are per account). Opening a conversation shows its messages oldest first with the newest and unread ones expanded, marks them all read, and translates each message on its own. Star on a row flags the thread (any flagged message → unflag all, else flag the latest). API: `GET /api/mail/threads`, `GET /api/mail/threads/items?account_id&thread_id`, `POST /api/mail/threads/read` and `/flag` (`{account_id, thread_id}` body; the id never goes in the path because Envoy unescapes `%2F` and redirects). Mail synced before threading is grouped after a one-time `POST /internal/backfill-threads` on mail-bridge (header-only IMAP fetch)
- **News** — GeekNews feed reader with article preview expansion and a flag/save-for-later list
- **Guest mode** — routine board (daily + bonus tasks) and calendar work with no account, stored in localStorage; News shows the public feed without flagging. Account-only features (Mail, Assets, Health, Goals, Tasks) are hidden from the nav, and a deep link to one shows a sign-in prompt
- **Push notifications** — Web Push for new email, the daily task digest and finance reminders. Each browser subscribes on its own (iOS needs the home-screen PWA); Settings → Mail lists every subscribed device (`GET /api/push/subscriptions`, labeled from the stored user agent), can remove any of them, and sends a test push to all of them (`POST /api/push/test`)
- **Sync** — sign in to persist data server-side and sync across devices
- **Sign-in** — central SSO at [auth.kevinprk.com](https://auth.kevinprk.com) (client `task`, `admins` group only). The web app exchanges the auth session for a 15-minute access token kept in memory (`GET /api/token?aud=task`); the API verifies it against the auth JWKS (`AUTH_ISSUER`)
- **Assets / Health step-up** — `/api/assets/*` and `/api/health-data/*` need a `step_up` token (`aud=task&step_up=1`), which auth issues only after a passkey check in the last 6 hours (the token itself lives 5 minutes and is re-issued without a prompt inside that window), **and** a username in `STEP_UP_USERS` (default `kevinprk`; anyone else gets 403). One unlock covers both tabs. The tabs are shown only to that account and open without a passkey, with every value masked and **no data request** until the passkey succeeds; Lock, backgrounding the app, 5 minutes idle or token expiry drop the fetched data from memory (unlocking again needs no passkey while the last check is under 6 hours old). Responses are `Cache-Control: no-store`. Passkeys are managed on the auth account page
- **Health** — Apple Health summary (activity rings, 7-day averages, last night's sleep, recent runs) from the `health` DB on store-postgres, read as role `health_task`, which can only `SELECT` the one view `hk_task_summary` (no raw samples, no GPS routes). See `~/homeserver/docs/health-dashboard.md`
- **Note** — owner-only group with two tabs, **Notes** (`#/note/notes`) and **Chats** (`#/note/chats[/<conversation id>]`; legacy `#/assistant/<id>` links still open it), `g n`. **Chats** is the chat with the operator's personal profile: asks about routines/tasks/goals/events, spending and assets, the investment portfolio, Apple Health, mail, news and the market, read-only. Same passkey step-up as Assets/Health (it reads both): locked until unlocked, `/api/assistant/*` (SSE chat, conversations, `PATCH /api/assistant/conversations/:id {title?, folder?}`) proxies to the operator with `PERSONAL_TOKEN`. A chat button at the bottom right of every other tab (owner only) opens the same conversation in a small panel (hidden on phones: use the tab); both share one state (`lib/assistantStore.ts`) and one lock (`kp-step-up` event). The conversation list is grouped into folders (auto-sorted, movable), its width is draggable and the sidebar can be closed. **Notes** is the owner's note editor, owner-only but without a passkey (`notes` table, formerly `assistant_memory`; `GET/POST /api/notes[?q=]`, `GET/PUT/DELETE /api/notes/:key`; search, live-preview Markdown editor (`MarkdownEditor.tsx`, CodeMirror 6, lazy-loaded), "Ask about this note"; `portfolio` is the one the Monday market check follows and cannot be deleted). The assistant searches the notes (`notes_search`, `note_get`) and can only draft changes, shown as an Apply / Dismiss card in Chats. The weekly recap (Sun 20:00 KST) and market check (Mon 21:00 KST) run from ops routines and arrive as conversations plus a push (`POST /internal/push`, bearer `INTERNAL_PUSH_TOKEN`). See `~/homeserver/docs/assistant.md`
- **Retro** — yearly retrospective as a third tab (`Tasks | Goals | Retro`, signed in): Keep / Problem / Try / Action items per year, each entry editable with a checkbox, a comment and a crossed-out state (dropped). Sections are fixed; the layout is 2×2 up to 1500px wide, 4 columns above, 1 column on phones; years are added with the `+` tab. Stored as a goal period with `kind = 'retro'` (`server/retro.js`, `POST /api/goals/periods` with `kind: 'retro'`; entries use the regular goal category/item endpoints)
- **Import / Export** — JSON export of all templates and board settings
- **Dark mode** — manual toggle; PWA install supported with status bar following theme

## Navigation

Eight views fold into six nav groups (left rail on desktop, bottom bar on phones); groups with several views show underline sub-tabs. The theme toggle sits at the bottom of the rail (on phones it is in Settings).

| Group | Views | Route |
|-------|-------|-------|
| Today | Routine (Tasks / Goals) | `#/today`, `#/today/goals` |
| Calendar | Calendar | `#/calendar`, `#/calendar/2026-10` |
| Inbox | Mail, News | `#/inbox/mail`, `#/inbox/news` |
| Life | Assets, Health (owner only, passkey step-up) | `#/life/assets`, `#/life/health` |
| Assistant | Assistant (owner only, passkey step-up) | `#/assistant`, `#/assistant/<conversation id>` |
| Settings | Settings | `#/settings` |

Every navigation is a history entry, so Back/Forward and reload keep your place. A group with one reachable view (News for guests) is named after it. The selected day tab is not in the URL: it follows the active slot. Legacy links with `?tab=<view>&mail=<id>` (push notifications) still work and are rewritten to the hash form (`src/lib/nav.ts`).

Keyboard (desktop, not while typing): `g` then `t` / `c` / `i` / `l` / `a` / `s` jumps to Today / Calendar / Inbox / Life / Assistant / Settings, `n` focuses the new-task input, `/` focuses mail search, `[` `]` change month in Calendar, `?` lists them. In the mail list `j` / `k` move the cursor, `Enter` opens, `e` marks read, `s` stars.

## UI building blocks

- `src/colors_and_type.css` is a copy of `~/homeserver/design/colors_and_type.css`; `index.css` only adds a dark lift for `--kp-danger` / `--kp-warning`. No hard-coded colors.
- `components/Icons.tsx` holds every Heroicon (one place, 18px default). `components/Ui.tsx` has `Dialog`, `Meter`, `Loading` (skeleton), `Empty` and the hosts mounted once in `App` (`ToastHost`, `DialogHost`, `LoadingBar`).
- `lib/notify.ts` is callable from anywhere without hooks: `notifyError` (use as `.catch(notifyError)`; logs and shows a toast), `notify`, `confirmDialog`, `promptDialog`. No native `confirm()` / `prompt()`.
- `lib/inflight.ts` counts in-flight API requests per scope (first path segment, e.g. `news`, `mail`) for the thin top progress bar. `LoadingBar` only listens to the scopes of the current tab (`scopesFor` in `lib/nav.ts`), so a refresh of another area never flashes it.
- Mail and News share one split layout (`split-view`, `split-sidebar`, `split-nav`, `split-toolbar` in `index.css`).
- `lib/recurrence.ts` expands recurring calendar events.
- UI text is English throughout (including Assets and Health); holiday names on the calendar stay Korean.
- Empty states use `Empty` (icon, title, hint, optional action) instead of a bare sentence; Assets and Health show one lock card with the passkey button until unlocked. Routine shows one compact empty state only when nothing at all is planned.
- Deleting a task, bonus task or todo, or hiding a routine for today, shows an Undo toast (`notify(..., { label: 'Undo', run })`). Undo of a delete re-creates the item, so group links and past completions are not restored.
- Phones get a slim top bar (π, current section, theme toggle). Row actions (edit, hide, delete, reorder) show on hover, on keyboard focus, and always on touch devices wider than 600px; on phones they appear after tapping the task text.
- Text is never below 12px (`--kp-text-2xs`); body-level gray text uses `--kp-fg-3`, `--kp-fg-4` is for placeholders, disabled and icon-only controls.
- Calendar week rows share the window height; the number of event lanes per day follows the row height (`maxLanes` in `CalendarView.tsx`), so 5- and 6-week months both fit without scrolling. Assets and Health use two columns from 900px.
- The Mail and News sidebars remember whether you collapsed them (per view, in this browser; phones always start with the overlay closed).

## Startup and sign-in

- `index.html` ships a boot screen (π, "Loading Task…", progress bar, theme set before paint) so the first paint is never blank; after 8 s it offers a Reload button. Fonts load from `<link>` tags there, not CSS `@import`.
- Auth state is `checking | in | out | error` (`App.tsx`). Without the `kp_auth` hint cookie the app starts as a guest at once; with it, a "Signing in…" screen (`StatusScreen`) shows until `/api/token` answers, so guest data never flashes before the account loads. The token request times out after 8 s; an unreachable auth shows Retry (and retries on focus) instead of silently dropping to guest. A real 401 switches to guest through `AUTH_LOST_EVENT`, without a page reload.
- Sign in / Sign out show "Opening sign-in…" / "Signing out…" right away while auth.kevinprk.com loads.
- `public/sw-v2.js` (cache `task-v3`): hashed `/assets/*` are cache-first; page loads are network-first with a 3 s fallback to the cached shell; API calls and cross-origin requests are never touched. nginx serves `sw*.js` with `no-cache`.
