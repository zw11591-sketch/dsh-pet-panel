/**
 * 任务管理面板：挂载在 shell.overlay（root scope 全局悬浮层）。
 * 「任务列表」：会话列表 + 每个会话的 todo 清单（projectionValues.todos）。
 * 「生命周期」：子代理血缘树 + 点击会话节点展开完整执行轨迹
 *   （turn → step → 工具调用/消息/审批/任务清单），数据由 host 端
 *   skillForge.lifecycle RPC 从 session.jsonl.zstd 逐帧解压解析而来。
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { LifecycleEvent, LifecycleSnapshot } from './remote.ts'
import { taskPanelStore } from './taskStore.ts'
import css from './TaskManagerView.module.css'

/**
 * 本地声明的 todo 类型（字段与 dsh-session 的 TodoItem 一致）。
 * dsh-tool-todo 不在本插件依赖里，为避免新增依赖（约束：不装节点），
 * 在此手写等价类型，读 projectionValues.todos 时用类型断言。
 */
interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

type Props = PropsRuntime<'shell.overlay'> & {
  lifecycle?: (sessionId: string) => Promise<LifecycleSnapshot>
}

type Badge = { label: string; cls: string }

/** 会话状态徽章（会话是「任务」的容器，不是任务本身）。 */
function sessionBadge(s: SessionSummary): Badge {
  if (s.running) return { label: '运行中', cls: css.badgeRunning }
  if (s.pendingInteraction) return { label: '等待交互', cls: css.badgeWaiting }
  if (s.completed) return { label: '已完成', cls: css.badgeDone }
  if (s.blank) return { label: '草稿', cls: css.badgeBlank }
  return { label: '空闲', cls: css.badgeIdle }
}

/** todo 任务状态徽章（这才是用户说的「任务」）。 */
function todoBadge(status: TodoItem['status']): Badge {
  if (status === 'pending') return { label: '待处理', cls: css.badgeTodoPending }
  if (status === 'in_progress') return { label: '进行中', cls: css.badgeTodoActive }
  return { label: '已完成', cls: css.badgeTodoDone }
}

interface TreeNode { session: SessionSummary; children: TreeNode[] }

/** 按 parentId 构建子代理血缘树；无父的会话是根。 */
function buildTree(byId: Record<string, SessionSummary>): TreeNode[] {
  const sessions = Object.values(byId)
  const roots: TreeNode[] = []
  const nodeOf = new Map<string, TreeNode>()
  for (const s of sessions) {
    const n: TreeNode = { session: s, children: [] }
    nodeOf.set(s.id, n)
    if (!s.parentId || !byId[s.parentId]) roots.push(n)
  }
  for (const n of nodeOf.values()) {
    const pid = n.session.parentId
    if (pid) {
      const parent = nodeOf.get(pid)
      if (parent) parent.children.push(n)
    }
  }
  return roots
}

/** 会话行：标题 + 会话状态徽章 + 该会话的 todo 清单（可展开）。 */
function SessionRow({ s, todos }: { s: SessionSummary; todos: TodoItem[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const sb = sessionBadge(s)
  const hasTodos = todos.length > 0
  const pending = todos.filter((t) => t.status === 'pending').length
  const active = todos.filter((t) => t.status === 'in_progress').length
  const done = todos.filter((t) => t.status === 'completed').length

  return (
    <div className={css.sessionRow}>
      <button
        className={css.sessionHeader}
        onClick={() => hasTodos && setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={css.caret}>{hasTodos ? (expanded ? '▾' : '▸') : '·'}</span>
        <span className={css.sessionTitle}>{s.displayTitle}</span>
        <span className={sb.cls}>{sb.label}</span>
        {hasTodos && (
          <span className={css.todoStats}>
            待办 {pending} · 进行 {active} · 完成 {done}
          </span>
        )}
      </button>
      {expanded && hasTodos && (
        <ul className={css.todoList}>
          {todos.map((t, i) => {
            const tb = todoBadge(t.status)
            return (
              <li key={i} className={css.todoRow}>
                <span className={css.todoContent}>{t.content}</span>
                <span className={tb.cls}>{tb.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// —— 执行轨迹（生命周期）——

function fmtTime(t: number): string {
  if (!t) return ''
  return new Date(t).toLocaleTimeString('zh-CN', { hour12: false })
}

function eventIcon(kind: string): string {
  switch (kind) {
    case 'turn-start': return '▶'
    case 'turn-end': return '⏹'
    case 'step-start': return '·'
    case 'step-end': return ''
    case 'user': return '💬'
    case 'assistant': return '🤖'
    case 'tool-call': return '🔧'
    case 'tool-result': return '📄'
    case 'approval-asked': return '⚠️'
    case 'approval-decided': return '✅'
    case 'todo': return '📋'
    default: return '•'
  }
}

function eventBody(ev: LifecycleEvent): string {
  switch (ev.kind) {
    case 'turn-start': return `第 ${ev.turn ?? '?'} 轮开始`
    case 'turn-end': return `第 ${ev.turn ?? '?'} 轮结束`
    case 'step-start': return `步骤 ${ev.step ?? '?'}`
    case 'step-end': return '步骤完成'
    case 'user': return ev.text ?? ''
    case 'assistant': return ev.text ?? ''
    case 'tool-call': return `${ev.toolName ?? 'tool'}${ev.toolArgs ? `  ${ev.toolArgs}` : ''}`
    case 'tool-result': return `${ev.isError ? '⚠ ' : ''}${ev.text ?? ''}`
    case 'approval-asked': return `审批 ${ev.toolName ?? ''}${ev.reason ? `：${ev.reason}` : ''}`
    case 'approval-decided': return `审批结果：${ev.outcome ?? ''}`
    case 'todo': return `任务清单：${(ev.todos ?? []).map((t) => `${t.content}(${t.status})`).join('、')}`
    default: return ev.kind
  }
}

/** 执行轨迹时间线：按 turn 分组，默认展开第 1 轮，其余点击展开。 */
function LifecycleTimeline({ snap }: { snap: LifecycleSnapshot }): JSX.Element {
  const [openTurns, setOpenTurns] = useState<Set<number>>(() => new Set([1]))

  const byTurn = new Map<number, LifecycleEvent[]>()
  let currentTurn = 1
  for (const ev of snap.events) {
    if (ev.kind === 'turn-start' && ev.turn !== undefined) currentTurn = ev.turn
    const t = ev.turn ?? currentTurn
    if (!byTurn.has(t)) byTurn.set(t, [])
    byTurn.get(t)!.push(ev)
  }
  const turns = [...byTurn.entries()].sort((a, b) => a[0] - b[0])

  const toggleTurn = (t: number) => {
    setOpenTurns((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  return (
    <div className={css.lifecycle}>
      <div className={css.lifecycleStats}>
        共 {snap.turns} 轮 · {snap.steps} 步 · {snap.toolCalls} 次工具调用
        {snap.approvals > 0 ? ` · ${snap.approvals} 次审批` : ''}
        {snap.todoWrites > 0 ? ` · ${snap.todoWrites} 次清单变更` : ''}
        {snap.startedAt ? ` · ${fmtTime(snap.startedAt)} ~ ${fmtTime(snap.endedAt)}` : ''}
      </div>
      {turns.length === 0 ? (
        <p className={css.lifecycleEmpty}>无执行记录（草稿会话）</p>
      ) : (
        turns.map(([t, evs]) => {
          const open = openTurns.has(t)
          const toolCount = evs.filter((e) => e.kind === 'tool-call').length
          return (
            <div key={t} className={css.lifecycleTurn}>
              <button className={css.lifecycleTurnHeader} onClick={() => toggleTurn(t)}>
                <span className={css.caret}>{open ? '▾' : '▸'}</span>
                <span className={css.lifecycleTurnTitle}>第 {t} 轮</span>
                <span className={css.lifecycleTurnMeta}>
                  {toolCount} 次工具调用 · {evs.length} 事件
                </span>
              </button>
              {open && (
                <div className={css.lifecycleEvents}>
                  {evs.map((ev) => (
                    <div key={ev.seq} className={css.lifecycleEvent}>
                      <span className={css.lifecycleIcon}>{eventIcon(ev.kind)}</span>
                      <span className={css.lifecycleText}>{eventBody(ev)}</span>
                      <span className={css.lifecycleTime}>{fmtTime(ev.time)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

interface TreeProps {
  node: TreeNode
  depth: number
  expandedId: string | null
  onToggle: (id: string) => void
  cache: Record<string, LifecycleSnapshot>
  loadingId: string | null
  errorMap: Record<string, string>
}

/** 血缘树节点（递归）：点击标题展开该会话的执行轨迹。 */
function TreeNodeView(p: TreeProps): JSX.Element {
  const { node, depth } = p
  const sb = sessionBadge(node.session)
  const id = node.session.id
  const isExpanded = p.expandedId === id
  return (
    <div className={css.treeBranch}>
      <div className={css.treeRow} style={{ paddingLeft: depth * 20 }}>
        <span className={css.treeConnector} />
        <button className={css.treeToggle} onClick={() => p.onToggle(id)}>
          <span className={css.caret}>{isExpanded ? '▾' : '▸'}</span>
          <span className={css.treeLabel}>{node.session.displayTitle}</span>
        </button>
        <span className={sb.cls}>{sb.label}</span>
        {node.children.length > 0 && (
          <span className={css.treeCount}>{node.children.length} 个子任务</span>
        )}
      </div>
      {isExpanded && (
        <div className={css.lifecycleWrap} style={{ paddingLeft: depth * 20 + 22 }}>
          {p.loadingId === id && <p className={css.lifecycleHint}>加载执行轨迹…</p>}
          {p.errorMap[id] && <p className={css.lifecycleError}>{p.errorMap[id]}</p>}
          {p.cache[id] && <LifecycleTimeline snap={p.cache[id]} />}
        </div>
      )}
      {node.children.map((c) => (
        <TreeNodeView
          key={c.session.id}
          node={c}
          depth={depth + 1}
          expandedId={p.expandedId}
          onToggle={p.onToggle}
          cache={p.cache}
          loadingId={p.loadingId}
          errorMap={p.errorMap}
        />
      ))}
    </div>
  )
}

export function TaskManagerView(props: Props): JSX.Element | null {
  const { useSessions, lifecycle } = props
  const state: SessionListState = useSessions((s) => s)
  const open = useSyncExternalStore(taskPanelStore.subscribe, taskPanelStore.isOpen)
  const [tab, setTab] = useState<'list' | 'flow'>('list')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cache, setCache] = useState<Record<string, LifecycleSnapshot>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})

  // 每个会话：标题 + 状态 + todo 清单。
  const rows = useMemo(() => {
    return state.ids
      .map((id) => state.byId[id])
      .filter(Boolean)
      .map((s) => ({
        session: s,
        todos: ((s.projectionValues as { todos?: TodoItem[] | null } | undefined)?.todos ?? []),
      }))
  }, [state])

  const tree = useMemo(() => buildTree(state.byId), [state.byId])

  const toggleLifecycle = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (cache[id] || errorMap[id]) return
    if (!lifecycle) {
      setErrorMap((m) => ({ ...m, [id]: 'lifecycle RPC 未挂载' }))
      return
    }
    setLoadingId(id)
    try {
      const snap = await lifecycle(id)
      setCache((c) => ({ ...c, [id]: snap }))
    } catch (e) {
      setErrorMap((m) => ({ ...m, [id]: (e as Error)?.message ?? String(e) }))
    } finally {
      setLoadingId(null)
    }
  }

  if (!open) return null

  // 全局 todo 统计（跨会话聚合）。
  let pending = 0
  let active = 0
  let done = 0
  for (const r of rows) {
    for (const t of r.todos) {
      if (t.status === 'pending') pending++
      else if (t.status === 'in_progress') active++
      else done++
    }
  }
  const total = pending + active + done

  return (
    <div className={css.overlay} onClick={taskPanelStore.closePanel}>
      <div className={css.panel} onClick={(e) => e.stopPropagation()}>
        <header className={css.header}>
          <span className={css.title}>任务管理</span>
          <span className={css.stats}>
            待处理 {pending} · 进行中 {active} · 已完成 {done}
            {total > 0 ? `（共 ${total} 项）` : '（暂无任务）'}
          </span>
          <button className={css.close} onClick={taskPanelStore.closePanel} aria-label="关闭">
            ×
          </button>
        </header>

        <div className={css.tabs}>
          <button
            className={tab === 'list' ? css.tabActive : css.tab}
            onClick={() => setTab('list')}
          >
            任务列表
          </button>
          <button
            className={tab === 'flow' ? css.tabActive : css.tab}
            onClick={() => setTab('flow')}
          >
            生命周期
          </button>
        </div>

        {tab === 'list' ? (
          <div className={css.body}>
            {rows.length === 0 ? (
              <p className={css.empty}>暂无会话</p>
            ) : (
              rows.map((r) => (
                <SessionRow key={r.session.id} s={r.session} todos={r.todos} />
              ))
            )}
          </div>
        ) : (
          <div className={css.body}>
            {tree.length === 0 ? (
              <p className={css.empty}>暂无会话血缘</p>
            ) : (
              tree.map((root) => (
                <TreeNodeView
                  key={root.session.id}
                  node={root}
                  depth={0}
                  expandedId={expandedId}
                  onToggle={toggleLifecycle}
                  cache={cache}
                  loadingId={loadingId}
                  errorMap={errorMap}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
