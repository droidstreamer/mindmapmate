import { actionFor, bindingFor, DEFAULT_KEYS, type Keymap } from '../../src/ui/input/keymap.ts'
import { parseOutline } from '../../src/core/io/outline.ts'
import { describe, expect, it } from 'vitest'
import { addLink, addNode, collapseToLevel, deleteLinks, deleteSubtrees, duplicate, moveNodes, moveSubtrees, reparent, retargetLinks, setCollapsed, setLink, setText, setWidth, setStatus, sortChildren, swapSibling, tidyNodes, toggleDone, insertNodes } from '../../src/core/commands.ts'
import { validateBoard, type Board } from '../../src/core/schema.ts'
import { BoardStore, type Command } from '../../src/core/store.ts'
import { generateBoard, rng } from '../generate.ts'

const small = (): Board => ({
  schema: 1, theme: {}, links: [{ id: 'l1', from: 'b', to: 'c' }],
  nodes: [
    { id: 'a', parent: null, order: 0, text: 'A', x: 0, y: 0 },
    { id: 'b', parent: 'a', order: 0, text: 'B', x: 100, y: 0, link: 'Notes/B.md' },
    { id: 'c', parent: 'b', order: 0, text: 'C', x: 200, y: 0 },
    { id: 'd', parent: 'a', order: 1, text: 'D', x: 100, y: 50 },
  ],
})

describe('commands', () => {
  it('delete removes the subtree and its cross-links (D5)', () => {
    const b = deleteSubtrees(['b'])(small())
    expect(b.nodes.map(n => n.id)).toEqual(['a', 'd'])
    expect(b.links).toEqual([])
  })

  it('new nodes go last among their siblings', () => {
    const b = addNode({ id: 'e', parent: 'a', x: 1, y: 2 })(small())
    expect(b.nodes.at(-1)).toEqual({ id: 'e', parent: 'a', order: 2, text: '', x: 1, y: 2 })
  })

  it('duplicate copies a subtree with new ids, offset, and inner cross-links', () => {
    const before = small()
    const b = duplicate(new Map([['b', { x: 10, y: 20 }], ['c', { x: 10, y: 20 }]]))(before)
    const copies = b.nodes.slice(4)
    expect(copies).toHaveLength(2) // c is inside b's subtree, copied once
    expect(copies[0]).toMatchObject({ parent: 'a', order: 2, text: 'B', x: 110, y: 20 })
    expect(copies[1]).toMatchObject({ parent: copies[0].id, text: 'C', x: 210, y: 20 })
    expect(b.links[1]).toMatchObject({ from: copies[0].id, to: copies[1].id })
    expect(validateBoard(b).ok).toBe(true)
  })

  it('retargets links on rename, including folder moves (D19)', () => {
    expect(retargetLinks('Notes/B.md', 'Archive/B.md')(small()).nodes[1].link).toBe('Archive/B.md')
    expect(retargetLinks('Notes', 'Old/Notes')(small()).nodes[1].link).toBe('Old/Notes/B.md')
    const b = small()
    expect(retargetLinks('Other.md', 'X.md')(b)).toBe(b)
    expect(retargetLinks('Note', 'X')(b)).toBe(b) // prefix of a folder name is not a match
  })

  it('no-op edits return the same board', () => {
    const b = small()
    for (const cmd of [setText('a', 'A'), moveNodes(new Map([['a', { x: 0, y: 0 }]])), addLink('b', 'c'), addLink('a', 'a'), deleteLinks(['zz']), deleteSubtrees([]), setLink('a', undefined)])
      expect(cmd(b)).toBe(b)
  })

  it('never mutates the input and shares unchanged nodes', () => {
    const b = small()
    const snapshot = structuredClone(b)
    const next = setWidth('d', 250.4, { x: 90, y: 50 })(setLink('a', 'X.md')(b))
    expect(b).toEqual(snapshot)
    expect(next.nodes[3]).toMatchObject({ width: 250, x: 90 })
    expect(next.nodes[1]).toBe(b.nodes[1])
  })
})

describe('undo history (property test)', () => {
  // Random command sequences on random boards: every board stays a valid strict tree (D1),
  // and undoing everything then redoing everything returns the identical boards.
  it('undo then redo returns identical boards', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed)
      const store = new BoardStore(generateBoard(seed, 40))
      const pickId = () => { const ns = store.board.nodes; return ns[Math.floor(r() * ns.length)]?.id }
      const states = [store.board]
      for (let step = 0; step < 30; step++) {
        const id = pickId()
        const cmds: (Command | null)[] = [
          id ? moveNodes(new Map([[id, { x: r() * 100, y: r() * 100 }]])) : null,
          id ? setText(id, 'edited ' + step) : null,
          addNode({ id: `new${step}`, parent: r() < 0.5 ? id ?? null : null, x: 0, y: 0 }),
          id && r() < 0.3 ? deleteSubtrees([id]) : null,
          id ? duplicate(new Map([[id, { x: 5, y: 5 }]])) : null,
          id && pickId() ? addLink(id, pickId()!) : null,
          id ? moveSubtrees(new Map([[id, { x: 7, y: -3 }]])) : null,
          id ? reparent(id, r() < 0.2 ? null : pickId() ?? null) : null,
          id ? setCollapsed([id], r() < 0.5) : null,
          collapseToLevel(1 + Math.floor(r() * 4)),
          id ? swapSibling(id, r() < 0.5 ? -1 : 1, () => ({ width: 80, height: 30 })) : null,
          id ? sortChildren([id], r() < 0.5 ? 'name' : 'status') : null,
          id ? tidyNodes([id], () => ({ width: 80, height: 30 })) : null,
          id ? setStatus([id], r() < 0.3 ? undefined : 'blocked') : null,
          id ? toggleDone([id, pickId() ?? id]) : null,
          id ? insertNodes(parseOutline('- a\n  - [x] b\n- c', new Set(store.board.nodes.map(n => n.id))), [], id, { x: 1, y: 2 }) : null,
        ]
        const cmd = cmds[Math.floor(r() * cmds.length)]
        if (!cmd) continue
        const before = store.board
        store.dispatch(cmd)
        if (store.board !== before) states.push(store.board)
        const v = validateBoard(store.board)
        expect(v.ok, v.ok ? '' : v.message).toBe(true)
      }
      for (let i = states.length - 1; i > 0; i--) { expect(store.board).toBe(states[i]); store.undo() }
      expect(store.board).toBe(states[0])
      for (let i = 1; i < states.length; i++) { store.redo(); expect(store.board).toBe(states[i]) }
    }
  })

  it('keeps 100 steps and a new edit clears redo', () => {
    const store = new BoardStore(small())
    for (let i = 0; i < 120; i++) store.dispatch(setText('a', String(i)))
    for (let i = 0; i < 150; i++) store.undo()
    expect(store.board.nodes[0].text).toBe('19')
    store.dispatch(setText('a', 'x'))
    store.redo()
    expect(store.board.nodes[0].text).toBe('x')
  })
})

describe('key bindings (D25, M6 settings)', () => {
  const ev = (key: string, code: string, m: Partial<KeyboardEvent> = {}) => ({ key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m })
  it('a recorded key press becomes a binding that matches the same press', () => {
    const cases = [ev('z', 'KeyZ', { ctrlKey: true }), ev('!', 'Digit1', { shiftKey: true }), ev('E', 'KeyE', { shiftKey: true }), ev('Tab', 'Tab'), ev('ArrowUp', 'ArrowUp', { altKey: true }), ev('.', 'Period', { ctrlKey: true })]
    const expected = ['Mod+Z', 'Shift+Digit1', 'Shift+KeyE', 'Tab', 'Alt+ArrowUp', 'Mod+.']
    expect(cases.map(c => bindingFor(c))).toEqual(expected)
    cases.forEach((c, i) => expect(actionFor(c as KeyboardEvent, { ...Object.fromEntries(Object.keys(DEFAULT_KEYS).map(a => [a, []])), undo: [expected[i]] } as Keymap)).toBe('undo'))
    expect(bindingFor(ev('Shift', 'ShiftLeft', { shiftKey: true }))).toBeUndefined()
  })
})
