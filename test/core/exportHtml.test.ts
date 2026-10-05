// Round 17: the HTML export page: the script parses, the page loads nothing, and the title is escaped.
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { htmlPage } from '../../src/ui/exportHtml.ts'

const page = htmlPage('A <b>"board"</b>', '<svg viewBox="0 0 10 10"></svg>', '#fff', { accent: '#00f', red: '#f00', faint: '#999', muted: '#666', line: '#ddd' })

describe('htmlPage', () => {
  it('has a script that parses and no way to reach the network', () => {
    const js = /<script>([\s\S]*)<\/script>/.exec(page)![1]
    expect(() => new Script(js)).not.toThrow()
    expect(page).toContain("default-src 'none'")
    expect(js).not.toMatch(/\bfetch\b|XMLHttpRequest|eval\(|innerHTML|import\s*\(/)
  })
  it('escapes the title', () => {
    expect(page).toContain('<title>A &lt;b&gt;&quot;board&quot;&lt;/b&gt;</title>')
  })
})
