/** 侧边栏底部「团队」入口按钮：点击打开团队弹窗（teamStore 桥接 shell.overlay 面板）。 */

import type { JSX } from 'react'
import { teamPanelStore } from './teamStore.ts'
import css from './TeamTrigger.module.css'

/** 团队图标（内联，避免引入 icon 依赖）。 */
function TeamIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="5.6" r="2.1" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.6" cy="6.6" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.6 12.2c0-2 1.6-3.1 3.4-3.1s3.4 1.1 3.4 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.4 12.2c0-1.3 1-2.1 2.5-2.1s2.9 1 2.9 2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** 侧边栏脚部团队入口。props.wide 由 shell 传入（侧边栏是否展开）。 */
export function TeamTrigger({ wide }: { wide: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={css.trigger}
      title="团队"
      aria-label="团队"
      onClick={teamPanelStore.openPanel}
    >
      <TeamIcon />
      {wide && <span className={css.triggerLabel}>团队</span>}
    </button>
  )
}
