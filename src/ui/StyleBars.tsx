// M4b styling surfaces from the design handoff: the node palette, the connector palette, Board style and the canvas
// controls, plus the shared color flyout. Every change is a command; slider and color-picker drags merge into one undo
// step. Chrome uses Obsidian's variables and Lucide icons (setIcon), so it follows the user's theme.

import { setIcon } from 'obsidian'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { setDue, setLink, setLinkStyle, setStatus, setStyle, setTheme, type Align, type NodeStyleKey } from '../core/commands.ts'
import { ARROW_PATHS, ARROWS, DASHES, MAX_CUSTOM, pushCustom, ROUTINGS, SHAPES, type Arrow, type Dash, type Routing, type Shape } from '../core/geometry.ts'
import { isDue, type DueFilter, type DueView } from '../core/due.ts'
import { DueCalendar } from './DueCalendar.tsx'
import type { Board, Status } from '../core/schema.ts'
import type { Command } from '../core/store.ts'
import { BOARD_STYLE_KEYS, boardStyle, cssFont, cssTextColor, FONTS, hexToHsl, hslToHex, LABEL_SIZE, LABEL_SIZES, MATCH_OUTLINE, PRESETS, type Animate, type BoardStyle, type Direction } from '../core/style.ts'

export const MIXED = Symbol('mixed')
type Val<T> = T | typeof MIXED
type Dispatch = (command: Command, merge?: boolean) => void

/** One value if every item agrees, else MIXED (the handoff's split icon). */
export function common<T>(items: T[]): Val<T> {
  return items.every(v => v === items[0]) ? items[0] : MIXED
}

export function Icon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (ref.current) { ref.current.empty(); setIcon(ref.current, name) } }, [name])
  return <span ref={ref} className="flowmap-icon" />
}

const Svg = ({ d, box = '0 0 24 24', w = 24, h = 24, ...rest }: { d: string, box?: string, w?: number, h?: number } & React.SVGProps<SVGPathElement>) => (
  <svg viewBox={box} width={w} height={h} className="flowmap-glyph"><path d={d} {...rest} /></svg>
)

const SHAPE_ICONS: Record<Shape, string> = {
  rect: 'M4 5h28v14H4z',
  round: 'M8 5h20a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z',
  pill: 'M11 5h14a7 7 0 0 1 0 14H11a7 7 0 0 1 0-14z',
  para: 'M9 5h24l-6 14H3z',
  circle: 'M18 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
  diamond: 'M18 2l11 10-11 10-11-10z',
  hex: 'M9 5h18l6 7-6 7H9l-6-7z',
  text: 'M4 19h28',
  none: 'M4 5h28v14H4z',
  doc: 'M4 4h28v14c-9-5-19 5-28 0z',
  predef: 'M4 5h28v14H4zM8 5v14M28 5v14',
  cyl: 'M6 7a12 3 0 0 1 24 0v10a12 3 0 0 1-24 0zM6 7a12 3 0 0 0 24 0',
  label: 'M9 6h18M18 6v13M14 19h8',
}
/** The None shape's icon is a faint dotted box: there is nothing to draw. */
const SHAPE_DASH: Partial<Record<Shape, string>> = { none: '1.5 2.5' }
const SHAPE_NAMES: Record<Shape, string> = { rect: 'Rectangle', round: 'Rounded', pill: 'Pill', para: 'Parallelogram', circle: 'Circle', diamond: 'Diamond', hex: 'Hexagon', text: 'Underline', none: 'None',
  doc: 'Document', predef: 'Predefined process', cyl: 'Database', label: 'Label: big text, no outline' }
const S_CURVE = 'M17 5H9a3.5 3.5 0 0 0 0 7h6a3.5 3.5 0 0 1 0 7H7'
const DIR_ICONS: Record<Direction, string> = { none: 'M5 12h14', end: 'M5 12h14M12 5l7 7-7 7', start: 'M19 12H5M12 19l-7-7 7-7', both: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4' }
const ROUTE_ICONS: Record<Routing, string> = { straight: 'M4 19L20 5', curved: 'M4 19C12 19 12 5 20 5', angular: 'M4 19h8V5h8', square: 'M3 12h6M9 5v14M9 5h12M9 19h12' }
const ROUTE_NAMES: Record<Routing, string> = { straight: 'Straight', curved: 'Curved', angular: 'Angular', square: 'Square: siblings share one elbow' }
const DASH_ICON: Record<Dash, React.SVGProps<SVGPathElement>> = {
  solid: {}, dotted: { strokeDasharray: '0.01 3.2', strokeLinecap: 'round' }, dashed: { strokeDasharray: '4.5 3' },
}
const PRESET_NAMES = ['Blue', 'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple', 'Pink']
const FONT_NAMES: Record<string, string> = { interface: 'Interface font', text: 'Text font', mono: 'Monospace font' }

const ArrowGlyph = ({ arrow }: { arrow: Arrow }) => {
  const a = ARROW_PATHS[arrow]
  return <Svg d={a.d} box="-13 -8 16 16" w={20} h={20} className={`is-${a.kind}`} />
}

/** A toolbar button. Buttons never take focus, so the board keeps its keys (Delete, Esc, …) after a click. */
function Btn({ label, active, disabled, onClick, children, btnRef, cls }: { label: string, active?: boolean, disabled?: boolean, onClick(): void, children: ReactNode, btnRef?: React.Ref<HTMLButtonElement>, cls?: string }) {
  return (
    <button ref={btnRef} className={'flowmap-btn' + (active ? ' is-active' : '') + (cls ? ` ${cls}` : '')} aria-label={label} disabled={disabled}
      onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
  )
}

const CONTROLS_W = 68

/**
 * A flyout under (or over) its button. It lines up with the button, shifts sideways to stay inside the canvas, and with
 * `notch` points at the button's centre (Board style).
 */
function Pop({ anchor, up, notch, alignRight, children }: { anchor: HTMLElement | null, up: boolean, notch?: boolean, alignRight?: boolean, children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number, notch: number, up: boolean, max: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current, bar = el?.parentElement, canvas = el?.closest('.flowmap-canvas')
    if (!el || !bar || !anchor || !canvas) return
    const b = bar.getBoundingClientRect(), a = anchor.getBoundingClientRect(), c = canvas.getBoundingClientRect()
    let left = alignRight ? b.width - el.offsetWidth : a.left - b.left
    // Keep clear of the controls stack on the right (16px margin + 36px buttons + 8px gap).
    left = Math.max(c.left + 8 - b.left, Math.min(left, c.right - CONTROLS_W - b.left - el.offsetWidth))
    // M6b: a flyout too tall for its side of the bar (the Arrange menu on a low node) opens on the other side instead.
    // Round 11: one that fits neither way opens on the roomier side and scrolls.
    const roomUp = b.top - 8 - c.top, roomDown = c.bottom - b.bottom - 8
    const h = el.scrollHeight, goUp = h <= (up ? roomUp : roomDown) ? up : roomUp > roomDown
    setPos({ left, notch: a.left - b.left + a.width / 2 - left, up: goUp, max: Math.max(120, (goUp ? roomUp : roomDown) - 8) })
  }, [anchor, alignRight, up])
  return (
    <div ref={ref} className={'flowmap-pop' + ((pos?.up ?? up) ? ' is-up' : '')} style={{ left: pos?.left ?? 0, ...!notch && { maxHeight: pos?.max, overflowY: 'auto' }, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={e => { if (!(e.target as Element).closest('input')) e.preventDefault() }}>
      {notch && pos && <span className="flowmap-notch" style={{ left: pos.notch }} />}
      {children}
    </div>
  )
}

/** Live value from a slider or a color picker. One picker or slider session (until its native change event) is one undo step. */
function useSession() {
  const live = useRef(false)
  const ref = useRef<HTMLInputElement | null>(null)
  const attach = (el: HTMLInputElement | null) => {
    if (ref.current === el) return
    ref.current = el
    el?.addEventListener('change', () => { live.current = false })
  }
  return { attach, next: () => { const merge = live.current; live.current = true; return merge } }
}

type ColorValue = 'auto' | 'ink' | 'muted' | 'node' | typeof MATCH_OUTLINE | null | number | string
type Special = 'auto' | 'none' | 'ink' | 'muted' | 'node' | typeof MATCH_OUTLINE
const sameColor = (a: Val<ColorValue> | undefined, b: ColorValue) => a === b || (typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase())

/**
 * The shared color flyout (handoff §3; round 6 layout). Left of a full-height divider: the special swatches (None, Auto,
 * Match outline; Ink, Muted, Node color), always SPECIAL_SLOTS wide, so the colors start at the same place in every
 * picker. Right of it, one grid of 9 columns: the 8 presets above the 8 custom colors (M6b) and the spectrum picker.
 * `autoColor` is what Auto would give (the parent's color, M6b), `outlineColor` what Match outline would.
 */
function ColorPop({ value, specials, autoColor, outlineColor, custom, onPick }: {
  value: Val<ColorValue> | undefined, specials: Special[], autoColor?: string, outlineColor?: string, custom: string[],
  onPick(v: ColorValue, merge: boolean, newCustom?: { hex: string, newSession: boolean }): void,
}) {
  const [hslOpen, setHslOpen] = useState(false)
  // The first change after opening the picker adds a custom color; later ones update it (pushCustom).
  const fresh = useRef(true)
  const orig = useRef<Val<ColorValue> | undefined>(undefined) // Round 22: the color when the picker opened, for Reset
  // Round 20: a click anywhere off the sliders keeps the color (it is already applied) and closes them.
  useEffect(() => {
    if (!hslOpen) return
    const off = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.flowmap-hsl, .is-spectrum')) setHslOpen(false) }
    document.addEventListener('mousedown', off, true)
    return () => document.removeEventListener('mousedown', off, true)
  }, [hslOpen])
  const swatch = (v: ColorValue, css: string | undefined, title: string, extra = '') => (
    <button key={title} className={`flowmap-swatch${extra}${sameColor(value, v) ? ' is-active' : ''}`}
      style={css ? { '--c': css } as React.CSSProperties : undefined}
      aria-label={title} onMouseDown={e => e.preventDefault()} onClick={() => onPick(v, false)}>
      {v === 'auto' && 'A'}
    </button>
  )
  // Round 6: "match" swatches are a ring in the outline color around a light fill of it (a node whose fill matches its
  // outline), replacing the pipette, which read as "pick a color".
  const special = (s: Special) =>
    s === 'auto' ? swatch('auto', autoColor ?? 'var(--text-muted)', 'Auto: same as the parent', ' is-auto')
      : s === 'none' ? swatch(null, undefined, 'None', ' is-none')
        : s === MATCH_OUTLINE ? swatch(s, outlineColor, 'Match outline: fill with its own outline color', ' is-match')
          : s === 'node' ? swatch(s, undefined, "Node color: each label in its node's outline color", ' is-match is-node')
            : swatch(s, cssTextColor(s), s === 'ink' ? 'Ink' : 'Muted')
  return (
    <div className="flowmap-colors">
      <div className="flowmap-color-grid">
        <div className="flowmap-specials">{specials.map(special)}</div>
        <span className="flowmap-divider is-tall" />
        <div className="flowmap-palette">
          {PRESETS.map((c, i) => swatch(i, c, PRESET_NAMES[i]))}
          <span />
          {Array.from({ length: MAX_CUSTOM }, (_, i) => custom[i] ? swatch(custom[i], custom[i], `Custom ${custom[i]}`) : <span key={i} className="flowmap-swatch is-empty" aria-label="Custom colors you pick land here" />)}
          <button className={'flowmap-swatch is-spectrum' + (hslOpen ? ' is-active' : '')} aria-label="Pick a color"
            onMouseDown={e => e.preventDefault()} onClick={() => { fresh.current = true; orig.current = value; setHslOpen(o => !o) }} />
        </div>
      </div>
      {hslOpen && <HslPicker start={typeof value === 'string' && HEX.test(value) ? value : undefined}
        onReset={orig.current === undefined || orig.current === MIXED ? undefined : () => onPick(orig.current as ColorValue, false)} onPick={(hex, merge) => {
        const newSession = fresh.current
        fresh.current = false
        onPick(hex, merge, { hex, newSession })
      }} />}
    </div>
  )
}

const HEX = /^#[0-9a-f]{6}$/i
const HSL_MAX = [360, 100, 100], HSL_NAMES = ['Hue', 'Saturation', 'Lightness']

/**
 * D40: the custom color picker: hue, saturation and lightness sliders over tracks that show what each would give, plus
 * a hex field. The hue track runs red, yellow, green, cyan, blue, purple and back to red. Each slider drag is one undo step.
 */
export function HslPicker({ start, onPick, onReset }: { start?: string, onPick(hex: string, merge: boolean): void, onReset?(): void }) {
  const first = useRef(start) // Round 22: what Reset goes back to, the color when the picker opened
  const [hsl, setHsl] = useState<[number, number, number]>(() => start ? hexToHsl(start) : [210, 70, 50])
  const sessions = [useSession(), useSession(), useSession()]
  const [h, s, l] = hsl
  const [exact, setExact] = useState<string | null>(null) // a typed color shows as is until a slider moves (HSL rounds)
  const hex = exact ?? hslToHex(h, s, l)
  const [typed, setTyped] = useState<string | null>(null)
  const tracks = [
    `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(d => `hsl(${d} 100% 50%)`).join(', ')})`,
    `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`,
    `linear-gradient(to right, hsl(${h} ${s}% 0%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 100%))`,
  ]
  const change = (i: number, v: number) => {
    const next = [...hsl] as [number, number, number]
    next[i] = v
    setExact(null)
    setHsl(next)
    onPick(hslToHex(...next), sessions[i].next())
  }
  const reset = () => {
    const f = first.current
    if (f && HEX.test(f)) { setHsl(hexToHsl(f)); setExact(f.toLowerCase()) }
    if (onReset) onReset(); else if (f) onPick(f.toLowerCase(), false)
  }
  const commitTyped = () => {
    const v = typed?.trim().replace(/^#?/, '#') ?? ''
    if (HEX.test(v)) { setHsl(hexToHsl(v)); setExact(v.toLowerCase()); onPick(v.toLowerCase(), false) }
    setTyped(null)
  }
  return (
    <div className="flowmap-hsl">
      {hsl.map((v, i) => (
        <input key={i} ref={sessions[i].attach} type="range" min={0} max={HSL_MAX[i]} value={v} aria-label={`${HSL_NAMES[i]} ${v}`}
          className="flowmap-hsl-track" style={{ background: tracks[i] }} onChange={e => change(i, +e.target.value)} />
      ))}
      <div className="flowmap-row">
        <span className="flowmap-swatch" style={{ background: hex }} />
        <input type="text" className="flowmap-hex" aria-label="Hex color" value={typed ?? hex} onChange={e => setTyped(e.target.value)}
          onBlur={commitTyped} onKeyDown={e => { if (e.key === 'Enter') commitTyped() }} />
        {(onReset || first.current) && <button className="flowmap-reset" aria-label="Reset to the color before" onMouseDown={e => e.preventDefault()} onClick={reset}><Icon name="rotate-ccw" /></button>}
      </div>
    </div>
  )
}

/** Applies a color and, for a spectrum pick, adds it to the board's custom colors in the same step. */
const withCustom = (apply: Command, custom?: { hex: string, newSession: boolean }): Command => b =>
  custom ? setTheme({ customColors: pushCustom(boardStyle(b).customColors, custom.hex, custom.newSession) })(apply(b)) : apply(b)

const Dot = ({ color, ring }: { color?: string, ring?: boolean }) =>
  <span className={'flowmap-dot' + (ring ? ' is-ring' : '') + (color ? '' : ' is-none')} style={{ ['--dot' as string]: color }} />
/** D39: when the selection's values differ, a button shows its plain icon in a neutral color; a pick applies to all. */
const NEUTRAL = 'var(--text-muted)'

export type Placement = { left: number, top: number, up: boolean }

// ——— Node palette (handoff §1) ———

/** M5b: the Link menu's note actions, run by the Obsidian view (they open pickers and create notes). */
export type NoteAction = 'link' | 'promote'

/** M6b: the Arrange menu. `tidy` re-lays out the selected branches (F6); the rest line up or space out the selected nodes. */
export type Arrange = Align | 'tidy' | Sizing
/** Round 11: Arrange > Size. Match the widest or narrowest selected node, or fit each to its text again. */
export type Sizing = 'widest' | 'narrowest' | 'fitText'
const SIZE_ROWS: [Sizing, string, string, number][] = [
  ['widest', 'Match widest', 'move-horizontal', 2], ['narrowest', 'Match narrowest', 'fold-horizontal', 2], ['fitText', 'Fit to text (one line)', 'text-cursor-input', 1],
]
const STATUS_ROWS: [Status, string][] = [['todo', 'Not done'], ['doing', 'Doing'], ['blocked', 'Blocked'], ['done', 'Done'], ['dropped', 'Dropped']]
const ALIGN_ROWS: [Align, string, string][] = [
  ['left', 'Align left', 'align-start-vertical'], ['center', 'Align centers', 'align-center-vertical'], ['right', 'Align right', 'align-end-vertical'],
  ['top', 'Align top', 'align-start-horizontal'], ['middle', 'Align middles', 'align-center-horizontal'], ['bottom', 'Align bottom', 'align-end-horizontal'],
  ['across', 'Distribute across', 'align-horizontal-distribute-center'], ['down', 'Distribute down', 'align-vertical-distribute-center'],
]

export function NodePalette({ at, ids, board, strokes, fills, autos, flyout, setFlyout, dispatch, onNote, onArrange, onTasks }: {
  at: Placement, ids: string[], board: Board, strokes: Map<string, string>, fills: Map<string, string | undefined>,
  autos: Map<string, { stroke: string, fill?: string }>, flyout: string | null, setFlyout(f: string | null): void, dispatch: Dispatch,
  onNote(action: NoteAction): void, onArrange(how: Arrange): void, onTasks(ids: string[]): void,
}) {
  const btns = useRef<Record<string, HTMLButtonElement | null>>({})
  const nodes = board.nodes.filter(n => ids.includes(n.id))
  const raw = (k: 'shape' | 'stroke' | 'fill', dflt: unknown) => common(nodes.map(n => n[k] === undefined ? dflt : n[k])) as Val<ColorValue>
  const shape = common(nodes.map(n => (SHAPES as readonly string[]).includes(n.shape as string) ? n.shape as Shape : 'round'))
  // D36: unset outline and fill are both auto; a stored null fill is None.
  const stroke = raw('stroke', 'auto'), fill = raw('fill', 'auto')
  const style = boardStyle(board)
  const first = strokes.get(ids[0]), auto = autos.get(ids[0])
  const toggle = (f: string) => setFlyout(flyout === f ? null : f)
  const set = (patch: Partial<Record<NodeStyleKey, unknown>>) => setStyle(ids, patch)
  const colorPick = (key: 'stroke' | 'fill') => (v: ColorValue, merge: boolean, custom?: { hex: string, newSession: boolean }) =>
    dispatch(withCustom(set({ [key]: v === 'auto' ? undefined : v }), custom), merge)
  const fillCss = fill === MIXED ? NEUTRAL : fills.get(ids[0])
  // F8: the checkbox. On if every selected node is a task; clicking adds it to all, or removes it when all have it.
  const tasks = nodes.every(n => n.status !== undefined), status = common(nodes.map(n => n.status))
  const linked = nodes.some(n => n.link !== undefined)
  const note = (action: NoteAction) => { setFlyout(null); onNote(action) }
  // M7: the selection's date when they all share one.
  const dueVal = common(nodes.map(n => isDue(n.due) ? n.due : undefined)), due = dueVal === MIXED ? undefined : dueVal
  // Round 6 (N3): labels step through LABEL_SIZES; a mixed selection steps from the first label's size.
  const size = nodes.map(n => typeof n.textSize === 'number' ? n.textSize : LABEL_SIZE)[0] ?? LABEL_SIZE
  const step = (dir: 1 | -1) => (dir > 0 ? LABEL_SIZES.find(s => s > size) : [...LABEL_SIZES].reverse().find(s => s < size)) ?? size
  // Round 7: labels are their own thing: a text color and a size, no shape, fill, checkbox, date or link. With labels
  // and nodes selected together, only what both have shows.
  const labels = nodes.filter(n => n.shape === 'label').length
  const allLabels = labels === nodes.length, nodeTools = labels === 0
  return (
    <div className="flowmap-bar" style={{ left: at.left, top: at.top }}>
      {nodeTools && <Btn label="Shape" cls="is-shape" active={flyout === 'shape'} onClick={() => toggle('shape')} btnRef={el => { btns.current.shape = el }}>
        <span className="flowmap-shape-btn"><Svg d={SHAPE_ICONS[shape === MIXED ? 'round' : shape]} box="0 0 36 24" w={24} h={16} strokeDasharray={shape === MIXED ? undefined : SHAPE_DASH[shape]} /><Icon name="chevron-down" /></span>
      </Btn>}
      <Btn label={allLabels ? 'Text color' : 'Outline'} active={flyout === 'outline'} onClick={() => toggle('outline')} btnRef={el => { btns.current.outline = el }}>
        {allLabels
          ? <svg viewBox="0 0 24 24" width={24} height={24} className="flowmap-glyph"><path d="m6 16 6-12 6 12M8 12h8" /><path d="M4 20.5h16" style={{ stroke: stroke === MIXED ? NEUTRAL : first, strokeWidth: 3 }} /></svg>
          : <Dot ring color={stroke === MIXED ? NEUTRAL : first} />}
      </Btn>
      {nodeTools && <Btn label="Fill" active={flyout === 'fill'} onClick={() => toggle('fill')} btnRef={el => { btns.current.fill = el }}>
        <Dot color={fillCss} />
      </Btn>}
      {allLabels && (<>
        <span className="flowmap-divider" />
        <Btn label="Smaller text" disabled={size <= LABEL_SIZES[0]} onClick={() => dispatch(set({ textSize: step(-1) }))}><span className="flowmap-size-btn is-small">A</span></Btn>
        <span className="flowmap-readout" aria-label="Label text size">{size}</span>
        <Btn label="Bigger text" disabled={size >= LABEL_SIZES.at(-1)!} onClick={() => dispatch(set({ textSize: step(1) }))}><span className="flowmap-size-btn">A</span></Btn>
      </>)}
      <span className="flowmap-divider" />
      {nodeTools && (<>
      <Btn label="Checkbox" active={flyout === 'task' || tasks} onClick={() => toggle('task')} btnRef={el => { btns.current.task = el }}>
        <Icon name="square-check-big" />
      </Btn>
      <Btn label={due ? `Due date: ${due}` : 'Due date'} active={flyout === 'due' || !!due} onClick={() => toggle('due')} btnRef={el => { btns.current.due = el }}><Icon name="calendar" /></Btn>
      <Btn label="Link" active={flyout === 'link'} onClick={() => toggle('link')} btnRef={el => { btns.current.link = el }}><Icon name="link" /></Btn>
      </>)}
      {/* Round 13: labels alone get no Arrange; they have no children and rarely line up with nodes. */}
      {!allLabels && (<>
      <Btn label="Arrange" active={flyout === 'arrange'} onClick={() => toggle('arrange')} btnRef={el => { btns.current.arrange = el }}><Icon name="layout-grid" /></Btn>
      <span className="flowmap-divider" />
      </>)}
      <Btn label="Reset node style" onClick={() => dispatch(set({ shape: undefined, stroke: undefined, fill: undefined, textSize: undefined }))}><Icon name="rotate-ccw" /></Btn>
      {flyout === 'shape' && (
        <Pop anchor={btns.current.shape} up={at.up}>
          <div className="flowmap-tiles is-shapes">
            {SHAPES.filter(s => s !== 'label').map(s => (
              <button key={s} className={'flowmap-tile' + (shape === s ? ' is-active' : '')} aria-label={SHAPE_NAMES[s]}
                onMouseDown={e => e.preventDefault()} onClick={() => dispatch(set({ shape: s === 'round' ? undefined : s }))}>
                <Svg d={SHAPE_ICONS[s]} box="0 0 36 24" w={36} h={24} strokeDasharray={SHAPE_DASH[s]} />
              </button>
            ))}
          </div>
        </Pop>
      )}
      {flyout === 'outline' && <Pop anchor={btns.current.outline} up={at.up}><ColorPop value={stroke} specials={['auto']} autoColor={auto?.stroke} custom={style.customColors} onPick={colorPick('stroke')} /></Pop>}
      {flyout === 'fill' && (
        <Pop anchor={btns.current.fill} up={at.up}>
          <ColorPop value={fill} specials={['none', 'auto', MATCH_OUTLINE]} autoColor={auto?.fill} outlineColor={first} custom={style.customColors} onPick={colorPick('fill')} />
        </Pop>
      )}
      {flyout === 'task' && (
        <Pop anchor={btns.current.task} up={at.up}>
          {/* Round 12: an on/off switch for the checkbox (on when every selected node has one), then set to one of the
              five statuses, each with the box it draws on the board. */}
          <div className="flowmap-menu">
            <button className="flowmap-menu-row" role="switch" aria-checked={tasks} aria-label="Checkbox" onMouseDown={e => e.preventDefault()}
              onClick={() => { dispatch(setStatus(tasks ? ids : nodes.filter(n => !n.status).map(n => n.id), tasks ? undefined : 'todo')); onTasks(ids) }}>
              <span>Checkbox</span><span className={'checkbox-container' + (tasks ? ' is-enabled' : '')} />
            </button>
            <div className="flowmap-menu-sep" />
            <div className="flowmap-menu-head">Set to</div>
            {STATUS_ROWS.map(([s, name]) => (
              <button key={s} className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => dispatch(setStatus(ids, s))}>
                <span className={`flowmap-status is-${s}`} /><span>{name}</span>{status === s && <Icon name="check" />}
              </button>
            ))}
          </div>
        </Pop>
      )}
      {flyout === 'due' && (
        <Pop anchor={btns.current.due} up={at.up}>
          {/* M7: a pick applies to every selected node. Round 17: our own calendar, in the theme's colors. */}
          <div className="flowmap-due-pop">
            <DueCalendar value={due} onPick={day => { dispatch(setDue(ids, day)); setFlyout(null) }} />
            <button className="flowmap-menu-row" disabled={!nodes.some(n => n.due)} onMouseDown={e => e.preventDefault()}
              onClick={() => { dispatch(setDue(ids, undefined)); setFlyout(null) }}><Icon name="calendar-x" /><span>Clear date</span></button>
          </div>
        </Pop>
      )}
      {flyout === 'arrange' && (
        <Pop anchor={btns.current.arrange} up={at.up}>
          <div className="flowmap-menu">
            <button className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => onArrange('tidy')}><Icon name="network" /><span>Tidy children</span></button>
            <div className="flowmap-menu-sep" />
            {ALIGN_ROWS.map(([how, name, icon]) => (
              <button key={how} className="flowmap-menu-row" disabled={ids.length < 2} onMouseDown={e => e.preventDefault()} onClick={() => onArrange(how)}><Icon name={icon} /><span>{name}</span></button>
            ))}
            <div className="flowmap-menu-sep" />
            <div className="flowmap-menu-head">Size</div>
            {SIZE_ROWS.map(([how, name, icon, min]) => (
              <button key={how} className="flowmap-menu-row" disabled={ids.length < min} onMouseDown={e => e.preventDefault()} onClick={() => onArrange(how)}><Icon name={icon} /><span>{name}</span></button>
            ))}
          </div>
        </Pop>
      )}
      {flyout === 'link' && (
        <Pop anchor={btns.current.link} up={at.up}>
          <div className="flowmap-menu">
            <button className="flowmap-menu-row" disabled={ids.length !== 1} onMouseDown={e => e.preventDefault()} onClick={() => note('link')}><Icon name="link" /><span>Link to a note…</span></button>
            <button className="flowmap-menu-row" disabled={ids.length !== 1 || linked} onMouseDown={e => e.preventDefault()} onClick={() => note('promote')}><Icon name="file-plus" /><span>Promote to a note</span></button>
            <button className="flowmap-menu-row" disabled={!linked} onMouseDown={e => e.preventDefault()}
              onClick={() => { setFlyout(null); dispatch(b => ids.reduce((acc, id) => setLink(id, undefined)(acc), b)) }}><Icon name="unlink" /><span>Remove link</span></button>
          </div>
        </Pop>
      )}
    </div>
  )
}

// ——— Connector palette (handoff §2, plus Label for F17) ———

/** A selected line: a parent line (stored on its child node) or a cross-link. */
export type LineRef = { kind: 'edge' | 'link', id: string }
type LineKey = 'dash' | 'arrow' | 'direction' | 'color' | 'label' | 'animate'
const EDGE_KEY: Record<LineKey, NodeStyleKey> = { dash: 'edgeDash', arrow: 'edgeArrow', direction: 'edgeDirection', color: 'edgeColor', label: 'edgeLabel', animate: 'edgeAnimate' }
const ANIMATE_NAMES: Record<Animate, string> = { none: 'Still', ants: 'Marching ants', dots: 'Moving dots' }
// Round 7: both animated icons move, like the lines they set.
// Round 13: the animations run down a top-to-bottom wave; along the S they went left, right, left.
const FLOW = 'M12 3C5 9 19 15 12 21'
const ANIMATE_ICONS: Record<Exclude<Animate, 'none'>, React.ReactNode> = {
  ants: <Svg d={FLOW} strokeWidth={1.8} strokeDasharray="3 2.5" className="flowmap-ants" />,
  dots: <svg viewBox="0 0 24 24" width={24} height={24} className="flowmap-glyph"><path d={FLOW} strokeWidth={1.2} opacity={0.5} />
    {[0, 1].map(i => <circle key={i} r={2.2} className="is-fill flowmap-flow-dot"><animateMotion dur="1.6s" begin={`${-i * 0.8}s`} repeatCount="indefinite" path={FLOW} /></circle>)}</svg>,
}

/** Applies a line style patch to every selected parent line and cross-link, as one command. */
export const styleLines = (lines: LineRef[], patch: Partial<Record<LineKey, unknown>>): Command => b => {
  const edges = lines.filter(l => l.kind === 'edge').map(l => l.id), links = lines.filter(l => l.kind === 'link').map(l => l.id)
  const nodePatch = Object.fromEntries(Object.entries(patch).map(([k, v]) => [EDGE_KEY[k as LineKey], v]))
  return setLinkStyle(links, patch)(setStyle(edges, nodePatch)(b))
}

export function ConnectorPalette({ at, lines, looks, board, flyout, setFlyout, dispatch, onLabel, onKind }: {
  at: Placement, lines: LineRef[], looks: { dash: Dash, arrow: Arrow, direction: Direction, color: string, animate: Animate, rawColor: unknown, autoColor: string }[], board: Board,
  flyout: string | null, setFlyout(f: string | null): void, dispatch: Dispatch, onLabel(): void, onKind(kind: LineRef['kind']): void,
}) {
  const btns = useRef<Record<string, HTMLButtonElement | null>>({})
  const animate = common(looks.map(l => l.animate))
  const dash = common(looks.map(l => l.dash)), arrow = common(looks.map(l => l.arrow)), direction = common(looks.map(l => l.direction))
  const color = common(looks.map(l => (l.rawColor ?? 'auto') as ColorValue))
  const toggle = (f: string) => setFlyout(flyout === f ? null : f)
  const set = (patch: Partial<Record<LineKey, unknown>>, merge = false) => dispatch(styleLines(lines, patch), merge)
  const canFlip = direction === 'end' || direction === 'start'
  const menuRow = (d: Direction, name: string) => (
    <button key={d} className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => { set({ direction: d === 'end' ? undefined : d }); setFlyout(null) }}>
      <Svg d={DIR_ICONS[d]} w={16} h={16} /><span>{name}</span>{(direction === d || (d === 'end' && direction === 'start')) && <Icon name="check" />}
    </button>
  )
  // D37: which kind the selected lines are. With both kinds selected, neither button is on; a click makes all one kind.
  const kind = common(lines.map(l => l.kind))
  return (
    <div className="flowmap-bar is-connector" style={{ left: at.left, top: at.top }}>
      <Btn label="Parent line: the end node is a child (moves, collapses and counts with its parent)" active={kind === 'edge'} onClick={() => onKind('edge')}><Icon name="network" /></Btn>
      <Btn label="Link: only connects two nodes" active={kind === 'link'} onClick={() => onKind('link')}><Icon name="waypoints" /></Btn>
      <span className="flowmap-divider" />
      <Btn label="Line style" active={flyout === 'dash'} onClick={() => toggle('dash')} btnRef={el => { btns.current.dash = el }}>
        <Svg d={S_CURVE} strokeWidth={1.8} {...DASH_ICON[dash === MIXED ? 'solid' : dash]} />
      </Btn>
      <Btn label="Arrowhead" active={flyout === 'arrow'} onClick={() => toggle('arrow')} btnRef={el => { btns.current.arrow = el }}>
        <ArrowGlyph arrow={arrow === MIXED ? 'triangle' : arrow} />
      </Btn>
      <Btn label="Direction" active={flyout === 'dir'} onClick={() => toggle('dir')} btnRef={el => { btns.current.dir = el }}>
        <Svg d={DIR_ICONS[direction === MIXED ? 'end' : direction]} w={20} h={20} />
      </Btn>
      <Btn label="Color" active={flyout === 'color'} onClick={() => toggle('color')} btnRef={el => { btns.current.color = el }}>
        <Dot color={color === MIXED ? NEUTRAL : looks[0]?.color} />
      </Btn>
      <Btn label="Label" onClick={onLabel}><Icon name="tag" /></Btn>
      <span className="flowmap-divider" />
      <Btn label="Reset line style" onClick={() => set({ dash: undefined, arrow: undefined, direction: undefined, color: undefined, animate: undefined })}><Icon name="rotate-ccw" /></Btn>
      {flyout === 'dash' && (
        <Pop anchor={btns.current.dash} up={at.up}>
          <div className="flowmap-tiles">
            {DASHES.map(d => (
              <button key={d} className={'flowmap-tile is-small' + (animate === 'none' && dash === d ? ' is-active' : '')} aria-label={d[0].toUpperCase() + d.slice(1)}
                onMouseDown={e => e.preventDefault()} onClick={() => set({ dash: d, animate: undefined })}>
                <Svg d={S_CURVE} strokeWidth={1.8} {...DASH_ICON[d]} />
              </button>
            ))}
            {/* Round 7: the two animations sit in the same row; a still dash style stops them. */}
            {(['ants', 'dots'] as const).map(a => (
              <button key={a} className={'flowmap-tile is-small' + (animate === a ? ' is-active' : '')} aria-label={ANIMATE_NAMES[a]}
                onMouseDown={e => e.preventDefault()} onClick={() => set({ animate: a })}>
                {ANIMATE_ICONS[a]}
              </button>
            ))}
          </div>
        </Pop>
      )}
      {flyout === 'arrow' && (
        <Pop anchor={btns.current.arrow} up={at.up}>
          <div className="flowmap-tiles">
            {ARROWS.map(a => (
              <button key={a} className={'flowmap-tile is-small' + (arrow === a ? ' is-active' : '')} aria-label={ARROW_PATHS[a].name}
                onMouseDown={e => e.preventDefault()} onClick={() => set({ arrow: a })}>
                <ArrowGlyph arrow={a} />
              </button>
            ))}
          </div>
        </Pop>
      )}
      {flyout === 'dir' && (
        <Pop anchor={btns.current.dir} up={at.up}>
          <div className="flowmap-menu">
            {menuRow('none', 'Nondirectional')}{menuRow('end', 'Unidirectional')}{menuRow('both', 'Bidirectional')}
            <div className="flowmap-menu-sep" />
            <button className="flowmap-menu-row" disabled={!canFlip} onMouseDown={e => e.preventDefault()}
              onClick={() => { if (canFlip) set({ direction: direction === 'end' ? 'start' : undefined }) }}>
              <Icon name="flip-horizontal-2" /><span>Flip edge</span>
            </button>
          </div>
        </Pop>
      )}
      {flyout === 'color' && (
        <Pop anchor={btns.current.color} up={at.up}>
          <ColorPop value={color} specials={['auto']} autoColor={looks[0]?.autoColor} custom={boardStyle(board).customColors}
            onPick={(v, merge, custom) => dispatch(withCustom(styleLines(lines, { color: v === 'auto' ? undefined : v }), custom), merge)} />
        </Pop>
      )}
    </div>
  )
}

// ——— Board style (handoff §4) ———

// D41: installed font families, read once with the browser's Local Font Access API (desktop Obsidian allows it); empty if
// it is refused or missing, and then any typed name still works.
let installed: Promise<string[]> | undefined
const installedFonts = () => installed ??= ((window as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts?.() ?? Promise.resolve([]))
  .then(fonts => [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b)), () => [])

/** A font name box that suggests installed fonts as you type, a few at a time, each shown in its own font. */
function FontSearch({ onPick }: { onPick(font: string): void }) {
  // M6b: starts empty each time; the font in use is ticked in the list above.
  const [typed, setTyped] = useState('')
  const [fonts, setFonts] = useState<string[] | null>(null)
  useEffect(() => { void installedFonts().then(setFonts) }, [])
  const q = typed.trim().toLowerCase()
  const matches = !q || !fonts ? [] : [
    ...fonts.filter(f => f.toLowerCase().startsWith(q)),
    ...fonts.filter(f => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q)),
  ].slice(0, 8)
  const exact = fonts?.find(f => f.toLowerCase() === q)
  const missing = !!q && !!fonts?.length && !exact && !matches.length
  const pick = () => { if (q) onPick(exact ?? matches[0] ?? typed.trim()) }
  return (
    <>
      <input className="flowmap-font-input" placeholder="Search installed fonts…" value={typed} onChange={e => setTyped(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') pick() }} />
      {matches.map(f => (
        <button key={f} className="flowmap-menu-row" style={{ fontFamily: `"${f}"` }} onMouseDown={e => e.preventDefault()} onClick={() => onPick(f)}>
          <span>{f}</span>
        </button>
      ))}
      {missing && <div className="flowmap-font-note">No installed font matches; this name falls back to the interface font.</div>}
    </>
  )
}

export function BoardStyleBar({ board, flyout, setFlyout, dispatch, recentFonts, onFontUsed, onTidyBoard }: {
  board: Board, flyout: string | null, setFlyout(f: string | null): void, dispatch: Dispatch, recentFonts: string[], onFontUsed(font: string): void,
  /** Round 9: turning "Tidy as you add" on tidies the whole board, in the same undo step. */
  onTidyBoard(): void,
}) {
  const btns = useRef<Record<string, HTMLButtonElement | null>>({})
  const style = boardStyle(board)
  const width = useSession(), opacity = useSession()
  const toggle = (f: string) => setFlyout(flyout === f ? null : f)
  const set = (patch: Partial<Record<keyof BoardStyle, unknown>>, merge = false) => dispatch(setTheme(patch), merge)
  const pickFont = (font: string) => {
    set({ font: font === 'interface' ? undefined : font })
    if (!(font in FONTS)) onFontUsed(font)
    setFlyout(null)
  }
  const fontRow = (key: string) => (
    <button key={key} className="flowmap-menu-row" style={{ fontFamily: cssFont(key) }} onMouseDown={e => e.preventDefault()} onClick={() => pickFont(key)}>
      <span>{FONT_NAMES[key] ?? key}</span>{style.font === key && <Icon name="check" />}
    </button>
  )
  const btn = (key: string, label: string, child: ReactNode) =>
    <Btn label={label} active={flyout === key} onClick={() => toggle(key)} btnRef={el => { btns.current[key] = el }}>{child}</Btn>
  return (
    <div className="flowmap-bar is-board">
      {btn('font', 'Font', <Icon name="type" />)}
      {btn('tcol', 'Text color', <svg viewBox="0 0 24 24" width={24} height={24} className="flowmap-glyph"><path d="m6 16 6-12 6 12M8 12h8" /><path d="M4 20.5h16" style={{ stroke: cssTextColor(style.textColor), strokeWidth: 3 }} /></svg>)}
      <span className="flowmap-divider" />
      {btn('route', 'Routing', <Svg d={ROUTE_ICONS[style.routing]} />)}
      {btn('width', 'Line width', <svg viewBox="0 0 24 24" width={24} height={24} className="flowmap-glyph"><path d="M4 6h16" strokeWidth={3} /><path d="M4 12h16" strokeWidth={2} /><path d="M4 18h16" strokeWidth={1} /></svg>)}
      {btn('fillop', 'Fill opacity', <svg viewBox="0 0 24 24" width={24} height={24} className="flowmap-glyph"><circle cx={9} cy={9} r={6.5} /><circle cx={15} cy={15} r={6.5} /></svg>)}
      <span className="flowmap-divider" />
      {/* Round 8: re-tidy a tree as nodes are added to it (on the grid when snap is on). A behaviour, so Reset keeps it. */}
      <Btn label={style.autoTidy ? 'Tidy as you add: on' : 'Tidy as you add: off'} active={style.autoTidy} onClick={() => { set({ autoTidy: style.autoTidy ? undefined : true }); if (!style.autoTidy) onTidyBoard() }}><Icon name="wand-sparkles" /></Btn>
      <Btn label="Reset board style" onClick={() => set(Object.fromEntries(BOARD_STYLE_KEYS.filter(k => k !== 'customColors' && k !== 'autoTidy').map(k => [k, undefined])))}><Icon name="rotate-ccw" /></Btn>
      {flyout === 'font' && (
        <Pop anchor={btns.current.font} up={false} notch>
          <div className="flowmap-menu">
            {Object.keys(FONTS).map(fontRow)}
            {/* D41: fonts used on any board, then the current one if it is neither. */}
            {[...new Set([...recentFonts, ...style.font in FONTS ? [] : [style.font]])].map(fontRow)}
            <div className="flowmap-menu-sep" />
            <FontSearch onPick={pickFont} />
          </div>
        </Pop>
      )}
      {flyout === 'tcol' && (
        <Pop anchor={btns.current.tcol} up={false} notch>
          <ColorPop value={style.textColor} specials={['ink', 'muted', 'node']} custom={style.customColors}
            onPick={(v, merge, custom) => dispatch(withCustom(setTheme({ textColor: v === 'ink' ? undefined : v }), custom), merge)} />
        </Pop>
      )}
      {flyout === 'route' && (
        <Pop anchor={btns.current.route} up={false} notch>
          <div className="flowmap-tiles">
            {ROUTINGS.map(r => (
              <button key={r} className={'flowmap-tile is-small' + (style.routing === r ? ' is-active' : '')} aria-label={ROUTE_NAMES[r]}
                onMouseDown={e => e.preventDefault()} onClick={() => { set({ routing: r === 'curved' ? undefined : r }); setFlyout(null) }}>
                <Svg d={ROUTE_ICONS[r]} />
              </button>
            ))}
          </div>
        </Pop>
      )}
      {flyout === 'width' && (
        <Pop anchor={btns.current.width} up={false} notch alignRight>
          <div className="flowmap-slider">
            <button className={'flowmap-tile is-toggle' + (style.taper ? ' is-active' : '')} aria-label="Taper: thinner lines deeper down"
              onMouseDown={e => e.preventDefault()} onClick={() => set({ taper: style.taper ? false : undefined })}>
              <svg viewBox="0 0 24 24" width={24} height={24}><path d="M2 8.5L22 11.5V12.5L2 15.5Z" fill="currentColor" /></svg>
            </button>
            <input ref={width.attach} type="range" min={1} max={8} step={0.5} value={style.maxWidth} aria-label="Line width"
              onChange={e => set({ maxWidth: Number(e.target.value) }, width.next())} />
            <span className="flowmap-readout">{style.maxWidth}px</span>
          </div>
        </Pop>
      )}
      {flyout === 'fillop' && (
        <Pop anchor={btns.current.fillop} up={false} notch alignRight>
          <div className="flowmap-slider">
            <button className={'flowmap-tile is-toggle' + (style.fillOutline ? ' is-active' : '')} aria-label="Fill every node with its outline color (off brings the fills back)"
              onMouseDown={e => e.preventDefault()} onClick={() => set({ fillOutline: style.fillOutline ? undefined : true })}>
              <span className="flowmap-swatch is-match is-glyph" />
            </button>
            <input ref={opacity.attach} type="range" min={5} max={40} step={1} value={style.fillOpacity} aria-label="Fill opacity"
              onChange={e => set({ fillOpacity: Number(e.target.value) }, opacity.next())} />
            <span className="flowmap-readout">{style.fillOpacity}%</span>
          </div>
        </Pop>
      )}
    </div>
  )
}

// ——— Canvas controls (handoff §5) ———

/** M6 (F9, F16): view tools in the controls stack. `levels` is the board's depth; `focusMode` is on while a branch is focused. */
export type ViewTools = {
  levels: number, level: number, onLevel(level: number | 'all'): void, hideDone: boolean, onHideDone(): void,
  /** R24 (D68): the due/status filter (per view). */
  dueFilter: DueFilter, onDueFilter(f: DueFilter): void,
  minimap: boolean, onMinimap(): void, focusMode: boolean, canFocusMode: boolean, onFocusMode(): void, onAddLabel(): void,
  /** Round 8: a new node in the middle of the view, the whole board tidied, and the board exported. */
  onAddNode(): void, onTidyBoard(merge?: boolean): void, onExport(kind: ExportKind): void,
}
export type ExportKind = 'markdown' | 'svg' | 'png' | 'html'

export function CanvasControls({ zoom, boardOpen, snap, canFocus, onBoardStyle, onZoomIn, onZoomOut, onZoomReset, onFit, onFocus, onSnap, tools }: {
  zoom: number, boardOpen: boolean, snap: boolean, canFocus: boolean,
  onBoardStyle(): void, onZoomIn(): void, onZoomOut(): void, onZoomReset(): void, onFit(): void, onFocus(): void, onSnap(): void, tools: ViewTools,
}) {
  const [levelsOpen, setLevelsOpen] = useState(false), [exportOpen, setExportOpen] = useState(false)
  const level = (l: number | 'all') => { setLevelsOpen(false); tools.onLevel(l) }
  const exportAs = (kind: ExportKind) => { setExportOpen(false); tools.onExport(kind) }
  return (
    <div className="flowmap-controls">
      <div className="flowmap-group"><Btn label="Board style" active={boardOpen} onClick={onBoardStyle}><Icon name="sliders-horizontal" /></Btn></div>
      <div className="flowmap-group">
        <Btn label="Zoom in" onClick={onZoomIn}><Icon name="plus" /></Btn>
        <button className="flowmap-zoom" aria-label="Reset zoom to 100%" onMouseDown={e => e.preventDefault()} onClick={onZoomReset}>{Math.round(zoom * 100)}%</button>
        <Btn label="Zoom out" onClick={onZoomOut}><Icon name="minus" /></Btn>
      </div>
      <div className="flowmap-group">
        <Btn label="Zoom to fit (Shift+1)" onClick={onFit}><Icon name="expand" /></Btn>
        <Btn label="Focus selection (Shift+2)" disabled={!canFocus} onClick={onFocus}><Icon name="crosshair" /></Btn>
        <Btn label={snap ? 'Snap to grid: on' : 'Snap to grid: off'} active={snap} onClick={onSnap}><Icon name="magnet" /></Btn>
      </div>
      <div className="flowmap-group">
        <Btn label="Add node" onClick={tools.onAddNode}><Icon name="square-plus" /></Btn>
        <Btn label="Add label" onClick={tools.onAddLabel}><Icon name="type" /></Btn>
        <Btn label="Tidy whole board" onClick={() => tools.onTidyBoard()}><Icon name="network" /></Btn>
        <span className="flowmap-levels">
          <Btn label="Export" active={exportOpen} onClick={() => setExportOpen(o => !o)}><Icon name="download" /></Btn>
          {exportOpen && (
            <div className="flowmap-side-pop flowmap-menu">
              <button className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => exportAs('markdown')}><Icon name="file-text" /><span>Export to Markdown</span></button>
              <button className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => exportAs('svg')}><Icon name="image" /><span>Export as SVG image</span></button>
              <button className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => exportAs('png')}><Icon name="image" /><span>Export as PNG image</span></button>
              <button className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => exportAs('html')}><Icon name="globe" /><span>Export as HTML page</span></button>
            </div>
          )}
        </span>
      </div>
      {/* Round 17, reversed in R25 (D62): the level stepper. Up shows one level more, down one less; the number opens the jump list. */}
      <div className="flowmap-group is-levels">
        <Btn label="Show one level more" disabled={tools.level >= tools.levels} onClick={() => level(tools.level + 1 >= tools.levels ? 'all' : tools.level + 1)}><Icon name="chevron-up" /></Btn>
        <span className="flowmap-levels">
          <button className="flowmap-zoom flowmap-levelnum" aria-label={`Showing ${tools.level} of ${tools.levels} levels; jump to a level`}
            onMouseDown={e => e.preventDefault()} onClick={() => setLevelsOpen(o => !o)}>L{tools.level}</button>
          {levelsOpen && (
            <div className="flowmap-side-pop flowmap-menu">
              {Array.from({ length: Math.max(1, tools.levels - 1) }, (_, i) => i + 1).map(l => (
                <button key={l} className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => level(l)}>
                  <span>Show levels 1 to {l}</span>{tools.level === l && <Icon name="check" />}</button>
              ))}
              <div className="flowmap-menu-sep" />
              <button className="flowmap-menu-row" onMouseDown={e => e.preventDefault()} onClick={() => level('all')}>
                <span>Expand all</span>{tools.level >= tools.levels && <Icon name="check" />}</button>
            </div>
          )}
        </span>
        <Btn label="Show one level less" disabled={tools.level <= 1} onClick={() => level(tools.level - 1)}><Icon name="chevron-down" /></Btn>
      </div>
      <div className="flowmap-group">
        <Btn label="Focus on the selected branch" active={tools.focusMode} disabled={!tools.focusMode && !tools.canFocusMode} onClick={tools.onFocusMode}><Icon name="scan-eye" /></Btn>
        <Btn label={tools.hideDone ? 'Show done tasks' : 'Hide done tasks'} active={tools.hideDone} onClick={tools.onHideDone}><Icon name="list-checks" /></Btn>
        <Btn label={tools.minimap ? 'Hide minimap' : 'Show minimap'} active={tools.minimap} onClick={tools.onMinimap}><Icon name="map" /></Btn>
      </div>
      <DueFilterControls filter={tools.dueFilter} onChange={tools.onDueFilter} />
    </div>
  )
}

const FILTER_ROWS: [DueView, string][] = [['overdue', 'Overdue'], ['today', 'Due today'], ['week', ''], ['blocked', 'Blocked'], ['doing', 'Doing']]

/** R24 (D68): the filter button, its checkbox menu and the "due in the next N days" stepper. The menu stays open while
 *  boxes are ticked (each applies at once) and closes on a click outside it. */
function DueFilterControls({ filter, onChange }: { filter: DueFilter, onChange(f: DueFilter): void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const doc = box.current?.ownerDocument ?? document // a board can sit in a pop-out window
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    doc.addEventListener('mousedown', off, true)
    return () => doc.removeEventListener('mousedown', off, true)
  }, [open])
  const { views, days } = filter
  const win = box.current?.ownerDocument.defaultView
  const up = !!win && box.current!.getBoundingClientRect().top > win.innerHeight / 2
  const toggle = (v: DueView) => onChange({ days, views: views.includes(v) ? views.filter(x => x !== v) : [...views, v] })
  // Stepping N ticks "Due in the next N days", so the change shows.
  const step = (d: number) => onChange({ days: Math.max(0, Math.min(99, days + d)), views: views.includes('week') ? views : [...views, 'week'] })
  return (
    <div ref={box} className="flowmap-group is-levels is-filter">
      <Btn label="Due within one more day" disabled={days >= 99} onClick={() => step(1)}><Icon name="chevron-up" /></Btn>
      <span className="flowmap-levels">
        <button className={'flowmap-zoom flowmap-levelnum' + (views.length ? ' is-active' : '')} aria-label={views.length ? `Filter tasks: ${views.length} on` : 'Filter tasks'}
          title="Filter tasks (due in the next N days)" onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}>{days}d</button>
        {open && (
          <div className={'flowmap-side-pop flowmap-menu' + (up ? ' is-up' : '')}>
            {FILTER_ROWS.map(([v, name]) => (
              <button key={v} className="flowmap-menu-row" role="switch" aria-checked={views.includes(v)} onMouseDown={e => e.preventDefault()} onClick={() => toggle(v)}>
                <span>{name || (days ? `Due in the next ${days} day${days === 1 ? '' : 's'}` : 'Due today only')}</span>
                <span className={'checkbox-container' + (views.includes(v) ? ' is-enabled' : '')} />
              </button>
            ))}
            <div className="flowmap-menu-sep" />
            <button className="flowmap-menu-row" disabled={!views.length} onMouseDown={e => e.preventDefault()} onClick={() => onChange({ days, views: [] })}><span>Clear filters</span></button>
          </div>
        )}
      </span>
      <Btn label="Due within one day less" disabled={days <= 0} onClick={() => step(-1)}><Icon name="chevron-down" /></Btn>
    </div>
  )
}

/** Where a toolbar goes for a node box or a line midpoint, in canvas pixels (handoff placement rules). */
export function nodeBarPlacement(box: { x: number, y: number, w: number, h: number }, canvasW: number): Placement {
  const below = box.y < 270
  return { left: Math.max(8, Math.min(canvasW - 330 - CONTROLS_W, box.x)), top: below ? box.y + box.h + 14 : box.y - 56, up: !below }
}

export function lineBarPlacement(mid: { x: number, y: number }, canvasW: number): Placement {
  const below = mid.y < 270
  return { left: Math.max(8, Math.min(canvasW - 260 - CONTROLS_W, mid.x - 100)), top: below ? mid.y + 18 : mid.y - 62, up: !below }
}
