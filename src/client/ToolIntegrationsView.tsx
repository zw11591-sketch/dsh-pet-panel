/** 工具集成：MCP 服务器增删改查。配置持久化到 ~/.dsh/mcp-servers.json，
 *  保存后 host 侧热替换挂载，agent 立即获得对应工具。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ToolIntegrationsView.module.css'

/** One MCP server config, mirroring the host-side McpConfig. */
export interface McpConfig {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

export interface McpSummary extends McpConfig {
  mounted: boolean
}

/** The host-face toolIntegrations remote, wrapped into promise helpers. */
export interface McpApi {
  list: () => Promise<{ items: McpSummary[] }>
  read: (serverName: string) => Promise<{ config: McpConfig }>
  write: (config: McpConfig) => Promise<{ serverName: string }>
  delete: (serverName: string) => Promise<{ serverName: string }>
}

type ToolIntegrationsViewProps = ConvViewProps & PropsLocale<'dashboard'> & { api: McpApi }

/** key=value 每行 → 对象。 */
function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

/** 对象 → key=value 每行。 */
function stringifyPairs(obj: Record<string, string> | undefined): string {
  if (!obj) return ''
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n')
}

export default function ToolIntegrationsView(props: ToolIntegrationsViewProps): React.JSX.Element {
  const { api } = props

  const [items, setItems] = useState<McpSummary[]>([])
  const [editing, setEditing] = useState<McpConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 错误 toast 自动消失。
  useEffect(() => {
    if (!error) return
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 6000)
    return () => { if (errorTimer.current) clearTimeout(errorTimer.current) }
  }, [error])

  // 表单临时字段（args/env/headers 用文本区，保存时解析）
  const [form, setForm] = useState({
    serverName: '',
    transport: 'stdio' as 'stdio' | 'streamable-http',
    command: '',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
  })

  const refresh = useCallback(async () => {
    try {
      const r = await api.list()
      setItems(r.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startNew = useCallback(() => {
    setEditing(null)
    setForm({ serverName: '', transport: 'stdio', command: '', argsText: '', envText: '', cwd: '', url: '', headersText: '' })
    setError(null)
  }, [])

  const startEdit = useCallback(async (serverName: string) => {
    setError(null)
    try {
      const r = await api.read(serverName)
      const c = r.config
      setEditing(c)
      setForm({
        serverName: c.serverName,
        transport: c.transport,
        command: c.command ?? '',
        argsText: (c.args ?? []).join('\n'),
        envText: stringifyPairs(c.env),
        cwd: c.cwd ?? '',
        url: c.url ?? '',
        headersText: stringifyPairs(c.headers),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  const save = useCallback(async () => {
    const serverName = form.serverName.trim()
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
      setError('serverName 非法：仅允许字母/数字/连字符/下划线（1-32 字符）。')
      return
    }
    const config: McpConfig = {
      serverName,
      transport: form.transport,
    }
    if (form.transport === 'stdio') {
      if (form.command.trim()) config.command = form.command.trim()
      const args = form.argsText.split('\n').map((s) => s.trim()).filter(Boolean)
      if (args.length) config.args = args
      const env = parsePairs(form.envText)
      if (Object.keys(env).length) config.env = env
      if (form.cwd.trim()) config.cwd = form.cwd.trim()
    } else {
      if (form.url.trim()) config.url = form.url.trim()
      const headers = parsePairs(form.headersText)
      if (Object.keys(headers).length) config.headers = headers
    }
    setBusy(true)
    setError(null)
    try {
      await api.write(config)
      setEditing(config)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, form, refresh])

  const remove = useCallback(async (serverName: string) => {
    if (!window.confirm(`确定删除 MCP 服务器「${serverName}」？其工具将立即失效。`)) return
    setBusy(true)
    setError(null)
    try {
      await api.delete(serverName)
      if (editing?.serverName === serverName) startNew()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, editing, refresh, startNew])

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h2 className={css.title}>工具集成</h2>
        <p className={css.subtitle}>通过 MCP 协议接入外部工具，保存后 agent 立即可调用。</p>
      </header>

      <div className={css.layout}>
        <aside className={css.sidebar}>
          <div className={css.sidebarHead}>
            <span className={css.sidebarTitle}>MCP 服务器</span>
            <button className={css.newButton} onClick={startNew} disabled={busy}>＋ 新建</button>
          </div>
          {items.length === 0 ? (
            <div className={css.emptyWrap}>
              <span className={css.emptyIcon}>🔌</span>
              <p className={css.empty}>还没有 MCP 服务器。点「新建」接入第一个。</p>
            </div>
          ) : (
            <ul className={css.list}>
              {items.map((item) => (
                <li key={item.serverName} className={item.serverName === editing?.serverName ? css.itemActive : css.item} onClick={() => void startEdit(item.serverName)}>
                  <div className={css.itemMain}>
                    <span className={css.itemName}>{item.serverName}</span>
                    <span className={`${css.statusBadge} ${item.mounted ? css.statusOn : css.statusOff}`}>
                      <span className={css.statusDot} />
                      {item.mounted ? '已挂载' : '未挂载'}
                    </span>
                  </div>
                  <span className={css.itemMeta}>{item.transport}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className={css.form}>
          <div className={css.formHead}>
            <span className={css.formTitle}>{editing ? `编辑 ${editing.serverName}` : '新建 MCP 服务器'}</span>
          </div>

          <label className={css.field}>
            <span className={css.label}>serverName</span>
            <input className={css.input} value={form.serverName} onChange={(e) => set('serverName', e.target.value)} disabled={editing !== null} placeholder="my-server" />
          </label>

          <label className={css.field}>
            <span className={css.label}>transport</span>
            <select className={css.input} value={form.transport} onChange={(e) => set('transport', e.target.value)}>
              <option value="stdio">stdio</option>
              <option value="streamable-http">streamable-http</option>
            </select>
          </label>

          {form.transport === 'stdio' ? (
            <>
              <label className={css.field}>
                <span className={css.label}>command</span>
                <input className={css.input} value={form.command} onChange={(e) => set('command', e.target.value)} placeholder="npx" />
              </label>
              <label className={css.field}>
                <span className={css.label}>args（每行一个）</span>
                <textarea className={css.textarea} value={form.argsText} onChange={(e) => set('argsText', e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-github'} />
              </label>
              <label className={css.field}>
                <span className={css.label}>env（key=value 每行）</span>
                <textarea className={css.textarea} value={form.envText} onChange={(e) => set('envText', e.target.value)} placeholder={'GITHUB_TOKEN=xxx'} />
              </label>
              <label className={css.field}>
                <span className={css.label}>cwd（可选）</span>
                <input className={css.input} value={form.cwd} onChange={(e) => set('cwd', e.target.value)} placeholder="/path/to/working-dir" />
              </label>
            </>
          ) : (
            <>
              <label className={css.field}>
                <span className={css.label}>url</span>
                <input className={css.input} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="http://localhost:3000/mcp" />
              </label>
              <label className={css.field}>
                <span className={css.label}>headers（key=value 每行，可选）</span>
                <textarea className={css.textarea} value={form.headersText} onChange={(e) => set('headersText', e.target.value)} placeholder={'Authorization=Bearer xxx'} />
              </label>
            </>
          )}

          <div className={css.actions}>
            {editing && (
              <button className={css.dangerButton} onClick={() => void remove(editing.serverName)} disabled={busy}>删除</button>
            )}
            <button className={css.saveButton} onClick={() => void save()} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </section>
      </div>

      {error && typeof document !== 'undefined' && createPortal(
        <div className={css.toastWrap} role="status" aria-live="polite">
          <div className={`${css.toast} ${css.toastError}`}>
            <span>⚠</span>
            <span>{error}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
