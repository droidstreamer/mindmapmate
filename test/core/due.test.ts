// M7 due dates: validation, state, index and export text, import.
import { describe, expect, it } from 'vitest'
import { setDue } from '../../src/core/commands.ts'
import { dayOf, dueState, filterMatches, inView, isDue, monthDays, takeDue } from '../../src/core/due.ts'
import { boardIndex } from '../../src/core/io/boardFile.ts'
import { parseOutline, toMarkdown } from '../../src/core/io/outline.ts'
import type { Board, BoardNode } from '../../src/core/schema.ts'

const board = (nodes: BoardNode[]): Board => ({ schema: 1, theme: {}, nodes, links: [] })
const node = (id: string, extra: Partial<BoardNode> = {}): BoardNode => ({ id, parent: null, order: 0, text: id, x: 0, y: 0, ...extra })

describe('due dates (M7)', () => {
  it('only real calendar dates count', () => {
    expect([isDue('2026-10-03'), isDue('2026-02-30'), isDue('2026-1-3'), isDue(20261003), isDue(undefined)]).toEqual([true, false, false, false, false])
    expect(dayOf(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('overdue, today, later; done and dropped tasks are closed', () => {
    const t = '2026-09-26'
    expect(dueState({ due: '2026-09-25' }, t)).toBe('overdue')
    expect(dueState({ due: t, status: 'todo' }, t)).toBe('today')
    expect(dueState({ due: '2026-10-01' }, t)).toBe('later')
    expect(dueState({ due: '2026-09-01', status: 'done' }, t)).toBe('closed')
    expect(dueState({ due: 'soon' }, t)).toBeUndefined()
  })

  it('setDue sets and clears, as one command', () => {
    const b = setDue(['a'], '2026-10-03')(board([node('a'), node('b')]))
    expect(b.nodes.map(n => n.due)).toEqual(['2026-10-03', undefined])
    expect('due' in setDue(['a'], undefined)(b).nodes[0]).toBe(false)
  })

  it('the index and exports carry the date; import reads it back', () => {
    const b = board([node('r', { text: 'Plan', due: '2026-10-01' }), { ...node('t', { status: 'todo', due: '2026-10-03' }), parent: 'r', text: 'Ship it' }])
    expect(boardIndex(b)).toContain('- Ship it (todo) 📅 2026-10-03 #due/2026-10-03 ^t')
    const md = toMarkdown(b, undefined, 1)
    expect(md).toBe('# Plan 📅 2026-10-01\n\n- [ ] Ship it 📅 2026-10-03\n')
    const back = parseOutline(md)
    expect(back.map(n => [n.text, n.due, n.status])).toEqual([['Plan', '2026-10-01', undefined], ['Ship it', '2026-10-03', 'todo']])
    expect(takeDue('Call 📅 2026-02-30')).toEqual({ text: 'Call 📅 2026-02-30' })
  })
})

describe('monthDays (round 17)', () => {
  it('is six whole weeks that start on the chosen weekday and hold the month', () => {
    const sun = monthDays(2026, 8, 0) // September 2026 starts on a Tuesday
    expect(sun).toHaveLength(42)
    expect(sun[0]).toEqual({ day: '2026-08-30', inMonth: false })
    expect(sun.filter(d => d.inMonth)).toHaveLength(30)
    expect(monthDays(2026, 8, 1)[0].day).toBe('2026-08-31')
    expect(monthDays(2026, 11, 0).at(-1)!.day).toBe('2027-01-09') // crosses the year
  })

  it('M8 views: today, the next 7 days, blocked, doing; closed tasks are never due', () => {
    const t = '2026-09-28', pick = (v: Parameters<typeof inView>[1], ns: Parameters<typeof inView>[0][]) => ns.map(n => inView(n, v, t))
    const dated = [{ due: '2026-09-27' }, { due: t }, { due: '2026-10-05' }, { due: '2026-10-06' }, { due: t, status: 'done' as const }, {}]
    expect(pick('today', dated)).toEqual([false, true, false, false, false, false])
    expect(pick('week', dated)).toEqual([false, true, true, false, false, false])
    expect(pick('overdue', dated)).toEqual([true, false, false, false, false, false])
    expect(pick('blocked', [{ status: 'blocked' }, { status: 'doing' }, {}])).toEqual([true, false, false])
    expect(pick('doing', [{ status: 'blocked' }, { status: 'doing' }, {}])).toEqual([false, true, false])
  })

  it('R24 filter: any ticked view counts, N days stretches the window, nothing ticked dims nothing', () => {
    const t = '2026-09-28', ns = [node('a', { due: '2026-09-27' }), node('b', { due: '2026-10-01' }), node('c', { status: 'blocked' }), node('d')]
    expect(filterMatches(ns, { views: [], days: 7 }, t)).toBeNull()
    expect([...filterMatches(ns, { views: ['overdue', 'blocked'], days: 7 }, t)!]).toEqual(['a', 'c'])
    expect([...filterMatches(ns, { views: ['week'], days: 2 }, t)!]).toEqual([])
    expect([...filterMatches(ns, { views: ['week'], days: 3 }, t)!]).toEqual(['b'])
  })
})
