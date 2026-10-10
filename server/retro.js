import { randomUUID } from 'crypto'

// A yearly retrospective is a goal_periods row with kind = 'retro' (year set, half NULL).
// Its four fixed sections are goal_categories and the entries are goal_items, so the existing
// category/item endpoints (edit, check, comment, delete) work on it unchanged.
export const RETRO_SECTIONS = ['Keep', 'Problem', 'Try', 'Action Items']

const MAX_ITEMS = 500
const MAX_TEXT = 1000
const MAX_NOTE = 4000

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

const sectionKey = name => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

async function loadPeriod(db, periodId) {
  const { rows: [period] } = await db.query('SELECT * FROM goal_periods WHERE id = $1', [periodId])
  const { rows: categories } = await db.query(
    'SELECT * FROM goal_categories WHERE period_id = $1 ORDER BY position ASC, created_at ASC',
    [periodId]
  )
  const items = categories.length
    ? (await db.query(
        'SELECT * FROM goal_items WHERE category_id = ANY($1) ORDER BY position ASC, created_at ASC',
        [categories.map(c => c.id)]
      )).rows
    : []
  return {
    ...period,
    categories: categories.map(c => ({ ...c, items: items.filter(i => i.category_id === c.id) })),
  }
}

async function inTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// Creates the year's retro with its four sections, or fills in whatever is missing. Safe to call twice and concurrently:
// the partial unique index (year) WHERE kind = 'retro' makes a second creator wait for the first and then reuse its row.
async function ensureRetro(client, year) {
  let { rows } = await client.query(
    "INSERT INTO goal_periods (id, kind, year) VALUES ($1, 'retro', $2) ON CONFLICT (year) WHERE kind = 'retro' DO NOTHING RETURNING *",
    [randomUUID(), year]
  )
  if (!rows[0]) {
    rows = (await client.query("SELECT * FROM goal_periods WHERE kind = 'retro' AND year = $1", [year])).rows
  }
  const period = rows[0]
  const { rows: existing } = await client.query('SELECT name FROM goal_categories WHERE period_id = $1', [period.id])
  const have = new Set(existing.map(c => sectionKey(c.name)))
  for (const [i, name] of RETRO_SECTIONS.entries()) {
    if (have.has(sectionKey(name))) continue
    await client.query(
      'INSERT INTO goal_categories (id, period_id, name, position) VALUES ($1, $2, $3, $4)',
      [randomUUID(), period.id, name, i + 1]
    )
  }
  return period
}

export async function getOrCreateRetro(pool, year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('year must be an integer between 2000 and 2100')
  const period = await inTransaction(pool, client => ensureRetro(client, year))
  return loadPeriod(pool, period.id)
}

// Not exposed over HTTP: used to seed a retro from a one-off script (kubectl exec into the API pod).
// sections: [{ name, items: [{ text, note?, crossed_out? }] }]. Items are appended to the section with the same name
// (case-insensitive); the whole import is one transaction, so a bad section leaves nothing behind.
export async function importRetro(pool, year, sections) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('year must be an integer between 2000 and 2100')
  if (!Array.isArray(sections) || sections.length === 0) throw badRequest('sections required')
  const known = new Set(RETRO_SECTIONS.map(sectionKey))
  let total = 0
  for (const s of sections) {
    if (!known.has(sectionKey(s?.name))) throw badRequest(`unknown section: ${s?.name}`)
    if (!Array.isArray(s.items)) throw badRequest(`items required for ${s.name}`)
    for (const it of s.items) {
      if (typeof it?.text !== 'string' || !it.text.trim()) throw badRequest('every item needs text')
      if (it.text.length > MAX_TEXT) throw badRequest(`item text over ${MAX_TEXT} characters`)
      if (it.note != null && (typeof it.note !== 'string' || it.note.length > MAX_NOTE)) throw badRequest(`item note over ${MAX_NOTE} characters`)
      total++
    }
  }
  if (total > MAX_ITEMS) throw badRequest(`too many items (max ${MAX_ITEMS})`)

  const periodId = await inTransaction(pool, async client => {
    const period = await ensureRetro(client, year)
    const { rows: categories } = await client.query('SELECT * FROM goal_categories WHERE period_id = $1', [period.id])
    const byKey = new Map(categories.map(c => [sectionKey(c.name), c]))
    for (const s of sections) {
      const cat = byKey.get(sectionKey(s.name))
      const { rows: [pos] } = await client.query('SELECT COALESCE(MAX(position), 0) AS p FROM goal_items WHERE category_id = $1', [cat.id])
      let position = Number(pos.p)
      for (const it of s.items) {
        position += 1
        await client.query(
          'INSERT INTO goal_items (id, category_id, text, note, crossed_out, position) VALUES ($1, $2, $3, $4, $5, $6)',
          [randomUUID(), cat.id, it.text.trim(), it.note?.trim() || null, it.crossed_out === true, position]
        )
      }
    }
    return period.id
  })
  return loadPeriod(pool, periodId)
}
