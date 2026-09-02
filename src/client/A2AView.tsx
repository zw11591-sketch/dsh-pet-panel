/** A2A 管理面板：配置自己的 Agent Card + 注册外部 agent（通过 card 端点）。
 *  Phase 1 只做配置持久化（per-profile a2a-agents.json），实际网络调用留待 Phase 2/3。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { A2ACard, A2AConfig, A2AExternalAgent } from './remote.ts'
import css from './A2AView.module.css'

/** The host-face a2aConfig remote, wrapped into promise helpers. */
export interface A2AApi {
  get: () => Promise<A2AConfig>
  setCard: (card: A2ACard) => Promise<{ card: A2ACard }>
  upsertAgent: (agent: A2AExternalAgent) => Promise<{ name: string }>
  delete: (name: string) => Promise<{ name: string }>
}

type A2AViewProps = ConvViewProps & PropsLocale<'dashboard'> & { api: A2AApi }

/** 逗号/中文逗号/换行分隔 → 字符串数组。 */
function splitTags(text: string): string[] {
  return text.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
}

export default function A2AView(props: A2AViewProps): React.JSX.Element {
  const { api } = props

  // 当前实例的 origin（webServer 的 A2A 路由就挂在这个 origin 上，从任意端口访问都自动正确）。
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const cardUrl = origin ? `${origin}/.well-known/agent-card.json` : ''
  const messageUrl = origin ? `${origin}/a2a` : ''

  const [config, setConfig] = useState<A2AConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const toastTimer = useRef<number | null>(null)

  const [cardForm, setCardForm] = useState({ name: '', description: '', capabilitiesText: '' })
  const [agentForm, setAgentForm] = useState({ name: '', url: '', description: '', capabilitiesText: '', keywordsText: '', examplesText: '' })

  // 固定顶部 toast：滚动页面也不影响看到操作反馈；成功 3.5s / 失败 6s 自动消失。
  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3500)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const c = await api.get()
      setConfig(c)
      setCardForm({ name: c.card.name, description: c.card.description, capabilitiesText: c.card.capabilities.join(', ') })
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    }
  }, [api, showToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveCard = useCallback(async () => {
    if (!cardForm.name.trim()) {
      showToast('error', 'agent 名称不能为空')
      return
    }
    setBusy(true)
    try {
      await api.setCard({
        name: cardForm.name.trim(),
        description: cardForm.description,
        capabilities: splitTags(cardForm.capabilitiesText),
      })
      showToast('success', '已保存「我的 Agent Card」')
      await refresh()
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, cardForm, refresh, showToast])

  const upsert = useCallback(async () => {
    if (!agentForm.name.trim() || !agentForm.url.trim()) {
      showToast('error', '外部 agent 的 name 和 url 都不能为空')
      return
    }
    setBusy(true)
    try {
      await api.upsertAgent({
        name: agentForm.name.trim(),
        url: agentForm.url.trim(),
        description: agentForm.description,
        capabilities: splitTags(agentForm.capabilitiesText),
        keywords: splitTags(agentForm.keywordsText),
        examples: splitTags(agentForm.examplesText),
      })
      setAgentForm({ name: '', url: '', description: '', capabilitiesText: '', keywordsText: '', examplesText: '' })
      showToast('success', '已注册外部 agent')
      await refresh()
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, agentForm, refresh, showToast])

  const editAgent = useCallback((a: A2AExternalAgent) => {
    setAgentForm({
      name: a.name,
      url: a.url,
      description: a.description,
      capabilitiesText: a.capabilities.join(', '),
      keywordsText: (a.keywords ?? []).join(', '),
      examplesText: (a.examples ?? []).join(', '),
    })
  }, [])

  const removeAgent = useCallback(async (name: string) => {
    if (!window.confirm(`确定删除外部 agent「${name}」？`)) return
    setBusy(true)
    try {
      await api.delete(name)
      showToast('success', '已删除外部 agent')
      await refresh()
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, refresh, showToast])

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('success', `已复制：${text}`)
    } catch {
      showToast('error', '复制失败，请手动复制')
    }
  }, [showToast])

  const setCard = (k: string, v: string) => setCardForm((f) => ({ ...f, [k]: v }))
  const setAgent = (k: string, v: string) => setAgentForm((f) => ({ ...f, [k]: v }))

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h2 className={css.title}>A2A 管理</h2>
        <p className={css.subtitle}>配置自己的 Agent Card，并注册外部 agent（通过 card 端点发现）。</p>
      </header>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>我的 Agent Card</span>
          <button className={css.saveButton} onClick={() => void saveCard()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
        <label className={css.field}>
          <span className={css.label}>name（对外暴露的 agent 名称）</span>
          <input className={css.input} value={cardForm.name} onChange={(e) => setCard('name', e.target.value)} placeholder="叠纸游戏-Papergames" />
        </label>
        <label className={css.field}>
          <span className={css.label}>description（对外暴露的 agent 描述）</span>
          <textarea className={css.textarea} value={cardForm.description} onChange={(e) => setCard('description', e.target.value)} placeholder="叠纸游戏的 AI agent，擅长……" />
        </label>
        <label className={css.field}>
          <span className={css.label}>capabilities（逗号分隔的能力标签）</span>
          <input className={css.input} value={cardForm.capabilitiesText} onChange={(e) => setCard('capabilitiesText', e.target.value)} placeholder="web_search, research, code" />
        </label>
      </section>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>对外端点</span>
        </div>
        <p className={css.endpointHint}>保存 Agent Card 后，外部 agent 通过以下端点发现并调用本 agent：</p>
        <div className={css.endpointRow}>
          <span className={css.endpointLabel}>Agent Card 端点</span>
          <code className={css.endpointUrl}>{cardUrl}</code>
          <button className={css.ghostButton} onClick={() => void copy(cardUrl)} disabled={!cardUrl}>复制</button>
        </div>
        <div className={css.endpointRow}>
          <span className={css.endpointLabel}>消息收发端点</span>
          <code className={css.endpointUrl}>{messageUrl}</code>
          <button className={css.ghostButton} onClick={() => void copy(messageUrl)} disabled={!messageUrl}>复制</button>
        </div>
      </section>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>外部 Agent</span>
        </div>

        {config && config.agents.length === 0 ? (
          <p className={css.empty}>还没有注册外部 agent。在下方表单填写后点「注册 / 更新」。</p>
        ) : (
          <ul className={css.agentList}>
            {config?.agents.map((a) => (
              <li key={a.name} className={css.agentItem}>
                <div className={css.agentMain}>
                  <span className={css.agentName}>{a.name}</span>
                  <span className={css.agentMeta}>{a.url}</span>
                </div>
                {a.description && <span className={css.agentDesc}>{a.description}</span>}
                <div className={css.agentRow}>
                  {a.capabilities.map((c) => <span key={c} className={css.tag}>{c}</span>)}
                  <span className={css.spacer} />
                  <button className={css.ghostButton} onClick={() => editAgent(a)}>编辑</button>
                  <button className={css.dangerButton} onClick={() => void removeAgent(a.name)} disabled={busy}>删除</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className={css.formGrid}>
          <label className={css.field}>
            <span className={css.label}>name（注册名，供 a2a_call 引用）</span>
            <input className={css.input} value={agentForm.name} onChange={(e) => setAgent('name', e.target.value)} placeholder="researcher" />
          </label>
          <label className={css.field}>
            <span className={css.label}>url（agent card 端点）</span>
            <input className={css.input} value={agentForm.url} onChange={(e) => setAgent('url', e.target.value)} placeholder="http://host:port/.well-known/agent-card.json" />
          </label>
          <label className={css.field}>
            <span className={css.label}>description（可选）</span>
            <input className={css.input} value={agentForm.description} onChange={(e) => setAgent('description', e.target.value)} />
          </label>
          <label className={css.field}>
            <span className={css.label}>capabilities（逗号分隔，可选）</span>
            <input className={css.input} value={agentForm.capabilitiesText} onChange={(e) => setAgent('capabilitiesText', e.target.value)} placeholder="web_search, research" />
          </label>
          <label className={css.field}>
            <span className={css.label}>keywords（触发词，逗号分隔，可选）</span>
            <input className={css.input} value={agentForm.keywordsText} onChange={(e) => setAgent('keywordsText', e.target.value)} placeholder="法律, 合同, 法规" />
          </label>
          <label className={css.field}>
            <span className={css.label}>examples（示例任务，逗号分隔，可选）</span>
            <input className={css.input} value={agentForm.examplesText} onChange={(e) => setAgent('examplesText', e.target.value)} placeholder="审查合同条款, 检索法规" />
          </label>
        </div>
        <div className={css.actions}>
          <button className={css.saveButton} onClick={() => void upsert()} disabled={busy}>
            {busy ? '注册中…' : '注册 / 更新'}
          </button>
        </div>
      </section>

      {toast && typeof document !== 'undefined' && createPortal(
        <div className={css.toastWrap} role="status" aria-live="polite">
          <div className={`${css.toast} ${toast.kind === 'error' ? css.toastError : ''}`}>
            <span>{toast.kind === 'success' ? '✓' : '⚠'}</span>
            <span>{toast.text}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
