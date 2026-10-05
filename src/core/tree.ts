import type { BoardNode } from './schema.ts'

// M6: boards never change in place, so a nodes array always has the same children and counts. Each is worked out
// once per array and shared by every caller (a single edit used to rebuild and re-sort the children map about ten
// times). Callers get read-only views and never mutate them.
const childrenCache = new WeakMap<readonly BoardNode[], ReadonlyMap<string | null, readonly BoardNode[]>>()
const countsCache = new WeakMap<readonly BoardNode[], ReadonlyMap<string, Counts>>()

/** Children of each node id (null = roots), sorted by `order` then id so output is deterministic. */
export function childrenMap(nodes: readonly BoardNode[]): ReadonlyMap<string | null, readonly BoardNode[]> {
  const cached = childrenCache.get(nodes)
  if (cached) return cached
  const map = new Map<string | null, BoardNode[]>()
  for (const n of nodes) {
    const list = map.get(n.parent)
    if (list) list.push(n)
    else map.set(n.parent, [n])
  }
  for (const list of map.values())
    list.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  childrenCache.set(nodes, map)
  return map
}

/** The given ids plus every descendant of them. */
export function withDescendants(nodes: BoardNode[], ids: Iterable<string>): Set<string> {
  const children = childrenMap(nodes)
  const out = new Set<string>()
  const stack = [...ids]
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    for (const c of children.get(id) ?? []) stack.push(c.id)
  }
  return out
}

/** Drops ids whose ancestor is also in the set, so each subtree is handled once. */
export function topmost(nodes: BoardNode[], ids: Iterable<string>): string[] {
  const set = new Set(ids)
  const parentOf = new Map(nodes.map(n => [n.id, n.parent]))
  return [...set].filter(id => {
    for (let p = parentOf.get(id) ?? null; p !== null; p = parentOf.get(p) ?? null) if (set.has(p)) return false
    return true
  })
}

/** Ancestors of `id`, nearest first. */
export function ancestors(nodes: BoardNode[], id: string): string[] {
  const parentOf = new Map(nodes.map(n => [n.id, n.parent]))
  const out: string[] = []
  for (let p = parentOf.get(id) ?? null; p !== null; p = parentOf.get(p) ?? null) out.push(p)
  return out
}

/** Depth of every node; roots are 0. */
export function depths(nodes: BoardNode[]): Map<string, number> {
  const children = childrenMap(nodes)
  const out = new Map<string, number>()
  const stack = (children.get(null) ?? []).map(n => n.id)
  for (const id of stack) out.set(id, 0)
  while (stack.length) {
    const id = stack.pop()!
    for (const c of children.get(id) ?? []) { out.set(c.id, out.get(id)! + 1); stack.push(c.id) }
  }
  return out
}

/** Round 17: how many levels are showing: 1 + the deepest visible node (an empty board is 1). */
export function shownLevel(nodes: BoardNode[]): number {
  const depth = depths(nodes), hidden = hiddenIds(nodes)
  return 1 + Math.max(0, ...nodes.filter(n => !hidden.has(n.id)).map(n => depth.get(n.id) ?? 0))
}

/** Nodes inside a collapsed ancestor (F7). They keep their positions (D3) but are not drawn. */
export function hiddenIds(nodes: BoardNode[]): Set<string> {
  const children = childrenMap(nodes)
  const stack = nodes.filter(n => n.collapsed).flatMap(n => children.get(n.id) ?? []).map(n => n.id)
  const out = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    for (const c of children.get(id) ?? []) stack.push(c.id)
  }
  return out
}

/** `tasks` and `done` are the progress count (F8; round 22: direct children only, not the whole branch): children with a status, dropped excluded. */
export type Counts = { children: number, descendants: number, done: number, tasks: number }

/** Child, descendant, done and task counts of every node's branch, in one pass (F7 badge, F8 rollup). */
export function subtreeCounts(nodes: readonly BoardNode[]): ReadonlyMap<string, Counts> {
  const cached = countsCache.get(nodes)
  if (cached) return cached
  const byId = new Map(nodes.map(n => [n.id, n]))
  const out = new Map(nodes.map(n => [n.id, { children: 0, descendants: 0, done: 0, tasks: 0 }]))
  // Parents before children, then fold each node into its parent in reverse.
  const children = childrenMap(nodes)
  const order: string[] = []
  for (const stack = (children.get(null) ?? []).map(n => n.id); stack.length;) {
    const id = stack.pop()!
    order.push(id)
    for (const c of children.get(id) ?? []) stack.push(c.id)
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = byId.get(order[i])!
    if (n.parent === null) continue
    const c = out.get(n.id)!, p = out.get(n.parent)!
    p.children++
    p.descendants += 1 + c.descendants
    p.done += n.status === 'done' ? 1 : 0
    p.tasks += n.status && n.status !== 'dropped' ? 1 : 0
  }
  countsCache.set(nodes, out)
  return out
}
