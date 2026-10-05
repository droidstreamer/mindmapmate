// Every board edit. Each export returns a Command; BoardStore.dispatch makes it one undo step.
// Commands return the same board object when nothing changes, so no-op edits never mark the file dirty.

import type { Command } from './store.ts'
import type { Board, BoardNode, CrossLink, Status } from './schema.ts'
import { branchBox, DIRECTIONS, GAP_Y, rootSpot, tidyBranches, type Direction, type Size } from './layout/tidy.ts'
import { childrenMap, depths, topmost, withDescendants } from './tree.ts'
import { mapWikilinks } from './links.ts'
import { MATCH_OUTLINE } from './style.ts'

export type Point = { x: number, y: number }

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Random 8-character id (about 41 bits), valid as an Obsidian block id (D21). */
export function newId(taken: { has(id: string): boolean } = new Set()): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const id = Array.from(bytes, b => ALPHABET[b % 36]).join('')
    if (!taken.has(id)) return id
  }
}

/** Applies `edit` to the listed nodes; returns the same board if no node actually changed. */
function editNodes(board: Board, ids: Set<string>, edit: (n: BoardNode) => BoardNode): Board {
  let changed = false
  const nodes = board.nodes.map(n => {
    if (!ids.has(n.id)) return n
    const next = edit(n)
    const same = Object.keys(next).length === Object.keys(n).length && Object.keys(next).every(k => next[k] === n[k])
    if (same) return n
    changed = true
    return next
  })
  return changed ? { ...board, nodes } : board
}

const lastOrder = (board: Board, parent: string | null) =>
  Math.max(-1, ...board.nodes.filter(n => n.parent === parent).map(n => n.order))

export const moveNodes = (positions: Map<string, Point>): Command => board =>
  editNodes(board, new Set(positions.keys()), n => ({ ...n, ...positions.get(n.id)! }))

export const setText = (id: string, text: string): Command => board =>
  editNodes(board, new Set([id]), n => ({ ...n, text }))

/** Resize (Canvas: drag a node's edge). Resizing from the left also moves the node. */
export const setWidth = (id: string, width: number, position: Point): Command => board =>
  editNodes(board, new Set([id]), n => ({ ...n, ...position, width: Math.round(width) }))

/** Round 11, Arrange > Size: gives each listed node a fixed width, or undefined to fit its text again. */
export const setWidths = (widths: Map<string, number | undefined>): Command => board =>
  editNodes(board, new Set(widths.keys()), n => {
    const w = widths.get(n.id)
    return clearUndefined({ ...n, width: w === undefined ? undefined : Math.round(w) })
  })

/** Spike B: a temporary single link field (D19). Full note links arrive in M5. */
/** Round 7: labels are free text on the board, never tasks, dated or linked; these commands pass them by. */
const isLabel = (n: BoardNode) => n.shape === 'label'
/** Round 7 (D51): labels stand alone, never a parent or a child; a line dropped between one and a node makes a link. */
const labelParent = (board: Board, parent: string | null) => parent !== null && board.nodes.some(n => n.id === parent && isLabel(n))
const unlabelled = (board: Board, ids: Iterable<string>) => {
  const set = new Set(ids)
  return new Set(board.nodes.filter(n => set.has(n.id) && !isLabel(n)).map(n => n.id))
}

export const setLink = (id: string, link: string | undefined): Command => board =>
  editNodes(board, unlabelled(board, [id]), n => {
    const next = { ...n, link }
    if (!link) delete next.link
    return next
  })

/** F8: sets or clears (`undefined`) the status of the listed nodes, as one undo step. */
export const setStatus = (ids: Iterable<string>, status: Status | undefined): Command => board =>
  editNodes(board, unlabelled(board, ids), n => {
    const next = { ...n, status }
    if (!status) delete next.status
    return next
  })

/** M7: sets (or, with undefined, clears) the due date of the given nodes. */
export const setDue = (ids: Iterable<string>, due: string | undefined): Command => board =>
  editNodes(board, unlabelled(board, ids), n => {
    const next = { ...n, due }
    if (!due) delete next.due
    return next
  })

/**
 * Mod+L, like the editor's "Toggle checkbox status": a plain node becomes a task, todo becomes done
 * and done goes back to todo. A mixed selection all becomes done, unless none of it is a task yet.
 */
export const toggleDone = (ids: Iterable<string>): Command => board => {
  const set = new Set(ids)
  const picked = board.nodes.filter(n => set.has(n.id))
  const next = picked.every(n => n.status === 'done') || picked.every(n => !n.status) ? 'todo' : 'done'
  return setStatus(set, next)(board)
}

/** M6b, round 6 (N4): a node added from another (its child, or its sibling) takes that node's shape and the style of
 *  the line into it. The label is not copied: it names one line. */
export function inheritedStyle(from: BoardNode | undefined): Partial<BoardNode> {
  const keys = ['shape', 'edgeDash', 'edgeArrow', 'edgeDirection', 'edgeColor', 'edgeAnimate'] as const
  return from ? Object.fromEntries(keys.filter(k => from[k] !== undefined).map(k => [k, from[k]])) : {}
}

export function addNode(node: { id: string, parent: string | null, text?: string, status?: Status } & Partial<BoardNode> & Point): Command {
  return board => {
    if (labelParent(board, node.parent)) return board
    const order = lastOrder(board, node.parent) + 1
    return { ...board, nodes: [...board.nodes, { text: '', ...node, order }] }
  }
}

/** D5: deleting a node deletes its whole subtree, and any cross-link touching it. */
export const deleteSubtrees = (ids: Iterable<string>): Command => board => {
  const gone = withDescendants(board.nodes, ids)
  if (!gone.size) return board
  return {
    ...board,
    nodes: board.nodes.filter(n => !gone.has(n.id)),
    links: board.links.filter(l => !gone.has(l.from) && !gone.has(l.to)),
  }
}

/**
 * D5 (built round 14): deletes the nodes but keeps their children, which take the deleted node's place among its
 * parent's children (the nearest ancestor that stays; a deleted root's children become roots). They stay where they are
 * on the board. Cross-links touching the deleted nodes go.
 */
export const deleteKeepChildren = (ids: Iterable<string>): Command => board => {
  const gone = new Set(ids)
  const deleted = board.nodes.filter(n => gone.has(n.id))
  if (!deleted.length) return board
  const kids = childrenMap(board.nodes)
  const expand = (parent: string | null): readonly BoardNode[] => (kids.get(parent) ?? []).flatMap(n => gone.has(n.id) ? expand(n.id) : [n])
  const placed = new Map<string, { parent: string | null, order: number }>()
  for (const d of deleted) {
    if (d.parent !== null && gone.has(d.parent)) continue
    expand(d.parent).forEach((n, order) => placed.set(n.id, { parent: d.parent, order }))
  }
  return {
    ...board,
    nodes: board.nodes.filter(n => !gone.has(n.id)).map(n => {
      const p = placed.get(n.id)
      return p && (p.parent !== n.parent || p.order !== n.order) ? { ...n, ...p } : n
    }),
    links: board.links.filter(l => !gone.has(l.from) && !gone.has(l.to)),
  }
}

/** Round 14: a new node on a parent line takes the child's place under the parent, and the child goes under it. */
export const insertOnLine = (child: string, node: { id: string } & Point): Command => board => {
  const c = board.nodes.find(n => n.id === child)
  if (!c || c.parent === null) return board
  return {
    ...board,
    nodes: [...board.nodes.map(n => n.id === child ? { ...n, parent: node.id, order: 0 } : n),
      { text: '', ...inheritedStyle(c), ...node, parent: c.parent, order: c.order }],
  }
}

export const addLink = (from: string, to: string): Command => board => {
  if (from === to || board.links.some(l => l.from === from && l.to === to)) return board
  return { ...board, links: [...board.links, { id: newId(new Set(board.links.map(l => l.id))), from, to }] }
}

/**
 * D37 (amended M6b): a line dragged from `from` and dropped on `to` makes `to` a child of `from` (its old parent line
 * goes, and so does a link between them). With `asLink` (Alt), or when `to` is an ancestor of `from`, it makes a link.
 */
export const connectTo = (from: string, to: string, asLink: boolean): Command => board => {
  if (asLink) return addLink(from, to)(board)
  const moved = reparent(to, from)(board)
  if (moved !== board) return deleteLinks(board.links.filter(l => (l.from === from && l.to === to) || (l.from === to && l.to === from)).map(l => l.id))(moved)
  return board.nodes.find(n => n.id === to)?.parent === from ? board : addLink(from, to)(board)
}

/** Round 15 (D60): a line dropped on a selected group connects `from` to each of its top nodes, as `connectTo` does one. */
export const connectToGroup = (from: string, group: Iterable<string>, asLink: boolean): Command => board =>
  topmost(board.nodes, group).reduce((b, id) => id === from ? b : connectTo(from, id, asLink)(b), board)

/** Keys describing a parent line, stored on its child (D28); they go when the line stops being a parent line. */
const PARENT_LINE_KEYS = ['edgeDash', 'edgeArrow', 'edgeDirection', 'edgeColor', 'edgeLabel']
const withoutLineStyle = (n: BoardNode) => Object.fromEntries(Object.entries(n).filter(([k]) => !PARENT_LINE_KEYS.includes(k))) as BoardNode

/**
 * D37: each link becomes a parent line: its end node becomes a child of its start node (last among the siblings),
 * keeping the link's label. A link that would make a node its own ancestor stays a link.
 */
export const makeChild = (linkIds: Iterable<string>): Command => board => {
  let b = board
  for (const id of linkIds) {
    const l = b.links.find(l => l.id === id)
    if (!l) continue
    const moved = reparent(l.to, l.from)(b)
    if (moved === b) continue
    b = editNodes(deleteLinks([id])(moved), new Set([l.to]), n => ({ ...withoutLineStyle(n), ...l.label ? { edgeLabel: l.label } : {} }))
  }
  return b
}

/** D37: each child's parent line becomes a link from its old parent (id from `linkIds`, in order); the child becomes a
 *  root where it stands, keeping the line's label. */
export const makeLink = (childIds: string[], linkIds: string[]): Command => board => {
  let b = board
  childIds.forEach((id, i) => {
    const n = b.nodes.find(n => n.id === id)
    if (!n || n.parent === null) return
    const label = n.edgeLabel
    b = editNodes(reparent(id, null)(b), new Set([id]), withoutLineStyle)
    b = { ...b, links: [...b.links, { id: linkIds[i], from: n.parent, to: id, ...label ? { label } : {} }] }
  })
  return b
}

export const deleteLinks = (ids: Iterable<string>): Command => board => {
  const gone = new Set(ids)
  const links = board.links.filter(l => !gone.has(l.id))
  return links.length === board.links.length ? board : { ...board, links }
}

/**
 * Canvas Alt+drag: copies each subtree with new ids, shifted by its top node's drag offset.
 * Cross-links inside the copied set are copied too. Copies of a root stay roots; copies of a
 * child become its siblings, placed last.
 */
export const duplicate = (offsets: Map<string, Point>): Command => board => {
  const tops = topmost(board.nodes, offsets.keys())
  if (!tops.length) return board
  const taken = new Set(board.nodes.map(n => n.id))
  const newIds = new Map<string, string>()
  const copies: BoardNode[] = []
  const nextOrder = new Map<string | null, number>()
  for (const top of tops) {
    const d = offsets.get(top)!
    const ids = withDescendants(board.nodes, [top])
    for (const id of ids) {
      const nid = newId(taken)
      taken.add(nid)
      newIds.set(id, nid)
    }
    for (const n of board.nodes) {
      if (!ids.has(n.id)) continue
      const copy = { ...n, id: newIds.get(n.id)!, x: n.x + d.x, y: n.y + d.y }
      if (n.id === top) {
        const after = nextOrder.get(n.parent) ?? lastOrder(board, n.parent) + 1
        nextOrder.set(n.parent, after + 1)
        copy.order = after
      } else copy.parent = newIds.get(n.parent!)!
      copies.push(copy)
    }
  }
  const linkIds = new Set(board.links.map(l => l.id))
  const links: CrossLink[] = []
  for (const l of board.links) {
    if (!newIds.has(l.from) || !newIds.has(l.to)) continue
    const id = newId(linkIds)
    linkIds.add(id)
    links.push({ ...l, id, from: newIds.get(l.from)!, to: newIds.get(l.to)! })
  }
  return { ...board, nodes: [...board.nodes, ...copies], links: [...board.links, ...links] }
}

/** D19: a linked note (or a folder above it) was renamed or moved. Link fields hold paths and move here; wikilinks in
 *  node text go through `text`, which only the adapter can answer (Obsidian decides what a link path points at). */
export const retargetLinks = (oldPath: string, newPath: string, text?: (linkpath: string) => string | undefined): Command => board => {
  const moved = (p: string) => p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p
  const next = new Map<string, BoardNode>()
  for (const n of board.nodes) {
    const link = typeof n.link === 'string' ? moved(n.link) : n.link
    const t = text && n.text.includes('[[') ? mapWikilinks(n.text, text) : n.text
    if (link !== n.link || t !== n.text) next.set(n.id, { ...n, text: t, ...link !== undefined && { link } })
  }
  return next.size ? editNodes(board, new Set(next.keys()), n => next.get(n.id)!) : board
}

/** F2: each dragged branch moves by its top node's offset, hidden descendants included (D3). */
export const moveSubtrees = (offsets: Map<string, Point>): Command => board => {
  const positions = new Map<string, Point>()
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  for (const top of topmost(board.nodes, offsets.keys())) {
    const d = offsets.get(top)!
    for (const id of withDescendants(board.nodes, [top])) {
      const n = byId.get(id)!
      positions.set(id, { x: n.x + d.x, y: n.y + d.y })
    }
  }
  return moveNodes(positions)(board)
}

/** New parent for a node, placed last among its new siblings. A node can't move under its own branch (D1). */
export const reparent = (id: string, parent: string | null): Command => board => {
  const node = board.nodes.find(n => n.id === id)
  if (!node || node.parent === parent || (parent !== null && withDescendants(board.nodes, [id]).has(parent))) return board
  if (parent !== null && (isLabel(node) || labelParent(board, parent))) return board
  const order = lastOrder(board, parent) + 1
  return editNodes(board, new Set([id]), n => ({ ...n, parent, order }))
}

/** Collapse (F7) only applies to nodes with children; `false` clears the flag instead of storing it. */
export const setCollapsed = (ids: Iterable<string>, collapsed: boolean): Command => board => {
  const parents = new Set(board.nodes.map(n => n.parent))
  const set = new Set([...ids].filter(id => !collapsed || parents.has(id)))
  return editNodes(board, set, n => {
    const next: BoardNode = { ...n, collapsed }
    if (!collapsed) delete next.collapsed
    return next
  })
}

/** F7 "collapse all to level N": levels 1..N stay open, nodes on level N with children collapse. Deeper flags are kept. */
export const collapseToLevel = (level: number): Command => board => {
  const depth = depths(board.nodes)
  const open = board.nodes.filter(n => depth.get(n.id)! < level - 1).map(n => n.id)
  const shut = board.nodes.filter(n => depth.get(n.id) === level - 1).map(n => n.id)
  return setCollapsed(shut, true)(setCollapsed(open, false)(board))
}

export const expandAll: Command = board => setCollapsed(board.nodes.map(n => n.id), false)(board)

/**
 * Alt+Up/Down: swaps a node with its previous (-1) or next (+1) sibling in `order`, and swaps the two
 * branches' places along the stacking axis so the change is visible. Nothing else moves.
 */
export const swapSibling = (id: string, step: -1 | 1, size: (id: string) => Size): Command => board => {
  const node = board.nodes.find(n => n.id === id)
  if (!node) return board
  const sibs = childrenMap(board.nodes).get(node.parent) ?? []
  const i = sibs.findIndex(n => n.id === id)
  const other = sibs[i + step]
  if (!other) return board
  const [a, b] = step < 0 ? [other, node] : [node, other] // a comes first
  // Re-number all siblings so equal `order` values can't make the swap a no-op.
  const order = new Map(sibs.map((n, k) => [n.id, k]))
  order.set(a.id, order.get(b.id)!)
  order.set(b.id, order.get(a.id)! - 1)
  const reordered = editNodes(board, new Set(order.keys()), n => ({ ...n, order: order.get(n.id)! }))

  const down = board.theme.direction === 'down'
  const boxA = branchBox(board, a.id, size), boxB = branchBox(board, b.id, size)
  const [a0, a1, b0, b1] = down ? [boxA.x0, boxA.x1, boxB.x0, boxB.x1] : [boxA.y0, boxA.y1, boxB.y0, boxB.y1]
  const gap = Math.max(0, b0 - a1)
  const shift = (v: number): Point => down ? { x: v, y: 0 } : { x: 0, y: v }
  // b takes a's start; a follows b with the same gap.
  const offsets = new Map([[b.id, shift(a0 - b0)], [a.id, shift(a0 + (b1 - b0) + gap - a0)]])
  return moveSubtrees(offsets)(reordered)
}

/**
 * F15 paste: adds nodes and links that already have fresh ids (see `io/outline.ts`). Nodes whose parent
 * is not among them become children of `parent` (or roots), placed last, with their branch moved so
 * the first one's top-left lands on `at`.
 */
export const insertNodes = (nodes: BoardNode[], links: CrossLink[], parent: string | null, at: Point): Command => board => {
  if (!nodes.length) return board
  if (labelParent(board, parent)) parent = null
  const ids = new Set(nodes.map(n => n.id))
  const tops = nodes.filter(n => n.parent === null || !ids.has(n.parent))
  const dx = at.x - tops[0].x, dy = at.y - tops[0].y
  let order = lastOrder(board, parent)
  const added = nodes.map(n => ({ ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy), ...tops.includes(n) ? { parent, order: ++order } : {} }))
  return { ...board, nodes: [...board.nodes, ...added], links: [...board.links, ...links] }
}

export const setDirection = (direction: Direction): Command => board =>
  board.theme.direction === direction || !DIRECTIONS.includes(direction) ? board : { ...board, theme: { ...board.theme, direction } }

/** F6: re-lays out each listed branch, anchored on its top node. Round 8: with `grid` (snap on), every node lands on the
 *  grid: sizes are padded so each step between neighbours is whole grid squares, then positions round (column gaps are wider than a
 *  square, and a centred parent is at most half a square off, so nothing is pushed into a neighbour). */
export const tidyNodes = (ids: Iterable<string>, size: (id: string) => Size, grid?: number): Command => board => {
  if (!grid) return moveNodes(tidyBranches(board, ids, size))(board)
  const padded = (id: string) => { const s = size(id); return { width: Math.ceil(s.width / grid) * grid, height: Math.ceil((s.height + GAP_Y) / grid) * grid - GAP_Y } }
  const snap = (v: number) => Math.round(v / grid) * grid
  const at = [...tidyBranches(board, ids, padded)].map(([id, p]) => [id, { x: snap(p.x), y: snap(p.y) }] as const)
  return moveNodes(new Map(at))(board)
}

/**
 * Pasted outlines (F15): tidies each branch and puts it after the previous one (below, or beside for
 * "down"), starting where the first one is.
 * ponytail: O(branches x board size) from the per-branch box; batch the boxes if huge pastes get slow.
 */
export const tidyStacked = (tops: string[], size: (id: string) => Size): Command => board => {
  let b = tidyNodes(tops.slice(0, 1), size)(board)
  for (let i = 1; i < tops.length; i++) {
    const spot = rootSpot(b, tops[i - 1], size), n = b.nodes.find(n => n.id === tops[i])!
    b = tidyNodes([tops[i]], size)(moveSubtrees(new Map([[n.id, { x: spot.x - n.x, y: spot.y - n.y }]]))(b))
  }
  return b
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'across' | 'down'
/** Space left between nodes that `distribute` would otherwise overlap. */
const MIN_GAP = 20

/**
 * M6b: lines up the listed nodes (only them, not their branches) on the selection's left, centre or right edge (top,
 * middle, bottom), or spaces them evenly across or down: the outer two stay, the rest get equal gaps (at least MIN_GAP).
 */
export const alignNodes = (ids: Iterable<string>, how: Align, size: (id: string) => Size): Command => board => {
  const set = new Set(ids)
  const boxes = board.nodes.filter(n => set.has(n.id)).map(n => ({ n, ...size(n.id) }))
  if (boxes.length < 2) return board
  const across = how === 'left' || how === 'center' || how === 'right' || how === 'across'
  // Along the axis that moves: start, length.
  const start = (b: typeof boxes[number]) => across ? b.n.x : b.n.y, len = (b: typeof boxes[number]) => across ? b.width : b.height
  const lo = Math.min(...boxes.map(start)), hi = Math.max(...boxes.map(b => start(b) + len(b)))
  const at = new Map<string, number>()
  if (how === 'across' || how === 'down') {
    const sorted = [...boxes].sort((a, b) => start(a) - start(b))
    const gap = Math.max(MIN_GAP, (hi - lo - sorted.reduce((t, b) => t + len(b), 0)) / (sorted.length - 1))
    let p = lo
    for (const b of sorted) { at.set(b.n.id, p); p += len(b) + gap }
  } else for (const b of boxes) {
    const edge = how === 'left' || how === 'top' ? 0 : how === 'right' || how === 'bottom' ? 1 : 0.5
    at.set(b.n.id, lo + (hi - lo - len(b)) * edge)
  }
  const pos = new Map(boxes.map(b => { const v = Math.round(at.get(b.n.id)!); return [b.n.id, across ? { x: v, y: b.n.y } : { x: b.n.x, y: v }] }))
  return moveNodes(pos)(board)
}

/** Round 17: Tidy children on several selected top-level nodes lines those nodes up: left edges aligned, equal gaps down. Their branches stay put. */
export const stackRoots = (ids: Iterable<string>, size: (id: string) => Size): Command => board => {
  const list = [...ids]
  return alignNodes(list, 'down', size)(alignNodes(list, 'left', size)(board))
}

// F5 sort: open work first.
const STATUS_RANK: Record<Status | 'none', number> = { doing: 0, todo: 1, blocked: 2, none: 3, done: 4, dropped: 5 }
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** F5: rewrites sibling order under each listed parent, by name or by status. */
export const sortChildren = (parentIds: Iterable<string>, by: 'name' | 'status'): Command => board => {
  const children = childrenMap(board.nodes)
  const order = new Map<string, number>()
  for (const p of parentIds) {
    const sorted = [...children.get(p) ?? []].sort((x, y) => by === 'name'
      ? collator.compare(x.text, y.text)
      : STATUS_RANK[x.status ?? 'none'] - STATUS_RANK[y.status ?? 'none']) // stable: ties keep manual order
    sorted.forEach((n, k) => order.set(n.id, k))
  }
  return editNodes(board, new Set(order.keys()), n => ({ ...n, order: order.get(n.id)! }))
}

export const NODE_STYLE_KEYS = ['shape', 'stroke', 'fill', 'textSize'] as const
export const EDGE_STYLE_KEYS = ['edgeDash', 'edgeArrow', 'edgeDirection', 'edgeColor', 'edgeLabel', 'edgeAnimate'] as const
export const LINK_STYLE_KEYS = ['dash', 'arrow', 'direction', 'color', 'label', 'animate'] as const
export type NodeStyleKey = typeof NODE_STYLE_KEYS[number] | typeof EDGE_STYLE_KEYS[number]
export type LinkStyleKey = typeof LINK_STYLE_KEYS[number]

/** D28: sets style overrides on the listed nodes (their line from the parent: the edge* keys); `undefined` clears one. */
export const setStyle = (ids: Iterable<string>, patch: Partial<Record<NodeStyleKey, unknown>>): Command => board => {
  // Round 12: a fill change while the Board style fill toggle is on keeps what's on screen: every node stores its
  // outline as its fill and the toggle goes off, so turning it on and off again comes back to this state.
  if ('fill' in patch && board.theme.fillOutline) {
    board = setTheme({ fillOutline: undefined })(board)
    board = editNodes(board, new Set(board.nodes.filter(n => !isLabel(n)).map(n => n.id)), n => ({ ...n, fill: MATCH_OUTLINE }))
  }
  return editNodes(board, new Set(ids), n => {
    // Round 7: a shape change never turns a node into a label or a label into a node (reset keeps a label a label).
    const keep = 'shape' in patch && isLabel(n) !== (patch.shape === 'label')
    return clearUndefined({ ...n, ...patch, ...keep && { shape: n.shape } }) as BoardNode
  })
}

/** D28: the same for cross-links. */
export const setLinkStyle = (ids: Iterable<string>, patch: Partial<Record<LinkStyleKey, unknown>>): Command => board => {
  const set = new Set(ids)
  let changed = false
  const links = board.links.map(l => {
    if (!set.has(l.id)) return l
    const next = clearUndefined({ ...l, ...patch }) as CrossLink
    if (JSON.stringify(next) === JSON.stringify(l)) return l
    changed = true
    return next
  })
  return changed ? { ...board, links } : board
}

/** Sets board style values (D28); `undefined` clears one back to the default. Nodes are untouched. */
export const setTheme = (patch: Record<string, unknown>): Command => board => {
  const theme = clearUndefined({ ...board.theme, ...patch })
  return JSON.stringify(theme) === JSON.stringify(board.theme) ? board : { ...board, theme }
}

function clearUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}
