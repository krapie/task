import { useEffect, useRef } from 'react'
import { EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { Language, defineLanguageFacet, syntaxTree } from '@codemirror/language'
import { GFM, parser } from '@lezer/markdown'

// The Markdown parser alone: @codemirror/lang-markdown would also bundle the HTML/CSS/JS
// languages for fenced code, which this editor does not highlight.
const markdownLanguage = new Language(defineLanguageFacet({}), parser.configure(GFM), [], 'markdown')

// Live-preview Markdown editor: the text stays plain Markdown, but every line except
// the ones holding the cursor / selection is shown rendered (headings sized, **bold**
// and `code` without their marks, bullets, checkboxes you can click). Styles are the
// `.md-live` rules in index.css (design tokens only).

class BulletWidget extends WidgetType {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-md-bullet'; s.textContent = '•'; return s }
  eq() { return true }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super() }
  eq(o: CheckboxWidget) { return o.checked === this.checked }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-check'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Done' : 'Not done')
    box.addEventListener('change', () => {
      const pos = view.posAtDOM(box)
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: box.checked ? '[x]' : '[ ]' } })
    })
    return box
  }
}

const hide = Decoration.replace({})
const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

const HEADING = /^ATXHeading([1-6])$/

function build(view: EditorView): DecorationSet {
  const { state } = view
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) active.add(l)
  }
  const onActive = (pos: number) => active.has(state.doc.lineAt(pos).number)
  const out: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: node => {
        const name = node.name
        const h = HEADING.exec(name)
        if (h) {
          out.push(line(`cm-md-h cm-md-h${h[1]}`).range(state.doc.lineAt(node.from).from))
          return
        }
        switch (name) {
          case 'HeaderMark': {
            if (!onActive(node.from)) {
              // hide the hashes and the space after them
              const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              out.push(hide.range(node.from, end))
            }
            break
          }
          case 'StrongEmphasis': out.push(mark('cm-md-strong').range(node.from, node.to)); break
          case 'Emphasis': out.push(mark('cm-md-em').range(node.from, node.to)); break
          case 'Strikethrough': out.push(mark('cm-md-del').range(node.from, node.to)); break
          case 'InlineCode': out.push(mark('cm-md-code').range(node.from, node.to)); break
          case 'EmphasisMark':
          case 'CodeMark':
          case 'StrikethroughMark': {
            const parent = node.node.parent?.name
            if (parent !== 'FencedCode' && !onActive(node.from)) out.push(hide.range(node.from, node.to))
            break
          }
          case 'Link': {
            out.push(mark('cm-md-link').range(node.from, node.to))
            if (!onActive(node.from)) {
              // show only the label: hide "[", "](url)" and a trailing title
              const cur = node.node.cursor()
              cur.firstChild()
              let labelEnd = node.to
              do {
                if (cur.name === 'LinkMark' && cur.from > node.from && state.doc.sliceString(cur.from, cur.to) === ']') { labelEnd = cur.from; break }
              } while (cur.nextSibling())
              if (labelEnd < node.to) {
                out.push(hide.range(node.from, node.from + 1))
                out.push(hide.range(labelEnd, node.to))
              }
            }
            return false
          }
          case 'URL': if (node.node.parent?.name === 'Autolink') out.push(mark('cm-md-link').range(node.from, node.to)); break
          case 'ListMark': {
            const parent = node.node.parent?.parent?.name
            if (node.node.nextSibling?.name === 'Task' && !onActive(node.from)) out.push(hide.range(node.from, node.to + 1)) // the checkbox replaces the bullet
            else if (parent === 'BulletList' && !onActive(node.from)) out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
            else out.push(mark('cm-md-listmark').range(node.from, node.to))
            break
          }
          case 'TaskMarker': {
            const checked = /\[[xX]\]/.test(state.doc.sliceString(node.from, node.to))
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to))
            if (checked) out.push(line('cm-md-done').range(state.doc.lineAt(node.from).from))
            break
          }
          case 'QuoteMark': if (!onActive(node.from)) out.push(hide.range(node.from, node.to < state.doc.length && state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to)); break
          case 'Blockquote':
            for (let l = state.doc.lineAt(node.from).number; l <= state.doc.lineAt(node.to).number; l++) out.push(line('cm-md-quote').range(state.doc.line(l).from))
            break
          case 'FencedCode':
            for (let l = state.doc.lineAt(node.from).number; l <= state.doc.lineAt(node.to).number; l++) out.push(line('cm-md-codeblock').range(state.doc.line(l).from))
            break
          case 'HorizontalRule': out.push(line('cm-md-hr').range(state.doc.lineAt(node.from).from)); break
        }
      },
    })
  }
  return Decoration.set(out, true)
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = build(view) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view)
  }
}, { decorations: v => v.decorations })

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  label?: string
}

export default function MarkdownEditor({ value, onChange, readOnly = false, label = 'Note' }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef({ onChange })
  cb.current = { onChange }

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            // Save is handled by the page (the keydown bubbles up); this only stops the browser's Save dialog.
            { key: 'Mod-s', preventDefault: true, run: () => true },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdownLanguage,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          placeholder('Write in Markdown'),
          livePreview,
          EditorView.updateListener.of(u => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()) }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
    // The editor is created once per mount; the parent re-keys it per note and `value` is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External changes (a different note loaded, a reset) replace the document.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    const el = view.current?.contentDOM
    if (el) el.contentEditable = readOnly ? 'false' : 'true'
  }, [readOnly])

  return <div ref={host} className="md-live" />
}
