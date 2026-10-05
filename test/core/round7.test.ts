// Round 7 (feedback 2026-09-26): labels are their own thing; nodes and labels never swap, and labels take no
// checkbox, date or note link.
import { expect, it } from 'vitest'
import { generateBoard } from '../generate.ts'
import { addNode, connectTo, tidyNodes, insertNodes, reparent, setDue, setLink, setStatus, setStyle } from '../../src/core/commands.ts'
import { parseOutline, toMarkdown } from '../../src/core/io/outline.ts'
import type { Board } from '../../src/core/schema.ts'

const board: Board = {
  schema: 1, theme: {}, links: [],
  nodes: [
    { id: 'n', parent: null, order: 0, text: 'Node', x: 0, y: 0 },
    { id: 'l', parent: null, order: 1, text: 'Title', x: 0, y: 100, shape: 'label', textSize: 48 },
  ],
} as Board
const node = (b: Board, id: string) => b.nodes.find(n => n.id === id)!

it('a shape change never turns a node into a label or back; reset keeps a label', () => {
  expect(node(setStyle(['n'], { shape: 'label' })(board), 'n').shape).toBeUndefined()
  const reset = setStyle(['n', 'l'], { shape: undefined, stroke: undefined, textSize: undefined })(board)
  expect(node(reset, 'l').shape).toBe('label')
  expect(node(reset, 'l').textSize).toBeUndefined()
  expect(node(setStyle(['n', 'l'], { shape: 'diamond' })(board), 'l').shape).toBe('label')
})

it('labels take no checkbox, date or note link', () => {
  const b = setLink('l', 'Note')(setDue(['n', 'l'], '2026-10-03')(setStatus(['n', 'l'], 'todo')(board)))
  expect(node(b, 'l')).toEqual(node(board, 'l'))
  expect(node(b, 'n')).toMatchObject({ status: 'todo', due: '2026-10-03' })
})

it('labels are never a parent or a child; a line between one and a node makes a link', () => {
  expect(addNode({ id: 'c', parent: 'l', x: 0, y: 0 })(board)).toBe(board)
  expect(reparent('n', 'l')(board)).toBe(board)
  expect(reparent('l', 'n')(board)).toBe(board)
  expect(connectTo('n', 'l', false)(board).links).toMatchObject([{ from: 'n', to: 'l' }])
  const pasted = insertNodes([{ id: 'p', parent: null, order: 0, text: 'P', x: 0, y: 0 }], [], 'l', { x: 5, y: 5 })(board)
  expect(pasted.nodes.find(n => n.id === 'p')!.parent).toBeNull()
})

it('Markdown export skips labels; children one got in an older build take its place', () => {
  const old = { nodes: [...board.nodes, { id: 'k', parent: 'l', order: 0, text: 'Kid', x: 0, y: 0 }] }
  expect(toMarkdown(old, undefined, 1)).toBe('# Node\n\n# Kid\n')
})

// Round 8: tidy with snap on puts every node on the grid, without overlaps.
it('a snapped tidy lands every node on the grid, none overlapping', () => {
  const g = generateBoard(3, 200), b = { ...g, nodes: g.nodes.map(({ collapsed: _, ...n }) => n) }
  const size = (id: string) => ({ width: 60 + (id.length * 37) % 150, height: 34 + (id.length % 3) * 21 })
  const roots = b.nodes.filter(n => n.parent === null).map(n => n.id)
  const out = tidyNodes(roots, size, 20)(b)
  expect(out.nodes.every(n => n.x % 20 === 0 && n.y % 20 === 0)).toBe(true)
  const boxes = out.nodes.map(n => ({ ...n, ...size(n.id) }))
  const overlaps = boxes.filter((a, i) => boxes.some((c, j) => j > i && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height))
  expect(overlaps.length).toBe(0)
})

it('Markdown export escapes text that Obsidian would read as a comment, fence, heading or block id', () => {
  const texts = ['%% hidden', '```js', '# heading', 'a ^block', '[x] nor this', 'a ```js b']
  const md = toMarkdown({ nodes: texts.map((text, order) => ({ id: `n${order}`, parent: null, order, text, x: 0, y: 0 })) })
  expect(md).toBe('- % % hidden\n- \\`\\`\\`js\n- \\# heading\n- a \\^block\n- \\[x] nor this\n- a \\`\\`\\`js b\n')
  expect(parseOutline(md).map(n => n.text)).toEqual(['% % hidden', ...texts.slice(1)])
  // The awkward-words fixture boards (large-2000, deep) export with no comment marker left.
  const big = toMarkdown(generateBoard(7, 2000))
  expect(big).not.toContain('%%')
  expect(big).not.toMatch(/(?<!\\)```/)
})
