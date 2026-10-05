// Tidy layout in four directions (F5, F6). Each subtree gets its own band across the growth axis,
// stacked in sibling order, and children sit in a column (or row, for "down") beside their parent.
// Bands never overlap, so nodes never overlap and parent-child edges never cross. Less compact than
// Reingold-Tilford (d3-flextree), but O(n) with no dependency.
// ponytail: band stacking wastes space beside tall subtrees; swap in d3-flextree if boards look too sparse.

import type { Board, BoardNode } from '../schema.ts'
import { childrenMap, topmost } from '../tree.ts'
import type { Point } from '../commands.ts'

export type Size = { width: number, height: number }
export type Direction = 'right' | 'left' | 'both' | 'down'
export const DIRECTIONS: Direction[] = ['right', 'left', 'both', 'down']

export const GAP_X = 60
export const GAP_Y = 12
// "down": levels further apart, siblings side by side.
const GAP_DOWN = 40, GAP_SIDE = 20

export function boardDirection(board: Board): Direction {
  const d = board.theme.direction
  return DIRECTIONS.includes(d as Direction) ? d as Direction : 'right'
}

/**
 * New top-left positions for `rootId` and its visible descendants. The root does not move (F6 anchor).
 * Collapsed nodes are laid out as leaves; `tidyBranches` moves what they hide.
 */
export function tidy(
  nodes: BoardNode[], rootId: string, size: (id: string) => Size, direction: Direction = 'right',
  // Shared across calls by tidyBranches, so a board with many roots is still O(n).
  children = childrenMap(nodes), byId = new Map(nodes.map(n => [n.id, n])),
): Map<string, Point> {
  const kids = (id: string) => byId.get(id)!.collapsed ? [] : children.get(id) ?? []
  const down = direction === 'down'
  const gapMain = down ? GAP_DOWN : GAP_X, gapCross = down ? GAP_SIDE : GAP_Y
  // Main axis: parent to child. Cross axis: sibling to sibling.
  const main = (id: string) => down ? size(id).height : size(id).width
  const cross = (id: string) => down ? size(id).width : size(id).height

  // Parents-before-children order without recursion, so very deep chains can't overflow the stack.
  const order: string[] = []
  for (const stack = [rootId]; stack.length;) {
    const id = stack.pop()!
    order.push(id)
    for (const c of kids(id)) stack.push(c.id)
  }
  const band = new Map<string, number>()
  const stacked = (cs: readonly BoardNode[]) => cs.reduce((sum, c) => sum + band.get(c.id)!, 0) + gapCross * Math.max(0, cs.length - 1)
  for (let i = order.length - 1; i >= 0; i--) band.set(order[i], Math.max(cross(order[i]), stacked(kids(order[i]))))

  // In "both", the root's first half of children grow right and the rest grow left.
  const side = new Map<string, 1 | -1>([[rootId, direction === 'left' ? -1 : 1]])
  const root = byId.get(rootId)!
  const pos = new Map<string, { m: number, c: number }>([[rootId, down ? { m: root.y, c: root.x } : { m: root.x, c: root.y }]])
  for (const id of order) {
    const p = pos.get(id)!
    const cs = kids(id)
    const groups: [readonly BoardNode[], 1 | -1][] = id === rootId && direction === 'both'
      ? [[cs.slice(0, Math.ceil(cs.length / 2)), 1], [cs.slice(Math.ceil(cs.length / 2)), -1]]
      : [[cs, side.get(id)!]]
    for (const [group, s] of groups) {
      let c = p.c + cross(id) / 2 - stacked(group) / 2
      for (const k of group) {
        const b = band.get(k.id)!
        side.set(k.id, s)
        pos.set(k.id, { m: s > 0 ? p.m + main(id) + gapMain : p.m - gapMain - main(k.id), c: c + b / 2 - cross(k.id) / 2 })
        c += b + gapCross
      }
    }
  }
  return new Map([...pos].map(([id, { m, c }]) => [id, down ? { x: c, y: m } : { x: m, y: c }]))
}

/** Tidies each listed branch (anchored on its top node) in the board's direction, rounded to whole pixels. */
export function tidyBranches(board: Board, ids: Iterable<string>, size: (id: string) => Size): Map<string, Point> {
  const direction = boardDirection(board)
  const children = childrenMap(board.nodes)
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const out = new Map<string, Point>()
  const trees: { ids: string[], box: Box }[] = []
  for (const top of topmost(board.nodes, ids)) {
    const laid = tidy(board.nodes, top, size, direction, children, byId)
    for (const [id, p] of laid) out.set(id, { x: Math.round(p.x), y: Math.round(p.y) })
    const n = byId.get(top)!
    if (n.parent === null && n.shape !== 'label') trees.push({ ids: [...laid.keys()], box: boxOf([...laid.keys()], out, size) })
  }
  separate(trees, out, direction === 'down')
  // D3: nodes hidden by a collapsed node keep their offset from it.
  for (const [id, p] of [...out]) {
    const n = byId.get(id)!
    if (!n.collapsed) continue
    const dx = p.x - n.x, dy = p.y - n.y
    for (const stack = (children.get(id) ?? []).map(c => c.id); stack.length;) {
      const h = byId.get(stack.pop()!)!
      out.set(h.id, { x: h.x + dx, y: h.y + dy })
      for (const c of children.get(h.id) ?? []) stack.push(c.id)
    }
  }
  return out
}

export type Box = { x0: number, y0: number, x1: number, y1: number }

const boxOf = (ids: string[], at: Map<string, Point>, size: (id: string) => Size): Box => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const id of ids) {
    const p = at.get(id)!, s = size(id)
    b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x + s.width); b.y1 = Math.max(b.y1, p.y + s.height)
  }
  return b
}

/**
 * Round 6: several roots on a board are normal. Root trees tidied together are kept apart: taken top to bottom (left to
 * right for "down"), each moves down (right) past any tree already placed that it would overlap. Trees that don't
 * overlap stay where they are. Labels are free annotations, so the caller leaves them out.
 * ponytail: O(trees²); fine for the handful of roots a board has.
 */
function separate(trees: { ids: string[], box: Box }[], out: Map<string, Point>, down: boolean) {
  if (trees.length < 2) return
  trees.sort((a, b) => down ? a.box.x0 - b.box.x0 : a.box.y0 - b.box.y0)
  const placed: Box[] = []
  for (const t of trees) {
    let shift = 0
    const moved = () => down ? { ...t.box, x0: t.box.x0 + shift, x1: t.box.x1 + shift } : { ...t.box, y0: t.box.y0 + shift, y1: t.box.y1 + shift }
    for (let again = true; again;) {
      again = false
      for (const p of placed) {
        const b = moved()
        if (b.x0 < p.x1 + GAP_DOWN && p.x0 < b.x1 + GAP_DOWN && b.y0 < p.y1 + GAP_DOWN && p.y0 < b.y1 + GAP_DOWN) {
          shift += down ? p.x1 + GAP_DOWN - b.x0 : p.y1 + GAP_DOWN - b.y0
          again = true
        }
      }
    }
    if (shift) for (const id of t.ids) { const q = out.get(id)!; out.set(id, down ? { x: q.x + shift, y: q.y } : { x: q.x, y: q.y + shift }) }
    placed.push(moved())
  }
}

/** Bounding box of a node and its visible descendants. */
export function branchBox(board: Board, id: string, size: (id: string) => Size): Box {
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const children = childrenMap(board.nodes)
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const stack = [id]; stack.length;) {
    const n = byId.get(stack.pop()!)!
    const s = size(n.id)
    box.x0 = Math.min(box.x0, n.x); box.y0 = Math.min(box.y0, n.y)
    box.x1 = Math.max(box.x1, n.x + s.width); box.y1 = Math.max(box.y1, n.y + s.height)
    if (!n.collapsed) for (const c of children.get(n.id) ?? []) stack.push(c.id)
  }
  return box
}

/**
 * D4: where a new child of `parentId` goes. After the last child's branch if there is one, otherwise
 * beside the parent on the side the board grows (in "both", the side the parent already faces).
 * Nothing else moves.
 * ponytail: a new child growing left can widen into its parent while typed; Shift+L tidies it.
 */
export function childSpot(board: Board, parentId: string, size: (id: string) => Size): Point {
  const direction = boardDirection(board)
  const parent = board.nodes.find(n => n.id === parentId)!
  const last = (childrenMap(board.nodes).get(parentId) ?? []).at(-1)
  if (last) {
    const box = branchBox(board, last.id, size)
    return direction === 'down' ? { x: box.x1 + GAP_SIDE, y: last.y } : { x: last.x, y: box.y1 + GAP_Y }
  }
  const s = size(parentId)
  if (direction === 'down') return { x: parent.x, y: parent.y + s.height + GAP_DOWN }
  const grand = parent.parent === null ? undefined : board.nodes.find(n => n.id === parent.parent)
  const left = direction === 'left' || (direction === 'both' && grand !== undefined && grand.x > parent.x)
  return { x: left ? parent.x - GAP_X - 80 : parent.x + s.width + GAP_X, y: parent.y }
}

/** Where a new root goes: below (or, for "down", beside) the branch of `rootId`. */
export function rootSpot(board: Board, rootId: string, size: (id: string) => Size): Point {
  const box = branchBox(board, rootId, size)
  const root = board.nodes.find(n => n.id === rootId)!
  return boardDirection(board) === 'down' ? { x: box.x1 + GAP_DOWN, y: root.y } : { x: root.x, y: box.y1 + GAP_DOWN }
}
