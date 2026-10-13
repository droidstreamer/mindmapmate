// Board keys (D24, D25). Handled only while the board has focus and no node is being edited;
// anything not listed here passes through to Obsidian. Users change bindings in the plugin's settings (M6), stored in
// data.json under "keys". Checked against Obsidian's default hotkeys in Spike D; see the hotkey audit in the wiki.
//
// Binding format: modifiers joined with "+", then a key. "Mod" is Ctrl, or Cmd on macOS.
// The key matches KeyboardEvent.key (any case) or KeyboardEvent.code, e.g. "Mod+Shift+Z", "Shift+Digit1".

export const DEFAULT_KEYS = {
  undo: ['Mod+Z'],
  redo: ['Mod+Shift+Z', 'Mod+Y'],
  selectAll: ['Mod+A'],
  delete: ['Delete', 'Backspace'],
  deleteKeepChildren: ['Shift+Delete', 'Shift+Backspace'],
  zoomToFit: ['Shift+Digit1'],
  zoomToSelection: ['Shift+Digit2'],
  editNode: ['Shift+E'], // PRD proposed F2, but F2 is Obsidian's "Rename file" (Spike D)
  addChild: ['Tab'],
  addSibling: ['Enter'],
  selectUp: ['ArrowUp'],
  selectDown: ['ArrowDown'],
  selectLeft: ['ArrowLeft'],
  selectRight: ['ArrowRight'],
  moveUp: ['Alt+ArrowUp'],
  moveDown: ['Alt+ArrowDown'],
  toggleCollapse: ['Mod+Period'],
  tidy: ['Shift+L'],
  swapPanSelect: ['Shift+M'], // left drag pans and Space+drag selects, or back
  // Not Mod+L (PRD) or Mod+Enter: Obsidian's hotkey handler takes any key bound to an editor command,
  // even when no editor is open, before the board sees it (found in M3).
  toggleDone: ['Mod+Shift+Enter'],
}

export type Action = keyof typeof DEFAULT_KEYS
export type Keymap = Record<Action, string[]>

/** Names for the settings screen. */
export const ACTION_NAMES: Record<Action, string> = {
  undo: 'Undo', redo: 'Redo', selectAll: 'Select all', delete: 'Delete selection', deleteKeepChildren: 'Delete node, keep its children', zoomToFit: 'Zoom to fit',
  zoomToSelection: 'Focus selection', editNode: 'Edit node text', addChild: 'Add child', addSibling: 'Add sibling',
  selectUp: 'Select node above', selectDown: 'Select node below', selectLeft: 'Select node to the left', selectRight: 'Select node to the right',
  moveUp: 'Move node up among siblings', moveDown: 'Move node down among siblings', toggleCollapse: 'Collapse or expand',
  tidy: 'Tidy selected branches', swapPanSelect: 'Swap drag: pan or select', toggleDone: 'Toggle done',
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock'])

/**
 * M6: the binding a key press makes, for recording keys in settings; undefined for a lone modifier. Digits and letters
 * use their key code with Shift or Alt ("Shift+Digit1", not "Shift+!"), which is how `matches` reads them anyway.
 */
export function bindingFor(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | undefined {
  if (MODIFIER_KEYS.has(e.key)) return
  const mods = [(isMac ? e.metaKey : e.ctrlKey) && 'Mod', (isMac ? e.ctrlKey : e.metaKey) && (isMac ? 'Ctrl' : 'Meta'), e.altKey && 'Alt', e.shiftKey && 'Shift']
  const typed = (e.shiftKey || e.altKey) && /^(Digit\d|Key[A-Z])$/.test(e.code) ? e.code : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [...mods.filter(Boolean), typed].join('+')
}

const KEY_NAMES: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Period: '.', Escape: 'Esc', Delete: 'Del' }

/** Round 11: a binding as the shortcut hints show it: "Mod+Shift+Digit1" is "Ctrl+Shift+1" (Cmd on macOS). */
export function keyLabel(binding: string): string {
  return binding.split('+').map(p => p === 'Mod' ? (isMac ? 'Cmd' : 'Ctrl') : KEY_NAMES[p] ?? p.replace(/^(Digit|Key)(.)$/, '$2')).join('+')
}

/** Mod is Cmd on macOS. The plugin sets this from Obsidian's Platform at load; this file stays free of Obsidian imports. */
let isMac = false
export const setMacKeys = (mac: boolean) => { isMac = mac }

function matches(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.split('+')
  const key = parts.pop()!.toLowerCase()
  const mods = new Set(parts.map(p => p.toLowerCase()))
  const mod = isMac ? e.metaKey : e.ctrlKey
  const other = isMac ? e.ctrlKey : e.metaKey
  return mod === mods.has('mod') && other === (mods.has('ctrl') || mods.has('meta'))
    && e.shiftKey === mods.has('shift') && e.altKey === mods.has('alt')
    && (e.key.toLowerCase() === key || e.code.toLowerCase() === key)
}

export function actionFor(e: KeyboardEvent, keymap: Keymap): Action | undefined {
  return (Object.keys(keymap) as Action[]).find(a => keymap[a].some(b => matches(e, b)))
}
