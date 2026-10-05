// Seeded random boards for tests and fixture files. Same seed, same board.
import type { Board, BoardNode } from '../src/core/schema.ts'

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Awkward on purpose: fences, comment markers, checkbox and block-id look-alikes, quotes, unicode.
const WORDS = ['task', 'Combat System', '```js', '%% hidden', '[ ] not a task', '[x] nor this', 'see [[Loot Tables]]',
  'a ^block', '"quoted"', 'back\\slash', 'emoji 🚀', 'naïve café', 'line\nbreak', '# heading', '100% done', '`code`']
const STATUSES = [undefined, 'todo', 'doing', 'blocked', 'done', 'dropped'] as const

export function generateBoard(seed: number, count = 1 + Math.floor(rng(seed)() * 300), maxDepth = 10): Board {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const nodes: BoardNode[] = []
  const depth = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const candidates = nodes.filter(n => depth.get(n.id)! < maxDepth - 1)
    const parent = i === 0 || r() < 0.03 || !candidates.length ? null : pick(candidates).id
    const id = `n${i.toString(36)}`
    depth.set(id, parent ? depth.get(parent)! + 1 : 0)
    const node: BoardNode = {
      id, parent, order: Math.floor(r() * 5),
      text: Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(WORDS)).join(' '),
      x: Math.round((r() - 0.5) * 20000) / 4 || 0, y: Math.round((r() - 0.5) * 20000) / 4 || 0, // JSON has no -0
    }
    const status = pick(STATUSES)
    if (status) node.status = status
    if (r() < 0.1) node.collapsed = true
    if (r() < 0.05) node.futureField = { z: 1, a: [2, 'x'] } // unknown keys must survive (D8)
    nodes.push(node)
  }
  const links = nodes.length > 1 && r() < 0.5
    ? [{ id: 'l1', from: nodes[0].id, to: nodes[nodes.length - 1].id, label: pick(WORDS) }]
    : []
  return { schema: 1, theme: { palette: 'okabe-ito', edgeType: 'curve' }, nodes, links }
}
