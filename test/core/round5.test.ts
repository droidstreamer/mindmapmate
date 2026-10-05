// M6b (feedback round 5): drop rule, align and distribute, match-outline fills, the Auto swatch's color.
import { describe, expect, it } from 'vitest'
import { alignNodes, connectTo, setStyle, stackRoots } from '../../src/core/commands.ts'
import type { Board, BoardNode } from '../../src/core/schema.ts'
import { PRESETS, resolveStyles } from '../../src/core/style.ts'

const node = (id: string, parent: string | null, extra: Partial<BoardNode> = {}): BoardNode => ({ id, parent, order: 0, text: id, x: 0, y: 0, ...extra })
const board = (nodes: BoardNode[], theme: Record<string, unknown> = {}, links: Board['links'] = []): Board => ({ schema: 1, theme, nodes, links })
const parentOf = (b: Board, id: string) => b.nodes.find(n => n.id === id)!.parent

describe('connectTo (D37 amended)', () => {
  // r -> a -> a1, r -> b
  const b0 = () => board([node('r', null), node('a', 'r'), node('a1', 'a'), node('b', 'r')], {}, [{ id: 'l', from: 'b', to: 'a1' }])
  it('a drop reparents, dropping the old parent line and any link between the two', () => {
    const b = connectTo('b', 'a1', false)(b0())
    expect(parentOf(b, 'a1')).toBe('b')
    expect(b.links).toEqual([])
  })
  it('Alt makes a link; an ancestor target makes a link; an existing child is left alone', () => {
    expect(connectTo('a', 'b', true)(b0()).links).toHaveLength(2)
    const up = connectTo('a1', 'r', false)(b0())
    expect(parentOf(up, 'r')).toBe(null)
    expect(up.links.at(-1)).toMatchObject({ from: 'a1', to: 'r' })
    const same = b0()
    expect(connectTo('a', 'a1', false)(same)).toBe(same)
  })
})

describe('alignNodes', () => {
  const size = (id: string) => ({ width: id === 'w' ? 200 : 100, height: 40 })
  const b0 = () => board([node('p', null, { x: 0, y: 0 }), node('q', null, { x: 50, y: 300 }), node('w', null, { x: 400, y: 120 })])
  const pos = (b: Board) => Object.fromEntries(b.nodes.map(n => [n.id, [n.x, n.y]]))
  it('aligns edges and centres on the selection box, moving only one axis', () => {
    expect(pos(alignNodes(['p', 'q', 'w'], 'left', size)(b0()))).toEqual({ p: [0, 0], q: [0, 300], w: [0, 120] })
    expect(pos(alignNodes(['p', 'q', 'w'], 'right', size)(b0()))).toEqual({ p: [500, 0], q: [500, 300], w: [400, 120] })
    expect(pos(alignNodes(['p', 'w'], 'center', size)(b0()))).toEqual({ p: [250, 0], q: [50, 300], w: [200, 120] })
  })
  it('distributes with equal gaps, outer nodes fixed, at least 20px apart', () => {
    expect(pos(alignNodes(['p', 'q', 'w'], 'down', size)(b0()))).toEqual({ p: [0, 0], q: [50, 300], w: [400, 150] })
    const tight = alignNodes(['p', 'q'], 'across', size)(b0())
    expect(pos(tight).q).toEqual([120, 300])
  })
})

describe('stackRoots (round 17)', () => {
  it('left-aligns selected roots and spaces them evenly, leaving their children where they are', () => {
    const size = () => ({ width: 100, height: 40 })
    const b = board([node('p', null, { x: 0, y: 0 }), node('q', null, { x: 50, y: 300 }), node('w', null, { x: 400, y: 120 }), node('c', 'w', { x: 600, y: 500 })])
    const out = stackRoots(['p', 'q', 'w'], size)(b)
    expect(out.nodes.map(n => [n.id, n.x, n.y])).toEqual([['p', 0, 0], ['q', 0, 300], ['w', 0, 150], ['c', 600, 500]])
  })
})

describe('match-outline fills and auto colors (M6b)', () => {
  // r -> a -> a1
  const tree = (extra: Record<string, Partial<BoardNode>> = {}, theme = {}) =>
    board([node('r', null, extra.r), node('a', 'r', extra.a), node('a1', 'a', extra.a1)], theme)
  it('a node set to match its outline fills with its own outline, and auto children match theirs', () => {
    const s = resolveStyles(tree({ a: { fill: 'outline' }, a1: { stroke: '#112233' } }))
    expect(s.nodes.get('a')!.fill).toBe(PRESETS[0])
    expect(s.nodes.get('a1')!.fill).toBe('#112233')
  })
  it('the board-wide switch fills every node with its outline, None and picked fills included (round 12)', () => {
    const s = resolveStyles(tree({ a: { fill: 2 }, a1: { fill: null } }, { fillOutline: true }))
    expect(s.nodes.get('r')!.fill).toBe('var(--text-normal)')
    expect(s.nodes.get('a')!.fill).toBe(PRESETS[0])
    expect(s.nodes.get('a1')!.fill).toBe(PRESETS[0])
    expect(resolveStyles(tree({ a1: { fill: null } })).nodes.get('a1')!.fill).toBeUndefined()
  })
  it('a fill change with the switch on keeps the outline fills as stored fills and turns the switch off (round 12)', () => {
    const b = setStyle(['a1'], { fill: 5 })(tree({ a: { fill: null } }, { fillOutline: true, fillOpacity: 20 }))
    expect(b.theme).toEqual({ fillOpacity: 20 })
    expect(b.nodes.map(n => n.fill)).toEqual(['outline', 'outline', 5])
    // Without the switch, only the picked node changes.
    expect(setStyle(['a1'], { fill: 5 })(tree()).nodes.map(n => n.fill)).toEqual([undefined, undefined, 5])
  })
  it("the Auto swatch shows the parent's color, not the node's own pick", () => {
    const s = resolveStyles(tree({ a: { stroke: 3 }, a1: { stroke: '#112233' } }))
    expect(s.autos.get('a1')!.stroke).toBe(PRESETS[3])
    expect(s.autos.get('a')!.stroke).toBe(PRESETS[0])
    expect(s.autos.get('r')!.stroke).toBe('var(--text-normal)')
  })
})
