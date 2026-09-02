/** 会话头部「任务」入口按钮：点击打开全局任务管理面板。 */

import type { JSX } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { taskPanelStore } from './taskStore.ts'
import css from './TaskManagerTrigger.module.css'

type Props = PropsRuntime<'conversation.session.header.actions'>

/** 任务清单图标（内联，避免引入 icon 依赖）。 */
function TaskListIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** 会话头部任务入口。props 由 slot 注入（sessionId/useSessions/t 等），此处只读 store。 */
export function TaskManagerTrigger(_props: Props): JSX.Element {
  return (
    <button
      type="button"
      className={css.trigger}
      title="任务管理"
      aria-label="任务管理"
      onClick={taskPanelStore.openPanel}
    >
      <TaskListIcon />
      <span className={css.triggerLabel}>任务</span>
    </button>
  )
}
