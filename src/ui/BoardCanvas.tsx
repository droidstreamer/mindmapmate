import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  applyNodeChanges, Background, BaseEdge, ConnectionMode, Handle, NodeResizeControl, Panel, Position, ReactFlow, ReactFlowProvider,
  ResizeControlVariant, SelectionMode, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals, ViewportPortal,
  type Edge, type EdgeChange, type EdgeProps, type Node, type NodeChange, type NodeProps, type OnConnectEnd, type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  addNode, alignNodes, stackRoots, inheritedStyle, collapseToLevel, connectTo, connectToGroup, deleteKeepChildren, deleteLinks, expandAll, deleteSubtrees, duplicate, insertNodes, insertOnLine, makeChild, makeLink, moveNodes, moveSubtrees, newId, reparent, setCollapsed, setText,
  setStatus, setWidth, setWidths, swapSibling, tidyNodes, tidyStacked, toggleDone, type Point,
} from '../core/commands.ts'
import { ARROW_PATHS, arrowScale, arrowTransform, dashArray, DIAMOND_FIT, HEAD_LENGTH, linePath, nodePath, overhang, snapEdge, type LineEnd, type Routing } from '../core/geometry.ts'
import { copyClip, parseOutline, readClip, toMarkdown } from '../core/io/outline.ts'
import { boardDirection, childSpot, rootSpot, type Size } from '../core/layout/tidy.ts'
import { dayOf, dueState, filterMatches, isDue, shortDay, type DueFilter } from '../core/due.ts'
import { displayText, hasTag, textParts } from '../core/links.ts'
import { facing, neighbor, trunks, type Side } from '../core/navigate.ts'
import type { Board, BoardNode, Status } from '../core/schema.ts'
import type { BoardStore, Command } from '../core/store.ts'
import type { Shape } from '../core/geometry.ts'
import { boardStyle, cssFont, cssTextColor, resolveStyles, type LineLook, type NodeLook } from '../core/style.ts'
import { BoardStyleBar, CanvasControls, ConnectorPalette, lineBarPlacement, NodePalette, nodeBarPlacement, styleLines, type Arrange, type ExportKind, type LineRef, type NoteAction, type ViewTools } from './StyleBars.tsx'
import { Minimap } from './Minimap.tsx'
import { boardSvg } from './exportImage.ts'
import type { HtmlColors } from './exportHtml.ts'
import { ancestors, childrenMap, depths, shownLevel, subtreeCounts, topmost, withDescendants, type Counts } from '../core/tree.ts'
import { nodesNear, visibleBoard, type Rect } from '../core/visibility.ts'
import { actionFor, keyLabel, type Action, type Keymap } from './input/keymap.ts'
import { approxHeight, approxWidth, drawOverview, HEIGHT, OVERVIEW_ABOVE, OVERVIEW_BELOW, OVERVIEW_ZOOM, visibleCount } from './overview.ts'

const GRID = 20
/** Pointer movement (screen px) that still counts as a click on a node; any more starts a drag. */
const CLICK_SLOP = 4
/** More lines than this on screen, and a pan or zoom draws them as hairlines until it ends. */
const BUSY_LINES = 300
/** Narrowest a node can be resized to. */
const MIN_NODE_W = 60

/** `kids`, `hidden` and `done` feed the collapse button and badge (F7), `done` and `tasks` the progress
 *  rollup (F8); `side` is where the children are. */
type TaskData = { node: BoardNode, editing: boolean, kids: number, hidden: number, done: number, tasks: number, side: Side, look: NodeLook }
type Extra = Omit<TaskData, 'node' | 'editing'>
type TaskFlowNode = Node<TaskData, 'task'>

export type PanZoomResult = { fps: number, p95FrameMs: number, mountedNodes: number }

const NONE: never[] = []

/** What the Obsidian view and its commands can ask of a mounted canvas. */
export interface CanvasApi {
  selectedIds: () => string[]
  /** Selects one node and pans it into view. */
  select: (id: string) => void
  /** D21: selects one node and centres it at 100% zoom or closer. */
  focus: (id: string) => void
  run: (action: Action) => void
  /** M4b: shows or hides the Board style toolbar. */
  toggleBoardStyle: () => void
  /** F9: focus on the selected branch (dimming the rest and fitting it), or leave focus mode. */
  toggleFocusMode: () => void
  /** Round 6 (N3): adds a label and starts typing it. */
  addLabel: () => void
  /** M7: selects these nodes (those drawn) and fits them in the view. */
  selectAndFit: (ids: string[]) => void
  /** F16: the board as drawn (collapsed and hidden branches left out) as an SVG image. */
  /** `interactive`: every node (collapsed ones too) with the markup the HTML page's script needs. */
  exportSvg: (interactive?: boolean) => { svg: string, width: number, height: number, background: string, colors: HtmlColors }
  /** F6: tidies the given branches (all roots when null), after `before` in the same undo step. */
  tidy: (ids: string[] | null, before?: Command) => void
  /** Round 8: re-tidies the trees of these nodes when "Tidy as you add" is on (round 13: after a checkbox comes or goes). */
  autoTidy: (...ids: string[]) => void
  /** Spike A: pan and zoom at the fitted view, then at 100% zoom around the first node. */
  measurePanZoom: () => Promise<{ fitted: PanZoomResult, zoomedIn: PanZoomResult }>
}

export interface BoardCanvasProps {
  store: BoardStore
  keymap: Keymap
  snap: boolean
  /** D29: the mouse wheel zooms (true, like Canvas) or pans (for trackpads). A plugin setting. */
  wheelZoom: boolean
  /** F8: done and dropped branches are not drawn. A view setting, never saved in the file. */
  hideDone: boolean
  onHideDoneChange: (hide: boolean) => void
  /** F16: the minimap shows (a plugin setting). */
  minimap: boolean
  onMinimapChange: (show: boolean) => void
  onSnapChange: (snap: boolean) => void
  links: BoardLinks
  /** D38: copy takes whole branches instead of just the selected nodes. A plugin setting. */
  copyBranch: boolean
  /** D41: fonts used on boards (a plugin setting), and a font just used. */
  recentFonts: string[]
  onFontUsed: (font: string) => void
  /** M5b: Link to a note or Promote to a note, from the node palette's Link menu. */
  onNoteAction: (action: NoteAction, id: string) => void
  onFirstPaint: () => void
  /** Round 8: the Export menu in the canvas controls runs the plugin's export commands. */
  onExport: (kind: ExportKind) => void
  /** Round 11: shortcut hints for the current selection along the bottom while the board has focus (a plugin setting). */
  hints: boolean
  /** Round 11: the snap grid's dots show (a plugin setting), in this "#rrggbb" color or React Flow's grey when empty. */
  gridDots: boolean
  gridColor: string
  api: { current: CanvasApi | null }
}

/** F10: note links, answered by Obsidian. A link text is a wikilink target ("Note#Heading") or a link field's path. */
export interface BoardLinks {
  resolved: (linktext: string) => boolean
  open: (linktext: string, newTab: boolean) => void
  /** Search the vault for a #tag (without the "#"). */
  searchTag: (tag: string) => void
  /** Page preview on hover. */
  hover: (event: MouseEvent, targetEl: HTMLElement, linktext: string) => void
  /** M6b: notes matching what follows `[[` in a node, best first (up to 8), as link text and path. */
  suggest: (query: string) => { linktext: string, path: string }[]
}

interface NodeActions {
  /** `then: 'addChild'` is Tab in the editor: finish this node and start typing its first child. */
  commitText: (id: string, text: string, then?: 'addChild') => void
  toggleCollapse: (id: string) => void
  toggleDone: (id: string) => void
  resize: (id: string, width: number, position: Point, side: 'left' | 'right') => void
  links: BoardLinks
}
const Actions = createContext<NodeActions>(null!)

export function BoardCanvas(props: BoardCanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}

/** Reuses the previous React Flow node wherever the board node is unchanged, which keeps its
 *  measured size and selection, and lets memoized node components skip rendering. */
function syncNodes(nodes: BoardNode[], prev: TaskFlowNode[], editing: string | null, extra: Map<string, Extra>, focus: Set<string> | null, lit: Set<string> | null): TaskFlowNode[] {
  const byId = new Map(prev.map(n => [n.id, n]))
  return nodes.map(b => {
    const p = byId.get(b.id)
    const isEditing = b.id === editing
    const x = extra.get(b.id)!
    // F9 focus mode: everything outside the focused branch is dimmed. R24: so is every node the due filter doesn't match.
    const className = (focus && !focus.has(b.id)) || (lit && !lit.has(b.id)) ? 'is-dim' : undefined
    if (p && p.data.node === b && p.data.editing === isEditing && p.position.x === b.x && p.position.y === b.y && p.className === className
      && p.width === b.width && p.height === undefined && p.data.kids === x.kids && p.data.hidden === x.hidden
      && p.data.done === x.done && p.data.tasks === x.tasks && p.data.side === x.side && sameLook(p.data.look, x.look)) return p
    return { ...p, id: b.id, type: 'task', position: { x: b.x, y: b.y }, data: { node: b, editing: isEditing, ...x }, width: b.width, height: undefined, className }
  })
}

function Canvas({ store, keymap, snap, wheelZoom, hideDone, onHideDoneChange, minimap, onMinimapChange, onSnapChange, links, copyBranch, recentFonts, onFontUsed, onNoteAction, onFirstPaint, onExport, hints, gridDots, gridColor, api }: BoardCanvasProps) {
  const rf = useReactFlow<TaskFlowNode>()
  const rfStore = useStoreApi()
  const board = useSyncExternalStore(store.subscribe, store.getBoard)
  const [editing, setEditing] = useState<string | null>(null)
  const visible = useMemo(() => visibleBoard(board, hideDone), [board, hideDone])
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const vertical = boardDirection(board) === 'down'
  const styles = useMemo(() => resolveStyles(board), [board])
  const strokes = useMemo(() => new Map([...styles.nodes].map(([id, l]) => [id, l.stroke])), [styles])
  const levels = useMemo(() => 1 + Math.max(0, ...depths(board.nodes).values()), [board])
  // M4b toolbars: the open flyout (one at a time), whether Board style is open, a line label being edited, a drag in progress.
  const [flyout, setFlyout] = useState<string | null>(null)
  const [boardBar, setBoardBar] = useState(false)
  const [labelEdit, setLabelEdit] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // Line midpoints in board coordinates, written by TaskEdge as it draws; the connector palette and label editor sit there.
  const mids = useRef(new Map<string, Point>())
  // Both ends of each drawn line, also written by TaskEdge: rectangle select takes lines whose ends are inside (D34).
  const ends = useRef(new Map<string, [Point, Point]>())
  // Rendered size where React Flow has measured the node, else an estimate from its text.
  const sizeOf = useCallback((id: string): Size => {
    const m = rf.getInternalNode(id)?.measured
    if (m?.width && m.height) return { width: m.width, height: m.height }
    const n = store.board.nodes.find(n => n.id === id)
    return { width: n ? approxWidth(n) : 160, height: n ? approxHeight(n) : HEIGHT }
  }, [rf, store])
  const extra = useMemo(() => {
    const counts = subtreeCounts(board.nodes)
    const children = childrenMap(board.nodes)
    const byId = new Map(board.nodes.map(n => [n.id, n]))
    const approx = (id: string) => ({ width: approxWidth(byId.get(id)!), height: approxHeight(byId.get(id)!) })
    return new Map(visible.nodes.map(n => {
      const c = counts.get(n.id)!, first = children.get(n.id)?.[0]
      return [n.id, {
        kids: c.children,
        hidden: n.collapsed ? c.descendants : 0,
        done: c.done,
        tasks: c.tasks,
        side: first ? facing(n, first, approx, vertical)[0] : vertical ? 'b' : 'r',
        look: styles.nodes.get(n.id)!,
      }]
    }))
  }, [board, visible, vertical, styles])
  // F9 focus mode (per view, never saved): the branch shown at full strength; everything else is dimmed.
  const [focusRoot, setFocusRoot] = useState<string | null>(null)
  const focus = useMemo(() => focusRoot && board.nodes.some(n => n.id === focusRoot) ? withDescendants(board.nodes, [focusRoot]) : null, [board, focusRoot])
  // R24 (D68): the due/status filter, per view and never saved. Nodes it doesn't match are dimmed.
  const [dueFilter, setDueFilter] = useState<DueFilter>({ views: [], days: 7 })
  const lit = useMemo(() => filterMatches(board.nodes, dueFilter, dayOf()), [board, dueFilter])
  const [nodes, setNodes] = useState(() => syncNodes(visible.nodes, [], null, extra, null, null))
  // Edge ids ("e-<child>" for parent lines, "l-<link>" for cross-links) that are selected.
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set())
  // Nodes created by Tab, Enter or paste are selected once they reach React Flow.
  const selectNext = useRef<Set<string> | null>(null)
  // Round 10: what was selected when a Shift + rectangle started; it stays selected (Canvas adds to the selection).
  const marqueeBase = useRef<{ nodes: Set<string>, edges: Set<string> } | null>(null)
  // Last pointer position over the board, where pasted nodes go.
  const pointer = useRef<{ x: number, y: number } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const shiftHeld = useRef(false)
  const snapOn = useRef(false)
  snapOn.current = snap && !spaceHeld
  // F2: `follow` maps each descendant of a dragged branch to its top node, which it moves with.
  const drag = useRef<{ start: Map<string, Point>, tops: Set<string>, follow: Map<string, string>, duplicate: boolean, alone: boolean } | null>(null)
  // Boards open fitted, so start in overview when the whole board would be too many nodes.
  const [overview, setOverview] = useState(() => visibleBoard(board, hideDone).nodes.length > OVERVIEW_ABOVE)
  const overviewCanvas = useRef<HTMLCanvasElement>(null)
  // D10: React Flow only gets nodes inside this window (about 3x3 views around the current one).
  const [win, setWin] = useState<Rect | null>(null)

  useEffect(() => setNodes(prev => {
    const next = syncNodes(visible.nodes, prev, editing, extra, focus, lit)
    const ids = selectNext.current
    if (!ids || !next.some(n => ids.has(n.id))) return next
    selectNext.current = null
    return next.map(n => n.selected === ids.has(n.id) ? n : { ...n, selected: ids.has(n.id) })
  }), [visible, editing, extra, focus, lit])

  // Unchanged lines keep their previous object (like syncNodes), so React Flow doesn't redraw them on every board change.
  const prevEdges = useRef(new Map<string, Edge<EdgeData>>())
  const edges = useMemo<Edge<EdgeData>[]>(() => {
    const byId = new Map(visible.nodes.map(n => [n.id, n]))
    const approx = (id: string) => ({ width: approxWidth(byId.get(id)!), height: approxHeight(byId.get(id)!) })
    const routing = styles.style.routing
    // Round 11: square routing turns each parent's lines at one shared place (cross-links route as angular).
    const trunk = routing === 'square' ? trunks(visible.nodes, sizeOf, vertical) : undefined
    const prev = prevEdges.current, next = new Map<string, Edge<EdgeData>>()
    const edge = (id: string, from: BoardNode, to: BoardNode, look: LineLook) => {
      const t = id.startsWith('e-') ? trunk?.get(to.id) : undefined
      const [sourceHandle, targetHandle] = facing(from, to, approx, vertical)
      const selected = selectedEdges.has(id)
      // A selected parent line can be reconnected at its parent end (reparent), drawn above the nodes.
      const reconnectable = selected && id.startsWith('e-') ? 'source' as const : false
      const className = (focus && !(focus.has(from.id) && focus.has(to.id))) || (lit && !lit.has(from.id) && !lit.has(to.id)) ? 'is-dim' : undefined
      const p = prev.get(id)
      const e = p && p.source === from.id && p.target === to.id && p.sourceHandle === sourceHandle && p.targetHandle === targetHandle
        && p.selected === selected && p.className === className && p.data!.routing === routing && p.data!.trunk === t && sameLine(p.data!.look, look) ? p
        : { id, type: 'task', source: from.id, target: to.id, sourceHandle, targetHandle, selected, reconnectable, className, data: { look, routing, trunk: t, mids: mids.current, ends: ends.current } }
      next.set(id, e)
      return e
    }
    const list = [
      ...visible.nodes.filter(n => n.parent !== null).map(n => edge(`e-${n.id}`, byId.get(n.parent!)!, n, styles.edges.get(n.id)!)),
      ...visible.links.map(l => edge(`l-${l.id}`, byId.get(l.from)!, byId.get(l.to)!, styles.links.get(l.id)!)),
    ]
    prevEdges.current = next
    return list
  }, [visible, selectedEdges, vertical, styles, focus, lit, sizeOf])

  // Round 10: the box around a selection of two or more things; round 11: a drag inside it moves the selection.
  const selBox = useMemo(() => selectionBounds(nodes, selectedEdges, ends.current, sizeOf), [nodes, selectedEdges, sizeOf])
  const selBoxRef = useRef(selBox)
  selBoxRef.current = selBox

  // Shift locks a drag to one axis and Space turns snapping off, as in Canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftHeld.current = e.shiftKey
      if (e.code === 'Space') setSpaceHeld(e.type === 'keydown')
    }
    const onBlur = () => { shiftHeld.current = false; setSpaceHeld(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onNodesChange = useCallback((changes: NodeChange<TaskFlowNode>[]) => {
    // Round 11: with snap on, a resize puts the moving edge on the grid. Only a resize from the left moves the node.
    if (snapOn.current) for (const c of changes) {
      if (c.type !== 'dimensions' || !c.resizing || !c.dimensions) continue
      const moved = changes.find(m => m.type === 'position' && m.id === c.id && m.position)
      const x = moved?.type === 'position' ? moved.position!.x : nodesRef.current.find(n => n.id === c.id)?.position.x
      if (x === undefined) continue
      const r = snapEdge(x, c.dimensions.width, moved ? 'left' : 'right', GRID, MIN_NODE_W)
      c.dimensions.width = r.width
      if (moved?.type === 'position') moved.position!.x = r.x
    }
    const d = drag.current
    if (d && shiftHeld.current) for (const c of changes) {
      if (c.type !== 'position' || !c.position) continue
      const s = d.start.get(c.id)
      if (!s) continue
      if (Math.abs(c.position.x - s.x) >= Math.abs(c.position.y - s.y)) c.position.y = s.y
      else c.position.x = s.x
    }
    // Deletes go through commands (see runAction); React Flow's own are ignored. A Shift + rectangle keeps what it started with.
    // React Flow has already unselected its own copy, so a kept node goes back as a new object for it to pick up again.
    const base = rfStore.getState().userSelectionRect ? marqueeBase.current : null
    const keep = new Set(changes.flatMap(c => base && c.type === 'select' && !c.selected && base.nodes.has(c.id) ? [c.id] : []))
    // Round 11: a resize's closing change carries React Flow's own, unsnapped width; the snapped one is already set.
    const kept = changes.filter(c => !(snapOn.current && c.type === 'dimensions' && c.resizing === false) && c.type !== 'remove' && c.type !== 'add' && c.type !== 'replace' && !(c.type === 'select' && keep.has(c.id)))
    // F2 live preview: descendants follow their branch's top node by the same offset.
    const offsets = new Map<string, Point>()
    if (d?.follow.size) for (const c of kept) {
      if (c.type !== 'position' || !c.position || !d.tops.has(c.id)) continue
      const s = d.start.get(c.id)!
      offsets.set(c.id, { x: c.position.x - s.x, y: c.position.y - s.y })
    }
    setNodes(ns => {
      let next = applyNodeChanges(kept, ns)
      if (keep.size) next = next.map(n => keep.has(n.id) ? { ...n, selected: true } : n)
      if (!offsets.size) return next
      return next.map(n => {
        const top = d!.follow.get(n.id), o = top && offsets.get(top)
        if (!o) return n
        const s = d!.start.get(n.id)!
        return { ...n, position: { x: s.x + o.x, y: s.y + o.y } }
      })
    })
  }, [rfStore])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    // D34: during a rectangle select, lines are picked by the effect below; React Flow's own picks (every line touching a
    // picked node) are ignored.
    const marquee = !!rfStore.getState().userSelectionRect
    const select = changes.filter(c => c.type === 'select' && !(marquee && c.selected))
    if (!select.length) return
    setSelectedEdges(prev => {
      const next = new Set(prev)
      for (const c of select) if (c.type === 'select') {
        if (c.selected) next.add(c.id)
        else next.delete(c.id)
      }
      return next
    })
  }, [rfStore])

  // D34 (amended M6b): the rectangle takes every drawn line with both ends inside it, lines alone included. React Flow
  // only offered lines touching a node it picked, so a line between two nodes left outside could never be taken.
  useEffect(() => rfStore.subscribe((s, prev) => {
    const r = s.userSelectionRect
    if (!s.userSelectionActive || !r || (r === prev.userSelectionRect && s.transform === prev.transform)) return
    const [tx, ty, z] = s.transform, x0 = (r.x - tx) / z, y0 = (r.y - ty) / z, x1 = x0 + r.width / z, y1 = y0 + r.height / z
    const inside = (p: Point) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    const picked = new Set<string>()
    for (const [id, [a, b]] of ends.current) if (s.edgeLookup.has(id) && inside(a) && inside(b)) picked.add(id)
    for (const id of marqueeBase.current?.edges ?? []) picked.add(id)
    setSelectedEdges(prev => prev.size === picked.size && [...prev].every(id => picked.has(id)) ? prev : picked)
    // Nodes too, by the same rule (D34). React Flow sends no change when a rectangle picks the same nodes as its last
    // one, though it cleared them when the rectangle started: selecting them again gave only their lines.
    const nodes = new Set(marqueeBase.current?.nodes ?? [])
    for (const [id, n] of s.nodeLookup) {
      const { x, y } = n.internals.positionAbsolute, w = n.measured.width ?? 0, h = n.measured.height ?? 0
      if (w && !n.hidden && x >= x0 && y >= y0 && x + w <= x1 && y + h <= y1) nodes.add(id)
    }
    setNodes(ns => ns.every(n => !!n.selected === nodes.has(n.id)) ? ns : ns.map(n => !!n.selected === nodes.has(n.id) ? n : { ...n, selected: nodes.has(n.id) }))
  }), [rfStore])

  const onNodeDrag: OnNodeDrag<TaskFlowNode> = useCallback(e => { shiftHeld.current = e.shiftKey }, [])

  // D26: Ctrl (Cmd) + drag moves only the dragged nodes; a plain drag moves whole branches.
  const beginDrag = useCallback((dragged: { id: string, position: Point }[], e: { shiftKey: boolean, ctrlKey: boolean, metaKey: boolean, altKey: boolean }) => {
    shiftHeld.current = e.shiftKey
    const alone = e.ctrlKey || e.metaKey
    const ids = dragged.map(n => n.id)
    const tops = new Set(alone ? ids : topmost(store.board.nodes, ids))
    const follow = new Map<string, string>()
    if (!alone) for (const top of tops) for (const id of withDescendants(visibleRef.current.nodes, [top])) if (!tops.has(id)) follow.set(id, top)
    const start = new Map(nodesRef.current.filter(n => tops.has(n.id) || follow.has(n.id)).map(n => [n.id, { ...n.position }]))
    for (const n of dragged) start.set(n.id, { ...n.position })
    drag.current = { start, tops, follow, duplicate: e.altKey, alone }
    setDragging(true)
  }, [store])
  const onNodeDragStart: OnNodeDrag<TaskFlowNode> = useCallback((e, _node, dragged) => beginDrag(dragged, e), [beginDrag])

  // D17: one command when the drag ends, never during it.
  const endDrag = useCallback((dragged: { id: string, position: Point }[]) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    const end = new Map(dragged.filter(n => d.tops.has(n.id)).map(n => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]))
    const offsets = new Map([...end].map(([id, p]) => [id, { x: p.x - d.start.get(id)!.x, y: p.y - d.start.get(id)!.y }]))
    if (d.duplicate) store.dispatch(duplicate(offsets))
    else if (d.alone) store.dispatch(moveNodes(end))
    else store.dispatch(moveSubtrees(offsets))
    // Originals of a duplicate (or a no-op move) keep their board position: put React Flow's nodes back.
    // Positions only: new nodes (the copies) arrive through the sync effect with their counts and looks.
    setNodes(prev => {
      const byId = new Map(visibleRef.current.nodes.map(n => [n.id, n]))
      return prev.map(n => {
        const b = byId.get(n.id)
        return b && (n.position.x !== b.x || n.position.y !== b.y) ? { ...n, position: { x: b.x, y: b.y } } : n
      })
    })
  }, [store])
  const onNodeDragStop: OnNodeDrag<TaskFlowNode> = useCallback((_e, _node, dragged) => endDrag(dragged), [endDrag])

  /** Round 11 (Canvas): pressing on empty space inside the selection box drags the selection, as dragging one of its
   *  nodes would (Ctrl alone, Alt duplicate, Shift one axis, snap). Returns false when the press is outside the box. */
  const suppressClick = useRef(false)
  const boxDrag = useCallback((e: React.PointerEvent) => {
    const box = selBoxRef.current
    const dragged = nodesRef.current.filter(n => n.selected).map(n => ({ id: n.id, position: { ...n.position } }))
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (!box || !dragged.length || at.x < box.x0 || at.x > box.x1 || at.y < box.y0 || at.y > box.y1) return false
    // Keeps React Flow from starting a rectangle select, and its pane click from clearing the selection.
    e.stopPropagation()
    e.preventDefault()
    suppressClick.current = true
    const lead = dragged[0].position
    let started = false, last = dragged
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < CLICK_SLOP) return
      if (!started) { started = true; beginDrag(dragged, ev) }
      shiftHeld.current = ev.shiftKey
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      let dx = p.x - at.x, dy = p.y - at.y
      if (snapOn.current) { dx = Math.round((lead.x + dx) / GRID) * GRID - lead.x; dy = Math.round((lead.y + dy) / GRID) * GRID - lead.y }
      if (ev.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0 }
      last = dragged.map(n => ({ id: n.id, position: { x: n.position.x + dx, y: n.position.y + dy } }))
      onNodesChange(last.map(n => ({ id: n.id, type: 'position', position: { ...n.position }, dragging: true })))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.setTimeout(() => { suppressClick.current = false })
      if (!started) return
      // React Flow's rectangle select always takes a node left marked as dragging, so the mark must come off.
      onNodesChange(last.map(n => ({ id: n.id, type: 'position', position: { ...n.position }, dragging: false })))
      endDrag(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return true
  }, [rf, beginDrag, endDrag, onNodesChange])

  /** Measured sizes for these branches' visible nodes (D9), estimates for anything else. */
  const branchSizes = useCallback((ids: Iterable<string>) => {
    const inBranch = withDescendants(store.board.nodes, ids)
    const measured = measureSizes(wrapper.current!, visibleRef.current.nodes.filter(n => inBranch.has(n.id)), subtreeCounts(store.board.nodes), resolveStyles(store.board).nodes)
    return (id: string) => measured.get(id) ?? sizeOf(id)
  }, [store, sizeOf])

  // Round 8: with snap on, tidy puts every node on the grid.
  const tidyBranches = useCallback((ids: string[] | null, before?: Command, merge = false) => {
    const board = before ? before(store.board) : store.board
    const tops = ids ?? board.nodes.filter(n => n.parent === null).map(n => n.id)
    const size = branchSizes(tops)
    store.dispatch(b => tidyNodes(tops, size, snap ? GRID : undefined)(before ? before(b) : b), merge)
  }, [store, branchSizes, snap])

  /** Round 8, Board style "Tidy as you add": after a node is added or its text changes, its whole tree re-tidies, in the
   *  same undo step. Next frame, so the new text is measured. Round 9: also the trees a delete left behind; ids no
   *  longer on the board are skipped. */
  const autoTidy = useCallback((...ids: string[]) => {
    if (!boardStyle(store.board).autoTidy) return
    const live = new Set(store.board.nodes.map(n => n.id))
    const roots = new Set(ids.filter(id => live.has(id)).map(id => ancestors(store.board.nodes, id).at(-1) ?? id))
    if (roots.size) window.requestAnimationFrame(() => tidyBranches([...roots], undefined, true))
  }, [store, tidyBranches])

  const createNode = useCallback((parent: string | null, clientX: number, clientY: number) => {
    if (store.board.nodes.some(n => n.id === parent && n.shape === 'label')) return
    const id = newId(new Set(store.board.nodes.map(n => n.id)))
    const p = rf.screenToFlowPosition({ x: clientX, y: clientY })
    // M6b, round 6: a child pulled from a node takes its shape and line style.
    store.dispatch(addNode({ id, parent, x: Math.round(p.x), y: Math.round(p.y - 15), ...inheritedStyle(store.board.nodes.find(n => n.id === parent)) }))
    setEditing(id)
    if (parent) autoTidy(id)
  }, [rf, store, autoTidy])

  /** Pans just enough to bring a node into view, keeping the zoom. */
  const reveal = useCallback((id: string) => {
    const n = store.board.nodes.find(n => n.id === id)
    const { transform: [tx, ty, zoom], width, height } = rfStore.getState()
    if (!n || !width) return
    const s = sizeOf(id)
    const x = n.x * zoom + tx, y = n.y * zoom + ty
    if (x >= 0 && y >= 0 && x + s.width * zoom <= width && y + s.height * zoom <= height) return
    void rf.setCenter(n.x + s.width / 2, n.y + s.height / 2, { zoom, duration: 200 })
  }, [rf, rfStore, store, sizeOf])

  const selectOnly = useCallback((id: string) => {
    setNodes(ns => ns.map(n => n.selected === (n.id === id) ? n : { ...n, selected: n.id === id }))
    setSelectedEdges(new Set())
    reveal(id)
  }, [reveal])

  /** Tab and Enter (D4): the new node goes beside its parent or after the last sibling branch, selected and in edit mode. */
  const addRelative = useCallback((to: string, kind: 'child' | 'sibling') => {
    const board = store.board
    const node = board.nodes.find(n => n.id === to)
    // Round 7 (D51): a label takes no children.
    if (!node || (kind === 'child' && node.shape === 'label')) return
    const parent = kind === 'child' ? to : node.parent
    const id = newId(new Set(board.nodes.map(n => n.id)))
    const spot = parent === null ? rootSpot(board, to, branchSizes([to])) : childSpot(board, parent, branchSizes([parent]))
    // A new sibling of a task is a task, like Enter in an editor checklist.
    const status: Status | undefined = kind === 'sibling' && node.status ? 'todo' : undefined
    // M6b, round 6: the new node takes the shape and line style of the node it was added from (its parent, or its sibling).
    // Adding under a collapsed node opens it, in the same undo step.
    store.dispatch(b => addNode({ id, parent, ...spot, status, ...inheritedStyle(node) })(parent === null ? b : setCollapsed([parent], false)(b)))
    selectNext.current = new Set([id])
    setEditing(id)
    autoTidy(id)
    window.requestAnimationFrame(() => reveal(id))
  }, [store, branchSizes, reveal, autoTidy])

  /** Round 14: a new node halfway along a parent line, between its parent and child, being typed. */
  const insertOnSelectedLine = useCallback((child: string) => {
    const board = store.board, c = board.nodes.find(n => n.id === child), p = board.nodes.find(n => n.id === c?.parent)
    if (!c || !p) return
    const id = newId(new Set(board.nodes.map(n => n.id)))
    const cs = sizeOf(c.id), ps = sizeOf(p.id)
    const x = Math.round((p.x + ps.width / 2 + c.x + cs.width / 2) / 2 - 40), y = Math.round((p.y + ps.height / 2 + c.y + cs.height / 2) / 2 - 17)
    store.dispatch(insertOnLine(child, { id, x, y }))
    setSelectedEdges(new Set())
    selectNext.current = new Set([id])
    setEditing(id)
    autoTidy(id)
  }, [store, sizeOf, autoTidy])

  /** Round 6 (N3), round 8: a new label or node, a root in the middle of the view (the pointer is on the button), being typed. */
  const addFree = useCallback((label: boolean) => {
    const id = newId(new Set(store.board.nodes.map(n => n.id)))
    const rect = wrapper.current!.getBoundingClientRect()
    const p = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    store.dispatch(addNode({ id, parent: null, x: Math.round(p.x), y: Math.round(p.y - (label ? 20 : 15)), ...label && { shape: 'label' } }))
    selectNext.current = new Set([id])
    setEditing(id)
  }, [rf, store])
  const addLabel = useCallback(() => addFree(true), [addFree])


  // F15, D27: copy puts board JSON and a plain-text outline on the clipboard; paste takes either.
  // Clipboard events go to the page body when no text box has focus, so listen on the document.
  useEffect(() => {
    const ours = () => !!wrapper.current?.contains(document.activeElement) && !document.activeElement?.closest('textarea, input')
    const selectedIds = () => nodesRef.current.filter(n => n.selected).map(n => n.id)
    const onCopy = (e: ClipboardEvent) => {
      const ids = selectedIds()
      if (!ours() || !ids.length || !e.clipboardData) return
      e.preventDefault()
      // D38: copy takes the nodes only unless the plugin setting says whole branches. Cut always takes the branch: it
      // moves it, and a node-only cut would drop its children.
      const branch = copyBranch || e.type === 'cut', only = new Set(ids)
      e.clipboardData.setData('text/plain', toMarkdown(branch ? store.board : { nodes: store.board.nodes.filter(n => only.has(n.id)) }, ids))
      e.clipboardData.setData(CLIP_TYPE, copyClip(store.board, ids, branch))
      if (e.type !== 'cut') return
      const parents = ids.map(id => store.board.nodes.find(n => n.id === id)?.parent ?? '')
      store.dispatch(deleteSubtrees(ids))
      autoTidy(...parents)
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!ours() || !e.clipboardData) return
      const board = store.board
      const json = e.clipboardData.getData(CLIP_TYPE), text = e.clipboardData.getData('text/plain')
      const clip = readClip(json || text, board)
      const nodes = clip?.nodes ?? parseOutline(text, new Set(board.nodes.map(n => n.id)))
      if (!nodes.length) return
      e.preventDefault()
      // D38: copied nodes go beside the one selected node (siblings, last); a text outline goes under it (its children).
      // With nothing selected, both land as new roots where the pointer is (or the middle of the view).
      const selected = selectedIds()
      const one = selected.length === 1 ? board.nodes.find(n => n.id === selected[0]) : undefined
      const parent = !one ? null : clip ? one.parent : one.shape === 'label' ? null : one.id
      const tops = nodes.filter(n => n.parent === null).map(n => n.id)
      const rect = wrapper.current!.getBoundingClientRect()
      const flow = rf.screenToFlowPosition(pointer.current ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      const at = parent ? childSpot(board, parent, branchSizes([parent]))
        : one ? rootSpot(board, one.id, branchSizes([one.id])) : { x: Math.round(flow.x), y: Math.round(flow.y) }
      const paste = (b: Board) => insertNodes(nodes, clip?.links ?? [], parent, at)(parent ? setCollapsed([parent], false)(b) : b)
      // Measured with the shapes they get where they land.
      const measured = measureSizes(wrapper.current!, nodes, subtreeCounts(nodes), resolveStyles(paste(board)).nodes)
      const size = (id: string) => measured.get(id) ?? sizeOf(id)
      // A copied branch keeps its layout; a text outline has none yet, so it is tidied.
      store.dispatch(b => clip ? paste(b) : tidyStacked(tops, size)(paste(b)))
      selectNext.current = new Set(tops)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [store, rf, sizeOf, branchSizes, copyBranch, autoTidy])

  // Drag from a handle: onto empty space makes a child (Canvas); onto a node makes it a child (D37, amended M6b), or a
  // cross-link with Alt. The node React Flow snapped to counts first: its dots sit partly outside the node, where a drop
  // used to find only the pane underneath and made a new node on top of it.
  const reconnecting = useRef(false)
  const onConnectEnd: OnConnectEnd = useCallback((event, connection) => {
    // React Flow calls this for a line's reconnect too (from its other end); onReconnectEnd handles that one.
    if (reconnecting.current) return
    const from = connection.fromNode?.id
    if (!from) return
    const { clientX, clientY } = pointOf(event)
    const under = document.elementsFromPoint(clientX, clientY)
    const target = connection.toNode?.id ?? nodeIdIn(under)
    const alt = 'altKey' in event && event.altKey
    // Round 15 (D60): dropped on one of several selected nodes, the line takes the whole selection.
    const group = nodesRef.current.filter(n => n.selected).map(n => n.id)
    if (target && target !== from && group.length > 1 && group.includes(target)) {
      store.dispatch(connectToGroup(from, group, alt))
      if (!alt) autoTidy(from)
    } else if (target && target !== from) store.dispatch(connectTo(from, target, alt))
    else if (!target && under.some(el => el.classList.contains('react-flow__pane'))) createNode(from, clientX, clientY)
  }, [store, createNode, autoTidy])

  // Reparent (Canvas: reconnect a line): drop the parent end of a selected parent line onto another node.
  const onReconnectEnd = useCallback((event: MouseEvent | TouchEvent, edge: Edge) => {
    reconnecting.current = false
    const { clientX, clientY } = pointOf(event)
    const target = nodeIdIn(document.elementsFromPoint(clientX, clientY))
    if (target && edge.id.startsWith('e-')) store.dispatch(reparent(edge.target, target))
  }, [store])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).classList.contains('react-flow__pane')) createNode(null, e.clientX, e.clientY)
  }, [createNode])

  // React Flow's fitView only counts measured nodes, and nodes culled by onlyRenderVisibleElements are
  // never measured. Fit to board positions instead, using measured sizes where known.
  const fitNodes = useCallback((ids?: Set<string>, duration = 200) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of visibleRef.current.nodes) {
      if (ids && !ids.has(n.id)) continue
      const m = rf.getInternalNode(n.id)?.measured
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y)
      x1 = Math.max(x1, n.x + (m?.width ?? n.width ?? 160)); y1 = Math.max(y1, n.y + (m?.height ?? 34))
    }
    if (x0 !== Infinity) void rf.fitBounds({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, { padding: 0.1, duration })
  }, [rf])

  // Obsidian can lay a view out over several frames (it starts a few pixels tall at startup), so keep
  // fitting the board to the view as it resizes until the user first pans or zooms.
  const userMoved = useRef(false)
  useEffect(() => {
    const fitIfSized = () => { const { width, height } = rfStore.getState(); if (width && height) fitNodes(undefined, 0) }
    fitIfSized()
    return rfStore.subscribe((s, prev) => {
      if (!userMoved.current && (s.width !== prev.width || s.height !== prev.height)) fitIfSized()
    })
  }, [rfStore, fitNodes])

  // Re-check the level of detail, the render window and the overview drawing at most once per frame.
  useEffect(() => {
    let frame = 0, on = overview, current: Rect | null = null
    const update = () => {
      frame = 0
      const { transform, width, height } = rfStore.getState()
      if (!width || !height) return
      const count = visibleCount(visibleRef.current.nodes, transform, width, height)
      const next = on ? count > OVERVIEW_BELOW || transform[2] < OVERVIEW_ZOOM : count > OVERVIEW_ABOVE
      if (next !== on) setOverview(on = next)
      if (on && overviewCanvas.current) drawOverview(overviewCanvas.current, visibleRef.current, transform, width, height)
      if (on) return
      // Move the window only once the view gets within half a view of its edge.
      const [tx, ty, zoom] = transform
      const w = width / zoom, h = height / zoom, x0 = -tx / zoom, y0 = -ty / zoom
      const c = current
      if (!c || x0 - w / 2 < c.x0 || y0 - h / 2 < c.y0 || x0 + w * 1.5 > c.x1 || y0 + h * 1.5 > c.y1)
        setWin(current = { x0: x0 - w, y0: y0 - h, x1: x0 + 2 * w, y1: y0 + 2 * h })
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    schedule()
    const offView = rfStore.subscribe((s, prev) => {
      if (s.transform !== prev.transform || s.width !== prev.width || s.height !== prev.height) schedule()
    })
    const offBoard = store.subscribe(schedule)
    return () => { offView(); offBoard(); window.cancelAnimationFrame(frame) }
  }, [rfStore, store]) // `overview` only seeds `on`; re-subscribing on every switch is not needed

  const near = useMemo(() => win && nodesNear(visible, win), [visible, win])
  const rfNodes = useMemo(() => overview ? NONE : near ? nodes.filter(n => near.has(n.id) || n.selected) : nodes, [overview, near, nodes])
  const rfEdges = useMemo(() => {
    if (overview) return NONE
    if (!near) return edges
    const ids = new Set(rfNodes.map(n => n.id))
    return edges.filter(e => ids.has(e.source) && ids.has(e.target))
  }, [overview, near, rfNodes, edges])

  const toggleCollapse = useCallback((ids: string[]) => {
    const nodes = store.board.nodes.filter(n => ids.includes(n.id))
    // Mixed selection: collapse everything that is open first, like a tri-state checkbox.
    store.dispatch(setCollapsed(ids, nodes.some(n => !n.collapsed && extra.get(n.id)?.kids)))
  }, [store, extra])

  /** Shift+2 and the focus button (handoff): one node or line is centred at 140%; several nodes are fitted. */
  const focusSelection = useCallback(() => {
    const selected = nodesRef.current.filter(n => n.selected)
    if (selected.length > 1) return fitNodes(new Set(selected.map(n => n.id)))
    const one = selected[0]?.data.node
    if (one) {
      const s = sizeOf(one.id)
      return void rf.setCenter(one.x + s.width / 2, one.y + s.height / 2, { zoom: 1.4, duration: 250 })
    }
    const mid = mids.current.get([...selectedEdges][0] ?? '')
    if (mid) void rf.setCenter(mid.x, mid.y, { zoom: 1.4, duration: 250 })
  }, [fitNodes, sizeOf, rf, selectedEdges])

  // M6b Arrange menu: tidy the selected branches (their children), or line up or space out the selected nodes.
  const arrange = useCallback((how: Arrange) => {
    const ids = nodesRef.current.filter(n => n.selected).map(n => n.id)
    if (how === 'tidy') {
      // Round 17: several selected top-level nodes are lined up among themselves; their branches stay where they are.
      const roots = ids.length > 1 && ids.every(id => store.board.nodes.find(n => n.id === id)?.parent === null)
      return roots ? store.dispatch(stackRoots(ids, sizeOf)) : tidyBranches(ids)
    }
    if (how === 'fitText') return store.dispatch(setWidths(new Map(ids.map(id => [id, oneLineWidth(wrapper.current!, id)]))))
    if (how === 'widest' || how === 'narrowest') {
      const widths = ids.map(id => sizeOf(id).width), w = how === 'widest' ? Math.max(...widths) : Math.min(...widths)
      return store.dispatch(setWidths(new Map(ids.map(id => [id, w]))))
    }
    store.dispatch(alignNodes(ids, how, sizeOf))
  }, [store, tidyBranches, sizeOf])

  const toggleFocusMode = useCallback(() => {
    if (focusRoot) return setFocusRoot(null)
    const [top] = topmost(store.board.nodes, nodesRef.current.filter(n => n.selected).map(n => n.id))
    if (!top) return
    setFocusRoot(top)
    fitNodes(withDescendants(visibleRef.current.nodes, [top]))
  }, [focusRoot, store, fitNodes])

  const runAction = useCallback((action: Action) => {
    const selected = nodesRef.current.filter(n => n.selected)
    const one = selected.length === 1 ? selected[0].id : null
    const arrow: Record<string, Side> = { selectUp: 't', selectDown: 'b', selectLeft: 'l', selectRight: 'r' }
    switch (action) {
      case 'undo': return store.undo()
      case 'redo': return store.redo()
      case 'selectAll': return setNodes(ns => ns.map(n => n.selected ? n : { ...n, selected: true }))
      case 'delete': {
        const ids = selected.map(n => n.id)
        const links = [...selectedEdges].filter(e => e.startsWith('l-')).map(e => e.slice(2))
        // Deleting a parent line detaches the child as a new root; its branch stays.
        const detach = [...selectedEdges].filter(e => e.startsWith('e-')).map(e => e.slice(2))
        setSelectedEdges(new Set())
        const parentOf = new Map(store.board.nodes.map(n => [n.id, n.parent]))
        store.dispatch(b => detach.reduce((acc, id) => reparent(id, null)(acc), deleteLinks(links)(deleteSubtrees(ids)(b))))
        // Round 9: the trees that lost a branch, and branches cut loose, re-tidy with "Tidy as you add".
        autoTidy(...[...ids, ...detach].map(id => parentOf.get(id) ?? ''), ...detach)
        // The focused node may be gone, which would drop focus to the page and the board's keys with it.
        return wrapper.current?.focus({ preventScroll: true })
      }
      case 'zoomToFit': return fitNodes()
      case 'zoomToSelection': return focusSelection()
      case 'editNode': return void (one && setEditing(one))
      case 'addChild': {
        if (one) return addRelative(one, 'child')
        // Round 14: with one parent line selected (and no node), Tab puts a new node on it, between parent and child.
        const line = !selected.length && selectedEdges.size === 1 ? [...selectedEdges][0] : ''
        return void (line.startsWith('e-') && insertOnSelectedLine(line.slice(2)))
      }
      case 'deleteKeepChildren': {
        const ids = selected.map(n => n.id)
        if (!ids.length) return
        const parentOf = new Map(store.board.nodes.map(n => [n.id, n.parent]))
        store.dispatch(deleteKeepChildren(ids))
        autoTidy(...ids.map(id => parentOf.get(id) ?? ''), ...store.board.nodes.filter(n => ids.includes(parentOf.get(n.id) ?? '')).map(n => n.id))
        return wrapper.current?.focus({ preventScroll: true })
      }
      case 'addSibling': return void (one && addRelative(one, 'sibling'))
      case 'selectUp': case 'selectDown': case 'selectLeft': case 'selectRight': {
        const from = one ?? selected.at(-1)?.id
        const vis = visibleRef.current.nodes
        const to = from ? neighbor(vis, from, arrow[action], sizeOf, vertical) : vis.find(n => n.parent === null)?.id
        return void (to && selectOnly(to))
      }
      case 'moveUp': case 'moveDown':
        return void (one && store.dispatch(swapSibling(one, action === 'moveUp' ? -1 : 1, branchSizes(siblingsOf(store.board, one)))))
      case 'toggleCollapse': return void (selected.length && toggleCollapse(selected.map(n => n.id)))
      case 'tidy': return tidyBranches(selected.length ? selected.map(n => n.id) : null)
      case 'toggleDone': return void (selected.length && (store.dispatch(toggleDone(selected.map(n => n.id))), autoTidy(...selected.map(n => n.id))))
    }
  }, [store, fitNodes, selectedEdges, addRelative, insertOnSelectedLine, selectOnly, sizeOf, vertical, branchSizes, toggleCollapse, tidyBranches, focusSelection, autoTidy])

  // Selecting another node or line closes any open flyout (handoff state rules).
  const selectionKey = nodes.filter(n => n.selected).map(n => n.id).join() + '|' + [...selectedEdges].join()
  useEffect(() => { setFlyout(null) }, [selectionKey])

  /** D30: shows only the connection dot nearest the pointer, and only within 24 screen px of it and 40% of the node's height. */
  const nearDot = useRef<{ frame: number, el: Element | null }>({ frame: 0, el: null })
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY }
    if (nearDot.current.frame) return
    const { clientX, clientY } = e
    nearDot.current.frame = window.requestAnimationFrame(() => {
      nearDot.current.frame = 0
      let best: Element | null = null, bestD = Infinity
      // D35: over a collapse button, no dot shows, so the button and the dot never compete.
      const under = document.elementFromPoint(clientX, clientY)
      const overButton = !!under?.closest('.flowmap-collapse')
      // Round 14: over a node, only its own dots light, so a neighbour's dot never takes a click meant for this node.
      const overNode = under?.closest('.react-flow__node')
      if (!rfStore.getState().connection.inProgress && !overButton)
        for (const h of wrapper.current?.querySelectorAll('.react-flow__node .react-flow__handle') ?? []) {
          if (overNode && !overNode.contains(h)) continue
          const r = h.getBoundingClientRect()
          const d = Math.hypot(r.x + r.width / 2 - clientX, r.y + r.height / 2 - clientY)
          // Round 14: a selected node shows no dots. Within 30px, and within 40% of the node's height on screen, so the
          // middle of a small or zoomed-out node lights nothing.
          if (h.closest('.react-flow__node.selected')) continue
          const reach = Math.min(30, 0.4 * (h.parentElement?.getBoundingClientRect().height ?? 0))
          if (d < reach && d < bestD) { best = h; bestD = d }
        }
      // Round 11: over empty space inside the selection box, the pointer shows that a drag moves the selection.
      const box = selBoxRef.current, at = box && rf.screenToFlowPosition({ x: clientX, y: clientY })
      const inBox = !!at && at.x >= box.x0 && at.x <= box.x1 && at.y >= box.y0 && at.y <= box.y1
      wrapper.current?.classList.toggle('is-over-selection', inBox)
      if (best === nearDot.current.el) return
      nearDot.current.el?.classList.remove('is-near')
      best?.classList.add('is-near')
      nearDot.current.el = best
    })
  }, [rfStore, rf])
  useEffect(() => () => window.cancelAnimationFrame(nearDot.current.frame), [])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.target as Element).closest('textarea, input, select, [contenteditable]')) return
    // Esc (handoff): closes the open flyout, then Board style, then clears the selection.
    if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (flyout) setFlyout(null)
      else if (boardBar) setBoardBar(false)
      else if (nodesRef.current.some(n => n.selected) || selectedEdges.size) {
        setNodes(ns => ns.map(n => n.selected ? { ...n, selected: false } : n))
        setSelectedEdges(new Set())
      } else if (focusRoot) setFocusRoot(null)
      else return
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const action = actionFor(e.nativeEvent, keymap)
    if (!action) return // D24: everything else reaches Obsidian
    e.preventDefault()
    e.stopPropagation()
    runAction(action)
  }, [keymap, runAction, flyout, boardBar, selectedEdges, focusRoot])

  const actions = useMemo<NodeActions>(() => ({
    commitText: (id, text, then) => {
      store.dispatch(setText(id, text))
      setEditing(null)
      autoTidy(id)
      wrapper.current?.focus({ preventScroll: true })
      if (then === 'addChild') addRelative(id, 'child')
    },
    toggleCollapse: id => toggleCollapse([id]),
    // The checkbox toggles between todo and done only (D7); other statuses are set by command.
    toggleDone: id => store.dispatch(b => setStatus([id], b.nodes.find(n => n.id === id)?.status === 'done' ? 'todo' : 'done')(b)),
    resize: (id, width, position, side) => {
      const r = snapOn.current ? snapEdge(position.x, width, side, GRID, MIN_NODE_W) : { x: position.x, width }
      store.dispatch(setWidth(id, r.width, { x: Math.round(r.x), y: Math.round(position.y) }))
    },
    links,
  }), [store, links, addRelative, toggleCollapse, autoTidy])

  api.current = {
    autoTidy,
    selectedIds: () => nodesRef.current.filter(n => n.selected).map(n => n.id),
    select: selectOnly,
    focus: id => {
      selectOnly(id)
      const n = store.board.nodes.find(n => n.id === id)
      // A node that was just expanded into view isn't in React Flow yet: select it when it arrives.
      if (n && !nodesRef.current.some(r => r.id === id)) selectNext.current = new Set([id])
      const s = sizeOf(id)
      if (n) void rf.setCenter(n.x + s.width / 2, n.y + s.height / 2, { zoom: Math.max(1, rf.getZoom()) })
    },
    run: runAction,
    toggleBoardStyle: () => { setFlyout(null); setBoardBar(on => !on) },
    toggleFocusMode,
    addLabel,
    selectAndFit: ids => {
      const set = new Set(ids)
      setNodes(ns => ns.map(n => n.selected === set.has(n.id) ? n : { ...n, selected: set.has(n.id) }))
      setSelectedEdges(new Set())
      // Nodes just expanded into view aren't in React Flow yet: select them when they arrive, and fit once they're drawn.
      selectNext.current = set
      if (set.size) window.requestAnimationFrame(() => fitNodes(set))
    },
    exportSvg: interactive => {
      const el = wrapper.current!, vis = interactive ? store.board : visibleRef.current, cs = getComputedStyle(el)
      const probe = el.createDiv()
      probe.className = 'flowmap-node'
      // Font as the board draws node text: from a node on screen when there is one.
      const shown = getComputedStyle(el.querySelector('.react-flow__node .flowmap-node-text') ?? probe)
      const fontSize = parseFloat(shown.fontSize) || 14
      const color = (css: string) => { probe.style.color = css; return getComputedStyle(probe).color }
      const colors = new Map<string, string>(), resolve = (css: string) => colors.get(css) ?? (colors.set(css, color(css)), colors.get(css)!)
      const measured = measureSizes(el, vis.nodes, subtreeCounts(store.board.nodes), styles.nodes)
      const image = boardSvg({
        nodes: vis.nodes, links: vis.links, styles, size: id => measured.get(id) ?? sizeOf(id), vertical, color: resolve, counts: subtreeCounts(store.board.nodes),
        font: shown.fontFamily || cs.getPropertyValue('--tm-font').trim(), fontSize, lineHeight: parseFloat(shown.lineHeight) || Math.round(fontSize * 1.5), text: resolve(cs.getPropertyValue('--tm-text').trim() || 'var(--text-normal)'),
        background: resolve('var(--background-primary)'), accent: resolve('var(--interactive-accent)'), interactive,
      })
      const glyphs = { accent: resolve('var(--interactive-accent)'), red: resolve('var(--text-error)'), faint: resolve('var(--text-faint)'), muted: resolve('var(--text-muted)'), line: resolve('var(--background-modifier-border)') }
      probe.remove()
      return { ...image, background: resolve('var(--background-primary)'), colors: glyphs }
    },
    tidy: tidyBranches,
    measurePanZoom: async () => {
      const start = rf.getViewport()
      const fitted = await measurePanZoom(rf, wrapper.current!, start)
      const first = store.board.nodes[0]
      const { width, height } = rfStore.getState()
      const zoomedIn = await measurePanZoom(rf, wrapper.current!, { x: width / 2 - (first?.x ?? 0), y: height / 2 - (first?.y ?? 0), zoom: 1 })
      void rf.setViewport(start)
      return { fitted, zoomedIn }
    },
  }

  return (
    <Actions.Provider value={actions}>
      <div
        ref={wrapper}
        className={'flowmap-canvas' + (styles.style.textColor === 'node' ? ' text-node' : '')}
        style={{
          '--tm-font': cssFont(styles.style.font), '--tm-text': cssTextColor(styles.style.textColor), '--tm-fill-opacity': styles.style.fillOpacity / 100,
        } as React.CSSProperties}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        // Text fields (node editor, label editor, font name) keep focus; everything else hands it to the board, so its keys work.
        // Round 14: so does a click on a `[[` suggestion, or the editor would blur and close before the row took the click.
        onPointerDownCapture={e => {
          if (!(e.target as Element).closest('textarea, input:not([type]), input[type="text"], input[type="date"], .flowmap-suggest')) wrapper.current?.focus({ preventScroll: true })
          // Shift-click adds to the selection. React Flow learns Shift from its own key tracking, which misses a Shift
          // pressed while focus was elsewhere (another pane, a text box); the click itself knows.
          if (rfStore.getState().multiSelectionActive !== e.shiftKey) rfStore.setState({ multiSelectionActive: e.shiftKey })
          if (e.button === 0 && !e.shiftKey && (e.target as Element).classList.contains('react-flow__pane') && boxDrag(e)) return
          marqueeBase.current = e.shiftKey ? { nodes: new Set(nodesRef.current.filter(n => n.selected).map(n => n.id)), edges: new Set(selectedEdges) } : null
        }}
        onClickCapture={e => { if (suppressClick.current) e.stopPropagation() }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => { pointer.current = null }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          // Round 6 (N2): a click may wobble up to 4px. By default any movement cancels the click, but a drag only starts
          // past 1px, so a 0.5-1px wobble did neither and the node was not selected (Shift-click too).
          nodeClickDistance={CLICK_SLOP}
          nodeDragThreshold={CLICK_SLOP}
          onNodeDoubleClick={(_, n) => setEditing(n.id)}
          onEdgeDoubleClick={(_, e) => setLabelEdit(e.id)}
          onPaneClick={() => setFlyout(null)}
          onConnectEnd={onConnectEnd}
          onReconnect={() => {}}
          onReconnectStart={() => { reconnecting.current = true }}
          onReconnectEnd={onReconnectEnd}
          elevateEdgesOnSelect
          onInit={() => window.requestAnimationFrame(() => {
            // Round 9: a board with "Tidy as you add" on opens tidy, in one undo step.
            if (boardStyle(store.board).autoTidy) tidyBranches(null)
            onFirstPaint()
          })}
          onMoveStart={e => {
            if (e) userMoved.current = true
            // M6 (D10): with many lines on screen (a busy or unevenly laid out board), panning and zooming draw them as
            // hairlines, which the browser paints far faster than wide curves (6 to 40+ fps on large-2000 at 60%).
            // Full width returns when the move ends.
            if ((wrapper.current?.querySelectorAll('.react-flow__edge').length ?? 0) > BUSY_LINES) wrapper.current?.classList.add('is-moving-busy')
          }}
          onMoveEnd={() => wrapper.current?.classList.remove('is-moving-busy')}
          connectionMode={ConnectionMode.Loose}
          onlyRenderVisibleElements
          // D29: the wheel zooms around the pointer (Canvas, Advanced Canvas), or pans with the trackpad setting (then
          // Shift+wheel pans sideways and Ctrl/Cmd or Space + wheel zooms). Drag on empty space selects; Space, middle or
          // right drag pans.
          panOnScroll={!wheelZoom}
          zoomOnScroll
          panOnDrag={[1, 2]}
          selectionOnDrag
          selectionMode={SelectionMode.Full}
          panActivationKeyCode="Space"
          zoomActivationKeyCode={['Control', 'Meta', 'Space']}
          multiSelectionKeyCode="Shift"
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          disableKeyboardA11y // its arrow-key moves would bypass commands
          snapToGrid={snap && !spaceHeld}
          snapGrid={[GRID, GRID]}
          minZoom={0.05}
          proOptions={{ hideAttribution: true }}
        >
          {/* Round 13: React Flow centres its dots in each cell; this offset puts them on the snap points (dot radius 0.5). */}
          {gridDots && <Background gap={GRID} offset={0.5 - GRID / 2} color={/^#[0-9a-f]{6}$/i.test(gridColor) ? gridColor : undefined} />}
          <canvas ref={overviewCanvas} className="flowmap-overview" hidden={!overview} />
          {!overview && selBox && <SelectionBox box={selBox} />}
          {hints && <ShortcutHints keymap={keymap} editing={!!editing} nodes={nodes.filter(n => n.selected).length} lines={selectedEdges.size} wheelZoom={wheelZoom} />}
          <Breadcrumb board={board} selected={nodes.filter(n => n.selected)} onPick={selectOnly} />
          <StyleOverlay board={board} styles={styles} nodes={nodes} selectedEdges={selectedEdges} flyout={flyout} setFlyout={setFlyout}
            boardBar={boardBar} setBoardBar={setBoardBar} hidden={!!editing || dragging || overview} labelEdit={labelEdit} setLabelEdit={setLabelEdit}
            mids={mids.current} sizeOf={sizeOf} store={store} snap={snap} onSnap={() => onSnapChange(!snap)} onFit={() => fitNodes()} onFocus={focusSelection}
            onNote={action => { const [id] = nodesRef.current.filter(n => n.selected); if (id) onNoteAction(action, id.id) }}
            onArrange={arrange} onTasks={ids => autoTidy(...ids)}
            setSelectedEdges={setSelectedEdges} recentFonts={recentFonts} onFontUsed={onFontUsed} tools={{
              levels, level: shownLevel(board.nodes), hideDone, onHideDone: () => onHideDoneChange(!hideDone), dueFilter, onDueFilter: setDueFilter,
              onLevel: l => store.dispatch(l === 'all' ? expandAll : collapseToLevel(l)),
              minimap, onMinimap: () => onMinimapChange(!minimap),
              focusMode: !!focus, canFocusMode: nodes.some(n => n.selected), onFocusMode: toggleFocusMode, onAddLabel: addLabel,
              // Round 15: with one parent line selected (and no node), Add node puts the new node on it, like Tab.
              onAddNode: () => {
                const line = selectedEdges.size === 1 && !nodesRef.current.some(n => n.selected) ? [...selectedEdges][0] : ''
                if (line.startsWith('e-')) insertOnSelectedLine(line.slice(2))
                else addFree(false)
              }, onTidyBoard: (merge = false) => tidyBranches(null, undefined, merge), onExport,
            }} />
          {minimap && <Minimap nodes={visible.nodes} strokes={strokes} />}
        </ReactFlow>
      </div>
    </Actions.Provider>
  )
}

const HANDLES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const

const nodeClass = (n: BoardNode, shape: Shape) =>
  `flowmap-node shape-${shape}` + (n.width ? ' has-width' : '') + (n.status ? ` status-${n.status}` : '')

const sameLook = (a: NodeLook, b: NodeLook) => a.shape === b.shape && a.stroke === b.stroke && a.fill === b.fill && a.size === b.size
const sameLine = (a: LineLook, b: LineLook) => a.dash === b.dash && a.arrow === b.arrow && a.direction === b.direction && a.color === b.color
  && a.width === b.width && a.label === b.label && a.animate === b.animate

const CLIP_TYPE = 'application/x-flowmap'
// Obsidian's checkbox characters, so themes that style alternate checkboxes style these too.
const TASK_CHAR: Record<Status, string> = { todo: ' ', doing: '/', blocked: '!', done: 'x', dropped: '-' }
const progress = (done: number, tasks: number) => tasks ? `${done}/${tasks}` : ''

const basename = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')

const TaskNode = memo(function TaskNode({ id, data, selected }: NodeProps<TaskFlowNode>) {
  const { node, editing, look } = data
  const actions = useContext(Actions)
  // The outline is drawn at the node's real size (handoff), so it needs React Flow's measurement.
  const size = useStore(s => { const m = s.nodeLookup.get(id)?.measured; return m?.width && m.height ? `${m.width} ${m.height}` : '' })
  const [w, h] = size ? size.split(' ').map(Number) : [0, 0]
  const oh = overhang(look.shape, h)
  // D13: resolved colors reach CSS as variables (see styles.css), so theme colors keep following Obsidian.
  const vars = { '--tm-stroke': look.stroke, '--tm-fill': look.fill ?? 'none', '--tm-oh-x': `${oh.x}px`, '--tm-oh-y': `${oh.y}px`, ...look.size && { '--tm-size': `${look.size}px` } } as React.CSSProperties
  // M5b: lines attach at the handles, whose positions React Flow caches; a new shape moves them without resizing the
  // node, so re-measure (this was the gap or overlap after switching shape).
  // Only on a change: React Flow measures a new node itself, and re-measuring every node as a branch expands cost 7x.
  const updateInternals = useUpdateNodeInternals()
  const attach = `${look.shape} ${oh.x} ${oh.y}`, lastAttach = useRef(attach)
  useEffect(() => { if (lastAttach.current !== attach) { lastAttach.current = attach; updateInternals(id) } }, [updateInternals, id, attach])
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (box.current) fitDiamond(box.current, look.shape === 'diamond') })
  let tabbed = false // Tab already committed the text; skip the commit on blur
  // M6b: typing `[[` lists matching notes under the node; arrows move, Enter or Tab (or a click) puts in the link.
  const [sugg, setSugg] = useState<{ items: { linktext: string, path: string }[], index: number, start: number } | null>(null)
  const suggest = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart)
    const m = el.selectionStart === el.selectionEnd && /\[\[([^[\]|#\n]*)$/.exec(before)
    const items = m ? actions.links.suggest(m[1]) : []
    setSugg(m && items.length ? { items, index: 0, start: before.length - m[0].length } : null)
  }
  const insert = (el: HTMLTextAreaElement, linktext: string) => {
    if (!sugg) return
    const end = el.selectionStart + (el.value.startsWith(']]', el.selectionStart) ? 2 : 0)
    const link = `[[${linktext}]]`
    el.value = el.value.slice(0, sugg.start) + link + el.value.slice(end)
    el.setSelectionRange(sugg.start + link.length, sugg.start + link.length)
    setSugg(null)
  }
  const d = w > 0 ? nodePath(look.shape, w, h) : ''
  return (
    <div ref={box} className={nodeClass(node, look.shape)} style={vars}>
      {/* D33: a selected node's outline thickens over an accent glow, like a selected line. */}
      {d && <svg className="flowmap-shape" width={w} height={h}>{selected && <path className="flowmap-node-halo" d={d} />}<path d={d} /></svg>}
      {selected && !editing && (['left', 'right'] as const).map(side => (
        <NodeResizeControl key={side} position={side} variant={ResizeControlVariant.Line} minWidth={MIN_NODE_W}
          onResizeEnd={(_, p) => actions.resize(id, p.width, p, side)} />
      ))}
      <div className="flowmap-node-row">
      {node.status && (
        <input type="checkbox" className="task-list-item-checkbox flowmap-check nodrag" data-task={TASK_CHAR[node.status]}
          checked={node.status === 'done'} aria-label={node.status} tabIndex={-1} onChange={() => actions.toggleDone(id)}
          // Keep focus on the board, or its keys would stop working after a click.
          onMouseDown={e => e.preventDefault()} onDoubleClick={e => e.stopPropagation()} />
      )}
      {editing ? (<>
        <textarea
          ref={focusWhenVisible}
          className="flowmap-node-editor nodrag nowheel nopan"
          defaultValue={node.text}
          onFocus={e => e.currentTarget.select()}
          onBlur={e => { setSugg(null); if (!tabbed) actions.commitText(id, e.currentTarget.value) }}
          onInput={e => suggest(e.currentTarget)}
          onKeyDown={e => {
            if (sugg) {
              const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
              if (step) { e.preventDefault(); return setSugg({ ...sugg, index: (sugg.index + step + sugg.items.length) % sugg.items.length }) }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return insert(e.currentTarget, sugg.items[sugg.index].linktext) }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return setSugg(null) }
            }
            // Escape or Enter finishes editing; Shift+Enter is a new line; Tab finishes and adds a child.
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault()
              tabbed = true
              actions.commitText(id, e.currentTarget.value, 'addChild')
            }
          }}
        />
        {sugg && (
          <div className="flowmap-suggest nodrag nowheel nopan">
            {sugg.items.map((it, i) => (
              <div key={it.path} className={'flowmap-suggest-row' + (i === sugg.index ? ' is-selected' : '')} aria-label={it.path}
                onMouseDown={e => { e.preventDefault(); const el = box.current?.querySelector('textarea'); if (el) insert(el, it.linktext) }}>
                <span>{basename(it.path)}</span>{it.path.includes('/') && <span className="flowmap-suggest-path">{it.path.slice(0, it.path.lastIndexOf('/'))}</span>}
              </div>
            ))}
          </div>
        )}
      </>) : (
        <div className="flowmap-node-text">{node.text ? textParts(node.text).map((p, i) => typeof p === 'string' ? p
          : 'tag' in p ? <TagPill key={i} tag={p.tag} label={p.label} links={actions.links} />
          : <NoteLink key={i} linktext={p.linktext} label={p.label} links={actions.links} />) : ' '}</div>
      )}
      {data.tasks > 0 && <span className="flowmap-progress" aria-label={`${data.done} of ${data.tasks} tasks done`}>{progress(data.done, data.tasks)}</span>}
      {/* M7: the due date chip. ponytail: the overdue color is worked out when the node draws; a board left open past
          midnight updates on its next change. */}
      {isDue(node.due) && <span className={`flowmap-due is-${dueState(node, dayOf())}`} aria-label={`Due ${node.due}`}>{shortDay(node.due, dayOf())}</span>}
      </div>
      {node.link && (
        <div className="flowmap-node-link">↗ <NoteLink linktext={node.link} label={basename(node.link)} links={actions.links} /></div>
      )}
      {/* Round 14: a selected node has no dots, so a press there always drags the selection. */}
      {HANDLES.map(([hid, pos]) => <Handle key={hid} id={hid} type="source" position={pos} isConnectable={!selected} />)}
      {data.kids > 0 && (
        <button
          className={`flowmap-collapse nodrag side-${data.side}${data.hidden ? ' is-collapsed' : ''}`}
          aria-label={data.hidden ? 'Expand' : 'Collapse'}
          onClick={e => { e.stopPropagation(); actions.toggleCollapse(id) }}
          onDoubleClick={e => e.stopPropagation()}
        >
          {data.hidden ? `${data.hidden} hidden${data.done ? `, ${data.done} done` : ''}` : '−'}
        </button>
      )}
    </div>
  )
})

/** A #tag in node text, a pill. Click searches the vault for it. */
function TagPill({ tag, label, links }: { tag: string, label: string, links: BoardLinks }) {
  return (
    <span className="flowmap-tag nodrag" aria-label={`Search ${label}`}
      onClick={e => { e.stopPropagation(); links.searchTag(tag) }}
      onDoubleClick={e => e.stopPropagation()}>{label}</span>
  )
}

/** F10: a note link on a node. Click opens it (Ctrl or Cmd: in a new tab); hovering shows Obsidian's page preview. A link
 *  to a missing note is drawn faded, and clicking it creates the note, as in Obsidian. */
function NoteLink({ linktext, label, links }: { linktext: string, label: string, links: BoardLinks }) {
  return (
    <a className={`internal-link nodrag${links.resolved(linktext) ? '' : ' is-unresolved'}`} data-href={linktext} aria-label={linktext}
      onClick={e => { e.preventDefault(); e.stopPropagation(); links.open(linktext, e.ctrlKey || e.metaKey) }}
      onDoubleClick={e => e.stopPropagation()}
      onMouseOver={e => links.hover(e.nativeEvent, e.currentTarget, linktext)}>{label}</a>
  )
}

/**
 * M5b: a diamond's box is sized so its content fills DIAMOND_FIT of the width and height, which puts the content's
 * corners on the diamond. Padding is worked out from the content's own size (measured with no padding).
 * Round 8: a resized diamond (fixed width) keeps its width; its text wraps to fit inside and the diamond grows taller.
 */
function fitDiamond(el: HTMLElement, diamond: boolean) {
  if (!diamond && !el.style.padding) return // nothing to undo: most nodes, most renders
  el.setCssStyles({ padding: diamond ? '0' : '', maxWidth: '', width: '' })
  if (!diamond) return
  const w = el.offsetWidth
  if (el.classList.contains('has-width')) {
    el.setCssStyles({ width: `${w * DIAMOND_FIT.x}px` })
    const h = el.offsetHeight
    el.setCssStyles({ width: '', padding: `${h * (1 / DIAMOND_FIT.y - 1) / 2}px ${w * (1 - DIAMOND_FIT.x) / 2}px` })
    return
  }
  // The content wraps at the node's maximum width; the padded box then goes past it.
  const h = el.offsetHeight
  el.setCssStyles({ padding: `${h * (1 / DIAMOND_FIT.y - 1) / 2}px ${w * (1 / DIAMOND_FIT.x - 1) / 2}px`, maxWidth: 'none' })
}

type Box = { x0: number, y0: number, x1: number, y1: number }

/**
 * Round 11, Arrange > Fit to text: the width that puts a node's text on one line, breaking only where the text has a
 * line break; undefined (automatic width) when that fits the usual maximum anyway, or for diamonds, which size themselves.
 * Measured on a hidden copy of the drawn node (selected nodes are always drawn).
 */
function oneLineWidth(container: HTMLElement, id: string): number | undefined {
  const el = container.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"] .flowmap-node`)
  if (!el || el.classList.contains('shape-diamond')) return undefined
  const copy = container.appendChild(el.cloneNode(true) as HTMLElement)
  copy.classList.remove('has-width')
  copy.setCssStyles({ position: 'absolute', visibility: 'hidden', width: 'auto', maxWidth: 'none' })
  for (const t of copy.querySelectorAll<HTMLElement>('.flowmap-node-text, .flowmap-node-link')) t.setCssStyles({ whiteSpace: 'pre' })
  const width = Math.ceil(copy.getBoundingClientRect().width), max = parseFloat(getComputedStyle(copy).getPropertyValue('--flowmap-node-max'))
  copy.remove()
  return width > max ? width : undefined
}

/** Round 10 (Canvas): the box around everything selected once two or more things are (board coordinates, padded), or
 *  null. It follows a rectangle select as it grows. */
function selectionBounds(nodes: TaskFlowNode[], edges: ReadonlySet<string>, ends: Map<string, [Point, Point]>, sizeOf: (id: string) => Size): Box | null {
  const picked = nodes.filter(n => n.selected)
  if (picked.length + edges.size < 2) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x: number, y: number, w = 0, h = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h) }
  for (const n of picked) { const s = sizeOf(n.id); add(n.position.x, n.position.y, s.width, s.height) }
  for (const id of edges) for (const p of ends.get(id) ?? []) add(p.x, p.y)
  if (x0 === Infinity) return null
  const PAD = 8
  return { x0: x0 - PAD, y0: y0 - PAD, x1: x1 + PAD, y1: y1 + PAD }
}

/** Drawn faint, behind the nodes; each node keeps its own highlight. It never takes clicks itself: a press inside it
 *  on empty space is caught by the canvas (round 11), so nodes and Shift + rectangle inside it still work. */
function SelectionBox({ box }: { box: Box }) {
  return (
    <ViewportPortal>
      <div className="flowmap-selection-box" style={{ transform: `translate(${box.x0}px, ${box.y0}px)`, width: box.x1 - box.x0, height: box.y1 - box.y0 }} />
    </ViewportPortal>
  )
}

/**
 * Round 11 (Blender-style): the keys and mouse moves that fit what is selected now, along the bottom while the board
 * has focus (styles.css shows it on :focus-within). Board keys show the user's own bindings.
 */
function ShortcutHints({ keymap, editing, nodes, lines, wheelZoom }: { keymap: Keymap, editing: boolean, nodes: number, lines: number, wheelZoom: boolean }) {
  const k = (a: Action) => keymap[a][0] ? keyLabel(keymap[a][0]) : ''
  const mod = keyLabel('Mod')
  // One line: the few moves that aren't obvious for this selection (styles.css never wraps it).
  const rows: [string, string][] = editing ? [
    ['Enter', 'finish'], ['Shift+Enter', 'new line'], ['Tab', 'add child'], ['[[', 'link a note'],
  ] : nodes === 1 ? [
    [k('addChild'), 'child'], [k('addSibling'), 'sibling'], [k('editNode'), 'edit'], [k('deleteKeepChildren'), 'delete, keep children'], [`${mod}+drag`, 'move node alone'], ['Alt+drag', 'duplicate'],
  ] : nodes > 1 ? [
    ['Drag inside box', 'move all'], [`${mod}+drag`, 'without children'], ['Shift+click', 'add or remove'], [k('tidy'), 'tidy'],
  ] : lines ? [
    ['Double-click', 'label'], [k('addChild'), 'insert node'], ['Drag start end', 'reparent'], [k('delete'), 'delete'],
  ] : [
    ['Shift+drag', 'add to selection'], ['Double-click', 'new node'], ['Space+drag', 'pan'], ['Wheel', wheelZoom ? 'zoom' : 'pan'],
  ]
  return (
    <Panel position="bottom-left" className="flowmap-hints">
      {rows.filter(([key]) => key.trim()).map(([key, what]) => <span key={what}><kbd>{key}</kbd> {what}</span>)}
    </Panel>
  )
}

/** Path from the root to the selected node (F9). Clicking a step selects that node. */
function Breadcrumb({ board, selected, onPick }: { board: Board, selected: TaskFlowNode[], onPick: (id: string) => void }) {
  if (selected.length !== 1) return null
  const id = selected[0].id
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const path = [...ancestors(board.nodes, id).reverse(), id].filter(p => byId.has(p))
  if (path.length < 2) return null
  return (
    <Panel position="top-left" className="flowmap-breadcrumb">
      {path.map((p, i) => (
        <span key={p}>
          {i > 0 && <span className="flowmap-breadcrumb-sep">›</span>}
          <button onClick={() => onPick(p)} aria-label={byId.get(p)!.text}>{byId.get(p)!.text.split('\n')[0] || '(empty)'}</button>
        </span>
      ))}
    </Panel>
  )
}

const pointOf = (event: MouseEvent | TouchEvent) => 'changedTouches' in event ? event.changedTouches[0] : event
const nodeIdIn = (elements: Element[]) => elements.find(el => el.classList.contains('react-flow__node'))?.getAttribute('data-id') ?? undefined
const siblingsOf = (board: Board, id: string) => {
  const parent = board.nodes.find(n => n.id === id)?.parent ?? null
  return board.nodes.filter(n => n.parent === parent).map(n => n.id)
}

const nodeTypes = { task: TaskNode }

// React Flow ends lines at the outer edge of the 10px handle, which sits across the outline; the line starts from the
// handle's centre instead, so it touches the node.
const HALF_HANDLE = 10.5 // see .react-flow__handle in styles.css
const SIDE: Record<Position, Side> = { left: 'l', right: 'r', top: 't', bottom: 'b' }
const INWARD: Record<Position, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] }

type EdgeData = { look: LineLook, routing: Routing, trunk?: number, mids: Map<string, Point>, ends: Map<string, [Point, Point]> }

/** F4, F5, F17 (D31): one line with its routing, dash, width, arrowheads and label. Selected: thicker, with a glow under it. */
const TaskEdge = memo(function TaskEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<EdgeData, 'task'>>) {
  const { look, routing, trunk, mids, ends } = data!
  const [sx, sy] = INWARD[sourcePosition], [tx, ty] = INWARD[targetPosition]
  const p1 = { x: sourceX + sx * HALF_HANDLE, y: sourceY + sy * HALF_HANDLE }, p2 = { x: targetX + tx * HALF_HANDLE, y: targetY + ty * HALF_HANDLE }
  const width = look.width + (selected ? 1 : 0)
  const atEnd = look.direction === 'end' || look.direction === 'both', atStart = look.direction === 'start' || look.direction === 'both'
  const cut = HEAD_LENGTH[look.arrow] * arrowScale(width)
  const g = linePath(routing, p1, SIDE[sourcePosition], p2, SIDE[targetPosition], atStart ? cut : 0, atEnd ? cut : 0, trunk)
  mids.set(id, g.mid)
  ends.set(id, [p1, p2])
  const dash = dashArray(look.dash, width)
  // Round 6: marching ants are a moving dash (whatever the line's own dash); dots run along the line, toward its arrow.
  const ants = look.animate === 'ants', back = look.direction === 'start'
  const antsDash = `${width * 3 + 3} ${width * 2 + 4}`
  const dots = look.animate === 'dots' ? Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 120)) : 0
  const dotDur = Math.max(1.2, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 90)
  const head = (at: LineEnd) => {
    const a = ARROW_PATHS[look.arrow]
    return <path d={a.d} transform={arrowTransform(at, width)} className={`flowmap-head is-${a.kind}`} style={{ ['--tm-line' as string]: look.color, strokeWidth: a.kind === 'stroke' ? width : 1.5 }} />
  }
  return (
    <>
      {selected && <path d={g.d} className="flowmap-halo" style={{ strokeWidth: width + 10 }} />}
      <BaseEdge path={g.d} interactionWidth={16} label={look.label} labelX={g.mid.x} labelY={g.mid.y} labelShowBg labelBgPadding={[6, 3]} labelBgBorderRadius={4}
        labelStyle={{ fill: 'var(--text-normal)', fontSize: 12 }} labelBgStyle={{ fill: 'var(--background-primary)' }}
        className={ants ? 'flowmap-ants' + (back ? ' is-back' : '') : undefined}
        style={{ stroke: look.color, strokeWidth: `var(--tm-busy-width, ${width}px)`, strokeDasharray: ants ? antsDash : dash.dasharray, strokeLinecap: ants ? 'butt' : dash.linecap, ['--tm-ants' as string]: `${width * 5 + 7}px` }} />
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} className="flowmap-flow-dot" r={width / 2 + 2} style={{ fill: look.color }}>
          <animateMotion dur={`${dotDur}s`} begin={`${-i * dotDur / dots}s`} repeatCount="indefinite" path={g.d} keyPoints={back ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
        </circle>
      ))}
      {atEnd && head(g.end)}
      {atStart && head(g.start)}
    </>
  )
})

const edgeTypes = { task: TaskEdge }

/**
 * M4b styling surfaces, in screen space over the board so they don't scale with zoom: the node palette over the selected
 * nodes, the connector palette at the selected line's middle, the line label editor, Board style and the canvas controls.
 * Its own component, so following the viewport re-renders only this, not the whole canvas.
 */
function StyleOverlay({ board, styles, nodes, selectedEdges, flyout, setFlyout, boardBar, setBoardBar, hidden, labelEdit, setLabelEdit, mids, sizeOf, store, snap, onSnap, onFit, onFocus, onNote, onArrange, onTasks, setSelectedEdges, recentFonts, onFontUsed, tools }: {
  board: Board, styles: ReturnType<typeof resolveStyles>, nodes: TaskFlowNode[], selectedEdges: ReadonlySet<string>,
  flyout: string | null, setFlyout: (f: string | null) => void, boardBar: boolean, setBoardBar: (on: boolean) => void, hidden: boolean,
  labelEdit: string | null, setLabelEdit: (id: string | null) => void, mids: Map<string, Point>, sizeOf: (id: string) => Size, store: BoardStore,
  snap: boolean, onSnap: () => void, onFit: () => void, onFocus: () => void, onNote: (action: NoteAction) => void, onArrange: (how: Arrange) => void, onTasks: (ids: string[]) => void
  setSelectedEdges: (ids: ReadonlySet<string>) => void, recentFonts: string[], onFontUsed: (font: string) => void, tools: ViewTools,
}) {
  const [tx, ty, zoom] = useStore(s => s.transform)
  const canvasW = useStore(s => s.width)
  const rf = useReactFlow()
  const dispatch = useCallback((c: Command, merge?: boolean) => store.dispatch(c, merge), [store])
  const screen = (p: Point) => ({ x: p.x * zoom + tx, y: p.y * zoom + ty })
  const ids = nodes.filter(n => n.selected).map(n => n.id)
  const lines: LineRef[] = [...selectedEdges].map(e => ({ kind: e.startsWith('l-') ? 'link' as const : 'edge' as const, id: e.slice(2) }))
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const linkById = new Map(board.links.map(l => [l.id, l]))

  let palette: React.ReactNode = null
  if (!hidden && ids.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const id of ids) {
      const n = byId.get(id), s = sizeOf(id)
      if (!n) continue
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.width); y1 = Math.max(y1, n.y + s.height)
    }
    const a = screen({ x: x0, y: y0 }), b = screen({ x: x1, y: y1 })
    if (x0 !== Infinity) palette = <NodePalette at={nodeBarPlacement({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, canvasW)} ids={ids} board={board}
      strokes={new Map(ids.map(id => [id, styles.nodes.get(id)?.stroke ?? '']))} fills={new Map(ids.map(id => [id, styles.nodes.get(id)?.fill]))}
      autos={styles.autos} flyout={flyout} setFlyout={setFlyout} dispatch={dispatch} onNote={onNote} onArrange={onArrange} onTasks={onTasks} />
  } else if (!hidden && lines.length && !labelEdit) {
    const mid = mids.get([...selectedEdges][0])
    const looks = lines.map(l => {
      const look = (l.kind === 'edge' ? styles.edges : styles.links).get(l.id)
      const raw = l.kind === 'edge' ? byId.get(l.id)?.edgeColor : linkById.get(l.id)?.color
      // Auto: a parent line takes its child's outline, a link is muted.
      const autoColor = l.kind === 'edge' ? styles.nodes.get(l.id)?.stroke ?? '' : 'var(--text-muted)'
      return look && { ...look, rawColor: raw, autoColor }
    }).filter(l => !!l)
    if (mid && looks.length) palette = <ConnectorPalette at={lineBarPlacement(screen(mid), canvasW)} lines={lines} looks={looks} board={board}
      flyout={flyout} setFlyout={setFlyout} dispatch={dispatch} onLabel={() => setLabelEdit([...selectedEdges][0])} onKind={kind => {
        // D37: turn every selected line into this kind. A link that would make a node its own ancestor stays a link.
        const change = lines.filter(l => l.kind !== kind)
        const taken = new Set(board.links.map(l => l.id)), fresh = change.map(() => { const id = newId(taken); taken.add(id); return id })
        const ends = new Map(board.links.map(l => [l.id, l.to]))
        dispatch(kind === 'edge' ? makeChild(change.map(l => l.id)) : makeLink(change.map(l => l.id), fresh))
        const now = new Set(store.board.links.map(l => l.id))
        setSelectedEdges(new Set(lines.map(l => {
          if (l.kind === kind) return `${l.kind === 'edge' ? 'e' : 'l'}-${l.id}`
          if (kind === 'link') return `l-${fresh[change.indexOf(l)]}`
          return now.has(l.id) ? `l-${l.id}` : `e-${ends.get(l.id)}`
        })))
      }} />
  }

  // F17: the label editor sits on the line's middle; Enter or leaving it saves, Esc cancels.
  let editor: React.ReactNode = null
  const editMid = labelEdit && mids.get(labelEdit)
  if (labelEdit && editMid) {
    const ref: LineRef = { kind: labelEdit.startsWith('l-') ? 'link' : 'edge', id: labelEdit.slice(2) }
    const current = (ref.kind === 'edge' ? styles.edges : styles.links).get(ref.id)?.label ?? ''
    const p = screen(editMid)
    const save = (text: string) => { setLabelEdit(null); dispatch(styleLines([ref], { label: text.trim() || undefined })) }
    editor = (
      <input className="flowmap-label-editor" style={{ left: p.x, top: p.y }} defaultValue={current} placeholder="Label" ref={el => el?.focus()}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { e.currentTarget.dataset.cancel = '1'; e.currentTarget.blur() }
        }}
        onBlur={e => { if (e.currentTarget.dataset.cancel) setLabelEdit(null); else save(e.currentTarget.value) }} />
    )
  }

  return (
    <div className="flowmap-overlay">
      {palette}
      {editor}
      {boardBar && <BoardStyleBar board={board} flyout={flyout} setFlyout={setFlyout} dispatch={dispatch} recentFonts={recentFonts} onFontUsed={onFontUsed} onTidyBoard={() => tools.onTidyBoard(true)} />}
      <CanvasControls zoom={zoom} boardOpen={boardBar} snap={snap} canFocus={ids.length > 0 || lines.length > 0}
        onBoardStyle={() => { setFlyout(null); setBoardBar(!boardBar) }}
        onZoomIn={() => void rf.zoomIn({ duration: 250 })} onZoomOut={() => void rf.zoomOut({ duration: 250 })}
        onZoomReset={() => void rf.zoomTo(1, { duration: 250 })} onFit={onFit} onFocus={onFocus} onSnap={onSnap} tools={tools} />
    </div>
  )
}

// React Flow keeps a new node hidden until it has been measured, and hidden elements can't take
// focus, so autoFocus would miss. Retry for a few frames.
function focusWhenVisible(el: HTMLTextAreaElement | null) {
  let tries = 0
  const attempt = () => {
    if (!el?.isConnected) return
    el.focus({ preventScroll: true })
    if (document.activeElement !== el && tries++ < 10) window.requestAnimationFrame(attempt)
  }
  attempt()
}

/**
 * D9 / Spike C: sizes for tidy. React Flow never measures nodes culled by onlyRenderVisibleElements,
 * so every node is rendered once into a hidden box with the same classes, then read in one pass.
 * Only the text is laid out per node: the checkbox and progress label have fixed widths, measured once
 * and taken off the width the text may use, then added back. That keeps the pass as cheap as plain text
 * (a full row per node made tidy about 40 ms slower at 2,000 nodes).
 */
function measureSizes(container: HTMLElement, nodes: BoardNode[], counts: ReadonlyMap<string, Counts>, looks: Map<string, NodeLook>): Map<string, Size> {
  const box = container.createDiv()
  box.className = 'flowmap-measure'
  const label = (n: BoardNode) => { const c = counts.get(n.id); return c ? progress(c.done, c.tasks) : '' }
  const sample = box.createDiv().createDiv()
  sample.className = 'flowmap-node-row'
  const span = (cls: string, text = '') => { const el = sample.createSpan(); el.className = cls; el.textContent = text; return el }
  // Round 13: the node's own checkbox element, margins counted: Obsidian gives task checkboxes a side margin a span
  // didn't have, so text measured 6px roomier than drawn and a node that just wraps measured one line short (overlaps).
  const check = sample.createEl('input')
  check.type = 'checkbox'
  check.className = 'task-list-item-checkbox flowmap-check'
  const labels = new Map([...new Set(nodes.map(label))].filter(Boolean).map(l => [l, span('flowmap-progress', l)]))
  // M7: due chips are measured the same way, one per distinct date.
  const today = dayOf(), chip = (n: BoardNode) => isDue(n.due) ? shortDay(n.due, today) : ''
  const chips = new Map([...new Set(nodes.map(chip))].filter(Boolean).map(c => [c, span('flowmap-due', c)]))
  const gap = parseFloat(getComputedStyle(sample).columnGap) || 0
  const widths = new Map([...labels].map(([l, el]) => [l, el.offsetWidth + gap]))
  const chipWidths = new Map([...chips].map(([c, el]) => [c, el.offsetWidth + gap]))
  const checkStyle = getComputedStyle(check)
  const checkWidth = check.offsetWidth + parseFloat(checkStyle.marginLeft) + parseFloat(checkStyle.marginRight) + gap
  const extra = nodes.map(n => (n.status ? checkWidth : 0) + (widths.get(label(n)) ?? 0) + (chipWidths.get(chip(n)) ?? 0))
  // M6: most nodes are one line of plain text in a plain shape. Those are sized with canvas measureText, with no layout:
  // one sample node per shape gives its padding and border, height and width limits (laying out 5,000 hidden nodes
  // took about 300 ms). The rest (wrapping or several lines, fixed widths, links, circles, diamonds) are laid out below.
  const ctx = createEl('canvas').getContext('2d')!
  const SAMPLE = 'Sample text'
  const shapes = new Map<string, { font: string, chrome: number, height: number, min: number, max: number }>()
  const shapeSample = (shape: Shape) => {
    let m = shapes.get(shape)
    if (m) return m
    const el = box.createDiv()
    el.className = nodeClass({ id: '', parent: null, order: 0, text: '', x: 0, y: 0 }, shape)
    const text = el.createDiv()
    text.className = 'flowmap-node-text'
    text.textContent = SAMPLE
    ctx.font = getComputedStyle(text).font
    const cs = getComputedStyle(el)
    m = { font: ctx.font, chrome: el.getBoundingClientRect().width - ctx.measureText(SAMPLE).width, height: el.offsetHeight, min: parseFloat(cs.minWidth), max: parseFloat(cs.maxWidth) }
    shapes.set(shape, m)
    el.remove()
    return m
  }
  const sizes = new Map<string, Size>()
  const slow: number[] = []
  nodes.forEach((n, i) => {
    const shape = looks.get(n.id)?.shape ?? 'round', text = n.text.includes('[[') ? displayText(n.text) : n.text
    if (shape === 'circle' || shape === 'diamond' || shape === 'label' || n.width || n.link || !text || text.includes('\n') || hasTag(n.text)) return void slow.push(i)
    const m = shapeSample(shape)
    ctx.font = m.font
    const width = ctx.measureText(text).width + m.chrome
    if (width > m.max - extra[i]) return void slow.push(i) // it wraps
    sizes.set(n.id, { width: Math.round(Math.max(m.min - extra[i], width)) + extra[i], height: m.height })
  })
  const els = slow.map(i => {
    const n = nodes[i]
    const el = box.createDiv()
    el.className = nodeClass(n, looks.get(n.id)?.shape ?? 'round')
    // The checkbox, chip and progress take room from the text (see .flowmap-measure in styles.css).
    el.setCssProps({ '--flowmap-narrow': `${extra[i]}px` })
    if (looks.get(n.id)?.shape === 'diamond') el.setCssStyles({ padding: '0' }) // sized from its content, as fitDiamond does
    const labelSize = looks.get(n.id)?.size
    if (labelSize) el.setCssProps({ '--tm-size': `${labelSize}px` })
    if (n.width) el.setCssStyles({ width: `${(looks.get(n.id)?.shape === 'diamond' ? n.width * DIAMOND_FIT.x : n.width) - extra[i]}px` })
    const text = el.createDiv()
    text.className = 'flowmap-node-text'
    // A tag pill has padding and a smaller font, so a node with tags is laid out with real pills (else it measures a line short).
    if (hasTag(n.text)) for (const p of textParts(n.text)) {
      if (typeof p === 'string') text.appendText(p)
      else text.createSpan({ cls: 'tag' in p ? 'flowmap-tag' : undefined, text: p.label })
    } else text.textContent = (n.text.includes('[[') ? displayText(n.text) : n.text) || '\u00a0'
    // ponytail: the link line is narrowed with the text; a link wider than text plus extras is slightly underestimated.
    if (n.link) {
      const link = el.createDiv()
      link.className = 'flowmap-node-link'
      link.textContent = `↗ ${basename(n.link)}`
    }
    return el
  })
  slow.forEach((i, k) => {
    const n = nodes[i], width = els[k].offsetWidth + extra[i], height = els[k].offsetHeight
    sizes.set(n.id, looks.get(n.id)?.shape === 'diamond' ? { width: n.width ?? width / DIAMOND_FIT.x, height: height / DIAMOND_FIT.y } : { width, height })
  })
  box.remove()
  return sizes
}

/** Spike A: pans and zooms for two seconds and reports the frame rate. */
function measurePanZoom(rf: ReactFlowInstance<TaskFlowNode>, container: HTMLElement, start: { x: number, y: number, zoom: number }) {
  const frames: number[] = []
  return new Promise<PanZoomResult>(resolve => {
    let t0 = 0, last = 0, mounted = 0
    const step = (t: number) => {
      if (!t0) t0 = t
      else frames.push(t - last)
      last = t
      const k = (t - t0) / 2000
      void rf.setViewport({ x: start.x + Math.sin(k * 2 * Math.PI) * 600, y: start.y + Math.sin(k * 4 * Math.PI) * 300, zoom: start.zoom * (1 + 0.3 * Math.sin(k * 2 * Math.PI)) })
      mounted = Math.max(mounted, container.querySelectorAll('.react-flow__node').length)
      if (t - t0 < 2000) return void window.requestAnimationFrame(step)
      const sorted = [...frames].sort((a, b) => a - b)
      resolve({
        fps: Math.round(frames.length / ((t - t0) / 1000)),
        p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
        mountedNodes: mounted,
      })
    }
    void rf.setViewport(start)
    window.requestAnimationFrame(step)
  })
}
