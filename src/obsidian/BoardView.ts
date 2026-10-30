import { getLinkpath, Notice, prepareFuzzySearch, TextFileView, type HoverParent, type HoverPopover, type WorkspaceLeaf } from 'obsidian'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setCollapsed } from '../core/commands.ts'
import { boardData, boardJson, nodeIdAt, parseBoardFile, serializeBoardFile, type ParseResult } from '../core/io/boardFile.ts'
import { ancestors } from '../core/tree.ts'
import { BoardStore } from '../core/store.ts'
import { BoardCanvas, type BoardLinks, type CanvasApi } from '../ui/BoardCanvas.tsx'
import type { Keymap } from '../ui/input/keymap.ts'
import type { ExportKind, NoteAction } from '../ui/StyleBars.tsx'
import { openAsMarkdown, VIEW_TYPE } from './openAsBoard.ts'

/** What the view needs from the plugin: its settings. */
export interface BoardHost {
  keymap: Keymap
  snap: boolean
  wheelZoom: boolean
  panKey: string
  setSnap(snap: boolean): void
  copyBranch: boolean
  minimap: boolean
  hints: boolean
  gridDots: boolean
  gridColor: string
  /** R24: the due chip colors, empty for the theme's. */
  dueColors: Record<'overdue' | 'today' | 'later', string>
  set(key: 'minimap', value: boolean): Promise<void>
  recentFonts: string[]
  fontUsed(font: string): void
  noteAction(view: BoardView, action: NoteAction, ids: string[]): Promise<void>
  exportBoard(view: BoardView, kind: ExportKind): Promise<void>
}

export class BoardView extends TextFileView implements HoverParent {
  hoverPopover: HoverPopover | null = null
  private root: Root | null = null
  private parsed: ParseResult | null = null
  store: BoardStore | null = null
  readonly canvas: { current: CanvasApi | null } = { current: null }
  // Text last read from disk. Saved back unchanged until a command edits the board, so the view
  // never rewrites a file it didn't change, and never one it couldn't read (D18).
  private fileText = ''
  // Not `dirty`: TextFileView uses that name internally and resets it.
  private edited = false
  private openedAt = 0
  /** Spike A: milliseconds from receiving the file text to the first painted frame. */
  openMs = 0
  /** F8 hide-done toggle. Per view and never saved, like the viewport (D16). */
  hideDone = false
  // Waiting for the canvas's first paint, such as a deep link opened with the board (D21).
  private pending: ((canvas: CanvasApi) => void)[] = []

  constructor(leaf: WorkspaceLeaf, private host: BoardHost) {
    super(leaf)
  }

  getViewType() { return VIEW_TYPE }
  getDisplayText() { return this.file?.basename ?? 'Board' }
  getIcon() { return 'workflow' }

  getViewData() {
    if (!this.edited || !this.store || !this.parsed?.ok) return this.fileText
    return serializeBoardFile(this.store.board, this.parsed.frame)
  }

  // Obsidian also saves text views on close. Skip unless the board changed, so an unedited or
  // unreadable file is never touched.
  async save(clear?: boolean) {
    if (this.edited && this.parsed?.ok) await super.save(clear)
  }

  // Called on open (clear = true) and after external edits such as sync, git, a text edit or another
  // tab saving the same board (clear = false, D18, D22). Reusing the React root keeps the viewport.
  setViewData(data: string, clear: boolean) {
    if (clear) {
      this.clear()
      this.openMs = 0
    }
    // D19: keep the board in memory, with its undo history and any edit not yet saved, when the data block is unchanged
    // on disk (only the index or frontmatter changed, as when Obsidian's link updater rewrites a closed board's index),
    // or when it is this view's own board handed back (the link updater edits an open board's text through the view).
    if (!clear && this.store && this.parsed?.ok) {
      const incoming = boardData(data), parsed = parseBoardFile(data)
      const onDisk = incoming === boardData(this.fileText), fromView = incoming === boardJson(this.store.board)
      if ((onDisk || fromView) && parsed.ok) {
        this.fileText = data
        this.parsed = parsed
        if (!onDisk) this.edited = true // handed back from the view, not on disk yet
        // Obsidian cancels the pending save once this returns; ask again after.
        if (this.edited) window.setTimeout(() => this.requestSave())
        return
      }
    }
    this.fileText = data
    this.parsed = parseBoardFile(data)
    this.openedAt = performance.now()
    this.edited = false
    if (!this.parsed.ok) {
      this.store = null
    } else if (this.store) {
      this.store.reset(this.parsed.board)
    } else {
      this.store = new BoardStore(this.parsed.board)
      // D17: every command marks the file dirty and asks for Obsidian's debounced save.
      this.store.subscribe(edited => {
        if (!edited) return
        this.edited = true
        this.requestSave()
      })
    }
    this.renderBoard()
  }

  clear() {
    this.root?.unmount()
    this.root = null
    this.store = null
    this.canvas.current = null
    this.parsed = null
    this.contentEl.empty()
  }

  async onClose() {
    this.clear()
  }

  setHideDone(hide: boolean) {
    this.hideDone = hide
    this.renderBoard()
  }

  /** Re-renders with the current plugin settings and link targets. */
  refresh() { this.renderBoard() }

  /** D21: a block link ("Board#^id") or a search result opens the board zoomed to that node. */
  setEphemeralState(state: unknown) {
    super.setEphemeralState(state)
    const s = (state ?? {}) as { subpath?: string, line?: number, match?: { matches?: [number, number][] } }
    const id = nodeIdAt(this.fileText, { subpath: s.subpath, line: s.line, offset: s.match?.matches?.[0]?.[0] })
    if (id) this.whenReady(canvas => this.focusNode(canvas, id))
  }

  private focusNode(canvas: CanvasApi, id: string) {
    const board = this.store?.board
    if (!board?.nodes.some(n => n.id === id)) return
    // Collapsed branches above it open (saved, like any expand).
    const closed = ancestors(board.nodes, id).filter(a => board.nodes.find(n => n.id === a)?.collapsed)
    if (closed.length) this.store!.dispatch(setCollapsed(closed, false))
    canvas.focus(id)
  }

  whenReady(run: (canvas: CanvasApi) => void) {
    if (this.canvas.current && this.openMs) run(this.canvas.current)
    else this.pending.push(run)
  }

  /** R29: Obsidian's search pane for a tag, through the core Search plugin (not a public API, so every step is checked). */
  private searchTag(tag: string) {
    type Search = { instance?: { openGlobalSearch?(query: string): void } }
    const internal = (this.app as unknown as { internalPlugins?: { getPluginById?(id: string): Search | undefined } }).internalPlugins
    const search = internal?.getPluginById?.('global-search')?.instance
    if (search?.openGlobalSearch) search.openGlobalSearch(`tag:#${tag}`)
    else new Notice('Turn on the core Search plugin to search tags.')
  }

  // F10: links in node text and link fields, resolved and opened like Obsidian's own.
  private links(): BoardLinks {
    const source = this.file?.path ?? ''
    return {
      resolved: linktext => !!this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), source),
      open: (linktext, newTab) => void this.app.workspace.openLinkText(linktext, source, newTab),
      searchTag: tag => this.searchTag(tag),
      hover: (event, targetEl, linktext) => this.app.workspace.trigger('hover-link', { event, source: VIEW_TYPE, hoverParent: this, targetEl, linktext, sourcePath: source }),
      // M6b: `[[` in a node. Fuzzy matches on the path, best first; with nothing typed yet, the latest edited notes.
      suggest: query => {
        const files = this.app.vault.getMarkdownFiles()
        const match = prepareFuzzySearch(query)
        const ranked = query.trim()
          ? files.map(f => ({ f, score: match(f.path)?.score })).filter(r => r.score !== undefined).sort((a, b) => b.score! - a.score!).map(r => r.f)
          : files.sort((a, b) => b.stat.mtime - a.stat.mtime)
        return ranked.slice(0, 8).map(f => ({ linktext: this.app.metadataCache.fileToLinktext(f, source, true), path: f.path }))
      },
    }
  }

  private renderBoard() {
    if (!this.parsed) return
    if (!this.parsed.ok || !this.store) {
      this.root?.unmount()
      this.root = null
      this.showError(this.parsed.ok ? '' : this.parsed.message)
      return
    }
    // R24: the chip colors as CSS variables, which the chips and image export read.
    for (const [k, c] of Object.entries(this.host.dueColors)) this.contentEl.style.setProperty(`--flowmap-due-${k}`, /^#[0-9a-f]{6}$/i.test(c) ? c : null)
    if (!this.root) {
      this.contentEl.empty()
      this.contentEl.addClass('flowmap-view')
      this.root = createRoot(this.contentEl.createDiv({ cls: 'flowmap-root' }))
    }
    this.root.render(createElement(BoardCanvas, {
      store: this.store,
      keymap: this.host.keymap,
      snap: this.host.snap,
      wheelZoom: this.host.wheelZoom,
      panKey: this.host.panKey,
      hideDone: this.hideDone,
      onHideDoneChange: hide => this.setHideDone(hide),
      minimap: this.host.minimap,
      onMinimapChange: show => void this.host.set('minimap', show),
      hints: this.host.hints,
      gridDots: this.host.gridDots,
      gridColor: this.host.gridColor,
      onSnapChange: snap => { this.host.setSnap(snap); this.renderBoard() },
      links: this.links(),
      copyBranch: this.host.copyBranch,
      recentFonts: this.host.recentFonts,
      onFontUsed: font => this.host.fontUsed(font),
      onNoteAction: (action, id) => void this.host.noteAction(this, action, [id]),
      onExport: kind => void this.host.exportBoard(this, kind),
      onFirstPaint: () => {
        if (!this.openMs) this.openMs = Math.round(performance.now() - this.openedAt)
        for (const run of this.pending.splice(0)) if (this.canvas.current) run(this.canvas.current)
      },
      api: this.canvas,
    }))
  }

  private showError(message: string) {
    this.contentEl.empty()
    const panel = this.contentEl.createDiv({ cls: 'flowmap-error' })
    panel.createEl('h3', { text: 'This board can\'t be opened' })
    panel.createEl('p', { text: message })
    panel.createEl('p', { text: 'The file has not been changed, and the board will not save over it. Open it as Markdown to inspect or fix the data.' })
    panel.createEl('button', { text: 'Open as Markdown', cls: 'mod-cta' })
      .addEventListener('click', () => void openAsMarkdown(this.leaf))
  }
}
