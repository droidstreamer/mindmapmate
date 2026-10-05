# MindmapMate guide

A freeform mind map for Obsidian, built for planning and tracking tasks. Each board is a Markdown file
(`Name.board.md`) in your vault. Desktop only, Obsidian 1.13 or later.

## What it's for

Obsidian's Canvas is free-form but knows nothing about structure or progress. Outliners and task lists have structure
but no space to think in. MindmapMate sits between them: you lay ideas out on a board, and they form trees that behave like
an outline and a task list at once.

- **Plan a project:** break a goal into branches, then into tasks, and watch each parent's progress (`5/12`) roll up.
- **Track work:** check tasks off, give them due dates, find what's overdue, and hide what's done.
- **Think it through:** brainstorm freely, then tidy it into a clean tree with one click.
- **Map your notes:** link nodes to notes; renames and moves keep the links working.
- **Share it:** export a Markdown checklist (`[ ]` or `[x]`, with `#status/doing`, `#status/blocked` or `#status/dropped`
  for the rest; the Tasks plugin reads its dates), an SVG or a PNG.

## Getting started

1. Install **MindmapMate** from Settings → Community plugins and turn it on. A sample board opens that walks through the basics.
2. Make a board with the **MindmapMate ribbon button** (left sidebar), **New MindmapMate board** on a folder's right-click menu,
   or the command **MindmapMate: New board**.
3. Double-click empty space to add a node, type, then press **Tab** for a child or **Enter** for a sibling.

## Features

### Nodes and trees
- **Nodes** hold text, which can span several lines (Shift+Enter). Any node can start a tree; a board can hold several.
- **Children** hang from a parent by a parent line. They move with it, fold away when it collapses, count toward its
  progress and are tidied with it. Drag a node's dot onto empty space to make a child, or onto another node to adopt it.
- **Links** are dashed lines that only connect two nodes ("depends on"). Hold Alt while dropping a dot to make one.
- **Collapse** a branch with its badge; a collapsed node shows "N hidden".
- **Labels** are big free-standing titles for areas of a board. They take a text color and a size, but no checkbox,
  date or link, and they never join a branch. Markdown export leaves them out.
- **Tidy** lays a tree out neatly. It's in the canvas controls and on Shift+L. Board style → **Tidy as you add** keeps
  trees tidy as you build them, and with snap to grid on, tidy puts every node on the grid.

### Tasks
- **Checkbox** from the node toolbar: switch it on or off, or set it to not done, doing, blocked, done or dropped. Each
  status draws its own box. The **Set status** command does the same.
- **Progress** on parents (`3/5`) counts through collapsed branches.
- **Due dates** come from the calendar button on the node toolbar. The date chip turns red when overdue and amber when
  due today. **Show overdue** selects every overdue task, opening folded branches.
- **Hide done tasks** from the canvas controls.

### Look
- **Node toolbar** (click a node): shape (including flowchart shapes), outline, fill, checkbox, due date, note link,
  arrange (tidy children, align, distribute; size: match widest, match narrowest, fit to text on one line), reset.
- **Line toolbar** (click a line): parent line or link, style (solid, dotted, dashed, marching ants, moving dots),
  arrowhead, direction, color, label.
- **Board style** (top right): font, text color, routing (curved, straight, angular, square: siblings share one elbow), line width,
  fill opacity (plus "Fill every node with its outline"), Tidy as you add.
- **Auto colors** follow the parent, so coloring a branch's top node colors the whole branch.

### Notes
- Type `[[` in a node to link a note: click opens it, hovering previews it. The Link menu can also attach a note, or
  **promote** a node into a new note.
- Renaming or moving a note or folder updates every board. Notes' backlinks list the boards that point to them.
- Search finds board text through each file's generated **Board index**. Due dates are searchable as `📅 2026-10`
  (a month) and appear in the Tags pane as `#due/2026-10-03`.

### Views and moving around
- **Canvas controls** (right edge): Board style; zoom; zoom to fit; focus selection; snap to grid; add node; add label;
  tidy whole board; export; focus on a branch; collapse to a level; hide done tasks; minimap.
- **Focus mode** dims everything outside one branch. **Breadcrumbs** show the path to the selected node.
- **Minimap** (bottom right): click or drag it to move the view.
- **Shortcut hints** (bottom left, while the board has focus): one line of keys for what is selected. Turn off in settings.
- **Selection box:** with two or more things selected, drag empty space inside the box to move them all.

### Import and export
- **Export** (canvas controls, or commands): Markdown checklist, SVG image, PNG image or an interactive HTML page, saved next to the board. Nothing
  is ever overwritten. In Markdown, the top two levels become headings (a setting).
- **Import:** "Import Markdown outline as a new board…" turns a note's headings and lists into a board.
- **Copy and paste:** copying nodes gives an indented list when pasted into a note, and a pasted list becomes a tree on a board.

## Shortcuts

Board keys work while the board has focus and no text is being edited. Change them in Settings → Hotkeys (search "MindmapMate").
Ctrl means Cmd on macOS.

| Key | Action |
| --- | --- |
| Tab | Add a child (while typing: finish, then add a child) |
| Enter | Add a sibling (while typing: finish) |
| Shift+Enter | New line, while typing |
| Shift+E, or double-click | Edit the node's text |
| Esc | Finish typing; else close a menu, clear the selection, or leave focus mode |
| Arrow keys | Select the nearest node in that direction |
| Alt+↑ / Alt+↓ | Move a node up or down among its siblings |
| Ctrl+. | Collapse or expand |
| Shift+L | Tidy the selected branches (the whole board if nothing is selected) |
| Ctrl+Shift+Enter | Toggle done |
| Delete / Backspace | Delete the selection (a node takes its branch with it) |
| Ctrl+A | Select all |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste |
| Shift+1 / Shift+2 | Zoom to fit / focus the selection |

| Mouse | Action |
| --- | --- |
| Double-click empty space | New node |
| Drag a node | Moves its whole branch. Ctrl: the node alone; Shift: one axis; Alt: a copy |
| Drag a node's dot | To empty space: new child. Onto a node: make it a child (Alt: a link) |
| Drag on empty space | Select a rectangle |
| Shift+drag on empty space | Add a rectangle to the selection |
| Shift+click | Add to or remove from the selection |
| Wheel | Zoom (a setting switches it to pan, for trackpads) |
| Space+drag, middle or right drag | Pan |
| Hold Space while dragging | Snap to grid off |

Every other action is a command (Ctrl+P, type "MindmapMate"), and you can give it a key in Settings → Hotkeys: new board,
import outline, create sample board, open as Markdown, tidy, expand all, collapse to a level, layout direction, sort
children, set status, hide done, add label, show overdue, focus on a branch, minimap, shortcut hints, board style, export, link, unlink,
promote to a note.

## Settings
Mouse wheel (zoom or pan), copy (nodes or whole branches), export headings (levels), grid dots (off by default; color from a swatch),
due date colors, shortcut hints and the sample board. Snap to grid and the minimap are the magnet and map buttons on each board.

## The file

A board file holds frontmatter (`flowmap: 1`), any notes you add, a generated **Board index** (plain text that search
and links can reach), and the board data in a hidden block. The data is the source of truth: the index is rewritten on
every save, so edits made there are lost, but notes above the index heading are kept. If the data can't be read, the
board shows an error and never saves over the file; "Open as Markdown" shows the text.

## Privacy

No network access and no tracking. MindmapMate reads and writes only inside your vault: board files, files you ask it to
create (exports, promoted notes, the sample board), and link updates in boards.
