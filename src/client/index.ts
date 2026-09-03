/**
 * Browser client plugin: contributes a rich panel tab into the conversation
 * view slot, a global floating pet into the shell overlay, and two capability
 * management views (Skill Forge / Tool Integrations) that ride the host-face
 * Typert remotes exposed by src/index.ts. The Papergames brand swap and theme
 * repaint round out the client identity.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the 'shell.overlay' SlotMap row (declared by ui-layout) for the pet.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the 'sidebar.brand.mark' / 'sidebar.brand.name' SlotMap rows.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { en, NS, zh } from './locales.ts'
import { DashboardView } from './DashboardView.tsx'
import { PetView } from './PetView.tsx'
import { PapergamesLogo, PapergamesWordmark, applyPapergamesFavicon, applyHeroCopyRewrite } from './brand.tsx'
import { applyPapergamesTheme } from './theme.ts'
import { BackgroundSwitcher } from './BackgroundSwitcher.tsx'
import { TaskManagerView } from './TaskManagerView.tsx'
import { TaskManagerTrigger } from './TaskManagerTrigger.tsx'
import { applyBackground, getStoredBackground, applyDim, getStoredDim } from './bg.ts'
import SkillForgeView, { type SkillApi } from './SkillForgeView.tsx'
import ToolIntegrationsView, { type McpApi } from './ToolIntegrationsView.tsx'
import A2AView, { type A2AApi } from './A2AView.tsx'
import { TYPERT_REMOTE } from './remote.ts'
import type { LifecycleSnapshot } from './remote.ts'
import { petStore } from './petStore.ts'

/** Required services: slot registry, locale, and the Typert client remote. */
export const inject = ['slots', 'locale', 'remote']

/** Unwrap a Typert remote result `{ ok, value } | { ok, error }` into its value. */
function unwrap<T>(r: { ok: true; value: T } | { ok: false; error?: { message?: string } }): T {
  if (!r.ok) throw new Error(r.error?.message ?? 'remote call failed')
  return r.value
}

/**
 * 注册 `/pet on | off` 客户端斜杠命令：拦截输入、切换宠物显隐、不发给模型。
 *
 * dsh 内置 command source（dsh-client-ui-commands）已占用 `/` 触发符，但对
 * 未知命令 `/pet on` 的 matchEnter 会返回 undefined；adjudicate 按注册顺序
 * 轮询各 source，第一个非 undefined 获胜，因此我们注册在它之后即可接管
 * `/pet`。命中后翻转 petStore 并返回 `'handled'`（吞掉这行，不进模型），
 * 再通过 `slash/input-consume-token` 清空输入框（与 command 源同款）。
 */
function registerPetCommand(ctx: any): void {
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '/',
    name: 'pet-visibility',
    showGroupTitle: false,
    // 菜单候选：输入 "/" 时列出 pet 命令（像 /compact 一样可发现、可拾取）。
    candidates: async (_session: any, req: { query?: string }) => {
      const q = (req?.query ?? '').toLowerCase()
      // 空查询（刚输入 "/"）或按前缀匹配 "pet" 时显示。
      if (q !== '' && !'pet'.startsWith(q)) return []
      return [{ name: 'pet', description: '切换桌面宠物显隐', hint: 'on | off' }]
    },
    onPick: (pick: any) => {
      // 菜单拾取：切换宠物，并清掉输入框里已键入的 "/..." 片段。
      petStore.toggle()
      try {
        const actx = ctx.sessions?.scope(pick.session?.sessionId)
        if (actx !== undefined && pick.span) {
          actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span: pick.span } })
        }
      } catch {
        // 消费失败不阻塞：宠物已切换。
      }
      return 'handled'
    },
    matchEnter: async (session: { sessionId: string }, line: string) => {
      const m = /^\/pet(?:\s+(on|off|toggle))?$/i.exec(line.trim())
      if (!m) return undefined
      const arg = (m[1] ?? 'toggle').toLowerCase()
      if (arg === 'on') petStore.show()
      else if (arg === 'off') petStore.hide()
      else petStore.toggle()

      // 清空输入框：command 源同款 consume-token 事件（bare-token guard）。
      try {
        const actx = ctx.sessions?.scope(session.sessionId)
        if (actx !== undefined) {
          actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'bare-token', token: line.trim() } })
        }
      } catch {
        // 消费失败不阻塞：宠物已切换。
      }
      return 'handled'
    },
  }), 'pet-command: slash source')
}

/** Register the capability views (Skill Forge + Tool Integrations). */
function registerCapabilityViews(ctx: any, t: (key: any) => string): void {
  const skillApi: SkillApi = {
    list: async () => unwrap(await ctx.remote.skillForge.list()),
    read: async (name) => unwrap(await ctx.remote.skillForge.read(name)),
    write: async (name, content) => unwrap(await ctx.remote.skillForge.write(name, content)),
    delete: async (name) => unwrap(await ctx.remote.skillForge.delete(name)),
    generate: async (description) => unwrap(await ctx.remote.skillForge.generate(description)),
  }
  const mcpApi: McpApi = {
    list: async () => unwrap(await ctx.remote.toolIntegrations.list()),
    read: async (serverName) => unwrap(await ctx.remote.toolIntegrations.read(serverName)),
    write: async (config) => unwrap(await ctx.remote.toolIntegrations.write(config)),
    delete: async (serverName) => unwrap(await ctx.remote.toolIntegrations.delete(serverName)),
  }
  const a2aApi: A2AApi = {
    get: async () => unwrap(await ctx.remote.a2aConfig.get()),
    setCard: async (card) => unwrap(await ctx.remote.a2aConfig.setCard(card)),
    upsertAgent: async (externalAgent) => unwrap(await ctx.remote.a2aConfig.upsertAgent(externalAgent)),
    delete: async (name) => unwrap(await ctx.remote.a2aConfig.delete(name)),
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'skill-forge',
    order: 30,
    locale: NS,
    label: () => t('skillForge.label'),
    inject: () => ({ api: skillApi }),
  }, SkillForgeView))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'tool-integrations',
    order: 40,
    locale: NS,
    label: () => t('toolIntegrations.label'),
    inject: () => ({ api: mcpApi }),
  }, ToolIntegrationsView))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'a2a-management',
    order: 50,
    locale: NS,
    label: () => t('a2a.label'),
    inject: () => ({ api: a2aApi }),
  }, A2AView))

  // 任务管理面板：挂 shell.overlay，含执行轨迹查询（lifecycle）。
  // 必须在这里注册：本子插件 inject 了 remote.skillForge（$mount 之后可用），
  // 主函数 ctx 只有 remote，访问 remote.skillForge 会报 without inject。
  const lifecycle = async (sessionId: string): Promise<LifecycleSnapshot> =>
    unwrap(await ctx.remote.skillForge.lifecycle(sessionId))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'task-manager-panel',
    order: 100,
    inject: () => ({ lifecycle }),
  }, TaskManagerView))
}

/**
 * Client plugin body. The Papergames theme and the base views register first;
 * then the two capability namespaces are mounted onto the Typert client remote
 * and consumed from a child plugin whose `remote.<ns>` injects resolve against
 * the now-mounted namespace services.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<void> {
  // Papergames accent ramp: repaint the DeepSeek brand-blue tokens coral.
  applyPapergamesTheme(ctx)
  // 浏览器 tab 图标换成 Papergames（覆盖 DeepSeek 鲸鱼 favicon）。
  applyPapergamesFavicon()
  // 新会话 hero 文案：探索未至之境 → 叠纸游戏-Papergames，隐藏「预览版」角标。
  ctx.effect(() => applyHeroCopyRewrite(), 'pet-panel: hero copy rewrite')
  // 恢复上次选择的背景（默认恋与深空）。
  applyBackground(getStoredBackground())
  // 恢复上次选择的背景明暗（默认 0.25）。
  applyDim(getStoredDim())
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pet-panel: dictionaries')
  const t = ctx.locale.bind(NS)

  // Mount the hand-written REMOTE manifest (skillForge + toolIntegrations).
  const disposeRemote = await (ctx as any).remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => disposeRemote, 'pet-panel: unmount remote')

  // Base views (dashboard tab, floating pet, brand swap).
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dashboard',
    order: 20,
    locale: NS,
    label: () => t('view.label'),
  }, DashboardView))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'pet',
  }, PetView))
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    priority: -1,
  }, PapergamesLogo))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -1,
  }, PapergamesWordmark))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    priority: -1,
  }, PapergamesLogo))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'background',
    order: 10,
  }, BackgroundSwitcher))
  // 任务管理：会话头部入口按钮（与原生 jobs 入口并列）。
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'task-manager',
    order: 20,
  }, TaskManagerTrigger))

  // Capability views consume the now-mounted remotes.
  ctx.plugin({
    name: 'pet-panel-capabilities',
    inject: ['slots', 'locale', 'remote', 'remote.skillForge', 'remote.toolIntegrations', 'remote.a2aConfig'],
    apply: (capCtx: any) => {
      registerCapabilityViews(capCtx, t)
    },
  })

  // /pet on | off 命令拦截：切换宠物显隐。
  ctx.plugin({
    name: 'pet-panel-command',
    inject: ['inputTriggers', 'sessions'],
    apply: (cmdCtx: any) => {
      registerPetCommand(cmdCtx)
    },
  })
}
