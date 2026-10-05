// Spike A: level of detail. With hundreds of nodes on screen, text is too small to read and mounting
// a React Flow node per board node blows the open and pan budgets (1.8 s and 15 fps at 2,000 nodes).
// Past OVERVIEW_ABOVE visible nodes, the board is drawn as plain boxes and lines on one <canvas>
// instead, and real nodes mount again once the user zooms in.
// ponytail: nodes can't be dragged or edited in overview; zoom in first (Canvas also simplifies when zoomed out).

import type { Board, BoardNode } from '../core/schema.ts'
import { labelSize } from '../core/style.ts'

export const OVERVIEW_ABOVE = 300
/** Hysteresis: once in overview, stay until fewer than this many are visible, so zooming near the
 *  threshold doesn't mount and unmount hundreds of nodes on every frame. */
export const OVERVIEW_BELOW = 200
/** Below this zoom text is unreadable anyway, so a board already in overview stays there. */
export const OVERVIEW_ZOOM = 0.3

type Transform = [number, number, number] // React Flow's [x, y, zoom]

/** Rough size without the DOM; overview boxes don't need to be exact. */
export const approxWidth = (n: BoardNode) => n.width ?? (n.shape === 'label'
  ? Math.max(...n.text.split('\n').map(l => l.length), 1) * 0.43 * labelSize(n.textSize) + 12
  : Math.min(320, Math.max(60, n.text.length * 7.5 + 26 + (n.status ? 22 : 0))))
export const HEIGHT = 34
/** Labels are big unwrapped text (0.43em a character, 1.25 line height, measured in Obsidian), everything else one row. */
export const approxHeight = (n: BoardNode) => n.shape === 'label' ? n.text.split('\n').length * 1.25 * labelSize(n.textSize) + 4 : HEIGHT

export function visibleCount(nodes: BoardNode[], [tx, ty, zoom]: Transform, width: number, height: number): number {
  const x0 = -tx / zoom, y0 = -ty / zoom, x1 = x0 + width / zoom, y1 = y0 + height / zoom
  let count = 0
  for (const n of nodes) if (n.x < x1 && n.x + approxWidth(n) > x0 && n.y < y1 && n.y + approxHeight(n) > y0) count++
  return count
}

export function drawOverview(canvas: HTMLCanvasElement, board: Pick<Board, 'nodes'>, [tx, ty, zoom]: Transform, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')!
  const css = getComputedStyle(canvas)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty)

  const byId = new Map(board.nodes.map(n => [n.id, n]))
  ctx.beginPath()
  for (const n of board.nodes) {
    const p = n.parent === null ? undefined : byId.get(n.parent)
    if (!p) continue
    ctx.moveTo(p.x + approxWidth(p), p.y + approxHeight(p) / 2)
    ctx.lineTo(n.x, n.y + approxHeight(n) / 2)
  }
  ctx.lineWidth = 1 / zoom
  ctx.strokeStyle = css.getPropertyValue('--text-faint') || '#888'
  ctx.stroke()

  for (const done of [false, true]) {
    ctx.beginPath()
    for (const n of board.nodes) if ((n.status === 'done') === done) ctx.rect(n.x, n.y, approxWidth(n), approxHeight(n))
    ctx.globalAlpha = done ? 0.4 : 1
    ctx.fillStyle = css.getPropertyValue('--background-secondary') || '#333'
    ctx.fill()
    ctx.strokeStyle = css.getPropertyValue('--background-modifier-border') || '#555'
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
