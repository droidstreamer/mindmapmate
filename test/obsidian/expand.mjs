// Expand timing for the ~500-node branch, repeated (the perf script takes one sample, and expand varies a lot on the
// test laptop). `node test/obsidian/expand.mjs [fixture]` prints each run and the median.
import { copyFileSync, unlinkSync } from 'node:fs'
import { close, ev, sleep, VAULT, wheel } from './drive.mjs'
const file = process.argv[2] ?? 'tidy-2000.board.md'
copyFileSync(`test/fixtures/${file}`, `${VAULT}/Exp.board.md`)
const branch = await ev(`for (let i = 0; i < 200 && !app.metadataCache.getCache('Exp.board.md')?.frontmatter?.flowmap; i++) await new Promise(r => setTimeout(r, 50))
  const leaf = app.workspace.getLeaf(false); await leaf.openFile(app.vault.getAbstractFileByPath('Exp.board.md')); await new Promise(r => setTimeout(r, 1200))
  const store = leaf.view.store, kids = new Map()
  for (const n of store.board.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id])
  const size = id => 1 + (kids.get(id) ?? []).reduce((s, k) => s + size(k), 0)
  let best = null; for (const n of store.board.nodes) { const s = size(n.id); if (!best || Math.abs(s - 500) < Math.abs(best.size - 500)) best = { id: n.id, size: s } }
  return best`)
const c = await ev(`const r = document.querySelector('.workspace-leaf.mod-active .react-flow__pane').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
for (let i = 0; i < 20; i++) { await wheel(c.x, c.y, -100, ['ctrl']); await sleep(50) }
await ev(`app.workspace.activeLeaf.view.canvas.current.select(${JSON.stringify(branch.id)}); return 1`)
await sleep(5000) // let Obsidian finish indexing the new file
const times = await ev(`
  const s = app.workspace.activeLeaf.view.store, id = ${JSON.stringify(branch.id)}, out = []
  const set = v => s.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === id ? { ...n, collapsed: v } : n) }))
  for (let i = 0; i < 9; i++) {
    set(true); await new Promise(r => setTimeout(r, 400))
    const t = performance.now(); set(false); const t1 = performance.now()
    await new Promise(r => requestAnimationFrame(r)); const t2 = performance.now()
    await new Promise(r => requestAnimationFrame(r)); const t3 = performance.now()
    out.push(Math.round(t3 - t) + '(' + Math.round(t1 - t) + '/' + Math.round(t2 - t1) + '/' + Math.round(t3 - t2) + ')')
    await new Promise(r => setTimeout(r, 400))
  }
  return out.slice(2) /* the first two warm up */`)
const ms = times.map(t => parseInt(t)).sort((a, b) => a - b)
console.log(file, 'expand ms (total(sync/before frame/frame))', times.join(' '), 'median', ms[Math.floor(ms.length / 2)])
await ev(`app.workspace.activeLeaf.detach(); return 1`)
unlinkSync(`${VAULT}/Exp.board.md`)
close()
