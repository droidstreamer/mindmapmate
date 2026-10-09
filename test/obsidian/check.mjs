// Scripted checklist in a real Obsidian (PRD testing strategy). `npm run obsidian:check`
import { copyFileSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { at, board, call, click, close, dblclick, drag, edgePoint, ev, key, mouse, nodeAt, open, paneCorner, sleep, type, VAULT, wheel } from './drive.mjs'
import { knobCentre } from './knob.mjs'

let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }
const TEST = 'M1 Check.board.md', CLOSED = 'M1 Check closed.board.md', M2 = 'M2 Check.board.md', M3 = 'M3 Check.board.md', M4 = 'M4b Check.board.md'
const SMALL = 'test/fixtures/small.board.md' // the repo copy: the vault's may have been edited by hand
const disk = p => readFileSync(`${VAULT}/${p}`, 'utf8')
const node = async text => (await board()).nodes.find(n => n.text === text)
const count = async () => (await board()).nodes.length
const settle = () => sleep(250)

// Settings the checks change stay in memory, never in the vault's data.json (a leaked "pan" once reached the user).
await ev(`app.plugins.plugins.mindmapmate.saveData = async () => {}; return 1`)
await ev(`await app.plugins.plugins.mindmapmate.set('wheel', 'zoom'); return 1`)
// The minimap covers the bottom-right corner, where drags in a small window can land; only the M6 checks turn it on.
await ev(`await app.plugins.plugins.mindmapmate.set('minimap', false); return 1`)
// Round 19: exports open a native Save dialog. Scripted runs swap in a picker that saves into the vault under the suggested name (the real one is kept to check it exists).
await ev(`window.__realPicker = typeof window.showSaveFilePicker; window.__picks = []; window.showSaveFilePicker = async o => { window.__picks.push(o.suggestedName); if (window.__cancel) throw new DOMException('x', 'AbortError')
  return { name: o.suggestedName, createWritable: async () => ({ chunks: [], write(d) { this.chunks.push(d) }, async close() { await app.vault.adapter.writeBinary(o.suggestedName, await new Blob(this.chunks).arrayBuffer()) } }) } }; return 1`)
copyFileSync(SMALL, `${VAULT}/${TEST}`)
await sleep(500)
await open(TEST)
const pane = await paneCorner()

// Canvas input
let n = await nodeAt('Level Design')
const before = await node('Level Design')
await drag(n.x, n.y, n.x + 120, n.y + 60); await settle()
const moved = await node('Level Design')
check('drag moves a node', moved.x !== before.x && moved.y !== before.y)
await key('z', 'KeyZ', ['ctrl']); await settle()
check('Ctrl+Z undoes the move', (await node('Level Design')).x === before.x)
await key('Z', 'KeyZ', ['ctrl', 'shift']); await settle()
check('Ctrl+Shift+Z redoes it', (await node('Level Design')).x === moved.x)
await sleep(3000)
check('debounced save writes the file', disk(TEST).includes(`"x":${moved.x},"y":${moved.y}`))

await dblclick(pane.x, pane.y + 40); await settle()
await type('Made by double-click'); await key('Escape', 'Escape'); await settle()
check('double-click empty space creates a node and edits it', (await node('Made by double-click'))?.parent === null)

n = await nodeAt('Level Design')
await mouse('mouseMoved', n.x, n.y, { button: 'none' }); await sleep(100)
let h = await at(`.react-flow__node[data-id="${n.id}"] .react-flow__handle-right`)
await drag(h.x, h.y, h.x + 90, h.y + 80); await settle()
await type('Child by handle'); await key('Escape', 'Escape'); await settle()
check('drag handle to empty space creates a child', (await node('Child by handle'))?.parent === n.id)

const cs = await nodeAt('Combat System')
await mouse('mouseMoved', cs.x, cs.y, { button: 'none' }); await sleep(100)
h = await at(`.react-flow__node[data-id="${cs.id}"] .react-flow__handle-bottom`)
n = await nodeAt('Level Design')
await drag(h.x, h.y, n.x, n.y, { m: ['alt'] }); await settle()
check('Alt+drop a handle onto a node creates a cross-link (D37, M6b)', (await board()).links.some(l => l.from === cs.id && l.to === n.id) && (await node('Level Design')).parent !== cs.id)

const em = await nodeAt('Enemy Mechanics'), c0 = await count()
await drag(em.x, em.y, em.x, em.y + 200, { m: ['alt'] }); await settle()
const b = await board()
check('Alt+drag duplicates the subtree, original stays', b.nodes.length === c0 + 2 && b.nodes.find(x => x.id === em.id).y === 0)

n = await nodeAt('Level Design'); const lv0 = await node('Level Design')
await drag(n.x, n.y, n.x + 100, n.y + 30, { m: ['shift'] }); await settle()
const lv1 = await node('Level Design')
check('Shift+drag locks to one axis', lv1.y === lv0.y && lv1.x !== lv0.x)

await ev(`document.querySelector('.workspace-leaf.mod-active .flowmap-btn[aria-label^="Snap"]').click(); return 1`)
await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle() // the Shift+drag added to the selection
n = await nodeAt('Level Design')
await drag(n.x, n.y, n.x + 37, n.y + 23); await settle()
const snapped = await node('Level Design')
check('snap to grid lands on the 20px grid', snapped.x % 20 === 0 && snapped.y % 20 === 0, `${snapped.x},${snapped.y}`)
await ev(`document.querySelector('.workspace-leaf.mod-active .flowmap-btn[aria-label^="Snap"]').click(); return 1`)

await click(pane.x, pane.y); n = await nodeAt('Level Design'); await click(n.x, n.y); await settle()
const edge = await at(`.react-flow__node[data-id="${n.id}"] .react-flow__resize-control.right`, 0.1) // above the connection dot, 21px on a selected node (M6b)
await drag(edge.x, edge.y, edge.x + 90, edge.y); await sleep(400)
check('dragging a node edge resizes it', (await node('Level Design')).width > 100)

await click(pane.x, pane.y); n = await nodeAt('Level Design'); await click(n.x, n.y); await settle()
const c1 = await count()
await key('Delete', 'Delete'); await settle()
const c2 = await count()
await key('z', 'KeyZ', ['ctrl']); await settle()
check('Delete removes the subtree, undo restores it', c2 === c1 - 2 && (await count()) === c1, `${c1} -> ${c2} -> ${await count()}`)

await key('a', 'KeyA', ['ctrl']); await settle()
// Read the selection from the canvas: nodes off screen are selected but not drawn.
const selCount = await ev(`return app.workspace.activeLeaf.view.canvas.current.selectedIds().length`)
check('Ctrl+A selects all', selCount === await count(), `${selCount} of ${await count()}`)
await key('p', 'KeyP', ['ctrl']); await sleep(300)
check('Ctrl+P still opens the command palette (D24)', await ev(`return !!document.querySelector('.prompt')`))
await key('Escape', 'Escape'); await click(pane.x, pane.y); await settle()

const vp0 = await ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__viewport').style.transform`)
await ev(`document.querySelector('.workspace-leaf.mod-active .flowmap-btn[aria-label="Zoom in"]').click(); return 1`); await sleep(300)
await click(pane.x, pane.y); await key('!', 'Digit1', ['shift']); await sleep(500)
check('Shift+1 zooms to fit', await ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__viewport').style.transform`) !== vp0)

await ev(`app.commands.executeCommandById('mindmapmate:tidy-board'); return 1`); await sleep(500)
check('tidy leaves no overlapping nodes (Spike C)', await ev(`
  const rs = [...document.querySelectorAll('.workspace-leaf.mod-active .react-flow__node')].map(e => e.getBoundingClientRect())
  return rs.every((a, i) => rs.every((b, j) => j <= i || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top))`))
await key('z', 'KeyZ', ['ctrl']); await settle()

// M2 hierarchy, on a fresh copy of the small board
copyFileSync(SMALL, `${VAULT}/${M2}`)
await sleep(500)
await open(M2)
const p2 = await paneCorner()
const at2 = async id => { const n = (await board()).nodes.find(n => n.id === id); return { x: n.x, y: n.y } }
const noOverlap = () => ev(`
  const rs = [...document.querySelectorAll('.workspace-leaf.mod-active .react-flow__node')].map(e => e.getBoundingClientRect())
  return rs.every((a, i) => rs.every((b, j) => j <= i || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top))`)
const selectedIds = () => ev(`return [...document.querySelectorAll('.workspace-leaf.mod-active .react-flow__node.selected')].map(e => e.dataset.id)`)

let em2 = await nodeAt('Enemy Mechanics'); const kid0 = await at2('n4')
await drag(em2.x, em2.y, em2.x + 80, em2.y + 40); await settle()
const kid1 = await at2('n4')
check('dragging a parent moves its children by the same offset (F2)', kid1.x - kid0.x === (await at2('n3')).x - 320 && kid1.y !== kid0.y)
await key('z', 'KeyZ', ['ctrl']); await settle()
check('one undo step restores the whole branch', (await at2('n4')).x === kid0.x && (await at2('n3')).x === 320)
em2 = await nodeAt('Enemy Mechanics')
await drag(em2.x, em2.y, em2.x + 80, em2.y + 40, { m: ['ctrl'] }); await settle()
check('Ctrl+drag moves the node alone (D26)', (await at2('n4')).x === kid0.x && (await at2('n3')).x !== 320)
await key('z', 'KeyZ', ['ctrl']); await settle()

let lv = await nodeAt('Level Design'); await click(lv.x, lv.y); await settle()
await key('Tab', 'Tab'); await settle(); await type('Tab child'); await key('Enter', 'Enter'); await settle()
check('Tab adds a child and edits it, Enter finishes', (await node('Tab child'))?.parent === 'n5')
check('the new node is selected', (await selectedIds()).includes((await node('Tab child')).id))
await key('Enter', 'Enter'); await settle(); await type('Enter sibling'); await key('Tab', 'Tab'); await settle()
await type('Grandchild'); await key('Escape', 'Escape'); await settle()
const sib = await node('Enter sibling')
check('Enter adds a sibling below the last one (D4)', sib?.parent === 'n5' && sib.y > (await node('Tab child')).y)
check('Tab while editing adds a child of that node', (await node('Grandchild'))?.parent === sib.id)
check('new nodes do not overlap', await noOverlap())

em2 = await nodeAt('Enemy Mechanics'); await click(em2.x, em2.y); await settle()
await key('ArrowRight', 'ArrowRight'); await settle()
const r1 = await selectedIds()
await key('ArrowLeft', 'ArrowLeft'); await key('ArrowDown', 'ArrowDown'); await settle()
check('arrow keys go to child, parent and sibling', r1.join() === 'n4' && (await selectedIds()).join() === 'n5', `${r1} / ${await selectedIds()}`)
await key('ArrowUp', 'ArrowUp'); await key('ArrowDown', 'ArrowDown', ['alt']); await settle()
const order = async id => (await board()).nodes.find(n => n.id === id).order
check('Alt+Down moves a node after its next sibling', (await order('n3')) > (await order('n5')) && (await at2('n3')).y > (await at2('n5')).y)
check('reorder leaves no overlaps', await noOverlap())
await key('ArrowUp', 'ArrowUp', ['alt']); await settle()

em2 = await nodeAt('Enemy Mechanics'); await click(em2.x, em2.y); await settle()
await key('.', 'Period', ['ctrl']); await settle()
const badge = await ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__node[data-id="n3"] .flowmap-collapse')?.textContent`)
check('Ctrl+. collapses: children hidden, badge shows the count (F7)', !(await nodeAt('item drops')) && badge === '1 hidden', badge)
await sleep(2500)
check('collapsed state is saved in the file', disk(M2).includes('"collapsed":true'))
em2 = await nodeAt('Enemy Mechanics'); const n3a = await at2('n3'), n4a = await at2('n4')
await drag(em2.x, em2.y, em2.x + 60, em2.y); await settle()
check('moving a collapsed node moves its hidden children (D3)', (await at2('n4')).x - n4a.x === (await at2('n3')).x - n3a.x && (await at2('n4')).x !== n4a.x)
const b3 = await at(`.react-flow__node[data-id="n3"] .flowmap-collapse`)
await click(b3.x, b3.y); await settle()
check('clicking the badge expands', !!(await nodeAt('item drops')))

await ev(`app.commands.executeCommandById('mindmapmate:collapse-to-level'); return 1`); await sleep(300)
await type('Level 1'); await sleep(200); await key('Enter', 'Enter'); await settle()
const collapsedIds = async () => (await board()).nodes.filter(n => n.collapsed).map(n => n.id).join()
check('Collapse all to level 1 leaves only the root', (await collapsedIds()) === 'n1' && !(await nodeAt('Combat System')))
await ev(`app.commands.executeCommandById('mindmapmate:expand-all'); return 1`); await settle()
check('Expand all shows everything', (await collapsedIds()) === '' && !!(await nodeAt('Combat System')))

await click(p2.x, p2.y); await key('!', 'Digit1', ['shift']); await sleep(500)
const l4 = await nodeAt('item drops'); await click(l4.x, l4.y); await settle()
const crumbs = await ev(`return [...document.querySelectorAll('.workspace-leaf.mod-active .flowmap-breadcrumb button')].map(b => b.textContent)`)
check('breadcrumb shows the path to the selected node (F9)', crumbs.join(' > ') === '0.0.1 Prototype > Enemy Mechanics > item drops, see [[Loot Tables]]', crumbs.join(' > '))
const crumb = await at('.flowmap-breadcrumb button')
await click(crumb.x, crumb.y); await settle()
check('clicking a breadcrumb selects that node', (await selectedIds()).join() === 'n1')

await click(p2.x, p2.y); await key('!', 'Digit1', ['shift']); await sleep(500)
const mid = await edgePoint('e-n4', 0.5); await click(mid.x, mid.y); await settle()
// React Flow's grab circle for the line's parent end (just outside the parent, where the grab cursor shows).
const src = await at('.react-flow__edge[data-id="e-n4"] .react-flow__edgeupdater-source'); lv = await nodeAt('Level Design')
await drag(src.x, src.y, lv.x, lv.y); await settle()
check('dragging the parent end of a selected line reparents (Canvas reconnect), and adds no link', (await node('item drops, see [[Loot Tables]]')).parent === 'n5' && !(await board()).links.some(l => l.from === 'n4' && l.to === 'n5'))
await key('z', 'KeyZ', ['ctrl']); await settle()
await click(p2.x, p2.y); await settle()
const mid2 = await edgePoint('e-n4', 0.5); await click(mid2.x, mid2.y); await settle()
await key('Delete', 'Delete'); await settle()
check('Delete on a parent line detaches the child as a root', (await node('item drops, see [[Loot Tables]]')).parent === null && (await count()) === 8)
await key('z', 'KeyZ', ['ctrl']); await settle()

await key('!', 'Digit1', ['shift']); await sleep(500)
for (const dir of ['Down', 'Both sides', 'Left', 'Right']) {
  await ev(`app.commands.executeCommandById('mindmapmate:layout-direction'); return 1`); await sleep(300)
  await type(dir); await sleep(200); await key('Enter', 'Enter'); await sleep(500)
  const b = await board()
  const root = b.nodes.find(n => n.id === 'n1'), kids = b.nodes.filter(n => n.parent === 'n1')
  const placed = { Down: kids.every(k => k.y > root.y), Left: kids.every(k => k.x < root.x), Right: kids.every(k => k.x > root.x),
    'Both sides': kids.some(k => k.x < root.x) && kids.some(k => k.x > root.x) }[dir]
  check(`layout ${dir}: children placed that way, no overlaps, root fixed`, placed && await noOverlap() && root.x === 0 && root.y === 0)
}
lv = await nodeAt('Level Design')
await drag(lv.x, lv.y, lv.x - 200, lv.y - 60, { m: ['ctrl'] }); await settle()
await click(p2.x, p2.y); const r0 = await nodeAt('0.0.1 Prototype'); await click(r0.x, r0.y)
await key('L', 'KeyL', ['shift']); await settle()
check('Shift+L tidies the selected branch', await noOverlap() && (await at2('n5')).x > 0)
// Close the tab first, or its debounced save writes the file back after it is deleted.
await ev(`app.workspace.activeLeaf.detach(); await new Promise(r => setTimeout(r, 300)); return 1`)
unlinkSync(`${VAULT}/${M2}`)

// M3 tasks and text. Fit the board first and read results from the store: off-screen nodes aren't drawn.
copyFileSync(SMALL, `${VAULT}/${M3}`)
await sleep(500)
await open(M3)
const fit3 = async () => { await key('!', 'Digit1', ['shift']); await sleep(400) }
const status = async id => (await board()).nodes.find(n => n.id === id).status
const progressOf = id => ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__node[data-id="${id}"] .flowmap-progress')?.textContent ?? ''`)
await fit3()
// Round 22: a parent counts its own children only; n3 has no checkbox and n4 (its child) counts for n3 alone, never n1.
check('parent shows its children\'s progress (1 of 2 done), none from deeper down', await progressOf('n1') === '1/2' && await progressOf('n3') === '0/1')
let box = await at('.react-flow__node[data-id="n5"] .flowmap-check')
await click(box.x, box.y); await settle()
check('clicking the checkbox marks done and updates the rollup', await status('n5') === 'done' && await progressOf('n1') === '2/2')
check('done shows struck through and faded', await ev(`const el = document.querySelector('.workspace-leaf.mod-active .react-flow__node[data-id="n5"] .flowmap-node-text'); return getComputedStyle(el).textDecorationLine === 'line-through' && getComputedStyle(el.closest('.flowmap-node')).opacity < 1`))
await key('z', 'KeyZ', ['ctrl']); await settle()
check('undo restores the status in one step', await status('n5') === 'todo')
const pane3 = await paneCorner()
await click(pane3.x, pane3.y); let em3 = await nodeAt('Enemy Mechanics'); await click(em3.x, em3.y); await settle()
await key('Enter', 'Enter', ['ctrl', 'shift']); await settle(); const s1 = await status('n3')
await key('Enter', 'Enter', ['ctrl', 'shift']); await settle(); const s2 = await status('n3')
check('Ctrl+Shift+Enter makes a node a task, then toggles done', s1 === 'todo' && s2 === 'done', `${s1}, ${s2}`)
check('rollup counts through collapsed branches', await (async () => {
  await ev(`app.commands.executeCommandById('mindmapmate:toggle-collapse'); return 1`); await settle()
  const badge = await ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__node[data-id="n3"] .flowmap-collapse').textContent`)
  const p = await progressOf('n3')
  await ev(`app.commands.executeCommandById('mindmapmate:toggle-collapse'); return 1`); await settle()
  return badge === '1 hidden' && p === '0/1'
})())
await ev(`app.commands.executeCommandById('mindmapmate:set-status'); return 1`); await sleep(300)
await type('Blocked'); await sleep(200); await key('Enter', 'Enter'); await settle()
check('set status command (blocked)', await status('n3') === 'blocked')
await ev(`app.commands.executeCommandById('mindmapmate:toggle-hide-done'); return 1`); await settle()
const hidden3 = await ev(`return !document.querySelector('.workspace-leaf.mod-active .react-flow__node[data-id="n2"]')`)
await ev(`app.commands.executeCommandById('mindmapmate:toggle-hide-done'); return 1`); await settle()
check('hide done hides done nodes, and shows them again', hidden3 && !!(await nodeAt('Combat System')))

// Clipboard (D27): copy a branch, paste it as a new root with new ids; paste a text outline under a node.
// Copy and paste events carry their own data, so these checks test the board's handlers, not the system clipboard
// (the Wayland clipboard in a test session drops writes).
const clipEvent = (type, data) => ev(`const dt = new DataTransfer(); for (const [t, v] of ${JSON.stringify(data ?? [])}) dt.setData(t, v)
  document.activeElement.dispatchEvent(new ClipboardEvent('${type}', { clipboardData: dt, bubbles: true, cancelable: true })); return [...dt.types].map(t => [t, dt.getData(t)])`)
await ev(`await app.plugins.plugins.mindmapmate.set('copy', 'branch'); return 1`) // D38: node-only is the default now
em3 = await nodeAt('Enemy Mechanics'); await click(em3.x, em3.y); await settle()
const clip = await clipEvent('copy')
const clipText = clip.find(([t]) => t === 'text/plain')?.[1]
check('copy puts a plain-text outline on the clipboard', clipText === '- [ ] Enemy Mechanics #status/blocked\n\t- [ ] item drops, see [[Loot Tables]]\n', JSON.stringify(clipText))
const c3 = await count()
await click(pane3.x + 40, pane3.y + 40); await settle()
await clipEvent('paste', clip); await settle()
let board3 = await board()
const copies = board3.nodes.filter(n => n.text === 'Enemy Mechanics' && n.id !== 'n3')
check('paste recreates the branch with new ids, status and structure', board3.nodes.length === c3 + 2 && copies.length === 1
  && copies[0].parent === null && copies[0].status === 'blocked' && board3.nodes.some(n => n.parent === copies[0].id && n.text.startsWith('item drops')))
await key('z', 'KeyZ', ['ctrl']); await settle()
check('undo removes the whole paste', await count() === c3)
await ev(`await app.plugins.plugins.mindmapmate.set('copy', 'node'); return 1`)
await fit3()
const lv3 = await nodeAt('Level Design'); await click(lv3.x, lv3.y); await settle()
await clipEvent('paste', [['text/plain', '- Zanzibar quokka\n\t- [x] Quokka child one\n\t- Quokka child two\n']]); await settle()
board3 = await board()
const zq = board3.nodes.find(n => n.text === 'Zanzibar quokka')
const zkids = zq && board3.nodes.filter(n => n.parent === zq.id).sort((a, b) => a.order - b.order)
check('pasting a text outline builds a tree under the selected node', zq?.parent === 'n5' && zkids.length === 2 && zkids[0].status === 'done' && zkids[1].y > zkids[0].y)
await sleep(3000) // debounced save

// F12: global search finds node text through the index. F13: export.
check('global search finds node text', await ev(`
  app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch('"Zanzibar quokka"')
  await new Promise(r => setTimeout(r, 2500))
  const leaf = app.workspace.getLeavesOfType('search')[0]
  return [...leaf.view.containerEl.querySelectorAll('.tree-item-inner')].some(e => e.textContent.includes('M3 Check'))`))
await open(M3)
await ev(`app.commands.executeCommandById('mindmapmate:export-markdown'); await new Promise(r => setTimeout(r, 800)); return 1`)
const exported = disk('M3 Check export.md')
// Round 6: the top 2 levels export as headings (a setting); tasks stay checkboxes, deeper levels nest as bullets.
check('export writes headings, then checklists in board order', exported.startsWith('# 0.0.1 Prototype\n\n- [x] Combat System\n- [ ] Enemy Mechanics #status/blocked\n')
  && exported.includes('- [ ] Level Design\n\t- Zanzibar quokka\n\t\t- [x] Quokka child one\n'), JSON.stringify(exported.slice(0, 200)))

// D20: with the Tasks plugin on, board tasks never show in a Tasks query. The control task must.
// (The export is a normal checklist, meant for Tasks, so it goes first.)
unlinkSync(`${VAULT}/M3 Check export.md`)
writeFileSync(`${VAULT}/M3 Control.md`, '- [ ] control task zeta\n')
writeFileSync(`${VAULT}/M3 Query.md`, '```tasks\nnot done\n```\n')
await sleep(1500)
await ev(`const l = app.workspace.getLeaf(false); await l.openFile(app.vault.getAbstractFileByPath('M3 Query.md')); await l.setViewState({ ...l.getViewState(), state: { ...l.getViewState().state, mode: 'preview' } }); await new Promise(r => setTimeout(r, 2500)); return 1`)
const query = await ev(`return document.querySelector('.workspace-leaf.mod-active .markdown-preview-view')?.textContent ?? ''`)
check('Tasks plugin: control task listed, no board task listed', query.includes('control task zeta') && !/Level Design|item drops|Quokka/.test(query), JSON.stringify(query.slice(0, 200)))
await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) l.detach(); app.workspace.getLeaf(false).detach(); await new Promise(r => setTimeout(r, 300)); return 1`)
for (const f of [M3, 'M3 Control.md', 'M3 Query.md']) unlinkSync(`${VAULT}/${f}`)

// M4b styling redesign: toolbars on the selection, Board style, canvas controls, lines, dots, wheel.
copyFileSync(SMALL, `${VAULT}/${M4}`)
await sleep(500)
await open(M4)
await key('!', 'Digit1', ['shift']); await sleep(400)
const A = '.workspace-leaf.mod-active'
const btn = async label => { const b = await at(`.flowmap-btn[aria-label="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
const tile = async label => { const b = await at(`.flowmap-pop [aria-label="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
const css = (id, prop) => ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="${id}"] .flowmap-node')).getPropertyValue('${prop}').trim()`)
const pathOf = id => ev(`return document.querySelector('${A} .react-flow__edge[data-id="${id}"] path.react-flow__edge-path')?.getAttribute('d')`)

check('canvas controls: Board style, zoom and focus buttons', await ev(`return ['Board style', 'Zoom in', 'Zoom out', 'Zoom to fit (Shift+1)', 'Focus selection (Shift+2)'].every(l => document.querySelector('${A} .flowmap-btn[aria-label="' + l + '"]'))`))
const pos0 = JSON.stringify((await board()).nodes.map(n => [n.x, n.y]))
const path0 = await pathOf('e-n2')
await btn('Board style'); await btn('Routing'); await tile('Straight')
const path1 = await pathOf('e-n2'), b4 = await board()
check('Board style routing redraws every line and moves no node', b4.theme.routing === 'straight' && path1 !== path0 && JSON.stringify(b4.nodes.map(n => [n.x, n.y])) === pos0,
  `${JSON.stringify(b4.theme)} ${path0?.slice(0, 30)} -> ${path1?.slice(0, 30)} moved: ${JSON.stringify(b4.nodes.map(n => [n.x, n.y])) !== pos0}`)
await click(pane.x, pane.y); await key('z', 'KeyZ', ['ctrl']); await settle()
check('undo restores the routing', (await board()).theme.routing === undefined)
await btn('Board style')
check('auto colors: children of the root get different palette colors', await css('n2', '--tm-stroke') !== await css('n3', '--tm-stroke'))
n = await nodeAt('Enemy Mechanics'); await click(n.x, n.y); await settle()
check('clicking a node shows the node palette', !!(await at('.flowmap-btn[aria-label="Shape"]')))
await btn('Shape'); await tile('Diamond')
check('shape flyout sets the shape', (await node('Enemy Mechanics')).shape === 'diamond' && !!(await ev(`return !!document.querySelector('${A} .react-flow__node[data-id="${n.id}"] .shape-diamond')`)))
await btn('Shape'); await btn('Outline'); await tile('Purple')
const kid = (await board()).nodes.find(x => x.parent === n.id)
check('a picked outline color flows down to auto children', (await node('Enemy Mechanics')).stroke === 6 && await css(kid.id, '--tm-stroke') === await css(n.id, '--tm-stroke'))
await key('Escape', 'Escape'); await settle()
const popGone = !(await ev(`return !!document.querySelector('${A} .flowmap-pop')`))
await key('Escape', 'Escape'); await settle()
check('Esc closes the flyout, a second Esc deselects', popGone && !(await at('.flowmap-btn[aria-label="Shape"]')))
const midL = await edgePoint('e-n5', 0.5); await click(midL.x, midL.y); await settle()
check('clicking a line shows the connector palette and a glow', !!(await at('.flowmap-btn[aria-label="Arrowhead"]')) && !!(await ev(`return !!document.querySelector('${A} .react-flow__edge[data-id="e-n5"] .flowmap-halo')`)))
await btn('Arrowhead'); await tile('Dot')
await btn('Direction'); await ev(`[...document.querySelectorAll('${A} .flowmap-menu-row')].find(r => r.textContent.includes('Bidirectional')).click(); return 1`); await settle()
check('arrowhead and direction: two dot heads', (await node('Level Design')).edgeArrow === 'dot' && await ev(`return document.querySelectorAll('${A} .react-flow__edge[data-id="e-n5"] .flowmap-head').length`) === 2)
await btn('Label'); await type('needs art'); await key('Enter', 'Enter'); await settle()
check('a line label saves and shows on the line (F17)', (await node('Level Design')).edgeLabel === 'needs art' && (await ev(`return document.querySelector('${A} .react-flow__edge[data-id="e-n5"]').textContent`)).includes('needs art'))
await click(pane.x, pane.y); await settle()
await btn('Board style'); await btn('Line width')
const undo0 = await ev(`return app.workspace.activeLeaf.view.store.past.length`)
await ev(`const i = document.querySelector('${A} .flowmap-pop input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  for (const v of ['5', '6', '7']) { set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })) } i.dispatchEvent(new Event('change')); return 1`); await settle()
check('dragging the line width slider is one undo step', (await board()).theme.maxWidth === 7 && await ev(`return app.workspace.activeLeaf.view.store.past.length`) === undo0 + 1)
await btn('Board style')
n = await nodeAt('Level Design')
const right = await ev(`const r = document.querySelector('${A} .react-flow__node[data-id="n5"] .react-flow__handle-right').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
await mouse('mouseMoved', n.x, n.y, { button: 'none' }); await sleep(150)
const dotsCenter = await ev(`return document.querySelectorAll('${A} .react-flow__handle.is-near').length`)
await mouse('mouseMoved', right.x + 8, right.y + 4, { button: 'none' }); await sleep(150)
const near = await ev(`return [...document.querySelectorAll('${A} .react-flow__handle.is-near')].map(h => h.className.match(/handle-(\\w+)/)[1] + ':' + getComputedStyle(h).opacity)`)
check('only the connection dot near the pointer shows (D30)', dotsCenter === 0 && near.join() === 'right:1', `centre: ${dotsCenter}, near right: ${near}`)
const zoom0 = await ev(`return document.querySelector('${A} .react-flow__viewport').style.transform`)
await wheel(pane.x + 200, pane.y + 200, -200); await sleep(400)
const zoom1 = await ev(`return document.querySelector('${A} .react-flow__viewport').style.transform`)
check('the mouse wheel zooms (D29)', zoom1.match(/scale\(([\d.]+)\)/)[1] !== zoom0.match(/scale\(([\d.]+)\)/)[1], `${zoom0} -> ${zoom1}; under the pointer: ${await ev(`return document.elementFromPoint(${pane.x + 200}, ${pane.y + 200})?.className?.baseVal ?? document.elementFromPoint(${pane.x + 200}, ${pane.y + 200})?.className`)}`)
await sleep(2500) // let the debounced save land first
const text4 = disk(M4)
// The node's color comes from the theme's --color-<name>; some themes (Minimal) use the same one in light and dark.
const themeBlue = `const p = document.body.createDiv(); p.style.color = 'var(--color-blue)'; const c = getComputedStyle(p).color; p.remove(); return c`
const c0dark = await ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="n2"] .flowmap-shape path')).stroke`), blueDark = await ev(themeBlue)
await ev(`app.changeTheme('moonstone'); await new Promise(r => setTimeout(r, 500)); return 1`)
const c0light = await ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="n2"] .flowmap-shape path')).stroke`), blueLight = await ev(themeBlue)
await ev(`app.changeTheme('obsidian'); await new Promise(r => setTimeout(r, 500)); return 1`)
await sleep(2500)
check('switching Obsidian light/dark recolors without editing the file', (blueDark === blueLight || c0dark !== c0light) && disk(M4) === text4, `${c0dark} / ${c0light} (theme blue ${blueDark} / ${blueLight})`)
await ev(`app.workspace.activeLeaf.detach(); await new Promise(r => setTimeout(r, 300)); return 1`)
unlinkSync(`${VAULT}/${M4}`)

// M5b feedback fixes (D33-D36): shapes and lines, selection, toolbars
{
  const M5B = 'M5b Check.board.md'
  copyFileSync(SMALL, `${VAULT}/${M5B}`)
  await sleep(500)
  await open(M5B)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M5B)}).view`
  const selected = () => ev(`return [...document.querySelectorAll('${A} .react-flow__node.selected')].map(e => e.dataset.id).sort().join(',')`)
  const selectedLines = () => ev(`return [...document.querySelectorAll('${A} .react-flow__edge.selected')].map(e => e.dataset.id).sort().join(',')`)
  const rect = id => ev(`const r = document.querySelector('${A} .react-flow__node[data-id="${id}"]').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }`)
  const pane = await paneCorner()
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const pick = async label => { const b = await ev(`const el = [...document.querySelectorAll('${A} .flowmap-pop button')].find(e => e.textContent.trim() === ${JSON.stringify(label)} || e.ariaLabel === ${JSON.stringify(label)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`); if (!b) return false; await click(b.x, b.y); await settle(); return true }

  // Lines meet every shape's outline, also right after switching from any other shape (a stale handle left a gap or
  // an overlap). n3's line out to n4 starts at n3's right side; the line from n1 ends (arrow tip) at n3's left side.
  const gap = () => ev(`
    const v = ${view}, n = v.store.board.nodes.find(n => n.id === 'n3')
    const shape = document.querySelector('${A} .react-flow__node[data-id="n3"] .flowmap-shape path:not(.flowmap-node-halo)')
    const out = document.querySelector('${A} .react-flow__edge[data-id="e-n4"] path.react-flow__edge-path')
    const head = document.querySelector('${A} .react-flow__edge[data-id="e-n3"] .flowmap-head')
    const tip = /translate\\(([-\\d.e]+)[ ,]+([-\\d.e]+)\\)/.exec(head.getAttribute('transform'))
    const ends = [out.getPointAtLength(0), { x: +tip[1], y: +tip[2] }]
    const len = shape.getTotalLength()
    let worst = 0
    for (const e of ends) {
      let best = Infinity
      for (let i = 0; i <= 400; i++) { const q = shape.getPointAtLength(len * i / 400); best = Math.min(best, Math.hypot(n.x + q.x - e.x, n.y + q.y - e.y)) }
      worst = Math.max(worst, best)
    }
    return worst`)
  const shapes = ['rect', 'round', 'pill', 'para', 'circle', 'diamond', 'hex', 'doc', 'predef', 'cyl']
  let worst = 0, where = ''
  for (const from of shapes) for (const to of shapes) {
    if (from === to) continue
    for (const k of [from, to]) { await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, shape: '${k}' } : n) })); return 1`); await sleep(120) }
    const g = await gap()
    if (g > worst) { worst = g; where = `${from} -> ${to}` }
  }
  check('lines meet every shape\'s outline after switching from any other shape', worst <= 1, `worst ${worst.toFixed(2)}px${where ? ' at ' + where : ''}`)
  const diamond = async () => { await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, shape: 'diamond' } : n) })); return 1`); await sleep(300) }
  await diamond()
  check('a diamond is a true diamond, its text inside', await ev(`
    const el = document.querySelector('${A} .react-flow__node[data-id="n3"]'), t = el.querySelector('.flowmap-node-row').getBoundingClientRect(), r = el.getBoundingClientRect()
    const d = el.querySelector('.flowmap-shape path').getAttribute('d')
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    return /^M0 [\\d.]+L[\\d.]+ 0L/.test(d) && [[t.left, t.top], [t.right, t.top], [t.left, t.bottom], [t.right, t.bottom]].every(([x, y]) => Math.abs(x - cx) / (r.width / 2) + Math.abs(y - cy) / (r.height / 2) <= 1.02)`))

  // Selection: Shift-click adds and removes nodes and lines, mixed too; a selected node glows.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, shape: undefined } : n) })); return 1`); await sleep(300)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const c = async id => { const r = await rect(id); return { x: (r.x + r.r) / 2, y: (r.y + r.b) / 2 } }
  let p = await c('n2'); await click(p.x, p.y); await settle()
  check('a selected node glows instead of a dashed box (D33)', await ev(`const el = document.querySelector('${A} .react-flow__node[data-id="n2"]'); return !!el.querySelector('.flowmap-node-halo') && getComputedStyle(el.querySelector('.flowmap-node')).outlineStyle === 'none'`))
  for (const id of ['n3', 'n5']) { p = await c(id); await click(p.x, p.y, { m: ['shift'] }); await settle() }
  const three = await selected()
  p = await c('n3'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  check('Shift-click adds nodes, and removes a selected one', three === 'n2,n3,n5' && (await selected()) === 'n2,n5', `${three} / ${await selected()}`)
  // Round 6 (N2): a click that wobbles under 4px still selects; it used to select nothing at 0.5-1px.
  const wobble = async (id, m = []) => { const q = await c(id); await mouse('mouseMoved', q.x, q.y, { button: 'none' }); await mouse('mousePressed', q.x, q.y, { m }); await mouse('mouseMoved', q.x + 0.6, q.y + 0.6, { m }); await mouse('mouseReleased', q.x + 0.6, q.y + 0.6, { m }); await settle() }
  await click(pane.x, pane.y); await settle()
  await wobble('n2'); await wobble('n4', ['shift'])
  check('a click that wobbles a pixel still selects, Shift-click too (round 6)', (await selected()) === 'n2,n4', await selected())
  await click(pane.x, pane.y); await settle()
  let e = await edgePoint('e-n2', 0.5); await click(e.x, e.y); await settle()
  e = await edgePoint('e-n5', 0.5); await click(e.x, e.y, { m: ['shift'] }); await settle()
  const lines2 = await selectedLines()
  p = await c('n4'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  check('Shift-click adds lines, and nodes to lines', lines2 === 'e-n2,e-n5' && (await selectedLines()) === 'e-n2,e-n5' && (await selected()) === 'n4', `${lines2} / ${await selectedLines()} / ${await selected()}`)
  await click(pane.x, pane.y); await settle()

  // D34: the rectangle takes only what lies fully inside it.
  const r3 = await rect('n3'), r4 = await rect('n4')
  await drag(r4.r + 12, Math.max(r3.b, r4.b) + 12, r3.x - 12, Math.min(r3.y, r4.y) - 12); await settle()
  check('rectangle select: nodes and lines fully inside only', (await selected()) === 'n3,n4' && (await selectedLines()) === 'e-n4', `${await selected()} / ${await selectedLines()}`)
  await click(pane.x, pane.y); await settle()
  await drag((r4.x + r4.r) / 2, Math.max(r3.b, r4.b) + 12, r3.x - 12, Math.min(r3.y, r4.y) - 12); await settle()
  check('rectangle select: a half-covered node is left out (its line, fully inside, is not)', (await selected()) === 'n3' && (await selectedLines()) === 'e-n4', `${await selected()} / ${await selectedLines()}`)
  await click(pane.x, pane.y); await settle()
  const [q3, q4] = [await rect('n3'), await rect('n4')] // the last rectangle may have auto-panned
  await drag((q3.r + q4.x) / 2, Math.max(q3.b, q4.b) + 12, q3.x - 12, Math.min(q3.y, q4.y) - 12); await settle()
  check('rectangle select: a line the rectangle cuts through is left out', (await selected()) === 'n3' && (await selectedLines()) === '',
    `${await selected()} / ${await selectedLines()}`)
  await click(pane.x, pane.y); await settle()
  // M6b: a line alone, both ends inside, its nodes half covered.
  const [m3, m4] = [await rect('n3'), await rect('n4')]
  await drag((m4.x + m4.r) / 2, Math.max(m3.b, m4.b) + 12, (m3.x + m3.r) / 2, Math.min(m3.y, m4.y) - 12); await settle()
  check('rectangle select: a line alone, with both ends inside (M6b)', (await selected()) === '' && (await selectedLines()) === 'e-n4', `${await selected()} / ${await selectedLines()}`)
  await click(pane.x, pane.y); await settle()

  // Round 10 (Canvas): a box around a selection of two or more, live during the rectangle; Shift + rectangle adds.
  const box = () => ev(`const b = document.querySelector('${A} .flowmap-selection-box'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }`)
  const [b3, b4] = [await rect('n3'), await rect('n4')]
  const [sx, sy, ex, ey] = [b4.r + 12, Math.max(b3.b, b4.b) + 12, b3.x - 12, Math.min(b3.y, b4.y) - 12]
  await mouse('mouseMoved', sx, sy, { button: 'none' }); await mouse('mousePressed', sx, sy)
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', sx + (ex - sx) * i / 10, sy + (ey - sy) * i / 10); await sleep(16) }
  await settle(); const live = await box()
  await mouse('mouseReleased', ex, ey); await settle()
  const [c3, c4, bx] = [await rect('n3'), await rect('n4'), await box()]
  check('the selection box shows while the rectangle grows, and wraps the picked nodes (round 10)', !!live && !!bx && bx.x <= Math.min(c3.x, c4.x) && bx.y <= Math.min(c3.y, c4.y) && bx.r >= Math.max(c3.r, c4.r) && bx.b >= Math.max(c3.b, c4.b),
    JSON.stringify({ live, bx }))
  check('React Flow\'s own selection box is gone (it swallowed Shift-clicks)', await ev(`const el = document.querySelector('${A} .react-flow__nodesselection'); return !el || getComputedStyle(el).display === 'none'`))
  const r2 = await rect('n2')
  await drag(r2.x - 12, r2.y - 12, r2.r + 12, r2.b + 12, { m: ['shift'] }); await settle() // the toolbar sits below n2
  check('Shift + rectangle adds to the selection (round 10)', (await selected()) === 'n2,n3,n4' && (await selectedLines()) === 'e-n4', `${await selected()} / ${await selectedLines()}`)
  p = await c('n3'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  check('Shift-click after a rectangle removes a node', (await selected()) === 'n2,n4', await selected())
  await click(pane.x, pane.y); await settle()
  p = await c('n2'); await click(p.x, p.y); await settle()
  check('one selected node has no selection box', !(await box()))
  const hints = () => ev(`const h = document.querySelector('${A} .flowmap-hints'); return h && getComputedStyle(h).display !== 'none' ? h.textContent : ''`)
  check('shortcut hints fit one selected node while the board has focus (round 11)', /child/.test(await hints()) && /move node alone/.test(await hints()) && await ev(`return document.querySelector('${A} .flowmap-hints').offsetHeight < 40`), await hints())
  await click(pane.x, pane.y); await settle()

  // Round 11: a drag on empty space inside the selection box moves the selection (Canvas).
  const [g3, g4] = [await rect('n3'), await rect('n4')]
  await drag(g4.r + 12, Math.max(g3.b, g4.b) + 12, g3.x - 12, Math.min(g3.y, g4.y) - 12); await settle()
  check('shortcut hints change for several selected nodes (round 11)', /move all/.test(await hints()), await hints())
  const sb = await box(), before11 = await board()
  const inside = { x: sb.x + 2, y: sb.y + 2 }
  const onPane = await ev(`return document.elementFromPoint(${inside.x}, ${inside.y})?.classList.contains('react-flow__pane')`)
  await drag(inside.x, inside.y, inside.x + 80, inside.y + 50); await settle()
  const after11 = await board(), delta = id => { const a = before11.nodes.find(n => n.id === id), z = after11.nodes.find(n => n.id === id); return [z.x - a.x, z.y - a.y] }
  check('dragging inside the selection box moves the selection, which stays selected (round 11)', onPane && delta('n3')[0] > 0 && delta('n3')[1] > 0
    && JSON.stringify(delta('n3')) === JSON.stringify(delta('n4')) && (await selected()) === 'n3,n4', `${onPane} ${JSON.stringify([delta('n3'), delta('n4')])} ${await selected()}`)
  await key('z', 'KeyZ', ['ctrl']); await settle()
  // Bug (v0.7.11): after a box drag, select something else, then rectangle the same nodes again: only their line was taken.
  p = await c('n2'); await click(p.x, p.y); await settle()
  await drag(g4.r + 12, Math.max(g3.b, g4.b) + 12, g3.x - 12, Math.min(g3.y, g4.y) - 12); await settle()
  check('rectangle selecting the same nodes again, after a box drag, takes the nodes (round 11 bug)', (await selected()) === 'n3,n4' && (await selectedLines()) === 'e-n4', `${await selected()} / ${await selectedLines()}`)
  p = await c('n2'); await click(p.x, p.y); await settle()
  await drag(g4.r + 12, Math.max(g3.b, g4.b) + 12, g3.x - 12, Math.min(g3.y, g4.y) - 12); await settle()
  check('rectangle selecting the same nodes twice in a row takes them both times', (await selected()) === 'n3,n4', await selected())

  // Round 11: Arrange > Size.
  await bar('Arrange'); await pick('Match widest')
  const wide = await board(), w3 = wide.nodes.find(n => n.id === 'n3').width
  check('Arrange > Match widest gives the selected nodes one width (round 11)', !!w3 && w3 === wide.nodes.find(n => n.id === 'n4').width, String(w3))
  await pick('Fit to text (one line)') // the Arrange menu stays open
  check('Arrange > Fit to text clears the widths', (await board()).nodes.filter(n => n.id === 'n3' || n.id === 'n4').every(n => n.width === undefined))
  // Fit to text puts a long sentence on one line (a wider box), breaking only at real line breaks.
  const long = 'A long sentence with no line break in it that would normally wrap onto two or three lines'
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, text: ${JSON.stringify(long)} } : n) })); return 1`); await sleep(400)
  const tall = (await rect('n3')).b - (await rect('n3')).y
  await pick('Fit to text (one line)'); await sleep(300)
  const fitted = await rect('n3'), fw = (await board()).nodes.find(n => n.id === 'n3').width
  check('Fit to text makes a long sentence one line (round 11)', fw > 320 && fitted.b - fitted.y < tall, `width ${fw}, height ${tall.toFixed(0)} -> ${(fitted.b - fitted.y).toFixed(0)}`)
  await key('z', 'KeyZ', ['ctrl']); await key('z', 'KeyZ', ['ctrl']); await settle()

  // Grid dots: a setting turns them on (round 15: off by default) and off, and sets their color.
  await ev(`const p = app.plugins.plugins.mindmapmate; await p.set('gridDots', true); await p.set('gridColor', '#ff0000'); return 1`); await sleep(300)
  const dotFill = await ev(`const c = document.querySelector('${A} .react-flow__background circle, ${A} .react-flow__background path'); return c ? getComputedStyle(c).fill : ''`)
  await ev(`await app.plugins.plugins.mindmapmate.set('gridDots', false); return 1`); await sleep(300)
  check('grid dots take the set color, and the setting hides them (round 11)', dotFill === 'rgb(255, 0, 0)' && !(await ev(`return !!document.querySelector('${A} .react-flow__background')`)), dotFill)
  await ev(`const p = app.plugins.plugins.mindmapmate; await p.set('gridDots', false); await p.set('gridColor', ''); return 1`); await sleep(300)
  await click(pane.x, pane.y); await settle()

  // Round 11: with snap on, the resized edge lands on the grid; the other edge stays.
  await ev(`document.querySelector('${A} .flowmap-btn[aria-label^="Snap"]').click(); return 1`)
  p = await c('n2'); await click(p.x, p.y); await settle()
  const n2a = (await board()).nodes.find(n => n.id === 'n2')
  let rz = await at(`.react-flow__node[data-id="n2"] .react-flow__resize-control.right`, 0.1)
  await drag(rz.x, rz.y, rz.x + 37, rz.y); await sleep(400)
  const n2b = (await board()).nodes.find(n => n.id === 'n2')
  rz = await at(`.react-flow__node[data-id="n2"] .react-flow__resize-control.left`, 0.1)
  await drag(rz.x, rz.y, rz.x - 29, rz.y); await sleep(400)
  const n2c = (await board()).nodes.find(n => n.id === 'n2')
  check('with snap on, a resized node\'s moving edge lands on the grid (round 11)', n2b.x === n2a.x && (n2b.x + n2b.width) % 20 === 0 && n2c.x % 20 === 0 && n2c.x + n2c.width === n2b.x + n2b.width,
    JSON.stringify([n2a.x, n2b.x, n2b.width, n2c.x, n2c.width]))
  await key('z', 'KeyZ', ['ctrl']); await key('z', 'KeyZ', ['ctrl']); await settle()
  await ev(`document.querySelector('${A} .flowmap-btn[aria-label^="Snap"]').click(); return 1`)
  await click(pane.x, pane.y); await settle()

  // Round 11: square routing: every line from one side of a parent turns at the same place.
  await ev(`${view}.store.dispatch(b => ({ ...b, theme: { ...b.theme, routing: 'square' } })); return 1`); await sleep(400)
  const bends = await ev(`
    const b = ${view}.store.board, kids = new Map()
    for (const n of b.nodes) if (n.parent) kids.set(n.parent, [...kids.get(n.parent) ?? [], n.id])
    const out = []
    for (const [p, ids] of kids) {
      const xs = ids.map(id => document.querySelector('${A} .react-flow__edge[data-id="e-' + id + '"] path.react-flow__edge-path')?.getAttribute('d')).filter(Boolean)
        .map(d => d.slice(1).split('L').map(q => q.split(' ').map(Number))).filter(pts => pts[0][1] !== pts.at(-1)[1] && pts[1][0] > pts[0][0]).map(pts => Math.round(pts[2][0]))
      if (xs.length > 1) out.push(xs)
    }
    return out`)
  check('square routing: siblings share one elbow (round 11)', bends.length > 0 && bends.every(xs => new Set(xs).size === 1), JSON.stringify(bends))
  await key('z', 'KeyZ', ['ctrl']); await settle()

  // Round 14: a selected node shows no dots; D35: over the collapse button no dot shows.
  p = await c('n3'); await click(p.x, p.y); await settle()
  const dot = await at('.react-flow__node[data-id="n3"] .react-flow__handle-right')
  await mouse('mouseMoved', dot.x, dot.y, { button: 'none' }); await sleep(150)
  check('a selected node shows no connection dots (round 14)', !(await ev(`return !!document.querySelector('${A} .react-flow__handle.is-near')`)))
  await click(pane.x, pane.y); await settle()
  const btn = await at('.react-flow__node[data-id="n3"] .flowmap-collapse')
  await mouse('mouseMoved', btn.x, btn.y, { button: 'none' }); await sleep(150)
  check('over the collapse button no dot shows, and the button is clear of the dot', !(await ev(`return !!document.querySelector('${A} .react-flow__handle.is-near')`)) && btn.x - dot.x >= 14, `${(btn.x - dot.x).toFixed(1)}px apart`)
  p = await c('n3'); await click(p.x, p.y); await settle()

  // Toolbars: Task and Link buttons, auto fill down the branch, arrowhead icons, control icons.
  await bar('Checkbox'); await pick('Checkbox')
  const added = (await node('Enemy Mechanics')).status === 'todo'
  await pick('Blocked')
  const mark = await ev(`return getComputedStyle(document.querySelector('${A} .flowmap-node.status-blocked .flowmap-check'), '::after').content`)
  const blocked = (await node('Enemy Mechanics')).status === 'blocked' && mark === '"!"'
  await pick('Checkbox')
  check('Checkbox menu switches the checkbox on, sets a status with its own box, and switches it off (round 12)', added && blocked && (await node('Enemy Mechanics')).status === undefined, `${added} ${blocked} ${mark}`)
  await bar('Link'); await pick('Promote to a note')
  check('Link menu: Promote to a note links the node', (await node('Enemy Mechanics')).link === 'Enemy Mechanics.md')
  await bar('Link'); await pick('Remove link')
  check('Link menu: Remove link', (await node('Enemy Mechanics')).link === undefined)
  await bar('Fill'); await pick('Green')
  const fillOf = id => ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="${id}"] .flowmap-shape path:not(.flowmap-node-halo)')).fill`)
  check('auto fill flows down the branch (D36)', (await node('Enemy Mechanics')).fill === 4 && (await fillOf('n4')) === (await fillOf('n3')) && (await fillOf('n4')) !== 'none', `${await fillOf('n3')} / ${await fillOf('n4')}`)
  await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle()
  // The rectangle checks above can auto-pan the view by a varying amount; fit so the line is on screen.
  await key('!', 'Digit1', ['shift']); await sleep(400)
  e = await edgePoint('e-n2', 0.5); await click(e.x, e.y); await settle()
  await bar('Arrowhead')
  check('arrowhead flyout: 8 heads, no half, filled and open triangles differ', await ev(`
    const tiles = [...document.querySelectorAll('${A} .flowmap-pop .flowmap-tile')], fill = l => getComputedStyle(tiles.find(t => t.ariaLabel === l).querySelector('path')).fill
    return tiles.length === 8 && !tiles.some(t => t.ariaLabel === 'Half') && fill('Triangle') !== fill('Open triangle')`))
  await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle()
  check('Zoom to fit and Focus selection have different icons', await ev(`const i = l => document.querySelector('${A} .flowmap-btn[aria-label^="' + l + '"] svg')?.outerHTML; return !!i('Zoom to fit') && !!i('Focus selection') && i('Zoom to fit') !== i('Focus selection')`))

  await ev(`app.workspace.activeLeaf.detach(); for (const p of [${JSON.stringify(M5B)}, 'Enemy Mechanics.md']) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// M5c feedback round 4 (D37-D41): None shape, HSL picker, node-only copy, no mixed icons, line kind, font search
{
  const M5C = 'M5c Check.board.md'
  copyFileSync(SMALL, `${VAULT}/${M5C}`)
  await sleep(500)
  await open(M5C)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M5C)}).view`
  const pane = await paneCorner()
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const pick = async label => { const b = await ev(`const el = [...document.querySelectorAll('${A} .flowmap-pop button')].find(e => e.textContent.trim() === ${JSON.stringify(label)} || e.ariaLabel === ${JSON.stringify(label)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const active = label => ev(`return !!document.querySelector('${A} .flowmap-btn[aria-label^="${label}"]')?.classList.contains('is-active')`)
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  const clipEvent = (type, data) => ev(`const dt = new DataTransfer(); for (const [t, v] of ${JSON.stringify(data ?? [])}) dt.setData(t, v)
    document.querySelector('${A} .flowmap-canvas').focus(); document.activeElement.dispatchEvent(new ClipboardEvent('${type}', { clipboardData: dt, bubbles: true, cancelable: true })); return [...dt.types].map(t => [t, dt.getData(t)])`)

  // None shape
  await selectOnly('n3'); await bar('Shape'); await pick('None')
  check('None shape: nothing drawn around the text', (await node('Enemy Mechanics')).shape === 'none'
    && await ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="n3"] .flowmap-shape path:not(.flowmap-node-halo)')).stroke`) === 'none')
  await key('Escape', 'Escape'); await settle()

  // D40: HSL picker. The hue track runs red, yellow, green, cyan, blue, purple, red; a slider drag is one undo step.
  await selectOnly('n5'); await bar('Fill'); await pick('Pick a color')
  const hue = await ev(`const t = document.querySelector('${A} .flowmap-hsl-track'); return t && t.style.background`)
  const undo0 = await ev(`return ${view}.store.past.length`)
  await ev(`const i = document.querySelectorAll('${A} .flowmap-hsl-track')[0], set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const v of ['100', '110', '120']) { set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })) } i.dispatchEvent(new Event('change')); return 1`); await settle()
  const lv = await node('Level Design')
  check('HSL picker: hue track red to red, sliders set a custom color in one undo step', !!hue && /^linear-gradient\(to right, rgb\(255, 0, 0\).*rgb\(255, 0, 0\)\)$/.test(hue)
    && /^#[0-9a-f]{6}$/.test(lv.fill) && (await board()).theme.customColors?.[0] === lv.fill && await ev(`return ${view}.store.past.length`) === undo0 + 1, `${hue} / ${lv.fill}`)
  for (const [i, name] of ['hue', 'saturation', 'lightness'].entries()) { // Obsidian's own thumb rule once lifted the knobs; read from the pixels
    const k = await knobCentre(call, ev, `document.querySelectorAll('${A} .flowmap-hsl-track')[${i}]`)
    check(`HSL picker: ${name} knob is centred on its track`, Math.abs(k.knob - k.track) <= 1, `knob ${k.knob.toFixed(2)}px, track ${k.track}px`)
  }
  // Round 20: a click off the sliders closes them and keeps the color.
  await ev(`document.querySelector('${A} .react-flow__pane').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return 1`); await settle()
  check('HSL picker closes on a click off it, color kept (round 20)', await ev(`return !document.querySelector('${A} .flowmap-hsl')`) && (await node('Level Design')).fill === lv.fill)
  await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle()

  // D39: no mixed icons: two nodes with different outlines show a plain neutral outline button.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n2' ? { ...n, stroke: 1 } : n.id === 'n5' ? { ...n, stroke: 4 } : n) })); return 1`); await settle()
  await selectOnly('n2'); let p = await nodeAt('Level Design'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  check('different outlines: a plain outline icon, no split', await ev(`const d = document.querySelector('${A} .flowmap-btn[aria-label="Outline"] .flowmap-dot'); return !!d && !d.className.includes('mixed') && d.style.getPropertyValue('--dot') === 'var(--text-muted)'`))
  await bar('Outline'); await pick('Purple')
  check('a pick applies to the whole selection', (await node('Combat System')).stroke === 6 && (await node('Level Design')).stroke === 6)
  await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle()

  // D38: copy takes the node only (plugin setting for whole branches); paste goes beside the selected node.
  await selectOnly('n3')
  let clip = await clipEvent('copy')
  const onlyNodes = JSON.parse(clip.find(([t]) => t === 'application/x-flowmap')[1]).nodes
  const c0 = (await board()).nodes.length
  await clipEvent('paste', clip); await settle()
  const pasted = (await board()).nodes.filter(n => n.text === 'Enemy Mechanics' && n.id !== 'n3')
  check('copy takes the node only; paste puts it beside the selected node', onlyNodes.length === 1 && (await board()).nodes.length === c0 + 1
    && pasted.length === 1 && pasted[0].parent === 'n1' && !(await board()).nodes.some(n => n.parent === pasted[0].id))
  await ev(`await app.plugins.plugins.mindmapmate.set('copy', 'branch'); return 1`); await settle()
  await selectOnly('n3'); clip = await clipEvent('copy')
  check('setting "whole branch": copy takes the children too', JSON.parse(clip.find(([t]) => t === 'application/x-flowmap')[1]).nodes.length === 2)
  await ev(`await app.plugins.plugins.mindmapmate.set('copy', 'node'); return 1`); await settle()

  // D37: the line kind toggle.
  await click(pane.x, pane.y); await settle()
  let e = await edgePoint('e-n4', 0.5); await click(e.x, e.y); await settle()
  const wasParent = await active('Parent line') && !(await active('Link'))
  await bar('Link:')
  let b = await board()
  const made = b.links.find(l => l.from === 'n3' && l.to === 'n4')
  check('Parent line / Link toggle: a parent line becomes a link, and shows as one', wasParent && b.nodes.find(n => n.id === 'n4').parent === null && !!made
    && await active('Link:') && !(await active('Parent line')))
  await bar('Parent line')
  b = await board()
  check('...and back: the link becomes a parent line', b.nodes.find(n => n.id === 'n4').parent === 'n3' && !b.links.some(l => l.from === 'n3' && l.to === 'n4') && await active('Parent line'))
  await click(pane.x, pane.y); await settle()
  e = await edgePoint('e-n5', 0.5); await click(e.x, e.y); await settle()
  e = await edgePoint('l-l1', 0.5); await click(e.x, e.y, { m: ['shift'] }); await settle()
  const mixedKinds = !(await active('Parent line')) && !(await active('Link:'))
  await bar('Link:')
  b = await board()
  check('mixed kinds: neither on; a click makes them all links', mixedKinds && b.nodes.find(n => n.id === 'n5').parent === null && b.links.some(l => l.id === 'l1') && b.links.some(l => l.to === 'n5'))
  await click(pane.x, pane.y); await settle()

  // D41: font search suggests installed fonts as you type; a used font joins the quick list.
  const first = await ev(`return (await window.queryLocalFonts()).map(f => f.family).sort()[0]`)
  await bar('Board style'); await bar('Font')
  const input = await at('.flowmap-font-input')
  await click(input.x, input.y); await type(first.slice(0, 4)); await sleep(300)
  const suggested = await ev(`return [...document.querySelectorAll('${A} .flowmap-pop .flowmap-menu-row')].map(r => r.textContent.trim())`)
  await pick(first)
  check('font search suggests installed fonts as you type', suggested.includes(first) && (await board()).theme.font === first, `${first}: ${suggested.join(', ')}`)
  await bar('Font')
  check('the font search box starts empty again (M6b)', await ev(`return document.querySelector('${A} .flowmap-font-input').value`) === '')
  check('a used font joins the quick list', (await ev(`return app.plugins.plugins.mindmapmate.settings.recentFonts[0]`)) === first
    && await ev(`return [...document.querySelectorAll('${A} .flowmap-pop .flowmap-menu-row')].some(r => r.textContent.trim() === ${JSON.stringify(first)})`))
  await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle()
  await ev(`const s = app.plugins.plugins.mindmapmate; await s.set('recentFonts', s.settings.recentFonts.filter(f => f !== ${JSON.stringify(first)})); return 1`)

  await ev(`app.workspace.activeLeaf.detach(); const f = app.vault.getAbstractFileByPath(${JSON.stringify(M5C)}); if (f) await app.vault.delete(f); return 1`)
}

// M6b feedback round 5: drop to reparent, Auto swatch, palette, custom slots, match outline, node text color, arrange,
// child shape, dots, note suggestions, line color follows the outline
{
  const M6B = 'M6b Check.board.md', NOTE = 'M6b Target note.md'
  copyFileSync(SMALL, `${VAULT}/${M6B}`)
  await ev(`if (!app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})) await app.vault.create(${JSON.stringify(NOTE)}, 'target'); return 1`)
  await sleep(500)
  await open(M6B)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M6B)}).view`
  const pane = await paneCorner()
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const pick = async label => { const b = await ev(`const el = [...document.querySelectorAll('${A} .flowmap-pop button')].find(e => e.textContent.trim() === ${JSON.stringify(label)} || (e.ariaLabel ?? '').startsWith(${JSON.stringify(label)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  const dispatch = async code => { await ev(`${view}.store.dispatch(${code}); return 1`); await settle() }
  const esc = async () => { await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle() }
  const cs = (id, sel, prop) => ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="${id}"] ${sel}')).${prop}`)
  const shapePath = '.flowmap-shape path:not(.flowmap-node-halo)'
  const swatch = title => ev(`const el = [...document.querySelectorAll('${A} .flowmap-pop .flowmap-swatch')].find(e => (e.ariaLabel ?? '').startsWith(${JSON.stringify(title)})); return el && getComputedStyle(el).backgroundColor`)

  // Dots are 21px on an unselected node.
  check('connection dots are 21px (round 14)', await ev(`return document.querySelector('${A} .react-flow__node[data-id="n5"] .react-flow__handle-right').offsetWidth`) === 21)

  // Item 10: dropping a line on a node that has a parent reparents it; the old parent line goes, no new node.
  let n = await nodeAt('Level Design'), t = await nodeAt('item drops'), c0 = (await board()).nodes.length
  await mouse('mouseMoved', n.x, n.y, { button: 'none' }); await sleep(100)
  let h = await at(`.react-flow__node[data-id="n5"] .react-flow__handle-bottom`)
  await drag(h.x, h.y, t.x, t.y); await settle()
  let b = await board()
  check('drop a line on a node with a parent: it becomes a child, no link, no new node', b.nodes.find(x => x.id === 'n4').parent === 'n5'
    && !b.links.some(l => l.to === 'n4') && b.nodes.length === c0)
  // Dropped on the target's connection dot, which sits partly outside the node: still that node.
  const d = await at(`.react-flow__node[data-id="n2"] .react-flow__handle-left`)
  await mouse('mouseMoved', n.x, n.y, { button: 'none' }); await sleep(100)
  h = await at(`.react-flow__node[data-id="n5"] .react-flow__handle-top`)
  await drag(h.x, h.y, d.x - 4, d.y); await settle()
  b = await board()
  check('a drop on the target\'s dot connects to it, no node made on top', b.nodes.find(x => x.id === 'n2').parent === 'n5' && b.nodes.length === c0, `${b.nodes.length - c0} new`)
  await key('z', 'KeyZ', ['ctrl']); await key('z', 'KeyZ', ['ctrl']); await settle()

  // Items 4, 5, 6: the Auto swatch shows the parent's color; retuned presets; 8 custom slots.
  await dispatch(`b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n4' ? { ...n, stroke: 1 } : n) })`)
  await selectOnly('n4'); await bar('Outline')
  const autoSw = await swatch('Auto'), parent = await cs('n3', shapePath, 'stroke')
  check('Auto swatch shows the parent\'s color, not the node\'s own pick', autoSw === parent && autoSw !== await cs('n4', shapePath, 'stroke'), `${autoSw} / ${parent}`)
  check('green, cyan and pink presets retuned', await swatch('Green') === 'rgb(34, 180, 112)' && await swatch('Cyan') === 'rgb(20, 165, 184)' && await swatch('Pink') === 'rgb(232, 44, 144)')
  check('8 custom color slots', await ev(`return document.querySelectorAll('${A} .flowmap-pop .flowmap-palette > :nth-child(n+10):not(.is-spectrum)').length`) === 8)
  // Round 6 (N5): each custom slot sits exactly under the preset above it, and no special swatch shows a pipette.
  check('custom colors line up under the presets, no pipette (round 6)', await ev(`
    const cells = [...document.querySelectorAll('${A} .flowmap-pop .flowmap-palette > *')].map(e => e.getBoundingClientRect())
    return cells.slice(0, 8).every((r, i) => Math.abs(r.x - cells[i + 9].x) < 0.5) && !document.querySelector('${A} .flowmap-pop .lucide-pipette')`))
  await esc()

  // Test from the notes: a parent line takes its child's outline color unless the line has its own.
  const line = () => ev(`return getComputedStyle(document.querySelector('${A} .react-flow__edge[data-id="e-n4"] path.react-flow__edge-path')).stroke`)
  const followed = await line() === await cs('n4', shapePath, 'stroke')
  await dispatch(`b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n4' ? { ...n, edgeColor: 6 } : n) })`)
  check('a parent line follows its child\'s outline, until the line gets its own color', followed && await line() !== await cs('n4', shapePath, 'stroke'))

  // Item 13: node Fill "Match outline"; item 11: Board style fill and text "Node color".
  await selectOnly('n4'); await bar('Fill'); await pick('Match outline')
  check('Fill: Match outline fills the node with its own outline color', (await node('item drops, see [[Loot Tables]]')).fill === 'outline' && await cs('n4', shapePath, 'fill') === await cs('n4', shapePath, 'stroke'))
  await esc()
  await dispatch(`b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n2' ? { ...n, fill: null } : n) })`)
  await bar('Board style'); await bar('Fill opacity'); await pick('Fill every node')
  check('Board style: the fill toggle fills every node with its outline, empty ones too (round 12)', (await board()).theme.fillOutline === true && await cs('n2', shapePath, 'fill') === await cs('n2', shapePath, 'stroke'))
  await pick('Fill every node')
  check('Board style: turning the fill toggle off brings the empty fill back (round 12)', !(await board()).theme.fillOutline && await cs('n2', shapePath, 'fill') !== await cs('n2', shapePath, 'stroke'))
  await pick('Fill every node')
  await bar('Text color'); await pick('Node color')
  check('Board style: Node color draws each label in its outline color', (await board()).theme.textColor === 'node' && await cs('n2', '.flowmap-node', 'color') === await cs('n2', shapePath, 'stroke')
    && await cs('n3', '.flowmap-node', 'color') !== await cs('n2', '.flowmap-node', 'color'))
  await esc(); await bar('Board style'); await bar('Reset board style'); await esc()

  // Item 7: Arrange: align and tidy children.
  await selectOnly('n2'); let p = await nodeAt('Level Design'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  await dispatch(`b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n5' ? { ...n, x: n.x + 77 } : n) })`)
  await bar('Arrange'); await pick('Align left')
  check('Arrange: align left lines up the selected nodes', (await node('Combat System')).x === (await node('Level Design')).x)
  await esc()
  await dispatch(`b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n4' ? { ...n, x: 331, y: 333 } : n) })`)
  await selectOnly('n3'); await bar('Arrange'); await pick('Tidy children')
  const kid = await node('item drops, see [[Loot Tables]]')
  check('Arrange: Tidy children lays the branch out again', kid.x > (await node('Enemy Mechanics')).x + 100 && kid.y !== 333, `${kid.x},${kid.y}`)
  await esc()

  // Item 8 and the flowchart shapes: a new child takes its parent's shape; the shape grid has 12 shapes.
  await selectOnly('n3'); await bar('Shape')
  check('shape grid has the flowchart shapes, and no Label (12, round 7)', await ev(`return [...document.querySelectorAll('${A} .flowmap-pop .flowmap-tile')].map(t => t.ariaLabel).join()`) === 'Rectangle,Rounded,Pill,Parallelogram,Circle,Diamond,Hexagon,Underline,None,Document,Predefined process,Database')
  await pick('Database'); await esc()
  await selectOnly('n3'); await key('Tab', 'Tab'); await settle()
  // Item 12 ([[): the editor lists matching notes; Enter puts in the link.
  await type('see [[M6b Tar'); await sleep(300)
  const listed = await ev(`return [...document.querySelectorAll('${A} .flowmap-suggest-row')].map(r => r.textContent)`)
  await key('Enter', 'Enter'); await settle(); await key('Escape', 'Escape'); await settle()
  const made = (await board()).nodes.find(n => n.parent === 'n3' && n.id !== 'n4')
  check('a new child takes its parent\'s shape', made?.shape === 'cyl', made?.shape)
  check('typing [[ in a node suggests notes; Enter puts in the link', listed.some(t => t.startsWith('M6b Target note')) && made?.text === 'see [[M6b Target note]]', `${listed.join(' | ')} -> ${made?.text}`)

  await ev(`app.workspace.activeLeaf.detach(); for (const p of [${JSON.stringify(M6B)}, ${JSON.stringify(NOTE)}]) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// M6 beta: notes kept on save, settings keys, focus mode, levels, hide done, minimap, image export, sample board
{
  const M6 = 'M6 Check.board.md'
  const withNotes = readFileSync(SMALL, 'utf8').replace('\n## Board index', '\n# Plan notes\n\nKeep me.\n\n## Board index') + '\n## After\n\nKeep me too.\n'
  writeFileSync(`${VAULT}/${M6}`, withNotes)
  await sleep(800)
  await open(M6)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M6)}).view`
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const row = async text => { const b = await ev(`const el = [...document.querySelectorAll('${A} .flowmap-side-pop button')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`); if (b) { await click(b.x, b.y); await settle() } return !!b }
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  const dim = () => ev(`return [...document.querySelectorAll('${A} .react-flow__node.is-dim')].map(e => e.dataset.id).sort().join(',')`)

  // Notes above the index and after the data survive an edit and save.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n5' ? { ...n, text: 'Saved edit' } : n) })); return 1`); await sleep(3000)
  check('notes above the index and after the data are kept on save', disk(M6).includes('# Plan notes\n\nKeep me.') && disk(M6).includes('## After\n\nKeep me too.') && disk(M6).includes('"text":"Saved edit"'))

  // A key rebound in settings works on the board.
  await ev(`await app.plugins.plugins.mindmapmate.setKeys('toggleDone', ['Shift+KeyD']); return 1`); await settle()
  const sv = await nodeAt('Saved edit'); await click(sv.x, sv.y); await settle() // a click, so the board has focus
  await key('D', 'KeyD', ['shift']); await settle()
  check('a key set in settings works on the board', (await node('Saved edit')).status === 'done')
  await ev(`await app.plugins.plugins.mindmapmate.setKeys('toggleDone', undefined); return 1`); await settle()

  // F9 focus mode: the branch stays, the rest dims; Esc (after clearing the selection) leaves it.
  await selectOnly('n3'); await bar('Focus on the selected branch')
  const dimmed = await dim()
  // After fitting the branch, nodes far outside it may not be drawn at all; every drawn node outside it is dimmed.
  const lit = await ev(`return [...document.querySelectorAll('${A} .react-flow__node:not(.is-dim)')].map(e => e.dataset.id).sort().join(',')`)
  await key('Escape', 'Escape'); await settle(); await key('Escape', 'Escape'); await settle()
  check('focus mode dims everything outside the branch; Esc leaves it', lit === 'n3,n4' && dimmed.length > 0 && (await dim()) === '', `lit ${lit}, dimmed ${dimmed} / after ${await dim()}`)

  // F16 levels and hide done.
  const jump = () => ev(`document.querySelector('${A} .flowmap-levelnum').click(); return 1`).then(settle)
  await jump(); await row('Show levels 1 to 1')
  const collapsed = (await board()).nodes.find(n => n.id === 'n1').collapsed
  await jump(); await row('Expand all')
  check('collapse to a level, then expand all', collapsed === true && !(await board()).nodes.some(n => n.collapsed))
  await bar('Hide done tasks')
  const hid = !(await ev(`return !!document.querySelector('${A} .react-flow__node[data-id="n2"]')`))
  await bar('Show done tasks')
  check('hide done button hides done tasks and shows them again', hid && !!(await ev(`return !!document.querySelector('${A} .react-flow__node[data-id="n2"]')`)))

  // F16 minimap: a click on it moves the view.
  await ev(`await app.plugins.plugins.mindmapmate.set('minimap', true); return 1`); await sleep(400)
  const mm = await at('.flowmap-minimap canvas', 0.1)
  const vp0 = await ev(`return document.querySelector('${A} .react-flow__viewport').style.transform`)
  if (mm) { await click(mm.x - 80, mm.y); await sleep(300) }
  check('the minimap shows, and clicking it moves the view', !!mm && (await ev(`return document.querySelector('${A} .react-flow__viewport').style.transform`)) !== vp0)
  await ev(`await app.plugins.plugins.mindmapmate.set('minimap', false); return 1`)

  // F16 image export.
  await ev(`app.commands.executeCommandById('mindmapmate:export-svg'); await new Promise(r => setTimeout(r, 800)); app.commands.executeCommandById('mindmapmate:export-png'); await new Promise(r => setTimeout(r, 2500)); return 1`)
  const svgOk = await ev(`const f = app.vault.getAbstractFileByPath('M6 Check.svg'); if (!f) return false; const doc = new DOMParser().parseFromString(await app.vault.read(f), 'image/svg+xml')
    return !doc.querySelector('parsererror') && [...doc.querySelectorAll('text')].some(t => t.textContent === 'Enemy Mechanics') && doc.querySelectorAll('path').length > 8`)
  const pngOk = await ev(`const f = app.vault.getAbstractFileByPath('M6 Check.png'); if (!f) return false; const b = new Uint8Array(await app.vault.readBinary(f)); return b.length > 1000 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47`)
  check('export as SVG and PNG images', svgOk && pngOk)

  await ev(`app.workspace.activeLeaf.detach(); for (const p of [${JSON.stringify(M6)}, 'M6 Check.svg', 'M6 Check.png']) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)

  // Sample board.
  await ev(`app.commands.executeCommandById('mindmapmate:create-sample'); await new Promise(r => setTimeout(r, 1500)); return 1`)
  check('the sample board is created and opens', (await board())?.nodes.some(n => n.text === 'Welcome to MindmapMate') && (await board()).links.length === 1)
  await ev(`app.workspace.activeLeaf.detach(); const f = app.vault.getAbstractFileByPath('MindmapMate sample.board.md'); if (f) await app.vault.delete(f); return 1`)
}

// M6c feedback round 6: labels, line style passed to new children, animated lines, a TaskMindmap board still opens
{
  const R6 = 'Round 6 Check.board.md', OLD = 'Round 6 Old.board.md'
  copyFileSync(SMALL, `${VAULT}/${R6}`)
  writeFileSync(`${VAULT}/${OLD}`, readFileSync(SMALL, 'utf8').replace('flowmap: 1', 'taskmindmap: 1').replace('```flowmap-json', '```taskmindmap-json'))
  await sleep(800)
  await open(R6)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(R6)}).view`
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  const nodeBy = async text => (await board()).nodes.find(n => n.text === text)

  // N3: Add label makes a label being typed; A+ and A- step its size, and the node is drawn at that size.
  await bar('Add label'); await type('Section title'); await key('Escape', 'Escape'); await settle()
  const label = await nodeBy('Section title')
  await selectOnly(label.id); await bar('Bigger text'); await bar('Bigger text'); await bar('Smaller text')
  const size = await ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="${label.id}"] .flowmap-node')).fontSize`)
  check('Add label makes a label, and A+ / A- size its text (round 6)', label.shape === 'label' && label.parent === null && (await nodeBy('Section title')).textSize === 36 && size === '36px', `${label.shape} ${size}`)
  const labelBar = await ev(`return [...document.querySelectorAll('${A} .flowmap-bar button')].map(b => b.getAttribute('aria-label')).join()`)
  check('a label\'s toolbar is text color, size and reset only (round 7, no Arrange since round 13)', labelBar === 'Text color,Smaller text,Bigger text,Reset node style', labelBar)
  const before = (await board()).nodes.length
  await selectOnly(label.id); await key('Tab', 'Tab'); await settle()
  check('Tab on a label adds no child (round 7, D51)', (await board()).nodes.length === before && !(await ev(`return !!document.querySelector('${A} .flowmap-node textarea, ${A} .flowmap-node [contenteditable]')`)))
  await key('Escape', 'Escape')

  // N4: a child added with Tab takes the line style of its parent's own line.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, edgeDash: 'dotted', edgeArrow: 'dot' } : n) })); return 1`); await settle()
  await selectOnly('n3'); await key('Tab', 'Tab'); await settle(); await type('Inherits'); await key('Escape', 'Escape'); await settle()
  const kid = await nodeBy('Inherits')
  check('a new child takes its parent line\'s style (round 6)', kid?.parent === 'n3' && kid.edgeDash === 'dotted' && kid.edgeArrow === 'dot', JSON.stringify(kid))

  // Animated lines: set from the Line style flyout; ants move the dash, dots run along the line.
  const animate = async (id, name) => {
    await key('Escape', 'Escape'); await key('Escape', 'Escape')
    await ev(`${view}.canvas.current.select('n1'); return 1`); await key('Escape', 'Escape'); await settle()
    const p = await edgePoint(id, 0.5); await click(p.x, p.y); await settle()
    await bar('Line style')
    await ev(`document.querySelector('${A} .flowmap-pop .flowmap-tile[aria-label="${name}"]').click(); return 1`); await settle()
  }
  await animate('e-n2', 'Marching ants')
  const row = await ev(`return [...document.querySelectorAll('${A} .flowmap-pop .flowmap-tile')].map(t => t.getAttribute('aria-label') + (t.querySelector('.flowmap-ants, animateMotion') ? '*' : '')).join()`)
  check('dash styles and both animations share one row, and the animations move (round 7)', row === 'Solid,Dotted,Dashed,Marching ants*,Moving dots*', row)
  await animate('e-n5', 'Moving dots')
  const b6 = await board(), anim = await ev(`return { ants: getComputedStyle(document.querySelector('${A} .react-flow__edge[data-id="e-n2"] .react-flow__edge-path')).animationName, dots: document.querySelectorAll('${A} .react-flow__edge[data-id="e-n5"] .flowmap-flow-dot animateMotion').length }`)
  check('lines can march (ants) or carry moving dots (round 6)', b6.nodes.find(n => n.id === 'n2').edgeAnimate === 'ants' && b6.nodes.find(n => n.id === 'n5').edgeAnimate === 'dots'
    && anim.ants === 'flowmap-ants' && anim.dots >= 1, JSON.stringify(anim))

  // N1: a board saved by TaskMindmap opens as a board, and its next save uses the MindmapMate names.
  await open(OLD)
  const oldOpens = (await board())?.nodes.some(n => n.text === 'Enemy Mechanics')
  await ev(`app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(OLD)}).view.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n5' ? { ...n, text: 'Resaved' } : n) })); return 1`); await sleep(3000)
  check('a TaskMindmap board opens, and saves as MindmapMate (round 6)', oldOpens && disk(OLD).includes('flowmap: 1') && disk(OLD).includes('```flowmap-json') && !disk(OLD).includes('taskmindmap'))

  await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) if ([${JSON.stringify(R6)}, ${JSON.stringify(OLD)}].includes(l.view.file?.path)) l.detach()
    for (const p of [${JSON.stringify(R6)}, ${JSON.stringify(OLD)}]) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// M7 due dates: the node toolbar's date, the chip, the index, Show overdue (through a collapsed branch), clearing
{
  const M7 = 'M7 Check.board.md'
  copyFileSync(SMALL, `${VAULT}/${M7}`)
  await sleep(500)
  await open(M7)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M7)}).view`
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  // Round 17: our own calendar; a date is picked by its month offset from this month and its day number.
  const iso = (months, day) => { const d = new Date(new Date().getFullYear(), new Date().getMonth() + months, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const setDate = async (months, day) => { await ev(`const pop = document.querySelector('${A} .flowmap-pop')
    for (let i = 0; i < Math.abs(${months}); i++) pop.querySelector('[aria-label="${months < 0 ? 'Previous' : 'Next'} month"]').click()
    await new Promise(r => setTimeout(r, 60))
    ;[...pop.querySelectorAll('.flowmap-cal-day:not(.is-out)')].find(b => b.textContent === '${day}').click(); return 1`); await settle() }
  const chip = id => ev(`const el = document.querySelector('${A} .react-flow__node[data-id="${id}"] .flowmap-due'); return el && el.className + '|' + el.textContent`)

  await selectOnly('n4'); await bar('Due date'); await setDate(-1, 15); await key('Escape', 'Escape')
  await selectOnly('n5'); await bar('Due date'); await setDate(1, 15); await key('Escape', 'Escape'); await key('Escape', 'Escape'); await settle()
  const b7 = await board()
  check('the Due date button sets a date; the chip is red when overdue (M7)', b7.nodes.find(n => n.id === 'n4').due === iso(-1, 15) && b7.nodes.find(n => n.id === 'n5').due === iso(1, 15)
    && (await chip('n4'))?.includes('is-overdue') && (await chip('n5'))?.includes('is-later'), `${await chip('n4')} / ${await chip('n5')}`)
  await sleep(3000)
  check('the index carries the date for search, and as a #due tag (M7, round 8)', disk(M7).includes(`📅 ${iso(-1, 15)} #due/${iso(-1, 15)} ^n4`))

  // n4 sits under n3: collapse n3, then Show overdue opens it and selects n4 only.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, collapsed: true } : n) })); return 1`); await settle()
  await ev(`app.commands.executeCommandById('mindmapmate:show-overdue'); return 1`); await sleep(600)
  const sel = await ev(`return ${view}.canvas.current.selectedIds().join()`)
  check('Show overdue opens collapsed branches and selects the overdue tasks (M7)', sel === 'n4' && !(await board()).nodes.find(n => n.id === 'n3').collapsed, sel)

  // M8: n4 due today (under collapsed n3), n2 due in 3 days and doing, n5 blocked.
  const day = d => { const t = new Date(); t.setDate(t.getDate() + d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n4' ? { ...n, due: '${day(0)}' } : n.id === 'n2' ? { ...n, due: '${day(3)}', status: 'doing' }
    : n.id === 'n5' ? { ...n, status: 'blocked' } : n.id === 'n3' ? { ...n, collapsed: true } : n) })); return 1`); await settle()
  const shown = {}
  for (const c of ['show-due-today', 'show-due-week', 'show-blocked', 'show-doing']) {
    await ev(`app.commands.executeCommandById('mindmapmate:${c}'); return 1`); await sleep(500)
    shown[c] = await ev(`return ${view}.canvas.current.selectedIds().sort().join()`)
  }
  check('Show due today, due this week, blocked and doing select their tasks, opening collapsed branches (M8)',
    shown['show-due-today'] === 'n4' && shown['show-due-week'] === 'n2,n4' && shown['show-blocked'] === 'n5' && shown['show-doing'] === 'n2'
    && !(await board()).nodes.find(n => n.id === 'n3').collapsed, JSON.stringify(shown))

  // R24: the due/status filter. Ticks apply at once and the menu stays open; a click outside closes it, keeping them.
  const lit = () => ev(`return [...document.querySelectorAll('${A} .react-flow__node:not(.is-dim)')].map(e => e.dataset.id).sort().join()`)
  const row = async text => { const p = await ev(`const r = [...document.querySelectorAll('${A} .flowmap-controls .flowmap-menu-row')].find(e => e.textContent.startsWith('${text}'))?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }`); await click(p.x, p.y); await settle() }
  const menuOpen = () => ev(`return !!document.querySelector('${A} .is-filter .flowmap-menu')`)
  await key('!', 'Digit1', ['shift']); await sleep(400) // fit: the Show commands zoomed in, and off-screen nodes aren't drawn
  const num = async () => { await ev(`document.querySelectorAll('.notice').forEach(n => n.remove()); return 1`); return at(`.is-filter .flowmap-levelnum`) }; let nb = await num(); await click(nb.x, nb.y); await settle(); await row('Blocked'); await row('Due today')
  const f1 = { open: await menuOpen(), lit: await lit() }
  const corner = await paneCorner(); await click(corner.x, corner.y); await settle()
  const f2 = { open: await menuOpen(), lit: await lit(), on: await ev(`return document.querySelector('${A} .is-filter .flowmap-levelnum').classList.contains('is-active') && !document.querySelector('${A} .is-filter .flowmap-btn[aria-label^="Filter"]')`) }
  check('the filter menu stays open while ticking; matches stay full, the rest dim; a click outside closes it and keeps the filter (R24)',
    f1.open && f1.lit === 'n4,n5' && !f2.open && f2.lit === 'n4,n5' && f2.on, JSON.stringify([f1, f2]))
  await bar('Due within one day less'); await bar('Due within one more day'); await bar('Due within one more day')
  const f3 = { lit: await lit(), num: await ev(`return document.querySelector('${A} .is-filter .flowmap-levelnum').textContent`) }
  nb = await num(); await click(nb.x, nb.y); await settle(); await row('Clear filters'); await click(corner.x, corner.y); await settle()
  const f4 = await ev(`return document.querySelectorAll('${A} .react-flow__node.is-dim').length`)
  check('the day stepper sets N and ticks "Due in the next N days"; Clear filters undims everything (R24)', f3.num === '8d' && f3.lit === 'n2,n4,n5' && f4 === 0, JSON.stringify([f3, f4]))
  // R24: the chip colors from Preferences.
  await ev(`await app.plugins.plugins.mindmapmate.set('dueToday', '#00aa00'); return 1`); await settle()
  const green = await ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="n4"] .flowmap-due')).color`)
  await ev(`await app.plugins.plugins.mindmapmate.set('dueToday', ''); return 1`); await settle()
  const back = await ev(`return getComputedStyle(document.querySelector('${A} .react-flow__node[data-id="n4"] .flowmap-due')).color`)
  check('the due chip takes its color from Preferences, and the theme\'s again when cleared (R24)', green === 'rgb(0, 170, 0)' && back !== green, `${green} / ${back}`)

  await selectOnly('n4'); await bar('Due date')
  const clear = await ev(`const el = [...document.querySelectorAll('${A} .flowmap-pop button')].find(e => e.textContent.includes('Clear date')); el?.click(); return !!el`); await settle()
  check('Clear date removes the date and its chip (M7)', clear && !('due' in (await board()).nodes.find(n => n.id === 'n4')) && !(await chip('n4')))

  await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) if (l.view.file?.path === ${JSON.stringify(M7)}) l.detach()
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(M7)}); if (f) await app.vault.delete(f); return 1`)
}

// Round 8: Add node, Tidy whole board and Export in the canvas controls, Tidy as you add (on the grid with snap), the
// resized diamond, the export badge, the minimap's full height and the New board ribbon button.
{
  const M8 = 'M8 Check.board.md'
  copyFileSync(SMALL, `${VAULT}/${M8}`)
  await sleep(500)
  await open(M8)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M8)}).view`
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const row = async text => { const ok = await ev(`const el = [...document.querySelectorAll('${A} .flowmap-side-pop button')].find(e => e.textContent.includes(${JSON.stringify(text)})); el?.click(); return !!el`); await sleep(1500); return ok }
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  const exists = p => ev(`return !!app.vault.getAbstractFileByPath(${JSON.stringify(p)})`)

  await key('Escape', 'Escape'); await bar('Add node'); await type('Fresh'); await key('Escape', 'Escape'); await settle()
  const fresh = (await board()).nodes.find(n => n.text === 'Fresh')
  check('Add node in the controls makes a new root being typed (round 8)', fresh?.parent === null && fresh.shape === undefined, JSON.stringify(fresh))

  // Tidy as you add, with snap on: Tab under n1 re-tidies n1's tree onto the grid.
  await key('Escape', 'Escape'); await bar('Snap to grid')
  await bar('Board style'); await bar('Tidy as you add')
  const on = (await board()).theme.autoTidy === true
  await key('Escape', 'Escape')
  await selectOnly('n1'); await key('Tab', 'Tab'); await settle(); await type('Auto'); await key('Escape', 'Escape'); await sleep(600)
  const tree = (await board()).nodes.filter(n => n.id !== fresh?.id)
  const off = tree.filter(n => n.x % 20 || n.y % 20).map(n => `${n.text}@${n.x},${n.y}`)
  check('Tidy as you add re-tidies the tree onto the grid when snap is on (round 8)', on && tree.some(n => n.text === 'Auto') && !off.length, off.join(' '))

  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n2' ? { ...n, x: n.x + 333, y: n.y + 333 } : n) })); return 1`); await settle()
  await key('Escape', 'Escape'); await bar('Tidy whole board'); await settle()
  const n2 = (await board()).nodes.find(n => n.id === 'n2')
  check('Tidy whole board in the controls tidies the board (round 8)', n2.x % 20 === 0 && n2.y % 20 === 0 && n2.x < 1000, `${n2.x},${n2.y}`)
  await key('Escape', 'Escape'); await bar('Snap to grid')

  // A resized diamond with long text grows taller; its text stays inside the outline's middle box.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n5' ? { ...n, shape: 'diamond', width: 200, text: 'A long diamond text that has to wrap' } : n) })); return 1`); await sleep(600)
  const dia = await ev(`const n = document.querySelector('${A} .react-flow__node[data-id="n5"]'), t = n.querySelector('.flowmap-node-text'), a = n.getBoundingClientRect(), b = t.getBoundingClientRect()
    return { w: a.width, h: a.height, top: b.top - a.top, bottom: a.bottom - b.bottom }`)
  check('a resized diamond grows taller and keeps its text inside (round 8)', dia.top > dia.h * 0.15 && dia.bottom > dia.h * 0.15, JSON.stringify(dia))

  // Export from the controls: Markdown and an SVG that shows a collapsed branch's badge.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, collapsed: true } : n) })); return 1`); await settle()
  await key('Escape', 'Escape'); await bar('Export'); const svgRow = await row('SVG')
  const svg = (await exists('M8 Check.svg')) && disk('M8 Check.svg')
  await open(M8); await key('Escape', 'Escape'); await bar('Export'); const mdRow = await row('Markdown')
  check('Export in the controls writes Markdown and images; the image keeps "N hidden" (round 8)', svgRow && mdRow && !!svg && svg.includes('1 hidden') && await exists('M8 Check export.md'))

  await open(M8)
  await ev(`await app.plugins.plugins.mindmapmate.set('minimap', true); return 1`); await sleep(400)
  const mm = await ev(`const c = document.querySelector('${A} .flowmap-minimap canvas'); return [c.width, c.height, window.devicePixelRatio]`)
  await ev(`await app.plugins.plugins.mindmapmate.set('minimap', false); return 1`)
  check('the minimap canvas is drawn at its full height (round 8)', mm[1] === Math.round(140 * mm[2]) && mm[0] === Math.round(200 * mm[2]), mm.join())

  const before = await ev(`return app.vault.getFiles().length`)
  const ribbon = await ev(`const b = document.querySelector('.side-dock-ribbon-action[aria-label="Create new MindmapMate board"]'); b?.click(); return !!b`); await sleep(1500)
  const made = await ev(`return app.workspace.getActiveViewOfType(app.workspace.activeLeaf.view.constructor)?.file?.path ?? app.workspace.activeLeaf.view.file?.path`)
  check('the ribbon button creates and opens a new board (round 8)', ribbon && /Untitled( \d+)?\.board\.md$/.test(made) && await ev(`return app.vault.getFiles().length`) === before + 1, made)

  await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) if ([${JSON.stringify(M8)}, ${JSON.stringify(made)}].includes(l.view.file?.path)) l.detach()
    for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.file?.path === 'M8 Check export.md') l.detach()
    for (const p of [${JSON.stringify(M8)}, ${JSON.stringify(made)}, 'M8 Check.svg', 'M8 Check export.md']) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// Round 9: "Tidy as you add" tidies the board on open, when turned on and after a delete; export writes doing as [ ].
{
  const R9 = 'Round 9 Check.board.md'
  writeFileSync(`${VAULT}/${R9}`, readFileSync(SMALL, 'utf8').replace('"theme": {}', '"theme": {"autoTidy":true}')
    .replace('"x":320,"y":-120', '"x":1320,"y":880'))
  await sleep(500)
  await open(R9); await sleep(800)
  const col = async id => { const b = await board(); return [b.nodes.find(n => n.id === id)?.x, b.nodes.find(n => n.id === 'n3').x] }
  const [openX, openCol] = await col('n2')
  check('a board with Tidy as you add opens tidied (round 9)', openX === openCol, `${openX} vs ${openCol}`)

  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(R9)}).view`
  const push = `${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n5' ? { ...n, x: n.x + 777 } : n) }))`
  await ev(`${push}; return 1`); await settle()
  const cs = await nodeAt('Combat System'); await click(cs.x, cs.y); await settle()
  await key('Delete', 'Delete'); await sleep(600)
  const [delX, delCol] = await col('n5')
  check('deleting a node re-tidies its tree with Tidy as you add (round 9)', !(await board()).nodes.some(n => n.id === 'n2') && delX === delCol, `${delX} vs ${delCol}`)

  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (b) { await click(b.x, b.y); await settle() } }
  await key('Escape', 'Escape'); await bar('Board style'); await bar('Tidy as you add')
  await ev(`${push}; return 1`); await settle(); await bar('Tidy as you add')
  const [onX, onCol] = await col('n5')
  check('turning Tidy as you add on tidies the board (round 9)', (await board()).theme.autoTidy === true && onX === onCol, `${onX} vs ${onCol}`)

  await ev(`${push}; ${view}.canvas.current.select('n5'); return 1`); await settle()
  await ev(`app.commands.executeCommandById('mindmapmate:toggle-done'); return 1`); await sleep(600)
  const [boxX, boxCol] = await col('n5')
  check('adding a checkbox re-tidies with Tidy as you add (round 13)', !!(await board()).nodes.find(n => n.id === 'n5').status && boxX === boxCol, `${boxX} vs ${boxCol}`)

  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n4' ? { ...n, status: 'doing' } : n) })); app.commands.executeCommandById('mindmapmate:export-markdown'); return 1`)
  await sleep(1500)
  const md = disk('Round 9 Check export.md')
  check('export writes a doing task as an open box with a #status/doing tag (round 12)', md.includes('- [ ] item drops') && md.includes('#status/doing') && !md.includes('[/]'), JSON.stringify(md))

  await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) if (l.view.file?.path === ${JSON.stringify(R9)}) l.detach()
    for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.file?.path === 'Round 9 Check export.md') l.detach()
    for (const p of [${JSON.stringify(R9)}, 'Round 9 Check export.md']) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// D19 rename safety, board open and closed (Spike B)
await open(TEST)
const emNow = await nodeAt('Enemy Mechanics')
await click(emNow.x, emNow.y); await settle()
await ev(`app.commands.executeCommandById('mindmapmate:link-node'); return 1`); await sleep(300)
await type('Loot Tables'); await sleep(200); await key('Enter', 'Enter'); await settle()
check('link a node to a note', (await node('Enemy Mechanics'))?.link === 'Loot Tables.md')
writeFileSync(`${VAULT}/${CLOSED}`, readFileSync(SMALL, "utf8").replace('"text":"Combat System"', '"text":"Combat System","link":"Loot Tables.md"'))
await sleep(1500)
await ev(`await app.vault.createFolder('Check moved'); await app.fileManager.renameFile(app.vault.getAbstractFileByPath('Loot Tables.md'), 'Check moved/Loot Tables.md'); await new Promise(r => setTimeout(r, 1500)); return 1`)
check('rename updates an open board', (await node('Enemy Mechanics')).link === 'Check moved/Loot Tables.md')
check('rename updates a closed board on disk', disk(CLOSED).includes('"link":"Check moved/Loot Tables.md"'))
await ev(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath('Check moved'), 'Check moved 2'); await new Promise(r => setTimeout(r, 1500)); return 1`)
check('folder move updates both', (await node('Enemy Mechanics')).link === 'Check moved 2/Loot Tables.md' && disk(CLOSED).includes('"link":"Check moved 2/Loot Tables.md"'))
await ev(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath('Check moved 2/Loot Tables.md'), 'Loot Tables.md'); await app.vault.delete(app.vault.getAbstractFileByPath('Check moved 2'), true); await new Promise(r => setTimeout(r, 1000)); return 1`)
const link = await at(`.react-flow__node[data-id="${em.id}"] .flowmap-node-link .internal-link`)
await click(link.x, link.y); await sleep(600)
check('clicking the link opens the note', await ev(`return app.workspace.getActiveFile()?.path`) === 'Loot Tables.md')

// M5 Obsidian links (F10, F12 deep links, F13 import, D19, D21)
{
  const M5 = 'M5 Check.board.md', M5C = 'M5 Check closed.board.md', NOTE = 'M5 Target.md'
  const src = readFileSync(SMALL, 'utf8').replaceAll('Loot Tables', 'M5 Target')
  writeFileSync(`${VAULT}/${NOTE}`, 'target\n')
  writeFileSync(`${VAULT}/${M5}`, src)
  writeFileSync(`${VAULT}/${M5C}`, src)
  await sleep(1500)
  await open(M5)
  const linkSel = `.react-flow__node[data-id="n4"] .internal-link`
  const unresolved = () => ev(`return document.querySelector('.workspace-leaf.mod-active ${linkSel}')?.classList.contains('is-unresolved')`)
  let wl = await at(linkSel)
  check('a wikilink in node text is drawn as a link', !!wl && (await unresolved()) === false)
  // Underlined as the theme's --link-decoration says (Obsidian's own a rule; Minimal sets none).
  check('the link is decorated like a note link', await ev(`const a = document.querySelector('.workspace-leaf.mod-active ${linkSel}'); return getComputedStyle(a).textDecorationLine === getComputedStyle(document.body).getPropertyValue('--link-decoration').trim()`))
  await mouse('mouseMoved', wl.x, wl.y, { button: 'none' }); await sleep(1500)
  check('hovering a link shows the page preview', await ev(`return !!document.querySelector('.hover-popover')`))
  await mouse('mouseMoved', pane.x, pane.y, { button: 'none' }); await sleep(800)
  await click(wl.x, wl.y); await sleep(600)
  check('clicking a text link opens the note', await ev(`return app.workspace.getActiveFile()?.path`) === NOTE)
  await open(M5)

  // Link field, saved into the index as a wikilink
  const n3 = await nodeAt('Enemy Mechanics')
  await click(n3.x, n3.y); await settle()
  await ev(`app.commands.executeCommandById('mindmapmate:link-node'); return 1`); await sleep(300)
  await type('M5 Target'); await sleep(200); await key('Enter', 'Enter'); await sleep(3000)
  check('the link field is saved into the index', disk(M5).includes('- Enemy Mechanics [[M5 Target]] ^n3'))
  const backlinks = await ev(`const b = app.metadataCache.getBacklinksForFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})); return [...(b.data instanceof Map ? b.data.keys() : Object.keys(b.data))].sort()`)
  check('the note\'s backlinks list both boards', backlinks.includes(M5) && backlinks.includes(M5C), backlinks.join(', '))

  // D19: rename and move, board open and closed, with an unsaved edit on the open board
  const m5view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(M5)}).view`
  await ev(`${m5view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n5' ? { ...n, text: 'Unsaved edit' } : n) })); return 1`)
  await ev(`await app.vault.createFolder('M5 moved').catch(() => {}); await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), 'M5 moved/M5 Renamed.md'); await new Promise(r => setTimeout(r, 3500)); return 1`)
  const n4line = '        - item drops, see [[M5 Renamed]] (todo) ^n4\n'
  check('rename: open board text link and link field follow', (await node('item drops, see [[M5 Renamed]]'))?.id === 'n4' && (await node('Enemy Mechanics')).link === 'M5 moved/M5 Renamed.md')
  check('rename: an unsaved edit on the open board survives Obsidian\'s link update', (await node('Unsaved edit'))?.id === 'n5' && disk(M5).includes('"text":"Unsaved edit"'), (await board()).nodes.find(n => n.id === 'n5').text)
  check('rename: open board saves a clean index', disk(M5).includes(n4line) && disk(M5).includes('- Enemy Mechanics [[M5 moved/M5 Renamed]] ^n3'))
  check('rename: closed board data and index follow, index not garbled', disk(M5C).includes('"text":"item drops, see [[M5 Renamed]]"') && disk(M5C).includes(n4line))
  // A full-path link that only the board data holds (the index is stale), then a folder move.
  writeFileSync(`${VAULT}/${M5C}`, disk(M5C).replace('"text":"Combat System"', '"text":"see [[M5 moved/M5 Renamed]]"'))
  await sleep(1500)
  await ev(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath('M5 moved'), 'M5 moved 2'); await new Promise(r => setTimeout(r, 2500)); return 1`)
  check('folder move: link field and full-path text links follow', (await node('Enemy Mechanics')).link === 'M5 moved 2/M5 Renamed.md'
    && disk(M5C).includes('"text":"see [[M5 Renamed]]"') && !disk(M5C).includes('M5 moved/'))

  // Delete keeps links, drawn unresolved; bringing the note back resolves them again.
  const before = disk(M5C)
  await ev(`await app.vault.delete(app.vault.getAbstractFileByPath('M5 moved 2/M5 Renamed.md')); await new Promise(r => setTimeout(r, 1200)); return 1`)
  check('delete: links stay, drawn unresolved, closed board untouched', (await unresolved()) === true && (await node('Enemy Mechanics')).link === 'M5 moved 2/M5 Renamed.md' && disk(M5C) === before)
  await ev(`await app.vault.create('M5 moved 2/M5 Renamed.md', 'back'); await new Promise(r => setTimeout(r, 1200)); return 1`)
  check('the note coming back resolves the link again', (await unresolved()) === false)

  // D21: a block link opens the board zoomed to the node, expanding its collapsed branch; a search hit selects its node.
  await ev(`${m5view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => n.id === 'n3' ? { ...n, collapsed: true } : n) })); return 1`)
  await sleep(3000)
  await ev(`await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('M5 moved 2/M5 Renamed.md')); await new Promise(r => setTimeout(r, 500)); return 1`)
  await ev(`await app.workspace.openLinkText('M5 Check.board#^n4', '', false); await new Promise(r => setTimeout(r, 1200)); return 1`)
  const selectedId = () => ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__node.selected')?.dataset.id`)
  const zoom = () => ev(`return new DOMMatrix(document.querySelector('.workspace-leaf.mod-active .react-flow__viewport').style.transform).a`)
  check('block link opens the board on that node, expanded and zoomed in', (await selectedId()) === 'n4' && (await zoom()) >= 1 && !(await node('Enemy Mechanics')).collapsed)
  await ev(`const f = app.vault.getAbstractFileByPath(${JSON.stringify(M5)}); const t = await app.vault.read(f); const i = t.indexOf('Unsaved edit')
    await app.workspace.getLeaf(false).openFile(f, { eState: { match: { content: t, matches: [[i, i + 12]] } } }); await new Promise(r => setTimeout(r, 800)); return 1`)
  check('a search hit selects its node', (await selectedId()) === 'n5')

  // F10: Promote to note
  const lv = await nodeAt('Unsaved edit')
  await click(lv.x, lv.y); await settle()
  await ev(`app.commands.executeCommandById('mindmapmate:promote-to-note'); await new Promise(r => setTimeout(r, 800)); return 1`)
  check('promote to note creates the note and links the node', (await board()).nodes.find(n => n.id === 'n5').link === 'Unsaved edit.md'
    && await ev(`return !!app.vault.getAbstractFileByPath('Unsaved edit.md')`))

  // F13: import an outline as a new, tidied board
  writeFileSync(`${VAULT}/M5 Outline.md`, '---\ntags: [x]\n---\n# Game\nintro\n## Combat\n- [x] melee\n\t- combos\n## Levels\n- forest\n')
  await sleep(1000)
  await ev(`app.commands.executeCommandById('mindmapmate:import-outline'); return 1`); await sleep(300)
  await type('M5 Outline.md'); await sleep(200); await key('Enter', 'Enter'); await sleep(2000)
  const imported = await board()
  const byText = new Map(imported?.nodes.map(n => [n.text, n]) ?? [])
  check('import builds the tree under a root named after the note', byText.get('M5 Outline')?.parent === null && byText.get('Game')?.parent === 'root'
    && byText.get('combos')?.parent === byText.get('melee')?.id && byText.get('melee').status === 'done' && !byText.has('tags: [x]'))
  check('import tidies the new board', new Set(imported.nodes.map(n => `${n.x},${n.y}`)).size === imported.nodes.length)

  await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) l.detach(); await new Promise(r => setTimeout(r, 300)); return 1`)
  await ev(`for (const p of ['M5 moved 2', 'Unsaved edit.md', 'M5 Outline.md', 'M5 Outline.board.md', ${JSON.stringify(M5)}, ${JSON.stringify(M5C)}]) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f, true) } return 1`)
}

// Round 14: delete keeping children, insert on a line, no dots on selected nodes, [[ by mouse, settings color picker
{
  const R14 = 'R14 Check.board.md', NOTE = 'R14 Target note.md'
  copyFileSync(SMALL, `${VAULT}/${R14}`)
  await ev(`if (!app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})) await app.vault.create(${JSON.stringify(NOTE)}, 'target'); return 1`)
  await sleep(500)
  await open(R14)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(R14)}).view`
  const selectOnly = async id => { await ev(`${view}.canvas.current.select('${id}'); return 1`); await settle() }
  const pane = await paneCorner()

  // Item 1: Shift+Delete deletes a node and keeps its children, which move up to its parent.
  let p = await nodeAt('Enemy Mechanics'); await click(p.x, p.y); await settle()
  await key('Delete', 'Delete', ['shift']); await settle()
  let b = await board()
  check('Shift+Delete deletes the node and its children move up (round 14)', !b.nodes.some(n => n.id === 'n3') && b.nodes.find(n => n.id === 'n4')?.parent === 'n1')
  await key('z', 'KeyZ', ['ctrl']); await settle()
  check('undo brings the node back with its children', (await board()).nodes.find(n => n.id === 'n4')?.parent === 'n3')

  // Item 1: Tab with a parent line selected puts a new node on it.
  await click(pane.x, pane.y); await settle()
  const mid = await edgePoint('e-n4', 0.5)
  await click(mid.x, mid.y); await settle()
  await key('Tab', 'Tab'); await settle(); await type('Inserted'); await key('Escape', 'Escape'); await settle()
  b = await board()
  const ins = b.nodes.find(n => n.text === 'Inserted')
  check('Tab on a selected line inserts a node between parent and child (round 14)', ins?.parent === 'n3' && b.nodes.find(n => n.id === 'n4')?.parent === ins?.id, `${ins?.parent} / ${b.nodes.find(n => n.id === 'n4')?.parent}`)
  await key('z', 'KeyZ', ['ctrl']); await settle()

  // Items 4 and 5: with two nodes selected, pressing where a dot would be drags both, and makes no line. (The side dots
  // sit on a selected node's resize edges, so the bottom one.)
  await click(pane.x, pane.y); await settle()
  p = await nodeAt('Level Design'); await click(p.x, p.y)
  p = await nodeAt('Combat System'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  const dot = await at(`.react-flow__node[data-id="n5"] .react-flow__handle-bottom`)
  const before = await board()
  await drag(dot.x, dot.y - 3, dot.x + 80, dot.y + 60); await settle()
  b = await board()
  const movedBy = id => b.nodes.find(n => n.id === id).x - before.nodes.find(n => n.id === id).x
  check('a drag from a selected node\'s dot moves the selection, no new node (round 14)', b.nodes.length === before.nodes.length && movedBy('n5') > 40 && movedBy('n5') === movedBy('n2'), `${movedBy('n5')}, ${movedBy('n2')}`)
  await key('z', 'KeyZ', ['ctrl']); await settle()

  // Item 6: a click on a [[ suggestion puts in the link, like Enter.
  await selectOnly('n5'); await key('Tab', 'Tab'); await settle()
  await type('see [[R14 Tar'); await sleep(300)
  const row = await at('.flowmap-suggest-row')
  if (row) await click(row.x, row.y)
  await settle(); await key('Escape', 'Escape'); await settle()
  const made = (await board()).nodes.find(n => n.parent === 'n5')
  check('clicking a [[ suggestion puts in the link (round 14)', made?.text === 'see [[R14 Target note]]', made?.text)

  // Item 3: the grid dots color in settings is the plugin's own picker, not the system dialog.
  // The tab is drawn off screen (settings can open in their own window, out of the driver's reach).
  const tab = `app.setting.pluginTabs.find(t => t.id === 'mindmapmate')`
  await ev(`${tab}.display(); document.body.append(${tab}.containerEl); await new Promise(r => setTimeout(r, 300)); return 1`)
  const closed = await ev(`return !${tab}.containerEl.querySelector('.flowmap-hsl')`)
  await ev(`${tab}.containerEl.querySelector('button.flowmap-swatch').click(); await new Promise(r => setTimeout(r, 200)); return 1`)
  const picker = await ev(`const s = ${tab}.containerEl; return { hsl: !!s.querySelector('.flowmap-settings-color .flowmap-hsl'), native: !!s.querySelector('input[type=color]') }`)
  await ev(`const i = ${tab}.containerEl.querySelector('.flowmap-settings-color .flowmap-hex'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, '#00ff00'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise(r => setTimeout(r, 200)); return 1`)
  const color = await ev(`return app.plugins.plugins.mindmapmate.settings.gridColor`)
  await ev(`${tab}.hide(); ${tab}.containerEl.remove(); await app.plugins.plugins.mindmapmate.set('gridColor', ''); return 1`)
  check('settings pick the grid dots color with the plugin\'s picker from a swatch, no system dialog (rounds 14, 15)', closed && picker.hsl && !picker.native && color === '#00ff00', `${JSON.stringify(picker)} ${color}`)

  await ev(`app.workspace.activeLeaf.detach(); for (const p of [${JSON.stringify(R14)}, ${JSON.stringify(NOTE)}]) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// Round 15: Add node on a selected line, a line dropped on a selected group, the settings screen
{
  const R15 = 'R15 Check.board.md'
  copyFileSync(SMALL, `${VAULT}/${R15}`)
  await sleep(500)
  await open(R15)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const pane = await paneCorner()

  // Item 3: with a parent line selected, the Add node button puts the new node on it, like Tab.
  await click(pane.x, pane.y); await settle()
  const mid = await edgePoint('e-n4', 0.5)
  await click(mid.x, mid.y); await settle()
  await ev(`document.querySelector('${A} .flowmap-btn[aria-label="Add node"]').click(); return 1`); await settle()
  await type('Inserted'); await key('Escape', 'Escape'); await settle()
  let b = await board()
  const ins = b.nodes.find(n => n.text === 'Inserted')
  check('Add node with a line selected inserts a node on it (round 15)', ins?.parent === 'n3' && b.nodes.find(n => n.id === 'n4')?.parent === ins?.id, `${ins?.parent}`)
  // Two steps: the text, then the node.
  await key('z', 'KeyZ', ['ctrl']); await key('z', 'KeyZ', ['ctrl']); await settle()
  check('undo takes the inserted node off the line', (await board()).nodes.find(n => n.id === 'n4')?.parent === 'n3')

  // Item 2: a line from Level Design dropped on a selected group (Combat System, Enemy Mechanics and its child) takes
  // the group's top nodes as children; the child stays under its parent. One undo step.
  let p = await nodeAt('Combat System'); await click(p.x, p.y)
  p = await nodeAt('Enemy Mechanics'); await click(p.x, p.y, { m: ['shift'] })
  p = await nodeAt('item drops'); await click(p.x, p.y, { m: ['shift'] }); await settle()
  const from = await nodeAt('Level Design')
  await mouse('mouseMoved', from.x, from.y, { button: 'none' }); await sleep(150)
  const dot = await at(`.react-flow__node[data-id="n5"] .react-flow__handle-right`)
  const onto = await nodeAt('Enemy Mechanics')
  await drag(dot.x, dot.y, onto.x, onto.y); await settle()
  b = await board()
  const par = id => b.nodes.find(n => n.id === id)?.parent
  check('a line dropped on a selected group takes its top nodes as children (round 15)', par('n2') === 'n5' && par('n3') === 'n5' && par('n4') === 'n3', `${par('n2')} ${par('n3')} ${par('n4')}`)
  await key('z', 'KeyZ', ['ctrl']); await settle()
  b = await board()
  check('one undo puts the group back', par('n2') === 'n1' && par('n3') === 'n1')

  // Item 1: snap and minimap are gone from settings; grid dots are there, off by default.
  const tab = `app.setting.pluginTabs.find(t => t.id === 'mindmapmate')`
  await ev(`${tab}.display(); document.body.append(${tab}.containerEl); await new Promise(r => setTimeout(r, 300)); return 1`)
  const names = await ev(`return [...${tab}.containerEl.querySelectorAll('.setting-item-name')].map(e => e.textContent)`)
  await ev(`${tab}.hide(); ${tab}.containerEl.remove(); return 1`)
  check('settings have Grid dots but no Snap to grid or Minimap (round 15)', names.includes('Grid dots') && !names.includes('Snap to grid') && !names.includes('Minimap'), names.slice(0, 8).join(', '))

  await ev(`app.workspace.activeLeaf.detach(); const f = app.vault.getAbstractFileByPath(${JSON.stringify(R15)}); if (f) await app.vault.delete(f); return 1`)
}

// D18: unreadable files show the error panel and are never written
for (const f of ['Fixtures/corrupt.board.md', 'Fixtures/newer-schema.board.md']) {
  const text = disk(f), mtime = statSync(`${VAULT}/${f}`).mtimeMs
  await open(f)
  const panel = await ev(`return !!document.querySelector('.workspace-leaf.mod-active .flowmap-error')`)
  await ev(`app.workspace.getLeaf(false).detach(); await new Promise(r => setTimeout(r, 2500)); return 1`)
  check(`${f}: error panel, file untouched`, panel && disk(f) === text && statSync(`${VAULT}/${f}`).mtimeMs === mtime)
}

// D18: external edit reloads and keeps the viewport
await open(TEST)
await ev(`const b = document.querySelector('.workspace-leaf.mod-active .flowmap-btn[aria-label="Zoom in"]'); b.click(); b.click(); await new Promise(r => setTimeout(r, 500)); return 1`)
const viewport = () => ev(`return document.querySelector('.workspace-leaf.mod-active .react-flow__viewport').style.transform`)
const v1 = await viewport()
writeFileSync(`${VAULT}/${TEST}`, disk(TEST).replace('"text":"Combat System"', '"text":"Edited outside"'))
await sleep(2500)
check('external edit reloads and keeps the viewport', !!(await node('Edited outside')) && (await viewport()) === v1)

// D22: same board in two tabs
check('two tabs: an edit in one reaches the other', await ev(`
  const f = app.vault.getAbstractFileByPath(${JSON.stringify(TEST)})
  const a = app.workspace.getLeaf('tab'); await a.openFile(f)
  const b = app.workspace.getLeaf('split'); await b.openFile(f)
  await new Promise(r => setTimeout(r, 800))
  a.view.store.dispatch(bd => ({ ...bd, nodes: bd.nodes.map(n => n.id === 'n3' ? { ...n, text: 'Two tabs' } : n) }))
  await new Promise(r => setTimeout(r, 3500))
  const ok = b.view.store.board.nodes.find(n => n.id === 'n3').text === 'Two tabs'
  a.detach(); b.detach()
  return ok`))

// Round 17: settings About and the color popover, the level stepper, Arrange on roots, the calendar, the HTML export
{
  const R17 = 'R17 Check.board.md'
  copyFileSync(SMALL, `${VAULT}/${R17}`)
  await sleep(500)
  await open(R17)
  await key('!', 'Digit1', ['shift']); await sleep(400)
  const A = '.workspace-leaf.mod-active'
  const view = `app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.file?.path === ${JSON.stringify(R17)}).view`
  const bar = async label => { const b = await at(`.flowmap-btn[aria-label^="${label}"]`); if (!b) return false; await click(b.x, b.y); await settle(); return true }
  const pickRow = async label => { await ev(`[...document.querySelectorAll('${A} .flowmap-pop button')].find(e => e.textContent.trim() === ${JSON.stringify(label)})?.click(); return 1`); await settle() }

  // The level stepper: chevrons step one level, the L-number shows where you are.
  const lvl = () => ev(`return document.querySelector('${A} .flowmap-levelnum')?.textContent`)
  const press = label => ev(`document.querySelector('${A} .flowmap-btn[aria-label="${label}"]').click(); return 1`).then(settle)
  const order = await ev(`return [...document.querySelectorAll('${A} .flowmap-group.is-levels:not(.is-filter) .flowmap-btn')].map(b => b.getAttribute('aria-label')).join()`)
  check('the level stepper: up chevron shows more levels, down shows fewer (R25, D62)', order === 'Show one level more,Show one level less', order)
  if (process.env.SHOT) (await import('node:fs')).writeFileSync(process.env.SHOT, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  const start = await lvl()
  await press('Show one level less'); const l2 = await lvl(), hid = (await board()).nodes.filter(n => n.collapsed).length
  await press('Show one level less'); const l1 = await lvl()
  const upOff = await ev(`return document.querySelector('${A} .flowmap-btn[aria-label="Show one level less"]').disabled`)
  await press('Show one level more'); await press('Show one level more'); const back = await lvl()
  const noneShut = (await board()).nodes.every(n => !n.collapsed)
  check('the level stepper folds and opens one level at a time and shows L1-L3 (round 17)', start === 'L3' && l2 === 'L2' && hid > 0 && l1 === 'L1' && upOff && back === 'L3' && noneShut, `${start} ${l2} ${l1} ${back}`)

  // Tidy children on selected roots lines the roots up and leaves their children where they are.
  await ev(`${view}.store.dispatch(b => ({ ...b, nodes: [...b.nodes,
    { id: 'r1', parent: null, order: 1, text: 'Root A', x: 900, y: 0 }, { id: 'r2', parent: null, order: 2, text: 'Root B', x: 1000, y: 300 },
    { id: 'r3', parent: null, order: 3, text: 'Root C', x: 950, y: 90 }, { id: 'r4', parent: 'r3', order: 0, text: 'Child of C', x: 1200, y: 90 }] })); return 1`); await settle()
  await ev(`${view}.canvas.current.selectAndFit(['r1', 'r2', 'r3']); return 1`); await sleep(500)
  await ev(`document.querySelector('${A} .flowmap-btn[aria-label^="Arrange"]').click(); return 1`); await settle(); await pickRow('Tidy children'); await settle()
  const roots = (await board()).nodes.filter(n => ['r1', 'r2', 'r3', 'r4'].includes(n.id)), at17 = id => roots.find(n => n.id === id)
  const ys = ['r1', 'r3', 'r2'].map(id => at17(id).y)
  check('Tidy children on selected roots left-aligns them, spaces them evenly, and leaves their children (round 17)',
    ['r1', 'r2', 'r3'].every(id => at17(id).x === 900) && ys[0] === 0 && ys[2] === 300 && ys[1] > 0 && ys[1] < 300 && at17('r4').x === 1200 && at17('r4').y === 90, JSON.stringify(roots.map(n => [n.id, n.x, n.y])))
  await ev(`${view}.store.undo(); return 1`); await settle()
  check('one undo puts the roots back (round 17)', (await board()).nodes.find(n => n.id === 'r2').x === 1000 && (await board()).nodes.find(n => n.id === 'r1').y === 0 && (await board()).nodes.find(n => n.id === 'r3').x === 950)

  // The calendar is ours: no system date input, themed by Obsidian's variables, marks today, picks a day.
  await ev(`${view}.canvas.current.select('n5'); return 1`); await settle()
  await bar('Due date')
  const cal = await ev(`const pop = document.querySelector('${A} .flowmap-pop'); return { native: !!pop.querySelector('input[type=date]'), today: !!pop.querySelector('.flowmap-cal-day.is-today'), days: pop.querySelectorAll('.flowmap-cal-day').length, bg: getComputedStyle(pop.querySelector('.flowmap-cal')).color !== '' }`)
  await ev(`[...document.querySelectorAll('${A} .flowmap-cal-day.is-today')][0].click(); return 1`); await settle()
  const todayIso = new Date().toLocaleDateString('en-CA')
  check('the due date calendar is our own: 42 days, today marked, a click sets the date and closes (round 17)',
    !cal.native && cal.today && cal.days === 42 && (await board()).nodes.find(n => n.id === 'n5').due === todayIso && !(await at('.flowmap-pop .flowmap-cal')), JSON.stringify(cal))

  // The HTML export, loaded in a frame like a browser would: fold a branch, pick a status, drag a branch.
  await ev(`await app.plugins.plugins.mindmapmate.exportBoard(${view}, 'html'); return 1`); await sleep(400)
  const out = await ev(`const f = app.vault.getAbstractFileByPath('R17 Check.html'); return f ? await app.vault.read(f) : ''`)
  const htmlChecks = await ev(`
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:600px;z-index:99999'
    fr.srcdoc = ${JSON.stringify(out)}; document.body.append(fr); await new Promise(r => fr.onload = r); await new Promise(r => setTimeout(r, 300))
    const d = fr.contentDocument, w = fr.contentWindow, svg = d.querySelector('svg')
    const ptr = (target, type, x, y) => target.dispatchEvent(new w.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
    const g = id => d.querySelector('.n[data-id="' + id + '"]'), shown = el => el.style.display !== 'none'
    const r = { nodes: d.querySelectorAll('.n').length, edges: d.querySelectorAll('.e').length, boxes: d.querySelectorAll('.cb').length, csp: !!d.querySelector('meta[http-equiv]') }
    r.pgBefore = g('n1').querySelector('.pg')?.textContent
    ptr(g('n3').querySelector('.tg'), 'pointerdown', 0, 0); r.folded = !shown(g('n4')) && !shown(d.querySelector('.e[data-b="n4"]')) && g('n3').querySelector('.tg text').textContent
    ptr(g('n3').querySelector('.tg'), 'pointerdown', 0, 0); r.unfolded = shown(g('n4'))
    ptr(g('n5').querySelector('.cb'), 'pointerdown', 5, 5); r.menu = [...d.querySelectorAll('#menu button')].map(b => b.textContent)
    r.menuSvg = Math.round(d.querySelector('#menu svg').getBoundingClientRect().width)
    ;[...d.querySelectorAll('#menu button')].find(b => b.textContent === 'Done').click()
    r.status = g('n5').querySelector('.cb').dataset.s; r.pgAfter = g('n1').querySelector('.pg')?.textContent
    const before = g('n3').getAttribute('transform'), kidBefore = g('n4').getAttribute('transform'), b = g('n3').getBoundingClientRect()
    ptr(g('n3').querySelector('path'), 'pointerdown', b.x + 5, b.y + 5); ptr(svg, 'pointermove', b.x + 65, b.y + 45); ptr(svg, 'pointerup', b.x + 65, b.y + 45)
    const nb = g('n5').getBoundingClientRect(), cbr = g('n5').querySelector('.cb').getBoundingClientRect()
    r.hitNode = d.elementFromPoint(nb.right - 6, nb.top + nb.height / 2)?.closest('.n')?.dataset.id
    r.hitBox = !!d.elementFromPoint(cbr.left + 1, cbr.top + 1)?.closest('.cb')
    r.noSelect = w.getComputedStyle(d.body).userSelect
    r.moved = g('n3').getAttribute('transform') !== before && g('n4').getAttribute('transform') !== kidBefore && g('n2').getAttribute('transform') === 'translate(320 -120)'
    fr.remove(); return r`)
  check('the HTML export is one page with every node and line, and a policy that blocks the network (round 17)', htmlChecks.nodes === 9 && htmlChecks.edges === 6 && htmlChecks.csp, JSON.stringify(htmlChecks))
  check('HTML page: a node folds and unfolds its branch, a status can be picked and progress recounts, a branch drags (round 17)',
    htmlChecks.folded === '+1' && htmlChecks.unfolded && htmlChecks.menu.join() === 'Not done,Doing,Blocked,Done,Dropped' && htmlChecks.status === 'done' && htmlChecks.pgBefore === '1/2' && htmlChecks.pgAfter === '2/2' && htmlChecks.moved
    && htmlChecks.hitNode === 'n5' && htmlChecks.hitBox && htmlChecks.menuSvg <= 20 && htmlChecks.noSelect === 'none', JSON.stringify(htmlChecks))

  // Settings: the About block, and the grid color picker as a popover that closes on Escape.
  const tab = `app.setting.pluginTabs.find(t => t.id === 'mindmapmate')`
  await ev(`${tab}.display(); document.body.append(${tab}.containerEl); await new Promise(r => setTimeout(r, 300)); return 1`)
  const about = await ev(`return ${tab}.containerEl.querySelector('.flowmap-about')?.textContent ?? ''`)
  const coffee = await ev(`const a = ${tab}.containerEl.querySelector('.flowmap-about a.flowmap-coffee'); return { href: a?.getAttribute('href'), img: a?.querySelector('img')?.getAttribute('src') ?? '', h: Math.round(a?.getBoundingClientRect().height ?? 0) }`)
  const keys = await ev(`const c = ${tab}.containerEl, btn = [...c.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent === 'Hotkeys')?.querySelector('button')
    const tip = c.querySelector('.flowmap-about-tip'), f = c.querySelector('.flowmap-about-footer')
    return { btn: btn?.textContent, chips: c.querySelectorAll('.flowmap-keychip').length, tip: tip?.textContent, above: !!tip && tip.nextElementSibling === f, tipSize: getComputedStyle(tip).fontSize, bodySize: getComputedStyle(c.querySelector('.flowmap-about p')).fontSize, tipAlign: getComputedStyle(tip).textAlign, gap: Math.round(tip.getBoundingClientRect().top - c.querySelector('.flowmap-about p').getBoundingClientRect().bottom) }`)
  const hsl = () => ev(`return !!${tab}.containerEl.querySelector('.flowmap-hsl')`)
  const hsl0 = await hsl()
  await ev(`${tab}.containerEl.querySelector('button.flowmap-swatch').click(); await new Promise(r => setTimeout(r, 200)); return 1`)
  const hsl1 = await hsl(), shownPop = await ev(`return ${tab}.containerEl.querySelector('.flowmap-settings-pop').style.display !== 'none'`)
  // Round 22: no eyedropper; Reset goes back to the color the picker opened with.
  const eye = await ev(`const c = ${tab}.containerEl, had = !!c.querySelector('.flowmap-eyedropper'), r = c.querySelector('.flowmap-hsl .flowmap-reset'), open = app.plugins.plugins.mindmapmate.settings.gridColor
    const sl = c.querySelector('.flowmap-hsl input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(sl, '10'); sl.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 200))
    const changed = app.plugins.plugins.mindmapmate.settings.gridColor
    r?.click(); await new Promise(r => setTimeout(r, 300))
    return { had, hasReset: !!r, changed, reset: app.plugins.plugins.mindmapmate.settings.gridColor, open }`)
  await ev(`await app.plugins.plugins.mindmapmate.set('gridColor', ''); return 1`)
  // Round 22: a click anywhere outside the popover (not the swatch) closes it.
  await ev(`const d = ${tab}.containerEl.querySelector('.flowmap-about'); d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await new Promise(r => setTimeout(r, 200)); return 1`)
  const hsl2 = await hsl()
  // Round 19: a normal-size title, and the coffee button at the right edge after "Made with care".
  const head = await ev(`const c = ${tab}.containerEl, n = c.querySelector('.flowmap-about-name'), v = c.querySelector('.flowmap-about-title'), a = c.querySelector('.flowmap-coffee').getBoundingClientRect(), f = c.querySelector('.flowmap-about-footer').getBoundingClientRect(), t = c.querySelector('.flowmap-about-footer span').getBoundingClientRect()
    return { name: parseFloat(getComputedStyle(n).fontSize), ver: parseFloat(getComputedStyle(v).fontSize), right: Math.round(f.right - a.right), before: t.right <= a.left, gap: Math.round(a.left - t.right), text: c.querySelector('.flowmap-about-footer span').textContent }`)
  const dueSw = await ev(`return ['Overdue color', 'Due today color', 'Later date color'].map(l => ${tab}.containerEl.querySelector('.flowmap-swatch[aria-label="' + l + '"]')?.style.background)`)
  check('settings: a Due date colors row with three swatches in the theme\'s colors (R24)', dueSw.every(c => c && c !== 'rgb(0, 0, 0)') && new Set(dueSw).size === 3, JSON.stringify(dueSw))
  const cards = await ev(`const c = ${tab}.containerEl, r = c.querySelector('.flowmap-about-row'), items = r.parentElement, next = items.closest('.setting-group').nextElementSibling?.querySelector('.setting-items')
    return { alone: items.children.length === 1, bg: getComputedStyle(items).backgroundColor, line: getComputedStyle(c.querySelector('.flowmap-about')).borderBottomWidth, options: next?.querySelector('.setting-item-name')?.textContent }`)
  check('settings: About alone on its own card, the options on a second card below it (R28, as FolderMate)', cards.alone && cards.bg !== 'rgba(0, 0, 0, 0)' && cards.line === '0px' && cards.options === 'Mouse wheel', JSON.stringify(cards))
  await ev(`${tab}.hide(); ${tab}.containerEl.remove(); return 1`)
  check('settings: the MindmapMate title is larger than the version line; the coffee button sits at the right, just after "Made with care" (rounds 19, 23)',
    head.name > head.ver && head.name >= 16 && head.right <= 2 && head.before && head.gap <= 16 && head.text === 'Made with care', JSON.stringify(head))
  check('settings start with a small version line, the description, and the coffee button that links to the page (round 18)',
    /^MindmapMate\s*v\d+\.\d+\.\d+ · by Droid/.test(about) && /interactive HTML pages/.test(about) && coffee.href === 'https://buymeacoffee.com/droidstreamer' && coffee.img.startsWith('data:image/png') && coffee.h <= 40, JSON.stringify(coffee) + about.slice(0, 60))
  check('settings: one Open hotkeys button, no key list; the tip line, body-text size and flush left with a blank line above it, sits right above the coffee footer (rounds 20, 22)', keys.btn === 'Open hotkeys' && keys.chips === 0 && /small tip/.test(keys.tip) && keys.above && keys.tipSize === keys.bodySize && ['left','start'].includes(keys.tipAlign) && keys.gap >= 14, JSON.stringify(keys))
  // 1.0.1: settings are declarative (Obsidian 1.13), so Obsidian's settings search can find each row.
  const defs = await ev(`return ${tab}.getSettingDefinitions().flatMap(d => d.items ?? [d]).map(d => d.name)`)
  check('settings are declarative rows that settings search indexes (1.0.1)', ['Mouse wheel', 'Copy', 'Export headings', 'Grid dots', 'Due date colors', 'Shortcut hints', 'Sample board', 'Hotkeys'].every(n => defs.includes(n)), defs.join(', '))
  check('the color picker has no eyedropper; Reset puts the color back to what it was when opened (round 22)', !eye.had && eye.hasReset && eye.changed !== eye.open && eye.reset === (eye.open || '#91919a'), JSON.stringify(eye))
  check('the grid color swatch opens the picker as a popover and a click outside puts it away (rounds 17, 22)', !hsl0 && hsl1 && shownPop && !hsl2, `${hsl0} ${hsl1} ${hsl2}`)

  // Round 19: HTML export asks where to save (suggests "<board>.html"), a cancelled dialog writes nothing, Obsidian has the real picker.
  const picks = await ev(`return window.__picks.slice(-1)`)
  await ev(`window.__cancel = true; window.__picks.length = 0; await app.plugins.plugins.mindmapmate.exportBoard(${view}, 'html'); window.__cancel = false; return 1`)
  check('export asks where to save; cancelling writes nothing; Obsidian has a native picker (round 19)',
    picks[0] === 'R17 Check.html' && await ev(`return window.__picks.length === 1 && !app.vault.getAbstractFileByPath('R17 Check 1.html') && window.__realPicker === 'function'`), JSON.stringify(picks))
  await ev(`app.workspace.activeLeaf.detach(); for (const p of [${JSON.stringify(R17)}, 'R17 Check.html']) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f) } return 1`)
}

// Clean close: no leaked listeners after 10 open/close cycles
const listeners = async () => {
  let total = 0
  for (const expr of ['window', 'document']) {
    const { result } = await call('Runtime.evaluate', { expression: expr })
    total += (await call('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length
  }
  return total
}
await ev(`for (const l of app.workspace.getLeavesOfType('flowmap-board')) l.detach(); return 1`)
await sleep(500)
const l0 = await listeners()
for (let i = 0; i < 10; i++) await ev(`const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(app.vault.getAbstractFileByPath('Fixtures/small.board.md')); await new Promise(r => setTimeout(r, 300)); leaf.detach(); return 1`)
await sleep(500)
const l1 = await listeners()
check('closing boards leaks no listeners', l1 === l0, `${l0} -> ${l1}`)

unlinkSync(`${VAULT}/${TEST}`)
unlinkSync(`${VAULT}/${CLOSED}`)
close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
