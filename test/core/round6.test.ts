// M6c (feedback round 6): export headings, inherited line style.
import { describe, expect, it } from 'vitest'
import { addNode, inheritedStyle, tidyNodes } from '../../src/core/commands.ts'
import { parseBoardFile, replaceBoardJson, serializeBoardFile } from '../../src/core/io/boardFile.ts'
import { parseOutline, toMarkdown } from '../../src/core/io/outline.ts'
import type { Board, BoardNode } from '../../src/core/schema.ts'
import { LABEL_SIZE, resolveStyles } from '../../src/core/style.ts'
import { generateBoard } from '../generate.ts'
import { approxHeight, approxWidth } from '../../src/ui/overview.ts'

const board = (nodes: BoardNode[]): Board => ({ schema: 1, theme: {}, nodes, links: [] })

describe('export with headings (round 6, Q2)', () => {
  const outline = [
    '- Project',
    '\t- Phase',
    '\t\t- [x] Design',
    '\t\t\t- Sketch',
    '\t\t- Notes',
    '\t\t\t- deep',
    '\t- [ ] Top task',
    '\t\t- under it',
    '- Second root',
    '',
  ].join('\n')

  it('the top levels are headings, deeper levels bullets, and tasks stay checkboxes at any depth', () => {
    expect(toMarkdown(board(parseOutline(outline)), undefined, 2)).toBe([
      '# Project',
      '',
      '## Phase',
      '',
      '- [x] Design',
      '\t- Sketch',
      '- Notes',
      '\t- deep',
      '- [ ] Top task',
      '\t- under it',
      '',
      '# Second root',
      '',
    ].join('\n'))
  })

  it('0 heading levels is the plain checklist; more than 6 stops at ######', () => {
    const nodes = parseOutline(outline)
    expect(toMarkdown(board(nodes))).toBe(outline)
    const deep = parseOutline(Array.from({ length: 9 }, (_, i) => `${'\t'.repeat(i)}- L${i}`).join('\n'))
    const md = toMarkdown(board(deep), undefined, 9)
    expect(md).toContain('###### L5')
    expect(md).toContain('- L6\n\t- L7\n\t\t- L8')
  })

  it('a checkbox 20 levels down keeps its depth and status', () => {
    const deep = parseOutline(Array.from({ length: 21 }, (_, i) => `${'\t'.repeat(i)}- ${i === 20 ? '[x] ' : ''}L${i}`).join('\n'))
    const md = toMarkdown(board(deep), undefined, 3)
    expect(md).toContain(`${'\t'.repeat(17)}- [x] L20`)
  })

  it('round trips every generated board through heading export and parse', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const b = generateBoard(seed, 150)
      const flat = board(b.nodes.map(n => ({ ...n, text: n.text.replace(/\s*\n\s*/g, ' ').trim() })))
      const md = toMarkdown(flat, undefined, 3)
      expect(toMarkdown(board(parseOutline(md)), undefined, 3)).toBe(md)
    }
  })
})

describe('inheritedStyle (round 6, N4)', () => {
  it('a new node takes the shape and line style of the node it came from, not its label', () => {
    const from: BoardNode = { id: 'p', parent: 'r', order: 0, text: '', x: 0, y: 0, shape: 'pill', edgeDash: 'dotted', edgeArrow: 'none', edgeColor: 3, edgeLabel: 'x' }
    const b = addNode({ id: 'c', parent: 'p', x: 0, y: 0, ...inheritedStyle(from) })(board([from]))
    expect(b.nodes[1]).toMatchObject({ shape: 'pill', edgeDash: 'dotted', edgeArrow: 'none', edgeColor: 3 })
    expect(b.nodes[1].edgeLabel).toBeUndefined()
    expect(inheritedStyle(undefined)).toEqual({})
  })
})

describe('boards saved as TaskMindmap (round 6, N1)', () => {
  it('still open, and a save writes the MindmapMate names', () => {
    const old = serializeBoardFile(board([{ id: 'r', parent: null, order: 0, text: 'Root', x: 0, y: 0 }]))
      .replace('flowmap: 1', 'taskmindmap: 1').replace('```flowmap-json', '```taskmindmap-json')
    const parsed = parseBoardFile(old)
    expect(parsed.ok && parsed.board.nodes[0].text).toBe('Root')
    const saved = parsed.ok ? serializeBoardFile(parsed.board, parsed.frame) : ''
    expect(saved).toContain('flowmap: 1')
    expect(saved).toContain('```flowmap-json')
    expect(saved).not.toContain('taskmindmap')
    expect(replaceBoardJson(old, parsed.ok ? parsed.board : board([]))).toContain('```flowmap-json')
  })
})

describe('several roots (round 6)', () => {
  const size = () => ({ width: 100, height: 30 })
  // Two root trees whose tidied branches overlap, a far one, and a label sitting on top of the first.
  const nodes: BoardNode[] = [
    { id: 'a', parent: null, order: 0, text: 'a', x: 0, y: 0 },
    ...[0, 1, 2, 3].map(i => ({ id: `a${i}`, parent: 'a', order: i, text: '', x: 0, y: 0 })),
    { id: 'b', parent: null, order: 1, text: 'b', x: 0, y: 40 },
    { id: 'b0', parent: 'b', order: 0, text: '', x: 0, y: 0 },
    { id: 'far', parent: null, order: 2, text: 'far', x: 2000, y: 0 },
    { id: 'lab', parent: null, order: 3, text: 'Label', x: 10, y: 10, shape: 'label' },
  ]
  it('tidying the board keeps root trees from overlapping; far trees and labels stay put', () => {
    const b = tidyNodes(['a', 'b', 'far', 'lab'], size)(board(nodes))
    const at = (id: string) => b.nodes.find(n => n.id === id)!
    const aBottom = Math.max(...['a0', 'a1', 'a2', 'a3'].map(id => at(id).y)) + 30
    expect(Math.min(at('b').y, at('b0').y)).toBeGreaterThanOrEqual(aBottom + 40)
    expect(at('a')).toMatchObject({ x: 0, y: 0 })
    expect(at('far')).toMatchObject({ x: 2000, y: 0 })
    expect(at('lab')).toMatchObject({ x: 10, y: 10 })
  })
})

describe('labels (round 6, N3)', () => {
  it('a label resolves to its text size, 28 by default, and ignores a nonsense size', () => {
    const b = board([
      { id: 'l', parent: null, order: 0, text: '', x: 0, y: 0, shape: 'label', textSize: 48 },
      { id: 'd', parent: null, order: 1, text: '', x: 0, y: 0, shape: 'label', textSize: -3 },
      { id: 'n', parent: null, order: 2, text: '', x: 0, y: 0, textSize: 48 },
    ])
    const looks = resolveStyles(b).nodes
    expect([looks.get('l')!.size, looks.get('d')!.size, looks.get('n')!.size]).toEqual([48, LABEL_SIZE, undefined])
  })
})

// The minimap and overview draw labels at an estimated size; these are the sizes Obsidian drew in round 6.
it('label size estimate is within 5% of the drawn label', () => {
  const label = (textSize?: number): BoardNode => ({ id: 'a', parent: null, order: 0, text: 'Big section title', x: 0, y: 0, shape: 'label', textSize })
  for (const [n, w, h] of [[label(), 217, 39], [label(48), 364, 64]] as const) {
    expect(Math.abs(approxWidth(n) / w - 1)).toBeLessThan(0.05)
    expect(Math.abs(approxHeight(n) / h - 1)).toBeLessThan(0.05)
  }
})
