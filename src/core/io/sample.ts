// M6: the sample board created on first run (and by the "Create sample board" command). Each node explains one thing;
// it shows children and links side by side (D37). Positions are rough: the board is tidied when it opens.

import { SCHEMA_VERSION, type Board, type BoardNode } from '../schema.ts'

export function sampleBoard(): Board {
  const nodes: BoardNode[] = []
  const add = (id: string, parent: string | null, text: string, x: number, y: number, extra: Partial<BoardNode> = {}) =>
    nodes.push({ id, parent, order: nodes.filter(n => n.parent === parent).length, text, x, y, ...extra })

  add('welcome', null, 'Welcome to MindmapMate', 0, 300, { shape: 'pill' })

  add('children', 'welcome', 'Children hang from a parent line', 340, 0, { edgeLabel: 'parent line' })
  add('c1', 'children', 'They move with their parent: drag the node above', 720, -60)
  add('c2', 'children', 'They hide when it collapses (the − button)', 720, 0)
  add('c3', 'children', 'Tab adds a child, Enter a sibling', 720, 60)

  add('tasks', 'welcome', 'Tasks roll up into their parent', 340, 200)
  add('t1', 'tasks', 'Click a checkbox to finish a task', 720, 150, { status: 'done' })
  add('t2', 'tasks', 'Doing, blocked and dropped: "Set status" command', 720, 210, { status: 'doing' })
  add('t3', 'tasks', 'Ctrl (Cmd) + Shift + Enter toggles done', 720, 270, { status: 'todo' })

  add('links', 'welcome', 'Links only connect two nodes', 340, 400)
  add('l1', 'links', 'Drag a dot onto another node to link them', 720, 360)
  add('l2', 'links', 'Select a line: its toolbar switches Parent line and Link', 720, 420)

  add('style', 'welcome', 'Toolbars', 340, 560, { shape: 'diamond' })
  add('s0', 'style', 'Click a node or a line for its toolbar', 720, 450)
  add('s1', 'style', 'Shapes, colors and arrowheads', 720, 520, { shape: 'hex' })
  add('s2', 'style', 'Board style (top right): font, routing, line width', 720, 590, { shape: 'round' })

  add('folded', 'welcome', 'A collapsed branch: click its badge to open it', 340, 720, { collapsed: true })
  add('f1', 'folded', 'Hidden until you expand', 720, 690)
  add('f2', 'folded', 'The badge counts hidden nodes and done tasks', 720, 750, { status: 'done' })

  return {
    schema: SCHEMA_VERSION,
    theme: {},
    nodes,
    // A link between two branches: dashed with a chevron, and it doesn't make either node the other's child.
    links: [{ id: 'sample-link', from: 't3', to: 'l1', label: 'link' }],
  }
}
