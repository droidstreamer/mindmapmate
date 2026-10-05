import { describe, expect, it } from 'vitest'
import { collapseToLevel, expandAll, moveSubtrees, reparent, setCollapsed, setDirection, sortChildren, swapSibling, tidyNodes } from '../../src/core/commands.ts'
import { childSpot, tidyBranches } from '../../src/core/layout/tidy.ts'
import { neighbor } from '../../src/core/navigate.ts'
import type { Board, BoardNode } from '../../src/core/schema.ts'
import { hiddenIds, shownLevel, subtreeCounts } from '../../src/core/tree.ts'
import { visibleBoard } from '../../src/core/visibility.ts'
import { generateBoard } from '../generate.ts'

const size = () => ({ width: 100, height: 30 })
const node = (id: string, parent: string | null, order: number, x: number, y: number, extra: Partial<BoardNode> = {}): BoardNode =>
  ({ id, parent, order, text: id, x, y, ...extra })
// r ── a ── a1
//   │    └─ a2
//   └─ b
const tree = (): Board => ({
  schema: 1, theme: {}, links: [{ id: 'l1', from: 'a1', to: 'b' }],
  nodes: [
    node('r', null, 0, 0, 0),
    node('a', 'r', 0, 200, -50),
    node('a1', 'a', 0, 400, -80, { status: 'done' }),
    node('a2', 'a', 1, 400, -20),
    node('b', 'r', 1, 200, 50),
  ],
})
const at = (b: Board, id: string) => { const n = b.nodes.find(n => n.id === id)!; return { x: n.x, y: n.y } }

describe('collapse (F7)', () => {
  it('counts match a brute-force count on random boards (property test)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { nodes } = generateBoard(seed, 120)
      const counts = subtreeCounts(nodes)
      const hidden = hiddenIds(nodes)
      const parentOf = new Map(nodes.map(n => [n.id, n.parent]))
      const isUnder = (id: string, anc: string) => {
        for (let p = parentOf.get(id)!; p !== null; p = parentOf.get(p)!) if (p === anc) return true
        return false
      }
      for (const n of nodes) {
        const desc = nodes.filter(d => isUnder(d.id, n.id))
        expect(counts.get(n.id)).toEqual({
          children: nodes.filter(d => d.parent === n.id).length,
          descendants: desc.length,
          done: nodes.filter(d => d.parent === n.id && d.status === 'done').length,
          tasks: nodes.filter(d => d.parent === n.id && d.status && d.status !== 'dropped').length,
        })
        expect(hidden.has(n.id)).toBe(nodes.some(a => a.collapsed && isUnder(n.id, a.id)))
      }
    }
  })

  it('collapsing hides the branch and its cross-links; leaves never collapse', () => {
    const b = setCollapsed(['a', 'b'], true)(tree())
    expect(b.nodes.find(n => n.id === 'b')!.collapsed).toBeUndefined()
    const v = visibleBoard(b)
    expect(v.nodes.map(n => n.id)).toEqual(['r', 'a', 'b'])
    expect(v.links).toEqual([])
    expect(subtreeCounts(b.nodes).get('a')).toEqual({ children: 2, descendants: 2, done: 1, tasks: 1 })
    expect(expandAll(b).nodes.every(n => !('collapsed' in n))).toBe(true)
  })

  it('collapse to level N keeps levels 1..N open', () => {
    const b = collapseToLevel(2)(setCollapsed(['r'], true)(tree()))
    expect(b.nodes.filter(n => n.collapsed).map(n => n.id)).toEqual(['a'])
    expect(collapseToLevel(1)(tree()).nodes.filter(n => n.collapsed).map(n => n.id)).toEqual(['r'])
  })
})

describe('hierarchy commands', () => {
  it('moving a branch moves every descendant, hidden ones too (F2, D3)', () => {
    const b = moveSubtrees(new Map([['a', { x: 10, y: 5 }], ['a1', { x: 10, y: 5 }]]))(setCollapsed(['a'], true)(tree()))
    expect(at(b, 'a1')).toEqual({ x: 410, y: -75 }) // moved once, not twice
    expect(at(b, 'a2')).toEqual({ x: 410, y: -15 })
    expect(at(b, 'b')).toEqual({ x: 200, y: 50 })
  })

  it('reparent goes last among new siblings and refuses cycles (D1)', () => {
    const b = reparent('b', 'a')(tree())
    expect(b.nodes.find(n => n.id === 'b')).toMatchObject({ parent: 'a', order: 2 })
    const t = tree()
    expect(reparent('a', 'a1')(t)).toBe(t)
    expect(reparent('a', 'a')(t)).toBe(t)
    expect(reparent('a', 'r')(t)).toBe(t)
    expect(reparent('a1', null)(t).nodes.find(n => n.id === 'a1')!.parent).toBeNull()
  })

  it('Alt+Down swaps order and branch places, nothing else moves', () => {
    const b = swapSibling('a', 1, size)(tree())
    const order = (id: string) => b.nodes.find(n => n.id === id)!.order
    expect(order('b')).toBeLessThan(order('a'))
    expect(at(b, 'b').y).toBe(-80) // b takes the top of a's branch
    expect(at(b, 'a').y - at(b, 'b').y).toBeGreaterThan(30)
    expect(at(b, 'a1').y - at(b, 'a').y).toBe(-30) // branch keeps its shape
    expect(at(b, 'r')).toEqual({ x: 0, y: 0 })
    const t = tree()
    expect(swapSibling('b', 1, size)(t)).toBe(t)
  })

  it('sorts children by name and status', () => {
    const t = tree()
    t.nodes.push(node('c', 'r', 2, 200, 100, { text: 'A first', status: 'doing' }))
    const byName = sortChildren(['r'], 'name')(t)
    expect(byName.nodes.filter(n => n.parent === 'r').sort((x, y) => x.order - y.order).map(n => n.id)).toEqual(['a', 'c', 'b'])
    const byStatus = sortChildren(['a', 'r'], 'status')(t)
    expect(byStatus.nodes.filter(n => n.parent === 'a').sort((x, y) => x.order - y.order).map(n => n.id)).toEqual(['a2', 'a1'])
    expect(byStatus.nodes.find(n => n.id === 'c')!.order).toBe(0)
  })

  it('tidy lays collapsed nodes out as leaves and carries their hidden branch (D3)', () => {
    const b = setCollapsed(['a'], true)(tree())
    const pos = tidyBranches(b, ['r'], size)
    const a = pos.get('a')!, a1 = pos.get('a1')!
    expect(a1.x - a.x).toBe(200)
    expect(a1.y - a.y).toBe(-30)
    expect(pos.get('r')).toEqual({ x: 0, y: 0 })
    expect(a.y).toBeLessThan(pos.get('b')!.y)
    const left = tidyNodes(['r'], size)(setDirection('left')(tree()))
    expect(at(left, 'a').x).toBe(-160)
  })

  it('new children go after the last sibling branch, or beside the parent (D4)', () => {
    expect(childSpot(tree(), 'a', size)).toEqual({ x: 400, y: 22 })
    expect(childSpot(tree(), 'b', size)).toEqual({ x: 360, y: 50 })
    expect(childSpot(setDirection('down')(tree()), 'b', size)).toEqual({ x: 200, y: 120 })
  })
})

describe('arrow keys', () => {
  it('move to parent, child and sibling from real positions', () => {
    const { nodes } = tree()
    expect(neighbor(nodes, 'a', 'l', size)).toBe('r')
    expect(neighbor(nodes, 'r', 'r', size)).toBe('a') // nearer in line than b? both 50 away: first wins
    expect(neighbor(nodes, 'a', 'r', size)).toBe('a1')
    expect(neighbor(nodes, 'a1', 'b', size)).toBe('a2')
    expect(neighbor(nodes, 'a', 'b', size)).toBe('b')
    expect(neighbor(nodes, 'a', 't', size)).toBeUndefined()
  })
})

describe('shownLevel (round 17)', () => {
  it('counts the deepest visible level, following collapse and expand', () => {
    const b = tree() // r > a > a1, a2; r > b: three levels
    expect(shownLevel(b.nodes)).toBe(3)
    expect(shownLevel(collapseToLevel(2)(b).nodes)).toBe(2)
    expect(shownLevel(collapseToLevel(1)(b).nodes)).toBe(1)
    expect(shownLevel(expandAll(collapseToLevel(1)(b)).nodes)).toBe(3)
    expect(shownLevel([])).toBe(1)
  })
})
