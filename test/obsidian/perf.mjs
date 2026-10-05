// Performance budget measures on the reference boards (PRD). `npm run obsidian:perf`
// Add `--throttle` to also run with the CPU slowed 4x.
import { copyFileSync, unlinkSync } from 'node:fs'
import { call, close, ev, mouse, sleep, VAULT, wheel } from './drive.mjs'

// Pan measures use the wheel, so switch it to panning (D29 setting) for the run, in memory only: a run that stops
// early must not leave the vault's saved setting on pan.
await ev(`app.plugins.plugins.mindmapmate.saveData = async () => {}; await app.plugins.plugins.mindmapmate.set('wheel', 'pan'); return 1`)
const rates = process.argv.includes('--throttle') ? [1, 4] : [1]
// Copies of the repo fixtures: the vault's own copies may have been edited by hand, and are never saved over.
const boards = ['tidy-2000.board.md', 'tidy-5000.board.md', 'large-2000.board.md']
// One copy name per run, so Obsidian never mixes up a new copy with a just-deleted one.
let copy = '', runs = 0
// Waits until Obsidian has indexed the copy's frontmatter, or it would open as Markdown.
const place = file => {
  copy = `Perf copy ${++runs}.board.md`
  copyFileSync(`test/fixtures/${file}`, `${VAULT}/${copy}`)
  return ev(`for (let i = 0; i < 200 && !app.metadataCache.getCache(${JSON.stringify(copy)})?.frontmatter?.flowmap; i++) await new Promise(r => setTimeout(r, 50)); return 1`)
}
const unplace = async () => { await ev(`app.workspace.activeLeaf.detach(); await new Promise(r => setTimeout(r, 300)); return 1`); unlinkSync(`${VAULT}/${copy}`) }
const row = cells => console.log(cells.map((c, i) => String(c).padEnd(i ? 12 : 30)).join(''))
row(['board', 'cpu', 'open ms', 'fit fps', 'zoomed fps', 'p95 ms'])
console.log('(save time is covered by test/perf/save.test.ts)')

async function panFps() {
  const c = await ev(`const r = document.querySelector('.workspace-leaf.mod-active .react-flow__pane').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
  await ev(`window.__f = []; let last = performance.now(); window.__run = true; const f = t => { window.__f.push(t - last); last = t; if (window.__run) requestAnimationFrame(f) }; requestAnimationFrame(f); return 1`)
  for (let i = 0; i < 60; i++) { await wheel(c.x, c.y, i < 30 ? 40 : -40); await sleep(10) }
  return ev(`window.__run = false; const f = window.__f.slice(2).sort((a, b) => a - b); return { fps: Math.round(f.length / (f.reduce((a, b) => a + b, 0) / 1000)), p95: Math.round(f[Math.floor(f.length * 0.95)]) }`)
}

for (const rate of rates) {
  await call('Emulation.setCPUThrottlingRate', { rate })
  for (const file of boards) {
    await place(file)
    const open = await ev(`
      const leaf = app.workspace.getLeaf(false)
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(copy)}))
      for (let i = 0; i < 300 && !leaf.view.openMs; i++) await new Promise(r => setTimeout(r, 20))
      return leaf.view.openMs`)
    await sleep(1000)
    const fit = await panFps()
    const c = await ev(`const r = document.querySelector('.workspace-leaf.mod-active .react-flow__pane').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
    for (let i = 0; i < 12; i++) { await wheel(c.x, c.y, -100, ['ctrl']); await sleep(50) } // zoom in to readable text
    await sleep(1000)
    const zoomed = await panFps()
    row([file, `x${rate}`, open, fit.fps, zoomed.fps, Math.max(fit.p95, zoomed.p95)])
    await unplace()
  }
}
// M2 to M4 budgets. For each board: the branch closest to 500 nodes is dragged, collapsed and expanded,
// its top node is marked done (the rollup redraws), every line switches type, and the whole board is tidied.
console.log('\nM2-M4 budgets (2,000: drag 50 fps, collapse/expand/status/lines 100 ms, tidy 200 ms; 5,000: 30 fps, 150 ms, 250 ms lines, 500 ms)')
row(['board', 'cpu', 'branch', 'drag fps', 'collapse ms', 'expand ms', 'status ms', 'lines ms', 'tidy ms'])
const frames = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`
for (const rate of rates) {
  await call('Emulation.setCPUThrottlingRate', { rate })
  for (const file of boards.slice(0, 2)) {
    await place(file)
    const branch = await ev(`
      const leaf = app.workspace.getLeaf(false)
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(copy)}))
      for (let i = 0; i < 300 && !leaf.view.openMs; i++) await new Promise(r => setTimeout(r, 20))
      const store = leaf.view.store
      store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.collapsed ? { ...n, collapsed: false } : n) }))
      const kids = new Map()
      for (const n of store.board.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id])
      const size = id => 1 + (kids.get(id) ?? []).reduce((s, k) => s + size(k), 0)
      let best = null
      for (const n of store.board.nodes) { const s = size(n.id); if (!best || Math.abs(s - 500) < Math.abs(best.size - 500)) best = { id: n.id, size: s } }
      return best`)
    await sleep(800)
    const c = await ev(`const r = document.querySelector('.workspace-leaf.mod-active .react-flow__pane').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
    for (let i = 0; i < 20; i++) { await wheel(c.x, c.y, -100, ['ctrl']); await sleep(50) } // out of overview
    await ev(`app.workspace.activeLeaf.view.canvas.current.select(${JSON.stringify(branch.id)}); return 1`)
    await sleep(800)
    const n = await ev(`const el = document.querySelector('.workspace-leaf.mod-active .react-flow__node[data-id="${branch.id}"]'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
    await ev(`window.__f = []; let last = performance.now(); window.__run = true; const f = t => { window.__f.push(t - last); last = t; if (window.__run) requestAnimationFrame(f) }; requestAnimationFrame(f); return 1`)
    await mouse('mouseMoved', n.x, n.y, { button: 'none' })
    await mouse('mousePressed', n.x, n.y)
    for (let i = 1; i <= 60; i++) { await mouse('mouseMoved', n.x + i * 3, n.y + i * 2); await sleep(16) }
    await mouse('mouseReleased', n.x + 180, n.y + 120)
    const drag = await ev(`window.__run = false; const f = window.__f.slice(2); return Math.round(f.length / (f.reduce((a, b) => a + b, 0) / 1000))`)
    const timed = await ev(`
      const view = app.workspace.activeLeaf.view, store = view.store, id = ${JSON.stringify(branch.id)}
      const set = collapsed => b => ({ ...b, nodes: b.nodes.map(n => n.id === id ? { ...n, collapsed } : n) })
      const time = async run => { const t = performance.now(); run(); await ${frames}; return Math.round(performance.now() - t) }
      const collapse = await time(() => store.dispatch(set(true)))
      await new Promise(r => setTimeout(r, 300))
      const expand = await time(() => store.dispatch(set(false)))
      await new Promise(r => setTimeout(r, 300))
      const status = await time(() => store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === id ? { ...n, status: n.status === 'done' ? 'todo' : 'done' } : n) })))
      await new Promise(r => setTimeout(r, 300))
      const lines = await time(() => store.dispatch(b => ({ ...b, theme: { ...b.theme, routing: 'angular' } })))
      await new Promise(r => setTimeout(r, 300))
      const tidy = await time(() => view.canvas.current.tidy(null))
      return { collapse, expand, status, lines, tidy }`)
    row([file, `x${rate}`, branch.size, drag, timed.collapse, timed.expand, timed.status, timed.lines, timed.tidy])
    await unplace()
  }
}
await call('Emulation.setCPUThrottlingRate', { rate: 1 })
await ev(`await app.plugins.plugins.mindmapmate.set('wheel', 'zoom'); return 1`)
close()
