// F16 minimap: every visible node as a small box in its outline color, and the current view as a frame. Click or drag
// on it to move the view there. Drawn on a canvas: the nodes once per board change (offscreen), the frame per view
// change, so it stays cheap at 5,000 nodes. React Flow's own minimap only knows the nodes in the render window (D10).

import { Panel, useReactFlow, useStore } from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
import type { BoardNode } from '../core/schema.ts'
import { approxHeight, approxWidth } from './overview.ts'

const W = 200, H = 140, PAD = 6

export function Minimap({ nodes, strokes }: { nodes: BoardNode[], strokes: Map<string, string> }) {
  const rf = useReactFlow()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [tx, ty, zoom] = useStore(s => s.transform)
  const [vw, vh] = [useStore(s => s.width), useStore(s => s.height)]
  // Round 7: labels use their drawn size once React Flow has measured them (the estimate misses fonts like monospace).
  const labelIds = useMemo(() => nodes.filter(n => n.shape === 'label').map(n => n.id), [nodes])
  const labelKey = useStore(s => labelIds.map(id => { const m = s.nodeLookup.get(id)?.measured; return m?.width ? `${m.width} ${m.height}` : '' }).join())
  const size = useMemo(() => {
    const drawn = new Map(labelKey.split(',').map((k, i) => [labelIds[i], k.split(' ').map(Number)] as const).filter(([, m]) => m.length === 2))
    return (n: BoardNode) => { const m = drawn.get(n.id); return m ? { w: m[0], h: m[1] } : { w: approxWidth(n), h: approxHeight(n) } }
  }, [labelKey, labelIds])

  // Board to minimap: fit every node's box, centred.
  const fit = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); const { w, h } = size(n); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h) }
    if (x0 === Infinity) return null
    const scale = Math.min((W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD) / (y1 - y0 || 1))
    return { scale, ox: (W - (x1 - x0) * scale) / 2 - x0 * scale, oy: (H - (y1 - y0) * scale) / 2 - y0 * scale }
  }, [nodes, size])

  // The node layer. Colors are CSS variables, which a canvas can't read, so each distinct one is resolved once (on the
  // body, where Obsidian's theme sets them).
  // ponytail: switching light and dark recolors the minimap at the next board change, not at once.
  const layer = useMemo(() => {
    const dpr = window.devicePixelRatio || 1, el = createEl('canvas')
    el.width = W * dpr; el.height = H * dpr
    if (!fit) return el
    const ctx = el.getContext('2d')!, probe = document.body.createSpan()
    const resolved = new Map<string, string>()
    const color = (css: string) => {
      let c = resolved.get(css)
      if (!c) { probe.style.color = css; c = getComputedStyle(probe).color; resolved.set(css, c) }
      return c
    }
    ctx.scale(dpr, dpr)
    ctx.globalAlpha = 0.8
    for (const n of nodes) {
      ctx.fillStyle = color(strokes.get(n.id) ?? 'var(--text-muted)')
      const { w, h } = size(n)
      ctx.fillRect(n.x * fit.scale + fit.ox, n.y * fit.scale + fit.oy, Math.max(1, w * fit.scale), Math.max(1, h * fit.scale))
    }
    probe.remove()
    return el
  }, [nodes, strokes, fit, size])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    // Both sides: at 1.5x a fresh canvas is already 300 wide, so checking the width alone left it 150 high (round 8).
    if (el.width !== W * dpr || el.height !== H * dpr) { el.width = W * dpr; el.height = H * dpr }
    const ctx = el.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.drawImage(layer, 0, 0)
    if (!fit) return
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = getComputedStyle(el).getPropertyValue('--interactive-accent') || '#888'
    ctx.lineWidth = 1.5
    ctx.strokeRect((-tx / zoom) * fit.scale + fit.ox, (-ty / zoom) * fit.scale + fit.oy, (vw / zoom) * fit.scale, (vh / zoom) * fit.scale)
  }, [layer, fit, tx, ty, zoom, vw, vh])

  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!fit || !(e.buttons & 1)) return
    const r = e.currentTarget.getBoundingClientRect()
    void rf.setCenter((e.clientX - r.left - fit.ox) / fit.scale, (e.clientY - r.top - fit.oy) / fit.scale, { zoom })
  }
  return (
    <Panel position="bottom-right" className="flowmap-minimap">
      <canvas ref={canvas} style={{ width: W, height: H }} aria-label="Minimap" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); moveTo(e) }} onPointerMove={moveTo} />
    </Panel>
  )
}
