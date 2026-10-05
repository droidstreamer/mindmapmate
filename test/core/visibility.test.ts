import { expect, it } from 'vitest'
import { nodesNear } from '../../src/core/visibility.ts'

it('keeps nodes in the window plus the far end of lines touching them (D10)', () => {
  const board = {
    schema: 1, theme: {}, links: [{ id: 'l1', from: 'in', to: 'linked' }],
    nodes: [
      { id: 'root', parent: null, order: 0, text: '', x: -5000, y: 0 },
      { id: 'in', parent: 'root', order: 0, text: '', x: 10, y: 10 },
      { id: 'child', parent: 'in', order: 0, text: '', x: 5000, y: 0 },
      { id: 'linked', parent: 'root', order: 1, text: '', x: 0, y: 9000 },
      { id: 'far', parent: 'root', order: 2, text: '', x: 9000, y: 9000 },
    ],
  }
  expect([...nodesNear(board, { x0: 0, y0: 0, x1: 100, y1: 100 })].sort()).toEqual(['child', 'in', 'linked', 'root'])
})
