// F16: the board as a standalone SVG image (and PNG, drawn from it). Built from the board data, not the page: only the
// nodes near the view are in the page (D10). It uses the same geometry as the board (shapes, routing, arrowheads) and
// the measured node sizes. Colors and fonts are resolved to real values, since an image file can't read Obsidian's CSS.
// Text is escaped; nothing in the file loads anything.

import { dayOf, dueState, shortDay } from '../core/due.ts'
import { ARROW_PATHS, arrowTransform, dashArray, HEAD_LENGTH, arrowScale, linePath, nodePath, overhang, DIAMOND_FIT, type Pt } from '../core/geometry.ts'
import { displayText } from '../core/links.ts'
import { facing, trunks, type Side } from '../core/navigate.ts'
import type { Board, BoardNode } from '../core/schema.ts'
import type { resolveStyles, LineLook } from '../core/style.ts'
import type { Counts } from '../core/tree.ts'
import type { Size } from '../core/layout/tidy.ts'

export type ImageInput = {
  nodes: BoardNode[], links: Board['links'], styles: ReturnType<typeof resolveStyles>, size(id: string): Size, vertical: boolean
  /** Progress counts from the whole board, so collapsed branches still count (as on the board). */
  counts: ReadonlyMap<string, Counts>
  /** Resolves a CSS color (often a variable) to a real one. */
  color(css: string): string
  font: string, fontSize: number, lineHeight: number, text: string, background: string, accent: string
  /** Round 17: the HTML page's markup: data attributes and classes its script moves, collapses and checks with (see exportHtml.ts). */
  interactive?: boolean
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const PAD_X: Record<string, number> = { pill: 18, circle: 10, predef: 20, label: 6 }
const CENTRED = new Set(['circle', 'diamond', 'hex', 'para', 'predef', 'cyl'])

/** Splits text into lines that fit `width` at the given font (words, then characters for a word too long). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (!line || ctx.measureText(next).width <= width) { line = next; continue }
      lines.push(line.trimEnd())
      line = word.trimStart()
    }
    lines.push(line)
  }
  return lines
}

export function boardSvg(input: ImageInput): { svg: string, width: number, height: number } {
  const { nodes, links, styles, size, vertical, color, counts } = input
  const byId = new Map(nodes.map(n => [n.id, n]))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of nodes) { const s = size(n.id); x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + s.width); y1 = Math.max(y1, n.y + s.height) }
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 1 }
  const M = 40
  const ctx = createEl('canvas').getContext('2d')!
  ctx.font = `${input.fontSize}px ${input.font}`
  const out: string[] = []
  const today = dayOf()

  // Lines first, under the nodes, as on the board.
  const attach = (n: BoardNode, side: Side): Pt => {
    const s = size(n.id), oh = overhang(styles.nodes.get(n.id)?.shape ?? 'round', s.height)
    return side === 'l' ? { x: n.x - oh.x, y: n.y + s.height / 2 } : side === 'r' ? { x: n.x + s.width + oh.x, y: n.y + s.height / 2 }
      : side === 't' ? { x: n.x + s.width / 2, y: n.y - oh.y } : { x: n.x + s.width / 2, y: n.y + s.height + oh.y }
  }
  const trunk = styles.style.routing === 'square' ? trunks(nodes, id => size(id), vertical) : undefined
  const line = (from: BoardNode, to: BoardNode, look: LineLook, t?: number) => {
    if (input.interactive) out.push(`<g class="e" data-a="${esc(from.id)}" data-b="${esc(to.id)}">`)
    const [s1, s2] = facing(from, to, id => size(id), vertical)
    const atEnd = look.direction === 'end' || look.direction === 'both', atStart = look.direction === 'start' || look.direction === 'both'
    const cut = HEAD_LENGTH[look.arrow] * arrowScale(look.width)
    const g = linePath(styles.style.routing, attach(from, s1), s1, attach(to, s2), s2, atStart ? cut : 0, atEnd ? cut : 0, t)
    const c = color(look.color), dash = dashArray(look.dash, look.width)
    out.push(`<path d="${g.d}" fill="none" stroke="${c}" stroke-width="${look.width}" stroke-dasharray="${dash.dasharray}" stroke-linecap="${dash.linecap}"/>`)
    const head = ARROW_PATHS[look.arrow]
    const fill = head.kind === 'fill' ? c : head.kind === 'outline' ? input.background : 'none'
    for (const [on, end] of [[atEnd, g.end], [atStart, g.start]] as const)
      if (on) out.push(`<path d="${head.d}" transform="${arrowTransform(end, look.width)}" fill="${fill}" stroke="${head.kind === 'fill' ? 'none' : c}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`)
    if (look.label) {
      const w = ctx.measureText(look.label).width + 12
      out.push(`<rect x="${g.mid.x - w / 2}" y="${g.mid.y - 11}" width="${w}" height="22" rx="4" fill="${input.background}"/>`,
        `<text x="${g.mid.x}" y="${g.mid.y + 5}" text-anchor="middle" fill="${input.text}" font-size="${input.fontSize - 2}">${esc(look.label)}</text>`)
    }
    if (input.interactive) out.push('</g>')
  }
  for (const n of nodes) if (n.parent !== null && byId.has(n.parent)) line(byId.get(n.parent)!, n, styles.edges.get(n.id)!, trunk?.get(n.id))
  for (const l of links) if (byId.has(l.from) && byId.has(l.to)) line(byId.get(l.from)!, byId.get(l.to)!, styles.links.get(l.id)!)

  // Nodes: outline, fill tint, checkbox, wrapped text, progress.
  for (const n of nodes) {
    const look = styles.nodes.get(n.id)!, s = size(n.id), stroke = color(look.stroke)
    // M6b: text color "node" draws each label in its outline color; round 6: a label node always is.
    const ink = styles.style.textColor === 'node' || look.size ? stroke : input.text
    // Round 6: a label's own text size, and line height in proportion.
    const fs = look.size ?? input.fontSize, lineH = input.lineHeight * fs / input.fontSize
    ctx.font = `${look.size ? '600 ' : ''}${fs}px ${input.font}`
    out.push(input.interactive
      ? `<g class="n" data-id="${esc(n.id)}" data-p="${esc(n.parent ?? '')}" data-c="${n.collapsed ? 1 : ''}" data-x="${n.x}" data-y="${n.y}" data-w="${s.width}" data-h="${s.height}" transform="translate(${n.x} ${n.y})">`
      : `<g transform="translate(${n.x} ${n.y})">`)
    if (look.shape !== 'none' && look.shape !== 'label') {
      const fill = look.shape === 'text' || !look.fill ? 'none' : color(look.fill)
      out.push(`<path d="${nodePath(look.shape, s.width, s.height)}" fill="${fill}" fill-opacity="${styles.style.fillOpacity / 100}" stroke="${stroke}" stroke-width="${look.shape === 'text' ? 2 : 1.5}" stroke-linejoin="round"/>`)
    } else if (input.interactive) out.push(`<rect width="${s.width}" height="${s.height}" fill="transparent"/>`) // the whole box grabs, not just the text
    const done = n.status === 'done' || n.status === 'dropped'
    const c = counts.get(n.id)
    const progress = c?.tasks ? `${c.done}/${c.tasks}` : ''
    const box = look.shape === 'diamond' ? s.width * DIAMOND_FIT.x : look.size ? Infinity : s.width - 2 * (PAD_X[look.shape] ?? 12)
    const check = n.status && look.shape !== 'circle' ? 22 : 0, prog = progress ? ctx.measureText(progress).width + 8 : 0
    // +1: node sizes are whole pixels, text widths aren't, so text the board fits on one line can measure a fraction over.
    const lines = wrap(ctx, displayText(n.text) || ' ', Math.max(20, box - check - prog) + 1)
    const centred = CENTRED.has(look.shape)
    const textW = Math.max(...lines.map(l => ctx.measureText(l).width))
    const left = centred ? (s.width - (textW + check + prog)) / 2 : (look.shape === 'diamond' ? (s.width - box) / 2 : PAD_X[look.shape] ?? 12)
    const top = (s.height - lines.length * lineH) / 2
    if (check && input.interactive) out.push(`<g class="cb" data-s="${n.status}" color="${ink}" transform="translate(${left} ${top + (lineH - 14) / 2})"/>`)
    else if (check) {
      const y = top + (lineH - 14) / 2
      out.push(`<rect x="${left}" y="${y}" width="14" height="14" rx="3" fill="${n.status === 'done' ? input.accent : 'none'}" stroke="${n.status === 'done' ? input.accent : ink}" stroke-opacity="${n.status === 'done' ? 1 : 0.5}"/>`)
      if (n.status === 'done') out.push(`<path d="M${left + 3.5} ${y + 7.5}l2.5 2.5 4.5-5" fill="none" stroke="${input.background}" stroke-width="1.8"/>`)
    }
    const tx = left + check
    lines.forEach((l, i) => out.push(`<text class="t" x="${centred ? tx + textW / 2 : tx}" y="${top + i * lineH + lineH * 0.72}"${centred ? ' text-anchor="middle"' : ''}${look.size ? ` font-size="${fs}" font-weight="600"` : ''} fill="${ink}"${done ? ' fill-opacity="0.55" text-decoration="line-through"' : ''}>${esc(l)}</text>`))
    if (progress) out.push(`<text class="pg" x="${tx + textW + 8}" y="${top + lineH * 0.72}" fill="${ink}" fill-opacity="0.6" font-size="${input.fontSize - 3}">${esc(progress)}</text>`)
    // M7: the due date after the text (and progress), red when overdue, amber when due today.
    const state = dueState(n, today)
    if (state) out.push(`<text x="${tx + textW + 8 + prog}" y="${top + lineH * 0.72}" fill="${state === 'overdue' ? color('var(--flowmap-due-overdue, var(--color-red))') : state === 'today' ? color('var(--flowmap-due-today, var(--color-orange))') : state === 'later' ? color(`var(--flowmap-due-later, ${ink})`) : ink}"`
      + ` fill-opacity="${state === 'overdue' || state === 'today' ? 1 : 0.6}" font-size="${input.fontSize - 3}">${esc(shortDay(n.due!, today))}</text>`)
    // Round 8: a collapsed branch keeps its "N hidden" badge, beside the node where its children would be (as on the board).
    if (c?.descendants && (n.collapsed || input.interactive)) {
      // The page's script keeps the label: "+N" while collapsed, "–" while open.
      const badge = input.interactive ? (n.collapsed ? `+${c.descendants}` : '–') : `${c.descendants} hidden${c.done ? `, ${c.done} done` : ''}`
      ctx.font = `11px ${input.font}`
      const bw = Math.max(input.interactive ? 30 : 0, ctx.measureText(badge).width + 10), oh = overhang(look.shape, s.height)
      const bx = vertical ? s.width / 2 - bw / 2 : s.width + oh.x + 14, by = vertical ? s.height + oh.y + 14 : s.height / 2 - 9
      if (input.interactive) out.push(`<g class="tg" data-n="${c.descendants}">`)
      out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="18" rx="9" fill="${input.background}" stroke="${input.accent}"/>`,
        `<text x="${bx + bw / 2}" y="${by + 12.5}" text-anchor="middle" fill="${input.text}" font-size="11">${esc(badge)}</text>`)
      if (input.interactive) out.push('</g>')
      x1 = Math.max(x1, n.x + bx + bw); y1 = Math.max(y1, n.y + by + 18)
    }
    out.push('</g>')
  }

  const width = Math.ceil(x1 - x0 + 2 * M), height = Math.ceil(y1 - y0 + 2 * M)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0 - M} ${y0 - M} ${width} ${height}" font-family="${esc(input.font)}" font-size="${input.fontSize}">`
    + `<rect x="${x0 - M}" y="${y0 - M}" width="${width}" height="${height}" fill="${input.background}"/>${out.join('')}</svg>`
  return { svg, width, height }
}

/** Largest canvas the browser reliably draws: 16,384 px a side and about 100 million pixels. */
const MAX_SIDE = 16384, MAX_AREA = 100_000_000

/** The SVG drawn to a PNG at up to 2x; very large boards are scaled down to fit the canvas limits (`scale` says how far). */
export async function svgToPng(svg: string, width: number, height: number): Promise<{ png: ArrayBuffer, scale: number }> {
  const scale = Math.min(2, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = createEl('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob(b => b ? ok(b) : fail(new Error('The image is too large to draw.')), 'image/png'))
    return { png: await blob.arrayBuffer(), scale }
  } finally {
    URL.revokeObjectURL(url)
  }
}
