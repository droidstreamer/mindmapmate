// M7 due dates (v1.1): a node's `due` is a local calendar date, "YYYY-MM-DD". Pure: no React, React Flow or Obsidian.

import type { BoardNode } from './schema.ts'

/** The Tasks plugin's due-date sign; the index and exports write dates after it, so search and Tasks find them. */
export const DUE_MARK = '📅'
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date in "YYYY-MM-DD" form (a bad stored value is ignored, never refused). */
export function isDue(v: unknown): v is string {
  const m = typeof v === 'string' && DATE.exec(v)
  if (!m) return false
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]
}

/** Today (or `at`) as a local "YYYY-MM-DD". */
export const dayOf = (at = new Date()) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

/** How a node's date shows: overdue (red), due today (amber), later, or closed (a done or dropped task: muted). */
export type DueState = 'overdue' | 'today' | 'later' | 'closed'
export function dueState(n: Pick<BoardNode, 'due' | 'status'>, today: string): DueState | undefined {
  if (!isDue(n.due)) return undefined
  if (n.status === 'done' || n.status === 'dropped') return 'closed'
  return n.due < today ? 'overdue' : n.due === today ? 'today' : 'later'
}

/** M8: the board's "Show …" views. Done and dropped tasks are never due; "week" is today through the next `days` (7). */
export type DueView = 'overdue' | 'today' | 'week' | 'blocked' | 'doing'
export function inView(n: Pick<BoardNode, 'due' | 'status'>, view: DueView, today: string, days = 7): boolean {
  if (view === 'blocked' || view === 'doing') return n.status === view
  const s = dueState(n, today)
  if (view !== 'week') return s === view
  const [y, m, d] = today.split('-').map(Number)
  return (s === 'today' || s === 'later') && n.due! <= dayOf(new Date(y, m - 1, d + days))
}

/** R24 (D68): the ticked filters of the board's filter menu, and N for "due in the next N days" (the "week" view). */
export interface DueFilter { views: DueView[], days: number }
/** The ids matching any ticked filter, or null when none is ticked (nothing dims). */
export function filterMatches(nodes: readonly BoardNode[], f: DueFilter, today: string): Set<string> | null {
  if (!f.views.length) return null
  return new Set(nodes.filter(n => f.views.some(v => inView(n, v, today, f.days))).map(n => n.id))
}

/** " 📅 2026-10-03" for index and export lines, or nothing. */
export const dueSuffix = (n: Pick<BoardNode, 'due'>) => isDue(n.due) ? ` ${DUE_MARK} ${n.due}` : ''

/** Splits a trailing " 📅 YYYY-MM-DD" off an outline line (import and paste). */
export function takeDue(line: string): { text: string, due?: string } {
  const m = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/u.exec(line)
  return m && isDue(m[1]) ? { text: line.slice(0, m.index), due: m[1] } : { text: line }
}

/** The chip text: "Oct 3", with the year when it isn't this year's ("Oct 3, 2027"). */
export function shortDay(due: string, today: string): string {
  const [y, m, d] = due.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...due.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' } })
}

/** Round 17: the 6 weeks a month's calendar shows, from the week's `first` day (0 Sunday … 6 Saturday); `month` is 0-11. */
export function monthDays(year: number, month: number, first = 0): { day: string, inMonth: boolean }[] {
  const lead = (new Date(year, month, 1).getDay() - first + 7) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - lead + i)
    return { day: dayOf(d), inMonth: d.getMonth() === month }
  })
}
