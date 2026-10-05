// Board state plus undo history. Every edit is a command: a pure function from board to board.
// Boards are never mutated, so undo just restores the previous board object: byte-identical, and
// no command needs a hand-written inverse. Unchanged nodes are shared between history entries.

import type { Board } from './schema.ts'

export type Command = (board: Board) => Board

const HISTORY_LIMIT = 100 // F15

export class BoardStore {
  private past: Board[] = []
  private future: Board[] = []
  private listeners = new Set<(edited: boolean) => void>()

  constructor(public board: Board) {}

  /** Runs a command as one undo step. A command that returns the same board is a no-op. `merge` folds it into the
   *  previous step, so dragging a slider or a color picker is one undo step however many values it passes through. */
  dispatch(command: Command, merge = false) {
    const next = command(this.board)
    if (next === this.board) return
    if (!merge || !this.past.length) this.past.push(this.board)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.set(next, true)
  }

  undo() {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.board)
    this.set(prev, true)
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.board)
    this.set(next, true)
  }

  /** Replaces the board after an external edit (D18, D22). History no longer applies to it. */
  reset(board: Board) {
    this.past = []
    this.future = []
    this.set(board, false)
  }

  /** `edited` is true for changes made here (these need saving), false for external reloads. */
  subscribe = (listener: (edited: boolean) => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getBoard = () => this.board

  private set(board: Board, edited: boolean) {
    this.board = board
    for (const l of this.listeners) l(edited)
  }
}
