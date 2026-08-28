/** The conversation panel view: a self-contained interactive dashboard page. */

import { useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId, SessionProjectionMap, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges contextPressure/contextBreakdown into SessionProjectionMap
// so the current session's projectionValues carry them typed.
import type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import css from './HelloView.module.css'

/** Full props: the conversation-view standard kit plus the hello locale seat. */
type HelloViewProps = ConvViewProps & PropsLocale<'hello'>

/** Inner page sections, switched by the local tab bar. */
type Section = 'overview' | 'features' | 'about'

/** One day's bucket in the trailing-7-day activity chart. */
interface DayBucket {
  /** Localized weekday label for the bar. */
  label: string
  /** ISO date (yyyy-mm-dd): stable React key and tooltip anchor. */
  iso: string
  /** Non-blank sessions whose updatedAt lands on this day. */
  value: number
}

/** At-a-glance session tallies derived from the same summary feed. */
interface SessionStats {
  /** Non-blank sessions the store knows about. */
  total: number
  /** Sessions currently running a turn. */
  running: number
  /** Non-blank sessions last active today. */
  today: number
}

const DAY_MS = 86_400_000

/** Local-midnight epoch for a timestamp. */
function dayStart(epoch: number): number {
  const date = new Date(epoch)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Count non-blank sessions per day across the trailing 7 calendar days ending
 * today, oldest bar first. Pure over the session summaries; the caller wraps
 * it in useMemo keyed on the useSessions byId map.
 * @param byId - session summaries from the useSessions standard feed.
 * @param now - current epoch, fixing the trailing window's right edge.
 * @returns seven day buckets, oldest first.
 */
function weeklyActivity(byId: Record<SessionId, SessionSummary>, now: number): DayBucket[] {
  const todayStart = dayStart(now)
  const windowStart = todayStart - 6 * DAY_MS
  const buckets: DayBucket[] = Array.from({ length: 7 }, (_unused, index) => {
    const date = new Date(windowStart + index * DAY_MS)
    return {
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      iso: date.toISOString().slice(0, 10),
      value: 0,
    }
  })
  for (const summary of Object.values(byId)) {
    if (summary.blank) continue
    const day = dayStart(summary.updatedAt)
    if (day < windowStart || day > todayStart) continue
    const bucket = buckets[Math.round((day - windowStart) / DAY_MS)]
    if (bucket !== undefined) bucket.value += 1
  }
  return buckets
}

/**
 * Tally total, running, and today's non-blank sessions. Pure over the session
 * summaries; the caller wraps it in useMemo keyed on the useSessions byId map.
 * @param byId - session summaries from the useSessions standard feed.
 * @param now - current epoch, fixing what counts as "today".
 * @returns the three at-a-glance session tallies.
 */
function sessionStats(byId: Record<SessionId, SessionSummary>, now: number): SessionStats {
  const todayStart = dayStart(now)
  const stats: SessionStats = { total: 0, running: 0, today: 0 }
  for (const summary of Object.values(byId)) {
    if (summary.blank) continue
    stats.total += 1
    if (summary.running) stats.running += 1
    if (dayStart(summary.updatedAt) === todayStart) stats.today += 1
  }
  return stats
}

/** Billed input + output over the whole log, or undefined when nothing was billed. */
function billedTotal(usage: TokenUsageProjection | undefined): number | undefined {
  if (usage === undefined) return undefined
  const total = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
  return total > 0 ? total : undefined
}

/** One session's billed-token spend, for the overview ranking. */
interface TokenSpender {
  id: SessionId
  /** Human-facing label. */
  title: string
  /** Billed input + output tokens over the whole log. */
  tokens: number
  /** Whether this row is the session the panel is mounted in. */
  current: boolean
}

/** Aggregate billed-token usage across all non-blank sessions. */
interface TokenOverview {
  /** Summed billed tokens across every session with usage. */
  total: number
  /** Sessions that carry any billed usage. */
  sessions: number
  /** Highest spenders, descending, capped to the caller's limit. */
  top: TokenSpender[]
}

/**
 * Aggregate billed-token usage across the session store. Pure over the summary
 * feed; the caller wraps it in useMemo keyed on the byId map. Each session's
 * figure is its whole-log cumulative billing, so the total is spend-to-date,
 * not a windowed rate.
 * @param byId - session summaries from the useSessions standard feed.
 * @param currentId - the session this panel is mounted in.
 * @param limit - maximum ranked rows to return.
 * @returns the token total, contributing-session count, and top spenders.
 */
function tokenOverview(
  byId: Record<SessionId, SessionSummary>,
  currentId: SessionId,
  limit: number,
): TokenOverview {
  const spenders: TokenSpender[] = []
  let total = 0
  for (const summary of Object.values(byId)) {
    if (summary.blank) continue
    const tokens = billedTotal(summary.projectionValues?.tokenUsage)
    if (tokens === undefined) continue
    total += tokens
    spenders.push({ id: summary.id, title: summary.displayTitle, tokens, current: summary.id === currentId })
  }
  spenders.sort((a, b) => b.tokens - a.tokens)
  return { total, sessions: spenders.length, top: spenders.slice(0, limit) }
}

/** Current-session context occupancy, derived from the token-meter projection. */
interface ContextUsage {
  /** Occupancy percent (0–100), clamped like the composer's ContextMeter. */
  percent: number
  /** Provider-anchored tokens the next request would carry. */
  usedTokens: number
  /** Newest known route context window. */
  contextWindow: number
  /** Heuristic system/tools/message token split; absent until a request lands. */
  breakdown: ContextBreakdownProjection | undefined
}

/** Compact token count: 517 / 12.2K / 1.2M (one decimal under three digits). */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Derive the current session's context occupancy from its projection values.
 * Mirrors the composer ContextMeter: numerator is the provider-anchored
 * projectedTokens (falling back to the bare pressure sample), denominator is
 * the newest route capacity. Returns null until both are known.
 * @param pressure - the session's contextPressure projection value.
 * @param breakdown - the session's contextBreakdown projection value.
 * @returns the occupancy reference figure, or null when not yet measurable.
 */
function contextUsage(
  pressure: ContextPressureProjection | undefined,
  breakdown: ContextBreakdownProjection | undefined,
): ContextUsage | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round((usedTokens / pressure.contextWindow) * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
    breakdown,
  }
}

/** One weighted part of the context-composition breakdown. */
interface BreakdownPart {
  label: string
  tokens: number
  /** Share of the breakdown sum, 0–100. */
  percent: number
}

/** One billing bucket of the whole-log token usage. */
interface BillingPart {
  label: string
  tokens: number
}

/** Detailed current-session context analysis, all from the token-meter projections. */
interface ContextAnalysis {
  /** Occupancy figure, or null before the first request reports usage. */
  usage: ContextUsage | null
  /** Remaining context-window budget, or null when no window is known. */
  remaining: number | null
  /** Composition parts (system/tools/messages), empty until a breakdown lands. */
  parts: BreakdownPart[]
  /** Whole-log billing buckets, empty until any billing lands. */
  billing: BillingPart[]
  /** Cache-hit share of billed input, or null when nothing was billed. */
  cacheHit: number | null
}

/**
 * Assemble the current session's detailed context analysis from its projection
 * values. Pure; the caller wraps it in useMemo keyed on the session's values.
 * @param values - the current session's projectionValues, if any.
 * @returns occupancy, remaining budget, composition parts, and billing buckets.
 */
function contextAnalysis(values: Readonly<Partial<SessionProjectionMap>> | undefined): ContextAnalysis {
  const usage = contextUsage(values?.contextPressure, values?.contextBreakdown)
  const remaining = usage === null ? null : Math.max(0, usage.contextWindow - usage.usedTokens)

  const breakdown = values?.contextBreakdown
  const parts: BreakdownPart[] = []
  if (breakdown !== undefined) {
    const sum = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
    const denominator = Math.max(1, sum)
    const raw: readonly { label: string; tokens: number }[] = [
      { label: '系统提示', tokens: breakdown.systemTokens },
      { label: '工具定义', tokens: breakdown.toolsTokens },
      { label: '对话内容', tokens: breakdown.messageTokens },
    ]
    for (const part of raw) {
      parts.push({ label: part.label, tokens: part.tokens, percent: Math.round((part.tokens / denominator) * 100) })
    }
  }

  const usageTokens = values?.tokenUsage
  const billing: BillingPart[] = []
  let cacheHit: number | null = null
  if (usageTokens !== undefined) {
    billing.push(
      { label: '未缓存输入', tokens: usageTokens.uncachedInputTokens },
      { label: '缓存读取', tokens: usageTokens.cacheReadTokens },
      { label: '缓存写入', tokens: usageTokens.cacheWriteTokens },
      { label: '输出', tokens: usageTokens.outputTokens },
    )
    const billedInput = usageTokens.uncachedInputTokens + usageTokens.cacheReadTokens + usageTokens.cacheWriteTokens
    if (billedInput > 0) cacheHit = Math.round((usageTokens.cacheReadTokens / billedInput) * 100)
  }

  return { usage, remaining, parts, billing, cacheHit }
}

/** One derived row for the archived / forked session lists. */
interface RelatedSession {
  id: SessionId
  title: string
  updatedAt: number
  /** Parent's display title for a fork, when the parent is still in the store. */
  parentTitle?: string | undefined
  /** True when the row is a subagent descendant rather than a user fork. */
  subagent: boolean
}

/** Archived sessions the store still knows about, newest first. */
function relatedArchived(byId: Record<SessionId, SessionSummary>, archivedIds: readonly SessionId[]): RelatedSession[] {
  const rows: RelatedSession[] = []
  for (const id of archivedIds) {
    const s = byId[id]
    if (s === undefined || s.blank) continue
    rows.push({ id, title: s.displayTitle, updatedAt: s.updatedAt, subagent: s.origin === 'subagent' })
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Forked sessions (any non-blank with a parent), excluding archived ones —
 * those show in their own list — newest first. */
function relatedForks(byId: Record<SessionId, SessionSummary>, archivedIds: readonly SessionId[]): RelatedSession[] {
  const archived = new Set(archivedIds)
  const rows: RelatedSession[] = []
  for (const s of Object.values(byId)) {
    if (s.blank || s.parentId === undefined || archived.has(s.id)) continue
    rows.push({ id: s.id, title: s.displayTitle, updatedAt: s.updatedAt, parentTitle: byId[s.parentId]?.displayTitle, subagent: s.origin === 'subagent' })
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * The panel tab body.
 * @param props - conversation-view standard kit plus the bound translate.
 * @returns the rendered dashboard page.
 */
export function HelloView(props: HelloViewProps): React.ReactElement {
  const { t, sessionId, useSessions, useWorkspaces } = props
  const [section, setSection] = useState<Section>('overview')
  const sessionsById = useSessions(state => state.byId)
  const archivedIds = useWorkspaces(state => state.archivedSessionIds)
  const chart = useMemo(() => weeklyActivity(sessionsById, Date.now()), [sessionsById])
  const chartTotal = useMemo(() => chart.reduce((sum, day) => sum + day.value, 0), [chart])
  const chartMax = Math.max(1, ...chart.map(day => day.value))
  const stats = useMemo(() => sessionStats(sessionsById, Date.now()), [sessionsById])
  const usage = useMemo(() => {
    const values = sessionsById[sessionId]?.projectionValues
    return contextUsage(values?.contextPressure, values?.contextBreakdown)
  }, [sessionsById, sessionId])
  const overview = useMemo(() => tokenOverview(sessionsById, sessionId, 5), [sessionsById, sessionId])
  const analysis = useMemo(() => contextAnalysis(sessionsById[sessionId]?.projectionValues), [sessionsById, sessionId])
  const archived = useMemo(() => relatedArchived(sessionsById, archivedIds), [sessionsById, archivedIds])
  const forked = useMemo(() => relatedForks(sessionsById, archivedIds), [sessionsById, archivedIds])
  const current = sessionsById[sessionId]

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t('title')}</h1>
        <p className={css.subtitle}>{t('subtitle')}</p>
      </header>

      <nav className={css.tabs} aria-label="hello sections">
        {(['overview', 'features', 'about'] as const).map(id => (
          <button
            key={id}
            type="button"
            className={id === section ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => { setSection(id) }}
          >
            {t(`tab.${id}` as const)}
          </button>
        ))}
      </nav>

      {section === 'overview' && (
        <section className={css.body}>
          <div className={css.statGrid}>
            <div className={css.statCard}>
              <span className={css.statLabel}>上下文用量</span>
              {usage === null
                ? <span className={css.statValueSmall}>等待首次请求…</span>
                : (
                  <>
                    <span className={css.statValue}>{usage.percent}%</span>
                    <div className={css.gaugeTrack}>
                      <div className={css.gaugeFill} style={{ width: `${String(usage.percent)}%` }} />
                    </div>
                    <span className={css.gaugeMeta}>
                      {formatTokens(usage.usedTokens)} / {formatTokens(usage.contextWindow)} tokens
                    </span>
                    {usage.breakdown !== undefined && (
                      <span className={css.gaugeSplit}>
                        系统 {formatTokens(usage.breakdown.systemTokens)}
                        {' · '}工具 {formatTokens(usage.breakdown.toolsTokens)}
                        {' · '}对话 {formatTokens(usage.breakdown.messageTokens)}
                      </span>
                    )}
                  </>
                )}
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>会话概览</span>
              <div className={css.miniGrid}>
                <div className={css.miniItem}>
                  <span className={css.miniValue}>{stats.total}</span>
                  <span className={css.miniLabel}>总会话</span>
                </div>
                <div className={css.miniItem}>
                  <span className={css.miniValue}>{Math.max(0, stats.total - archived.length)}</span>
                  <span className={css.miniLabel}>可用会话</span>
                </div>
                <div className={css.miniItem}>
                  <span className={css.miniValue}>{archived.length}</span>
                  <span className={css.miniLabel}>归档会话</span>
                </div>
                <div className={css.miniItem}>
                  <span className={css.miniValue}>{stats.running}</span>
                  <span className={css.miniLabel}>运行中</span>
                </div>
                <div className={css.miniItem}>
                  <span className={css.miniValue}>{stats.today}</span>
                  <span className={css.miniLabel}>今日活跃</span>
                </div>
              </div>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>当前会话</span>
              <span className={css.statValueSmall}>{sessionId}</span>
            </div>
          </div>

          <div className={css.chartCard}>
            <span className={css.cardTitle}>近 7 天会话活跃度 · 共 {chartTotal} 个会话</span>
            <div className={css.chart}>
              {chart.map(day => (
                <div key={day.iso} className={css.bar}>
                  <span className={css.barValue}>{day.value}</span>
                  <div
                    className={css.barFill}
                    style={{ height: `${String(Math.round((day.value / chartMax) * 100))}%` }}
                    title={`${day.iso}：${String(day.value)} 个会话`}
                  />
                  <span className={css.barLabel}>{day.label}</span>
                </div>
              ))}
            </div>
          </div>

          {archived.length > 0 && (
            <div className={css.chartCard}>
              <span className={css.cardTitle}>归档会话 · {archived.length}</span>
              <ul className={css.recentList}>
                {archived.map(row => (
                  <li key={row.id} className={css.relatedRow}>
                    <span className={css.relatedTitle}>
                      {row.title}
                      {row.subagent && <span className={css.relatedTag}>子代理</span>}
                    </span>
                    <span className={css.relatedMeta}>已归档</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {forked.length > 0 && (
            <div className={css.chartCard}>
              <span className={css.cardTitle}>分叉会话 · {forked.length}</span>
              <ul className={css.recentList}>
                {forked.map(row => (
                  <li key={row.id} className={css.relatedRow}>
                    <span className={css.relatedTitle}>
                      {row.title}
                      {row.subagent && <span className={css.relatedTag}>子代理</span>}
                    </span>
                    <span className={css.relatedMeta}>
                      {row.parentTitle !== undefined ? `派生自 ${row.parentTitle}` : '派生会话'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {section === 'features' && (
        <section className={css.body}>
          <div className={css.chartCard}>
            <span className={css.cardTitle}>
              Token 用量总览 · 累计 {formatTokens(overview.total)} · {overview.sessions} 个会话
            </span>
            {overview.top.length === 0
              ? <span className={css.statValueSmall}>还没有 token 消耗记录</span>
              : (
                <ul className={css.recentList}>
                  {overview.top.map(item => (
                    <li key={item.id} className={css.rankRow}>
                      <div className={css.recentMain}>
                        <span className={css.recentTitle}>
                          {item.title}
                          {item.current && <span className={css.currentTag}>当前</span>}
                        </span>
                        <div className={css.gaugeTrack}>
                          <div
                            className={css.gaugeFill}
                            style={{ width: `${String(Math.round((item.tokens / (overview.top[0]?.tokens ?? 1)) * 100))}%` }}
                          />
                        </div>
                      </div>
                      <span className={css.recentTokens}>{formatTokens(item.tokens)} tok</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>

          <div className={css.chartCard}>
            <span className={css.cardTitle}>当前会话 · 上下文详细分析</span>
            {analysis.usage === null && analysis.billing.length === 0
              ? <span className={css.statValueSmall}>等待首次请求…</span>
              : (
                <div className={css.analysisBody}>
                  {analysis.usage !== null && (
                    <div className={css.analysisBlock}>
                      <div className={css.analysisHead}>
                        <span className={css.analysisLabel}>上下文占用</span>
                        <span className={css.analysisValue}>{analysis.usage.percent}%</span>
                      </div>
                      <div className={css.gaugeTrack}>
                        <div className={css.gaugeFill} style={{ width: `${String(analysis.usage.percent)}%` }} />
                      </div>
                      <span className={css.gaugeMeta}>
                        已用 {formatTokens(analysis.usage.usedTokens)} / 窗口 {formatTokens(analysis.usage.contextWindow)}
                        {analysis.remaining !== null && ` · 剩余 ${formatTokens(analysis.remaining)}`}
                      </span>
                    </div>
                  )}

                  {analysis.parts.length > 0 && (
                    <div className={css.analysisBlock}>
                      <span className={css.analysisLabel}>上下文构成</span>
                      {analysis.parts.map(part => (
                        <div key={part.label} className={css.rankRow}>
                          <div className={css.recentMain}>
                            <span className={css.recentTitle}>{part.label}</span>
                            <div className={css.gaugeTrack}>
                              <div className={css.gaugeFill} style={{ width: `${String(part.percent)}%` }} />
                            </div>
                          </div>
                          <span className={css.recentTokens}>{formatTokens(part.tokens)} · {part.percent}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.billing.length > 0 && (
                    <div className={css.analysisBlock}>
                      <span className={css.analysisLabel}>
                        计费明细{analysis.cacheHit !== null && ` · 缓存命中 ${analysis.cacheHit}%`}
                      </span>
                      <div className={css.billingGrid}>
                        {analysis.billing.map(part => (
                          <div key={part.label} className={css.miniItem}>
                            <span className={css.miniValue}>{formatTokens(part.tokens)}</span>
                            <span className={css.miniLabel}>{part.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        </section>
      )}

      {section === 'about' && (
        <section className={css.body}>
          <div className={css.aboutCard}>
            <p className={css.aboutIntro}>
              你好面板是一个客户端插件，通过 <code>conversation.view</code> 插槽注册为一个对话
              Tab 页。它不依赖任何后端服务，所有指标都从框架标准数据实时派生。
            </p>

            <div className={css.aboutSection}>
              <span className={css.aboutSectionTitle}>面板能力</span>
              <ul className={css.capList}>
                <li className={css.capItem}>
                  <span className={css.capName}>概览</span>
                  <span className={css.capDesc}>当前会话上下文占用、会话总量统计、近 7 天活跃度趋势</span>
                </li>
                <li className={css.capItem}>
                  <span className={css.capName}>功能</span>
                  <span className={css.capDesc}>全部会话 Token 花费排行、当前会话上下文详细分析</span>
                </li>
              </ul>
            </div>

            <div className={css.aboutSection}>
              <span className={css.aboutSectionTitle}>运行信息</span>
              <dl className={css.infoGrid}>
                <div className={css.infoRow}>
                  <dt className={css.infoKey}>插件</dt>
                  <dd className={css.infoVal}><code>dsh-pet-panel</code></dd>
                </div>
                <div className={css.infoRow}>
                  <dt className={css.infoKey}>挂载插槽</dt>
                  <dd className={css.infoVal}><code>conversation.view</code></dd>
                </div>
                <div className={css.infoRow}>
                  <dt className={css.infoKey}>数据来源</dt>
                  <dd className={css.infoVal}>useSessions · token-meter 投影</dd>
                </div>
                <div className={css.infoRow}>
                  <dt className={css.infoKey}>当前会话</dt>
                  <dd className={css.infoVal}>{current?.displayTitle ?? '—'}</dd>
                </div>
                {current?.agentPreset !== undefined && (
                  <div className={css.infoRow}>
                    <dt className={css.infoKey}>Agent 预设</dt>
                    <dd className={css.infoVal}>{current.agentPreset}</dd>
                  </div>
                )}
                {current?.cwd !== undefined && (
                  <div className={css.infoRow}>
                    <dt className={css.infoKey}>工作目录</dt>
                    <dd className={`${css.infoVal} ${css.infoMono}`}>{current.cwd}</dd>
                  </div>
                )}
                <div className={css.infoRow}>
                  <dt className={css.infoKey}>会话 ID</dt>
                  <dd className={`${css.infoVal} ${css.infoMono}`}>{sessionId}</dd>
                </div>
              </dl>
            </div>

            <div className={css.tagRow}>
              <span className={css.featTag}>纯派生 · 不自建订阅</span>
              <span className={css.featTag}>主题 token 适配明暗</span>
              <span className={css.featTag}>useMemo 缓存</span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
