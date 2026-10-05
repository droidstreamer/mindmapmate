// Round 14 (feedback 2026-09-28): delete a node but keep its children (D5), insert a node on a parent line.
import { expect, it } from 'vitest'
import { deleteKeepChildren, insertOnLine } from '../../src/core/commands.ts'
import type { Board } from '../../src/core/schema.ts'

// a > (b > (c, e), d); link b-d
const board: Board = {
  schema: 1, theme: {}, links: [{ id: 'l1', from: 'b', to: 'd' }],
  nodes: [
    { id: 'a', parent: null, order: 0, text: 'A', x: 0, y: 0 },
    { id: 'b', parent: 'a', order: 0, text: 'B', x: 100, y: 0 },
    { id: 'c', parent: 'b', order: 0, text: 'C', x: 200, y: 0, edgeColor: 'red' },
    { id: 'e', parent: 'b', order: 1, text: 'E', x: 200, y: 40 },
    { id: 'd', parent: 'a', order: 1, text: 'D', x: 100, y: 80 },
  ],
}
const kids = (b: Board, p: string | null) => b.nodes.filter(n => n.parent === p).sort((x, y) => x.order - y.order).map(n => n.id)

it('delete keeping children puts them in the deleted node\'s place, where they stand, and drops its links', () => {
  const b = deleteKeepChildren(['b'])(board)
  expect(kids(b, 'a')).toEqual(['c', 'e', 'd'])
  expect(b.nodes.find(n => n.id === 'c')).toMatchObject({ x: 200, y: 0, edgeColor: 'red' })
  expect(b.links).toEqual([])
})

it('delete keeping children climbs past deleted parents, and a root\'s children become roots', () => {
  expect(kids(deleteKeepChildren(['a', 'b'])(board), null)).toEqual(['c', 'e', 'd'])
  expect(deleteKeepChildren(['zz'])(board)).toBe(board)
})

it('a node inserted on a line sits between parent and child', () => {
  const b = insertOnLine('c', { id: 'n', x: 150, y: 0 })(board)
  expect(b.nodes.find(n => n.id === 'n')).toMatchObject({ parent: 'b', order: 0, x: 150, text: '' })
  expect(b.nodes.find(n => n.id === 'c')).toMatchObject({ parent: 'n', order: 0 })
  expect(kids(b, 'b')).toEqual(['n', 'e'])
  expect(insertOnLine('a', { id: 'n', x: 0, y: 0 })(board)).toBe(board)
})
