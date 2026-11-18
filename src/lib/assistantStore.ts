import { api, STEP_UP_EVENT } from './api'
import type { AssistantEvent, AssistantFolder, AssistantProfile, AssistantSummary, AssistantTurn } from '../types'

// One assistant conversation shared by the Assistant tab and the chat button
// (bottom right): asking in either adds a turn to the same chat, streamed in
// both places. Module state, not React state, so it survives the tab being
// unmounted while an answer streams. Everything is dropped on lock.

export type Chat = { id: string | null; title: string; turns: AssistantTurn[] }
export const NEW_CHAT: Chat = { id: null, title: 'New chat', turns: [] }

// The two profiles of the Assistant tab: "assistant" does things and browses, "personal" reads private data.
// The choice is remembered per browser; the chat button and the tab always use the same one.
const PROFILE_KEY = 'kp-as-profile'
function savedProfile(): AssistantProfile {
  try {
    return localStorage.getItem(PROFILE_KEY) === 'personal' ? 'personal' : 'assistant'
  } catch {
    return 'assistant'
  }
}
// Fired when the assistant changed something in the Task app (an event, a todo, a task): screens reload their data.
export const TASK_DATA_CHANGED = 'kp-task-data-changed'
const WRITE_TOOLS = /(^|__)(event_add|event_update|todo_add|todo_complete|task_add)$/

export interface AssistantState {
  profile: AssistantProfile
  chat: Chat
  list: AssistantSummary[] | null
  // The turn this browser is streaming right now (one at a time).
  live: { conversationId: string | null; turnId: string | null } | null
  loading: boolean
  error: string | null
}

const POLL_MS = 2000
const EMPTY: AssistantState = { profile: savedProfile(), chat: NEW_CHAT, list: null, live: null, loading: false, error: null }

let state: AssistantState = EMPTY
let abort: AbortController | null = null
let poll: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<AssistantState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
  syncPolling()
}

// A turn answering somewhere else (a scheduled run, another tab or device): follow it by polling.
export const isRemoteStreaming = (s: AssistantState) =>
  s.chat.turns[s.chat.turns.length - 1]?.state === 'streaming' && !(s.live && s.live.conversationId === s.chat.id)

function syncPolling() {
  const want = isRemoteStreaming(state) && state.chat.id != null && listeners.size > 0 && api.assets.hasToken()
  if (want && !poll) {
    poll = setInterval(() => {
      const id = state.chat.id
      if (!id) return
      api.assistant.get(id).then(c => {
        if (state.chat.id !== id) return
        set({ chat: { id: c.id, title: c.title, turns: c.turns } })
        if (c.turns[c.turns.length - 1]?.state !== 'streaming') void refreshList()
      }, failure)
    }, POLL_MS)
  } else if (!want && poll) {
    clearInterval(poll)
    poll = null
  }
}

function failure(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'ASSET_SESSION_EXPIRED') api.assets.clearToken() // the views relock and call reset()
  else if (msg === 'STEP_UP_FORBIDDEN') {
    api.assets.clearToken()
    set({ error: 'This account cannot view this data' })
  } else set({ error: msg })
}

function applyEvent(t: AssistantTurn, e: AssistantEvent): AssistantTurn {
  switch (e.type) {
    case 'text': {
      const parts = [...t.parts]
      const last = parts[parts.length - 1]
      if (last?.kind === 'text') parts[parts.length - 1] = { ...last, text: last.text + e.text }
      else parts.push({ kind: 'text', text: e.text })
      return { ...t, parts, status: undefined }
    }
    case 'tool':
      return { ...t, parts: [...t.parts, { kind: 'tool', id: e.id, name: e.name, input: e.input }], status: undefined }
    case 'tool_result':
      if (!e.error && t.parts.some(p => p.kind === 'tool' && p.id === e.id && WRITE_TOOLS.test(p.name))) window.dispatchEvent(new Event(TASK_DATA_CHANGED))
      return { ...t, parts: t.parts.map(p => (p.kind === 'tool' && p.id === e.id ? { ...p, result: { error: e.error, output: e.output } } : p)) }
    case 'status':
      return { ...t, status: e.message }
    case 'reset':
      return { ...t, parts: [], notice: e.notice }
    case 'done':
      return { ...t, done: e, state: 'done' }
    case 'error':
      return { ...t, state: 'error', error: e.message }
    default:
      return t
  }
}

export async function refreshList() {
  try {
    const profile = state.profile
    const list = await api.assistant.list(profile)
    if (state.profile === profile) set({ list })
  } catch (err) {
    failure(err)
  }
}

export async function open(id: string) {
  if (state.chat.id === id) return
  set({ chat: { id, title: '', turns: [] }, loading: true, error: null })
  try {
    const c = await api.assistant.get(id)
    if (state.chat.id === id) {
      // A link (push notification) can name a chat of the other profile: switch to it.
      if (c.profile && c.profile !== state.profile) {
        try { localStorage.setItem(PROFILE_KEY, c.profile) } catch { /* private mode */ }
        set({ profile: c.profile, list: null })
        void refreshList()
      }
      set({ chat: { id: c.id, title: c.title, turns: c.turns } })
    }
  } catch (err) {
    set({ chat: NEW_CHAT })
    failure(err)
  } finally {
    set({ loading: false })
  }
}

export function startNew() {
  set({ chat: NEW_CHAT, error: null })
}

export function setProfile(profile: AssistantProfile) {
  if (state.profile === profile || state.live) return
  try { localStorage.setItem(PROFILE_KEY, profile) } catch { /* private mode */ }
  set({ profile, chat: NEW_CHAT, list: null, error: null })
  void refreshList()
}

export async function ask(question: string) {
  question = question.trim()
  if (!question || state.live) return
  const base = state.chat
  const tempId = `pending-${Date.now()}`
  let convId = base.id
  let turnId: string | null = null
  set({
    chat: { ...base, title: base.turns.length ? base.title : question.slice(0, 80), turns: [...base.turns, { id: tempId, question, parts: [], state: 'streaming' }] },
    error: null,
    live: { conversationId: convId, turnId: null },
  })
  const controller = new AbortController()
  abort = controller

  const update = (fn: (t: AssistantTurn) => AssistantTurn) => {
    if (state.chat.id !== convId) return
    set({ chat: { ...state.chat, turns: state.chat.turns.map(t => (t.id === (turnId ?? tempId) || t.id === tempId ? fn(t) : t)) } })
  }
  const onEvent = (e: AssistantEvent) => {
    if (e.type === 'conversation') {
      const wasNew = convId == null
      convId = e.id
      turnId = e.turn_id
      const c = state.chat
      set({
        live: { conversationId: e.id, turnId: e.turn_id },
        chat: c.id === base.id ? { ...c, id: e.id, turns: c.turns.map(t => (t.id === tempId ? { ...t, id: e.turn_id } : t)) } : c,
      })
      if (wasNew) void refreshList()
      return
    }
    update(t => applyEvent(t, e))
  }

  try {
    await api.assistant.chat(base.id, question, onEvent, controller.signal, state.profile)
    update(t => (t.state === 'streaming' ? { ...t, state: 'error', error: 'The answer stream ended early; reopen the chat to see if it finished.' } : t))
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'ASSET_SESSION_EXPIRED' || msg === 'STEP_UP_FORBIDDEN') failure(err)
    else update(t => (t.state === 'streaming' ? { ...t, state: 'error', error: controller.signal.aborted ? 'stopped' : msg } : t))
  } finally {
    if (abort === controller) abort = null
    set({ live: null })
    if (api.assets.hasToken()) {
      void refreshList()
      // A new chat is put into a folder a few seconds after its first answer.
      if (base.id == null) setTimeout(() => { if (api.assets.hasToken()) void refreshList() }, 8000)
    }
  }
}

export async function moveChat(id: string, folder: AssistantFolder) {
  try {
    await api.assistant.update(id, { folder })
    await refreshList()
  } catch (err) {
    failure(err)
  }
}

export function stop() {
  const turnId = state.live?.turnId ?? (isRemoteStreaming(state) ? state.chat.turns[state.chat.turns.length - 1]?.id : null)
  if (turnId) api.assistant.stop(turnId).catch(() => {})
  abort?.abort()
}

export async function remove(id: string) {
  try {
    await api.assistant.remove(id)
    if (state.chat.id === id) set({ chat: NEW_CHAT })
    await refreshList()
  } catch (err) {
    failure(err)
  }
}

// Locked or signed out: drop everything fetched.
export function reset() {
  abort?.abort()
  abort = null
  set({ ...EMPTY, profile: state.profile })
}

export const setError = (error: string | null) => set({ error })

export const assistantStore = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    syncPolling()
    return () => {
      listeners.delete(l)
      syncPolling()
    }
  },
}

// The step-up token went away (Lock, idle, expiry, another tab of the app): drop the chat.
window.addEventListener(STEP_UP_EVENT, () => {
  if (!api.assets.hasToken()) reset()
})
