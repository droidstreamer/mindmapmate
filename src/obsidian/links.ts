// D19: when a note (or a folder above it) is renamed or moved, retarget node links in every board: link fields, and
// wikilinks in node text that no longer resolve. Open boards update in memory and save as usual; closed boards get only
// their data block rewritten, because Obsidian's own link updater is rewriting their index at the same time (see
// `replaceBoardJson`). Deleted notes keep their links, drawn as unresolved, so nothing is lost if the note comes back.

import { debounce, TFile, type App, type Plugin } from 'obsidian'
import { retargetLinks } from '../core/commands.ts'
import { parseBoardFile, replaceBoardJson } from '../core/io/boardFile.ts'
import { movedTarget } from '../core/links.ts'
import { BoardView } from './BoardView.ts'
import { isBoardFile, VIEW_TYPE } from './openAsBoard.ts'

export function registerLinkUpdates(plugin: Plugin) {
  const { vault } = plugin.app
  plugin.registerEvent(vault.on('rename', (file, oldPath) => void retargetEverywhere(plugin.app, oldPath, file.path)))
  // Links drawn as resolved or not follow notes appearing and disappearing (once per burst, such as a sync).
  const redraw = debounce(() => { for (const view of boardViews(plugin.app)) view.refresh() }, 300, true)
  plugin.registerEvent(vault.on('create', redraw))
  plugin.registerEvent(vault.on('delete', redraw))
  plugin.registerEvent(vault.on('rename', redraw))
}

const boardViews = (app: App) => app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v instanceof BoardView)

async function retargetEverywhere(app: App, oldPath: string, newPath: string) {
  // A text link path moved with the note if it no longer resolves from this board and pointed at the old path.
  const command = (boardPath: string) => retargetLinks(oldPath, newPath, linkpath => {
    if (app.metadataCache.getFirstLinkpathDest(linkpath, boardPath)) return
    const target = movedTarget(linkpath, oldPath, newPath)
    const file = target && app.vault.getAbstractFileByPath(target)
    return file instanceof TFile ? app.metadataCache.fileToLinktext(file, boardPath, true) : undefined
  })
  const open = new Set<string>()
  for (const view of boardViews(app)) {
    if (!view.file) continue
    open.add(view.file.path)
    view.store?.dispatch(command(view.file.path))
  }
  for (const file of app.vault.getMarkdownFiles()) {
    if (open.has(file.path) || !isBoardFile(app, file.path)) continue
    // Unreadable or newer-schema boards are left untouched (D18).
    await app.vault.process(file, text => {
      const parsed = parseBoardFile(text)
      if (!parsed.ok) return text
      const board = command(file.path)(parsed.board)
      return board === parsed.board ? text : replaceBoardJson(text, board)
    })
  }
}
