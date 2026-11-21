import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { localSource, reload, reloadTarget, type Outcome, type ReloadTarget } from '../lib/reload.js'
import { LABELS } from './labels.js'

const NS = 'dsh-local-plugin-reload'
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager']

type ContextFace = Pick<Context, 'effect' | 'on'> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
}
type DetailProps = PluginDetailProps & Pick<PropsRuntime<'plugins.detail.actions'>, 'useRemoteAccess'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-local-plugin-reload': keyof typeof LABELS.en
  }
}
type DialogState = { target: ReloadTarget } & (
  { kind: 'confirm' | 'checking' | 'removing' | 'installing' } | Outcome
)

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T) => {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const css = `
.dsh-local-badge {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 999px;
  font-size: 10px; line-height: 1; font-weight: 500; white-space: nowrap;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-local-button {
  font: inherit; font-size: 12px; font-weight: 500; padding: 0 10px; min-height: 28px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); cursor: pointer;
  white-space: nowrap; color: var(--dsw-alias-label-primary); background: transparent;
}
.dsh-local-button:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-local-button:disabled { opacity: .5; cursor: default; }
.dsh-local-destructive { color: var(--dsw-alias-state-error-primary); }
.dsh-local-dialog {
  width: min(420px, calc(100vw - 32px)); padding: 20px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
}
.dsh-local-dialog::backdrop { background: color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent); }
.dsh-local-dialog h3 { margin: 0 0 10px; font-size: 16px; }
.dsh-local-dialog p, .dsh-local-dialog code {
  font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary);
}
.dsh-local-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
`

export function apply(ctx: ContextFace): void {
  const manager = ctx.remote.pluginManager
  const inventory = store<readonly BundleInfo[]>([])
  const dialog = store<DialogState | null>(null)
  let pending: Promise<void> | undefined
  let requested = false
  let disposed = false

  function refresh(): void {
    requested = true
    if (pending !== undefined) return
    pending = (async () => {
      do {
        requested = false
        try {
          const answer = await manager.listBundles()
          if (!disposed) inventory.set(answer.ok ? answer.value : [])
        } catch {
          if (!disposed) inventory.set([])
        }
      } while (requested && !disposed)
    })().finally(() => { pending = undefined })
  }

  function useBundle({ subject, useRemoteAccess }: DetailProps): BundleInfo | undefined {
    const canList = useRemoteAccess('pluginManager/listBundles')
    const bundles = useSyncExternalStore(inventory.subscribe, inventory.get)
    const name = subject.kind === 'item' ? undefined : subject.pkg.name
    useEffect(() => { if (canList && name) refresh() }, [canList, name])
    return canList && name ? bundles.find(bundle => bundle.name === name) : undefined
  }

  ctx.effect(() => ctx.locale.register(NS, LABELS), `${NS}: locale`)
  const t = ctx.locale.bind(NS)
  const useLocale = () => useSyncExternalStore(
    listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot(),
  )

  function Badge(props: DetailProps) {
    const bundle = useBundle(props)
    useLocale()
    return bundle && localSource(bundle) ? <span className="dsh-local-badge">{t('badge')}</span> : null
  }

  function ReloadButton(props: DetailProps) {
    const bundle = useBundle(props)
    const canInspect = props.useRemoteAccess('pluginManager/inspect')
    const canRemove = props.useRemoteAccess('pluginManager/removeBundle')
    const canInstall = props.useRemoteAccess('pluginManager/installBundle')
    const state = useSyncExternalStore(dialog.subscribe, dialog.get)
    useLocale()
    const target = bundle && reloadTarget(bundle)
    if (!target || props.subject.kind !== 'bundle' || !canInspect || !canRemove || !canInstall) return null
    return <button type="button" className="dsh-local-button dsh-local-destructive" disabled={state !== null}
      onClick={() => dialog.set({ kind: 'confirm', target })}>{t('reload')}</button>
  }

  async function run(target: ReloadTarget, retry = false) {
    const state = dialog.get()
    if (state?.target !== target || (retry ? !('retryInstall' in state && state.retryInstall) : state.kind !== 'confirm')) return
    const result = await reload(manager, target, kind => dialog.set({ kind, target }), retry)
    if (disposed) return
    dialog.set({ ...result, target })
    refresh()
  }

  function Overlay() {
    const state = useSyncExternalStore(dialog.subscribe, dialog.get)
    const modal = useRef<HTMLDialogElement>(null)
    useLocale()
    const open = state !== null
    useEffect(() => {
      const element = modal.current
      if (open && element && !element.open) element.showModal()
      return () => { if (element?.open) element.close() }
    }, [open])
    if (!state) return <style>{css}</style>
    const { kind, target } = state
    const waiting = kind === 'checking' || kind === 'removing' || kind === 'installing'
    const retry = 'retryInstall' in state && state.retryInstall === true
    return <>
      <style>{css}</style>
      <dialog ref={modal} className="dsh-local-dialog" aria-labelledby={`${NS}-title`}
        onCancel={event => { event.preventDefault(); if (!waiting) dialog.set(null) }}>
        <h3 id={`${NS}-title`}>{t('reload')}</h3>
        <p><strong>{target.name}</strong></p>
        <p role="status">{t(kind)}</p>
        {kind === 'confirm' || retry ? <code>{target.spec}</code> : null}
        {'detail' in state && state.detail ? <p>{state.detail}</p> : null}
        <footer>
          {!waiting && <button type="button" className="dsh-local-button" autoFocus
            onClick={() => dialog.set(null)}>{t(kind === 'confirm' ? 'cancel' : 'close')}</button>}
          {kind === 'confirm' && <button type="button" className="dsh-local-button dsh-local-destructive"
            onClick={() => { void run(target) }}>{t('confirmAction')}</button>}
          {retry && <button type="button" className="dsh-local-button"
            onClick={() => { void run(target, true) }}>{t('retry')}</button>}
        </footer>
      </dialog>
    </>
  }

  ctx.effect(() => {
    const changed = ctx.remote.$on('plugin-manager/changed', () => {
      if (inventory.get().length > 0 || pending !== undefined) refresh()
    })
    const reset = ctx.on('connection/reset', () => {
      if (inventory.get().length > 0 || pending !== undefined) refresh()
    })
    const badge = ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({ name: 'plugins.detail.badge', id: NS }, Badge))
    const button = ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({ name: 'plugins.detail.actions', id: NS }, ReloadButton))
    const overlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS }, Overlay))
    return () => {
      disposed = true
      badge(); button(); overlay(); changed(); reset()
    }
  }, `${NS}: panel entries`)
}
