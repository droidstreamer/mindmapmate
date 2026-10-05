// Which sides of two nodes face each other (edge anchors), and arrow-key moves through the tree.

import type { BoardNode } from './schema.ts'
import type { Size } from './layout/tidy.ts'
import { childrenMap } from './tree.ts'

export type Side = 't' | 'r' | 'b' | 'l'

/**
 * Sides of `from` and `to` that face each other. A node fully beside the other uses left and right,
 * one fully below or above uses bottom and top; when both hold, `vertical` (boards growing down)
 * prefers top and bottom. Overlapping boxes fall back to the larger offset.
 * D12: each side has one handle, so every line leaving a side starts at the same anchor point.
 */
export function facing(from: BoardNode, to: BoardNode, size: (id: string) => Size, vertical = false): [Side, Side] {
  const f = size(from.id), t = size(to.id)
  const h: [Side, Side] | null = to.x >= from.x + f.width ? ['r', 'l'] : to.x + t.width <= from.x ? ['l', 'r'] : null
  const v: [Side, Side] | null = to.y >= from.y + f.height ? ['b', 't'] : to.y + t.height <= from.y ? ['t', 'b'] : null
  const picked = vertical ? v ?? h : h ?? v
  if (picked) return picked
  const dx = to.x + t.width / 2 - from.x - f.width / 2, dy = to.y + t.height / 2 - from.y - f.height / 2
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['r', 'l'] : ['l', 'r']
  return dy >= 0 ? ['b', 't'] : ['t', 'b']
}

/**
 * Round 11, square routing: parent lines leaving the same side of a parent turn at one shared distance from it, half
 * the gap to the nearest of those children (at least 12), so siblings hang off one straight trunk. Keyed by child id.
 */
export function trunks(nodes: BoardNode[], size: (id: string) => Size, vertical = false): Map<string, number> {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const lines: { id: string, key: string, gap: number }[] = []
  for (const n of nodes) {
    const p = n.parent === null ? undefined : byId.get(n.parent)
    if (!p) continue
    const [side] = facing(p, n, size, vertical), ps = size(p.id), ns = size(n.id)
    const gap = side === 'r' ? n.x - p.x - ps.width : side === 'l' ? p.x - n.x - ns.width : side === 'b' ? n.y - p.y - ps.height : p.y - n.y - ns.height
    lines.push({ id: n.id, key: `${p.id} ${side}`, gap })
  }
  const nearest = new Map<string, number>()
  for (const l of lines) nearest.set(l.key, Math.min(nearest.get(l.key) ?? Infinity, l.gap))
  return new Map(lines.map(l => [l.id, Math.max(12, nearest.get(l.key)! / 2)]))
}

/**
 * Arrow-key move from `id` over visible `nodes`: to the parent if it lies that way, else to the child
 * on that side nearest in line, else to the nearest sibling that way. Works for any layout direction
 * and for freeform placement, because it follows where nodes actually are.
 */
export function neighbor(nodes: BoardNode[], id: string, arrow: Side, size: (id: string) => Size, vertical = false): string | undefined {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const children = childrenMap(nodes)
  const n = byId.get(id)
  if (!n) return undefined
  const parent = n.parent === null ? undefined : byId.get(n.parent)
  if (parent && facing(n, parent, size, vertical)[0] === arrow) return parent.id

  const across = arrow === 't' || arrow === 'b' ? 'x' : 'y', along = across === 'x' ? 'y' : 'x'
  const sign = arrow === 't' || arrow === 'l' ? -1 : 1
  const mid = (m: BoardNode) => ({ x: m.x + size(m.id).width / 2, y: m.y + size(m.id).height / 2 })
  const c = mid(n)
  const nearest = (cands: BoardNode[], key: (m: BoardNode) => number) =>
    cands.reduce<BoardNode | undefined>((best, m) => !best || key(m) < key(best) ? m : best, undefined)?.id

  const kids = (children.get(id) ?? []).filter(k => facing(n, k, size, vertical)[0] === arrow)
  if (kids.length) return nearest(kids, k => Math.abs(mid(k)[across] - c[across]))

  const sibs = (children.get(n.parent) ?? []).filter(s => s.id !== id && (mid(s)[along] - c[along]) * sign > 0)
  return nearest(sibs, s => Math.abs(mid(s)[along] - c[along]) + Math.abs(mid(s)[across] - c[across]))
}
