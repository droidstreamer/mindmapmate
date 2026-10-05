// Store screenshots and README animation, taken in a real Obsidian on "../showcase-vault/My Vault". `npm run build`, copy dist/
// into that vault's .obsidian/plugins/mindmapmate/, then `npm run showcase`. Output: ../showcase/ (1200x800 PNGs, demo.gif via make-gif.py).
// Boards use the outline-color fill at 40% (the user's choice for store images).
process.env.VAULT ??= '../showcase-vault/My Vault'; process.env.PORT ??= '9335'
const OUT = process.env.SHOTS ??= '../showcase'
const { PORT, VAULT, call, click, ev, key, mouse, sleep, type, wheel } = await import('./drive.mjs')
const { serializeBoardFile } = await import('../../src/core/io/boardFile.ts')
import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync(`${OUT}/raw`, { recursive: true })

// The showcase boards, written fresh for every scene so each frame starts from the same state.
const THEME = { fillOutline: true, fillOpacity: 40 }
const nodes = spec => spec.map(([id, parent, text, extra], i) =>
  ({ id, parent, order: spec.slice(0, i).filter(s => s[1] === parent).length, text, x: parent ? 400 : 0, y: i * 40, ...extra }))
const PLAN = 'Projects/Website Relaunch/Launch plan.board.md', GARDEN = 'Projects/Garden Plan/Garden ideas.board.md'
const BOARDS = {
  [PLAN]: { links: [], nodes: nodes([
    ['root', null, 'Website Relaunch', { shape: 'pill' }],
    ['design', 'root', 'Design'],
    ['d1', 'design', 'Moodboard', { status: 'done', link: 'Projects/Website Relaunch/Moodboard.md' }],
    ['d2', 'design', 'Wireframes', { status: 'done' }],
    ['d3', 'design', 'Visual design', { status: 'doing', due: '2026-10-07' }],
    ['d4', 'design', 'Accessibility review', { status: 'todo', due: '2026-10-14' }],
    ['content', 'root', 'Content'],
    ['c1', 'content', 'Rewrite the About page', { status: 'done' }],
    ['c2', 'content', 'Three case studies', { status: 'doing', due: '2026-10-05' }],
    ['c3', 'content', 'Team photo shoot', { status: 'blocked' }],
    ['build', 'root', 'Build'],
    ['b1', 'build', 'Pick a site generator', { status: 'done' }],
    ['b2', 'build', 'Page templates', { status: 'doing' }],
    ['b3', 'build', 'Contact form', { status: 'todo', due: '2026-10-02' }],
    ['b4', 'build', 'Pages load in under 1 s', { status: 'todo' }],
    ['launch', 'root', 'Launch'],
    ['l1', 'launch', 'Redirect the old URLs', { status: 'todo' }],
    ['l2', 'launch', 'Newsletter announcement', { status: 'todo', due: '2026-10-20' }],
    ['l3', 'launch', 'See the [[Sitemap]]'],
  ]) },
  [GARDEN]: { links: [], nodes: nodes([
    ['root', null, 'Garden ideas', { shape: 'pill' }],
    ['veg', 'root', 'Vegetables'], ['v1', 'veg', 'Tomatoes'], ['v2', 'veg', 'Beans'], ['v3', 'veg', 'Salad'],
    ['herbs', 'root', 'Herbs'], ['h1', 'herbs', 'Basil'], ['h2', 'herbs', 'Mint'],
    ['flowers', 'root', 'Flowers'], ['f1', 'flowers', 'Sunflowers'], ['f2', 'flowers', 'Tulips'],
  ]) },
}

const W = 1280, H = 800
const size = (w, h, dsf) => call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false })
// Raw capture (2x) of a CSS-px region of the main window, kept as a data URL for the composer.
const grab = async (name, clip = { x: 0, y: 0, width: W, height: H }) => {
  const r = await call('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })
  writeFileSync(`${OUT}/raw/${name}.png`, Buffer.from(r.data, 'base64'))
  return `data:image/png;base64,${r.data}`
}
const rect = sel => ev(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }`)
const nodeRect = id => rect(`.workspace-leaf.mod-active .react-flow__node[data-id="${id}"]`)
const union = (...rs) => { const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y))
  return { x, y, width: Math.max(...rs.map(r => r.x + r.width)) - x, height: Math.max(...rs.map(r => r.y + r.height)) - y } }
const pad = (r, px, py = px) => ({ x: r.x - px, y: r.y - py, width: r.width + 2 * px, height: r.height + 2 * py })

const P = `app.plugins.plugins['mindmapmate']`
// One board open in one tab, tidied and fitted; the explorer shows where it lives.
const scene = async ({ file = PLAN, theme = 'obsidian', direction, boardTheme = {}, settings = {}, open = ['Projects', 'Projects/Website Relaunch'], fit = true } = {}) => {
  const b = BOARDS[file]
  writeFileSync(`${VAULT}/${file}`, serializeBoardFile({ schema: 1, theme: { ...THEME, ...(direction ? { direction } : {}), ...boardTheme }, nodes: b.nodes, links: b.links }))
  await ev(`const p = ${P}; p.saveData = async () => {}
    Object.assign(p.settings, { minimap: false, hints: false, gridDots: false }, ${JSON.stringify(settings)})
    app.changeTheme(${JSON.stringify(theme)}); document.querySelectorAll('.modal-close-button').forEach(b => b.click()); document.body.click()
    app.workspace.leftSplit.expand(); app.workspace.rightSplit.collapse()
    const fe = app.workspace.getLeavesOfType('file-explorer')[0].view
    for (const it of Object.values(fe.fileItems)) if (it.setCollapsed && !it.collapsed) await it.setCollapsed(true)
    for (const f of ${JSON.stringify(open)}) { const it = fe.fileItems[f]; if (it?.collapsed) await it.setCollapsed(false) }
    await new Promise(r => setTimeout(r, 600))
    const leaf = app.workspace.getLeaf(false); await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(file)}))
    for (const l of app.workspace.getLeavesOfType('markdown').concat(app.workspace.getLeavesOfType('flowmap-board'))) if (l !== leaf) l.detach()
    await new Promise(r => setTimeout(r, 1200))
    leaf.view.refresh?.(); leaf.view.canvas.current.tidy(null); await new Promise(r => setTimeout(r, 600))
    ${fit ? `leaf.view.canvas.current.run('zoomToFit'); await new Promise(r => setTimeout(r, 700))` : ''}
    return 1`)
}

// Composer: a full-window overlay at exactly 1200x800, one per store image.
const ACCENT = { blue: ['#1e3a8a', '#3B82F6'], green: ['#14532d', '#16A34A'], orange: ['#7c2d12', '#F97316'], pink: ['#831843', '#DB2777'], violet: ['#4c1d95', '#8B5CF6'] }
const compose = async (name, accent, title, sub, body) => {
  const [deep, bright] = ACCENT[accent]
  await size(1200, 800, 1); await sleep(300)
  await ev(`const o = document.body.createDiv({ cls: 'mm-showcase' }); o.setAttr('style', ${JSON.stringify(`position:fixed;inset:0;z-index:99999;overflow:hidden;font-family:var(--font-interface);color:#fff;
    background:radial-gradient(1100px 700px at 85% 110%, ${bright}55, transparent 60%),radial-gradient(900px 600px at 0% 0%, ${deep}, transparent 70%),#0f1115;`)})
    o.innerHTML = ${JSON.stringify(`
      <div style="position:absolute;left:56px;top:40px;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;letter-spacing:.02em;opacity:.85">
        ${['#3B82F6', '#16A34A', '#F97316', '#DB2777', '#8B5CF6'].map(c => `<span style="width:10px;height:10px;border-radius:3px;background:${c}"></span>`).join('')}
        <span style="margin-left:4px">MindmapMate</span></div>
      <div style="position:absolute;left:56px;top:84px;right:56px;font-size:40px;font-weight:700;line-height:1.15;letter-spacing:-.01em">${title}</div>
      <div style="position:absolute;left:56px;top:138px;right:56px;font-size:19px;line-height:1.45;color:#c9cdd6">${sub}</div>
      ${body}`)}; await new Promise(r => setTimeout(r, 400)); return 1`)
  const r = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('frame', `${OUT}/${name}.png`)
  await ev(`document.querySelector('.mm-showcase')?.remove(); return 1`)
  await size(W, H, 2); await sleep(300)
}
const card = (src, css) => `<img src="${src}" style="position:absolute;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);${css}">`
const pill = (text, color, css) => `<div style="position:absolute;padding:6px 12px;border-radius:999px;font-size:14px;font-weight:600;background:${color};box-shadow:0 8px 24px rgba(0,0,0,.4);${css}">${text}</div>`
const label = (text, css) => `<div style="position:absolute;font-size:16px;font-weight:600;color:#e5e7eb;text-align:center;${css}">${text}</div>`

const only = process.argv.slice(2) // e.g. `npm run showcase -- 1 3` to redo some frames
const want = n => !only.length || only.includes(String(n))
await size(W, H, 2)

// 1. Hero: the whole app, a project plan with tasks, due dates and a link.
if (want(1)) {
  // A window as wide as the card is tall (1088x640 in the frame), so the fitted board isn't cut off.
  await size(W, 753, 2); await scene()
  const hero = await grab('hero', { x: 0, y: 0, width: W, height: 753 })
  await size(W, H, 2)
  await compose('1-hero', 'blue', 'Map your ideas. Track every task.',
    'A freeform mindmap board inside Obsidian, saved as a Markdown note in your vault.',
    card(hero, 'left:56px;top:200px;width:1088px'))
}

// 3. Tasks, zoomed in on Content and Build; labels sit level with the nodes they describe.
if (want(3)) {
  await scene()
  const ids = ['content', 'c1', 'c2', 'c3', 'build', 'b1', 'b2', 'b3', 'b4']
  const clip = pad(union(...await Promise.all(ids.map(nodeRect))), 14, 5)
  const shot = await grab('tasks', clip)
  const k = 540 / clip.height, cardW = Math.round(clip.width * k), cardL = Math.round(600 - cardW / 2), cardR = cardL + cardW, top = 220
  const y = async id => { const r = await nodeRect(id); return Math.round(top + (r.y + r.height / 2 - clip.y) * k - 16) }
  await compose('3-tasks', 'pink', 'Tasks that add up.',
    'Tick a box and its parent shows the progress. Due dates turn orange today and red when late.',
    card(shot, `left:${cardL}px;top:${top}px;height:540px`) +
    pill('Progress rolls up', '#DB2777', `right:${1200 - cardL + 18}px;top:${await y('content')}px`) +
    pill('Due today', '#b45309', `left:${cardR + 18}px;top:${await y('c2')}px`) +
    pill('Blocked', '#475569', `left:${cardR + 18}px;top:${await y('c3')}px`) +
    pill('Overdue', '#b91c1c', `left:${cardR + 18}px;top:${await y('b3')}px`))
}

// 2. Tab, type, Enter: a child added from the keyboard, the node toolbar and the shortcut hints.
if (want(2)) {
  await scene({ settings: { hints: true } })
  const l = await nodeRect('launch')
  await click(l.x + l.width / 2, l.y + l.height / 2); await sleep(300)
  await key('Tab', 'Tab'); await sleep(400); await type('Celebrate with the team'); await sleep(300)
  const ids = ['launch', 'l1', 'l2', 'l3']
  const newId = await ev(`return app.workspace.getActiveViewOfType(app.workspace.getLeavesOfType('flowmap-board')[0].view.constructor).store.board.nodes.find(n => n.text === '' || n.parent === 'launch' && !['l1','l2','l3'].includes(n.id)).id`)
  const branch = async () => pad(union(...await Promise.all([...ids, newId].map(nodeRect))), 16, 7)
  const hintsAt = async () => { const h = await rect('.workspace-leaf.mod-active .flowmap-hints'); return pad({ ...h, width: Math.min(h.width, 700) }, 10, 6) }
  const editing = await grab('add-editing', await branch()), hintsEdit = await grab('hints-editing', await hintsAt())
  await key('Enter', 'Enter'); await sleep(500)
  const bar = await rect('.workspace-leaf.mod-active .flowmap-bar')
  const done = await grab('add-done', union(await branch(), pad(bar, 8)))
  await compose('2-add', 'orange', 'Tab, type, Enter.',
    'Tab adds a child, Enter a sibling. Click a node for shapes, colors, tasks, dates and links.',
    card(editing, 'left:56px;top:205px;width:600px') +
    label('Tab adds a child.<br>The hints show what you can press next.', 'left:690px;width:454px;top:262px;text-align:left;font-size:19px;line-height:1.45') +
    card(hintsEdit, 'left:690px;top:336px;width:454px') +
    card(done, 'right:56px;top:480px;width:600px') +
    label('Enter finishes. Click any node<br>for its toolbar.', 'left:56px;width:454px;top:590px;text-align:left;font-size:19px;line-height:1.45'))
}

// 4. One board, three looks: both sides, down, and a light theme. Sidebar closed and zoomed to ~100% so the text reads.
if (want(4)) {
  const all = async () => pad(union(...await ev(`return [...document.querySelectorAll('.workspace-leaf.mod-active .react-flow__node')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })`)), 18)
  const scale = () => ev(`return +document.querySelector('.workspace-leaf.mod-active .react-flow__viewport').style.transform.match(/scale\\(([\\d.]+)\\)/)[1]`)
  const look = async (name, o, zoom) => {
    await scene({ file: GARDEN, open: ['Projects', 'Projects/Garden Plan'], ...o })
    await ev(`app.workspace.leftSplit.collapse(); await new Promise(r => setTimeout(r, 400)); app.workspace.getLeavesOfType('flowmap-board')[0].view.canvas.current.run('zoomToFit'); await new Promise(r => setTimeout(r, 500)); return 1`)
    const p = await rect('.workspace-leaf.mod-active .react-flow__pane')
    for (let i = 0; i < 20 && await scale() < zoom; i++) { await wheel(p.x + p.width / 2, p.y + p.height / 2, -120); await sleep(200) }
    await ev(`document.head.createEl('style', { cls: 'mm-hide', text: '.flowmap-controls, .flowmap-group.is-filter { visibility: hidden }' }); return 1`); await sleep(400)
    const shot = await grab(name, await all())
    await ev(`document.querySelectorAll('.mm-hide').forEach(e => e.remove()); return 1`)
    return shot
  }
  const both = await look('look-both', { direction: 'both' }, 1.3), down = await look('look-down', { direction: 'down' }, 1.3), light = await look('look-light', { theme: 'moonstone' }, 1.3)
  await scene({ file: GARDEN })
  await compose('4-looks', 'green', 'Any direction. Light or dark.',
    'Lay a board out to the right, left, both sides or down. It follows your Obsidian theme.',
    label('Both sides', 'left:56px;width:620px;top:200px') + card(both, 'left:56px;top:230px;width:620px') +
    label('Down', 'left:56px;width:620px;top:478px') + card(down, 'left:56px;top:508px;width:620px') +
    label('Light theme', 'right:56px;width:440px;top:200px') + card(light, 'right:56px;top:230px;width:440px'))
}

// 5. Settings: the Settings window is its own page target. Only the MindmapMate pane, in a narrow window so the text reads.
if (want(5)) {
  await scene()
  await ev(`app.setting.open(); app.setting.openTabById('mindmapmate'); await new Promise(r => setTimeout(r, 800)); return 1`)
  const st = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page' && t.title.startsWith('Settings'))
  const sws = new WebSocket(st.webSocketDebuggerUrl); await new Promise(r => sws.onopen = r)
  let sid = 0
  const scall = (method, params = {}) => new Promise((res, rej) => { const id = ++sid
    sws.addEventListener('message', function h(e) { const x = JSON.parse(e.data); if (x.id !== id) return; sws.removeEventListener('message', h); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result) })
    sws.send(JSON.stringify({ id, method, params })) })
  await scall('Emulation.setDeviceMetricsOverride', { width: 840, height: 1400, deviceScaleFactor: 2, mobile: false }); await sleep(800)
  const sv = async src => { const r = await scall('Runtime.evaluate', { expression: `(() => { ${src} })()`, returnByValue: true }); return r.result.value }
  const box = await sv(`const c = document.querySelector('.vertical-tab-content'), r = c.getBoundingClientRect(), items = [...c.querySelectorAll('.setting-item')].filter(x => x.offsetParent)
    const at = t => items.find(h => h.querySelector('.setting-item-name')?.textContent === t).getBoundingClientRect()
    return { x: r.x + 24, w: r.width - 48, top: c.querySelector('.flowmap-about-row').getBoundingClientRect().top, split: at('Export headings').bottom, rest: at('Grid dots').top, end: at('Hotkeys').bottom }`)
  const sgrab = async (name, y0, y1) => { const r = await scall('Page.captureScreenshot', { format: 'png', clip: { x: box.x - 12, y: y0, width: box.w + 24, height: y1 - y0, scale: 1 } })
    writeFileSync(`${OUT}/raw/${name}.png`, Buffer.from(r.data, 'base64')); return `data:image/png;base64,${r.data}` }
  const head = await sgrab('settings-top', box.top - 6, box.split + 10), rest = await sgrab('settings-rest', box.rest + 2, box.end + 10)
  sws.close(); await ev(`app.setting.close(); return 1`)
  await compose('5-settings', 'violet', 'Made to fit how you work.',
    'Wheel to zoom or pan, copy a node or its branch, grid dots, due colors. Your notes stay plain Markdown.',
    card(head, 'left:56px;top:205px;width:540px') + card(rest, 'right:56px;top:205px;width:520px'))
}

// 6. README animation frames: the map opens level by level, then tasks get ticked and Design fills up to 4/4.
// scripts/make-gif.py turns them into demo.gif. Each state is dispatched to the open board, so the view stays put.
if (want(6)) {
  await scene({ open: [] })
  const view = `app.workspace.getLeavesOfType('flowmap-board')[0].view`
  const clip = pad(union(...await ev(`return [...document.querySelectorAll('.workspace-leaf.mod-active .react-flow__node')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })`)), 24, 18)
  const steps = [
    { collapsed: ['root'] },
    { collapsed: ['design', 'content', 'build', 'launch'] },
    {},
    { status: { d3: 'done' } },
    { status: { d3: 'done', d4: 'done' } },
    { status: { d3: 'done', d4: 'done', b3: 'done' } },
  ]
  await mouse('mouseMoved', 5, H - 5, { button: 'none' }) // no hover buttons in the frames
  for (const [i, { collapsed = [], status = {} }] of steps.entries()) {
    await ev(`${view}.store.dispatch(b => ({ ...b, nodes: b.nodes.map(n => ({ ...n, collapsed: ${JSON.stringify(collapsed)}.includes(n.id) || undefined, status: ${JSON.stringify(status)}[n.id] ?? n.status })) })); await new Promise(r => setTimeout(r, 700)); return 1`)
    await grab(`gif-${i}`, clip)
  }
}

await scene()
process.exit(0)
