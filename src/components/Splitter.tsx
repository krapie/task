import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

// A horizontal drag handle that sits on the top edge of a band: dragging it up grows the band below,
// dragging it down shrinks it. The size is the parent's to keep (`onChange`), so a splitter holds no state
// but "being dragged". Arrow keys move it, Home and a double click give the size back (`null` = automatic).
const STEP = 24

interface Props {
  label: string
  // The band's height right now (it may be automatic), read when a drag or key press starts.
  current: () => number
  min: number
  max: number
  // `final` is false while a drag is in progress and true when it ends (or for a key press): save it then.
  onChange: (px: number | null, final: boolean) => void
}

export function Splitter({ label, current, min, max, onChange }: Props) {
  const [dragging, setDragging] = useState(false)
  const fit = (px: number) => Math.round(Math.min(Math.max(px, min), Math.max(min, max)))

  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const from = { y: e.clientY, h: current() }
    let last = fit(from.h)
    let moved = false
    el.setPointerCapture(e.pointerId)
    setDragging(true)
    const move = (ev: PointerEvent) => { moved = true; last = fit(from.h + from.y - ev.clientY); onChange(last, false) }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDragging(false)
      // A click without a drag leaves the (automatic) height alone.
      if (moved) onChange(last, true)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(fit(current() + (e.key === 'ArrowUp' ? STEP : -STEP)), true)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(null, true)
    }
  }

  return (
    <div
      className={`splitter-h${dragging ? ' splitter-dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      aria-valuenow={fit(current())}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={onKey}
      onDoubleClick={() => onChange(null, true)}
    />
  )
}
