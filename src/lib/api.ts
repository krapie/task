import { trackInflight } from './inflight'
import type { Template, Addition, Settings, ExportData, DailyData, Slot, CalendarEvent, Recurrence, MailAccount, MailItem, MailSyncStatus, NewsItem, TodoItem, GoalPeriod, GoalCategory, GoalItem, AssetSummary, FinanceStatus, FinanceNotifySettings, HealthSummary, PushDevice } from '../types'

// Sign-in is on auth.kevinprk.com. Its session cookie (host-only on auth,
// same-site with task) is exchanged for a 15-minute access token that lives
// only in memory. Task also works signed out, so a missing session is not an
// error here: callers just stay in local mode.
const AUTH_URL = 'https://auth.kevinprk.com'

type TokenResponse = {
  access_token: string
  expires_in: number
  user: { username: string }
  error?: string
  login_url?: string
}

let _token: string | null = null
let _tokenExpiresAt = 0
let _username: string | null = null
let _tokenPromise: Promise<string | null> | null = null

function tokenURL(stepUp: boolean, returnTo: string): string {
  return `${AUTH_URL}/api/token?aud=task${stepUp ? '&step_up=1' : ''}&return=${encodeURIComponent(returnTo)}`
}

// Returns a valid access token, refreshing it near expiry. null = signed out.
async function ensureToken(force = false): Promise<string | null> {
  if (!force && _token && _tokenExpiresAt - 60_000 > Date.now()) return _token
  if (_tokenPromise) return _tokenPromise
  _tokenPromise = (async () => {
    try {
      const res = await fetch(tokenURL(false, location.href), { credentials: 'include' })
      if (!res.ok) {
        _token = null
        _username = null
        return null
      }
      const data = (await res.json()) as TokenResponse
      _token = data.access_token
      _tokenExpiresAt = Date.now() + data.expires_in * 1000
      _username = data.user.username
      return _token
    } catch {
      return null
    } finally {
      _tokenPromise = null
    }
  })()
  return _tokenPromise
}

function headers(token?: string | null): Record<string, string> {
  const t = token ?? _token
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  }
}

const req = <T,>(method: string, path: string, body?: unknown): Promise<T> => trackInflight(reqInner<T>(method, path, body))

async function reqInner<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (_token) await ensureToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: headers(),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && _token) {
    const newToken = await ensureToken(true)
    if (!newToken) {
      window.location.reload()
      throw new Error('Session expired')
    }
    const retry = await fetch(`/api${path}`, {
      method,
      headers: headers(newToken),
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!retry.ok) {
      const err = await retry.json().catch(() => ({ error: retry.statusText }))
      throw new Error((err as { error?: string }).error ?? retry.statusText)
    }
    return retry.json() as Promise<T>
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

// The step-up token (Assets + Health share it) is deliberately memory-only,
// never localStorage — unlike the regular session token, a leaked copy of
// this one grants financial and health data directly with no further check.
// A page reload forces a fresh passkey check, which is the intended tradeoff
// for a 5-minute, high-sensitivity scope. useStepUp also clears it
// proactively on backgrounding (visibilitychange) and after 5 minutes idle.
export type StepUpView = 'assets' | 'health'
const STEP_UP_PENDING = 'task-step-up-pending'
let _assetToken: string | null = null
let _assetTokenExpiresAt = 0

export function setAssetToken(token: string, expiresInSec: number) {
  _assetToken = token
  _assetTokenExpiresAt = Date.now() + expiresInSec * 1000
}
export function clearAssetToken() {
  _assetToken = null
  _assetTokenExpiresAt = 0
}
export function hasAssetToken(): boolean {
  return Boolean(_assetToken) && Date.now() < _assetTokenExpiresAt
}
export function assetTokenRemainingMs(): number {
  return Math.max(0, _assetTokenExpiresAt - Date.now())
}

async function assetReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!hasAssetToken()) {
    clearAssetToken()
    throw new Error('ASSET_SESSION_EXPIRED')
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_assetToken}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    clearAssetToken()
    throw new Error('ASSET_SESSION_EXPIRED')
  }
  if (res.status === 403) {
    // Valid passkey, but this account may not see personal data.
    clearAssetToken()
    throw new Error('STEP_UP_FORBIDDEN')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  auth: {
    // Resolves the current SSO session without redirecting (null = signed out).
    session: async (): Promise<{ username: string } | null> => {
      const t = await ensureToken(true)
      return t && _username ? { username: _username } : null
    },
    me: () => req<{ username: string }>('GET', '/auth/me'),
    signIn: () => {
      location.assign(`${AUTH_URL}/login?redirect=${encodeURIComponent(location.href)}`)
    },
    // Ends the central session (every kevinprk.com app), then returns here.
    signOut: () => {
      _token = null
      location.assign(`${AUTH_URL}/logout?redirect=${encodeURIComponent(location.origin + '/')}`)
    },
  },
  templates: {
    getAll: () => req<Record<Slot, Template[]>>('GET', '/templates'),
    create: (slot: Slot, text: string) => req<Template>('POST', '/templates', { slot, text }),
    update: (id: string, text: string) => req<Template>('PUT', `/templates/${id}`, { text }),
    remove: (id: string) => req<void>('DELETE', `/templates/${id}`),
    reorder: (slot: Slot, ids: string[]) => req<void>('PUT', '/templates/reorder', { slot, ids }),
    link: (id: string, targetId: string) => req<Template[]>('POST', `/templates/${id}/link`, { target_id: targetId }),
    unlink: (id: string) => req<{ ok: boolean }>('DELETE', `/templates/${id}/link`),
  },
  daily: {
    get: (slotDate: string) => req<DailyData>('GET', `/daily/${slotDate}`),
    addAddition: (slotDate: string, text: string) =>
      req<Addition>('POST', '/daily/additions', { slotDate, text }),
    updateAddition: (id: string, text: string) =>
      req<Addition>('PUT', `/daily/additions/${id}`, { text }),
    removeAddition: (id: string) => req<void>('DELETE', `/daily/additions/${id}`),
    toggleTemplate: (templateId: string, slotDate: string, completed: boolean) =>
      req<{ ok: boolean; groupCompleted: string[] }>('POST', '/daily/toggle', { type: 'template', id: templateId, slotDate, completed }),
    skipTemplate: (templateId: string, slotDate: string, skipped: boolean) =>
      req<{ ok: boolean }>('POST', '/daily/skip', { id: templateId, slotDate, skipped }),
    toggleAddition: (additionId: string, completed: boolean) =>
      req<void>('POST', '/daily/toggle', { type: 'addition', id: additionId, completed }),
    getAdditionsRange: (from: string, to: string) =>
      req<Addition[]>('GET', `/daily/additions/range?from=${from}&to=${to}`),
  },
  events: {
    getAll: () => req<CalendarEvent[]>('GET', '/events'),
    create: (data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) =>
      req<CalendarEvent>('POST', '/events', data),
    update: (id: string, data: { title: string; start_date: string; end_date: string; time?: string; recurrence?: Recurrence }) =>
      req<CalendarEvent>('PUT', `/events/${id}`, data),
    remove: (id: string) => req<void>('DELETE', `/events/${id}`),
    toggle: (id: string, slot_date: string, completed: boolean) =>
      req<void>('POST', `/events/${id}/toggle`, { slot_date, completed }),
  },
  settings: {
    get: () => req<Settings>('GET', '/settings'),
    update: (s: Partial<Settings>) => req<Settings>('PUT', '/settings', s),
  },
  export: () => req<ExportData>('GET', '/export'),
  import: (data: ExportData, mode: 'merge' | 'replace') =>
    req<void>('POST', '/import', { data, mode }),
  mail: {
    getAccounts: () => req<MailAccount[]>('GET', '/mail/accounts'),
    addAccount: (data: Omit<MailAccount, 'id' | 'last_synced'>) =>
      req<MailAccount>('POST', '/mail/accounts', data),
    removeAccount: (id: string) => req<void>('DELETE', `/mail/accounts/${id}`),
    getItems: (params?: { account_id?: string; unread?: boolean; flagged?: boolean; limit?: number; offset?: number }) => {
      const q = new URLSearchParams()
      if (params?.account_id) q.set('account_id', params.account_id)
      if (params?.unread !== undefined) q.set('unread', String(params.unread))
      if (params?.flagged !== undefined) q.set('flagged', String(params.flagged))
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))
      return req<MailItem[]>('GET', `/mail/items?${q}`)
    },
    getItem: (id: string) => req<MailItem>('GET', `/mail/items/${id}`),
    markRead: (id: string) => req<void>('POST', `/mail/items/${id}/read`),
    toggleFlag: (id: string) => req<{ flagged: boolean }>('POST', `/mail/items/${id}/flag`),
    // Starts a background sync (or joins the running one); poll syncStatus until running is false.
    sync: (opts?: { account_id?: string; force?: boolean }) => req<MailSyncStatus>('POST', '/mail/sync', opts ?? {}),
    syncStatus: () => req<MailSyncStatus>('GET', '/mail/sync'),
    translate: (id: string, target: 'ko' | 'en') =>
      req<{ translated: string; html: string | null; lang: string; cached: boolean }>('POST', `/mail/items/${id}/translate`, { target }),
  },
  todos: {
    getAll: () => req<TodoItem[]>('GET', '/todos'),
    create: (text: string, due_date?: string) => req<TodoItem>('POST', '/todos', { text, due_date }),
    update: (id: string, data: Partial<Pick<TodoItem, 'text' | 'completed' | 'due_date'>>) =>
      req<TodoItem>('PATCH', `/todos/${id}`, data),
    remove: (id: string) => req<void>('DELETE', `/todos/${id}`),
  },
  news: {
    getItems: () => req<NewsItem[]>('GET', '/news'),
    getFlagged: () => req<NewsItem[]>('GET', '/news/flagged'),
    flag: (item: Pick<NewsItem, 'link' | 'title' | 'author' | 'published' | 'preview'>) =>
      req<{ flagged: boolean }>('POST', '/news/flag', item),
    unflag: (link: string) => req<{ flagged: boolean }>('POST', '/news/unflag', { link }),
  },
  goals: {
    getAll: () => req<GoalPeriod[]>('GET', '/goals'),
    createPeriod: (year: number, half?: 1 | 2) => req<GoalPeriod>('POST', '/goals/periods', { year, half: half ?? null }),
    getOrCreateGeneral: () => req<GoalPeriod>('POST', '/goals/periods/general'),
    // Yearly retrospective: one period per year with Keep / Problem / Try / Action Items categories.
    // An API that predates retros ignores `kind` and answers with a yearly goals period; refuse that instead of showing it as a retro.
    getOrCreateRetro: (year: number) => req<GoalPeriod>('POST', '/goals/periods', { year, kind: 'retro' }).then(p => {
      if (p.kind !== 'retro') throw new Error('The server does not support retros yet. Try again in a minute.')
      return p
    }),
    deletePeriod: (id: string) => req<void>('DELETE', `/goals/periods/${id}`),
    createCategory: (period_id: string, name: string) => req<GoalCategory>('POST', '/goals/categories', { period_id, name }),
    updateCategory: (id: string, name: string) => req<GoalCategory>('PUT', `/goals/categories/${id}`, { name }),
    deleteCategory: (id: string) => req<void>('DELETE', `/goals/categories/${id}`),
    createItem: (category_id: string, text: string) => req<GoalItem>('POST', '/goals/items', { category_id, text }),
    updateItem: (id: string, data: Partial<Pick<GoalItem, 'text' | 'completed' | 'crossed_out' | 'note'>>) =>
      req<GoalItem>('PUT', `/goals/items/${id}`, data),
    deleteItem: (id: string) => req<void>('DELETE', `/goals/items/${id}`),
  },
  push: {
    getVapidKey: () => req<{ key: string }>('GET', '/push/vapid-key'),
    subscribe: (sub: PushSubscriptionJSON) => req<{ ok: boolean }>('POST', '/push/subscribe', sub),
    unsubscribe: (endpoint: string) => req<{ ok: boolean }>('DELETE', '/push/unsubscribe', { endpoint }),
    test: () => req<{ sent: number }>('POST', '/push/test'),
    list: () => req<{ subscriptions: PushDevice[] }>('GET', '/push/subscriptions').then(r => r.subscriptions),
  },
  passkey: {
    // Step-up for the Assets and Health tabs: auth issues a step_up token only
    // if a passkey was used in the last 5 minutes (it expires 5 minutes after
    // that check). Otherwise the browser goes to auth for a passkey prompt and
    // comes back to ?tab=<view>, where useStepUp retries automatically.
    authenticate: async (view: StepUpView) => {
      const returnTo = `${location.origin}/?tab=${view}`
      const res = await fetch(tokenURL(true, returnTo), { credentials: 'include' })
      const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse>
      if (res.ok && data.access_token && data.expires_in) {
        setAssetToken(data.access_token, data.expires_in)
        return
      }
      if (data.login_url) {
        sessionStorage.setItem(STEP_UP_PENDING, view)
        location.assign(data.login_url)
        throw new Error('REDIRECTING')
      }
      throw new Error(data.error === 'access_denied' ? 'This account has no access to Task.' : 'Passkey unlock failed')
    },
    // Set before leaving for the auth passkey prompt; consumed on return by
    // the view that started it.
    takeUnlockPending: (view: StepUpView): boolean => {
      const pending = sessionStorage.getItem(STEP_UP_PENDING) === view
      if (pending) sessionStorage.removeItem(STEP_UP_PENDING)
      return pending
    },
    manageURL: `${AUTH_URL}/account`,
  },
  assets: {
    hasToken: hasAssetToken,
    clearToken: clearAssetToken,
    remainingMs: assetTokenRemainingMs,
    getSummary: () => assetReq<AssetSummary>('GET', '/assets/summary'),
    getStatus: () => assetReq<FinanceStatus>('GET', '/assets/status'),
    sync: () => assetReq<{ rowsTotal: number; rowsNew: number; rowsUpdated: number; sourceFile: string }>('POST', '/assets/sync'),
    getPasswordStatus: () => assetReq<{ isSet: boolean }>('GET', '/assets/password'),
    setPassword: (password: string) => assetReq<{ ok: boolean }>('POST', '/assets/password', { password }),
    getNotifySettings: () => assetReq<FinanceNotifySettings>('GET', '/assets/notify-settings'),
    updateNotifySettings: (s: Partial<FinanceNotifySettings>) => assetReq<{ ok: boolean }>('POST', '/assets/notify-settings', s),
  },
  health: {
    getSummary: () => assetReq<HealthSummary | null>('GET', '/health-data/summary'),
  },
}
