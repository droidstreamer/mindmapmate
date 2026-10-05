import { describe, expect, it } from 'vitest'
import { setLinkStyle, setStyle, setTheme } from '../../src/core/commands.ts'
import { dashArray, edgeWidth, HEAD_LENGTH, linePath, MIN_WIDTH, nodePath, overhang, pushCustom, SHAPES } from '../../src/core/geometry.ts'
import { facing, type Side } from '../../src/core/navigate.ts'
import type { Board, BoardNode } from '../../src/core/schema.ts'
import { BoardStore } from '../../src/core/store.ts'
import { BOARD_DEFAULTS, boardStyle, PRESETS, resolveStyles } from '../../src/core/style.ts'
import { generateBoard } from '../generate.ts'

const node = (id: string, parent: string | null, order: number, extra: Partial<BoardNode> = {}): BoardNode =>
  ({ id, parent, order, text: id, x: 0, y: 0, ...extra })
const board = (nodes: BoardNode[], theme: Record<string, unknown> = {}): Board => ({ schema: 1, theme, nodes, links: [] })

// r -> a -> a1 -> a2, r -> b -> b1
const tree = (extra: Record<string, Partial<BoardNode>> = {}, theme = {}) => board(
  [['r', null], ['a', 'r'], ['a1', 'a'], ['a2', 'a1'], ['b', 'r'], ['b1', 'b']].map(([id, p], i) => node(id!, p, i, extra[id!])), theme)

describe('style resolution v2 (D13, D28)', () => {
  it('auto: a root is the text color, its children take presets in turn, deeper nodes inherit their parent', () => {
    const s = resolveStyles(tree())
    expect(s.nodes.get('r')!.stroke).toBe('var(--text-normal)')
    expect(['a', 'a1', 'a2'].map(id => s.nodes.get(id)!.stroke)).toEqual([PRESETS[0], PRESETS[0], PRESETS[0]])
    expect(['b', 'b1'].map(id => s.nodes.get(id)!.stroke)).toEqual([PRESETS[2], PRESETS[2]])
  })

  it('a picked color flows down to every auto node below it, and stops at another picked color', () => {
    const s = resolveStyles(tree({ a: { stroke: 5 }, a1: { stroke: '#112233' }, b1: { stroke: 'auto' } }))
    expect(s.nodes.get('a')!.stroke).toBe(PRESETS[5])
    expect(s.nodes.get('a1')!.stroke).toBe('#112233')
    expect(s.nodes.get('a2')!.stroke).toBe('#112233')
    expect(s.nodes.get('b1')!.stroke).toBe(PRESETS[2])
  })

  it('fill (D36): unset or auto inherits the parent\'s fill through every level, none passes none down, a root starts with none', () => {
    const s = resolveStyles(tree({ a: { fill: 3 }, a1: { fill: 'auto' }, b: { fill: 5 }, b1: { fill: null } }))
    expect(s.nodes.get('r')!.fill).toBeUndefined()
    expect(['a', 'a1', 'a2'].map(id => s.nodes.get(id)!.fill)).toEqual([PRESETS[3], PRESETS[3], PRESETS[3]])
    expect(s.nodes.get('b')!.fill).toBe(PRESETS[5])
    expect(s.nodes.get('b1')!.fill).toBeUndefined()
    const none = resolveStyles(tree({ a: { fill: 3 }, a1: { fill: null } }))
    expect(none.nodes.get('a2')!.fill).toBeUndefined()
  })

  it('a picked root outline flows to every auto node below it (D36); an auto root hands out palette colors', () => {
    const s = resolveStyles(tree({ r: { stroke: 6 } }))
    expect(['r', 'a', 'a1', 'a2', 'b', 'b1'].map(id => s.nodes.get(id)!.stroke)).toEqual(Array(6).fill(PRESETS[6]))
  })

  it('shape is per node, round by default (no level rules)', () => {
    const s = resolveStyles(tree({ a1: { shape: 'hex' } }, { shapes: ['pill'] }))
    expect(['r', 'a', 'a1'].map(id => s.nodes.get(id)!.shape)).toEqual(['round', 'round', 'hex'])
  })

  it('parent lines: auto color is the child outline, triangle head at the child, overrides per line', () => {
    const s = resolveStyles(tree({ a1: { stroke: '#abcdef' }, b: { edgeDash: 'dotted', edgeArrow: 'dot', edgeDirection: 'both', edgeColor: 7, edgeLabel: 'needs' } }))
    expect(s.edges.get('a1')).toMatchObject({ color: '#abcdef', dash: 'solid', arrow: 'triangle', direction: 'end' })
    expect(s.edges.get('b')).toMatchObject({ color: PRESETS[7], dash: 'dotted', arrow: 'dot', direction: 'both', label: 'needs' })
    expect(s.edges.has('r')).toBe(false)
  })

  it('cross-links default to dashed with a chevron, and take overrides', () => {
    const b = { ...tree(), links: [{ id: 'l1', from: 'a', to: 'b' }, { id: 'l2', from: 'a', to: 'b1', dash: 'solid', label: 'x' }] }
    const s = resolveStyles(b)
    expect(s.links.get('l1')).toMatchObject({ dash: 'dashed', arrow: 'chevron', direction: 'end', color: 'var(--text-muted)' })
    expect(s.links.get('l2')).toMatchObject({ dash: 'solid', label: 'x' })
  })

  it('invalid values are ignored, so nothing unsafe reaches CSS', () => {
    const s = resolveStyles(tree({ a: { stroke: 'url(https://x.test/a.png)', fill: 'red; x: y', shape: 'star', edgeDash: 'zigzag', edgeColor: 9 } },
      { routing: 'wavy', maxWidth: 99, font: 'x; background: url(y)', textColor: 'url(z)', customColors: ['#123456', 'url(q)', 7] }))
    expect(s.nodes.get('a')).toEqual({ shape: 'round', stroke: PRESETS[0] })
    expect(s.edges.get('a')).toMatchObject({ dash: 'solid', color: PRESETS[0] })
    expect(s.style).toEqual({ ...BOARD_DEFAULTS, customColors: ['#123456'] })
  })

  it('line width tapers from the maximum to 1px at the deepest level; off means every line is the maximum', () => {
    const s = resolveStyles(tree({}, { maxWidth: 7 }))
    expect(s.edges.get('a')!.width).toBe(7)
    expect(s.edges.get('a2')!.width).toBe(1)
    expect(s.edges.get('a1')!.width).toBe(4)
    expect(resolveStyles(tree({}, { maxWidth: 7, taper: false })).edges.get('a2')!.width).toBe(7)
    for (let d = 1; d < 60; d++) expect(edgeWidth(d, 59, 8, true)).toBeGreaterThanOrEqual(MIN_WIDTH)
  })

  it('every node of a generated board gets a look, and every non-root a line', () => {
    const b = generateBoard(7, 2000, 10)
    const s = resolveStyles(b)
    expect(s.nodes.size).toBe(b.nodes.length)
    expect(s.edges.size).toBe(b.nodes.filter(n => n.parent !== null).length)
  })
})

describe('style commands', () => {
  it('setStyle sets and clears overrides on nodes; a no-op returns the same board', () => {
    const b = tree()
    const s = setStyle(['a', 'b'], { shape: 'pill', fill: null })(b)
    expect(s.nodes.filter(n => n.shape === 'pill' && n.fill === null).map(n => n.id)).toEqual(['a', 'b'])
    expect(setStyle(['a', 'b'], { shape: 'pill' })(s)).toBe(s)
    expect(setStyle(['a'], { shape: undefined, fill: undefined })(s).nodes.find(n => n.id === 'a')).not.toHaveProperty('shape')
  })

  it('setLinkStyle styles cross-links', () => {
    const b = { ...tree(), links: [{ id: 'l1', from: 'a', to: 'b' }] }
    const s = setLinkStyle(['l1'], { label: 'depends on', dash: 'solid' })(b)
    expect(s.links[0]).toMatchObject({ label: 'depends on', dash: 'solid' })
    expect(setLinkStyle(['l1'], { dash: 'solid' })(s)).toBe(s)
    expect(setLinkStyle(['l1'], { label: undefined })(s).links[0]).not.toHaveProperty('label')
  })

  it('switching routing changes only the theme: no node moves (gate)', () => {
    const b = generateBoard(3, 2000, 10)
    const t = performance.now()
    const next = setTheme({ routing: 'angular' })(b)
    resolveStyles(next)
    expect(performance.now() - t).toBeLessThan(100)
    expect(next.nodes).toBe(b.nodes)
    expect(setTheme({ routing: 'angular' })(next)).toBe(next)
    expect(setTheme({ routing: undefined })(next).theme).not.toHaveProperty('routing')
  })

  it('merged dispatches are one undo step (color picker and slider drags)', () => {
    const store = new BoardStore(tree())
    store.dispatch(setTheme({ maxWidth: 2 }))
    store.dispatch(setTheme({ maxWidth: 3 }), true)
    store.dispatch(setTheme({ maxWidth: 5 }), true)
    expect(boardStyle(store.board).maxWidth).toBe(5)
    store.undo()
    expect(store.board.theme).not.toHaveProperty('maxWidth')
  })
})

describe('geometry', () => {
  const dir = (a: number) => ((a % 360) + 360) % 360

  it('arrowheads line up with the line end: straight along the line, curved and angular square to the side (D31)', () => {
    for (let k = 0; k < 200; k++) {
      const p1 = { x: Math.sin(k) * 300, y: Math.cos(k * 1.7) * 300 }, p2 = { x: Math.sin(k * 2.3) * 300, y: Math.cos(k * 0.7) * 300 }
      // Sides as the board picks them: the ones the two nodes face each other with (D12).
      const box = () => ({ width: 120, height: 38 })
      const [s1, s2] = facing(node('p', null, 0, p1), node('c', null, 0, p2), box, k % 3 === 0)
      const straight = linePath('straight', p1, s1, p2, s2, 10, 10)
      expect(dir(straight.end.angle)).toBeCloseTo(dir(Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI), 6)
      expect(dir(straight.start.angle)).toBeCloseTo(dir(straight.end.angle + 180), 6)
      const into: Record<Side, number> = { l: 0, t: 90, r: 180, b: 270 } // a head entering side s points this way
      for (const routing of ['curved', 'angular'] as const) {
        const g = linePath(routing, p1, s1, p2, s2, 10, 10)
        expect(dir(g.end.angle)).toBeCloseTo(into[s2], 6)
        expect(dir(g.start.angle)).toBeCloseTo(into[s1], 6)
        // The path's own last step runs the same way as the head, within 1 degree.
        const nums = g.d.match(/-?[\d.]+(e-?\d+)?/g)!.map(Number)
        const [x1, y1, x2, y2] = nums.slice(-4)
        if (Math.hypot(x2 - x1, y2 - y1) > 1e-6) expect(Math.abs(((Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI - g.end.angle + 540) % 360) - 180)).toBeLessThan(1)
      }
    }
  })

  it('lines stop at the arrowhead base, so the tip never looks detached', () => {
    const g = linePath('straight', { x: 0, y: 0 }, 'r', { x: 100, y: 0 }, 'l', 0, HEAD_LENGTH.triangle)
    expect(g.d).toBe('M0 0L90 0')
    expect(linePath('curved', { x: 0, y: 0 }, 'r', { x: 200, y: 80 }, 'l', 0, 10).d.endsWith('190 80')).toBe(true)
  })

  it('every shape has a path, and lines attach at the outline', () => {
    for (const k of SHAPES) expect(nodePath(k, 120, 38)).toMatch(/^M/)
    // The attach point at the middle of each side is on the outline itself (browser check: test/obsidian/check.mjs).
    expect(overhang('diamond', 40)).toEqual({ x: 0, y: 0 })
    expect(overhang('hex', 40)).toEqual({ x: 8, y: 0 })   // points at -0.4r = -0.2h
    expect(overhang('para', 40).x).toBeCloseTo(-3)          // slanted side crosses mid-height 0.075h inside
    expect(nodePath('diamond', 120, 40)).toBe('M0 20L60 0L120 20L60 40Z')
  })

  it('dash patterns and custom colors follow the handoff', () => {
    expect(dashArray('dashed', 2).dasharray).toBe('15 9')
    expect(dashArray('dotted', 2)).toEqual({ dasharray: '0.01 7', linecap: 'round' })
    // M6b: 8 slots, newest first; the oldest drops out.
    let list: string[] = []
    for (let i = 1; i <= 9; i++) list = pushCustom(list, `#${String(i).repeat(6)}`, true)
    expect(list).toEqual(['#999999', '#888888', '#777777', '#666666', '#555555', '#444444', '#333333', '#222222'])
    expect(pushCustom(list, '#000000', false).slice(0, 2)).toEqual(['#000000', '#888888'])
    expect(pushCustom(list, '#222222', true).slice(0, 3)).toEqual(['#222222', '#999999', '#888888'])
  })
})
