# Task

Personal daily task board.

Set up recurring **Daily Tasks** per day-of-week that auto-reset at a configurable time. Add one-off **Bonus Tasks** and plain **Tasks** (todos with due dates), track calendar events, queue coding work for an [agentq](https://github.com/krapie/agentq) agent, read email, and browse news — all in one place. Works in guest mode (localStorage) or with an account for cross-device sync.

## Features

### Routine (board)
- **6 day slots** — Mon, Tue, Wed, Thu, Fri, Weekend (Sat+Sun combined)
- **Daily Tasks** — recurring templates that reset automatically each day (default 6 AM local time)
- **Bonus Tasks** — one-off additions per day
- **Tasks** — a plain todo list (independent of the day slots) with optional due dates, shown alongside Bonus Tasks
- **Multi-day add** — toggle which days a new task applies to and add to all at once

### Agent
- Enqueue coding tasks (title + prompt) to a locally-running [agentq](https://github.com/krapie/agentq) daemon and track their status (queued, running, waiting on quota, done, failed) without leaving the app
- Filter tasks by session, and target a specific session when submitting a new task
- The task-api server signs a short-lived JWT server-side and proxies requests to agentq — the frontend never holds agentq credentials

### News
- GeekNews (news.hada.io) feed reader with a link preview pulled from the article page
- Flag/save articles for later; flags persist server-side

### Calendar
- Monthly calendar view with event management
- Recurring events — weekly, monthly, or yearly
- Events appear as bonus tasks on the board view on their scheduled day

### Mail
- IMAP inbox aggregator — add multiple accounts (Gmail, Naver, etc.)
- HTML email rendering in a sandboxed iframe (JS blocked, external images allowed)
- Dark mode email inversion — email content matches the app theme
- Auto-sync on tab open + background polling every 5 minutes
- Periodic frontend refresh every 3 minutes

### General
- **Guest mode** — fully functional with no account; state lives in localStorage
- **Authenticated mode** — sign in to persist data server-side across devices
- **Import / Export** — JSON export of all templates and settings
- **Dark / light mode** — manual toggle, PWA top bar follows theme

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite + React 19 + TypeScript |
| API | Node.js + Express |
| Mail bridge | Node.js + Express + imapflow + mailparser |
| Database | PostgreSQL (pg Pool) |
| Auth | JWT access tokens (15 min) + HTTPOnly refresh cookies (30 days) + bcrypt |
| Rate limiting | In-memory, 10 req/60s per IP on login |
| Mail encryption | AES-256-GCM for IMAP credentials at rest |
| Container | Docker (multi-stage build for frontend) |
| Deploy | Kubernetes via ArgoCD GitOps |

## Project Structure

```
.
├── server/
│   └── index.js          # Express API + mail proxy → mail-bridge
├── src/
│   ├── components/       # React UI components
│   │   ├── MailInbox.tsx # IMAP inbox with sandboxed HTML rendering
│   │   ├── CalendarView.tsx
│   │   ├── RoutineBoard.tsx # Daily/Bonus/Tasks board (Routine tab)
│   │   ├── TaskView.tsx  # Agent task queue UI (Agent tab, agentq integration)
│   │   ├── NewsView.tsx  # GeekNews reader (News tab)
│   │   └── ...
│   ├── lib/
│   │   ├── api.ts        # Authenticated API client with auto-refresh
│   │   ├── slots.ts      # Day/slot/date utilities
│   │   └── storage.ts    # localStorage guest mode
│   ├── types.ts
│   ├── App.tsx
│   └── index.css
├── public/
├── Dockerfile.api        # API server image
├── Dockerfile.web        # Nginx static frontend image
├── nginx.conf
└── vite.config.ts
```

The mail feature is served by a separate **mail-bridge** microservice at [`krapie/mail-bridge`](https://github.com/krapie/mail-bridge). The task API proxies all `/api/mail/*` requests to it internally.

## Local Setup

```bash
npm install
npm run dev       # frontend dev server (proxies /api → localhost:3000)

# in another terminal:
POSTGRES_URL=postgresql://... \
TASK_PASSWORD=yourpassword \
JWT_SECRET=yoursecret \
JWT_REFRESH_SECRET=yoursecret2 \
MAIL_BRIDGE_URL=http://localhost:3001 \
INTERNAL_API_KEY=yourkey \
node server/index.js
```

## Environment Variables

### task-api

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` | Yes | PostgreSQL connection string |
| `TASK_PASSWORD` | Yes | Account password (bcrypt hash or plain text) |
| `JWT_SECRET` | Yes | Secret for signing 15-min access tokens |
| `JWT_REFRESH_SECRET` | Yes | Secret for signing 30-day refresh tokens |
| `MAIL_BRIDGE_URL` | Yes | Internal URL of the mail-bridge service |
| `INTERNAL_API_KEY` | Yes | Shared key for task-api → mail-bridge requests |
| `TASK_USERNAME` | No | Username displayed in the UI (default: `admin`) |
| `PORT` | No | Server port (default: `3000`) |
| `AGENTQ_URL` | No | Base URL of the agentq daemon's API (default: `http://192.168.0.17:8888`) |
| `AGENTQ_JWT_SECRET` | No | HMAC secret shared with agentq for signing proxied requests; Agent tab endpoints return `503` if unset |

### mail-bridge

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` | Yes | PostgreSQL connection string (separate DB) |
| `INTERNAL_API_KEY` | Yes | Must match task-api's value |
| `MAIL_ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM credential encryption |
| `PORT` | No | Server port (default: `3001`) |

## API Reference

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Sign in, returns access token + sets refresh cookie |
| POST | `/api/auth/refresh` | cookie | Refresh access token |
| POST | `/api/auth/logout` | ✓ | Invalidate refresh token |
| GET | `/api/auth/me` | ✓ | Verify token, returns username |

### Board
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/templates` | ✓ | All templates grouped by slot |
| POST | `/api/templates` | ✓ | Create template |
| PUT | `/api/templates/:id` | ✓ | Update template text |
| DELETE | `/api/templates/:id` | ✓ | Delete template |
| PUT | `/api/templates/reorder` | ✓ | Reorder within a slot |
| GET | `/api/daily/:slotDate` | ✓ | Daily data for a date (YYYY-MM-DD) |
| POST | `/api/daily/additions` | ✓ | Add bonus task |
| PUT | `/api/daily/additions/:id` | ✓ | Edit bonus task |
| DELETE | `/api/daily/additions/:id` | ✓ | Delete bonus task |
| POST | `/api/daily/toggle` | ✓ | Toggle task completion |
| GET | `/api/daily/additions/range` | ✓ | Bonus tasks in a date range |

### Calendar
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/events` | ✓ | All events |
| POST | `/api/events` | ✓ | Create event |
| PUT | `/api/events/:id` | ✓ | Update event |
| DELETE | `/api/events/:id` | ✓ | Delete event |
| POST | `/api/events/:id/toggle` | ✓ | Toggle event completion for a date |

### Tasks (todos)
| Method | Path | Auth | Description |
|--------|------|------|--------------|
| GET | `/api/todos` | ✓ | List todos (incomplete first, then newest) |
| POST | `/api/todos` | ✓ | Create todo (`text`, optional `due_date`) |
| PATCH | `/api/todos/:id` | ✓ | Update `text` / `completed` / `due_date` |
| DELETE | `/api/todos/:id` | ✓ | Delete todo |

### Agent (proxied to agentq)
| Method | Path | Auth | Description |
|--------|------|------|--------------|
| POST | `/api/agentq/tasks` | ✓ | Enqueue a task (`title`, `prompt`, optional `session`) |
| GET | `/api/agentq/tasks` | ✓ | List tasks, optionally filtered by `?status=` |
| GET | `/api/agentq/tasks/:id` | ✓ | Get a single task |

Returns `503` if `AGENTQ_JWT_SECRET` isn't configured, `502` if the agentq daemon is unreachable.

### News
| Method | Path | Auth | Description |
|--------|------|------|--------------|
| GET | `/api/news` | — | GeekNews feed with previews (5-min server cache) |
| GET | `/api/news/flagged` | ✓ | List flagged/saved articles |
| POST | `/api/news/flag` | ✓ | Flag/save an article |
| POST | `/api/news/unflag` | ✓ | Unflag an article |

### Mail (proxied to mail-bridge)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/mail/accounts` | ✓ | List IMAP accounts |
| POST | `/api/mail/accounts` | ✓ | Add IMAP account |
| DELETE | `/api/mail/accounts/:id` | ✓ | Remove account |
| GET | `/api/mail/items` | ✓ | List mail items (filterable by account, unread) |
| GET | `/api/mail/items/:id` | ✓ | Get single item with full body + HTML |
| POST | `/api/mail/items/:id/read` | ✓ | Mark as read |
| POST | `/api/mail/sync` | ✓ | Trigger IMAP sync |

### Settings & Data
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | ✓ | Get settings |
| PUT | `/api/settings` | ✓ | Update settings |
| GET | `/api/export` | ✓ | Export templates + settings as JSON |
| POST | `/api/import` | ✓ | Import JSON (merge or replace) |

## CI/CD

Push to `main` → GitHub Actions builds and pushes `task-api:<sha>` and `task-web:<sha>` to Docker Hub → updates `deployment.yaml` in the GitOps repo → ArgoCD syncs to the cluster.
