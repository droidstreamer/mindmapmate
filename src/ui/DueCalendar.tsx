// Round 17: the due-date calendar, drawn with Obsidian's theme variables (the system date picker can't be themed).

import { useState } from 'react'
import { dayOf, isDue, monthDays } from '../core/due.ts'

/** The locale's first weekday as 0 Sunday … 6 Saturday (Sunday where the browser can't say). */
function firstWeekday(): number {
  const info = (new Intl.Locale(navigator.language) as { getWeekInfo?: () => { firstDay: number }, weekInfo?: { firstDay: number } })
  return ((info.getWeekInfo?.() ?? info.weekInfo)?.firstDay ?? 7) % 7
}

export function DueCalendar({ value, onPick }: { value?: string, onPick: (day: string) => void }) {
  const today = dayOf(), first = firstWeekday()
  const start = isDue(value) ? value : today
  const [[year, month], setView] = useState<[number, number]>(() => [+start.slice(0, 4), +start.slice(5, 7) - 1])
  const step = (by: number) => setView(([y, m]) => { const t = new Date(y, m + by, 1); return [t.getFullYear(), t.getMonth()] })
  const title = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  // Jan 1 2023 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + first + i).toLocaleDateString(undefined, { weekday: 'narrow' }))
  const keep = (e: React.MouseEvent) => e.preventDefault()
  return (
    <div className="flowmap-cal">
      <div className="flowmap-cal-head">
        <button aria-label="Previous month" onMouseDown={keep} onClick={() => step(-1)}>‹</button>
        <span>{title}</span>
        <button aria-label="Next month" onMouseDown={keep} onClick={() => step(1)}>›</button>
      </div>
      <div className="flowmap-cal-grid">
        {weekdays.map((w, i) => <span key={i} className="flowmap-cal-dow">{w}</span>)}
        {monthDays(year, month, first).map(({ day, inMonth }) => (
          <button key={day} onMouseDown={keep} onClick={() => onPick(day)}
            className={'flowmap-cal-day' + (inMonth ? '' : ' is-out') + (day === today ? ' is-today' : '') + (day === value ? ' is-picked' : '')}>{+day.slice(8)}</button>
        ))}
      </div>
    </div>
  )
}
