/**
 * Browser client plugin: contributes a rich panel tab into the conversation
 * view slot and a global floating pet into the shell overlay. No service and
 * no store; the panel reads the framework useSessions feed and session
 * projections for its metrics and keeps its section state local.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation)
// must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the 'shell.overlay' SlotMap row (declared by ui-layout) for the pet.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { en, NS, zh } from './locales.ts'
import { DashboardView } from './DashboardView.tsx'
import { PetView } from './PetView.tsx'

/** Required services: the conversation slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dashboard view tab and the global floating
 * pet. Both registrations ride the slot service's effect wrapper, so plugin
 * unload removes them.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pet-panel: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dashboard',
    order: 20,
    locale: NS,
    label: () => t('view.label'),
  }, DashboardView))
  // Global floating pet: a shell-wide overlay seat, above every column and
  // independent of the active session or tab.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'pet',
  }, PetView))
}
