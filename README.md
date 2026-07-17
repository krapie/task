# Task

Personal daily task board that combines recurring routines, one-off tasks, calendar events, agent coding tasks, email, and news into a single interface. Works offline in guest mode (localStorage) and syncs across devices when signed in. **Live:** [task.kevinprk.com](https://task.kevinprk.com)

## Getting Started

```bash
# Frontend
npm install
npm run dev   # http://localhost:5173, proxies /api → localhost:3000

# API (separate terminal)
node server/index.js
```

## Features

- **Routine board** — 6 day slots (Mon–Fri + Weekend) with recurring daily tasks that auto-reset at a configurable hour; drag to reorder
- **Bonus tasks** — one-off task additions per day slot, separate from the recurring routine
- **Tasks** — global todo list with optional due dates shown alongside the routine board
- **Multi-day add** — add a daily task to multiple day slots at once from the quick-add input
- **Calendar** — monthly view with event management; supports weekly, monthly, and yearly recurring events
- **Agent** — queue coding tasks for a local [agentq](https://github.com/krapie/agentq) daemon and track run status, session, and PR link in real time
- **Mail** — IMAP inbox: add multiple accounts, read HTML email in a sandboxed iframe with dark mode, mark read/unread, mark all read
- **News** — GeekNews feed reader with article preview expansion and a flag/save-for-later list
- **Guest mode** — fully functional with no account; all state stored in localStorage
- **Sync** — sign in to persist data server-side and sync across devices
- **Import / Export** — JSON export of all templates and board settings
- **Dark mode** — manual toggle; PWA install supported with status bar following theme
