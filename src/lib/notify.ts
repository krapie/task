// Imperative toasts and confirm/prompt dialogs, so any module can surface a message
// without prop drilling. <ToastHost/> and <DialogHost/> (components/Ui.tsx) render them.

export interface Toast { id: number; kind: 'error' | 'info'; text: string; action?: { label: string; run: () => void } }

let toasts: Toast[] = []
let nextId = 1
const toastListeners = new Set<() => void>()
const emitToasts = () => toastListeners.forEach(l => l())

export const toastStore = {
  subscribe(l: () => void) { toastListeners.add(l); return () => { toastListeners.delete(l) } },
  get: () => toasts,
  dismiss(id: number) { toasts = toasts.filter(t => t.id !== id); emitToasts() },
}

export function notify(text: string, kind: Toast['kind'] = 'info', ttl = 5000, action?: Toast['action']) {
  if (toasts.some(t => t.text === text)) return
  const id = nextId++
  toasts = [...toasts, { id, kind, text, action }]
  emitToasts()
  setTimeout(() => toastStore.dismiss(id), ttl)
}

// For `.catch(notifyError)`: logs, then tells the user in plain words.
export function notifyError(e: unknown) {
  console.error(e)
  const msg = e instanceof Error ? e.message : String(e)
  const offline = e instanceof TypeError || /failed to fetch|networkerror/i.test(msg)
  notify(offline ? "Couldn't reach the server. Check your connection." : msg || 'Something went wrong.', 'error', 6000)
}

export interface DialogRequest {
  id: number
  kind: 'confirm' | 'prompt'
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
  password?: boolean
  placeholder?: string
  resolve: (v: boolean | string | null) => void
}

let dialogs: DialogRequest[] = []
const dialogListeners = new Set<() => void>()
const emitDialogs = () => dialogListeners.forEach(l => l())

export const dialogStore = {
  subscribe(l: () => void) { dialogListeners.add(l); return () => { dialogListeners.delete(l) } },
  get: () => dialogs,
  close(id: number, value: boolean | string | null) {
    const d = dialogs.find(x => x.id === id)
    dialogs = dialogs.filter(x => x.id !== id)
    emitDialogs()
    d?.resolve(value)
  },
}

type Opts = Omit<DialogRequest, 'id' | 'kind' | 'resolve'>

export function confirmDialog(opts: Opts): Promise<boolean> {
  return new Promise(resolve => {
    dialogs = [...dialogs, { ...opts, id: nextId++, kind: 'confirm', resolve: v => resolve(v === true) }]
    emitDialogs()
  })
}

export function promptDialog(opts: Opts): Promise<string | null> {
  return new Promise(resolve => {
    dialogs = [...dialogs, { ...opts, id: nextId++, kind: 'prompt', resolve: v => resolve(typeof v === 'string' ? v : null) }]
    emitDialogs()
  })
}
