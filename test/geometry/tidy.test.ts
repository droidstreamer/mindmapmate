import { describe, expect, it } from 'vitest'
import { DIRECTIONS, tidy, tidyBranches, type Direction, type Size } from '../../src/core/layout/tidy.ts'
import { facing } from '../../src/core/navigate.ts'
import { generateBoard, rng } from '../generate.ts'
import type { Board, BoardNode } from '../../src/core/schema.ts'

type Rect = { x: number, y: number, w: number, h: number }

// Nodes of mixed text length: widths 40-320, heights of 1-6 wrapped lines.
function sizes(board: Board, seed: number): (id: string) => Size {
  const r = rng(seed)
  const map = new Map(board.nodes.map(n => [n.id, { width: 40 + Math.round(r() * 280), height: 24 * (1 + Math.floor(r() * 6)) }]))
  return id => map.get(id)!
}

/** One expanded tree of `count` nodes, `depth` levels. */
function oneTree(seed: number, count: number, depth: number): Board {
  const board = generateBoard(seed, count, depth)
  for (const n of board.nodes) { if (n !== board.nodes[0]) n.parent ??= board.nodes[0].id; delete n.collapsed }
  return board
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

type Seg = [number, number, number, number]
function cross(s: Seg, t: Seg) {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
  return o(s[0], s[1], s[2], s[3], t[0], t[1]) * o(s[0], s[1], s[2], s[3], t[2], t[3]) < 0
    && o(t[0], t[1], t[2], t[3], s[0], s[1]) * o(t[0], t[1], t[2], t[3], s[2], s[3]) < 0
}

/** Overlapping node pairs plus crossing parent-child edges, with edges drawn between the facing
 *  sides the board picks for them (as a straight line; curves stay inside the same band). */
function defects(board: Board, direction: Direction, size: (id: string) => Size) {
  const root = board.nodes[0]
  const pos = tidy(board.nodes, root.id, size, direction)
  expect(pos.get(root.id)).toEqual({ x: root.x, y: root.y })
  expect(pos.size).toBe(board.nodes.length)
  const placed = new Map(board.nodes.map(n => [n.id, { ...n, ...pos.get(n.id)! } as BoardNode]))
  const rect = (id: string): Rect => { const n = placed.get(id)!, s = size(id); return { x: n.x, y: n.y, w: s.width, h: s.height } }
  const rs = board.nodes.map(n => rect(n.id))
  let bad = 0
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) if (overlaps(rs[i], rs[j])) bad++

  const anchor = (r: Rect, side: string): [number, number] =>
    side === 'r' ? [r.x + r.w, r.y + r.h / 2] : side === 'l' ? [r.x, r.y + r.h / 2] : side === 'b' ? [r.x + r.w / 2, r.y + r.h] : [r.x + r.w / 2, r.y]
  const segs: Seg[] = board.nodes.filter(n => n.parent).map(n => {
    const [ps, cs] = facing(placed.get(n.parent!)!, placed.get(n.id)!, size, direction === 'down')
    return [...anchor(rect(n.parent!), ps), ...anchor(rect(n.id), cs)]
  })
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) if (cross(segs[i], segs[j])) bad++
  return bad
}

describe('tidy (M2 gate geometry)', () => {
  for (const direction of DIRECTIONS) {
    it(`${direction}: 200 nodes of mixed size, 20 seeds: zero overlaps, zero crossings, anchor fixed`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const board = oneTree(seed, 200, 10)
        expect(defects(board, direction, sizes(board, seed)), `seed ${seed}`).toBe(0)
      }
    })

    it(`${direction}: 2,000 nodes, 10 levels: zero overlaps and crossings, under 200 ms`, () => {
      const board = oneTree(7, 2000, 10)
      const size = sizes(board, 7)
      const t = performance.now()
      tidy(board.nodes, board.nodes[0].id, size, direction)
      expect(performance.now() - t).toBeLessThan(200)
      expect(defects(board, direction, size)).toBe(0)
    })
  }
})

it('whole-board tidy stays linear with many roots and collapsed branches (5,000 nodes, under 100 ms)', () => {
  const board = generateBoard(5000, 5000, 10) // about 150 roots, 10% collapsed
  const size = sizes(board, 1)
  const t = performance.now()
  const pos = tidyBranches(board, board.nodes.filter(n => n.parent === null).map(n => n.id), size)
  expect(performance.now() - t).toBeLessThan(100)
  expect(pos.size).toBe(5000)
})
