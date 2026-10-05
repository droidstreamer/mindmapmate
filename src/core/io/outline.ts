// Markdown outlines: one-way export (F13), and the clipboard (F15, D27): board JSON for pasting into a
// board, a plain-text outline for pasting into a note, and plain-text outlines pasted into a board.

import { newId } from '../commands.ts'
import { indexText } from './boardFile.ts'
import { dueSuffix, takeDue } from '../due.ts'
import { SCHEMA_VERSION, validateBoard, type Board, type BoardNode, type CrossLink, type Status } from '../schema.ts'
import { childrenMap, topmost, withDescendants } from '../tree.ts'

// Round 12: export writes only the two boxes every theme draws right (Obsidian's default theme ticks any character, so
// `[/]` looked done); the statuses they can't hold follow as a tag. Import reads both, and the other notes' `[/]`, `[!]`, `[-]`.
const BOX: Record<Status, string> = { todo: ' ', doing: ' ', blocked: ' ', done: 'x', dropped: 'x' }
const TAG: Partial<Record<Status, string>> = { doing: ' #status/doing', blocked: ' #status/blocked', dropped: ' #status/dropped' }
const FROM_BOX: Record<string, Status> = { ' ': 'todo', '/': 'doing', '!': 'blocked', x: 'done', X: 'done', '-': 'dropped' }
const FROM_TAG = /\s#status\/(doing|blocked|dropped)$/

/**
 * Outline of the given branches (all roots when omitted), in sibling order. Plain nodes are bullets, tasks checkboxes.
 * Round 6: with `headings` > 0, the top `headings` levels (up to 6, Markdown's limit) become headings `#` to `######`;
 * deeper levels nest as bullets, which have no depth limit. A task is never a heading (a heading can't hold a checkbox,
 * and the Tasks plugin wouldn't see it): it and everything under it are list items.
 */
export function toMarkdown(board: Pick<Board, 'nodes'>, ids?: Iterable<string>, headings = 0): string {
  const children = childrenMap(board.nodes)
  const tops = ids ? topmost(board.nodes, ids) : (children.get(null) ?? []).map(n => n.id)
  const byId = new Map(board.nodes.map(n => [n.id, n]))
  const top = Math.min(6, headings)
  const lines: string[] = []
  const walk = (n: BoardNode, depth: number, indent: number | null): void => {
    // Round 7 (D51): labels are board decoration and don't export; children one got before v0.7.4 take its place.
    if (n.shape === 'label') return void (children.get(n.id) ?? []).forEach(c => walk(c, depth, indent))
    // ponytail: multi-line node text is joined into one line; export is a snapshot, not a round trip of formatting.
    // Same escapes as the board index, so %%, a ^block tail or a leading [x] can't turn into Obsidian syntax.
    const text = indexText(n.text)
    if (indent === null && depth < top && !n.status) {
      if (lines.length && lines.at(-1) !== '') lines.push('')
      lines.push(`${'#'.repeat(depth + 1)} ${text.replace(/^#/, '\\#')}${dueSuffix(n)}`, '')
      for (const c of children.get(n.id) ?? []) walk(c, depth + 1, null)
      return
    }
    const at = indent ?? 0
    const box = n.status ? `[${BOX[n.status]}] ` : ''
    // A plain bullet starting with # would be a heading inside the list; after a checkbox it's text.
    const body = box ? text : text.replace(/^#/, '\\#')
    // M7: dates in the Tasks plugin's format, so Tasks queries over an export see them.
    lines.push(`${'\t'.repeat(at)}- ${box}${body}${n.status ? TAG[n.status] ?? '' : ''}${dueSuffix(n)}`)
    for (const c of children.get(n.id) ?? []) walk(c, depth + 1, at + 1)
  }
  // Keep board order for a selection too, not the order it was selected in.
  const rank = new Map(board.nodes.map((n, i) => [n.id, i]))
  for (const id of tops.sort((a, b) => rank.get(a)! - rank.get(b)!)) walk(byId.get(id)!, 0, null)
  while (lines.at(-1) === '') lines.pop()
  return lines.length ? lines.join('\n') + '\n' : ''
}

/**
 * Nodes from a Markdown or plain-text outline: each non-empty line is a node, nested under the
 * nearest line above it with less indentation, or under the nearest higher heading. Bullets, numbers and heading
 * marks are dropped, checkboxes become statuses. Positions are all 0; the caller tidies the result.
 */
export function parseOutline(text: string, taken: { has(id: string): boolean } = new Set()): BoardNode[] {
  const nodes: BoardNode[] = []
  const used = new Set<string>()
  const stack: { indent: number, id: string }[] = []
  const count = new Map<string | null, number>()
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    // A heading nests everything below it up to the next heading of its level or higher (F13 import), so headings
    // rank above any indentation: "#" at -6000, "######" at -1000.
    const heading = /^(#{1,6})\s+/.exec(raw)
    const indent = heading ? (heading[1].length - 7) * 1000 : raw.match(/^\s*/)![0].replace(/\t/g, '    ').length
    let line = raw.trim().replace(/^(?:[-*+]|\d+[.)]|#{1,6})\s+/, '')
    let status: Status | undefined
    const box = /^\[(.)\]\s+/.exec(line)
    if (box && FROM_BOX[box[1]]) { status = FROM_BOX[box[1]]; line = line.slice(box[0].length) }
    line = line.replace(/^\\([[#])/, '$1').replace(/\s\\\^/g, ' ^').replace(/(?:\\`){3,}/g, m => '`'.repeat(m.length / 2))
    const { text: body, due } = takeDue(line)
    line = body
    const tag = status && FROM_TAG.exec(line)
    if (tag) { status = tag[1] as Status; line = line.slice(0, tag.index) }
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = stack.at(-1)?.id ?? null
    const id = newId({ has: id => used.has(id) || taken.has(id) })
    used.add(id)
    const order = count.get(parent) ?? 0
    count.set(parent, order + 1)
    nodes.push({ id, parent, order, text: line, x: 0, y: 0, ...status ? { status } : {}, ...due ? { due } : {} })
    stack.push({ indent, id })
  }
  return nodes
}

const MARKER = 'flowmap-clip'
export type Clip = { nodes: BoardNode[], links: CrossLink[] }

/** D27: the selected branches (D38: or, with `branch` false, just the selected nodes) with the cross-links among them,
 *  as JSON for the clipboard. */
export function copyClip(board: Board, ids: Iterable<string>, branch = true): string {
  const keep = branch ? withDescendants(board.nodes, ids) : new Set(ids)
  const nodes = board.nodes.filter(n => keep.has(n.id)).map(n => keep.has(n.parent!) ? n : { ...n, parent: null })
  const links = board.links.filter(l => keep.has(l.from) && keep.has(l.to))
  return JSON.stringify({ [MARKER]: 1, nodes, links })
}

/** Clipboard JSON back into nodes and links with ids new to `board`. Undefined if it isn't a valid clip of ours. */
export function readClip(json: string, board: Board): Clip | undefined {
  let data: Record<string, unknown>
  try { data = JSON.parse(json) as Record<string, unknown> } catch { return undefined }
  if (data?.[MARKER] !== 1) return undefined
  // Clipboard text is untrusted: it must pass the same checks as a board file.
  const valid = validateBoard({ schema: SCHEMA_VERSION, theme: {}, nodes: data.nodes, links: data.links })
  if (!valid.ok) return undefined
  const taken = new Set([...board.nodes.map(n => n.id), ...board.links.map(l => l.id)])
  const ids = new Map<string, string>()
  const fresh = (old: string) => {
    const id = newId(taken)
    taken.add(id)
    ids.set(old, id)
    return id
  }
  for (const n of valid.board.nodes) fresh(n.id)
  return {
    nodes: valid.board.nodes.map(n => ({ ...n, id: ids.get(n.id)!, parent: n.parent === null ? null : ids.get(n.parent)! })),
    links: valid.board.links.map(l => ({ ...l, id: fresh(l.id), from: ids.get(l.from)!, to: ids.get(l.to)! })),
  }
}
