// Round 19: every export asks where to save (a native Save dialog), so nothing lands in the vault unasked.
// Web APIs only: the File System Access picker, or a plain download link where the picker is missing.
type Picker = (o: { suggestedName: string, types: { accept: Record<string, string[]> }[] }) => Promise<{ name: string, createWritable(): Promise<{ write(d: BlobPart): Promise<void>, close(): Promise<void> }> }>

const MIME: Record<string, string> = { md: 'text/markdown', svg: 'image/svg+xml', png: 'image/png', html: 'text/html' }

/** Saves `data` as `name.ext` where the user picks. Returns the saved file's name, or null if they cancelled. */
export async function saveAs(name: string, ext: string, data: string | Uint8Array<ArrayBuffer>): Promise<string | null> {
  const file = `${name}.${ext}`, type = MIME[ext] ?? 'application/octet-stream'
  const pick = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
  if (pick) {
    try {
      const handle = await pick.call(window, { suggestedName: file, types: [{ accept: { [type]: [`.${ext}`] } }] })
      const out = await handle.createWritable()
      await out.write(data)
      await out.close()
      return handle.name
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
      throw e
    }
  }
  const a = createEl('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = file
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return file
}
