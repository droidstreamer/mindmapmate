// Reads a color-picker slider's knob position from the rendered pixels: Obsidian's own thumb rule once lifted it off the track's centre,
// which no computed style shows. `call` / `ev` belong to the window the slider is in; `inputJs` is an expression giving the <input>.
// Returns the knob's and the track's vertical centres in CSS px (equal when centred). The knob is Obsidian's white one.
export async function knobCentre(call, ev, inputJs) {
  const b = await ev(`const i = ${inputJs}; i.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300)); const b = i.getBoundingClientRect(), f = (i.value - i.min) / (i.max - i.min)
    return { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12, th: b.height, kx: 6 + 9 + f * (b.width - 18) }`)
  await call('Page.bringToFront')
  const { data } = await call('Page.captureScreenshot', { format: 'png', clip: { x: b.x, y: b.y, width: b.width, height: b.height, scale: 2 } })
  const [top, bottom] = await ev(`const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, rows = [], k = c.width / ${b.width}
    for (let y = 0; y < c.height; y++) for (let i = Math.round((${b.kx} - 3) * k); i < Math.round((${b.kx} + 3) * k); i++) { const p = (y * c.width + i) * 4; if (d[p] > 225 && d[p + 1] > 225 && d[p + 2] > 225) { rows.push(y); break } }
    return [rows[0] / k, (rows[rows.length - 1] + 1) / k]`)
  return { knob: (top + bottom) / 2, track: 6 + b.th / 2 }
}
