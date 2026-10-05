// Round 17: "Export as HTML page": one self-contained file anybody can open in a browser. The board is the interactive SVG from
// exportImage.ts plus the small script below. Viewers can pan and zoom, drag a node with its branch, collapse and expand
// branches, and pick a status for nodes that already have a checkbox. Nothing is editable or saved, and nothing loads: a
// content security policy allows only the page's own inline script and style.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Plain browser JavaScript, run in the exported file (not in Obsidian). Nodes and lines are found by the data attributes
// boardSvg writes in interactive mode. Moving a branch keeps its own lines whole and redraws the lines that leave it as curves;
// collapsing hides descendants but closes no gaps (positions stay); progress (done/tasks) is recounted on every status pick.
const SCRIPT = `
const NS = 'http://www.w3.org/2000/svg', svg = document.querySelector('svg'), vb = svg.viewBox.baseVal
const STATUS = [['todo', 'Not done'], ['doing', 'Doing'], ['blocked', 'Blocked'], ['done', 'Done'], ['dropped', 'Dropped']]
const css = getComputedStyle(svg), C = n => css.getPropertyValue(n)
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e }
const nodes = new Map(), edges = [...svg.querySelectorAll('.e')].map(e => ({ e, a: e.dataset.a, b: e.dataset.b, tx: 0, ty: 0, path: e.querySelector('path') }))
for (const g of svg.querySelectorAll('.n')) nodes.set(g.dataset.id, { g, id: g.dataset.id, p: g.dataset.p, x: +g.dataset.x, y: +g.dataset.y, w: +g.dataset.w, h: +g.dataset.h, collapsed: !!g.dataset.c, kids: [], cb: g.querySelector('.cb'), tg: g.querySelector('.tg'), pg: g.querySelector('.pg') })
for (const n of nodes.values()) nodes.get(n.p)?.kids.push(n)
for (const ed of edges) if (ed.path) ed.look = { stroke: ed.path.getAttribute('stroke'), sw: ed.path.getAttribute('stroke-width'), dash: ed.path.getAttribute('stroke-dasharray') }
const below = n => n.kids.flatMap(k => [k, ...below(k)])
const status = n => n.cb?.dataset.s

// Checkbox glyphs, 14px like the board's: a state's look is its outline, fill and mark.
const glyph = (parent, s, ink) => {
  el('rect', { x: -3, y: -3, width: 20, height: 20, fill: 'transparent' }, parent) // the whole square takes the click, not just its drawn pixels
  const stroke = { todo: ink, doing: C('--accent'), blocked: C('--red'), done: C('--accent'), dropped: C('--faint') }[s]
  el('rect', { x: 0.5, y: 0.5, width: 13, height: 13, rx: 3, fill: s === 'done' ? C('--accent') : s === 'dropped' ? C('--line') : 'none', stroke, 'stroke-opacity': s === 'todo' ? 0.5 : 1 }, parent)
  if (s === 'doing') el('path', { d: 'M1 7h12v3a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z', fill: C('--accent') }, parent)
  if (s === 'done') el('path', { d: 'M3.5 7.5l2.5 2.5 4.5-5', fill: 'none', stroke: C('--bg'), 'stroke-width': 1.8 }, parent)
  if (s === 'blocked') el('path', { d: 'M7 3.5v4.5M7 10v1', stroke, 'stroke-width': 1.8, fill: 'none' }, parent)
  if (s === 'dropped') el('path', { d: 'M4 7h6', stroke: C('--muted'), 'stroke-width': 1.8, fill: 'none' }, parent)
}
const refresh = () => {
  const hidden = new Set(); for (const n of nodes.values()) if (n.collapsed) for (const k of below(n)) hidden.add(k.id)
  for (const n of nodes.values()) n.g.style.display = hidden.has(n.id) ? 'none' : ''
  for (const ed of edges) ed.e.style.display = hidden.has(ed.a) || hidden.has(ed.b) ? 'none' : ''
  for (const n of nodes.values()) {
    if (n.tg) n.tg.querySelector('text').textContent = n.collapsed ? '+' + n.tg.dataset.n : '\\u2013'
    if (n.cb) { n.cb.replaceChildren(); glyph(n.cb, status(n), n.cb.getAttribute('color')) }
    const s = status(n), done = s === 'done' || s === 'dropped'
    for (const t of n.g.querySelectorAll('.t')) { t.setAttribute('fill-opacity', done ? 0.55 : 1); t.setAttribute('text-decoration', done ? 'line-through' : 'none') }
    if (n.pg) { const d = n.kids.filter(k => status(k) && status(k) !== 'dropped'); n.pg.textContent = d.length ? d.filter(k => status(k) === 'done').length + '/' + d.length : '' }
  }
}

// Screen to board coordinates.
const at = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse())
const place = n => n.g.setAttribute('transform', 'translate(' + n.x + ' ' + n.y + ')')
const edge = ed => {
  const A = nodes.get(ed.a), B = nodes.get(ed.b), horiz = Math.abs(B.x + B.w / 2 - A.x - A.w / 2) >= Math.abs(B.y + B.h / 2 - A.y - A.h / 2)
  const side = (N, O) => horiz ? [(O.x > N.x ? N.x + N.w : N.x), N.y + N.h / 2] : [N.x + N.w / 2, O.y > N.y ? N.y + N.h : N.y]
  const [x1, y1] = side(A, B), [x2, y2] = side(B, A), m = horiz ? [(x1 + x2) / 2, y1, (x1 + x2) / 2, y2] : [x1, (y1 + y2) / 2, x2, (y1 + y2) / 2]
  ed.e.replaceChildren(); ed.e.removeAttribute('transform'); ed.tx = ed.ty = 0
  el('path', { d: 'M' + x1 + ' ' + y1 + 'C' + m.join(' ') + ' ' + x2 + ' ' + y2, fill: 'none', stroke: ed.look.stroke, 'stroke-width': ed.look.sw, 'stroke-dasharray': ed.look.dash }, ed.e)
}

const menu = document.getElementById('menu')
addEventListener('pointerdown', e => { if (!menu.contains(e.target)) menu.hidden = true }, true)
let drag = null
svg.addEventListener('pointerdown', e => {
  const cb = e.target.closest('.cb'), tg = e.target.closest('.tg'), g = e.target.closest('.n'), p = at(e)
  if (cb) {
    const n = nodes.get(cb.parentNode.dataset.id)
    menu.replaceChildren(...STATUS.map(([s, label]) => { const b = document.createElement('button'), i = el('svg', { viewBox: '0 0 14 14', width: 16, height: 16 }); glyph(i, s, cb.getAttribute('color')); b.append(i, label); b.onclick = () => { cb.dataset.s = s; menu.hidden = true; refresh() }; return b }))
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px'; menu.hidden = false
    return e.stopPropagation()
  }
  if (tg) { const n = nodes.get(tg.parentNode.dataset.id); n.collapsed = !n.collapsed; return refresh() }
  try { svg.setPointerCapture(e.pointerId) } catch { /* a pointer the browser no longer tracks */ }
  drag = g ? { n: nodes.get(g.dataset.id), set: null, p } : { pan: true, p }
  if (g) { const top = drag.n; drag.set = new Set([top, ...below(top)].map(n => n.id)) }
})
svg.addEventListener('pointermove', e => {
  if (!drag) return
  const p = at(e), dx = p.x - drag.p.x, dy = p.y - drag.p.y
  if (drag.pan) { vb.x -= dx; vb.y -= dy; return }
  drag.p = p
  for (const id of drag.set) { const n = nodes.get(id); n.x += dx; n.y += dy; place(n) }
  for (const ed of edges) {
    const a = drag.set.has(ed.a), b = drag.set.has(ed.b)
    if (a && b) { ed.tx += dx; ed.ty += dy; ed.e.setAttribute('transform', 'translate(' + ed.tx + ' ' + ed.ty + ')') } else if (a || b) edge(ed)
  }
})
svg.addEventListener('pointerup', () => { drag = null })
svg.addEventListener('wheel', e => {
  e.preventDefault()
  const p = at(e), k = Math.exp(e.deltaY * 0.0015)
  vb.x = p.x - (p.x - vb.x) * k; vb.y = p.y - (p.y - vb.y) * k; vb.width *= k; vb.height *= k
}, { passive: false })
refresh()
`

/** The board's interactive SVG (`svg`, from boardSvg with interactive on) as a standalone page. `colors` are resolved CSS colors for the script's checkbox glyphs. */
export type HtmlColors = { accent: string, red: string, faint: string, muted: string, line: string }
export function htmlPage(title: string, svg: string, background: string, colors: HtmlColors): string {
  const vars = `--accent:${colors.accent};--red:${colors.red};--faint:${colors.faint};--muted:${colors.muted};--line:${colors.line};--bg:${background}`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
html, body { margin: 0; height: 100%; overflow: hidden; user-select: none; -webkit-user-select: none; background: ${background}; font-family: system-ui, sans-serif; }
body > svg { display: block; width: 100vw; height: 100vh; touch-action: none; cursor: grab; ${vars} }
.n { cursor: move; } .n > path { pointer-events: all; } .cb, .tg { cursor: pointer; }
#menu { position: fixed; display: flex; flex-direction: column; padding: 4px; border: 1px solid ${colors.line}; border-radius: 6px; background: ${background}; box-shadow: 0 4px 16px #0004; }
#menu[hidden] { display: none; }
#menu button { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border: 0; border-radius: 4px; background: none; color: ${colors.muted}; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
#menu button:hover { background: ${colors.line}; }
#hint { position: fixed; left: 12px; bottom: 10px; color: ${colors.faint}; font-size: 12px; pointer-events: none; }
</style></head><body>
${svg}
<div id="menu" hidden></div>
<div id="hint">Drag to move · scroll to zoom · click a checkbox to set its status · click +/– to fold a branch. Changes aren't saved.</div>
<script>${SCRIPT}</script>
</body></html>
`
}
