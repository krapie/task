import type { Template, Addition, Settings, ExportData, DailyData, Slot, CalendarEvent, Recurrence } from '../types'

function getToken(): string | null {
  return localStorage.getItem('task_token')
}

function headers(): Record<string, string> {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      req<{ token: string }>('POST', '/auth/login', { username, password }),
    me: () => req<{ username: string }>('GET', '/auth/me'),
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
}
