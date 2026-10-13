import { describe, expect, it } from 'vitest'
import { makeChild, makeLink, retargetLinks } from '../../src/core/commands.ts'
import { boardData, boardIndex, nodeIdAt, parseBoardFile, replaceBoardJson, serializeBoardFile } from '../../src/core/io/boardFile.ts'
import { copyClip, parseOutline } from '../../src/core/io/outline.ts'
import { displayText, mapWikilinks, movedTarget, noteName, textParts } from '../../src/core/links.ts'
import { validateBoard, type Board, type BoardNode } from '../../src/core/schema.ts'
import { sampleBoard } from '../../src/core/io/sample.ts'
import { hexToHsl, hslToHex } from '../../src/core/style.ts'

const board = (): Board => ({ schema: 1, theme: {}, links: [], nodes: [
  { id: 'a', parent: null, order: 0, text: 'Plan', x: 0, y: 0, link: 'Notes/Plan.md' },
  { id: 'b', parent: 'a', order: 0, text: 'see [[Loot Tables#Drops|drops]] and [[Games/Boss]]', x: 0, y: 0 },
] })

describe('wikilinks in node text (F10)', () => {
  it('splits text into runs and links, showing alias or target', () => {
    expect(textParts('see [[Loot Tables#Drops|drops]], [[A#B]] and [[#^x1]]')).toEqual([
      'see ', { linktext: 'Loot Tables#Drops', label: 'drops' }, ', ', { linktext: 'A#B', label: 'A > B' }, ' and ', { linktext: '#^x1', label: '^x1' },
    ])
    expect(textParts('no links [[ here')).toEqual(['no links [[ here'])
    expect(displayText('[[Games/Boss]] fight')).toBe('Games/Boss fight')
  })

  it('finds #tags as Obsidian does, and leaves anchors, numbers and link subpaths alone', () => {
    expect(textParts('#todo fix this #area/work-1 now')).toEqual([
      { tag: 'todo', label: '#todo' }, ' fix this ', { tag: 'area/work-1', label: '#area/work-1' }, ' now',
    ])
    expect(textParts('issue #123, a#b, https://x.io/#top and [[Note#Head]]')).toEqual([
      'issue #123, a#b, https://x.io/#top and ', { linktext: 'Note#Head', label: 'Note > Head' },
    ])
    expect(displayText('ship #v2 today')).toBe('ship #v2 today')
  })

  it('maps link paths and keeps subpath and alias', () => {
    const to = (p: string) => p === 'Loot Tables' ? 'Archive/Loot' : undefined
    expect(mapWikilinks('[[Loot Tables#Drops|drops]] [[Loot Tables]] [[Other]]', to)).toBe('[[Archive/Loot#Drops|drops]] [[Archive/Loot]] [[Other]]')
  })

  it('works out where a moved note or folder took a link path', () => {
    expect(movedTarget('Loot Tables', 'Loot Tables.md', 'Archive/Loot 2.md')).toBe('Archive/Loot 2.md')
    expect(movedTarget('Games/Boss', 'Games/Boss.md', 'Boss.md')).toBe('Boss.md')
    expect(movedTarget('Boss', 'Games/Boss.md', 'Games/Boss 2.md')).toBe('Games/Boss 2.md')
    expect(movedTarget('Games/Boss', 'Games', 'Old/Games')).toBe('Old/Games/Boss')
    expect(movedTarget('Gam/Boss', 'Games', 'Old/Games')).toBeUndefined()
    expect(movedTarget('Other', 'Loot Tables.md', 'X.md')).toBeUndefined()
  })

  it('retargetLinks moves link fields and text links in one step, and is a no-op otherwise', () => {
    const b = board()
    const next = retargetLinks('Notes', 'Old', p => p === 'Games/Boss' ? 'Boss' : undefined)(b)
    expect(next.nodes.map(n => [n.link, n.text])).toEqual([['Old/Plan.md', 'Plan'], [undefined, 'see [[Loot Tables#Drops|drops]] and [[Boss]]']])
    expect(next.nodes[1]).not.toHaveProperty('link')
    expect(retargetLinks('Else.md', 'X.md', () => undefined)(b)).toBe(b)
  })

  it('note names drop characters Obsidian refuses', () => {
    expect(noteName('Fix [[Boss]]: phase 2 / #3?\nmore')).toBe('Fix Boss phase 2 3')
    expect(noteName('  ##  ')).toBe('Untitled')
  })
})

describe('board file and links (D19, D21)', () => {
  it('the index carries the link field as a wikilink, for backlinks', () => {
    expect(boardIndex(board())).toBe('- Plan [[Notes/Plan]] ^a\n    - see [[Loot Tables#Drops|drops]] and [[Games/Boss]] ^b\n')
  })

  it('replacing the data block leaves every character before it alone', () => {
    const text = serializeBoardFile(board()).replace('- Plan', '- Plan edited by the link updater')
    const next = retargetLinks('Notes/Plan.md', 'Plan.md')(board())
    const out = replaceBoardJson(text, next)
    expect(out.slice(0, text.indexOf('```'))).toBe(text.slice(0, text.indexOf('```')))
    const parsed = parseBoardFile(out)
    expect(parsed.ok && parsed.board).toEqual(next)
    expect(boardData(out)).not.toBe(boardData(text))
    expect(boardData(text.replace('^a', '^a '))).toBe(boardData(text))
  })

  it('finds the node for a block link, a search hit in the index or in the data, or a line number', () => {
    const text = serializeBoardFile(board())
    expect(nodeIdAt(text, { subpath: '#^b' })).toBe('b')
    expect(nodeIdAt(text, { subpath: '#Board index' })).toBeUndefined()
    expect(nodeIdAt(text, { offset: text.indexOf('Loot Tables') })).toBe('b')
    expect(nodeIdAt(text, { offset: text.lastIndexOf('Plan"') })).toBe('a')
    expect(nodeIdAt(text, { line: text.split('\n').findIndex(l => l.endsWith('^a')) })).toBe('a')
    expect(nodeIdAt(text, { offset: 0 })).toBeUndefined()
  })
})

describe('outline import (F13)', () => {
  it('headings nest the lists and text below them', () => {
    const nodes = parseOutline('# Game\nintro\n## Combat\n- [x] melee\n\t- combos\n## Levels\n- forest\n# Later\n- polish')
    const byText = new Map(nodes.map(n => [n.text, n]))
    const parent = (t: string) => nodes.find(n => n.id === byText.get(t)!.parent)?.text ?? null
    expect(['Game', 'intro', 'Combat', 'melee', 'combos', 'Levels', 'forest', 'Later', 'polish'].map(parent))
      .toEqual([null, 'Game', 'Game', 'Combat', 'melee', 'Game', 'Levels', null, 'Later'])
    expect(byText.get('melee')!.status).toBe('done')
  })
})

describe('M5c: children and links (D37), node-only copy (D38), HSL (D40)', () => {
  // r -> a -> a1, r -> b; link a1 -> b labelled "needs"
  const b0 = (): Board => ({ schema: 1, theme: {}, nodes: [
    { id: 'r', parent: null, order: 0, text: 'r', x: 0, y: 0 },
    { id: 'a', parent: 'r', order: 0, text: 'a', x: 0, y: 0, edgeDash: 'dotted', edgeLabel: 'part' },
    { id: 'a1', parent: 'a', order: 0, text: 'a1', x: 0, y: 0 },
    { id: 'b', parent: 'r', order: 1, text: 'b', x: 0, y: 0 },
  ], links: [{ id: 'l1', from: 'a1', to: 'b', label: 'needs', dash: 'solid' }] })

  it('a link becomes a parent line: its end node moves under its start node, keeping the label', () => {
    const b = makeChild(['l1'])(b0())
    expect(b.links).toEqual([])
    expect(b.nodes.find(n => n.id === 'b')).toMatchObject({ parent: 'a1', edgeLabel: 'needs' })
  })

  it('a link that would make a node its own ancestor stays a link', () => {
    const b = { ...b0(), links: [{ id: 'l2', from: 'a1', to: 'r' }] }
    expect(makeChild(['l2'])(b)).toBe(b)
  })

  it('a parent line becomes a link from the old parent; the child becomes a root and drops the line style', () => {
    const b = makeLink(['a'], ['new1'])(b0())
    expect(b.nodes.find(n => n.id === 'a')).toEqual({ id: 'a', parent: null, order: 1, text: 'a', x: 0, y: 0 })
    expect(b.links.at(-1)).toEqual({ id: 'new1', from: 'r', to: 'a', label: 'part' })
    expect(makeLink(['r'], ['x'])(b0())).toEqual(b0()) // a root has no parent line
  })

  it('node-only copy leaves the children out; branch copy keeps them', () => {
    const only = JSON.parse(copyClip(b0(), ['a'], false)), branch = JSON.parse(copyClip(b0(), ['a']))
    expect(only.nodes.map((n: BoardNode) => n.id)).toEqual(['a'])
    expect(branch.nodes.map((n: BoardNode) => n.id)).toEqual(['a', 'a1'])
  })

  it('HSL and hex convert both ways', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000')
    expect(hslToHex(120, 100, 25)).toBe('#008000')
    expect(hexToHsl('#ff0000')).toEqual([0, 100, 50])
    // Whole-number HSL loses a little: each channel comes back within 2 of 255.
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    for (const hex of ['#3a7bd5', '#999999', '#12ab34', '#fe01a0']) {
      const back = rgb(hslToHex(...hexToHsl(hex)))
      rgb(hex).forEach((c, i) => expect(Math.abs(c - back[i])).toBeLessThanOrEqual(2))
    }
  })
})

describe('sample board (M6)', () => {
  it('is a valid board showing children, a link, tasks, a collapsed branch and shapes', () => {
    const b = sampleBoard()
    expect(validateBoard(b).ok).toBe(true)
    expect(b.links.length).toBe(1)
    expect(b.nodes.some(n => n.collapsed) && b.nodes.some(n => n.status === 'done') && b.nodes.some(n => n.shape === 'diamond')).toBe(true)
    expect(parseBoardFile(serializeBoardFile(b)).ok).toBe(true)
  })
})
