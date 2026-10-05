// Round 19: saveAs writes through the Save dialog, returns null when it is cancelled, and rethrows real errors.
import { afterEach, describe, expect, it } from 'vitest'
import { saveAs } from '../../src/ui/saveAs.ts'

const win = (pick: unknown) => { (globalThis as { window?: unknown }).window = { showSaveFilePicker: pick } }
afterEach(() => { delete (globalThis as { window?: unknown }).window })

describe('saveAs', () => {
  it('suggests name.ext, writes the data and returns the picked name', async () => {
    let asked = '', wrote: unknown, closed = false
    win(async (o: { suggestedName: string }) => { asked = o.suggestedName; return { name: 'chosen.html', createWritable: async () => ({ write: async (d: unknown) => { wrote = d }, close: async () => { closed = true } }) } })
    expect(await saveAs('Board', 'html', '<p>x</p>')).toBe('chosen.html')
    expect([asked, wrote, closed]).toEqual(['Board.html', '<p>x</p>', true])
  })
  it('returns null when the dialog is cancelled, and rethrows other errors', async () => {
    win(async () => { throw new DOMException('cancelled', 'AbortError') })
    expect(await saveAs('B', 'svg', '')).toBeNull()
    win(async () => { throw new Error('disk full') })
    await expect(saveAs('B', 'svg', '')).rejects.toThrow('disk full')
  })
})
