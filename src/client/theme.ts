/**
 * Papergames theme overlay: remap the DeepSeek brand-blue token ramp
 * (`--dsw-static-deepseek-*`) to the Papergames coral ramp, so every accent
 * surface in the shell (buttons, links, selection, focus rings) follows the
 * Papergames identity without touching the host theme machinery.
 *
 * The host theme installs its tokens on `body` (not `:root`), so the override
 * MUST target `body` too — a `:root` rule loses to the host's `body` rule
 * because `body` is a descendant and re-declares the same custom properties.
 *
 * Injected once via `ctx.effect` (auto-removed on plugin dispose), the same
 * pattern the host `dsh-client-ui-theme` uses to install its tokens.
 */
import type { Context } from '@deepseek-ai/cordis'
import { DEEPSPACE_BG } from './bg.ts'

/**
 * DeepSeek's blue ramp (#edf3fe → #283142, brand #4176e6) mapped onto the
 * Papergames coral ramp anchored at #F36864 (the mark color in brand.tsx).
 */
const PAPERGAMES_THEME_CSS = `body{
--dsw-static-deepseek-50:#fdf1f0;
--dsw-static-deepseek-100:#fbe3e1;
--dsw-static-deepseek-200:#f8c9c6;
--dsw-static-deepseek-300:#f4a8a4;
--dsw-static-deepseek-400:#f38782;
--dsw-static-deepseek-450:#f36864;
--dsw-static-deepseek-500:#e45753;
--dsw-static-deepseek-600:#c44744;
--dsw-static-deepseek-700:#a03937;
--dsw-static-deepseek-800:#7c2b2a;
--dsw-static-deepseek-900:#571e1d;
--dsw-alias-brand-primary-new-colorprimary-new-color:#e45753;
--dsw-specific-sidebar-fill:rgba(255,255,255,0.68);
--dsw-alias-bg-base:rgba(255,255,255,0.74);
--dsw-alias-bg-layer-1:rgba(255,255,255,0.66);
--dsw-alias-bg-layer-2:rgba(255,255,255,0.66);
--dsw-alias-bg-layer-3:rgba(255,255,255,0.66);
background-color:#12162a;
background-image:linear-gradient(rgba(0,0,0,var(--pg-bg-dim,0.25)),rgba(0,0,0,var(--pg-bg-dim,0.25))),var(--pg-bg-image, url("${DEEPSPACE_BG}"));
background-size:cover;
background-position:center;
background-attachment:fixed;
}
body[data-ds-dark-theme]{
--dsw-alias-brand-primary-new-colorprimary-new-color:#f36864;
}`

/** Install the Papergames accent ramp into the page's `body` tokens. */
export function applyPapergamesTheme(ctx: Context): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-papergames-theme', '')
    tag.textContent = PAPERGAMES_THEME_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'pet-panel: papergames-theme')
}
