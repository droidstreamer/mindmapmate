// D10: the renderer only gets the nodes near the view, computed here rather than in React.
// Callers pass the visible board (hidden nodes of collapsed branches already removed, see `visibleBoard`).

import type { Board } from './schema.ts'
import { hiddenIds, withDescendants } from './tree.ts'

export type Rect = { x0: number, y0: number, x1: number, y1: number }

// Generous node box for the in-window test; exact sizes don't matter because the window has a margin.
const MAX_W = 400, MAX_H = 200

/** Ids of nodes inside `rect`, plus the other end of every parent line or cross-link that touches one,
 *  so lines running into the window are still drawn. */
export function nodesNear(board: Pick<Board, 'nodes' | 'links'>, rect: Rect): Set<string> {
  const inside = new Set<string>()
  for (const n of board.nodes)
    if (n.x < rect.x1 && n.x + MAX_W > rect.x0 && n.y < rect.y1 && n.y + MAX_H > rect.y0) inside.add(n.id)
  const keep = new Set(inside)
  for (const n of board.nodes) {
    if (n.parent === null) continue
    if (inside.has(n.id)) keep.add(n.parent)
    else if (inside.has(n.parent)) keep.add(n.id)
  }
  for (const l of board.links) {
    if (inside.has(l.from)) keep.add(l.to)
    if (inside.has(l.to)) keep.add(l.from)
  }
  return keep
}

/** The nodes and cross-links that are drawn: everything not inside a collapsed branch (F7), and with
 *  `hideDone`, no done or dropped node or anything below it (F8 hide-done toggle). */
export function visibleBoard(board: Board, hideDone = false): Pick<Board, 'nodes' | 'links'> {
  const hidden = hiddenIds(board.nodes)
  if (hideDone) for (const id of withDescendants(board.nodes, board.nodes.filter(n => n.status === 'done' || n.status === 'dropped').map(n => n.id))) hidden.add(id)
  if (!hidden.size) return board
  // ponytail: a cross-link into a collapsed branch is hidden, not redrawn to the collapsed node.
  return {
    nodes: board.nodes.filter(n => !hidden.has(n.id)),
    links: board.links.filter(l => !hidden.has(l.from) && !hidden.has(l.to)),
  }
}
