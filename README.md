# Task

Personal daily task board. **Live:** [task.kevinprk.com](https://task.kevinprk.com)

Works in guest mode (localStorage) or with an account for cross-device sync.

## Features

| Feature | Description |
|---------|-------------|
| **Routine board** | 6 day slots (Mon–Fri, Weekend) with recurring daily tasks that auto-reset at a configurable time |
| **Bonus tasks** | One-off task additions per day slot |
| **Tasks** | Todo list with optional due dates, shown alongside the routine board |
| **Multi-day add** | Add a daily task to multiple day slots at once |
| **Calendar** | Monthly view with event management; weekly, monthly, and yearly recurring events |
| **Agent** | Queue coding tasks for a local [agentq](https://github.com/krapie/agentq) daemon and track status in real time |
| **Mail** | IMAP inbox — add multiple accounts, read HTML email in a sandboxed iframe with dark mode |
| **News** | GeekNews feed reader with article previews and flag/save for later |
| **Guest mode** | Fully functional with no account — state stored in localStorage |
| **Sync** | Sign in to persist data server-side and sync across devices |
| **Import / Export** | JSON export of all templates and settings |
| **Dark mode** | Manual toggle; PWA status bar follows theme |

## Getting Started

```bash
npm install
npm run dev   # frontend at localhost:5173, proxies /api → localhost:3000
```

```bash
# in a separate terminal — start the API
node server/index.js
```
