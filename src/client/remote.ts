/**
 * Hand-written Typert REMOTE manifest for this plugin's host-face Gateways.
 *
 * The host half (src/index.ts) exposes two TypertRemoteService Gateways —
 * `skillForge` (skill 的 SKILL.md 增删改查) and `toolIntegrations` (MCP
 * 服务器增删改查). The api-gateway host side discovers their methods through
 * the `typertRemote` binding + `@Remote` markers (source mode), so no
 * generated `/typert` artifact is needed. The client side only needs this
 * manifest to mount the namespaces and describe the wire codecs.
 *
 * `result.schema` describes the method's business return value — the
 * framework wraps it into `{ ok: true, value } | { ok: false, error }`.
 */
import { z } from 'zod'

// ---- skillForge codecs ----

const skillListItem = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
})
const skillListResult = z.object({ items: z.array(skillListItem) })
const skillReadResult = z.object({ name: z.string(), content: z.string() })
const skillGenerateResult = z.object({ content: z.string() })
const skillNameResult = z.object({ name: z.string() })

// ---- skillForge lifecycle（执行轨迹）codecs ----

const lifecycleTodo = z.object({ content: z.string(), status: z.string() })
const lifecycleEvent = z.object({
  seq: z.number(),
  time: z.number(),
  kind: z.string(),
  turn: z.number().optional(),
  step: z.number().optional(),
  text: z.string().optional(),
  toolName: z.string().optional(),
  toolArgs: z.string().optional(),
  isError: z.boolean().optional(),
  outcome: z.string().optional(),
  reason: z.string().optional(),
  todos: z.array(lifecycleTodo).optional(),
})
const lifecycleResult = z.object({
  title: z.string(),
  turns: z.number(),
  steps: z.number(),
  toolCalls: z.number(),
  approvals: z.number(),
  todoWrites: z.number(),
  startedAt: z.number(),
  endedAt: z.number(),
  events: z.array(lifecycleEvent),
})

export type LifecycleEvent = z.infer<typeof lifecycleEvent>
export type LifecycleSnapshot = z.infer<typeof lifecycleResult>

// ---- toolIntegrations codecs ----

const mcpConfig = z.object({
  serverName: z.string(),
  transport: z.enum(['stdio', 'streamable-http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})
const mcpListItem = mcpConfig.extend({ mounted: z.boolean() })
const mcpListResult = z.object({ items: z.array(mcpListItem) })
const mcpReadResult = z.object({ config: mcpConfig })
const mcpServerNameResult = z.object({ serverName: z.string() })

// ---- a2aConfig codecs ----

const a2aCard = z.object({
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
})
const a2aExternalAgent = z.object({
  name: z.string(),
  url: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  keywords: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
})
const a2aConfigResult = z.object({ card: a2aCard, agents: z.array(a2aExternalAgent) })
const a2aCardResult = z.object({ card: a2aCard })
const a2aNameResult = z.object({ name: z.string() })

export type A2ACard = z.infer<typeof a2aCard>
export type A2AExternalAgent = z.infer<typeof a2aExternalAgent>
export type A2AConfig = z.infer<typeof a2aConfigResult>

/** JSON-encoded position parameter codec. */
function jsonParam(name: string, schema: z.ZodType): unknown {
  return {
    name,
    wire: name,
    source: 'json',
    codec: { mode: 'strict' as const, typeSymbol: `dsh-pet-panel#param/${name}`, schema },
  }
}

/** Strict result codec for a method's business return value. */
function strictResult(typeSymbol: string, schema: z.ZodType): unknown {
  return { mode: 'strict' as const, typeSymbol, schema }
}

function direct(method: string, namespace: string): { kind: 'direct' } {
  return { kind: 'direct' }
}

const PKG = 'dsh-pet-panel'

function descriptor(
  namespace: string,
  method: string,
  parameters: unknown[],
  resultSchema: z.ZodType,
): unknown {
  return {
    id: `${PKG}#${namespace}/${method}`,
    service: namespace,
    namespace,
    method,
    invocation: direct(method, namespace),
    parameters,
    result: strictResult(`${PKG}#${namespace}/${method}:result`, resultSchema),
  }
}

export const TYPERT_REMOTE = {
  package: PKG,
  descriptors: [
    // skillForge
    descriptor('skillForge', 'list', [], skillListResult),
    descriptor('skillForge', 'read', [jsonParam('name', z.string())], skillReadResult),
    descriptor('skillForge', 'write', [jsonParam('name', z.string()), jsonParam('content', z.string())], skillNameResult),
    descriptor('skillForge', 'delete', [jsonParam('name', z.string())], skillNameResult),
    descriptor('skillForge', 'generate', [jsonParam('description', z.string())], skillGenerateResult),
    descriptor('skillForge', 'lifecycle', [jsonParam('sessionId', z.string())], lifecycleResult),
    // toolIntegrations
    descriptor('toolIntegrations', 'list', [], mcpListResult),
    descriptor('toolIntegrations', 'read', [jsonParam('serverName', z.string())], mcpReadResult),
    descriptor('toolIntegrations', 'write', [jsonParam('config', mcpConfig)], mcpServerNameResult),
    descriptor('toolIntegrations', 'delete', [jsonParam('serverName', z.string())], mcpServerNameResult),
    // a2aConfig
    descriptor('a2aConfig', 'get', [], a2aConfigResult),
    descriptor('a2aConfig', 'setCard', [jsonParam('card', a2aCard)], a2aCardResult),
    descriptor('a2aConfig', 'upsertAgent', [jsonParam('externalAgent', a2aExternalAgent)], a2aNameResult),
    descriptor('a2aConfig', 'delete', [jsonParam('name', z.string())], a2aNameResult),
  ],
}
