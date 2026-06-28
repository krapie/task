# Task

RPG-style daily task board at [task.kevinprk.com](https://task.kevinprk.com).

Set up recurring **Daily Tasks** per day-of-week (Mon, Tue, Wed, Thu, Fri, Sat/Sun) that auto-reset at a configurable time each day. Add one-off **Bonus Tasks** to any day. Works without an account (localStorage) or sign in to sync across devices.

## Features

- **6 day slots** — Mon, Tue, Wed, Thu, Fri, Weekend (Sat+Sun combined)
- **Daily Tasks** — recurring templates that reset automatically each day (default 6 AM local time)
- **Bonus Tasks** — one-off additions per day, visible on every day tab
- **Multi-day add** — when adding a daily task, toggle which days it applies to and add to all at once
- **Guest mode** — fully functional with no account; state lives in localStorage
- **Authenticated mode** — sign in as `kevinprk` to persist data server-side across devices
- **Import / Export** — JSON export of all templates and settings for backup or migration
- **Dark mode** — follows system preference, with manual toggle

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite + React 19 + TypeScript |
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (30-day expiry) + bcrypt |
| Container | Single Docker image (build → node runner) |
| Deploy | Kubernetes via ArgoCD GitOps |

## Project Structure

```
.
├── server/
│   └── index.js          # Express API + SQLite, serves React build
├── src/
│   ├── components/       # React UI components
│   ├── lib/
│   │   ├── api.ts        # Authenticated API client
│   │   ├── slots.ts      # Day/slot/date utilities
│   │   └── storage.ts    # localStorage guest mode
│   ├── types.ts
│   ├── App.tsx
│   └── index.css
├── public/
├── Dockerfile
└── vite.config.ts
```

## Local Setup

```bash
npm install
npm run dev       # frontend dev server (proxies /api → localhost:3000)

# in another terminal:
TASK_PASSWORD=yourpassword JWT_SECRET=yoursecret npm run server
```

The dev server proxies `/api/*` to `localhost:3000`, so both run simultaneously.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TASK_PASSWORD` | Yes (auth) | Password for the `kevinprk` account. Accepts bcrypt hash or plain text. |
| `JWT_SECRET` | Yes (auth) | Secret for signing JWT tokens. |
| `TASK_USERNAME` | No | Username override (default: `kevinprk`). |
| `DB_PATH` | No | Path to SQLite database file (default: `../task.db`). |
| `PORT` | No | Server port (default: `3000`). |

For production, provide `TASK_PASSWORD` as a bcrypt hash:
```bash
node -e "const b = require('bcryptjs'); b.hash('yourpassword', 10).then(console.log)"
```

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Sign in, returns JWT |
| GET | `/api/auth/me` | ✓ | Verify token |
| GET | `/api/templates` | ✓ | Get all templates grouped by slot |
| POST | `/api/templates` | ✓ | Create template |
| PUT | `/api/templates/:id` | ✓ | Update template text |
| DELETE | `/api/templates/:id` | ✓ | Delete template |
| PUT | `/api/templates/reorder` | ✓ | Reorder templates within a slot |
| GET | `/api/daily/:slotDate` | ✓ | Get daily data for a date (YYYY-MM-DD) |
| POST | `/api/daily/additions` | ✓ | Add a bonus task |
| DELETE | `/api/daily/additions/:id` | ✓ | Delete a bonus task |
| PUT | `/api/daily/toggle` | ✓ | Toggle daily task completion |
| PUT | `/api/daily/toggle-addition` | ✓ | Toggle bonus task completion |
| GET | `/api/settings` | ✓ | Get settings |
| PUT | `/api/settings` | ✓ | Update settings |
| GET | `/api/export` | ✓ | Export templates + settings as JSON |
| POST | `/api/import` | ✓ | Import JSON (merge or replace) |

## CI/CD

Push to `main` → GitHub Actions builds and pushes `krapi0314/task:<sha>` to Docker Hub → updates `deployment.yaml` in [krapie/homeserver](https://github.com/krapie/homeserver) → ArgoCD syncs to the cluster.
