/**
 * Papergames brand occupants for the shell's generic brand slots.
 *
 * The official DeepSeek Harness ships a whale mark + wordmark via
 * `dsh-client-ui-brand-official`. Both slots are `single` with default
 * priority 0; registering here at `priority: -1` shadows them (lowest
 * priority renders), so the shell shows the Papergames identity instead.
 */
import { useId } from 'react'
import type { JSX } from 'react'

/**
 * Papergames logo mark: five coral-red folded-paper bars with white circular
 * cutouts, redrawn as vectors from the official `paper-logo.png` (84x56,
 * mark geometry x9-74 / y9-40, brand red #F36864).
 */
export function PapergamesLogo({ size, className }: { size: number; className?: string }): JSX.Element {
  const uid = useId().replace(/:/g, '')
  const height = Math.round((size * 56) / 84)
  const clip = (n: string) => `${uid}-${n}`
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 84 56"
      className={className}
      role="img"
      aria-label="Papergames"
      fill="none"
    >
      <defs>
        <clipPath id={clip('b1')}><rect x="10" y="14" width="11" height="25" rx="1.5" /></clipPath>
        <clipPath id={clip('b2')}><rect x="24" y="10" width="10" height="27" rx="1.5" /></clipPath>
        <clipPath id={clip('b3')}><rect x="37" y="15" width="10" height="25" rx="1.5" /></clipPath>
        <clipPath id={clip('b4')}><rect x="50" y="10" width="10" height="27" rx="1.5" /></clipPath>
        <clipPath id={clip('b5')}><rect x="63" y="13" width="10" height="20" rx="1.5" /></clipPath>
      </defs>
      <g fill="#F36864">
        <rect x="10" y="14" width="11" height="25" rx="1.5" />
        <rect x="24" y="10" width="10" height="27" rx="1.5" />
        <rect x="37" y="15" width="10" height="25" rx="1.5" />
        <rect x="50" y="10" width="10" height="27" rx="1.5" />
        <rect x="63" y="13" width="10" height="20" rx="1.5" />
      </g>
      <g fill="#FFFFFF">
        <circle cx="13.5" cy="19.5" r="4.5" clipPath={`url(#${clip('b1')})`} />
        <circle cx="29" cy="29.5" r="4.5" clipPath={`url(#${clip('b2')})`} />
        <circle cx="41" cy="21.5" r="4.5" clipPath={`url(#${clip('b3')})`} />
        <circle cx="54" cy="28" r="4.5" clipPath={`url(#${clip('b4')})`} />
        <circle cx="67.5" cy="33" r="4.5" clipPath={`url(#${clip('b5')})`} />
      </g>
    </svg>
  )
}

/** Papergames wordmark shown in the sidebar brand-name slot. */
export function PapergamesWordmark(): JSX.Element {
  return (
    <span className="pg-brand-wordmark" style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
      Papergames
    </span>
  )
}

/**
 * Papergames favicon（浏览器 tab 图标）——覆盖 dsh-web-frontend 自带的
 * DeepSeek 鲸鱼 favicon。运行时把 <link rel="icon"> 的 href 指到这个内联
 * SVG data URI（方形 viewBox 0 0 84 84，五条珊瑚红 bar 垂直居中）。
 */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84" fill="none">
  <defs>
    <clipPath id="pgf-b1"><rect x="10" y="28" width="11" height="25" rx="1.5"/></clipPath>
    <clipPath id="pgf-b2"><rect x="24" y="24" width="10" height="27" rx="1.5"/></clipPath>
    <clipPath id="pgf-b3"><rect x="37" y="29" width="10" height="25" rx="1.5"/></clipPath>
    <clipPath id="pgf-b4"><rect x="50" y="24" width="10" height="27" rx="1.5"/></clipPath>
    <clipPath id="pgf-b5"><rect x="63" y="27" width="10" height="20" rx="1.5"/></clipPath>
  </defs>
  <g fill="#F36864">
    <rect x="10" y="28" width="11" height="25" rx="1.5"/>
    <rect x="24" y="24" width="10" height="27" rx="1.5"/>
    <rect x="37" y="29" width="10" height="25" rx="1.5"/>
    <rect x="50" y="24" width="10" height="27" rx="1.5"/>
    <rect x="63" y="27" width="10" height="20" rx="1.5"/>
  </g>
  <g fill="#FFFFFF">
    <circle cx="13.5" cy="33.5" r="4.5" clip-path="url(#pgf-b1)"/>
    <circle cx="29" cy="43.5" r="4.5" clip-path="url(#pgf-b2)"/>
    <circle cx="41" cy="35.5" r="4.5" clip-path="url(#pgf-b3)"/>
    <circle cx="54" cy="42" r="4.5" clip-path="url(#pgf-b4)"/>
    <circle cx="67.5" cy="47" r="4.5" clip-path="url(#pgf-b5)"/>
  </g>
</svg>`

/** Replace the tab favicon with the Papergames mark (no-op outside the browser). */
export function applyPapergamesFavicon(): void {
  if (typeof document === 'undefined') return
  const href = 'data:image/svg+xml,' + encodeURIComponent(FAVICON_SVG.trim())
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = href
}

/**
 * 新会话 hero 空状态文案改写：把 DeepSeek slogan「探索未至之境」换成
 * 「叠纸游戏-Papergames」，并隐藏「预览版」角标。
 *
 * 这两个文案是 ui-conversation 的 i18n 文本（`hero.headline`/`hero.preview`），
 * 不是 slot；locale 的 `register` 对已存在的 namespace+locale 会抛
 * `already has locale`，无法走正规覆盖。所以这里用 MutationObserver 在 DOM
 * 层改写（项目内、`dsh update` 不覆盖），返回 dispose 函数供插件清理。
 */
export function applyHeroCopyRewrite(): () => void {
  if (typeof document === 'undefined') return () => {}
  const HEADLINE_FROM = '探索未至之境'
  const HEADLINE_TO = '叠纸游戏-Papergames'
  const PREVIEW = '预览版'

  let timer: ReturnType<typeof setTimeout> | undefined
  const rewrite = (): void => {
    timer = undefined
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)
    for (const n of texts) {
      const v = n.nodeValue
      if (v === HEADLINE_FROM) {
        n.nodeValue = HEADLINE_TO
      } else if (v === PREVIEW) {
        const badge = n.parentElement
        if (badge && badge.textContent === PREVIEW) badge.style.display = 'none'
      }
    }
  }
  const schedule = (): void => {
    if (timer) return
    timer = setTimeout(rewrite, 60)
  }
  schedule()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    observer.disconnect()
    if (timer) clearTimeout(timer)
  }
}
