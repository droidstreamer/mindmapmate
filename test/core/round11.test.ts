// Round 11 (feedback 2026-09-27): square routing, resize edges on the grid, Arrange > Size, shortcut hint labels.
import { expect, it } from 'vitest'
import { setWidths } from '../../src/core/commands.ts'
import { linePath, snapEdge } from '../../src/core/geometry.ts'
import { trunks } from '../../src/core/navigate.ts'
import type { Board } from '../../src/core/schema.ts'
import { keyLabel } from '../../src/ui/input/keymap.ts'

// The screenshot: a parent with two near children and one far to the right.
const board: Board = {
  schema: 1, theme: {}, links: [],
  nodes: [
    { id: 'p', parent: null, order: 0, text: 'Parent', x: 0, y: 200, width: 300 },
    { id: 'a', parent: 'p', order: 0, text: 'A', x: 600, y: 0, width: 200 },
    { id: 'b', parent: 'p', order: 1, text: 'B', x: 600, y: 100, width: 200 },
    { id: 'c', parent: 'p', order: 2, text: 'C', x: 1000, y: 300, width: 200 },
  ],
} as Board
const size = (id: string) => ({ width: board.nodes.find(n => n.id === id)!.width!, height: 40 })

it('square routing turns every line from one side of a parent at the same place, halfway to the nearest child', () => {
  const t = trunks(board.nodes, size)
  expect([t.get('a'), t.get('b'), t.get('c')]).toEqual([150, 150, 150])
  // Each line's first bend is at the parent's side + 150, the far child's included.
  const bendX = (to: string) => {
    const n = board.nodes.find(n => n.id === to)!
    const d = linePath('square', { x: 300, y: 220 }, 'r', { x: n.x, y: n.y + 20 }, 'l', 0, 0, t.get(to)).d
    return Number(d.split('L')[2].split(' ')[0])
  }
  expect(new Set(['a', 'b', 'c'].map(bendX))).toEqual(new Set([450]))
  // Angular still bends halfway to each child.
  expect(linePath('angular', { x: 300, y: 220 }, 'r', { x: 1000, y: 320 }, 'l').d).toContain('L650 ')
})

it('square routing keeps a short stub when children crowd the parent', () => {
  const close = board.nodes.map(n => n.id === 'a' ? { ...n, x: 305 } : n)
  expect(trunks(close, size).get('c')).toBe(12)
})

it('a resized edge lands on the grid and the other edge stays', () => {
  expect(snapEdge(13, 100, 'right', 20, 60)).toEqual({ x: 13, width: 107 })
  expect(snapEdge(13, 100, 'left', 20, 60)).toEqual({ x: 20, width: 93 })
  // Never narrower than the minimum.
  expect(snapEdge(13, 40, 'right', 20, 60).width).toBeGreaterThanOrEqual(60)
  expect(snapEdge(13, 40, 'left', 20, 60).width).toBeGreaterThanOrEqual(60)
})

it('Arrange > Size sets widths, and fit to text clears them in one step', () => {
  const b = setWidths(new Map([['a', 250.4], ['b', 250.4]]))(board)
  expect(b.nodes.filter(n => n.id === 'a' || n.id === 'b').map(n => n.width)).toEqual([250, 250])
  const fit = setWidths(new Map([['a', undefined]]))(b)
  expect(fit.nodes.find(n => n.id === 'a')).not.toHaveProperty('width')
  expect(setWidths(new Map([['a', 200]]))(board)).toBe(board)
})

it('shortcut hints name keys the way people read them', () => {
  expect(keyLabel('Mod+Shift+Enter')).toMatch(/^(Ctrl|Cmd)\+Shift\+Enter$/)
  expect(keyLabel('Shift+Digit1')).toBe('Shift+1')
  expect(keyLabel('Alt+ArrowUp')).toBe('Alt+↑')
})
