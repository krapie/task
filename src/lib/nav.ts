import type { IconName } from '../components/Icons'

export type View = 'overview' | 'routine' | 'calendar' | 'mail' | 'news' | 'assets' | 'health' | 'trader' | 'notes' | 'chats' | 'settings'
export type RoutineTab = 'tasks' | 'goals' | 'retro'

// Groups kept off the phone's bottom bar and More sheet for now (2026-11-18). The Overview stays on desktop, and the
// phone opens on Tasks instead, because a page with no tab to reach it would be a dead end. Empty this list to bring it back.
export const PHONE_HIDDEN: readonly string[] = ['overview']
const onPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches
// The Overview is the main page on desktop: it is where the app opens and where the π mark leads.
export const defaultView = (): View => (onPhone() && PHONE_HIDDEN.includes('overview') ? 'routine' : 'overview')
export type YearMonth = { year: number; month: number }

export const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview', routine: 'Tasks', calendar: 'Calendar', mail: 'Mail', news: 'News', assets: 'Assets', health: 'Health', trader: 'Trader', notes: 'Notes', chats: 'Assistant', settings: 'Settings',
}

// Views backed only by server data; hidden from guests
export const AUTH_ONLY_VIEWS: View[] = ['mail', 'assets', 'health', 'trader', 'notes', 'chats']
// Personal-data views: only shown to this account. Hiding the tab is
// cosmetic; the server enforces it (STEP_UP_USERS + passkey step-up).
export const OWNER_ONLY_VIEWS: View[] = ['assets', 'health', 'trader', 'notes', 'chats']

export const VIEW_ICONS: Record<View, IconName> = {
  overview: 'overview', routine: 'routine', calendar: 'calendar', mail: 'mail', news: 'news', assets: 'assets', health: 'health', trader: 'chart', notes: 'note', chats: 'assistant', settings: 'settings',
}

export type GroupId = 'overview' | 'assistant' | 'today' | 'calendar' | 'inbox' | 'life' | 'note' | 'settings'
export interface Group { id: GroupId; label: string; icon: IconName; views: View[] }

// Eleven views fold into eight nav groups; groups with several views get sub-tabs. The Assistant tab is the former
// Note → Chats and the Assistant in one, with a profile switch inside (Assistant / Personal). On phones it is not on the
// bottom bar (BAR_GROUPS), so it sits in the More sheet.
export const GROUPS: Group[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', views: ['overview'] },
  { id: 'assistant', label: 'Assistant', icon: 'assistant', views: ['chats'] },
  { id: 'today', label: 'Tasks', icon: 'routine', views: ['routine'] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', views: ['calendar'] },
  { id: 'inbox', label: 'Inbox', icon: 'mail', views: ['mail', 'news'] },
  { id: 'life', label: 'Life', icon: 'analyze', views: ['assets', 'health', 'trader'] },
  { id: 'note', label: 'Note', icon: 'note', views: ['notes'] },
  { id: 'settings', label: 'Settings', icon: 'settings', views: ['settings'] },
]

// API scopes (first path segment) whose requests the top progress bar shows on each tab.
export function scopesFor(view: View, tab: RoutineTab): string[] {
  switch (view) {
    case 'overview': return ['templates', 'daily', 'events', 'todos', 'mail', 'news', 'settings', 'health-data', 'assets', 'trader']
    case 'routine':
      return tab === 'tasks' ? ['templates', 'daily', 'events', 'settings'] : ['goals']
    case 'calendar': return ['events', 'daily', 'todos']
    case 'mail': return ['mail']
    case 'news': return ['news']
    case 'settings': return ['settings', 'push', 'export', 'import']
    default: return []
  }
}

// The groups with their own slot on the phone's bottom bar, in this order (Tasks, Calendar, Inbox, Assistant, then More);
// the others go into its "More" sheet. Overview is in PHONE_HIDDEN, so it is on neither.
export const BAR_GROUPS: GroupId[] = ['today', 'calendar', 'inbox', 'assistant']

export const groupOf = (v: View): Group => GROUPS.find(g => g.views.includes(v)) ?? GROUPS[0]

export function isViewVisible(v: View, isAuth: boolean, isOwner: boolean): boolean {
  if (AUTH_ONLY_VIEWS.includes(v) && !isAuth) return false
  if (OWNER_ONLY_VIEWS.includes(v) && !isOwner) return false
  return true
}

export interface Route { view: View; tab: RoutineTab; month: YearMonth | null; mailId: string | null; chatId: string | null }

const VIEWS = Object.keys(VIEW_LABELS) as View[]

// #/overview · #/assistant[/<conversation id>] · #/today[/goals|retro] · #/calendar[/2026-10] · #/inbox/{mail,news} · #/life/{assets,health,trader} · #/note · #/settings (legacy #/note/chats[/<id>] opens the Assistant)
export function hashOf(view: View, tab: RoutineTab, month: YearMonth): string {
  const g = groupOf(view)
  if (view === 'routine') return tab === 'goals' ? '#/today/goals' : tab === 'retro' ? '#/today/retro' : '#/today'
  if (view === 'calendar') return `#/calendar/${month.year}-${String(month.month).padStart(2, '0')}`
  if (g.views.length > 1) return `#/${g.id}/${view}`
  return `#/${g.id}`
}

// Reads the hash, falling back to the legacy ?tab=<view>&mail=<id> links that push notifications carry.
export function parseLocation(loc: Pick<Location, 'hash' | 'search'> = location): Route {
  const route: Route = { view: defaultView(), tab: 'tasks', month: null, mailId: null, chatId: null }
  const q = new URLSearchParams(loc.search)
  const legacy = q.get('tab')
  if (VIEWS.includes(legacy as View)) route.view = legacy as View
  route.mailId = q.get('mail')
  const parts = loc.hash.replace(/^#\/?/, '').split('/')
  // The old Note → Chats tab became the Assistant tab: #/note/chats[/<id>] still lands there.
  if (parts[0] === 'note' && parts[1] === 'chats') parts.splice(0, 2, 'assistant')
  const [a, b] = parts
  const g = GROUPS.find(x => x.id === a)
  if (g) {
    const sub = g.views.find(v => v === b)
    route.view = sub ?? g.views[0]
    if (g.id === 'today') {
      route.tab = b === 'goals' ? 'goals' : b === 'retro' ? 'retro' : 'tasks'
      // The Overview used to be a Today tab (#/today/overview); old links still land on it.
      if (b === 'overview') route.view = 'overview'
    }
    const m = g.id === 'calendar' ? /^(\d{4})-(\d{2})$/.exec(b ?? '') : null
    if (m && +m[2] >= 1 && +m[2] <= 12) route.month = { year: +m[1], month: +m[2] }
    // #/assistant/<conversation id>
    if (route.view === 'chats' && /^[0-9a-f-]{36}$/.test(b ?? '')) route.chatId = b
  }
  return route
}
