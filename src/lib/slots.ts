import type { Slot } from '../types'

export const SLOTS: Slot[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'weekend']

export const SLOT_LABELS: Record<Slot, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  weekend: 'Sat/Sun',
}

const DAY_TO_SLOT: Slot[] = ['weekend', 'mon', 'tue', 'wed', 'thu', 'fri', 'weekend']

export function getActiveSlotDate(rotateHour: number, rotateMinute: number): { slot: Slot; slotDate: string } {
  const now = new Date()
  const rotateMinutes = rotateHour * 60 + rotateMinute
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const isAfterReset = nowMinutes >= rotateMinutes
  const activeDate = isAfterReset ? now : new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return {
    slot: DAY_TO_SLOT[activeDate.getDay()],
    slotDate: formatDate(activeDate),
  }
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

export function slotFromDate(slotDate: string): Slot {
  const [y, m, d] = slotDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return DAY_TO_SLOT[date.getDay()]
}

export function getNextSlotDate(slot: Slot, activeSlot: Slot, activeSlotDate: string): string {
  if (slot === activeSlot) return activeSlotDate
  const [y, m, d] = activeSlotDate.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  for (let i = 1; i <= 7; i++) {
    const next = new Date(base)
    next.setDate(base.getDate() + i)
    if (DAY_TO_SLOT[next.getDay()] === slot) return formatDate(next)
  }
  return activeSlotDate
}
