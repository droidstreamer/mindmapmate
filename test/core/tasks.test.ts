import { describe, expect, it } from 'vitest'
import { insertNodes, setStatus, toggleDone } from '../../src/core/commands.ts'
import { boardIndex } from '../../src/core/io/boardFile.ts'
import { copyClip, parseOutline, readClip, toMarkdown } from '../../src/core/io/outline.ts'
import { validateBoard, type Board, type BoardNode } from '../../src/core/schema.ts'
import { subtreeCounts } from '../../src/core/tree.ts'
import { visibleBoard } from '../../src/core/visibility.ts'
import { generateBoard } from '../generate.ts'

const node = (id: string, parent: string | null, order: number, extra: Partial<BoardNode> = {}): BoardNode =>
  ({ id, parent, order, text: id, x: 0, y: 0, ...extra })
const board = (nodes: BoardNode[]): Board => ({ schema: 1, theme: {}, nodes, links: [] })
const statuses = (b: Board) => Object.fromEntries(b.nodes.map(n => [n.id, n.status]))

describe('statuses (F8)', () => {
  it('Mod+L steps plain -> todo -> done -> todo; a mixed selection becomes done', () => {
    const b = board([node('a', null, 0), node('b', null, 1, { status: 'todo' }), node('c', null, 2, { status: 'done' })])
    expect(statuses(toggleDone(['a'])(b)).a).toBe('todo')
    expect(statuses(toggleDone(['b'])(b)).b).toBe('done')
    expect(statuses(toggleDone(['c'])(b)).c).toBe('todo')
    expect(statuses(toggleDone(['a', 'b', 'c'])(b))).toEqual({ a: 'done', b: 'done', c: 'done' })
  })

  it('clearing a status removes the field, and a no-op returns the same board', () => {
    const b = board([node('a', null, 0, { status: 'doing' })])
    expect('status' in setStatus(['a'], undefined)(b).nodes[0]).toBe(false)
    expect(setStatus(['a'], 'doing')(b)).toBe(b)
  })

  it('rollup counts tasks below a node, done as done, dropped left out (D6)', () => {
    const b = board([
      node('r', null, 0, { status: 'todo' }), node('a', 'r', 0, { status: 'done' }), node('b', 'r', 1, { status: 'dropped' }),
      node('c', 'r', 2), node('d', 'c', 0, { status: 'doing' }), node('e', 'c', 1, { status: 'done', collapsed: true }),
    ])
    // Round 22: a parent counts its own children only; c has no status of its own and its tasks do not roll up past it
    expect(subtreeCounts(b.nodes).get('r')).toMatchObject({ done: 1, tasks: 1 })
    expect(subtreeCounts(b.nodes).get('c')).toMatchObject({ done: 1, tasks: 2 })
  })

  it('hide done hides done and dropped branches', () => {
    const b = board([node('r', null, 0), node('a', 'r', 0, { status: 'done' }), node('a1', 'a', 0, { status: 'todo' }), node('b', 'r', 1, { status: 'dropped' }), node('c', 'r', 2)])
    expect(visibleBoard(b, true).nodes.map(n => n.id)).toEqual(['r', 'c'])
  })
})

describe('Markdown export and outlines (F13, F15)', () => {
  it('outline -> board -> export keeps order, depth and done state (M3 gate)', () => {
    const outline = [
      '- Project',
      '\t- [x] Design',
      '\t\t- [ ] Sketch',
      '\t\t- [x] Review',
      '\t- [/] Build',
      '\t\t- plain note',
      '\t- [-] Dropped idea',
      '- Second root',
      '',
    ].join('\n')
    const nodes = parseOutline(outline)
    // Round 12: only `[ ]` and `[x]`, since Obsidian draws any other character as ticked; the rest is a tag.
    expect(toMarkdown(board(nodes))).toBe(outline.replace('[/] Build', '[ ] Build #status/doing').replace('[-] Dropped idea', '[x] Dropped idea #status/dropped'))
  })

  it('each status round-trips through the exported tags, before a due date (round 12)', () => {
    const outline = ['- [ ] A', '- [ ] B #status/doing', '- [ ] C #status/blocked 📅 2026-10-01', '- [x] D', '- [x] E #status/dropped', '- [!] F', '- G #status/doing', ''].join('\n')
    const nodes = parseOutline(outline)
    expect(nodes.map(n => [n.text, n.status])).toEqual([['A', 'todo'], ['B', 'doing'], ['C', 'blocked'], ['D', 'done'], ['E', 'dropped'], ['F', 'blocked'], ['G #status/doing', undefined]])
    expect(toMarkdown(board(nodes.slice(0, 5)))).toBe(outline.split('\n').slice(0, 5).join('\n') + '\n')
  })

  it('reads two-space, four-space and numbered outlines', () => {
    const nodes = parseOutline('1. A\n  2. [x] B\n      * C\n  3) D\nE')
    const by = (t: string) => nodes.find(n => n.text === t)!
    expect(by('B').parent).toBe(by('A').id)
    expect(by('B').status).toBe('done')
    expect(by('C').parent).toBe(by('B').id)
    expect(by('D').parent).toBe(by('A').id)
    expect([by('B').order, by('D').order]).toEqual([0, 1])
    expect(by('E').parent).toBeNull()
  })

  it('round trips every generated board through export and parse (property test)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const b = generateBoard(seed, 150)
      // Export flattens line breaks; everything else must come back.
      const flat = board(b.nodes.map(n => ({ ...n, text: n.text.replace(/\s*\n\s*/g, ' ').trim() })))
      const md = toMarkdown(flat)
      expect(toMarkdown(board(parseOutline(md)))).toBe(md)
    }
  })

  it('the index never contains checkbox syntax, so the Tasks plugin ignores boards (D20)', () => {
    for (let seed = 1; seed <= 50; seed++)
      for (const line of boardIndex(generateBoard(seed)).split('\n')) expect(line).not.toMatch(/^\s*[-*+]\s+\[.\]/)
  })
})

describe('clipboard (F15, D27)', () => {
  const b: Board = {
    schema: 1, theme: {},
    nodes: [node('r', null, 0), node('a', 'r', 0, { status: 'done', color: 'red' }), node('a1', 'a', 0), node('b', 'r', 1)],
    links: [{ id: 'l1', from: 'a1', to: 'a' }, { id: 'l2', from: 'a1', to: 'b' }],
  }

  it('copies branches with inner links; pasting gives new ids and keeps structure and style', () => {
    const clip = readClip(copyClip(b, ['a']), b)!
    expect(clip.nodes.map(n => n.text)).toEqual(['a', 'a1'])
    expect(clip.nodes.every(n => !b.nodes.some(o => o.id === n.id))).toBe(true)
    expect(clip.nodes[0]).toMatchObject({ parent: null, status: 'done', color: 'red' })
    expect(clip.nodes[1].parent).toBe(clip.nodes[0].id)
    expect(clip.links).toHaveLength(1)
    const pasted = insertNodes(clip.nodes, clip.links, 'b', { x: 500, y: 60 })(b)
    expect(validateBoard(pasted).ok).toBe(true)
    const top = pasted.nodes.find(n => n.id === clip.nodes[0].id)!
    expect(top).toMatchObject({ parent: 'b', order: 0, x: 500, y: 60 })
  })

  it('ignores clipboard text that is not a valid clip', () => {
    expect(readClip('- just an outline', b)).toBeUndefined()
    expect(readClip('{"flowmap-clip":1,"nodes":[{"id":"x"}],"links":[]}', b)).toBeUndefined()
    expect(readClip('{"flowmap-clip":1,"nodes":[{"id":"x","parent":"x","order":0,"text":"","x":0,"y":0}],"links":[]}', b)).toBeUndefined()
  })
})
