import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { access, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Service } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'

// ---- 路径与校验 ----

/** skill 目录名：只允许字母/数字/连字符/下划线，防路径穿越。 */
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

function assertName(name: string): void {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`invalid name: ${JSON.stringify(name)}`)
  }
}

function skillRoot(): string {
  const profile = profileNameFromArgv(process.argv)
  return profile ? dshHomePath('profiles', profile, 'skills') : dshHomePath('skills')
}

function skillDir(name: string): string {
  assertName(name)
  return join(skillRoot(), name)
}

function skillFile(name: string): string {
  return join(skillDir(name), 'SKILL.md')
}

/** 从 SKILL.md frontmatter 提取 name/description（容错，无则回退文件名）。 */
function parseFrontmatter(content: string): { title: string; description: string } {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(content)
  const title = m ? (/^name:\s*(.+)$/m.exec(m[1])?.[1] ?? '') : ''
  const description = m ? (/^description:\s*(.+)$/m.exec(m[1])?.[1] ?? '') : ''
  return { title: title.trim(), description: description.trim() }
}

// ---- Skill Forge（技能工坊）----

/** 单条执行事件（扁平事件流，前端按 turn/step 分组渲染）。 */
export interface LifecycleEvent {
  seq: number
  time: number
  kind: string
  turn?: number
  step?: number
  text?: string
  toolName?: string
  toolArgs?: string
  isError?: boolean
  outcome?: string
  reason?: string
  todos?: Array<{ content: string; status: string }>
}

/** 一个会话的完整执行轨迹快照。 */
export interface LifecycleSnapshot {
  title: string
  turns: number
  steps: number
  toolCalls: number
  approvals: number
  todoWrites: number
  startedAt: number
  endedAt: number
  events: LifecycleEvent[]
}

/** zstd 多帧逐帧解压（dsh 每个写入批次一个 frame；单帧 API 只解第一帧）。 */
function decompressZstdFrames(buf: Buffer): string {
  const positions: number[] = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
      positions.push(i)
    }
  }
  if (positions.length === 0) return ''
  positions.push(buf.length)
  const parts: string[] = []
  for (let i = 0; i < positions.length - 1; i++) {
    try {
      parts.push(zstdDecompressSync(buf.subarray(positions[i], positions[i + 1])).toString('utf8'))
    } catch {
      // 跳过坏帧
    }
  }
  return parts.join('\n')
}

/** 扫描 sessions 目录，找到指定会话的日志文件。 */
async function findSessionFile(sessionId: string): Promise<string | null> {
  const root = dshHomePath('sessions')
  let workspaces: string[] = []
  try {
    const entries = await readdir(root, { withFileTypes: true })
    workspaces = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return null
  }
  for (const ws of workspaces) {
    const f = join(root, ws, sessionId, 'session.jsonl.zstd')
    try {
      await access(f)
      return f
    } catch {
      // 继续找
    }
  }
  return null
}

/** 从消息 content blocks 提取 text 文本。 */
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text ?? '')
    .join('\n')
    .trim()
}

/** 从 tool-result 消息提取结果文本与错误标记。 */
function extractToolResult(content: unknown): { text: string; isError: boolean } {
  if (!Array.isArray(content)) return { text: '', isError: false }
  const tr = content.find((b: any) => b?.type === 'tool-result')
  if (!tr) return { text: '', isError: false }
  const inner = Array.isArray(tr.content) ? tr.content : []
  const text = inner
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text ?? '')
    .join('\n')
    .trim()
  return { text, isError: tr.isError === true }
}

function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n)}…` : s
}

/** 剥掉值为 undefined 的字段。
 *  Typert 边界校验要求结果 JSON-safe：zod `.optional()` 解析后仍保留
 *  `undefined` 自有属性，会让 `assertJsonValue` 抛「undefined is not JSON-safe」，
 *  进而被包成 "business result failed boundary validation"。 */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

class SkillForgeGateway extends TypertRemoteService {
  static inject = ['llm', 'agentDefaultModel']

  private llm: any
  private agentDefaultModel: any

  constructor(ctx: any) {
    super(ctx, 'skillForge')
    this.llm = ctx.llm
    this.agentDefaultModel = ctx.agentDefaultModel
  }

  @Remote('list')
  async list(): Promise<{ items: Array<{ name: string; title: string; description: string }> }> {
    const root = skillRoot()
    let names: string[] = []
    try {
      const entries = await readdir(root, { withFileTypes: true })
      names = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return { items: [] } // 目录尚不存在
    }
    const items = await Promise.all(
      names.map(async (name) => {
        try {
          const content = await readFile(skillFile(name), 'utf8')
          const { title, description } = parseFrontmatter(content)
          return { name, title: title || name, description }
        } catch {
          return { name, title: name, description: '' }
        }
      }),
    )
    items.sort((a, b) => a.name.localeCompare(b.name))
    return { items }
  }

  @Remote('read')
  async read(name: string): Promise<{ name: string; content: string }> {
    assertName(name)
    const content = await readFile(skillFile(name), 'utf8')
    return { name, content }
  }

  @Remote('write')
  async write(name: string, content: string): Promise<{ name: string }> {
    assertName(name)
    await mkdir(skillDir(name), { recursive: true })
    await writeFile(skillFile(name), content, 'utf8')
    return { name }
  }

  @Remote('delete')
  async delete(name: string): Promise<{ name: string }> {
    assertName(name)
    await rm(skillDir(name), { recursive: true, force: true })
    return { name }
  }

  /** 智能生成：根据自然语言描述，用当前默认模型生成一个 SKILL.md。 */
  @Remote('generate')
  async generate(description: string): Promise<{ content: string }> {
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('描述不能为空')
    }

    // 用当前默认模型（agent-default-model）。不能盲取 providers[0]：
    // 那可能是余额不足/未配置的 provider（如 deepseek），导致调用失败。
    let provider: string
    let model: string
    try {
      const sel = this.agentDefaultModel.currentSelection()
      provider = sel?.provider
      model = sel?.model
    } catch {
      provider = ''
      model = ''
    }
    if (!provider || !model) {
      // fallback：取第一个已注册 provider 的第一个模型
      const providers = this.llm.listProviders()
      if (!providers || providers.length === 0) {
        throw new Error('没有已配置的 LLM provider，请先在设置里配置模型。')
      }
      provider = providers[0].id
      const models = await this.llm.listModels(provider)
      if (!models || models.length === 0) {
        throw new Error(`provider ${provider} 没有可用模型。`)
      }
      model = models[0].id
    }

    const system = [
      '你是一个 skill 生成器。根据用户描述，生成一个 DeepSeek Harness 规范的 SKILL.md 文件。',
      '',
      'SKILL.md 格式要求：',
      '- YAML frontmatter：`name`（小写连字符，如 weather-query）、`description`（一句话，含触发场景）',
      '- 正文：Markdown，说明用途、使用步骤、关键命令或示例',
      '- name 仅允许字母/数字/连字符/下划线（1-64 字符）',
      '- 内容要具体、可执行，不要泛泛而谈',
      '',
      '只输出 SKILL.md 的内容（从 `---` 开始），不要任何解释、不要用代码块包裹。',
    ].join('\n')

    const user = `请根据以下描述生成一个 skill：\n\n${description.trim()}`

    const messages = [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: user }],
      source: { kind: 'user' },
    }]

    const chunks = this.llm.stream({
      provider,
      model,
      system,
      messages,
      temperature: 0.3,
    })

    let text = ''
    let failure: { message?: string; code?: string; status?: number } | null = null
    for await (const chunk of chunks) {
      if (chunk && chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk && chunk.type === 'finish') {
        const reason = chunk.reason as any
        if (reason && (reason.kind === 'error' || reason.kind === 'aborted')) {
          failure = reason.failure ?? null
        }
      }
    }
    if (failure) {
      const code = failure.code ? `（${failure.code}）` : ''
      const status = failure.status ? ` HTTP ${failure.status}` : ''
      throw new Error(`模型调用失败：${failure.message ?? '未知错误'}${code}${status}`)
    }
    if (!text.trim()) {
      throw new Error('生成失败：模型没有返回内容。')
    }
    return { content: text.trim() }
  }

  /** 读取一个会话的完整执行轨迹（turn → step → 工具调用/消息/审批）。 */
  @Remote('lifecycle')
  async lifecycle(sessionId: string): Promise<LifecycleSnapshot> {
    if (typeof sessionId !== 'string' || !/^session-[A-Za-z0-9-]+$/.test(sessionId)) {
      throw new Error(`invalid session id: ${sessionId}`)
    }
    const file = await findSessionFile(sessionId)
    if (!file) throw new Error(`找不到会话日志：${sessionId}`)

    const buf = await readFile(file)
    const text = decompressZstdFrames(buf)

    const events: LifecycleEvent[] = []
    let title = ''
    let turns = 0
    let steps = 0
    let toolCalls = 0
    let approvals = 0
    let todoWrites = 0
    let startedAt = 0
    let endedAt = 0

    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let rec: any
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      const time = typeof rec.time === 'number' ? rec.time : 0
      if (startedAt === 0) startedAt = time
      if (time > 0) endedAt = time
      const d = rec.data ?? {}
      const turn = typeof d.turn === 'number' ? d.turn : undefined
      const step = typeof d.step === 'number' ? d.step : undefined

      switch (rec.type) {
        case 'session/title':
          title = typeof d.title === 'string' ? d.title : title
          break
        case 'turn/start':
          if (turn !== undefined) turns = Math.max(turns, turn)
          events.push(compact({ seq: rec.seq, time, kind: 'turn-start', turn }))
          break
        case 'turn/end':
          events.push(compact({ seq: rec.seq, time, kind: 'turn-end', turn }))
          break
        case 'step/start':
          steps++ // 总步数 = 全部 step/start 事件（step 号每轮重置，不能 Math.max）
          events.push(compact({ seq: rec.seq, time, kind: 'step-start', turn, step }))
          break
        case 'step/end':
          events.push(compact({ seq: rec.seq, time, kind: 'step-end', turn, step }))
          break
        case 'user/message': {
          const t = extractText(d.content)
          if (t) events.push(compact({ seq: rec.seq, time, kind: 'user', turn, step, text: truncate(t, 400) }))
          break
        }
        case 'assistant/message': {
          const blocks = Array.isArray(d.message?.content) ? d.message.content : []
          const tb = blocks.find((b: any) => b?.type === 'text')
          if (tb?.text) events.push(compact({ seq: rec.seq, time, kind: 'assistant', turn, step, text: truncate(tb.text, 400) }))
          break
        }
        case 'tool/call':
          toolCalls++
          events.push(compact({
            seq: rec.seq,
            time,
            kind: 'tool-call',
            turn,
            step,
            toolName: typeof d.name === 'string' ? d.name : undefined,
            toolArgs: truncate(typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments ?? {}), 200),
          }))
          break
        case 'tool/result': {
          const r = extractToolResult(d.message?.content)
          const isErr = r.isError || rec.error != null
          events.push(compact({ seq: rec.seq, time, kind: 'tool-result', turn, step, text: truncate(r.text, 400), isError: isErr }))
          break
        }
        case 'approval/asked':
          approvals++
          events.push(compact({ seq: rec.seq, time, kind: 'approval-asked', turn, step, toolName: typeof d.toolName === 'string' ? d.toolName : undefined, reason: truncate(d.reason ?? '', 200) }))
          break
        case 'approval/decided':
          events.push(compact({ seq: rec.seq, time, kind: 'approval-decided', turn, step, outcome: typeof d.outcome === 'string' ? d.outcome : undefined }))
          break
        case 'todo/write':
          todoWrites++
          events.push(compact({
            seq: rec.seq, time, kind: 'todo', turn, step,
            todos: Array.isArray(d.todos)
              ? d.todos
                  .filter((t: any) => t && typeof t.content === 'string' && typeof t.status === 'string')
                  .map((t: any) => ({ content: t.content, status: t.status }))
              : undefined,
          }))
          break
      }
    }

    return compact({ title, turns, steps, toolCalls, approvals, todoWrites, startedAt, endedAt, events })
  }
}

// ---- Tool Integrations（工具集成 / MCP）----

const MCP_FILE = () => {
  const profile = profileNameFromArgv(process.argv)
  return profile ? dshHomePath('profiles', profile, 'mcp-servers.json') : dshHomePath('mcp-servers.json')
}
const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

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

export class ToolIntegrationsGateway extends TypertRemoteService {
  static inject = ['loader']

  private loader: any
  private mounted = new Map<string, string>() // serverName -> entry id

  constructor(ctx: any) {
    super(ctx, 'toolIntegrations')
    this.loader = ctx.loader
    // 启动即挂载已配置的 mcp 服务器（异步，不阻塞构造）
    void this.mountAll().catch(() => {})
  }

  private async loadConfigs(): Promise<McpConfig[]> {
    try {
      const raw = await readFile(MCP_FILE(), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private async saveConfigs(configs: McpConfig[]): Promise<void> {
    await mkdir(dshHomePath(''), { recursive: true })
    await writeFile(MCP_FILE(), JSON.stringify(configs, null, 2), 'utf8')
  }

  /** 启动时挂载所有已配置的 mcp 服务器。 */
  async mountAll(): Promise<void> {
    const configs = await this.loadConfigs()
    for (const cfg of configs) {
      const entry = this.entryFor(cfg)
      try {
        const id = await this.loader.create(entry)
        this.mounted.set(cfg.serverName, id)
      } catch (cause) {
        // 单个 mcp 挂载失败不影响其余；交由 UI 展示错误
        this.mounted.delete(cfg.serverName)
      }
    }
  }

  private entryFor(cfg: McpConfig): { id: string; name: string; config: any } {
    const { serverName, ...rest } = cfg
    return {
      id: `mcp-${serverName}`,
      name: MCP_CLIENT,
      config: { serverName, ...rest },
    }
  }

  private async unmount(serverName: string): Promise<void> {
    const id = this.mounted.get(serverName)
    if (id !== undefined) {
      try {
        await this.loader.remove(id)
      } finally {
        this.mounted.delete(serverName)
      }
    }
  }

  @Remote('list')
  async list(): Promise<{ items: Array<McpConfig & { mounted: boolean }> }> {
    const configs = await this.loadConfigs()
    return { items: configs.map((c) => ({ ...c, mounted: this.mounted.has(c.serverName) })) }
  }

  @Remote('read')
  async read(serverName: string): Promise<{ config: McpConfig }> {
    const configs = await this.loadConfigs()
    const cfg = configs.find((c) => c.serverName === serverName)
    if (!cfg) throw new Error(`mcp server not found: ${serverName}`)
    return { config: cfg }
  }

  @Remote('write')
  async write(config: McpConfig): Promise<{ serverName: string }> {
    const configs = await this.loadConfigs()
    const idx = configs.findIndex((c) => c.serverName === config.serverName)
    if (idx >= 0) configs[idx] = config
    else configs.push(config)
    await this.saveConfigs(configs)

    // 热替换：先卸旧再挂新
    await this.unmount(config.serverName)
    try {
      const id = await this.loader.create(this.entryFor(config))
      this.mounted.set(config.serverName, id)
    } catch {
      this.mounted.delete(config.serverName)
    }
    return { serverName: config.serverName }
  }

  @Remote('delete')
  async delete(serverName: string): Promise<{ serverName: string }> {
    const configs = await this.loadConfigs()
    const next = configs.filter((c) => c.serverName !== serverName)
    await this.saveConfigs(next)
    await this.unmount(serverName)
    return { serverName }
  }
}

// ---- A2A（Agent-to-Agent）配置 ----

export interface A2ACard {
  name: string
  description: string
  capabilities: string[]
}

export interface A2AExternalAgent {
  name: string
  url: string
  description: string
  capabilities: string[]
  /** 触发关键词（提高路由命中）：用户任务命中这些词时，应优先路由到该 agent。 */
  keywords?: string[]
  /** 示例任务（提高路由命中）：该 agent 擅长处理的典型任务描述。 */
  examples?: string[]
}

export interface A2AConfig {
  card: A2ACard
  agents: A2AExternalAgent[]
}

const DEFAULT_A2A_CONFIG: A2AConfig = {
  card: { name: '叠纸游戏-Papergames', description: '', capabilities: [] },
  agents: [],
}

/**
 * 从命令行参数解析 --profile <name> / --profile=<name>。
 * dsh 启动 profile 时不 chdir 到 profile 目录，也不暴露 profile 目录给插件，
 * 但 `--profile` 一定在 process.argv 里，据此可确定 profile 名。
 */
function profileNameFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile' && i + 1 < argv.length) return argv[i + 1]
    if (a.startsWith('--profile=')) return a.slice('--profile='.length)
  }
  return null
}

/**
 * A2A 配置目录（per-profile，确定性）。核心：$DSH_HOME/profiles/<name>，
 * 不依赖 process.cwd()——否则「从任意目录 dsh --profile <name>」与
 * 「cd <profile> && dsh」会各自落到全局 home 与 profile 目录，配置分裂成两份。
 */
function a2aConfigDir(): string {
  const profile = profileNameFromArgv(process.argv)
  if (profile) return dshHomePath('profiles', profile)
  // 回退（非 dsh --profile 启动，如直接跑 lib）：旧启发式
  const env = process.env.DSH_PROFILE_DIR
  if (env) return env
  const cwd = process.cwd()
  if (existsSync(join(cwd, 'cordis.yml'))) return cwd
  return dshHomePath('')
}

function a2aConfigFile(): string {
  return join(a2aConfigDir(), 'a2a-agents.json')
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

async function loadA2AConfig(): Promise<A2AConfig> {
  try {
    const raw = await readFile(a2aConfigFile(), 'utf8')
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && p.card && typeof p.card === 'object' && Array.isArray(p.agents)) {
      return {
        card: {
          name: typeof p.card.name === 'string' ? p.card.name : DEFAULT_A2A_CONFIG.card.name,
          description: typeof p.card.description === 'string' ? p.card.description : '',
          capabilities: strArray(p.card.capabilities),
        },
        agents: p.agents
          .filter((a: any) => a && typeof a.name === 'string' && typeof a.url === 'string')
          .map((a: any) => ({
            name: a.name,
            url: a.url,
            description: typeof a.description === 'string' ? a.description : '',
            capabilities: strArray(a.capabilities),
            keywords: strArray(a.keywords),
            examples: strArray(a.examples),
          })),
      }
    }
  } catch {
    // 文件不存在或损坏 → 回退默认
  }
  return JSON.parse(JSON.stringify(DEFAULT_A2A_CONFIG)) as A2AConfig
}

async function saveA2AConfig(config: A2AConfig): Promise<void> {
  await mkdir(a2aConfigDir(), { recursive: true })
  await writeFile(a2aConfigFile(), JSON.stringify(config, null, 2), 'utf8')
}

export class A2AConfigGateway extends TypertRemoteService {
  constructor(ctx: any) {
    super(ctx, 'a2aConfig')
  }

  private load(): Promise<A2AConfig> {
    return loadA2AConfig()
  }

  private save(config: A2AConfig): Promise<void> {
    return saveA2AConfig(config)
  }

  @Remote('get')
  async get(): Promise<A2AConfig> {
    return this.load()
  }

  @Remote('setCard')
  async setCard(card: A2ACard): Promise<{ card: A2ACard }> {
    if (!card || typeof card.name !== 'string' || !card.name.trim()) {
      throw new Error('agent card 的 name 不能为空')
    }
    const normalized: A2ACard = {
      name: card.name.trim(),
      description: typeof card.description === 'string' ? card.description : '',
      capabilities: strArray(card.capabilities),
    }
    const config = await this.load()
    config.card = normalized
    await this.save(config)
    return { card: normalized }
  }

  @Remote('upsertAgent')
  async upsertAgent(externalAgent: A2AExternalAgent): Promise<{ name: string }> {
    if (!externalAgent || typeof externalAgent.name !== 'string' || !externalAgent.name.trim()) {
      throw new Error('外部 agent 的 name 不能为空')
    }
    if (typeof externalAgent.url !== 'string' || !externalAgent.url.trim()) {
      throw new Error('外部 agent 的 url 不能为空')
    }
    const normalized: A2AExternalAgent = {
      name: externalAgent.name.trim(),
      url: externalAgent.url.trim(),
      description: typeof externalAgent.description === 'string' ? externalAgent.description : '',
      capabilities: strArray(externalAgent.capabilities),
      keywords: strArray(externalAgent.keywords),
      examples: strArray(externalAgent.examples),
    }
    const config = await this.load()
    const idx = config.agents.findIndex((a) => a.name === normalized.name)
    if (idx >= 0) config.agents[idx] = normalized
    else config.agents.push(normalized)
    await this.save(config)
    return { name: normalized.name }
  }

  @Remote('delete')
  async delete(name: string): Promise<{ name: string }> {
    if (typeof name !== 'string' || !name.trim()) throw new Error('invalid agent name')
    const config = await this.load()
    config.agents = config.agents.filter((a) => a.name !== name)
    await this.save(config)
    return { name }
  }
}

// ---- A2A outbound 工具（Phase 2）----

/** 去掉 agent-card 路径后缀，得到 JSON-RPC 基址。 */
function a2aBaseUrl(url: string): string {
  return url
    .replace(/\/\.well-known\/agent-card\.json\s*$/i, '')
    .replace(/\/agent-card\.json\s*$/i, '')
    .replace(/\/+$/, '')
}

/** 从 A2A message/send 响应提取 agent 回复文本（兼容 v0.2 Task 与 v0.3 直接 Message）。 */
function extractA2AReply(data: any): string {
  const result = data?.result
  if (!result || typeof result !== 'object') throw new Error('a2a: 响应缺少 result')
  const message = Array.isArray(result.parts)
    ? result
    : result.status?.message ?? result.message ?? null
  const parts = Array.isArray(message?.parts) ? message.parts : []
  const text = parts
    .map((p: any) => (typeof p === 'string' ? p : (p?.text ?? p?.content ?? '')))
    .filter((s: unknown) => typeof s === 'string' && s.length > 0)
    .join('\n')
    .trim()
  if (!text) throw new Error('a2a: 响应中没有文本回复')
  return text
}

/** 向外部 agent 的 JSON-RPC 端点发 message/send，返回回复文本。 */
async function a2aSendMessage(baseUrl: string, text: string): Promise<string> {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/'
  const body = {
    jsonrpc: '2.0',
    method: 'message/send',
    params: { message: { role: 'user', parts: [{ kind: 'text', text }] } },
    id: 1,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  let res: any
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throw new Error(`a2a: 无法连接 ${endpoint}: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`a2a: HTTP ${res.status} ${endpoint}`)
  const data = await res.json().catch(() => { throw new Error('a2a: 响应不是 JSON') })
  return extractA2AReply(data)
}

/** 归一化 agent name：小写、去空格/连字符/下划线/间隔号，消除 LLM 复述时的字符差异。 */
function normalizeAgentName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·]+/g, '')
}

/** 两个字符串的编辑距离（Levenshtein）。 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}

/**
 * 按 精确 → 归一化 → 子串 → 编辑距离 顺序解析目标 agent。
 * 只有「唯一命中」才返回，避免歧义时错路由；否则返回 null 交给 a2a_call 的候选闭环。
 */
function resolveAgent(agents: A2AExternalAgent[], name: string): A2AExternalAgent | null {
  if (!name) return null
  // 1. 精确匹配
  const exact = agents.find((a) => a.name === name)
  if (exact) return exact
  // 2. 归一化匹配（忽略大小写/空格/连字符/下划线）
  const norm = normalizeAgentName(name)
  const normalized = agents.filter((a) => normalizeAgentName(a.name) === norm)
  if (normalized.length === 1) return normalized[0]
  // 3. 子串匹配（任一方向包含）
  const lower = name.toLowerCase()
  const contains = agents.filter((a) => {
    const al = a.name.toLowerCase()
    return al.includes(lower) || lower.includes(al)
  })
  if (contains.length === 1) return contains[0]
  // 4. 编辑距离（阈值内唯一最低分）
  const threshold = Math.max(2, Math.floor(norm.length / 3))
  const scored = agents
    .map((a) => ({ a, d: levenshtein(norm, normalizeAgentName(a.name)) }))
    .filter((x) => x.d <= threshold)
    .sort((x, y) => x.d - y.d)
  if (scored.length === 1) return scored[0].a
  if (scored.length >= 2 && scored[0].d < scored[1].d) return scored[0].a
  return null
}

/** 注册 a2a_list_agents / a2a_call 两个工具，模型据此自主发现并调用外部 agent。 */
function registerA2ATools(ctx: any): void {
  ctx.tools.register(defineTool({
    name: 'a2a_list_agents',
    description:
      '列出已注册的外部 A2A agent（名称、描述、能力标签、url）。在调用 a2a_call 之前，先用它发现有哪些 agent、各自擅长什么。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                url: { type: 'string' },
                description: { type: 'string' },
                capabilities: { type: 'array', items: { type: 'string' } },
                keywords: { type: 'array', items: { type: 'string' } },
                examples: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args: unknown, value: any): any => [{
        type: 'text',
        text: value?.agents?.length
          ? '可用外部 A2A agent：\n' + value.agents.map((a: any) =>
              `- ${a.name}${a.description ? `：${a.description}` : ''}${a.capabilities?.length ? `（能力：${a.capabilities.join('、')}）` : ''}${a.keywords?.length ? `（触发词：${a.keywords.join('、')}）` : ''}`
            ).join('\n')
          : '（当前没有已注册的外部 agent）',
      }],
    },
    execute: async () => {
      const config = await loadA2AConfig()
      return {
        agents: config.agents.map((a) => ({
          name: a.name, url: a.url, description: a.description, capabilities: a.capabilities,
          keywords: a.keywords ?? [], examples: a.examples ?? [],
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_call',
    description:
      '向已注册的外部 A2A agent 发送一条消息并获取回复。先调用 a2a_list_agents 查看可用 agent 名称，选择能力最匹配当前任务的那个。',
    parameters: {
      agent: { type: 'string', required: true, description: '外部 agent 的注册名（取自 a2a_list_agents 返回的 name 字段）。' },
      message: { type: 'string', required: true, description: '发给外部 agent 的消息文本。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reply: { type: 'string', required: true },
          agent: { type: 'string' },
        },
      },
      render: (_args: unknown, value: any): any => [{
        type: 'text',
        text: typeof value?.reply === 'string' ? value.reply : String(value?.reply ?? ''),
      }],
    },
    execute: async (args: any) => {
      const agentName = typeof args?.agent === 'string' ? args.agent : ''
      const message = typeof args?.message === 'string' ? args.message : ''
      if (!agentName) throw new Error('a2a_call: agent 不能为空')
      if (!message) throw new Error('a2a_call: message 不能为空')
      const config = await loadA2AConfig()
      // A：精确 → 归一化 → 子串 → 编辑距离 解析目标（唯一命中才用）。
      const target = resolveAgent(config.agents, agentName)
      // B：找不到 → 返回候选闭环，让模型下一轮 tool call 纠正，而不是抛错。
      if (!target) {
        const names = config.agents.map((a) => `- ${a.name}${a.description ? `：${a.description}` : ''}`).join('\n')
        return {
          reply: `未找到外部 agent「${agentName}」。已注册的 agent 有：\n${names || '（无）'}\n请从上述 name 中重新选择后再次调用 a2a_call。`,
          agent: '',
        }
      }
      const reply = await a2aSendMessage(a2aBaseUrl(target.url), message)
      return { reply, agent: target.name }
    },
  }))
}

/** 带 tools 依赖的 cordis Service，供 apply() 注册（ctx.tools 需显式 inject）。 */
export class A2AToolsPlugin extends Service {
  static inject = ['tools']

  constructor(ctx: any) {
    super(ctx, 'a2a-tools')
    registerA2ATools(ctx)
  }
}

// ---- A2A inbound（Phase 3）----

/** 读 Node HTTP 请求体为 UTF-8 字符串。 */
function readRequestBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 从 A2A message（parts 或 content）里提取纯文本。 */
function extractInboundText(message: any): string {
  const parts = Array.isArray(message?.parts) ? message.parts
    : Array.isArray(message?.content) ? message.content : []
  return parts
    .map((p: any) => (typeof p === 'string' ? p : (p?.text ?? p?.content ?? '')))
    .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
    .join('\n')
    .trim()
}

/** A2A inbound：暴露 agent card + message/send 端点，驱动真实 agent 回复外部调用。 */
export class A2AInboundPlugin extends Service {
  static inject = ['webServer', 'llm', 'agentDefaultModel']

  private llm: any
  private agentDefaultModel: any

  constructor(ctx: any) {
    super(ctx, 'a2a-inbound')
    this.llm = ctx.llm
    this.agentDefaultModel = ctx.agentDefaultModel
    this.register(ctx)
  }

  private register(ctx: any): void {
    // Agent Card：标准发现端点（exact 优先于 SPA fallback，无冲突）。
    ctx.webServer.register({
      kind: 'exact',
      path: '/.well-known/agent-card.json',
      handler: async (req: any, res: any) => {
        try {
          const config = await loadA2AConfig()
          const host = req.headers?.host ?? '127.0.0.1'
          const card = {
            name: config.card.name,
            description: config.card.description,
            url: `http://${host}/a2a`,
            version: '1.0.0',
            capabilities: { streaming: false, pushNotifications: false },
            defaultInputModes: ['text'],
            defaultOutputModes: ['text'],
            skills: config.card.capabilities.map((c: string) => ({ id: c, name: c, description: c })),
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(card, null, 2))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      },
    })

    // JSON-RPC message/send 端点（prefix /a2a，避开 SPA 的 / fallback）。
    ctx.webServer.register({
      kind: 'prefix',
      path: '/a2a',
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        try {
          const parsed = JSON.parse(await readRequestBody(req))
          if (parsed?.method === 'message/send') {
            const text = await this.handleMessageSend(parsed?.params)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? null,
              result: { kind: 'message', role: 'agent', parts: [{ kind: 'text', text }] },
            }))
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed?.id ?? null, error: { code: -32601, message: `unknown method: ${parsed?.method}` } }))
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      },
    })
  }

  private async handleMessageSend(params: any): Promise<string> {
    const text = extractInboundText(params?.message)
    if (!text) throw new Error('a2a: message 缺少文本内容')

    // 轻量 inbound：直接用 llm.stream 以本 agent 身份回复。完整 agent loop
    // （工具调用/多轮记忆）需 preset 挂载，复杂度高，留作后续增强。
    const config = await loadA2AConfig()
    const sel = this.agentDefaultModel.currentSelection()
    const system = [
      `你是 ${config.card.name}。`,
      config.card.description,
      config.card.capabilities.length
        ? `你具备以下能力：${config.card.capabilities.join('、')}。`
        : '',
      '请用简洁、准确的中文回答用户的问题。',
    ].filter(Boolean).join('\n')

    const messages = [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }]

    const chunks = this.llm.stream({
      provider: sel.provider,
      model: sel.model,
      system,
      messages,
    })

    let reply = ''
    for await (const chunk of chunks) {
      if (chunk?.type === 'text-delta') reply += chunk.text
      else if (chunk?.type === 'finish' && chunk?.reason?.kind === 'error') {
        const f = chunk.reason.failure
        throw new Error(`模型调用失败：${f?.message ?? '未知错误'}`)
      }
    }
    if (!reply.trim()) throw new Error('a2a: 模型未返回内容')
    return reply.trim()
  }
}

/**
 * 每个 profile 只加载自己的技能：注册一个只扫 per-profile 目录的 skill provider，
 * 关闭 dsh 默认全局根（~/.dsh/skills / ~/.agents/skills）。
 * 复用 dsh 的 FileSystemSkillProvider 解析逻辑（YAML frontmatter + isSkillName 校验）。
 */
export class ProfileSkillProviderPlugin extends Service {
  static inject = ['skills']

  constructor(ctx: any) {
    super(ctx, 'profile-skill-provider')
    ctx.skills.registerProvider((control: any) => {
      return new FileSystemSkillProvider(ctx, control, {
        providerName: 'profile',
        includeDefaultRoots: false,
        customSkillDirs: [skillRoot()],
        watch: false,
      })
    })
  }
}

export function apply(ctx: any): void {
  ctx.plugin(ProfileSkillProviderPlugin)
  ctx.plugin(SkillForgeGateway)
  ctx.plugin(ToolIntegrationsGateway)
  ctx.plugin(A2AConfigGateway)
  ctx.plugin(A2AToolsPlugin)
  ctx.plugin(A2AInboundPlugin)
}
