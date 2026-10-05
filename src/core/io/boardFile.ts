// Read and write `*.board.md` files: frontmatter, a generated index, and the board JSON in a hidden block.

import { SCHEMA_VERSION, validateBoard, type Board } from '../schema.ts'
import { dueSuffix } from '../due.ts'
import { childrenMap } from '../tree.ts'

export const FRONTMATTER_KEY = 'flowmap'
const FENCE = 'flowmap-json'
/** Round 6: the plugin was TaskMindmap. Boards saved by it still open; a save rewrites the data block's fence (after the
 *  index, so D19's offsets don't move), and the frontmatter key when the whole file is written. */
export const LEGACY_KEY = 'taskmindmap'

/** What a save keeps from the file around the generated parts: the frontmatter, the user's own notes above the index
 *  heading, and anything after the data block (M6: these were dropped on save before). */
export type Frame = { frontmatter: string, notes: string, after: string }

export type ParseResult =
  | { ok: true, board: Board, frame: Frame }
  | { ok: false, reason: 'no-data' | 'invalid-json' | 'invalid' | 'newer-schema', message: string }

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const DATA_BLOCK = new RegExp('^```(?:' + FENCE + '|' + LEGACY_KEY + '-json)\\r?\\n([\\s\\S]*?)\\r?\\n```\\s*$', 'm')
const INDEX_HEADING = /^## Board index[ \t]*$/m

export function parseBoardFile(text: string): ParseResult {
  const frontmatter = FRONTMATTER.exec(text)?.[0] ?? ''
  const match = DATA_BLOCK.exec(text.slice(frontmatter.length))
  if (!match) return { ok: false, reason: 'no-data', message: `No \`${FENCE}\` data block found in this file.` }

  let json: unknown
  try {
    json = JSON.parse(match[1])
  } catch (e) {
    return { ok: false, reason: 'invalid-json', message: `The board data is not valid JSON: ${(e as Error).message}` }
  }
  const result = validateBoard(json)
  if (!result.ok) return result
  // The user's notes run up to the index heading (or, without one, up to the %% line that opens the data block).
  const body = text.slice(frontmatter.length)
  const heading = INDEX_HEADING.exec(body)
  const notes = heading && heading.index < match.index ? body.slice(0, heading.index) : body.slice(0, match.index).replace(/%%[ \t]*\r?\n?$/, '')
  // After the closing fence: the %% line that hides the data in reading view, then anything the user added.
  const after = body.slice(match.index + match[0].length).replace(/^[ \t]*\r?\n%%[ \t]*(?:\r?\n|$)/, '')
  return { ok: true, board: result.board, frame: { frontmatter, notes, after } }
}

/** The raw board JSON in a file, for telling a data edit from an index-only one (Obsidian's link updater, D19). */
export const boardData = (text: string) => DATA_BLOCK.exec(text.slice(FRONTMATTER.exec(text)?.[0].length ?? 0))?.[1]

/**
 * D19: the file with only its data block replaced. When a note is renamed, Obsidian's link updater rewrites links in
 * the index at character offsets it read before the rename, without checking them; changing the index first would
 * garble it. The data block comes after the index, so rewriting it never moves those offsets.
 */
export const replaceBoardJson = (text: string, board: Board) => {
  const fm = FRONTMATTER.exec(text)?.[0] ?? ''
  return fm + text.slice(fm.length).replace(DATA_BLOCK, () => '```' + FENCE + '\n' + boardJson(board) + '\n```')
}

/**
 * D21: the node a link subpath ("#^id") or a search hit (a character offset or line number in the file) points at:
 * an index line ends with "^id", a data line starts with {"id":"…". Callers check the id exists.
 */
export function nodeIdAt(text: string, at: { subpath?: string, offset?: number, line?: number }): string | undefined {
  if (at.subpath !== undefined) return /^#\^([A-Za-z0-9-]+)$/.exec(at.subpath)?.[1]
  let start = 0
  if (at.offset !== undefined) start = text.lastIndexOf('\n', at.offset - 1) + 1
  else if (at.line !== undefined) for (let i = 0; i < at.line; i++) { start = text.indexOf('\n', start) + 1; if (!start) return }
  else return
  const end = text.indexOf('\n', start)
  const line = text.slice(start, end < 0 ? undefined : end)
  return /\^([A-Za-z0-9-]+)\s*$/.exec(line)?.[1] ?? /^\s*\{"id":"([A-Za-z0-9-]+)"/.exec(line)?.[1]
}

export const NEW_FRAME: Frame = { frontmatter: `---\n${FRONTMATTER_KEY}: ${SCHEMA_VERSION}\n---\n`, notes: '\n', after: '' }

/** The whole file: the frame kept as it was, the index and the data regenerated. */
export function serializeBoardFile(board: Board, frame: Frame = NEW_FRAME): string {
  const frontmatter = frame.frontmatter.replace(new RegExp(`^${LEGACY_KEY}:`, 'm'), `${FRONTMATTER_KEY}:`)
  return `${frontmatter}${frame.notes}## Board index\n\n${boardIndex(board)}\n%%\n\`\`\`${FENCE}\n${boardJson(board)}\n\`\`\`\n%%\n${frame.after}`
}

export function newBoardFile(rootText = 'Central idea'): string {
  return serializeBoardFile({
    schema: SCHEMA_VERSION,
    theme: {},
    nodes: [{ id: 'root', parent: null, order: 0, text: rootText, x: 0, y: 0 }],
    links: [],
  })
}

/** Plain-text outline for Obsidian search and block links. Never uses checkbox syntax (D20). */
export function boardIndex(board: Board): string {
  const children = childrenMap(board.nodes)
  const lines: string[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      const status = n.status ? ` (${n.status})` : ''
      // F10: the link field as a wikilink, so the note's backlinks list the board.
      const link = typeof n.link === 'string' ? ` [[${n.link.replace(/\.md$/, '')}]]` : ''
      // M7: the due date as "📅 2026-10-03", so global search finds a board's dates ("📅 2026-10" is all of October).
      // Round 8: and as the tag #due/2026-10-03, so the Tags pane lists every date (tag:#due finds them all).
      const due = dueSuffix(n)
      lines.push(`${'    '.repeat(depth)}- ${indexText(n.text)}${link}${status}${due}${due ? ` #due/${n.due}` : ''} ^${n.id}`)
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines.length ? lines.join('\n') + '\n' : ''
}

export function indexText(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/%%/g, '% %')         // would open an Obsidian comment
    .replace(/^\[(.)\]/, '\\[$1]')  // would read as a task checkbox
    .replace(/\s\^/g, ' \\^')       // would read as a block id
    .replace(/`{3,}/g, m => '\\`'.repeat(m.length))  // Obsidian opens a code block at ``` anywhere in a list item
}

// Stable key order, one node per line (readable git diffs). Backticks and percent signs are
// \u-escaped so node text can never close the code fence or the %% comment.
const NODE_KEYS = ['id', 'parent', 'order', 'text', 'x', 'y']
const LINK_KEYS = ['id', 'from', 'to']
const BOARD_KEYS = ['schema', 'theme', 'nodes', 'links']

function ordered(obj: Record<string, unknown>, first: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of first) if (k in obj) out[k] = obj[k]
  for (const k of Object.keys(obj).sort()) if (!first.includes(k)) out[k] = sortKeys(obj[k])
  return out
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return ordered(v as Record<string, unknown>, [])
  return v
}

const line = (v: unknown) => JSON.stringify(v).replace(/[`%]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

function list(items: Record<string, unknown>[], keys: string[]): string {
  return items.length ? `[\n${items.map(i => '    ' + line(ordered(i, keys))).join(',\n')}\n  ]` : '[]'
}

export function boardJson(board: Board): string {
  const top = ordered(board, BOARD_KEYS)
  const parts = Object.keys(top).map(k => {
    const value =
      k === 'nodes' ? list(board.nodes, NODE_KEYS) :
      k === 'links' ? list(board.links, LINK_KEYS) :
      line(top[k])
    return `  ${JSON.stringify(k)}: ${value}`
  })
  return `{\n${parts.join(',\n')}\n}`
}
