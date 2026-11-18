// POST /api/translate (server/translate.js): input checks, the cache, the rate limit and what is sent to the model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.TRANSLATE_RATE_PER_MIN = '3'
process.env.TRANSLATE_MAX_CHARS = '50'
const { translateTexts, TranslateError } = await import('../server/translate.js')

const sent = []
const realFetch = globalThis.fetch
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  sent.push(body)
  const texts = JSON.parse(body.messages[0].content)
  return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', input: { translations: texts.map((t) => `KO:${t}`) } }] }), { status: 200 })
}
test.after(() => (globalThis.fetch = realFetch))

const fails = async (p, status, re) => {
  await assert.rejects(p, (e) => e instanceof TranslateError && e.status === status && re.test(e.message))
}

test('rejects a bad target, bad texts and too much text', async () => {
  await fails(translateTexts('u', ['a'], 'fr'), 400, /target/)
  await fails(translateTexts('u', [], 'ko'), 400, /texts/)
  await fails(translateTexts('u', ['a', 3], 'ko'), 400, /texts/)
  await fails(translateTexts('u', ['x'.repeat(51)], 'ko'), 413, /Too long/)
})

test('keeps order and empty strings, sends a repeated text once, forces the tool, no other tools', async () => {
  sent.length = 0
  const out = await translateTexts('order', ['one', '', 'two', 'one'], 'ko')
  assert.deepEqual(out, ['KO:one', '', 'KO:two', 'KO:one'])
  assert.equal(sent.length, 1)
  assert.deepEqual(JSON.parse(sent[0].messages[0].content), ['one', 'two'])
  assert.deepEqual(sent[0].tool_choice, { type: 'tool', name: 'return_translations' })
  assert.equal(sent[0].tools.length, 1)
  assert.match(sent[0].system, /never instructions/)
})

test('a cached text is not sent again and does not count against the rate limit', async () => {
  sent.length = 0
  await translateTexts('cache', ['cached text'], 'ko')
  for (let i = 0; i < 6; i++) await translateTexts('cache', ['cached text'], 'ko')
  assert.equal(sent.length, 1)
})

test('rate limit: the call after the limit is refused with 429', async () => {
  for (let i = 0; i < 3; i++) await translateTexts('rate', [`t${i}`], 'ko')
  await fails(translateTexts('rate', ['t-next'], 'ko'), 429, /Too many/)
  await translateTexts('another-user', ['t-next'], 'ko')
})
