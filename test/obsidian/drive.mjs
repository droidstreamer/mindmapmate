// Drives a real Obsidian through the Chrome DevTools Protocol, for the scripted checklist and the
// performance script. Starts a separate Obsidian with its own profile on ../test-vault, so the user's
// own Obsidian and vaults are never touched. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// VAULT and PORT can be set from the environment (the showcase runs on its own vault and port).
export const PORT = Number(process.env.PORT ?? 9333)
export const VAULT = resolve(process.env.VAULT ?? '../test-vault')
const profile = `${tmpdir()}/flowmap-obsidian-profile${process.env.PORT ? `-${PORT}` : ''}`

export const sleep = ms => new Promise(r => setTimeout(r, ms))

async function pageTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  return targets.find(t => t.type === 'page' && !t.title.startsWith('Settings'))
}

async function launch() {
  try { if (await pageTarget()) return } catch { /* not running */ }
  mkdirSync(profile, { recursive: true })
  writeFileSync(`${profile}/obsidian.json`, JSON.stringify({ vaults: { flowmaptest01: { path: VAULT, ts: 1, open: true } }, updateDisabled: true }))
  spawn(process.env.OBSIDIAN ?? 'obsidian', [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 60; i++) { try { if (await pageTarget()) return } catch { /* starting */ } await sleep(500) }
  throw new Error('Obsidian did not start (set OBSIDIAN=/path/to/obsidian if it is not on PATH)')
}

await launch()
const ws = new WebSocket((await pageTarget()).webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let seq = 0
export const call = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  ws.addEventListener('message', function h(e) {
    const m = JSON.parse(e.data)
    if (m.id !== id) return
    ws.removeEventListener('message', h)
    if (m.error) rej(new Error(JSON.stringify(m.error)))
    else res(m.result)
  })
  ws.send(JSON.stringify({ id, method, params }))
})
export const close = () => ws.close()

/** Runs async JS in Obsidian and returns the (JSON-able) result. */
export async function ev(src) {
  const r = await call('Runtime.evaluate', { expression: `(async () => { ${src} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
  return r.result.value
}

// First run: trust the vault, turn on community plugins, and (re)load the freshly built plugin.
await sleep(1500)
await ev(`
  [...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('Trust'))?.click()
  await new Promise(r => setTimeout(r, 300))
  for (const w of app.workspace.floatingSplit?.children ?? []) w.win?.close()
  await app.plugins.setEnable(true)
  await app.plugins.disablePlugin('mindmapmate')
  await app.plugins.enablePlugin('mindmapmate')
  await new Promise(r => setTimeout(r, 500))
  return 1`)
for (const t of await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
  if (t.title.startsWith('Settings')) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`)

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
const mods = (m = []) => m.reduce((a, k) => a | MOD[k], 0)
export const mouse = (type, x, y, { button = 'left', clickCount = 1, m } = {}) =>
  call('Input.dispatchMouseEvent', { type, x, y, button, clickCount, modifiers: mods(m), buttons: type === 'mouseReleased' || button === 'none' ? 0 : 1 })
export async function click(x, y, o = {}) { await mouse('mouseMoved', x, y, { ...o, button: 'none' }); await mouse('mousePressed', x, y, o); await mouse('mouseReleased', x, y, o) }
export async function dblclick(x, y) { await click(x, y); await mouse('mousePressed', x, y, { clickCount: 2 }); await mouse('mouseReleased', x, y, { clickCount: 2 }) }
export async function drag(x1, y1, x2, y2, o = {}) {
  await mouse('mouseMoved', x1, y1, { ...o, button: 'none' })
  await sleep(50) // round 14: a connection dot takes the pointer only once it shows, a frame after the pointer comes near
  await mouse('mousePressed', x1, y1, o)
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', x1 + (x2 - x1) * i / 10, y1 + (y2 - y1) * i / 10, o); await sleep(16) }
  await mouse('mouseReleased', x2, y2, o)
}
const VK = { Escape: 27, Enter: 13, Delete: 46, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, '.': 190 }
/** `commands` runs editing commands such as "copy" or "paste", which synthetic key events don't trigger on their own. */
export async function key(k, code, m = [], commands) {
  const base = { key: k, code, modifiers: mods(m), windowsVirtualKeyCode: VK[k] ?? k.toUpperCase().charCodeAt(0), ...commands && { commands } }
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
export const type = text => call('Input.insertText', { text })
export const wheel = (x, y, deltaY, m) => call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers: mods(m) })

const ACTIVE = `.workspace-leaf.mod-active`
export const open = path => ev(`await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)})); await new Promise(r => setTimeout(r, 800)); return 1`)
export const board = () => ev(`return app.workspace.getLeavesOfType('flowmap-board').find(l => l.view.containerEl.closest('${ACTIVE}'))?.view.store.board`)
/** Window coordinates of an element in the active board, by CSS selector; `fy` picks a point down its height. */
export const at = (selector, fy = 0.5) => ev(`const el = document.querySelector(${JSON.stringify(`${ACTIVE} ${selector}`)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * ${fy} }`)
export const nodeAt = text => ev(`const el = [...document.querySelectorAll('${ACTIVE} .react-flow__node')].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: el.dataset.id }`)
export const paneCorner = () => at('.react-flow__pane', 0.05)
/** Window coordinates along a drawn edge: `t` = 0 at its source end, 0.5 midway, 1 at the target. */
export const edgePoint = (id, t) => ev(`const p = document.querySelector('${ACTIVE} .react-flow__edge[data-id="${id}"] path.react-flow__edge-path'); if (!p) return null
  const q = p.getPointAtLength(p.getTotalLength() * ${t}).matrixTransform(p.getScreenCTM()); return { x: q.x, y: q.y }`)
