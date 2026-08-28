/** Global floating desk pet: draggable, skinnable, resizable, with an SVG face
 * whose eyes and mouth change per action, driven by session lifecycle plus
 * manual and proactive interactions. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PetView.module.css'

/** Root-scope overlay props: no session, but the global useSessions feed. */
type PetViewProps = PropsRuntime<'shell.overlay'>

/** Pixel offset from the viewport top-left; null keeps the default bottom-right anchor. */
interface Position {
  x: number
  y: number
}

/** The pet's current action; selects an SVG expression and CSS body motion. */
type PetAction = 'idle' | 'busy' | 'waiting' | 'happy' | 'eating' | 'playing' | 'sleeping'

/** Eye drawing variants; each renders both eyes on the shared face grid. */
type EyeKind = 'open' | 'side' | 'happy' | 'closed' | 'narrow' | 'star'
/** Mouth drawing variants on the shared face grid. */
type MouthKind = 'smile' | 'grin' | 'open' | 'o' | 'wavy' | 'tiny'

/** One expression: which eyes/mouth to draw and how they animate. Every pet
 * species reuses this table, so each animal makes the same expressions with
 * its own face — the cat's "the face itself changes" quality, applied to all. */
interface Face {
  eye: EyeKind
  mouth: MouthKind
  blink: boolean
  mouthAnim?: 'talk' | 'chomp'
  cheeks?: boolean
}

/** Per-action expression. Eyes carry most of the emotion; the mouth and the
 * blink/talk/chomp animations add the motion that makes it read as alive. */
const FACES: Record<PetAction, Face> = {
  idle: { eye: 'open', mouth: 'smile', blink: true },
  busy: { eye: 'narrow', mouth: 'wavy', blink: false, mouthAnim: 'talk' },
  waiting: { eye: 'side', mouth: 'o', blink: true },
  happy: { eye: 'happy', mouth: 'grin', blink: false, cheeks: true },
  eating: { eye: 'closed', mouth: 'open', blink: false, mouthAnim: 'chomp', cheeks: true },
  playing: { eye: 'star', mouth: 'grin', blink: false, cheeks: true },
  sleeping: { eye: 'closed', mouth: 'tiny', blink: false },
}

/** One selectable character: head color and the species-defining SVG parts
 * (ears/horns/comb, face detail, optional beak that replaces the mouth). */
interface Species {
  id: string
  label: string
  color: string
  stroke: string
  ears: React.ReactNode
  detail?: React.ReactNode
  mouthOverride?: React.ReactNode
}

const INNER_PINK = '#ffc4d0'
const EYE_L = 38
const EYE_R = 62
const EYE_Y = 47

/** Render both eyes for a variant on the shared grid (left x=38, right x=62). */
function eyeEls(kind: EyeKind): React.ReactNode {
  const dark = '#33302e'
  switch (kind) {
    case 'open':
    case 'side': {
      const shift = kind === 'side' ? 2 : 0
      return (
        <>
          <circle cx={EYE_L} cy={EYE_Y} r={5} fill={dark} />
          <circle cx={EYE_R} cy={EYE_Y} r={5} fill={dark} />
          <circle cx={EYE_L + shift - 1.5} cy={EYE_Y - 1.5} r={1.6} fill="#fff" />
          <circle cx={EYE_R + shift - 1.5} cy={EYE_Y - 1.5} r={1.6} fill="#fff" />
        </>
      )
    }
    case 'happy':
      return (
        <>
          <path d={`M${String(EYE_L - 5)} ${String(EYE_Y + 1)} Q${String(EYE_L)} ${String(EYE_Y - 6)} ${String(EYE_L + 5)} ${String(EYE_Y + 1)}`} stroke={dark} strokeWidth={3} fill="none" strokeLinecap="round" />
          <path d={`M${String(EYE_R - 5)} ${String(EYE_Y + 1)} Q${String(EYE_R)} ${String(EYE_Y - 6)} ${String(EYE_R + 5)} ${String(EYE_Y + 1)}`} stroke={dark} strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      )
    case 'closed':
      return (
        <>
          <path d={`M${String(EYE_L - 5)} ${String(EYE_Y)} Q${String(EYE_L)} ${String(EYE_Y + 4)} ${String(EYE_L + 5)} ${String(EYE_Y)}`} stroke={dark} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          <path d={`M${String(EYE_R - 5)} ${String(EYE_Y)} Q${String(EYE_R)} ${String(EYE_Y + 4)} ${String(EYE_R + 5)} ${String(EYE_Y)}`} stroke={dark} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </>
      )
    case 'narrow':
      return (
        <>
          <rect x={EYE_L - 5} y={EYE_Y - 1.75} width={10} height={3.5} rx={1.75} fill={dark} />
          <rect x={EYE_R - 5} y={EYE_Y - 1.75} width={10} height={3.5} rx={1.75} fill={dark} />
        </>
      )
    case 'star':
      return (
        <>
          <text x={EYE_L} y={EYE_Y + 4.5} fontSize={13} textAnchor="middle" fill="#ffcf3f">★</text>
          <text x={EYE_R} y={EYE_Y + 4.5} fontSize={13} textAnchor="middle" fill="#ffcf3f">★</text>
        </>
      )
  }
}

/** Render the mouth for a variant, centered at x=50. */
function mouthEl(kind: MouthKind): React.ReactNode {
  const dark = '#33302e'
  const inner = '#c0555c'
  switch (kind) {
    case 'smile':
      return <path d="M43 61 Q50 68 57 61" stroke={dark} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    case 'grin':
      return <path d="M41 60 Q50 73 59 60 Z" fill={inner} stroke={dark} strokeWidth={2} strokeLinejoin="round" />
    case 'open':
      return <ellipse cx={50} cy={64} rx={6.5} ry={6} fill={inner} stroke={dark} strokeWidth={2} />
    case 'o':
      return <circle cx={50} cy={63} r={3.2} fill={inner} stroke={dark} strokeWidth={1.6} />
    case 'wavy':
      return <path d="M42 63 q3 -3 5.5 0 t5.5 0 t5.5 0" stroke={dark} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    case 'tiny':
      return <path d="M46 63 Q50 66 54 63" stroke={dark} strokeWidth={2} fill="none" strokeLinecap="round" />
  }
}

/** Selectable characters. Each is a colored head plus species-specific ears and
 * detail drawn as SVG; expressions come from the shared {@link FACES} table so
 * every animal emotes with its own face. No binary sprite assets ship. */
const SPECIES: readonly [Species, ...Species[]] = [
  {
    id: 'cat', label: '猫', color: '#f4b860', stroke: '#d9964a',
    ears: (
      <>
        <path d="M26 34 L30 14 L44 28 Z" fill="#f4b860" stroke="#d9964a" strokeWidth={2} strokeLinejoin="round" />
        <path d="M74 34 L70 14 L56 28 Z" fill="#f4b860" stroke="#d9964a" strokeWidth={2} strokeLinejoin="round" />
        <path d="M31 30 L33 20 L40 27 Z" fill={INNER_PINK} />
        <path d="M69 30 L67 20 L60 27 Z" fill={INNER_PINK} />
      </>
    ),
    detail: (
      <g stroke="#d9964a" strokeWidth={1.3} strokeLinecap="round">
        <line x1={16} y1={57} x2={31} y2={59} />
        <line x1={16} y1={63} x2={31} y2={63} />
        <line x1={84} y1={57} x2={69} y2={59} />
        <line x1={84} y1={63} x2={69} y2={63} />
      </g>
    ),
  },
  {
    id: 'dog', label: '狗', color: '#c99a63', stroke: '#a97b48',
    ears: (
      <>
        <ellipse cx={21} cy={46} rx={10} ry={19} fill="#a97b48" stroke="#8a6238" strokeWidth={2} />
        <ellipse cx={79} cy={46} rx={10} ry={19} fill="#a97b48" stroke="#8a6238" strokeWidth={2} />
      </>
    ),
    detail: <ellipse cx={50} cy={56} rx={4} ry={3} fill="#5a4632" />,
  },
  {
    id: 'rabbit', label: '兔', color: '#efeae2', stroke: '#d9d2c6',
    ears: (
      <>
        <ellipse cx={40} cy={16} rx={6.5} ry={20} fill="#efeae2" stroke="#d9d2c6" strokeWidth={2} />
        <ellipse cx={60} cy={16} rx={6.5} ry={20} fill="#efeae2" stroke="#d9d2c6" strokeWidth={2} />
        <ellipse cx={40} cy={16} rx={2.8} ry={14} fill={INNER_PINK} />
        <ellipse cx={60} cy={16} rx={2.8} ry={14} fill={INNER_PINK} />
      </>
    ),
    detail: <path d="M47 55 L53 55 L50 58 Z" fill="#ff9db0" />,
  },
  {
    id: 'chick', label: '鸡', color: '#f7d24a', stroke: '#e0b62f',
    ears: (
      <g stroke="#f7d24a" strokeWidth={5} strokeLinecap="round" fill="none">
        <path d="M44 26 L42 15" />
        <path d="M50 24 L50 12" />
        <path d="M56 26 L58 15" />
      </g>
    ),
    mouthOverride: <path d="M44 59 L56 59 L50 67 Z" fill="#f2923c" stroke="#d97a24" strokeWidth={1.5} strokeLinejoin="round" />,
  },
  {
    id: 'dragon', label: '龙', color: '#7cc47f', stroke: '#5aa25f',
    ears: (
      <>
        <path d="M34 22 L30 7 L43 18 Z" fill="#e6c34d" stroke="#caa430" strokeWidth={1.8} strokeLinejoin="round" />
        <path d="M66 22 L70 7 L57 18 Z" fill="#e6c34d" stroke="#caa430" strokeWidth={1.8} strokeLinejoin="round" />
      </>
    ),
    detail: (
      <>
        <circle cx={45} cy={59} r={1.5} fill="#3f7a45" />
        <circle cx={55} cy={59} r={1.5} fill="#3f7a45" />
      </>
    ),
  },
]

/** Draw the complete face: species head/ears/detail plus the current expression. */
function PetFace({ species, face }: { species: Species; face: Face }): React.ReactElement {
  const mouthAnimClass = face.mouthAnim === 'talk' ? css.talk : face.mouthAnim === 'chomp' ? css.chomp : ''
  return (
    <svg className={css.svg} viewBox="0 0 100 100" aria-hidden>
      {species.ears}
      <circle cx={50} cy={53} r={30} fill={species.color} stroke={species.stroke} strokeWidth={2.5} />
      {species.detail}
      {face.cheeks === true && (
        <g>
          <circle cx={27} cy={59} r={4.5} fill="#ff9db0" opacity={0.55} />
          <circle cx={73} cy={59} r={4.5} fill="#ff9db0" opacity={0.55} />
        </g>
      )}
      <g className={`${css.eyes} ${face.blink ? css.blink : ''}`}>{eyeEls(face.eye)}</g>
      <g className={`${css.mouth} ${mouthAnimClass}`}>{species.mouthOverride ?? mouthEl(face.mouth)}</g>
    </svg>
  )
}

/** Selectable sizes mapped to a scale multiplier on the pet root. */
/** A selectable pet size preset. */
type PetSize = { id: string; label: string; scale: number }

const SIZES: readonly [PetSize, PetSize, ...PetSize[]] = [
  { id: 'sm', label: '小', scale: 1.5 },
  { id: 'md', label: '中', scale: 2 },
  { id: 'lg', label: '大', scale: 3 },
]

/** Accessory glyph floated beside the pet for action states that carry a prop. */
const ACCESSORY: Partial<Record<PetAction, string>> = {
  eating: '🍖',
  playing: '🎾',
  sleeping: '💤',
}

/** Drag threshold in pixels below which a pointer gesture counts as a click. */
const DRAG_THRESHOLD = 4
/** How long a manual action (feed/play/sleep) holds before reverting to derived. */
const MANUAL_MS = 4000

const IDLE_LINES = ['喵～', '要不要摸摸我？', '今天也要加油！', '我一直在这儿陪你～', '写代码累了就歇会儿。'] as const
const FEED_LINES = ['好吃！谢谢～', '再来一口！', '嗯…满足 😋'] as const
const PLAY_LINES = ['接住啦！', '再扔一次嘛～', '玩得好开心！'] as const
/** Spoken (and sometimes acted) when the pet has been idle for a while. */
const PROACTIVE_LINES = ['发会儿呆…🐾', '在忙吗？我陪你～', '要不要休息一下？', '偷偷看你一眼 👀', '摸鱼时间到！', '有点无聊，陪我玩嘛～'] as const

/** Pick a random line from a non-empty list; empty string if somehow absent. */
function pick(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? ''
}

const SKIN_KEY = 'dsh-pet-skin'
const SIZE_KEY = 'dsh-pet-size'

/** Read a persisted index from localStorage, clamped to a length. */
function readIndex(key: string, length: number): number {
  if (typeof localStorage === 'undefined') return key === SIZE_KEY && length > 1 ? 1 : 0
  const raw = Number.parseInt(localStorage.getItem(key) ?? '', 10)
  return Number.isInteger(raw) && raw >= 0 && raw < length ? raw : (key === SIZE_KEY ? 1 : 0)
}

/**
 * The floating pet. Drag position, chosen species/size, speech, and the manual
 * action are local state (species/size persisted to localStorage). Its resting
 * action derives from the global session lifecycle: any running session makes
 * it busy, a pending interaction makes it wait, and a session finishing makes
 * it briefly celebrate. While idle it occasionally speaks or plays on its own.
 * Rendered in the shell overlay layer.
 * @param props - the shell-overlay standard kit (global useSessions).
 * @returns the draggable pet element.
 */
export function PetView(props: PetViewProps): React.ReactElement {
  const { useSessions } = props
  const running = useSessions(state => Object.values(state.byId).filter(s => s.running && !s.blank).length)
  const waiting = useSessions(state => Object.values(state.byId).some(s => s.pendingInteraction !== undefined && !s.blank))

  const [skinIndex, setSkinIndex] = useState(() => readIndex(SKIN_KEY, SPECIES.length))
  const [sizeIndex, setSizeIndex] = useState(() => readIndex(SIZE_KEY, SIZES.length))
  const [pos, setPos] = useState<Position | null>(null)
  const [say, setSay] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [manual, setManual] = useState<PetAction | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ startX: number; startY: number; grabX: number; grabY: number; moved: boolean } | null>(null)
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevRunning = useRef(running)

  const species = SPECIES[skinIndex] ?? SPECIES[0]
  const size = SIZES[sizeIndex] ?? SIZES[1]

  // Resting action from session lifecycle; a manual action overrides it.
  const derived: PetAction = running > 0 ? 'busy' : waiting ? 'waiting' : 'idle'
  const action: PetAction = manual ?? derived
  const accessory = ACCESSORY[action]

  const speak = useCallback((line: string) => {
    setSay(line)
    if (sayTimer.current !== null) clearTimeout(sayTimer.current)
    sayTimer.current = setTimeout(() => { setSay(null) }, 2600)
  }, [])

  const hold = useCallback((next: PetAction, line: string) => {
    setManual(next)
    speak(line)
    if (manualTimer.current !== null) clearTimeout(manualTimer.current)
    manualTimer.current = setTimeout(() => { setManual(null) }, MANUAL_MS)
  }, [speak])

  // Announce the busy edge; celebrate when the last running session finishes.
  useEffect(() => {
    if (running > 0 && prevRunning.current === 0) speak('干活中…盯着你哦 👀')
    else if (running === 0 && prevRunning.current > 0) hold('happy', '搞定啦！🎉')
    prevRunning.current = running
  }, [running, speak, hold])

  // Proactive: while resting idle, occasionally speak or do a little hop.
  // Re-arms whenever the pet returns to idle (the effect deps change).
  useEffect(() => {
    if (action !== 'idle') return
    const delay = 16000 + Math.random() * 20000
    const id = setTimeout(() => {
      const line = pick(PROACTIVE_LINES)
      if (Math.random() < 0.5) hold('happy', line)
      else speak(line)
    }, delay)
    return () => { clearTimeout(id) }
  }, [action, say, manual, speak, hold])

  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem(SKIN_KEY, String(skinIndex)) }, [skinIndex])
  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem(SIZE_KEY, String(sizeIndex)) }, [sizeIndex])

  useEffect(() => () => {
    if (sayTimer.current !== null) clearTimeout(sayTimer.current)
    if (manualTimer.current !== null) clearTimeout(manualTimer.current)
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    drag.current = {
      startX: event.clientX, startY: event.clientY,
      grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      moved: false,
    }
    // Capture on the element that owns the handlers (.body); capturing on an
    // ancestor would retarget pointermove/up away from these listeners.
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (state === null) return
    if (!state.moved
      && Math.abs(event.clientX - state.startX) < DRAG_THRESHOLD
      && Math.abs(event.clientY - state.startY) < DRAG_THRESHOLD) return
    state.moved = true
    const box = 72 * size.scale
    const x = Math.min(Math.max(0, event.clientX - state.grabX), window.innerWidth - box)
    const y = Math.min(Math.max(0, event.clientY - state.grabY), window.innerHeight - box)
    setPos({ x, y })
  }, [size.scale])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    // A click (no drag) toggles the control panel and chatters.
    if (state !== null && !state.moved) {
      setPanelOpen(open => !open)
      speak(pick(IDLE_LINES))
    }
  }, [speak])

  const cycleSkin = useCallback(() => {
    setSkinIndex(i => (i + 1) % SPECIES.length)
    speak('换个造型～')
  }, [speak])

  const cycleSize = useCallback(() => { setSizeIndex(i => (i + 1) % SIZES.length) }, [])
  const feed = useCallback(() => { hold('eating', pick(FEED_LINES)) }, [hold])
  const play = useCallback(() => { hold('playing', pick(PLAY_LINES)) }, [hold])
  const sleep = useCallback(() => { hold('sleeping', '呼…zzZ') }, [hold])

  const style = useMemo(() => ({
    '--pet-scale': String(size.scale),
    ...(pos === null ? {} : { left: `${String(pos.x)}px`, top: `${String(pos.y)}px`, right: 'auto', bottom: 'auto' }),
  } as React.CSSProperties), [size.scale, pos])

  return (
    <div ref={rootRef} className={css.pet} style={style}>
      {say !== null && <div className={css.bubble}>{say}</div>}

      {panelOpen && (
        <div className={css.panel} onPointerDown={(e) => { e.stopPropagation() }}>
          <button type="button" className={css.panelBtn} title="换形象" onClick={cycleSkin}>🔄 {species.label}</button>
          <button type="button" className={css.panelBtn} title="调节大小" onClick={cycleSize}>⤢ {size.label}</button>
          <button type="button" className={css.panelBtn} title="喂食" onClick={feed}>🍖</button>
          <button type="button" className={css.panelBtn} title="玩耍" onClick={play}>🎾</button>
          <button type="button" className={css.panelBtn} title="睡觉" onClick={sleep}>😴</button>
        </div>
      )}

      <div
        className={css.body}
        role="button"
        tabIndex={0}
        aria-label="桌面宠物，可拖拽，点击打开菜单"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={`${css.sprite} ${css[`act_${action}`]}`}>
          <PetFace species={species} face={FACES[action]} />
        </span>
        {accessory !== undefined && <span className={css.accessory} aria-hidden>{accessory}</span>}
      </div>
      <div className={css.shadow} aria-hidden />
    </div>
  )
}
