/**
 * 任务管理面板的跨 slot 状态共享。入口按钮（sidebar.footer.action）和
 * 面板本体（shell.overlay）是两个独立的 slot 组件，各自挂载在不同位置，
 * 无法通过 React context 传递——用这个模块级发布订阅 store 桥接。
 */

type Listener = () => void

let open = false
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

export const taskPanelStore = {
  /** 当前是否打开（getSnapshot，必须是稳定引用）。 */
  isOpen: () => open,
  /** 打开面板。 */
  openPanel: () => {
    if (!open) {
      open = true
      emit()
    }
  },
  /** 关闭面板。 */
  closePanel: () => {
    if (open) {
      open = false
      emit()
    }
  },
  /** 切换开合。 */
  toggle: () => {
    open = !open
    emit()
  },
  /** useSyncExternalStore 的 subscribe：注册变更监听，返回取消函数。 */
  subscribe: (l: Listener) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}
