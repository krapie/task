// Who may do what with notes. A plain session token of an owner reaches the notes that are not hidden;
// a passkey step-up token of an owner reaches every note, hidden ones included.
//   none      no valid token                       → 401
//   forbidden a valid token of a non-owner         → 403
//   visible   owner, no passkey                    → notes with hidden = false
//   all       owner, passkey verified (hwk)        → every note
export function noteAccess(payload, stepUpUsers) {
  if (!payload) return { level: 'none' }
  if (!stepUpUsers.has(payload.preferred_username)) return { level: 'forbidden' }
  const stepUp = payload.step_up === true && Array.isArray(payload.amr) && payload.amr.includes('hwk')
  return { level: stepUp ? 'all' : 'visible', username: payload.preferred_username, sub: payload.sub }
}

// Autosave writes a note every few seconds of typing; the audit log keeps one edit line per note per window.
export const NOTE_EDIT_AUDIT_WINDOW_MINUTES = 10
