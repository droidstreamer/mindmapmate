// Writes test/fixtures/*.board.md. Run: node scripts/make-fixtures.ts
import { writeFileSync } from 'node:fs'
import { newBoardFile, serializeBoardFile } from '../src/core/io/boardFile.ts'
import { generateBoard } from '../test/generate.ts'
import { tidy } from '../src/core/layout/tidy.ts'
import type { Board } from '../src/core/schema.ts'

const dir = 'test/fixtures'
const small = {
  schema: 1, theme: {}, links: [{ id: 'l1', from: 'n4', to: 'n2', label: 'depends on' }],
  nodes: [
    { id: 'n1', parent: null, order: 0, text: '0.0.1 Prototype', x: 0, y: 0 },
    { id: 'n2', parent: 'n1', order: 0, text: 'Combat System', x: 320, y: -120, status: 'done' as const },
    { id: 'n3', parent: 'n1', order: 1, text: 'Enemy Mechanics', x: 320, y: 0 },
    { id: 'n5', parent: 'n1', order: 2, text: 'Level Design', x: 320, y: 120, status: 'todo' as const },
    { id: 'n4', parent: 'n3', order: 0, text: 'item drops, see [[Loot Tables]]', x: 640, y: 0, status: 'todo' as const },
  ],
}
// Realistic reference boards: the large ones laid out as mindmaps (roots stacked), so edges are short.
function tidied(board: Board): Board {
  let top = 0
  const pos = new Map<string, { x: number, y: number }>()
  for (const root of board.nodes.filter(n => n.parent === null)) {
    // Laid out fully expanded, so collapsed branches sit where they will open.
    const laid = tidy(board.nodes.map(n => ({ ...n, collapsed: false, ...(n.id === root.id ? { x: 0, y: top } : {}) })), root.id, () => ({ width: 180, height: 34 }))
    const ys = [...laid.values()].map(p => p.y)
    const shift = top - Math.min(...ys)
    for (const [id, p] of laid) pos.set(id, { x: p.x, y: p.y + shift })
    top += Math.max(...ys) - Math.min(...ys) + 34 + 200
  }
  return { ...board, nodes: board.nodes.map(n => ({ ...n, ...pos.get(n.id) })) }
}

const files: Record<string, string> = {
  'small.board.md': serializeBoardFile(small),
  'deep.board.md': serializeBoardFile(generateBoard(15, 200, 15)),
  'wide.board.md': serializeBoardFile({ schema: 1, theme: {}, links: [], nodes: [
    { id: 'root', parent: null, order: 0, text: 'Root', x: 0, y: 0 },
    ...Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, parent: 'root', order: i, text: `Child ${i}`, x: 400, y: (i - 150) * 50 })),
  ] }),
  'large-2000.board.md': serializeBoardFile(generateBoard(2000, 2000, 10)),
  'large-5000.board.md': serializeBoardFile(generateBoard(5000, 5000, 10)),
  'tidy-2000.board.md': serializeBoardFile(tidied(generateBoard(2000, 2000, 10))),
  'tidy-5000.board.md': serializeBoardFile(tidied(generateBoard(5000, 5000, 10))),
  'corrupt.board.md': newBoardFile('Corrupt').replace('"schema": 1,', '"schema": 1,,'),
  'newer-schema.board.md': newBoardFile('From the future').replace('"schema": 1', '"schema": 99'),
}
for (const [name, text] of Object.entries(files)) writeFileSync(`${dir}/${name}`, text)
console.log(`wrote ${Object.keys(files).length} fixtures to ${dir}/`)
