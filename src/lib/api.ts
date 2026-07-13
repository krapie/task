import type { Template, Addition, Settings, ExportData, DailyData, Slot, CalendarEvent, Recurrence, MailAccount, MailItem, NewsItem, TodoItem, AgentTask } from '../types'

function getToken(): string | null {
  return localStorage.getItem('task_token')
}

function setToken(token: string) {
  localStorage.setItem('task_token', token)
}

function clearToken() {
  localStorage.removeItem('task_token')
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    if (!res.ok) return null
    const { token } = await res.json()
    setToken(token)
    return token
  } catch {
    return null
  }
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
  },
  daily: {
    get: (slotDate: string) => req<DailyData>('GET', `/daily/${slotDate}`),
    addAddition: (slotDate: string, text: string) =>
      req<Addition>('POST', '/daily/additions', { slotDate, text }),
    updateAddition: (id: string, text: string) =>
      req<Addition>('PUT', `/daily/additions/${id}`, { text }),
    removeAddition: (id: string) => req<void>('DELETE', `/daily/additions/${id}`),
    toggleTemplate: (templateId: string, slotDate: string, completed: boolean) =>
      req<void>('POST', '/daily/toggle', { type: 'template', id: templateId, slotDate, completed }),
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
  agentq: {
    submit: (title: string, prompt: string) => req<{ id: number }>('POST', '/agentq/tasks', { title, prompt }),
    list: () => req<{ tasks: AgentTask[] }>('GET', '/agentq/tasks'),
    get: (id: number) => req<AgentTask>('GET', `/agentq/tasks/${id}`),
  },
}
