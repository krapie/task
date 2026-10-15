import type { IconName } from '../components/Icons'

export type View = 'routine' | 'calendar' | 'mail' | 'news' | 'assets' | 'health' | 'notes' | 'chats' | 'settings'
export type RoutineTab = 'tasks' | 'goals' | 'retro'
export type YearMonth = { year: number; month: number }

export const VIEW_LABELS: Record<View, string> = {
  routine: 'Routine', calendar: 'Calendar', mail: 'Mail', news: 'News', assets: 'Assets', health: 'Health', notes: 'Notes', chats: 'Chats', settings: 'Settings',
}

// Views backed only by server data; hidden from guests
export const AUTH_ONLY_VIEWS: View[] = ['mail', 'assets', 'health', 'notes', 'chats']
// Personal-data views: only shown to this account. Hiding the tab is
// cosmetic; the server enforces it (STEP_UP_USERS + passkey step-up).
export const OWNER_ONLY_VIEWS: View[] = ['assets', 'health', 'notes', 'chats']

export const VIEW_ICONS: Record<View, IconName> = {
  routine: 'routine', calendar: 'calendar', mail: 'mail', news: 'news', assets: 'assets', health: 'health', notes: 'note', chats: 'assistant', settings: 'settings',
}

export type GroupId = 'today' | 'calendar' | 'inbox' | 'life' | 'note' | 'settings'
export interface Group { id: GroupId; label: string; icon: IconName; views: View[] }

// Nine views fold into six nav groups; groups with several views get sub-tabs.
export const GROUPS: Group[] = [
  { id: 'today', label: 'Today', icon: 'routine', views: ['routine'] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', views: ['calendar'] },
  { id: 'inbox', label: 'Inbox', icon: 'mail', views: ['mail', 'news'] },
  { id: 'life', label: 'Life', icon: 'health', views: ['assets', 'health'] },
  { id: 'note', label: 'Note', icon: 'note', views: ['notes', 'chats'] },
  { id: 'settings', label: 'Settings', icon: 'settings', views: ['settings'] },
]

// API scopes (first path segment) whose requests the top progress bar shows on each tab.
export function scopesFor(view: View, tab: RoutineTab): string[] {
  switch (view) {
    case 'routine': return tab === 'tasks' ? ['templates', 'daily', 'events', 'settings'] : ['goals']
    case 'calendar': return ['events', 'daily', 'todos']
    case 'mail': return ['mail']
    case 'news': return ['news']
    case 'settings': return ['settings', 'push', 'export', 'import']
    default: return []
  }
}

export const groupOf = (v: View): Group => GROUPS.find(g => g.views.includes(v)) ?? GROUPS[0]

export function isViewVisible(v: View, isAuth: boolean, isOwner: boolean): boolean {
  if (AUTH_ONLY_VIEWS.includes(v) && !isAuth) return false
  if (OWNER_ONLY_VIEWS.includes(v) && !isOwner) return false
  return true
}

export interface Route { view: View; tab: RoutineTab; month: YearMonth | null; mailId: string | null; chatId: string | null }

const VIEWS = Object.keys(VIEW_LABELS) as View[]

// #/today[/goals] · #/calendar[/2026-10] · #/inbox/{mail,news} · #/life/{assets,health} · #/note/{notes,chats} · #/settings (legacy #/assistant[/<conversation id>] opens Chats)
export function hashOf(view: View, tab: RoutineTab, month: YearMonth): string {
  const g = groupOf(view)
  if (view === 'routine') return tab === 'goals' ? '#/today/goals' : tab === 'retro' ? '#/today/retro' : '#/today'
  if (view === 'calendar') return `#/calendar/${month.year}-${String(month.month).padStart(2, '0')}`
  if (g.views.length > 1) return `#/${g.id}/${view}`
  return `#/${g.id}`
}

// Reads the hash, falling back to the legacy ?tab=<view>&mail=<id> links that push notifications carry.
export function parseLocation(loc: Pick<Location, 'hash' | 'search'> = location): Route {
  const route: Route = { view: 'routine', tab: 'tasks', month: null, mailId: null, chatId: null }
  const q = new URLSearchParams(loc.search)
  const legacy = q.get('tab')
  if (VIEWS.includes(legacy as View)) route.view = legacy as View
  route.mailId = q.get('mail')
  const parts = loc.hash.replace(/^#\/?/, '').split('/')
  // Push notifications for a finished report still open the legacy #/assistant/<conversation id>.
  if (parts[0] === 'assistant') parts.splice(0, 1, 'note', 'chats')
  const [a, b, c] = parts
  const g = GROUPS.find(x => x.id === a)
  if (g) {
    const sub = g.views.find(v => v === b)
    route.view = sub ?? g.views[0]
    if (g.id === 'today') route.tab = b === 'goals' ? 'goals' : b === 'retro' ? 'retro' : 'tasks'
    const m = g.id === 'calendar' ? /^(\d{4})-(\d{2})$/.exec(b ?? '') : null
    if (m && +m[2] >= 1 && +m[2] <= 12) route.month = { year: +m[1], month: +m[2] }
    // #/note/chats/<conversation id>
    if (route.view === 'chats' && /^[0-9a-f-]{36}$/.test(c ?? '')) route.chatId = c
  }
  return route
}
