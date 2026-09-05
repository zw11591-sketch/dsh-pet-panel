/** `dashboard` namespace dictionaries (the view tab label and page headings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'dashboard'

/** The dashboard dictionary key set (the source of truth for both locales). */
export type DashboardKey =
  | 'view.label'
  | 'title'
  | 'subtitle'
  | 'tab.overview'
  | 'tab.analytics'
  | 'skillForge.label'
  | 'toolIntegrations.label'
  | 'a2a.label'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The view tab label and dashboard page headings. */
    'dashboard': DashboardKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<DashboardKey, string> = {
  'view.label': '会话仪表盘',
  'title': '会话仪表盘',
  'subtitle': '实时汇总会话、上下文与 Token 用量指标，全部从框架标准数据派生。',
  'tab.overview': '概览',
  'tab.analytics': '用量分析',
  'skillForge.label': '技能工坊',
  'toolIntegrations.label': '工具集成',
  'a2a.label': 'A2A 管理',
}

/** English dictionary. */
export const en: Record<DashboardKey, string> = {
  'view.label': 'Dashboard',
  'title': 'Session Dashboard',
  'subtitle': 'Live session, context, and token-usage metrics, all derived from standard framework data.',
  'tab.overview': 'Overview',
  'tab.analytics': 'Analytics',
  'skillForge.label': 'Skill Forge',
  'toolIntegrations.label': 'Tool Integrations',
  'a2a.label': 'A2A Management',
}