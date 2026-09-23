import type { Template, Addition, Settings, ExportData, DailyData, Slot, CalendarEvent, Recurrence, MailAccount, MailItem, NewsItem, TodoItem, AgentTask, GoalPeriod, GoalCategory, GoalItem, AssetSummary, FinanceStatus, PasskeyCredential, FinanceNotifySettings } from '../types'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'

function getToken(): string | null {
  return localStorage.getItem('task_token')
}

function setToken(token: string) {
  localStorage.setItem('task_token', token)
}

function clearToken() {
  localStorage.removeItem('task_token')
}

let _refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      if (!res.ok) return null
      const { token } = await res.json()
      setToken(token)
      return token
    } catch {
      return null
    } finally {
      _refreshPromise = null
    }
  })()
  return _refreshPromise
}

function headers(token?: string | null): Record<string, string> {
  const t = token ?? getToken()
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: headers(),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/refresh') {
    const newToken = await refreshAccessToken()
    if (!newToken) {
      clearToken()
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

// The asset-scope token is deliberately memory-only, never localStorage —
// unlike the regular session token, a leaked copy of this one grants
// financial data directly with no further check. A page reload forces a
// fresh passkey prompt, which is the intended tradeoff for a 10-minute,
// high-sensitivity scope. AssetsView also clears this proactively on
// backgrounding (visibilitychange) and after 5 minutes idle.
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  auth: {
    login: async (username: string, password: string) => {
      const data = await req<{ token: string }>('POST', '/auth/login', { username, password })
      setToken(data.token)
      return data
    },
    me: () => req<{ username: string }>('GET', '/auth/me'),
    logout: async () => {
      await req<void>('POST', '/auth/logout')
      clearToken()
    },
    refresh: () => refreshAccessToken(),
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
    sync: (account_id?: string) => req<{ synced: number }>('POST', '/mail/sync', account_id ? { account_id } : {}),
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
  },
  agentq: {
    submit: (title: string, prompt: string, session?: string) => req<{ id: number }>('POST', '/agentq/tasks', { title, prompt, ...(session ? { session } : {}) }),
    list: () => req<{ tasks: AgentTask[] }>('GET', '/agentq/tasks'),
    get: (id: number) => req<AgentTask>('GET', `/agentq/tasks/${id}`),
  },
  passkey: {
    listCredentials: () => req<PasskeyCredential[]>('GET', '/auth/passkey/credentials'),
    removeCredential: (id: string) => req<void>('DELETE', `/auth/passkey/credentials/${id}`),
    // Registers a new passkey for THIS browser/device. Requires a normal
    // session only — this is how the asset scope is bootstrapped in the
    // first place, so it can't itself require an asset token.
    register: async (deviceName?: string) => {
      const optionsJSON = await req<Parameters<typeof startRegistration>[0]['optionsJSON']>(
        'POST', '/auth/passkey/register/options'
      )
      const response = await startRegistration({ optionsJSON })
      await req<{ ok: boolean }>('POST', '/auth/passkey/register/verify', { ...response, deviceName })
    },
    // Runs the passkey ceremony (Face ID / fingerprint / security key) and,
    // on success, stores the resulting 10-minute asset-scope token in
    // memory. Throws if the user cancels or verification fails.
    authenticate: async () => {
      const optionsJSON = await req<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
        'POST', '/auth/passkey/authenticate/options'
      )
      const response = await startAuthentication({ optionsJSON })
      const { assetToken, expiresIn } = await req<{ assetToken: string; expiresIn: number }>(
        'POST', '/auth/passkey/authenticate/verify', response
      )
      setAssetToken(assetToken, expiresIn)
    },
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
}
