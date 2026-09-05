import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  /** 可选的自由文本 soul（persona）：填写后整体覆盖「name+description+capabilities」拼接的默认人设。 */
  persona?: string
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
  card: { name: '叠纸游戏-Papergames', description: '', capabilities: [], persona: '' },
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
          persona: typeof p.card.persona === 'string' ? p.card.persona : '',
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
      persona: typeof card.persona === 'string' ? card.persona.trim() : '',
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

  /**
   * 探测所有已注册外部 agent 的存活状态：GET 其 agent-card 端点（只读、无副作用），
   * 超时 8s。返回每个 agent 的 online / latencyMs / error，供 UI 实时显示状态标识。
   */
  @Remote('checkAgents')
  async checkAgents(): Promise<{ items: Array<{ name: string; online: boolean; latencyMs: number | null; error: string | null }> }> {
    const config = await this.load()
    const items = await Promise.all(config.agents.map(async (agent) => {
      const endpoint = a2aBaseUrl(agent.url) + '/.well-known/agent-card.json'
      const start = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) {
          return { name: agent.name, online: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }
        }
        const data: unknown = await res.json().catch(() => null)
        if (!data || typeof data !== 'object') {
          return { name: agent.name, online: false, latencyMs: Date.now() - start, error: 'agent-card 不是合法 JSON' }
        }
        return { name: agent.name, online: true, latencyMs: Date.now() - start, error: null }
      } catch (e) {
        clearTimeout(timer)
        return { name: agent.name, online: false, latencyMs: null, error: e instanceof Error ? e.message : String(e) }
      }
    }))
    return { items }
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

/** 从 A2A message/send 响应提取多轮对话 contextId（v0.2 Task 与 v0.3 Message 兼容）。 */
function extractA2AContextId(data: any): string | undefined {
  const result = data?.result
  if (!result || typeof result !== 'object') return undefined
  const candidates = [
    result.contextId,
    result.status?.contextId,
    result.status?.message?.contextId,
  ]
  return candidates.find((c) => typeof c === 'string' && c.length > 0)
}

/** 向外部 agent 的 JSON-RPC 端点发 message/send，返回回复文本（可带上轮 contextId）。 */
async function a2aSendMessage(baseUrl: string, text: string, contextId?: string): Promise<{ text: string; contextId?: string }> {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/'
  const params: any = { message: { role: 'user', parts: [{ kind: 'text', text }] } }
  if (contextId) params.contextId = contextId
  const body = {
    jsonrpc: '2.0',
    method: 'message/send',
    params,
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
  return { text: extractA2AReply(data), contextId: extractA2AContextId(data) }
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
      const { text: reply } = await a2aSendMessage(a2aBaseUrl(target.url), message)
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

/**
 * 从 agent card（a2a-agents.json）构建「本 agent」的 soul（persona）文本。
 * 这是本插件 agent 人设的单一来源：inbound /a2a 与团队「me」共用同一份。
 */
function selfPersona(config: A2AConfig): string {
  // 自由文本 soul 优先：填写了 persona 就整体使用，不再拼接结构化字段。
  if (config.card.persona && config.card.persona.trim()) {
    return config.card.persona.trim()
  }
  return [
    `你是 ${config.card.name}。`,
    config.card.description,
    config.card.capabilities.length
      ? `你具备以下能力：${config.card.capabilities.join('、')}。`
      : '',
    '请用简洁、准确的中文回答用户的问题。',
  ].filter(Boolean).join('\n')
}

/** 从 agent 会话事件里提取最终 assistant 文本 + 回合结局（对齐 headless runner 的 summarize）。 */
function summarizeSessionReply(session: any, firstSeq: number): { text: string; reason: any } {
  let text = ''
  let reason: any
  for (const event of session.snapshotEvents(firstSeq)) {
    if (event.type === 'assistant/message') {
      const joined = (event.data.message?.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      if (joined) text = joined
    } else if (event.type === 'turn/end') {
      reason = event.data.reason
    }
  }
  return { text, reason }
}

/** 确保该会话审批策略为「never」：把审批落空变成明确的确定性拒绝。 */
function ensureApprovalNever(session: any): void {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const ev = session.eventAt(seq)
    if (ev?.type === 'approval/policy') {
      if (ev.data.policy === 'never') return
      break
    }
  }
  session.append('approval/policy', { policy: 'never' })
}

/** 收集本回合因审批被拦截的工具（approval/asked 事件即代表有工具请求了审批，在 never 策略下被拒）。 */
function collectBlockedApprovals(session: any, firstSeq: number): Array<{ tool: string; reason?: string }> {
  const out: Array<{ tool: string; reason?: string }> = []
  for (const event of session.snapshotEvents(firstSeq)) {
    if (event.type === 'approval/asked' && typeof event.data?.toolName === 'string') {
      out.push({
        tool: event.data.toolName,
        ...(typeof event.data?.reason === 'string' && event.data.reason ? { reason: event.data.reason } : {}),
      })
    }
  }
  return out
}

/**
 * 共享的「本 agent」真 agent loop 执行器：inbound /a2a 与团队「me」共用，保证两个
 * 入口同运行时、同 soul（card persona）、同审批策略（never）、同记忆（session 持久化）。
 * sessionId 即 dsh 会话 id：inbound 用 A2A contextId，团队「me」用 threadId。
 */
export class SelfAgentService extends Service {
  static inject = ['agents', 'sessions', 'agentDefaultModel']

  private agents: any
  private sessions: any
  private agentDefaultModel: any
  /** sessionId → 活体 agent 句柄，进程内复用。 */
  private live = new Map<string, { agent: any; dispose: () => Promise<void> }>()
  /** sessionId → 串行化锁，避免同一会话并发请求交错。 */
  private mutex = new Map<string, Promise<unknown>>()

  constructor(ctx: any) {
    super(ctx, 'selfAgent')
    this.agents = ctx.agents
    this.sessions = ctx.sessions
    this.agentDefaultModel = ctx.agentDefaultModel
    // 卸载时释放所有活体 agent。
    ctx.effect(() => () => {
      for (const { dispose } of this.live.values()) void dispose()
      this.live.clear()
    }, 'selfAgent: dispose live agents')
  }

  /** 串行化同一 sessionId 的并发请求，然后走真 agent loop。 */
  turn(sessionId: string, text: string): Promise<{ text: string; approvalsBlocked: Array<{ tool: string; reason?: string }> }> {
    const prev = this.mutex.get(sessionId) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(() => this.runTurn(sessionId, text))
    this.mutex.set(sessionId, next)
    return next.finally(() => {
      if (this.mutex.get(sessionId) === next) this.mutex.delete(sessionId)
    }) as Promise<{ text: string; approvalsBlocked: Array<{ tool: string; reason?: string }> }>
  }

  private async runTurn(sessionId: string, text: string): Promise<{ text: string; approvalsBlocked: Array<{ tool: string; reason?: string }> }> {
    const sel = this.agentDefaultModel.currentSelection()
    if (!sel?.provider || !sel?.model) throw new Error('没有可用的默认模型，请先在设置里配置模型。')
    const agentOptions = { provider: sel.provider, model: sel.model }
    const persona = selfPersona(await loadA2AConfig())

    let live = this.live.get(sessionId)
    let agent: any
    let dispose: (() => Promise<void>) | undefined
    if (live) {
      agent = live.agent
    } else {
      // soul：把 card persona 注入该 agent 的 deployment:persona section（覆盖 preset 默认人设）。
      const setup = (agentCtx: any): void => {
        agentCtx.systemPrompt.section({
          name: 'deployment:persona',
          order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA'),
          text: persona,
        })
      }
      // 优先 resume 已持久化会话；不存在则 create 新会话。
      const handle = await this.resumeOrCreate(sessionId, agentOptions, setup)
      agent = handle.agent
      dispose = handle.dispose
      this.live.set(sessionId, { agent, dispose: dispose! })
    }

    try {
      await agent.whenIdle()
      // 审批无交互通道 → 显式 never，把「落空」变成「明确否决」，模型也被告知不要请求越权。
      ensureApprovalNever(agent.session)
      const firstSeq = agent.session.seq
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      await agent.whenIdle()
      const { text: reply, reason } = summarizeSessionReply(agent.session, firstSeq)
      if (!reply.trim()) {
        if (reason?.kind === 'error' && reason?.error?.message) throw new Error(`模型调用失败：${reason.error.message}`)
        throw new Error('selfAgent: 模型未返回内容')
      }
      // 持久化会话，供重启后 resume。
      await this.sessions.flush(agent.session)
      const approvalsBlocked = collectBlockedApprovals(agent.session, firstSeq)
      return { text: reply.trim(), approvalsBlocked }
    } catch (e) {
      // 失败时释放活体句柄，下次请求重新 create/resume。
      if (dispose) {
        this.live.delete(sessionId)
        await dispose()
      }
      throw e
    }
  }

  /** resume 优先，未持久化则 create。 */
  private async resumeOrCreate(sessionId: string, agentOptions: any, setup: any): Promise<{ agent: any; dispose: () => Promise<void> }> {
    try {
      return await this.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    } catch (e) {
      const notFound = (e as any)?.name === 'SessionPersistenceNotFoundError' || /not found/i.test(String((e as any)?.message ?? ''))
      if (!notFound) throw e
      return await this.agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions, setup })
    }
  }
}

/**
 * A2A inbound：暴露 agent card + message/send 端点，驱动「同一个 dsh agent 运行时」回复外部调用。
 * 实际执行委托给共享的 SelfAgentService，因此与团队「me」走同一套 agents.create/resume +
 * followup + whenIdle，模型/工具/技能/MCP/多轮记忆/人设/审批策略完全一致。多轮靠 A2A
 * contextId ↔ sessionId：contextId 就是 sessionId，重启后靠 sessionPersistence resume。
 * 审批无交互通道 → never 策略 fail-closed（需要审批的工具被拒），并回传 approvalsBlocked。
 */
export class A2AInboundPlugin extends Service {
  static inject = ['webServer', 'selfAgent']

  private selfAgent: SelfAgentService

  constructor(ctx: any) {
    super(ctx, 'a2a-inbound')
    this.selfAgent = ctx.selfAgent
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
            const { text, contextId, approvalsBlocked } = await this.handleMessageSend(parsed?.params)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? null,
              result: {
                kind: 'message',
                role: 'agent',
                parts: [{ kind: 'text', text }],
                contextId,
                ...(approvalsBlocked.length > 0 ? { metadata: { approvalsBlocked } } : {}),
              },
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

  /** 解析 A2A 参数，交给共享的 selfAgent.turn 执行。contextId 即 sessionId。 */
  private handleMessageSend(params: any): Promise<{ text: string; contextId: string; approvalsBlocked: Array<{ tool: string; reason?: string }> }> {
    const text = extractInboundText(params?.message)
    if (!text) return Promise.reject(new Error('a2a: message 缺少文本内容'))
    const contextId = typeof params?.contextId === 'string' && params.contextId ? params.contextId : undefined
    const sessionId = contextId ?? randomUUID()
    return this.selfAgent.turn(sessionId, text).then(({ text: reply, approvalsBlocked }) => ({
      text: reply,
      contextId: sessionId,
      approvalsBlocked,
    }))
  }
}

// ---- 团队（Team）----

/** 团队成员标识："me" 恒表示自己，其余为 a2a-agents.json 里已注册的 name。 */
export interface Team {
  id: string
  name: string
  members: string[]
  createdAt: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  /** role=agent 时：回复方（"me" 或外部 agent name）。 */
  agent?: string
  text: string
  time: number
}

export interface ThreadSummary {
  threadId: string
  teamId: string | null
  peer: string | null
  title: string
  lastTime: number
}

export interface Thread {
  threadId: string
  teamId: string | null
  peer: string | null
  title: string
  members: string[]
  messages: ChatMessage[]
  /** 外部 agent 的多轮对话 contextId（A2A 靠它维持记忆）。 */
  contextIds: Record<string, string>
}

const TEAMS_FILE = () => join(a2aConfigDir(), 'teams.json')
const TEAM_CHATS_DIR = () => join(a2aConfigDir(), 'team-chats')
/** threadId 只允许 uuid 形（字母数字连字符），防路径穿越。 */
const THREAD_ID_RE = /^[A-Za-z0-9-]{1,64}$/

async function loadTeams(): Promise<Team[]> {
  try {
    const raw = await readFile(TEAMS_FILE(), 'utf8')
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && Array.isArray(p.teams)) {
      return p.teams
        .filter((t: any) => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.members))
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          members: t.members.filter((m: unknown): m is string => typeof m === 'string'),
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
        }))
    }
  } catch {
    // 文件不存在/损坏
  }
  return []
}

async function saveTeams(teams: Team[]): Promise<void> {
  await mkdir(a2aConfigDir(), { recursive: true })
  await writeFile(TEAMS_FILE(), JSON.stringify({ teams }, null, 2), 'utf8')
}

function threadFile(threadId: string): string {
  return join(TEAM_CHATS_DIR(), `${threadId}.json`)
}

async function loadThread(threadId: string): Promise<Thread | null> {
  try {
    const raw = await readFile(threadFile(threadId), 'utf8')
    const p = JSON.parse(raw)
    if (!p || typeof p.threadId !== 'string') return null
    return {
      threadId: p.threadId,
      teamId: typeof p.teamId === 'string' ? p.teamId : null,
      peer: typeof p.peer === 'string' ? p.peer : null,
      title: typeof p.title === 'string' ? p.title : '',
      members: Array.isArray(p.members) ? p.members.filter((m: unknown): m is string => typeof m === 'string') : [],
      messages: Array.isArray(p.messages)
        ? p.messages
            .filter((m: any) => m && typeof m.text === 'string')
            .map((m: any) => compact({
              id: typeof m.id === 'string' ? m.id : randomUUID(),
              role: m.role === 'user' || m.role === 'agent' || m.role === 'system' ? m.role : 'system',
              agent: typeof m.agent === 'string' ? m.agent : undefined,
              text: m.text,
              time: typeof m.time === 'number' ? m.time : 0,
            }))
        : [],
      contextIds: p.contextIds && typeof p.contextIds === 'object' ? p.contextIds : {},
    }
  } catch {
    return null
  }
}

async function saveThread(thread: Thread): Promise<void> {
  await mkdir(TEAM_CHATS_DIR(), { recursive: true })
  await writeFile(threadFile(thread.threadId), JSON.stringify(thread, null, 2), 'utf8')
}

/** 扫描 team-chats 目录，返回全部 threadId（容错：目录不存在返回空）。 */
async function listThreadIds(): Promise<string[]> {
  try {
    const entries = await readdir(TEAM_CHATS_DIR(), { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name.slice(0, -'.json'.length))
  } catch {
    return []
  }
}

/** 归一化成员名（含 "me" 特判）。 */
function isMe(token: string): boolean {
  const n = normalizeAgentName(token)
  return n === 'me' || n === 'wo' || n === 'ziwo' || n === '自己'
}

/** 从文本提取 @提及 token；@all/@所有人/@everyone 归一化为 'all'。 */
function parseMentions(text: string): string[] {
  const tokens: string[] = []
  const re = /@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]
    const n = normalizeAgentName(raw)
    if (n === 'all' || n === 'suoyouren' || n === 'everyone' || n === '所有人') tokens.push('all')
    else tokens.push(raw)
  }
  return tokens
}

/**
 * 团队路由引擎：把「我」和外部 agent 编成一组，按 @提及路由。
 * - 单聊线程（peer 非空）：无条件发给该 peer，忽略 @ 与广播。
 * - 群聊线程：@name 定向、@all 全员、无 @ 广播全员；无法解析的 @ 返回系统提示。
 * - 外部 agent 带 contextId 维持多轮记忆；「me」走共享的 SelfAgentService（真 agent loop，
 *   与 inbound /a2a 同运行时、同人设、同审批、同记忆）。
 */
export class TeamGateway extends TypertRemoteService {
  static inject = ['selfAgent']

  private selfAgent: SelfAgentService

  constructor(ctx: any) {
    super(ctx, 'team')
    this.selfAgent = ctx.selfAgent
  }

  @Remote('listTeams')
  async listTeams(): Promise<{ teams: Team[] }> {
    return { teams: await loadTeams() }
  }

  @Remote('createTeam')
  async createTeam(name: string, members: string[]): Promise<{ team: Team }> {
    if (typeof name !== 'string' || !name.trim()) throw new Error('团队名不能为空')
    const cleanMembers = Array.isArray(members)
      ? members.filter((m): m is string => typeof m === 'string' && m.length > 0)
      : []
    // 强制含 me 且排第一，其余去重。
    const rest = [...new Set(cleanMembers.filter((m) => !isMe(m)))]
    const team: Team = {
      id: randomUUID(),
      name: name.trim(),
      members: ['me', ...rest],
      createdAt: Date.now(),
    }
    const teams = await loadTeams()
    teams.push(team)
    await saveTeams(teams)
    return { team }
  }

  @Remote('updateTeam')
  async updateTeam(id: string, name: string, members: string[]): Promise<{ team: Team }> {
    if (typeof id !== 'string' || !id) throw new Error('团队 id 不能为空')
    const teams = await loadTeams()
    const idx = teams.findIndex((t) => t.id === id)
    if (idx < 0) throw new Error('团队不存在')
    const cur = teams[idx]
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : cur.name
    const clean = Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string' && m.length > 0) : []
    const nextMembers = ['me', ...new Set(clean.filter((m) => !isMe(m)))]
    const team: Team = { ...cur, name: nextName, members: nextMembers }
    teams[idx] = team
    await saveTeams(teams)
    return { team }
  }

  @Remote('deleteTeam')
  async deleteTeam(id: string): Promise<{ id: string }> {
    if (typeof id !== 'string' || !id) throw new Error('团队 id 不能为空')
    const teams = await loadTeams()
    await saveTeams(teams.filter((t) => t.id !== id))
    return { id }
  }

  @Remote('listThreads')
  async listThreads(teamId: string): Promise<{ threads: ThreadSummary[] }> {
    if (typeof teamId !== 'string' || !teamId) throw new Error('团队 id 不能为空')
    const ids = await listThreadIds()
    const summaries: ThreadSummary[] = []
    for (const tid of ids) {
      const t = await loadThread(tid)
      if (!t || t.teamId !== teamId) continue
      summaries.push({
        threadId: t.threadId,
        teamId: t.teamId,
        peer: t.peer,
        title: t.title,
        lastTime: t.messages.length ? t.messages[t.messages.length - 1].time : 0,
      })
    }
    summaries.sort((a, b) => b.lastTime - a.lastTime)
    return { threads: summaries }
  }

  @Remote('openThread')
  async openThread(teamId: string, peer: string): Promise<{ thread: Thread }> {
    const tid = typeof teamId === 'string' && teamId ? teamId : null
    const p = typeof peer === 'string' && peer ? peer : null
    if (!tid && !p) throw new Error('openThread 需要 teamId 或 peer')

    // 群聊：一个团队一个共享线程；单聊：按 peer 一个线程。
    if (tid) {
      const ids = await listThreadIds()
      for (const t of ids) {
        const existing = await loadThread(t)
        if (existing && existing.teamId === tid && existing.peer === null) {
          return { thread: await this.refreshMembers(existing) }
        }
      }
      const teams = await loadTeams()
      const team = teams.find((t) => t.id === tid)
      if (!team) throw new Error('团队不存在')
      const thread: Thread = {
        threadId: randomUUID(),
        teamId: tid,
        peer: null,
        title: team.name,
        members: team.members,
        messages: [],
        contextIds: {},
      }
      await saveThread(thread)
      return { thread }
    }

    // 单聊
    const ids = await listThreadIds()
    for (const t of ids) {
      const existing = await loadThread(t)
      if (existing && existing.teamId === null && existing.peer === p) return { thread: existing }
    }
    const thread: Thread = {
      threadId: randomUUID(),
      teamId: null,
      peer: p,
      title: p as string,
      members: ['me', p as string],
      messages: [],
      contextIds: {},
    }
    await saveThread(thread)
    return { thread }
  }

  @Remote('getThread')
  async getThread(threadId: string): Promise<{ thread: Thread }> {
    if (typeof threadId !== 'string' || !THREAD_ID_RE.test(threadId)) throw new Error('无效的 threadId')
    const thread = await loadThread(threadId)
    if (!thread) throw new Error('线程不存在')
    return { thread: await this.refreshMembers(thread) }
  }

  @Remote('send')
  async send(threadId: string, text: string): Promise<{ messages: ChatMessage[] }> {
    if (typeof threadId !== 'string' || !THREAD_ID_RE.test(threadId)) throw new Error('无效的 threadId')
    if (typeof text !== 'string' || !text.trim()) throw new Error('消息不能为空')
    let thread = await loadThread(threadId)
    if (!thread) throw new Error('线程不存在')
    thread = await this.refreshMembers(thread)

    const now = Date.now()
    const userMsg: ChatMessage = { id: randomUUID(), role: 'user', text: text.trim(), time: now }
    thread.messages.push(userMsg)
    const newMessages: ChatMessage[] = [userMsg]

    const config = await loadA2AConfig()

    // 解析目标成员。
    let targets: string[]
    let unresolved: string[] = []
    const externalMembers = thread.members.filter((m) => m !== 'me')
    if (thread.peer !== null) {
      // 单聊：无条件发给 peer。
      targets = [thread.peer]
    } else {
      const mentions = parseMentions(text)
      if (mentions.length === 0) {
        // 无 @ → 广播外部成员；「me」不自问自答，需要我参与请显式 @me。
        targets = [...externalMembers]
      } else if (mentions.includes('all')) {
        // @all → 同样只广播外部成员。
        targets = [...externalMembers]
      } else {
        targets = []
        for (const raw of mentions) {
          if (isMe(raw)) {
            targets.push('me')
            continue
          }
          const agent = resolveAgent(config.agents.filter((a) => thread.members.includes(a.name)), raw)
          if (agent) targets.push(agent.name)
          else unresolved.push(raw)
        }
        targets = [...new Set(targets)]
      }
    }

    // 无法解析的 @ → 系统提示候选，不发送。（只入 newMessages，末尾统一持久化，避免重复写入。）
    if (unresolved.length > 0) {
      const names = thread.members.map((m) => (m === 'me' ? config.card.name : m)).join('、')
      newMessages.push({
        id: randomUUID(),
        role: 'system',
        text: `未识别 @${unresolved.join('、@')}。可用成员：${names || '（无）'}`,
        time: Date.now(),
      })
    }

    // 逐个目标并发发送。
    const results = await Promise.allSettled(
      targets.map(async (name) => {
        if (name === 'me') {
          // 「me」走共享真 agent loop，sessionId = threadId：同一线程多次 @me 共享记忆，
          // 与 inbound /a2a 同运行时、同人设、同审批、同记忆。
          const { text: reply } = await this.selfAgent.turn(threadId, text.trim())
          return { agent: 'me', text: reply }
        }
        const agent = config.agents.find((a) => a.name === name)
        if (!agent) throw new Error(`外部 agent「${name}」已不存在，请重新注册`)
        const prev = thread.contextIds[name]
        try {
          const { text: reply, contextId } = await a2aSendMessage(a2aBaseUrl(agent.url), text.trim(), prev)
          if (contextId) thread.contextIds[name] = contextId
          return { agent: name, text: reply }
        } catch (e) {
          // contextId 失效：去掉重试一次，成功后重置。
          if (prev && e instanceof Error && /context/i.test(e.message)) {
            const retry = await a2aSendMessage(a2aBaseUrl(agent.url), text.trim())
            if (retry.contextId) thread.contextIds[name] = retry.contextId
            return { agent: name, text: retry.text }
          }
          throw e
        }
      }),
    )

    for (const r of results) {
      if (r.status === 'fulfilled') {
        newMessages.push({ id: randomUUID(), role: 'agent', agent: r.value.agent, text: r.value.text, time: Date.now() })
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        newMessages.push({ id: randomUUID(), role: 'system', text: `调用失败：${msg}`, time: Date.now() })
      }
    }

    // 追加到线程并持久化。
    thread.messages.push(...newMessages.slice(1))
    await saveThread(thread)
    return { messages: newMessages }
  }

  /** 群聊线程成员以团队最新 members 为准（团队增删成员即时生效）。 */
  private async refreshMembers(thread: Thread): Promise<Thread> {
    if (thread.teamId === null) return thread
    const teams = await loadTeams()
    const team = teams.find((t) => t.id === thread.teamId)
    if (team) {
      thread.members = team.members
      thread.title = team.name
    }
    return thread
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
  ctx.plugin(SelfAgentService)
  ctx.plugin(A2AInboundPlugin)
  ctx.plugin(TeamGateway)
}
