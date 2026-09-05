/**
 * 宠物显隐的跨 slot 状态桥。命令拦截器（input-trigger source）和宠物本体
 * （shell.overlay 的 PetView）挂在不同 slot，无法用 React context 传递，
 * 用模块级发布订阅 store 桥接（与 teamStore 同款模式）。
 */

type Listener = () => void

/** 默认显示（用户要求：默认就是现在 webui 上的样子）。 */
let visible = true

const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

export const petStore = {
  /** 当前是否显示（getSnapshot，必须是稳定引用）。 */
  isVisible: () => visible,
  /** 显示宠物。 */
  show: () => {
    if (!visible) {
      visible = true
      emit()
    }
  },
  /** 隐藏宠物。 */
  hide: () => {
    if (visible) {
      visible = false
      emit()
    }
  },
  /** 切换显隐。 */
  toggle: () => {
    visible = !visible
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
