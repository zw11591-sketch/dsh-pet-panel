/** 技能工坊：skill 的增删改查页面。读写当前 profile 的 skills/<name>/SKILL.md（per-profile 隔离）。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillForgeView.module.css'

/** One skill summary returned by skillForge.list. */
export interface SkillSummary {
  name: string
  title: string
  description: string
}

/** The host-face skillForge remote, wrapped into promise-returning helpers. */
export interface SkillApi {
  list: () => Promise<{ items: SkillSummary[] }>
  read: (name: string) => Promise<{ name: string; content: string }>
  write: (name: string, content: string) => Promise<{ name: string }>
  delete: (name: string) => Promise<{ name: string }>
  generate: (description: string) => Promise<{ content: string }>
}

type SkillForgeViewProps = ConvViewProps & PropsLocale<'dashboard'> & { api: SkillApi }

/** Default SKILL.md skeleton for a new skill. */
function skeleton(name: string): string {
  return `---\nname: ${name}\ndescription: 描述这个 skill 的用途。\n---\n\n# ${name}\n\n在这里编写 skill 的说明与使用指引。\n`
}

export default function SkillForgeView(props: SkillForgeViewProps): React.JSX.Element {
  const { api } = props

  const [items, setItems] = useState<SkillSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
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

  const select = useCallback(async (name: string) => {
    setSelected(name)
    setError(null)
    try {
      const r = await api.read(name)
      setContent(r.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  const create = useCallback(() => {
    setSelected('__new__')
    setContent(skeleton('my-skill'))
    setError(null)
  }, [])

  const save = useCallback(async () => {
    if (selected === null) return
    const m = /^---\s*\n([\s\S]*?)\n---/.exec(content)
    const name = m ? (/^name:\s*(.+)$/m.exec(m[1])?.[1] ?? '').trim() : ''
    if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      setError('skill name 非法：frontmatter 需含 `name:`，且仅允许字母/数字/连字符/下划线（1-64 字符）。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.write(name, content)
      setSelected(name)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, content, selected, refresh])

  const remove = useCallback(async (name: string) => {
    if (!window.confirm(`确定删除 skill「${name}」？此操作不可撤销。`)) return
    setBusy(true)
    setError(null)
    try {
      await api.delete(name)
      if (selected === name) {
        setSelected(null)
        setContent('')
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, selected, refresh])

  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [genInput, setGenInput] = useState('')
  const [genOutput, setGenOutput] = useState('')
  const [genBusy, setGenBusy] = useState(false)

  useEffect(() => {
    return () => { if (genTimer.current) clearTimeout(genTimer.current) }
  }, [])

  const generate = useCallback(async () => {
    const desc = genInput.trim()
    if (!desc || genBusy) return
    setGenBusy(true)
    setGenOutput('')
    setError(null)
    try {
      const r = await api.generate(desc)
      const full = r.content
      // typewriter 逐字显示，模拟流式滚动
      let i = 0
      const step = () => {
        setGenOutput(full.slice(0, i))
        if (i >= full.length) {
          setContent(full)
          setSelected('__generated__')
          setGenBusy(false)
          return
        }
        i = Math.min(full.length, i + 4)
        genTimer.current = setTimeout(step, 10)
      }
      step()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGenBusy(false)
    }
  }, [api, genInput, genBusy])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h2 className={css.title}>技能工坊</h2>
        <p className={css.subtitle}>管理当前 profile 的技能（SKILL.md），保存后 agent 立即生效。</p>
      </header>

      <div className={css.generate}>
        <div className={css.generateHead}>
          <span className={css.generateTitle}>✨ 智能生成</span>
          <span className={css.generateHint}>用一句话描述，自动生成完整 SKILL.md</span>
        </div>
        <div className={css.generateRow}>
          <textarea
            className={css.generateInput}
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder="例如：一个查询天气的 skill，输入城市名返回天气信息"
            rows={2}
            disabled={genBusy}
          />
          <button
            className={css.generateButton}
            onClick={() => void generate()}
            disabled={genBusy || !genInput.trim()}
          >
            {genBusy ? '生成中…' : '生成'}
          </button>
        </div>
        {genOutput && (
          <pre className={css.generateOutput}>{genOutput}{genBusy ? '▌' : ''}</pre>
        )}
      </div>

      <div className={css.layout}>
        <aside className={css.sidebar}>
          <div className={css.sidebarHead}>
            <span className={css.sidebarTitle}>技能列表</span>
            <button className={css.newButton} onClick={create} disabled={busy}>＋ 新建</button>
          </div>
          {items.length === 0 ? (
            <div className={css.emptyWrap}>
              <span className={css.emptyIcon}>🗂️</span>
              <p className={css.empty}>还没有 skill。点「新建」创建第一个。</p>
            </div>
          ) : (
            <ul className={css.list}>
              {items.map((item) => (
                <li key={item.name} className={item.name === selected ? css.itemActive : css.item} onClick={() => void select(item.name)}>
                  <div className={css.itemMain}>
                    <span className={css.itemName}>{item.title || item.name}</span>
                    <span className={css.itemMeta}>{item.name}</span>
                  </div>
                  {item.description && <span className={css.itemDesc}>{item.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className={css.editor}>
          {selected === null ? (
            <p className={css.placeholder}>从左侧选择一个 skill，或「新建」一个。</p>
          ) : (
            <>
              <div className={css.editorHead}>
                <span className={css.editorPath}>{selected === '__new__' ? '新技能' : selected === '__generated__' ? '智能生成结果' : `${selected}/SKILL.md`}</span>
                <div className={css.editorActions}>
                  {selected !== '__new__' && selected !== '__generated__' && (
                    <button className={css.dangerButton} onClick={() => void remove(selected)} disabled={busy}>删除</button>
                  )}
                  <button className={css.saveButton} onClick={() => void save()} disabled={busy}>
                    {busy ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
              <textarea
                className={css.textarea}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                placeholder="# SKILL.md 内容"
              />
            </>
          )}
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
