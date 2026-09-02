/** 侧边栏底部「更换背景」切换器：展开五款叠纸游戏背景选择菜单。 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { GAME_BACKGROUNDS, applyBackground, getStoredBackground, applyDim, getStoredDim, BG_DIM_MIN, BG_DIM_MAX } from './bg.ts'
import css from './BackgroundSwitcher.module.css'

/** 调色板图标（内联，避免引入 icon 依赖）。 */
function PaletteIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5a6.5 6.5 0 1 0 0 13h1.25a1.25 1.25 0 0 0 .9-2.12 1.15 1.15 0 0 1 .85-1.95c1.9 0 3.5-1.55 3.5-3.5A6.5 6.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="5.25" cy="6.25" r="1" fill="currentColor" />
      <circle cx="8" cy="4.75" r="1" fill="currentColor" />
      <circle cx="10.75" cy="6.25" r="1" fill="currentColor" />
      <circle cx="5.75" cy="9.75" r="1" fill="currentColor" />
      <circle cx="9" cy="9.75" r="1" fill="currentColor" />
    </svg>
  )
}

/** 侧边栏脚部背景切换器。props.wide 由 shell 传入（侧边栏是否展开）。 */
export function BackgroundSwitcher({ wide }: { wide: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<string>(() => getStoredBackground())
  const [dim, setDim] = useState<number>(() => getStoredDim())
  const rootRef = useRef<HTMLDivElement>(null)

  // 点击组件外部关闭菜单。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const choose = (key: string) => {
    applyBackground(key)
    setCurrent(key)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={css.wrap}>
      <button
        type="button"
        className={css.trigger}
        title="更换背景"
        aria-label="更换背景"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <PaletteIcon />
        {wide && <span className={css.triggerLabel}>背景</span>}
      </button>

      {open && (
        <div className={css.menu} role="menu">
          <div className={css.menuTitle}>更换背景</div>
          {GAME_BACKGROUNDS.map((bg) => (
            <button
              key={bg.key}
              type="button"
              role="menuitemradio"
              aria-checked={bg.key === current}
              className={bg.key === current ? `${css.item} ${css.itemActive}` : css.item}
              onClick={() => choose(bg.key)}
            >
              <span className={css.swatch} style={{ backgroundImage: bg.css }} />
              <span className={css.itemName}>{bg.name}</span>
              {bg.key === current && <span className={css.check}>✓</span>}
            </button>
          ))}
          <div className={css.dimRow}>
            <span className={css.dimLabel}>明暗</span>
            <input
              type="range"
              className={css.dimSlider}
              min={BG_DIM_MIN}
              max={BG_DIM_MAX}
              step={0.05}
              value={dim}
              aria-label="背景明暗"
              onChange={(e) => {
                const v = Number(e.target.value)
                applyDim(v)
                setDim(v)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
