// Round 15 (feedback 2026-09-28): a line dropped on a selected group (D60).
import { expect, it } from 'vitest'
import { connectToGroup } from '../../src/core/commands.ts'
import type { Board } from '../../src/core/schema.ts'

// a > s; b > c; d; label l
const board: Board = {
  schema: 1, theme: {}, links: [],
  nodes: [
    { id: 'a', parent: null, order: 0, text: 'A', x: 0, y: 0 },
    { id: 's', parent: 'a', order: 0, text: 'S', x: 100, y: 0 },
    { id: 'b', parent: null, order: 1, text: 'B', x: 0, y: 100 },
    { id: 'c', parent: 'b', order: 0, text: 'C', x: 100, y: 100 },
    { id: 'd', parent: null, order: 2, text: 'D', x: 0, y: 200 },
    { id: 'l', parent: null, order: 3, text: 'L', x: 0, y: 300, shape: 'label' },
  ],
}
const parentOf = (b: Board, id: string) => b.nodes.find(n => n.id === id)?.parent

it('the top nodes of the group become children of the source, bringing their children', () => {
  const b = connectToGroup('s', ['b', 'c', 'd'], false)(board)
  expect([parentOf(b, 'b'), parentOf(b, 'c'), parentOf(b, 'd')]).toEqual(['s', 'b', 's'])
  expect(b.links).toEqual([])
})

it('an ancestor of the source or a label in the group gets a link instead, as with one node', () => {
  const b = connectToGroup('s', ['a', 'd', 'l'], false)(board)
  expect([parentOf(b, 'a'), parentOf(b, 'd'), parentOf(b, 'l')]).toEqual([null, 's', null])
  expect(b.links.map(l => `${l.from}-${l.to}`)).toEqual(['s-a', 's-l'])
})

it('Alt links the source to each top node and moves nothing', () => {
  const b = connectToGroup('s', ['b', 'c', 'd'], true)(board)
  expect(b.nodes).toBe(board.nodes)
  expect(b.links.map(l => `${l.from}-${l.to}`)).toEqual(['s-b', 's-d'])
})
