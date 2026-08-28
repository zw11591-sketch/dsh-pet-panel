/** `hello` namespace dictionaries (the panel view tab label and page headings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'hello'

/** The hello dictionary key set (the source of truth for both locales). */
export type HelloKey =
  | 'view.hello'
  | 'title'
  | 'subtitle'
  | 'tab.overview'
  | 'tab.features'
  | 'tab.about'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The panel view tab label and page headings. */
    'hello': HelloKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<HelloKey, string> = {
  'view.hello': '你好面板',
  'title': '你好，DeepSeek Harness',
  'subtitle': '通过 conversation.view 插槽注册的自定义面板，实时展示会话与上下文指标。',
  'tab.overview': '概览',
  'tab.features': '功能',
  'tab.about': '关于',
}

/** English dictionary. */
export const en: Record<HelloKey, string> = {
  'view.hello': 'Hello',
  'title': 'Hello, DeepSeek Harness',
  'subtitle': 'A custom panel registered through the conversation.view slot, showing live session and context metrics.',
  'tab.overview': 'Overview',
  'tab.features': 'Features',
  'tab.about': 'About',
}
