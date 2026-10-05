// D13 / D28 / D36 style resolution: an override on the node or line, else "auto", which inherits the parent's resolved
// value, for outline and fill separately. An auto root's outline is the text color and its children take palette colors
// in turn; a root's auto fill is none. Board-wide values come from the board style, else the default.
// Pure: the UI turns the result into CSS. Only values that pass the checks here ever reach CSS, so a hand-edited file
// can't smuggle url() or other CSS into the page (no network, PRD security).

import { ARROWS, DASHES, edgeWidth, MAX_CUSTOM, ROUTINGS, SHAPES, type Arrow, type Dash, type Routing, type Shape } from './geometry.ts'
import type { Board, CrossLink } from './schema.ts'
import { childrenMap } from './tree.ts'

/** The 8 fixed presets (handoff palette.json), on Obsidian's color variables so they follow the theme; M6b (round 5):
 *  green, cyan and pink are fixed, more saturated tones. */
export const PRESETS = ['blue', 'red', 'orange', 'yellow', '#22b470', '#14a5b8', 'purple', '#e82c90'].map(c => c[0] === '#' ? c : `var(--color-${c})`)
/** Children of a root take presets in this order, far-apart hues first (handoff: 0, 2, 4, …). */
const BRANCH_ORDER = [0, 2, 4, 6, 1, 3, 5, 7]
export const DIRECTIONS = ['none', 'end', 'start', 'both'] as const
export type Direction = typeof DIRECTIONS[number]
export const FONTS: Record<string, string> = { interface: 'var(--font-interface)', text: 'var(--font-text)', mono: 'var(--font-monospace)' }

export interface BoardStyle {
  routing: Routing
  /** Width of lines into children of a root, 1 to 8. */
  maxWidth: number
  /** Thin deeper lines down to 1px at the deepest level. */
  taper: boolean
  /** Fill tint opacity, 5 to 40 (%). Fills are always tints (D28). */
  fillOpacity: number
  /** A key of FONTS, or installed font names. */
  font: string
  /** "ink", "muted", "node" (each label in its node's outline color, M6b) or a color ref. */
  textColor: string | number
  /** Round 12: every node but labels is drawn filled with its own outline color, whatever its stored fill. */
  fillOutline: boolean
  /** Up to 8 hex colors, newest first, shared by every color picker on the board. */
  customColors: string[]
  /** Round 8: a node added from another re-tidies its tree. */
  autoTidy: boolean
}

export const BOARD_DEFAULTS: BoardStyle = { routing: 'curved', maxWidth: 4, taper: true, fillOpacity: 16, font: 'interface', textColor: 'ink', fillOutline: false, customColors: [], autoTidy: false }
/** Theme keys Reset clears (the layout direction stays). */
export const BOARD_STYLE_KEYS = Object.keys(BOARD_DEFAULTS)

const HEX = /^#[0-9a-f]{6}$/i
const isPreset = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < PRESETS.length
/** A stored color: a preset index or a custom hex. ("auto" and null are handled by the callers.) */
export const isColor = (v: unknown): v is number | string => isPreset(v) || (typeof v === 'string' && HEX.test(v))
export const cssColor = (v: number | string) => typeof v === 'number' ? PRESETS[v] : v
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T)
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && v >= lo && v <= hi
const isFont = (v: unknown): v is string => typeof v === 'string' && (v in FONTS || /^[\w\s,'"-]{1,100}$/.test(v))

/** The board style with every missing or invalid value replaced by its default. */
export function boardStyle(board: Pick<Board, 'theme'>): BoardStyle {
  const t = board.theme, d = BOARD_DEFAULTS
  return {
    routing: oneOf(ROUTINGS, t.routing) ? t.routing : d.routing,
    maxWidth: inRange(t.maxWidth, 1, 8) ? t.maxWidth : d.maxWidth,
    taper: typeof t.taper === 'boolean' ? t.taper : d.taper,
    fillOpacity: inRange(t.fillOpacity, 5, 40) ? t.fillOpacity : d.fillOpacity,
    font: isFont(t.font) ? t.font : d.font,
    textColor: t.textColor === 'ink' || t.textColor === 'muted' || t.textColor === 'node' || isColor(t.textColor) ? t.textColor : d.textColor,
    fillOutline: typeof t.fillOutline === 'boolean' ? t.fillOutline : d.fillOutline,
    autoTidy: typeof t.autoTidy === 'boolean' ? t.autoTidy : d.autoTidy,
    customColors: Array.isArray(t.customColors) ? t.customColors.filter(c => typeof c === 'string' && HEX.test(c)).slice(0, MAX_CUSTOM) : d.customColors,
  }
}

export const cssFont = (font: string) => FONTS[font] ?? font

/** D40: the custom color picker works in HSL (h 0-360, s and l 0-100); colors are stored as hex. */
export function hslToHex(h: number, s: number, l: number): string {
  const a = s / 100 * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}
/** "node" is drawn per node (styles.css), so the board-wide value is the ink color. */
export const cssTextColor = (c: string | number) => c === 'ink' || c === 'node' ? 'var(--text-normal)' : c === 'muted' ? 'var(--text-muted)' : cssColor(c)

/** `size` is a label's text size (round 6, N3). */
export type NodeLook = { shape: Shape, stroke: string, fill?: string, size?: number }

/** Round 6 (N3): label text sizes, stepped by the node palette's A− and A+. A stored size in between is kept. */
export const LABEL_SIZES = [16, 20, 24, 28, 36, 48, 64, 80, 96]
export const LABEL_SIZE = 28
export const labelSize = (v: unknown) => inRange(v, 8, 200) ? v : LABEL_SIZE
export type LineLook = { dash: Dash, arrow: Arrow, direction: Direction, color: string, width: number, label?: string, animate: Animate }
/** Round 6: a line can move: marching ants, or dots running along it (in its arrow's direction). */
export const ANIMATES = ['none', 'ants', 'dots'] as const
export type Animate = typeof ANIMATES[number]

// Stored per node: shape, stroke, fill; and for the line into it from its parent: edgeDash, edgeArrow, edgeDirection,
// edgeColor, edgeLabel. Cross-links store dash, arrow, direction, color, label on the link.
const line = (o: Record<string, unknown>, keys: string[], defaults: Omit<LineLook, 'color' | 'width' | 'label' | 'animate'>, auto: string, width: number): LineLook => {
  const [dash, arrow, direction, color, label, animate] = keys.map(k => o[k])
  return {
    animate: oneOf(ANIMATES, animate) ? animate : 'none',
    dash: oneOf(DASHES, dash) ? dash : defaults.dash,
    arrow: oneOf(ARROWS, arrow) ? arrow : defaults.arrow,
    direction: oneOf(DIRECTIONS, direction) ? direction : defaults.direction,
    color: isColor(color) ? cssColor(color) : auto,
    width,
    ...typeof label === 'string' && label.trim() ? { label } : {},
  }
}

const EDGE_KEYS = ['edgeDash', 'edgeArrow', 'edgeDirection', 'edgeColor', 'edgeLabel', 'edgeAnimate']
const LINK_KEYS = ['dash', 'arrow', 'direction', 'color', 'label', 'animate']
const PARENT_LINE = { dash: 'solid', arrow: 'triangle', direction: 'end' } as const
/** Cross-links (like "depends on") default to dashed with a chevron head (handoff). */
const CROSS_LINK = { dash: 'dashed', arrow: 'chevron', direction: 'end' } as const

/** A stored fill (M6b) or an auto fill passed down: fill with the node's own outline color. */
export const MATCH_OUTLINE = 'outline'

/** Looks for every node, the parent line into every non-root node (keyed by the child id) and every cross-link, plus what
 *  auto would give each node's outline and fill (the palette's Auto swatch). */
export function resolveStyles(board: Board): {
  style: BoardStyle, nodes: Map<string, NodeLook>, edges: Map<string, LineLook>, links: Map<string, LineLook>, autos: Map<string, { stroke: string, fill?: string }>,
} {
  const style = boardStyle(board)
  const children = childrenMap(board.nodes)
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const nodes = new Map<string, NodeLook>()
  const autos = new Map<string, { stroke: string, fill?: string }>()
  const depth = new Map<string, number>()
  // Parents before children: [id, depth, what an auto outline and an auto fill resolve to here]. An auto fill of
  // MATCH_OUTLINE takes each node's own outline, and passes that rule down rather than the color.
  const stack: [string, number, string, string | undefined][] = (children.get(null) ?? []).map(n => [n.id, 0, 'var(--text-normal)', undefined])
  let maxDepth = 0
  while (stack.length) {
    const [id, d, autoStroke, autoFill] = stack.pop()!
    const n = byId.get(id)!
    const stroke = isColor(n.stroke) ? cssColor(n.stroke) : autoStroke
    // Fill: unset or "auto" inherits, null is none (and passes none down), MATCH_OUTLINE is the outline, else a color.
    const fillRule = n.fill === null ? undefined : n.fill === MATCH_OUTLINE ? MATCH_OUTLINE : isColor(n.fill) ? cssColor(n.fill) : autoFill
    const shape = oneOf(SHAPES, n.shape) ? n.shape : 'round'
    // Round 12: the Board style toggle fills every node but labels with its outline, over picked fills and None. It is
    // drawn only, so turning it off brings the stored fills back.
    const fill = fillRule === MATCH_OUTLINE || (style.fillOutline && shape !== 'label') ? stroke : fillRule
    nodes.set(id, { shape, stroke, ...fill ? { fill } : {}, ...shape === 'label' ? { size: labelSize(n.textSize) } : {} })
    const autoFillCss = autoFill === MATCH_OUTLINE ? stroke : autoFill
    autos.set(id, { stroke: autoStroke, ...autoFillCss ? { fill: autoFillCss } : {} })
    depth.set(id, d)
    maxDepth = Math.max(maxDepth, d)
    // Only an auto root hands out palette colors; a picked root color flows down like any other.
    const branches = d === 0 && !isColor(n.stroke)
    ;(children.get(id) ?? []).forEach((c, i) => stack.push([c.id, d + 1, branches ? PRESETS[BRANCH_ORDER[i % PRESETS.length]] : stroke, fillRule]))
  }
  const edges = new Map<string, LineLook>()
  for (const n of board.nodes) if (n.parent !== null && nodes.has(n.id))
    edges.set(n.id, line(n, EDGE_KEYS, PARENT_LINE, nodes.get(n.id)!.stroke, edgeWidth(depth.get(n.id)!, maxDepth, style.maxWidth, style.taper)))
  const links = new Map<string, LineLook>(board.links.map((l: CrossLink) => [l.id, line(l, LINK_KEYS, CROSS_LINK, 'var(--text-muted)', 1.5)]))
  return { style, nodes, edges, links, autos }
}
