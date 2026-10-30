import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYS, DEFAULT_PAN_KEY, flowKeyCode, isPanKey, normalizePanKey, panKeyConflict, panKeyFor } from '../../src/ui/input/keymap.ts'

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

describe('R29: the pan key', () => {
  it('is Space unless a saved value is an allowed key (old or hand-edited data.json keeps working)', () => {
    expect(DEFAULT_PAN_KEY).toBe('Space')
    for (const saved of [undefined, null, '', 'space', 'Alt', 'Shift', 'Escape', 'F13', 'ab', 5, {}]) expect(normalizePanKey(saved), String(saved)).toBe('Space')
    for (const saved of ['Space', 'Q', '7', 'F5', 'F12']) expect(normalizePanKey(saved)).toBe(saved)
  })

  it('records one plain key and refuses modifiers and the board\'s own keys', () => {
    expect(panKeyFor(press(' '))).toBe('Space')
    expect(panKeyFor(press('q'))).toBe('Q')
    expect(panKeyFor(press('F5'))).toBe('F5')
    for (const e of [press('q', { shiftKey: true }), press('q', { ctrlKey: true }), press('q', { metaKey: true }), press('q', { altKey: true }),
      press('Shift'), press('Alt'), press('Escape'), press('Enter'), press('Tab'), press('Delete'), press('ArrowUp'), press('F13')]) expect(panKeyFor(e), e.key).toBeUndefined()
  })

  it('matches the held key by key or code, case-blind', () => {
    expect(isPanKey({ key: ' ', code: 'Space' }, 'Space')).toBe(true)
    expect(isPanKey({ key: 'q', code: 'KeyQ' }, 'Q')).toBe(true)
    expect(isPanKey({ key: 'Q', code: 'KeyQ' }, 'Q')).toBe(true)
    expect(isPanKey({ key: 'w', code: 'KeyW' }, 'Q')).toBe(false)
    expect(isPanKey({ key: '1', code: 'Digit1' }, '1')).toBe(true)
  })

  it('flags a key a board action already uses', () => {
    expect(panKeyConflict(DEFAULT_KEYS, 'Space')).toBeUndefined()
    expect(panKeyConflict({ ...DEFAULT_KEYS, tidy: ['Q'] }, 'Q')).toBe('tidy')
    expect(panKeyConflict({ ...DEFAULT_KEYS, tidy: ['Mod+Q'] }, 'Q')).toBeUndefined() // with a modifier it is a different key
  })

  it('gives React Flow the code it watches', () => {
    expect(flowKeyCode('Space')).toBe('Space')
    expect(flowKeyCode('Q')).toBe('KeyQ')
    expect(flowKeyCode('7')).toBe('Digit7')
    expect(flowKeyCode('F5')).toBe('F5')
  })
})
