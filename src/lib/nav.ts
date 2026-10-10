import type { IconName } from '../components/Icons'

export type View = 'routine' | 'calendar' | 'mail' | 'news' | 'assets' | 'health' | 'settings'
export type RoutineTab = 'tasks' | 'goals' | 'retro'
export type YearMonth = { year: number; month: number }

export const VIEW_LABELS: Record<View, string> = {
  routine: 'Routine', calendar: 'Calendar', mail: 'Mail', news: 'News', assets: 'Assets', health: 'Health', settings: 'Settings',
}

// Views backed only by server data; hidden from guests
export const AUTH_ONLY_VIEWS: View[] = ['mail', 'assets', 'health']
// Personal-data views: only shown to this account. Hiding the tab is
// cosmetic; the server enforces it (STEP_UP_USERS + passkey step-up).
export const OWNER_ONLY_VIEWS: View[] = ['assets', 'health']

export const VIEW_ICONS: Record<View, IconName> = {
  routine: 'routine', calendar: 'calendar', mail: 'mail', news: 'news', assets: 'assets', health: 'health', settings: 'settings',
}

export type GroupId = 'today' | 'calendar' | 'inbox' | 'life' | 'settings'
export interface Group { id: GroupId; label: string; icon: IconName; views: View[] }

// Seven views fold into five nav groups; groups with several views get sub-tabs.
export const GROUPS: Group[] = [
  { id: 'today', label: 'Today', icon: 'routine', views: ['routine'] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', views: ['calendar'] },
  { id: 'inbox', label: 'Inbox', icon: 'mail', views: ['mail', 'news'] },
  { id: 'life', label: 'Life', icon: 'health', views: ['assets', 'health'] },
  { id: 'settings', label: 'Settings', icon: 'settings', views: ['settings'] },
]

export const groupOf = (v: View): Group => GROUPS.find(g => g.views.includes(v)) ?? GROUPS[0]

export function isViewVisible(v: View, isAuth: boolean, isOwner: boolean): boolean {
  if (AUTH_ONLY_VIEWS.includes(v) && !isAuth) return false
  if (OWNER_ONLY_VIEWS.includes(v) && !isOwner) return false
  return true
}

export interface Route { view: View; tab: RoutineTab; month: YearMonth | null; mailId: string | null }

const VIEWS = Object.keys(VIEW_LABELS) as View[]

// #/today[/goals] · #/calendar[/2026-10] · #/inbox/{mail,news} · #/life/{assets,health} · #/settings
export function hashOf(view: View, tab: RoutineTab, month: YearMonth): string {
  const g = groupOf(view)
  if (view === 'routine') return tab === 'goals' ? '#/today/goals' : tab === 'retro' ? '#/today/retro' : '#/today'
  if (view === 'calendar') return `#/calendar/${month.year}-${String(month.month).padStart(2, '0')}`
  if (g.views.length > 1) return `#/${g.id}/${view}`
  return `#/${g.id}`
}

// Reads the hash, falling back to the legacy ?tab=<view>&mail=<id> links that push notifications carry.
export function parseLocation(loc: Pick<Location, 'hash' | 'search'> = location): Route {
  const route: Route = { view: 'routine', tab: 'tasks', month: null, mailId: null }
  const q = new URLSearchParams(loc.search)
  const legacy = q.get('tab')
  if (VIEWS.includes(legacy as View)) route.view = legacy as View
  route.mailId = q.get('mail')
  const [a, b] = loc.hash.replace(/^#\/?/, '').split('/')
  const g = GROUPS.find(x => x.id === a)
  if (g) {
    const sub = g.views.find(v => v === b)
    route.view = sub ?? g.views[0]
    if (g.id === 'today') route.tab = b === 'goals' ? 'goals' : b === 'retro' ? 'retro' : 'tasks'
    const m = g.id === 'calendar' ? /^(\d{4})-(\d{2})$/.exec(b ?? '') : null
    if (m && +m[2] >= 1 && +m[2] <= 12) route.month = { year: +m[1], month: +m[2] }
  }
  return route
}
