// Board types, validation and migrations. Pure TypeScript: no React, React Flow or Obsidian imports.

export const SCHEMA_VERSION = 1

export type Status = 'todo' | 'doing' | 'blocked' | 'done' | 'dropped'

export interface BoardNode {
  id: string
  parent: string | null
  order: number
  text: string
  x: number
  y: number
  status?: Status
  /** M7: due date, "YYYY-MM-DD" (see `due.ts`). */
  due?: string
  collapsed?: boolean
  // Style overrides (D13, D28), checked when resolved in `style.ts`, never here: a bad value is ignored, not refused.
  // Colors are "auto", a preset index 0-7 or a custom "#rrggbb"; fill can also be null (none).
  shape?: string
  stroke?: string | number
  fill?: string | number | null
  /** The line into this node from its parent (edgeDash, edgeArrow, edgeDirection, edgeColor, edgeLabel). */
  edgeLabel?: string
  /** Round 6: a label's text size in px (shape "label"). */
  textSize?: number
  width?: number
  link?: string
  [unknownKey: string]: unknown
}

export interface CrossLink {
  id: string
  from: string
  to: string
  label?: string
  [unknownKey: string]: unknown
}

export interface Board {
  schema: number
  theme: Record<string, unknown>
  nodes: BoardNode[]
  links: CrossLink[]
  [unknownKey: string]: unknown
}

export type ValidationResult =
  | { ok: true, board: Board }
  | { ok: false, reason: 'invalid' | 'newer-schema', message: string }

// Ids double as Obsidian block ids (D21), which allow only letters, digits and dashes.
const ID = /^[A-Za-z0-9-]+$/
const STATUSES = new Set(['todo', 'doing', 'blocked', 'done', 'dropped'])

// Migration from schema N to N+1 lives at index N. Empty until schema 2 exists (D8).
const migrations: ((board: Record<string, unknown>) => Record<string, unknown>)[] = []

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function validateBoard(input: unknown): ValidationResult {
  const fail = (message: string): ValidationResult => ({ ok: false, reason: 'invalid', message })
  if (!isObject(input)) return fail('Board data is not a JSON object.')

  const schema = input.schema
  if (!Number.isInteger(schema) || (schema as number) < 1) return fail('Missing or invalid "schema" number.')
  if ((schema as number) > SCHEMA_VERSION)
    return { ok: false, reason: 'newer-schema', message: `This board uses schema ${String(schema)}, but this plugin version only understands up to ${SCHEMA_VERSION}. Update the plugin to edit it.` }

  let data = input
  for (let v = schema as number; v < SCHEMA_VERSION; v++) data = migrations[v](data)

  if (!isObject(data.theme)) return fail('"theme" must be an object.')
  if (!Array.isArray(data.nodes)) return fail('"nodes" must be an array.')
  if (!Array.isArray(data.links)) return fail('"links" must be an array.')

  const ids = new Set<string>()
  for (const [i, n] of data.nodes.entries()) {
    const where = `nodes[${i}]`
    if (!isObject(n)) return fail(`${where} is not an object.`)
    if (typeof n.id !== 'string' || !ID.test(n.id)) return fail(`${where} has an invalid id (letters, digits and dashes only).`)
    if (ids.has(n.id)) return fail(`Duplicate node id "${n.id}".`)
    ids.add(n.id)
    if (n.parent !== null && typeof n.parent !== 'string') return fail(`Node "${n.id}" has an invalid parent.`)
    if (typeof n.text !== 'string') return fail(`Node "${n.id}" has no text.`)
    for (const k of ['order', 'x', 'y'])
      if (typeof n[k] !== 'number' || !Number.isFinite(n[k])) return fail(`Node "${n.id}" has an invalid "${k}".`)
    if (n.status !== undefined && !STATUSES.has(n.status as string)) return fail(`Node "${n.id}" has an unknown status ${JSON.stringify(n.status)}.`)
  }

  const nodes = data.nodes as BoardNode[]
  const parentOf = new Map(nodes.map(n => [n.id, n.parent]))
  for (const n of nodes) {
    if (n.parent !== null && !parentOf.has(n.parent)) return fail(`Node "${n.id}" points to a missing parent "${n.parent}".`)
    // Walk up; a strict tree reaches a root within nodes.length steps (D1).
    let p = n.parent
    for (let steps = 0; p !== null; steps++) {
      if (steps > nodes.length) return fail(`Node "${n.id}" is part of a parent cycle.`)
      p = parentOf.get(p) ?? null
    }
  }

  const linkIds = new Set<string>()
  for (const [i, l] of data.links.entries()) {
    const where = `links[${i}]`
    if (!isObject(l)) return fail(`${where} is not an object.`)
    if (typeof l.id !== 'string' || !ID.test(l.id) || linkIds.has(l.id)) return fail(`${where} has a missing, invalid or duplicate id.`)
    linkIds.add(l.id)
    if (!ids.has(l.from as string) || !ids.has(l.to as string)) return fail(`Link "${l.id}" points to a missing node.`)
  }

  return { ok: true, board: data as Board }
}
