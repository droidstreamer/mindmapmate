import { describe, expect, it } from 'vitest'
import { boardIndex, newBoardFile, parseBoardFile, serializeBoardFile } from '../../src/core/io/boardFile.ts'
import { generateBoard } from '../generate.ts'

const parseOk = (text: string) => {
  const r = parseBoardFile(text)
  if (!r.ok) throw new Error(r.message)
  return r
}

describe('board file round trip (M0 gate)', () => {
  it('100 generated boards save, load and save again byte-identical', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const board = generateBoard(seed)
      const first = serializeBoardFile(board)
      const loaded = parseOk(first)
      expect(loaded.board).toEqual(board)
      expect(serializeBoardFile(loaded.board, loaded.frame)).toBe(first)
    }
  })

  it('keeps the user\'s own frontmatter', () => {
    const text = newBoardFile().replace('flowmap: 1\n', 'flowmap: 1\ntags: [plan]\n')
    const loaded = parseOk(text)
    expect(serializeBoardFile(loaded.board, loaded.frame)).toBe(text)
  })

  it('keeps the user\'s own notes above the index and text after the data block (M6: no data loss on save)', () => {
    const base = newBoardFile()
    const text = base.replace('\n## Board index', '\n# My plan\n\nNotes the board must keep.\n\n## Board index') + '\n## After\n\nMore notes.\n'
    const loaded = parseOk(text)
    expect(loaded.frame.notes).toBe('\n# My plan\n\nNotes the board must keep.\n\n')
    expect(loaded.frame.after).toBe('\n## After\n\nMore notes.\n')
    expect(serializeBoardFile(loaded.board, loaded.frame)).toBe(text)
    // The index is generated: edits there don't survive, the notes around it do.
    const edited = text.replace('- Central idea ^root', '- Central idea ^root\n- typed into the index')
    expect(serializeBoardFile(parseOk(edited).board, parseOk(edited).frame)).toBe(text)
  })

  it('node text can never close the data block or the %% comment', () => {
    const text = serializeBoardFile({ schema: 1, theme: {}, links: [],
      nodes: [{ id: 'a', parent: null, order: 0, text: '```\n%%\n``` 100% `x`', x: 0, y: 0 }] })
    const data = text.slice(text.indexOf('%%\n```'))
    expect(data.match(/```/g)).toHaveLength(2) // only the real opening and closing fence
    expect(data.match(/%%/g)).toHaveLength(2)  // only the real comment markers
    expect(parseOk(text).board.nodes[0].text).toBe('```\n%%\n``` 100% `x`')
  })
})

describe('index (D20, D21)', () => {
  const board = {
    schema: 1, theme: {}, links: [],
    nodes: [
      { id: 'n1', parent: null, order: 0, text: '0.0.1 Prototype', x: 0, y: 0 },
      { id: 'n3', parent: 'n1', order: 1, text: 'Enemy Mechanics', x: 0, y: 0 },
      { id: 'n2', parent: 'n1', order: 0, text: 'Combat System', x: 0, y: 0, status: 'done' as const },
      { id: 'n4', parent: 'n3', order: 0, text: '[ ] item drops,\nsee [[Loot Tables]] %% ^x', x: 0, y: 0 },
    ],
  }
  it('is an ordered outline with block ids and no checkbox syntax', () => {
    expect(boardIndex(board)).toBe([
      '- 0.0.1 Prototype ^n1',
      '    - Combat System (done) ^n2',
      '    - Enemy Mechanics ^n3',
      '        - \\[ ] item drops, see [[Loot Tables]] % % \\^x ^n4',
      '',
    ].join('\n'))
  })
})

describe('refuses bad files (D18)', () => {
  const good = newBoardFile()
  const cases: [string, string, string][] = [
    ['no data block', '# just a note\n', 'no-data'],
    ['corrupt JSON', good.replace('"schema": 1,', '"schema": 1,,'), 'invalid-json'],
    ['newer schema', good.replace('"schema": 1', '"schema": 2'), 'newer-schema'],
    ['missing parent', good.replace('"parent":null', '"parent":"ghost"'), 'invalid'],
    ['bad id', good.replace('"id":"root"', '"id":"has space"'), 'invalid'],
    ['unknown status', good.replace('"y":0}', '"y":0,"status":"maybe"}'), 'invalid'],
  ]
  it.each(cases)('%s', (_, text, reason) => {
    const r = parseBoardFile(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  })

  it('parent cycle', () => {
    const board = generateBoard(3, 3)
    board.nodes[0].parent = board.nodes[2].id
    board.nodes[2].parent = board.nodes[0].id
    const r = parseBoardFile(serializeBoardFile(board))
    expect(r.ok || r.reason).toBe('invalid')
  })
})
