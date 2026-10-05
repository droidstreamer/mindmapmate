// Shape outlines, line routing and arrowheads (M4b). Ported from the design handoff's `reference/geometry.ts`,
// generalised from "parent's right to child's left" to lines leaving and entering any side (D12).

import type { Side } from './navigate.ts'

export type Pt = { x: number, y: number }
export const SHAPES = ['rect', 'round', 'pill', 'para', 'circle', 'diamond', 'hex', 'text', 'none', 'doc', 'predef', 'cyl', 'label'] as const
export type Shape = typeof SHAPES[number]
// Round 11: square is angular with every parent line from one side of a parent turning at the same place (see `trunks` in navigate.ts).
export const ROUTINGS = ['straight', 'curved', 'angular', 'square'] as const
export type Routing = typeof ROUTINGS[number]
export const DASHES = ['solid', 'dotted', 'dashed'] as const
export type Dash = typeof DASHES[number]
export const ARROWS = ['triangle', 'triangleOpen', 'chevron', 'diamond', 'diamondOpen', 'dot', 'dotOpen', 'bar'] as const
export type Arrow = typeof ARROWS[number]

/** Thinnest line, fixed (D28). */
export const MIN_WIDTH = 1
export const MAX_CUSTOM = 8

/** Outline path for a node drawn at its real size (0,0 to w,h; some shapes reach outside that box). */
export function nodePath(k: Shape, w: number, h: number): string {
  const r = h / 2
  switch (k) {
    case 'rect': return `M0 0H${w}V${h}H0Z`
    case 'round': return `M6 0H${w - 6}A6 6 0 0 1 ${w} 6V${h - 6}A6 6 0 0 1 ${w - 6} ${h}H6A6 6 0 0 1 0 ${h - 6}V6A6 6 0 0 1 6 0Z`
    case 'pill': return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 ${r} 0Z`
    case 'circle': return `M0 ${r}A${r} ${r} 0 1 0 ${h} ${r}A${r} ${r} 0 1 0 0 ${r}Z`
    // M5b: a true diamond on the box's side midpoints; the box is sized so the text fits inside it (DIAMOND_FIT).
    case 'diamond': return `M0 ${r}L${w / 2} 0L${w} ${r}L${w / 2} ${h}Z`
    case 'hex': return `M${r * 0.6} 0H${w - r * 0.6}L${w + r * 0.4} ${r}L${w - r * 0.6} ${h}H${r * 0.6}L-${r * 0.4} ${r}Z`
    case 'para': return `M${h * 0.35} 0H${w + h * 0.2}L${w - h * 0.35} ${h}H-${h * 0.2}Z`
    case 'text': return `M0 ${h}H${w}`
    // M5c: nothing is drawn; the box is kept for the selection glow (CSS hides the outline).
    case 'none': case 'label': return `M0 0H${w}V${h}H0Z`
    // M6b flowchart shapes. Document: a wavy bottom through the bottom middle, so lines still meet it there.
    case 'doc': return `M0 0H${w}V${h}C${w * 0.65} ${h - r * 0.5} ${w * 0.35} ${h + r * 0.5} 0 ${h}Z`
    // Predefined process: a rectangle with an inner line near each side.
    case 'predef': return `M0 0H${w}V${h}H0ZM8 0V${h}M${w - 8} 0V${h}`
    // Cylinder (database): the top ellipse's front edge is drawn across the body.
    case 'cyl': return `M0 ${CYL_RY}A${w / 2} ${CYL_RY} 0 0 1 ${w} ${CYL_RY}V${h - CYL_RY}A${w / 2} ${CYL_RY} 0 0 1 0 ${h - CYL_RY}ZM0 ${CYL_RY}A${w / 2} ${CYL_RY} 0 0 0 ${w} ${CYL_RY}`
  }
}

/** A cylinder's end ellipses are this tall (half); its padding in styles.css leaves room for the top one. */
const CYL_RY = 7

/** How far the outline reaches past the box at the middle of each side: `x` on the left and right, `y` on the top and
 *  bottom (negative: inside the box). Lines attach there. A parallelogram's slanted sides cross the middle 0.075h inside. */
export function overhang(k: Shape, h: number): Pt {
  return { x: k === 'hex' ? h * 0.2 : k === 'para' ? -h * 0.075 : 0, y: 0 }
}

/** A diamond's content takes this share of its box's width and height. The content's corners touch the outline when
 *  x + y = 1; 0.85 leaves a margin. */
export const DIAMOND_FIT = { x: 0.6, y: 0.25 }

// Outward unit normal of each side.
const NORMAL: Record<Side, Pt> = { t: { x: 0, y: -1 }, r: { x: 1, y: 0 }, b: { x: 0, y: 1 }, l: { x: -1, y: 0 } }

/** Head length along the line, for heads the line must stop short of. Open heads (chevron, bar) let the line run to the tip. */
export const HEAD_LENGTH: Record<Arrow, number> = { triangle: 10, triangleOpen: 10, chevron: 0, diamond: 12, diamondOpen: 12, dot: 9, dotOpen: 9, bar: 0 }
export const arrowScale = (width: number) => 0.55 + width * 0.3

export type LineEnd = Pt & { angle: number }

/**
 * A line from `p1` (on side `s1` of its node) to `p2` (on side `s2`). `cut1` and `cut2` shorten each end so it stops at
 * an arrowhead's base. Returns the path, the tip of each end with the direction a head there should point (degrees,
 * pointing away from the line), and the middle (for labels and the connector palette).
 * D31: straight lines point their heads along the line; curved and angular lines arrive straight along the side's
 * normal, so their heads sit square to the node.
 * `trunk` (square routing): how far out from `p1` the line turns, shared by its siblings; else it turns halfway.
 */
export function linePath(routing: Routing, p1: Pt, s1: Side, p2: Pt, s2: Side, cut1 = 0, cut2 = 0, trunk?: number): { d: string, start: LineEnd, end: LineEnd, mid: Pt } {
  const n1 = NORMAL[s1], n2 = NORMAL[s2]
  const deg = (v: Pt) => Math.atan2(v.y, v.x) * 180 / Math.PI
  if (routing === 'straight') {
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    const u = { x: (p2.x - p1.x) / len, y: (p2.y - p1.y) / len }
    const a = { x: p1.x + u.x * cut1, y: p1.y + u.y * cut1 }, b = { x: p2.x - u.x * cut2, y: p2.y - u.y * cut2 }
    return { d: `M${a.x} ${a.y}L${b.x} ${b.y}`, start: { ...p1, angle: deg(u) + 180 }, end: { ...p2, angle: deg(u) }, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
  }
  const a = { x: p1.x + n1.x * cut1, y: p1.y + n1.y * cut1 }, b = { x: p2.x + n2.x * cut2, y: p2.y + n2.y * cut2 }
  const start = { ...p1, angle: deg({ x: -n1.x, y: -n1.y }) }, end = { ...p2, angle: deg({ x: -n2.x, y: -n2.y }) }
  if (routing === 'curved') {
    // Each end runs out along its normal by half the gap on that axis (at least 24), so it leaves and arrives straight.
    const arm = (n: Pt, from: Pt, to: Pt) => Math.max(24, Math.abs((to.x - from.x) * n.x + (to.y - from.y) * n.y) / 2)
    const k1 = arm(n1, a, b), k2 = arm(n2, b, a)
    const c1 = { x: a.x + n1.x * k1, y: a.y + n1.y * k1 }, c2 = { x: b.x + n2.x * k2, y: b.y + n2.y * k2 }
    const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 }
    return { d: `M${a.x} ${a.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, start, end, mid }
  }
  // Angular: a short stub straight out of each side, then across. The stubs keep the last step running into the node
  // even when the nodes overlap; with room between them they fall on the route anyway.
  const stub = (n: Pt, from: Pt, to: Pt) => { const g = (to.x - from.x) * n.x + (to.y - from.y) * n.y; return g > 0 ? Math.min(12, g / 2) : 12 }
  const k1 = stub(n1, a, b), k2 = stub(n2, b, a)
  const a2 = { x: a.x + n1.x * k1, y: a.y + n1.y * k1 }, b2 = { x: b.x + n2.x * k2, y: b.y + n2.y * k2 }
  const h1 = n1.x !== 0, h2 = n2.x !== 0
  let across: Pt[]
  const bend = s1 !== s2 ? trunk : undefined
  if (h1 && h2) { const mx = bend !== undefined ? p1.x + n1.x * bend : (a2.x + b2.x) / 2; across = [{ x: mx, y: a2.y }, { x: mx, y: b2.y }] }
  else if (!h1 && !h2) { const my = bend !== undefined ? p1.y + n1.y * bend : (a2.y + b2.y) / 2; across = [{ x: a2.x, y: my }, { x: b2.x, y: my }] }
  else across = [h1 ? { x: b2.x, y: a2.y } : { x: a2.x, y: b2.y }]
  const pts = [a, a2, ...across, b2, b]
  const i = Math.floor((pts.length - 1) / 2)
  const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
  return { d: 'M' + pts.map(p => `${p.x} ${p.y}`).join('L'), start, end, mid }
}

/**
 * Round 11: a node resized from its `side` with snap on keeps its other edge and puts the moving one on the grid (at
 * least `min` wide). React Flow steps the width by the grid instead, which leaves the edge off the grid.
 */
export function snapEdge(x: number, width: number, side: 'left' | 'right', grid: number, min: number): { x: number, width: number } {
  const right = x + width
  if (side === 'right') { let r = Math.round(right / grid) * grid; while (r - x < min) r += grid; return { x, width: r - x } }
  let l = Math.round(x / grid) * grid
  while (right - l < min) l -= grid
  return { x: l, width: right - l }
}

export const arrowTransform = (p: LineEnd, width: number) => `translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${arrowScale(width)})`

export function dashArray(dash: Dash, w: number): { dasharray: string, linecap: 'round' | 'butt' } {
  if (dash === 'dotted') return { dasharray: `0.01 ${w * 2 + 3}`, linecap: 'round' }
  if (dash === 'dashed') return { dasharray: `${w * 3 + 9} ${w * 2 + 5}`, linecap: 'butt' }
  return { dasharray: 'none', linecap: 'butt' }
}

/** Line width into a node at `depth` (1 = child of a root): tapers linearly to MIN_WIDTH at the board's deepest level. */
export function edgeWidth(depth: number, maxDepth: number, maxWidth: number, taper: boolean): number {
  if (!taper || maxDepth <= 1) return maxWidth
  return Math.max(MIN_WIDTH, maxWidth - (maxWidth - MIN_WIDTH) * (depth - 1) / (maxDepth - 1))
}

/**
 * Custom colors, newest first. The first change in a picker session inserts at the front (dropping the oldest past
 * MAX_CUSTOM); later changes in the same session update the front slot live.
 */
export function pushCustom(list: string[], hex: string, newSession: boolean): string[] {
  if (newSession) return [hex, ...list.filter(c => c !== hex)].slice(0, MAX_CUSTOM)
  return [hex, ...list.slice(1)]
}

/** Arrowhead paths, pointing +x with the tip at 0,0. `fill`: filled in the line color; `outline`: background fill, line-color
 *  stroke; `stroke`: line-color stroke only. */
export const ARROW_PATHS: Record<Arrow, { d: string, kind: 'fill' | 'outline' | 'stroke', name: string }> = {
  triangle: { d: 'M0 0L-10 -5.5L-10 5.5Z', kind: 'fill', name: 'Triangle' },
  triangleOpen: { d: 'M0 0L-10 -5.5L-10 5.5Z', kind: 'outline', name: 'Open triangle' },
  chevron: { d: 'M-9 -6L0 0L-9 6', kind: 'stroke', name: 'Chevron' },
  diamond: { d: 'M0 0L-6 -4.5L-12 0L-6 4.5Z', kind: 'fill', name: 'Diamond' },
  diamondOpen: { d: 'M0 0L-6 -4.5L-12 0L-6 4.5Z', kind: 'outline', name: 'Open diamond' },
  dot: { d: 'M-9 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0', kind: 'fill', name: 'Dot' },
  dotOpen: { d: 'M-9 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0', kind: 'outline', name: 'Ring' },
  bar: { d: 'M-1 -6V6', kind: 'stroke', name: 'Bar' },
}
