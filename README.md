# Task

Daily task board at [task.kevinprk.com](https://task.kevinprk.com).

Set up recurring **Daily Tasks** per day-of-week that auto-reset at a configurable time. Add one-off **Bonus Tasks**, track calendar events, and read email — all in one place. Works in guest mode (localStorage) or with an account for cross-device sync.

## Features

### Board
- **6 day slots** — Mon, Tue, Wed, Thu, Fri, Weekend (Sat+Sun combined)
- **Daily Tasks** — recurring templates that reset automatically each day (default 6 AM local time)
- **Bonus Tasks** — one-off additions per day
- **Multi-day add** — toggle which days a new task applies to and add to all at once

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
│   │   ├── QuestBoard.tsx
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
| `TASK_USERNAME` | No | Username override (default: `kevinprk`) |
| `PORT` | No | Server port (default: `3000`) |

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

Push to `main` → GitHub Actions builds and pushes `krapi0314/task-api:<sha>` and `krapi0314/task-web:<sha>` to Docker Hub → updates `deployment.yaml` in [krapie/homeserver](https://github.com/krapie/homeserver) → ArgoCD syncs to the cluster.
