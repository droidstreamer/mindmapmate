import { FuzzySuggestModal, MarkdownView, normalizePath, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, TFolder, type App, type SettingDefinitionItem } from 'obsidian'
import { collapseToLevel, expandAll, setCollapsed, setDirection, setLink, setStatus, sortChildren } from './core/commands.ts'
import { noteName } from './core/links.ts'
import { DIRECTIONS, type Direction } from './core/layout/tidy.ts'
import { ancestors, depths } from './core/tree.ts'
import { dayOf, inView, type DueView } from './core/due.ts'
import { newBoardFile, serializeBoardFile } from './core/io/boardFile.ts'
import { sampleBoard } from './core/io/sample.ts'
import { parseOutline, toMarkdown } from './core/io/outline.ts'
import { SCHEMA_VERSION, type Status } from './core/schema.ts'
import { BoardView, type BoardHost } from './obsidian/BoardView.ts'
import { registerLinkUpdates } from './obsidian/links.ts'
import { isBoardFile, openAsBoard, openAsMarkdown, patchSetViewState, VIEW_TYPE } from './obsidian/openAsBoard.ts'
import { DEFAULT_KEYS, setMacKeys, type Action, type Keymap } from './ui/input/keymap.ts'
import type { ExportKind, NoteAction } from './ui/StyleBars.tsx'
import { svgToPng } from './ui/exportImage.ts'
import { htmlPage } from './ui/exportHtml.ts'
import { saveAs } from './ui/saveAs.ts'
import { COFFEE_BUTTON, COFFEE_URL } from './ui/coffeeButton.ts'
import { HslPicker } from './ui/StyleBars.tsx'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

interface Settings {
  snap: boolean
  /** D29: the mouse wheel zooms (like Canvas) unless this is "pan" (for trackpads). */
  wheel: 'zoom' | 'pan'
  /** F16: show the minimap on boards. */
  minimap: boolean
  /** D38: copy takes the selected nodes only, or whole branches. */
  copy: 'node' | 'branch'
  /** D41: fonts used on boards, newest first, shown in Board style's font list. */
  recentFonts: string[]
  /** Round 6: how many top levels export to Markdown as headings (0-6); deeper levels are bullets. */
  exportHeadings: number
  /** Round 11: shortcut hints for the selection along a focused board's bottom edge. */
  hints: boolean
  /** Round 11: draw the snap grid's dots, and their color ("#rrggbb"; empty: React Flow's grey). */
  gridDots: boolean
  gridColor: string
  /** R24: the due chip colors ("#rrggbb"; empty: the theme's red, orange and muted text). */
  dueOverdue: string
  dueToday: string
  dueLater: string
  /** Round 15: grid dots were turned off once for everyone, when they became off by default. */
  gridDotsOff15?: boolean
  /** D25: per-action key overrides, e.g. { "editNode": ["F3"] }, set in the settings screen. */
  keys: Partial<Keymap>
}

export default class MindmapMatePlugin extends Plugin implements BoardHost {
  settings: Settings = { snap: false, wheel: 'zoom', minimap: true, hints: true, gridDots: false, gridDotsOff15: true, gridColor: '', dueOverdue: '', dueToday: '', dueLater: '', copy: 'node', exportHeadings: 2, recentFonts: [], keys: {} }
  keymap: Keymap = DEFAULT_KEYS

  get snap() { return this.settings.snap }
  get wheelZoom() { return this.settings.wheel !== 'pan' }
  get copyBranch() { return this.settings.copy === 'branch' }
  get minimap() { return this.settings.minimap }
  get hints() { return this.settings.hints }
  get gridDots() { return this.settings.gridDots }
  get gridColor() { return this.settings.gridColor }
  get dueColors() { return { overdue: this.settings.dueOverdue, today: this.settings.dueToday, later: this.settings.dueLater } }
  get recentFonts() { return this.settings.recentFonts }

  /** Saves a setting and redraws open boards with it. */
  async set<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value
    await this.saveData(this.settings)
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof BoardView) leaf.view.refresh()
  }

  /** D25: new bindings for a board action, or undefined for the default. */
  setKeys(action: Action, bindings: string[] | undefined) {
    const keys = { ...this.settings.keys }
    if (bindings) keys[action] = bindings
    else delete keys[action]
    this.keymap = { ...DEFAULT_KEYS, ...keys }
    return this.set('keys', keys)
  }

  /** D41: an installed font was used on a board; it joins the quick list (up to 8, newest first). */
  fontUsed(font: string) {
    if (this.settings.recentFonts[0] === font) return
    void this.set('recentFonts', [font, ...this.settings.recentFonts.filter(f => f !== font)].slice(0, 8))
  }

  setSnap(snap: boolean) {
    this.settings.snap = snap
    void this.saveData(this.settings)
  }

  /** A new "Untitled.board.md" (numbered if taken) in `folder`, or where Obsidian puts new notes, opened. */
  async newBoard(folder = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '').path) {
    const file = await this.app.vault.create(this.freePath(folder, 'Untitled', '.board.md'), newBoardFile())
    await this.openBoard(file.path)
  }

  /** `folder/name` plus `ext`, numbered (" 1", " 2", …) past any file already there, so nothing is overwritten. */
  private freePath(folder: string, name: string, ext: string) {
    let path = normalizePath(`${folder}/${name}${ext}`)
    for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${name} ${i}${ext}`)
    return path
  }

  private async openBoard(path: string) {
    const leaf = this.app.workspace.getLeaf(true)
    await leaf.setViewState({ type: VIEW_TYPE, state: { file: path }, active: true })
    return leaf.view instanceof BoardView ? leaf.view : null
  }

  /** M6: a board that explains itself, at the vault root (numbered if the name is taken), opened in a new tab. */
  async createSample() {
    const file = await this.app.vault.create(this.freePath('', 'MindmapMate sample', '.board.md'), serializeBoardFile(sampleBoard()))
    // Laid out with the real node sizes once it's drawn.
    const view = await this.openBoard(file.path)
    view?.whenReady(canvas => { canvas.tidy(null); window.requestAnimationFrame(() => canvas.run('zoomToFit')) })
  }

  async onload() {
    setMacKeys(Platform.isMacOS)
    const saved = await this.loadData() as Partial<Settings> | null
    this.settings = { ...this.settings, ...saved }
    if (saved && !saved.gridDotsOff15) await this.saveData(Object.assign(this.settings, { gridDots: false, gridDotsOff15: true }))
    this.keymap = { ...DEFAULT_KEYS, ...this.settings.keys }

    this.registerView(VIEW_TYPE, leaf => new BoardView(leaf, this))
    // M6: the sample board, once, on a fresh install only (no saved settings yet), when the workspace is ready.
    if (!saved) this.app.workspace.onLayoutReady(async () => { await this.saveData(this.settings); await this.createSample() })
    patchSetViewState(this)
    this.addSettingTab(new MindmapMateSettings(this.app, this))
    registerLinkUpdates(this)
    // F10: page preview for links on boards, on hover like reading view (Settings, Page preview can require Ctrl).
    this.registerHoverLinkSource(VIEW_TYPE, { display: 'MindmapMate boards', defaultMod: false })

    this.addCommand({ id: 'new-board', name: 'New board', callback: () => this.newBoard() })
    // Round 8: like Canvas, a ribbon button, and New MindmapMate board on a folder's menu in the file explorer.
    this.addRibbonIcon('workflow', 'Create new MindmapMate board', () => void this.newBoard())
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder) menu.addItem(i => i.setSection('action-primary').setTitle('New MindmapMate board').setIcon('workflow').onClick(() => void this.newBoard(file.path)))
    }))

    // F13: a note's outline (headings, lists, lines) as a new board next to it, under a root named after the note.
    this.addCommand({
      id: 'import-outline',
      name: 'Import Markdown outline as a new board…',
      callback: () => {
        const notes = this.app.vault.getMarkdownFiles().filter(f => !isBoardFile(this.app, f.path))
        new Picker(this.app, 'Import the outline of…', notes, f => f.path, async note => {
          const body = (await this.app.vault.cachedRead(note)).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
          const nodes = parseOutline(body, new Set(['root'])).map(n => n.parent === null ? { ...n, parent: 'root' } : n)
          const root = { id: 'root', parent: null, order: 0, text: note.basename, x: 0, y: 0 }
          const file = await this.app.vault.create(this.freePath(note.parent?.path ?? '', note.basename, '.board.md'),
            serializeBoardFile({ schema: SCHEMA_VERSION, theme: {}, nodes: [root, ...nodes], links: [] }))
          const view = await this.openBoard(file.path)
          view?.whenReady(canvas => canvas.tidy(null))
        }).open()
      },
    })

    this.addCommand({ id: 'create-sample', name: 'Create sample board', callback: () => this.createSample() })

    this.addCommand({
      id: 'open-as-markdown',
      name: 'Open as Markdown',
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(BoardView)
        if (!view) return false
        if (!checking) void openAsMarkdown(view.leaf)
        return true
      },
    })

    this.addCommand({
      id: 'open-as-board',
      name: 'Open as board',
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView)
        if (!(view?.file instanceof TFile) || !isBoardFile(this.app, view.file.path)) return false
        if (!checking) void openAsBoard(view.leaf)
        return true
      },
    })

    // M2 hierarchy. Keys for these live in the board keymap (D25); the rest have no default key.
    this.boardCommand('tidy-board', 'Tidy whole board', view => view.canvas.current?.tidy(null))
    this.boardCommand('tidy-selection', 'Tidy selected branches', view => view.canvas.current?.run('tidy'))
    this.boardCommand('toggle-collapse', 'Collapse or expand selected', view => view.canvas.current?.run('toggleCollapse'))
    this.boardCommand('expand-all', 'Expand all', view => view.store?.dispatch(expandAll))
    this.boardCommand('collapse-to-level', 'Collapse all to level…', view => {
      const board = view.store!.board
      const deepest = Math.max(0, ...depths(board.nodes).values()) + 1
      const levels = Array.from({ length: Math.max(1, deepest - 1) }, (_, i) => i + 1)
      new Picker(this.app, 'Show levels 1 to…', levels, n => `Level ${n}`, n => view.store?.dispatch(collapseToLevel(n))).open()
    })
    this.boardCommand('layout-direction', 'Set layout direction and tidy…', view => {
      const names: Record<Direction, string> = { right: 'Right', left: 'Left', both: 'Both sides', down: 'Down' }
      new Picker(this.app, 'Grow the board…', DIRECTIONS, d => names[d], d => view.canvas.current?.tidy(null, setDirection(d))).open()
    })
    for (const by of ['name', 'status'] as const)
      this.boardCommand(`sort-children-${by}`, `Sort children of selected by ${by} and tidy`, view => {
        const ids = view.canvas.current?.selectedIds() ?? []
        if (!ids.length) return void new Notice('Select the parent nodes first.')
        view.canvas.current?.tidy(ids, sortChildren(ids, by))
      })

    // M3 tasks. The toggle-done key lives in the board keymap (D25).
    this.boardCommand('delete-keep-children', 'Delete selected nodes, keep their children', view => view.canvas.current?.run('deleteKeepChildren'))
    this.boardCommand('toggle-done', 'Toggle done on selected', view => view.canvas.current?.run('toggleDone'))
    this.boardCommand('set-status', 'Set status of selected…', view => {
      const ids = view.canvas.current?.selectedIds() ?? []
      if (!ids.length) return void new Notice('Select nodes first.')
      const statuses: (Status | undefined)[] = [undefined, 'todo', 'doing', 'blocked', 'done', 'dropped']
      new Picker(this.app, 'Set status…', statuses, s => s ? s[0].toUpperCase() + s.slice(1) : 'None (not a task)',
        s => { view.store?.dispatch(setStatus(ids, s)); view.canvas.current?.autoTidy(...ids) }).open()
    })
    this.boardCommand('toggle-hide-done', 'Hide or show done tasks', view => view.setHideDone(!view.hideDone))
    // M6: F9 focus mode and the F16 minimap, also on the canvas controls.
    this.boardCommand('add-label', 'Add label', view => view.canvas.current?.addLabel())
    // M7, M8: each selects its matching tasks and fits them in view, opening any collapsed branch that hides one (one undo step).
    const views: [DueView, string, string, string][] = [['overdue', 'show-overdue', 'Show overdue', 'overdue'],
      ['today', 'show-due-today', 'Show due today', 'due today'], ['week', 'show-due-week', 'Show due this week', 'due this week'],
      ['blocked', 'show-blocked', 'Show blocked', 'blocked'], ['doing', 'show-doing', 'Show doing', 'in progress']]
    for (const [key, id, name, what] of views) this.boardCommand(id, name, view => {
      const board = view.store!.board, today = dayOf()
      const ids = board.nodes.filter(n => inView(n, key, today)).map(n => n.id)
      const hiding = new Set(ids.flatMap(id => ancestors(board.nodes, id)).filter(a => board.nodes.find(n => n.id === a)?.collapsed))
      if (hiding.size) view.store!.dispatch(setCollapsed(hiding, false))
      view.canvas.current?.selectAndFit(ids)
      new Notice(ids.length ? `${ids.length} ${what}` : `Nothing is ${what}.`)
    })
    this.boardCommand('focus-branch', 'Focus on the selected branch, or leave focus', view => view.canvas.current?.toggleFocusMode())
    this.boardCommand('toggle-minimap', 'Show or hide the minimap', () => this.set('minimap', !this.settings.minimap))
    this.boardCommand('toggle-hints', 'Show or hide shortcut hints', () => this.set('hints', !this.settings.hints))
    // F13: one-way snapshot next to the board. Never overwrites an earlier export.
    this.boardCommand('export-markdown', 'Export to Markdown', view => this.exportBoard(view, 'markdown'))
    for (const kind of ['svg', 'png'] as const)
      this.boardCommand(`export-${kind}`, `Export as ${kind.toUpperCase()} image`, view => this.exportBoard(view, kind))
    this.boardCommand('export-html', 'Export as HTML page', view => this.exportBoard(view, 'html'))

    // M4b: node and line styling live on toolbars over the selection; board-wide defaults in Board style.
    this.boardCommand('board-style', 'Board style', view => view.canvas.current?.toggleBoardStyle())

    // F10: the link field. Wikilinks can also go straight into node text. The node palette's Link menu runs the same.
    this.boardCommand('link-node', 'Link selected node to a note…', view => this.noteAction(view, 'link', view.canvas.current?.selectedIds() ?? []))
    this.boardCommand('unlink-node', 'Remove link from selected nodes', view => {
      const ids = view.canvas.current?.selectedIds() ?? []
      view.store?.dispatch(board => ids.reduce((b, id) => setLink(id, undefined)(b), board))
    })
    this.boardCommand('promote-to-note', 'Promote selected node to a note', view => this.noteAction(view, 'promote', view.canvas.current?.selectedIds() ?? []))

    // Spike A: records the performance budget measures for the open board.
    this.boardCommand('measure-performance', 'Measure board performance', async view => {
      const store = view.store, canvas = view.canvas.current
      if (!store || !canvas) return
      new Notice('Measuring pan and zoom for 2 seconds…')
      const t = performance.now()
      serializeBoardFile(store.board)
      const saveMs = Math.round(performance.now() - t)
      const { fitted, zoomedIn } = await canvas.measurePanZoom()
      const fmt = (r: typeof fitted) => `${r.fps} fps (p95 frame ${r.p95FrameMs} ms, up to ${r.mountedNodes} nodes mounted)`
      const report = `${view.file?.name}: ${store.board.nodes.length} nodes. Open ${view.openMs} ms. `
        + `Pan/zoom fitted: ${fmt(fitted)}; at 100%: ${fmt(zoomedIn)}. Serialize ${saveMs} ms.`
      new Notice(report, 15000)
    })
  }

  /**
   * F10 on one node: "link" picks a note for its link field; "promote" creates an empty note named after it, in Obsidian's
   * folder for new notes, and links it (nothing else opens).
   */
  /** F13 Markdown, F16 SVG or PNG image, HTML page (collapsed and hidden branches left out in the images). Round 19: each asks
   *  where to save, through a Save dialog (never the vault unasked). Round 8: also run from the Export menu in the canvas controls. */
  async exportBoard(view: BoardView, kind: ExportKind) {
    if (!view.file || !view.store) return
    const name = view.file.basename.replace(/\.board$/, '')
    let saved: string | null
    if (kind === 'markdown') saved = await saveAs(`${name} export`, 'md', toMarkdown(view.store.board, undefined, this.settings.exportHeadings))
    else {
      const image = view.canvas.current?.exportSvg(kind === 'html')
      if (!image) return
      if (kind === 'svg') saved = await saveAs(name, 'svg', image.svg)
      else if (kind === 'html') saved = await saveAs(name, 'html', htmlPage(name, image.svg, image.background, image.colors))
      else {
        const { png, scale } = await svgToPng(image.svg, image.width, image.height)
        saved = await saveAs(name, 'png', new Uint8Array(png))
        if (saved && scale < 1) new Notice(`The board is very large, so the image was scaled to ${Math.round(scale * 100)}%.`)
      }
    }
    if (saved) new Notice(`Exported ${saved}`)
  }

  async noteAction(view: BoardView, action: NoteAction, ids: string[]) {
    const node = ids.length === 1 ? view.store?.board.nodes.find(n => n.id === ids[0]) : undefined
    if (!node || !view.file) return void new Notice('Select one node first.')
    if (action === 'link')
      return void new Picker(this.app, 'Link to note…', this.app.vault.getMarkdownFiles(), f => f.path, f => view.store?.dispatch(setLink(node.id, f.path))).open()
    if (node.link) return void new Notice(`Already linked to ${node.link}.`)
    const folder = this.app.fileManager.getNewFileParent(view.file.path).path
    const file = await this.app.vault.create(this.freePath(folder, noteName(node.text), '.md'), '')
    view.store?.dispatch(setLink(node.id, file.path))
    new Notice(`Created ${file.path}`)
  }

  /** A command that is only available while a readable board is the active view. */
  private boardCommand(id: string, name: string, run: (view: BoardView) => unknown) {
    this.addCommand({
      id, name,
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(BoardView)
        if (!view?.store) return false
        if (!checking) void run(view)
        return true
      },
    })
  }
}

/** M6: the settings screen: input, copy, snap, and the board keys (D25). */
/** React Flow's default dot grey, shown when no grid color is picked. */
const GRID_GREY = '#91919a'
type ColorKey = 'gridColor' | 'dueOverdue' | 'dueToday' | 'dueLater'
/** Any CSS color as "#rrggbb" (the picker's start), via a canvas, which normalizes it. */
function cssHex(css: string): string {
  const ctx = createEl('canvas').getContext('2d')!
  ctx.fillStyle = '#808080'; ctx.fillStyle = css.trim()
  return ctx.fillStyle.startsWith('#') ? ctx.fillStyle : '#808080'
}

class MindmapMateSettings extends PluginSettingTab {
  constructor(app: App, private plugin: MindmapMatePlugin) { super(app, plugin) }
  private picker: Root | null = null
  private closePicker: (() => void) | null = null
  hide() { this.closePicker?.(); super.hide() }
  // Round 14: the boards' own color picker, not Obsidian's, whose system color dialog closed Obsidian on Linux.
  // Round 17: it opens as a popover from the swatch and closes on Escape or a click outside, so the sliders never sit in the settings.
  // R24: one row can hold several swatches (the due colors); one picker is open at a time.
  private swatches(row: Setting, items: [ColorKey, string, string][], resetTip: string) {
    const p = this.plugin, doc = row.controlEl.ownerDocument // Obsidian 1.13 opens Settings in its own window, so listen on this document, not the main one
    row.controlEl.addClass('flowmap-settings-color')
    const pop = row.controlEl.createDiv({ cls: 'flowmap-settings-pop' })
    pop.hide()
    let from: HTMLElement | null = null
    const close = () => {
      this.picker?.unmount(); this.picker = null; from = null; pop.hide()
      doc.removeEventListener('mousedown', outside, true); doc.removeEventListener('keydown', esc, true)
    }
    const outside = (e: MouseEvent) => { if (!pop.contains(e.target as Node) && e.target !== from) close() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    for (const [key, label, fallback] of items) {
      const swatch = row.controlEl.createEl('button', { cls: 'flowmap-swatch', attr: { 'aria-label': label } })
      swatch.style.background = p.settings[key] || fallback
      swatch.onclick = () => {
        const again = from === swatch
        this.closePicker?.()
        if (again) return
        this.closePicker = close
        from = swatch
        pop.show()
        this.picker = createRoot(pop)
        this.picker.render(createElement(HslPicker, { start: p.settings[key] || cssHex(swatch.win.getComputedStyle(swatch).backgroundColor), onPick: hex => { swatch.style.background = hex; void p.set(key, hex) } }))
        doc.addEventListener('mousedown', outside, true); doc.addEventListener('keydown', esc, true)
      }
    }
    // The arrow puts back the defaults and repaints the swatches in place.
    const shown = [...row.controlEl.querySelectorAll<HTMLElement>('.flowmap-swatch')]
    row.addExtraButton(b => b.setIcon('rotate-ccw').setTooltip(resetTip).onClick(async () => {
      this.closePicker?.()
      for (const [i, [key, , fallback]] of items.entries()) { await p.set(key, ''); shown[i].style.background = fallback }
    }))
  }

  getControlValue(key: string): unknown {
    const v = this.plugin.settings[key as keyof Settings]
    return key === 'exportHeadings' ? String(this.plugin.settings.exportHeadings) : v
  }

  setControlValue(key: string, value: unknown) {
    return this.plugin.set(key as keyof Settings, (key === 'exportHeadings' ? Number(value) : value) as never)
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof Settings>[] {
    const p = this.plugin
    // The swatches show the theme variable itself; the picker gets its resolved value when it opens.
    const dueKeys = [['dueOverdue', 'Overdue color', 'var(--color-red)'], ['dueToday', 'Due today color', 'var(--color-orange)'], ['dueLater', 'Later date color', 'var(--text-muted)']] as [ColorKey, string, string][]
    return [
      // Round 17: what MindmapMate is, its version and author. Round 18: the version is a small subline. Round 19: a normal-size title, and the coffee button right-aligned after "Made with care".
      { name: 'MindmapMate', searchable: false, render: row => this.header(row) },
      { name: 'Mouse wheel', desc: 'Zoom, like Canvas. Choose pan if you use a trackpad: then the wheel pans, and Ctrl (Cmd) + wheel zooms.',
        control: { type: 'dropdown', key: 'wheel', options: { zoom: 'Zoom', pan: 'Pan' } } },
      { name: 'Copy', desc: 'What Ctrl (Cmd) + C takes from a board. Pasted nodes go beside the selected node. Cut always takes the whole branch.',
        control: { type: 'dropdown', key: 'copy', options: { node: 'The node only', branch: 'The whole branch' } } },
      { name: 'Export headings', desc: '"Export to Markdown" turns this many top levels into headings (#, ##, …). Deeper levels, and every task, are nested bullets, with no depth limit.',
        control: { type: 'dropdown', key: 'exportHeadings', options: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map(n => [n, n === '0' ? 'None (a plain list)' : n])) } },
      // Round 15: snap and the minimap are only the board's magnet and map buttons now.
      { name: 'Grid dots', desc: 'Draw the 20px snap grid as dots on the board. Click the swatch to pick their color; the arrow puts back the default grey.',
        render: row => {
          row.addToggle(t => t.setValue(p.settings.gridDots).onChange(v => p.set('gridDots', v)))
          this.swatches(row, [['gridColor', 'Grid dots color', GRID_GREY]], 'Default color')
        } },
      // R24: the due chip colors; empty follows the theme.
      { name: 'Due date colors', desc: 'The date chip when a task is overdue, due today, and later. The arrow puts back the theme\'s colors.',
        render: row => this.swatches(row, dueKeys, 'Theme colors') },
      { name: 'Shortcut hints', desc: 'While a board has focus, the keys and mouse moves for what is selected show along its bottom edge.',
        control: { type: 'toggle', key: 'hints' } },
      { name: 'Sample board', desc: 'A board that shows how children, links, tasks and styles work.',
        render: row => { row.addButton(b => b.setButtonText('Create sample board').onClick(() => p.createSample())) } },
      // Round 20: one button to Obsidian's Hotkeys editor (filtered to MindmapMate) instead of a list of keys here.
      { name: 'Hotkeys', desc: 'MindmapMate sets no hotkeys of its own. Board keys and MindmapMate commands are set in Obsidian\'s Hotkeys editor.',
        render: row => {
          row.addButton(b => b.setButtonText('Open hotkeys').onClick(() => {
            const s = (this.app as unknown as { setting: { openTabById(id: string): { searchComponent?: { setValue(v: string): void, onChanged(): void } } | undefined } }).setting
            const tab = s.openTabById('hotkeys')
            tab?.searchComponent?.setValue('MindmapMate'); tab?.searchComponent?.onChanged()
          }))
        } },
    ]
  }

  private header(row: Setting) {
    const el = row.settingEl
    el.empty()
    el.addClass('flowmap-about-row')
    const { version, author } = this.plugin.manifest
    const about = el.createDiv({ cls: 'flowmap-about' })
    about.createDiv({ cls: 'flowmap-about-name', text: 'MindmapMate' })
    about.createDiv({ cls: 'flowmap-about-title', text: `v${version} · by ${author}` })
    about.createEl('p', { text: 'A visual mind-mapping tool to brainstorm, scope and track sub-tasks for any project. You build boards organically as you come up with ideas, and MindmapMate saves them as .board.md notes. Use them within Obsidian, or export them as notes, images, or interactive HTML pages.' })
    about.createDiv({ cls: 'flowmap-about-tip', text: 'If you enjoy this plugin, please consider a small tip, I would greatly appreciate it!' })
    const footer = about.createDiv({ cls: 'flowmap-about-footer' })
    footer.createSpan({ text: 'Made with care' })
    const coffee = footer.createEl('a', { cls: 'flowmap-coffee', href: COFFEE_URL, attr: { target: '_blank', rel: 'noopener', 'aria-label': 'Buy me a coffee' } })
    coffee.createEl('img', { attr: { src: COFFEE_BUTTON, alt: 'Buy me a coffee' } })
  }
}

class Picker<T> extends FuzzySuggestModal<T> {
  constructor(app: App, placeholder: string, private items: T[], private label: (item: T) => string, private onPick: (item: T) => unknown) {
    super(app)
    this.setPlaceholder(placeholder)
  }
  getItems() { return this.items }
  getItemText(item: T) { return this.label(item) }
  onChooseItem(item: T) { void this.onPick(item) }
}
