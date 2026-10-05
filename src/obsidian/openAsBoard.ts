// D15: open Markdown files that carry the `flowmap` frontmatter key in the board view,
// by wrapping WorkspaceLeaf.setViewState (the pattern the Kanban plugin uses). If this ever breaks,
// files simply open as normal Markdown with their data intact.

import { WorkspaceLeaf, type App, type Plugin, type ViewState } from 'obsidian'
import { FRONTMATTER_KEY, LEGACY_KEY } from '../core/io/boardFile.ts'

export const VIEW_TYPE = 'flowmap-board'

// Leaves where the user chose "Open as Markdown", mapped to the file path they chose it for.
const markdownMode = new WeakMap<WorkspaceLeaf, string>()

export function isBoardFile(app: App, path: string) {
  const fm = app.metadataCache.getCache(path)?.frontmatter
  return fm?.[FRONTMATTER_KEY] != null || fm?.[LEGACY_KEY] != null
}

export function patchSetViewState(plugin: Plugin) {
  const proto = WorkspaceLeaf.prototype
  const original = proto.setViewState
  let active = true

  const patched = function (this: WorkspaceLeaf, state: ViewState, eState?: unknown) {
    const file = state.state?.file
    if (active && state.type === 'markdown' && typeof file === 'string'
      && markdownMode.get(this) !== file && isBoardFile(plugin.app, file)) {
      state = { ...state, type: VIEW_TYPE }
    }
    return original.call(this, state, eState)
  }
  proto.setViewState = patched

  plugin.register(() => {
    // Restore only if nobody wrapped us since; otherwise just go inert so their wrapper keeps working.
    if (proto.setViewState === patched) proto.setViewState = original
    else active = false
  })
}

export async function openAsMarkdown(leaf: WorkspaceLeaf) {
  const state = leaf.getViewState()
  const file = state.state?.file
  if (typeof file === 'string') markdownMode.set(leaf, file)
  await leaf.setViewState({ ...state, type: 'markdown' })
}

export async function openAsBoard(leaf: WorkspaceLeaf) {
  markdownMode.delete(leaf)
  await leaf.setViewState({ ...leaf.getViewState(), type: VIEW_TYPE })
}
