/** 团队（Team）弹窗：把自己 + 已注册外部 agent 编成团队，群聊里 @ 定向或广播。
 *  挂载在 shell.overlay（root scope 全局悬浮层），由 teamStore 控制开合。 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Team, Thread, ThreadSummary, ChatMessage, A2AConfig, A2AExternalAgent, A2AHealth } from './remote.ts'
import { teamPanelStore } from './teamStore.ts'
import css from './TeamView.module.css'

/** host-face team remote，包装成 promise helpers。 */
export interface TeamApi {
  listTeams: () => Promise<{ teams: Team[] }>
  createTeam: (name: string, members: string[]) => Promise<{ team: Team }>
  updateTeam: (id: string, name: string, members: string[]) => Promise<{ team: Team }>
  deleteTeam: (id: string) => Promise<{ id: string }>
  listThreads: (teamId: string) => Promise<{ threads: ThreadSummary[] }>
  openThread: (teamId: string, peer: string) => Promise<{ thread: Thread }>
  getThread: (threadId: string) => Promise<{ thread: Thread }>
  send: (threadId: string, text: string) => Promise<{ messages: ChatMessage[] }>
}

/** 读 a2a 配置（取 card.name 显示「我」，取 agents 供建团队勾选成员）+ 探测外部 agent 存活。 */
export interface TeamA2AApi {
  get: () => Promise<A2AConfig>
  checkAgents: () => Promise<{ items: A2AHealth[] }>
}

type TeamViewProps = PropsRuntime<'shell.overlay'> & { api: TeamApi; a2a: TeamA2AApi }

/** 成员显示名："me" → card 名。 */
function memberLabel(name: string, cardName: string): string {
  return name === 'me' ? (cardName || '我') : name
}

/** 成员存活状态：'me' 恒在线；外部 agent 看 health。 */
function memberStatus(name: string, health: Record<string, A2AHealth>): 'online' | 'offline' | 'unknown' {
  if (name === 'me') return 'online'
  const h = health[name]
  if (h === undefined) return 'unknown'
  return h.online ? 'online' : 'offline'
}

export default function TeamView(props: TeamViewProps): React.JSX.Element | null {
  const { api, a2a } = props
  const open = useSyncExternalStore(teamPanelStore.subscribe, teamPanelStore.isOpen)

  const [teams, setTeams] = useState<Team[]>([])
  const [agents, setAgents] = useState<A2AExternalAgent[]>([])
  const [cardName, setCardName] = useState('我')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [thread, setThread] = useState<Thread | null>(null)
  /** 外部 agent 存活状态：name → online/latency/error。 */
  const [health, setHealth] = useState<Record<string, A2AHealth>>({})

  // 建团队表单
  const [teamForm, setTeamForm] = useState({ name: '', memberNames: [] as string[] })
  const [showCreate, setShowCreate] = useState(false)
  /** 待删除的团队（触发面板内确认弹窗，替代原生 window.confirm）。 */
  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null)

  // 聊天输入
  const [input, setInput] = useState('')
  const [mention, setMention] = useState<{ query: string; candidates: string[]; activeIndex: number } | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在等待回复的 threadId（用于「对方回复中…」指示）。 */
  const [replying, setReplying] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)

  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3500)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
  }, [])

  const refreshTeams = useCallback(async () => {
    try {
      const { teams } = await api.listTeams()
      setTeams(teams)
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    }
  }, [api, showToast])

  const refreshAgents = useCallback(async () => {
    try {
      const c = await a2a.get()
      setAgents(c.agents)
      setCardName(c.card.name || '我')
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    }
  }, [a2a, showToast])

  // 探测所有外部 agent 存活状态：打开面板后立即跑一次，之后每 15s 轮询。
  const checkHealth = useCallback(async () => {
    try {
      const { items } = await a2a.checkAgents()
      const next: Record<string, A2AHealth> = {}
      for (const it of items) next[it.name] = it
      setHealth(next)
    } catch {
      // 探测失败静默忽略：下次轮询自动重试。
    }
  }, [a2a])

  // 打开时刷新团队与成员（保持数据新鲜），并启动存活状态轮询。
  useEffect(() => {
    if (open) {
      void refreshTeams()
      void refreshAgents()
      void checkHealth()
      const id = window.setInterval(() => void checkHealth(), 15000)
      return () => window.clearInterval(id)
    }
  }, [open, refreshTeams, refreshAgents, checkHealth])

  const refreshThreads = useCallback(async (teamId: string) => {
    try {
      const { threads } = await api.listThreads(teamId)
      setThreads(threads)
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    }
  }, [api, showToast])

  const openThread = useCallback(async (teamId: string, peer: string) => {
    setBusy(true)
    try {
      const { thread } = await api.openThread(teamId, peer)
      setThread(thread)
      if (teamId) void refreshThreads(teamId)
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, refreshThreads, showToast])

  const selectTeam = useCallback(async (teamId: string) => {
    setSelectedTeamId(teamId)
    setThread(null)
    void refreshThreads(teamId)
  }, [refreshThreads])

  const createTeam = useCallback(async () => {
    if (!teamForm.name.trim()) {
      showToast('error', '团队名不能为空')
      return
    }
    setBusy(true)
    try {
      const { team } = await api.createTeam(teamForm.name.trim(), teamForm.memberNames)
      setTeamForm({ name: '', memberNames: [] })
      setShowCreate(false)
      showToast('success', '已创建团队')
      await refreshTeams()
      setSelectedTeamId(team.id)
      void refreshThreads(team.id)
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, teamForm, refreshTeams, refreshThreads, showToast])

  const removeTeam = useCallback((team: Team) => {
    setConfirmDelete(team)
  }, [])

  const confirmRemoveTeam = useCallback(async () => {
    if (!confirmDelete) return
    const team = confirmDelete
    setConfirmDelete(null)
    setBusy(true)
    try {
      await api.deleteTeam(team.id)
      showToast('success', '已删除团队')
      if (selectedTeamId === team.id) {
        setSelectedTeamId(null)
        setThread(null)
        setThreads([])
      }
      await refreshTeams()
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, confirmDelete, selectedTeamId, refreshTeams, showToast])

  const toggleMember = useCallback((name: string) => {
    setTeamForm((f) => ({
      ...f,
      memberNames: f.memberNames.includes(name)
        ? f.memberNames.filter((n) => n !== name)
        : [...f.memberNames, name],
    }))
  }, [])

  // @ 补全：输入里最后一个未闭合的 @query；已 @ 过的成员不重复出现在候选里。
  const updateMention = useCallback((value: string) => {
    const members = thread?.members ?? []
    const at = value.lastIndexOf('@')
    if (at < 0) {
      setMention(null)
      return
    }
    const after = value.slice(at + 1)
    if (/\s/.test(after)) {
      setMention(null)
      return
    }
    const q = after.toLowerCase()
    // 已提及成员：当前 @ 之前、所有「已闭合」的 @token（后跟空格或结尾）。
    const mentioned = new Set<string>()
    const prev = value.slice(0, at)
    const re = /@([^\s@]+)(?=\s|$)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(prev)) !== null) {
      mentioned.add(m[1])
    }
    const candidates = members.filter((member) => {
      if (mentioned.has(member)) return false
      const label = memberLabel(member, cardName)
      return label.toLowerCase().startsWith(q) || normalizeForMatch(member).startsWith(q)
    })
    setMention({ query: after, candidates, activeIndex: 0 })
  }, [thread, cardName])

  const applyMention = useCallback((name: string) => {
    const at = input.lastIndexOf('@')
    if (at < 0) return
    const next = input.slice(0, at) + `@${name} ` + input.slice(at + 1).replace(/^[^\s]*/, '')
    setInput(next)
    setMention(null)
    inputRef.current?.focus()
  }, [input])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !thread || replying) return
    const tid = thread.threadId
    setBusy(true)
    setReplying(tid)
    setInput('')
    setMention(null)
    // 乐观上屏：先展示自己这条消息 + 「回复中」指示，避免长等待显得卡住。
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: 'user', text, time: Date.now() }
    setThread((t) => (t && t.threadId === tid ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const { messages } = await api.send(tid, text)
      // 自己那条已乐观展示，这里只追加回复与系统提示（role !== 'user'），避免重复。
      const replies = messages.filter((m) => m.role !== 'user')
      setThread((t) => (t && t.threadId === tid ? { ...t, messages: [...t.messages, ...replies] } : t))
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setReplying(null)
      setBusy(false)
    }
  }, [api, input, thread, replying, showToast])

  // 新消息滚动到底。
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages.length, replying])

  if (!open) return null

  const activeTeam = teams.find((t) => t.id === selectedTeamId) ?? null

  return (
    <div className={css.overlay} onClick={teamPanelStore.closePanel}>
      <div className={css.panel} onClick={(e) => e.stopPropagation()}>
        <header className={css.header}>
          <span className={css.title}>团队</span>
          <button className={css.close} onClick={teamPanelStore.closePanel} aria-label="关闭">
            ×
          </button>
        </header>

        <div className={css.body}>
          {/* 左栏：团队 + 成员 + 线程 */}
          <aside className={css.sidebar}>
            <div className={css.sideHead}>
              <span className={css.sideTitle}>团队</span>
              <button className={css.ghostButton} onClick={() => setShowCreate((s) => !s)} disabled={busy}>
                {showCreate ? '收起' : '新建团队'}
              </button>
            </div>

            {showCreate && (
              <div className={css.createBox}>
                <input
                  className={css.input}
                  value={teamForm.name}
                  onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                  placeholder="团队名"
                />
                <div className={css.pickTitle}>选择外部 agent 成员（自己「我」恒在内）</div>
                <div className={css.pickList}>
                  {agents.length === 0 ? (
                    <span className={css.empty}>先在「A2A 管理」注册外部 agent。</span>
                  ) : (
                    agents.map((a) => (
                      <label key={a.name} className={css.pickItem}>
                        <input
                          type="checkbox"
                          checked={teamForm.memberNames.includes(a.name)}
                          onChange={() => toggleMember(a.name)}
                        />
                        <span>{a.name}</span>
                      </label>
                    ))
                  )}
                </div>
                <button className={css.saveButton} onClick={() => void createTeam()} disabled={busy}>
                  {busy ? '创建中…' : '创建'}
                </button>
              </div>
            )}

            <ul className={css.teamList}>
              {teams.map((t) => (
                <li key={t.id} className={`${css.teamItem} ${selectedTeamId === t.id ? css.active : ''}`}>
                  <div className={css.teamRow}>
                    <button className={css.teamName} onClick={() => void selectTeam(t.id)}>
                      {t.name}
                    </button>
                    <button className={css.ghostButton} onClick={() => void removeTeam(t)} disabled={busy}>删</button>
                  </div>
                  <div className={css.memberChips}>
                    {t.members.map((m) => {
                      const st = memberStatus(m, health)
                      return (
                        <span key={m} className={`${css.chip} ${m === 'me' ? css.meChip : ''}`}>
                          <span className={`${css.statusDot} ${st === 'online' ? css.dotOnline : st === 'offline' ? css.dotOffline : css.dotUnknown}`} />
                          {memberLabel(m, cardName)}
                        </span>
                      )
                    })}
                  </div>
                  {selectedTeamId === t.id && (
                    <div className={css.threadArea}>
                      <button
                        className={css.threadBtn}
                        onClick={() => void openThread(t.id, '')}
                        disabled={busy}
                      >
                        群聊（{t.members.length} 人）
                      </button>
                      {t.members.filter((m) => m !== 'me').map((m) => (
                        <button
                          key={m}
                          className={css.threadBtn}
                          onClick={() => void openThread('', m)}
                          disabled={busy}
                        >
                          单聊 @{m}
                        </button>
                      ))}
                      {threads.map((th) => (
                        <button
                          key={th.threadId}
                          className={css.threadBtn}
                          onClick={() => void api.getThread(th.threadId).then(({ thread: t }) => setThread(t))}
                          disabled={busy}
                        >
                          {th.peer ? `↩ ${th.peer}` : th.title}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </aside>

          {/* 右栏：聊天 */}
          <section className={css.chat}>
            {!thread ? (
              <div className={css.chatEmpty}>
                <p>左侧选择一个团队，点「群聊」或「单聊 @成员」开始。</p>
                <p className={css.hint}>群聊里用 @成员名 定向，@all 或直接发送则广播全员。</p>
              </div>
            ) : (
              <>
                <header className={css.chatHead}>
                  <span className={css.chatTitle}>{thread.title}</span>
                  {thread.peer && (
                    <span className={`${css.peerStatus} ${memberStatus(thread.peer, health) === 'online' ? css.peerOnline : memberStatus(thread.peer, health) === 'offline' ? css.peerOffline : css.peerUnknown}`}>
                      <span className={css.statusDot} />
                      {memberStatus(thread.peer, health) === 'online' ? '在线' : memberStatus(thread.peer, health) === 'offline' ? '离线' : '未知'}
                    </span>
                  )}
                  <span className={css.chatMeta}>
                    {thread.teamId ? `群聊 · ${thread.members.length} 人` : `单聊 · ${thread.peer}`}
                  </span>
                </header>

                <div className={css.msgList}>
                  {thread.messages.map((m) => {
                    if (m.role === 'system') {
                      return <div key={m.id} className={css.sysMsg}>{m.text}</div>
                    }
                    if (m.role === 'user') {
                      return <div key={m.id} className={`${css.msg} ${css.userMsg}`}>{m.text}</div>
                    }
                    return (
                      <div key={m.id} className={`${css.msg} ${css.agentMsg}`}>
                        <span className={css.msgAuthor}>{memberLabel(m.agent ?? '?', cardName)}</span>
                        <span className={css.msgText}>{m.text}</span>
                      </div>
                    )
                  })}
                  {replying === thread.threadId && (
                    <div className={`${css.msg} ${css.typingMsg}`} role="status" aria-live="polite">
                      <span className={css.typingDots}><i /><i /><i /></span>
                      <span>{thread.peer ? `${memberLabel(thread.peer, cardName)} 回复中…` : '对方回复中…'}</span>
                    </div>
                  )}
                  <div ref={listEndRef} />
                </div>

                <div className={css.inputArea}>
                  {mention && mention.candidates.length > 0 && (
                    <div className={css.mentionMenu}>
                      {mention.candidates.map((m, i) => (
                        <button
                          key={m}
                          className={`${css.mentionItem} ${i === mention.activeIndex ? css.mentionItemActive : ''}`}
                          onMouseDown={(e) => { e.preventDefault(); applyMention(m) }}
                          onMouseEnter={() => setMention((prev) => prev ? { ...prev, activeIndex: i } : prev)}
                        >
                          @{memberLabel(m, cardName)}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    className={css.input}
                    value={input}
                    rows={3}
                    placeholder="输入消息，@成员 定向，直接回车广播全员…"
                    onChange={(e) => { setInput(e.target.value); updateMention(e.target.value) }}
                    onKeyDown={(e) => {
                      // @ 补全列表打开时：↑↓ 导航，回车选中，Esc 关闭。
                      if (mention && mention.candidates.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setMention((prev) => prev ? { ...prev, activeIndex: (prev.activeIndex + 1) % prev.candidates.length } : prev)
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setMention((prev) => prev ? { ...prev, activeIndex: (prev.activeIndex - 1 + prev.candidates.length) % prev.candidates.length } : prev)
                          return
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const name = mention.candidates[mention.activeIndex]
                          if (name !== undefined) applyMention(name)
                          return
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setMention(null)
                          return
                        }
                      }
                      // 列表未打开：回车发送（Shift+Enter 换行）。
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                  />
                  <button className={css.saveButton} onClick={() => void send()} disabled={busy || !input.trim()}>
                    {busy ? '发送中…' : '发送'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {toast && typeof document !== 'undefined' && createPortal(
        <div className={css.toastWrap} role="status" aria-live="polite">
          <div className={`${css.toast} ${toast.kind === 'error' ? css.toastError : ''}`}>
            <span>{toast.kind === 'success' ? '✓' : '⚠'}</span>
            <span>{toast.text}</span>
          </div>
        </div>,
        document.body,
      )}

      {confirmDelete && typeof document !== 'undefined' && createPortal(
        <div className={css.modalBackdrop} onClick={() => setConfirmDelete(null)}>
          <div className={css.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={css.modalTitle}>删除团队</div>
            <div className={css.modalText}>确定删除团队「{confirmDelete.name}」吗？该团队及其全部聊天记录将被移除，此操作无法撤销。</div>
            <div className={css.modalActions}>
              <button className={css.ghostButton} onClick={() => setConfirmDelete(null)} disabled={busy}>取消</button>
              <button className={css.dangerButton} onClick={() => void confirmRemoveTeam()} disabled={busy}>
                {busy ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** 成员匹配归一化：小写去空格连字符下划线。 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·]+/g, '')
}
