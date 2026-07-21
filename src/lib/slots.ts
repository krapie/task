import type { Slot, WorkWeek } from '../types'

export const SLOTS: Slot[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend']

const SLOT_ORDER_MAP: Record<WorkWeek, Slot[]> = {
  'mon-fri': ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend'],
  'tue-sat': ['tue', 'wed', 'thu', 'fri', 'mon', 'weekend'],
  'sun-thu': ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend'],
}

export function getSlotOrder(workWeek: WorkWeek): Slot[] {
  return SLOT_ORDER_MAP[workWeek]
}

const DAY_TO_SLOT_MAP: Record<WorkWeek, Slot[]> = {
  'mon-fri': ['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend'],
  'tue-sat': ['weekend', 'weekend', 'tue', 'wed', 'thu', 'fri', 'mon'],
  'sun-thu': ['mon',     'tue',    'wed', 'thu', 'fri', 'weekend', 'weekend'],
}

const SLOT_LABELS_MAP: Record<WorkWeek, Record<Slot, string>> = {
  'mon-fri': { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', weekend: 'Sat/Sun' },
  'tue-sat': { mon: 'Sat', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', weekend: 'Sun/Mon' },
  'sun-thu': { mon: 'Sun', tue: 'Mon', wed: 'Tue', thu: 'Wed', fri: 'Thu', weekend: 'Fri/Sat' },
}

export const SLOT_LABELS = SLOT_LABELS_MAP['mon-fri']

export function getSlotLabels(workWeek: WorkWeek): Record<Slot, string> {
  return SLOT_LABELS_MAP[workWeek]
}

export function getActiveSlotDate(
  rotateHour: number,
  rotateMinute: number,
  workWeek: WorkWeek = 'mon-fri'
): { slot: Slot; slotDate: string } {
  const now = new Date()
  const rotateMinutes = rotateHour * 60 + rotateMinute
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const isAfterReset = nowMinutes >= rotateMinutes
  const activeDate = isAfterReset ? now : new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const slot = DAY_TO_SLOT_MAP[workWeek][activeDate.getDay()]

  // For slots that span multiple days (e.g. weekend covers Sun+Mon in tue-sat),
  // anchor slotDate to the first calendar day of the slot so all days in the
  // same slot share the same data key.
  const anchorDate = new Date(activeDate)
  for (let i = 1; i <= 6; i++) {
    const prev = new Date(activeDate)
    prev.setDate(activeDate.getDate() - i)
    if (DAY_TO_SLOT_MAP[workWeek][prev.getDay()] !== slot) break
    anchorDate.setDate(activeDate.getDate() - i)
  }

  return { slot, slotDate: formatDate(anchorDate) }
}

export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getNextReset(rotateHour: number, rotateMinute: number): Date {
  const now = new Date()
  const next = new Date(now)
  next.setHours(rotateHour, rotateMinute, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next
}

export function formatDayLabel(slotDate: string): string {
  const [y, m, d] = slotDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export function slotFromDate(slotDate: string, workWeek: WorkWeek = 'mon-fri'): Slot {
  const [y, m, d] = slotDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return DAY_TO_SLOT_MAP[workWeek][date.getDay()]
}

export function getSlotDateForCalendarDate(calendarDate: string, workWeek: WorkWeek = 'mon-fri'): string {
  const [y, m, d] = calendarDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const slot = DAY_TO_SLOT_MAP[workWeek][date.getDay()]
  const anchorDate = new Date(date)
  for (let i = 1; i <= 6; i++) {
    const prev = new Date(date)
    prev.setDate(date.getDate() - i)
    if (DAY_TO_SLOT_MAP[workWeek][prev.getDay()] !== slot) break
    anchorDate.setDate(date.getDate() - i)
  }
  return formatDate(anchorDate)
}

export function getNextSlotDate(
  slot: Slot,
  activeSlot: Slot,
  activeSlotDate: string,
  workWeek: WorkWeek = 'mon-fri'
): string {
  if (slot === activeSlot) return activeSlotDate
  const [y, m, d] = activeSlotDate.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  const dayToSlot = DAY_TO_SLOT_MAP[workWeek]
  for (let i = 1; i <= 7; i++) {
    const next = new Date(base)
    next.setDate(base.getDate() + i)
    if (dayToSlot[next.getDay()] === slot) return formatDate(next)
  }
  return activeSlotDate
}
