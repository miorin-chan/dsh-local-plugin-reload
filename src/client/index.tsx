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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { installSource, localSource, reload, reloadTarget, type Outcome, type ReloadTarget } from '../lib/reload.js'
import { LABELS } from './labels.js'

const NS = 'dsh-local-plugin-reload'
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager']

type ContextFace = Pick<Context, 'effect' | 'on'> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
}
type DetailProps = PluginDetailProps & Pick<PropsRuntime<'plugins.detail.section'>, 'useRemoteAccess'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-local-plugin-reload': keyof typeof LABELS.en
  }
}
type DialogState = { target: ReloadTarget; destination: string } & (
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
.dsh-local-source-section { border-top: 1px solid var(--dsw-alias-border-l1); padding: 16px 0; }
.dsh-local-source-section label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 500; }
.dsh-local-source-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-local-source-input {
  flex: 1 1 180px; min-width: 0; box-sizing: border-box; padding: 6px 8px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1); font: 12px monospace;
}
.dsh-local-edit { width: 28px; padding: 0; display: inline-grid; place-items: center; }
.dsh-local-source-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
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
.dsh-local-dialog footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-local-dialog footer button { white-space: normal; }
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

  function ReloadSection(props: DetailProps) {
    const bundle = useBundle(props)
    const canInspect = props.useRemoteAccess('pluginManager/inspect')
    const canRemove = props.useRemoteAccess('pluginManager/removeBundle')
    const canInstall = props.useRemoteAccess('pluginManager/installBundle')
    useLocale()
    const target = bundle && reloadTarget(bundle)
    if (!target || props.subject.kind !== 'bundle' || !canInspect || !canRemove || !canInstall) return null
    return <SourceEditor key={`${target.name}:${target.spec}`} target={target} />
  }

  function SourceEditor({ target }: { target: ReloadTarget }) {
    const state = useSyncExternalStore(dialog.subscribe, dialog.get)
    const [draft, setDraft] = useState(target.spec)
    const [editing, setEditing] = useState(false)
    const input = useRef<HTMLInputElement>(null)
    const pencil = useRef<HTMLButtonElement>(null)
    const destination = installSource(draft, target.spec)
    useEffect(() => { if (editing) input.current?.focus() }, [editing])
    const invalid = destination === undefined
    return <section className="dsh-local-source-section">
      <label htmlFor={`${NS}-source`}>{t('sourceLabel')}</label>
      <form className="dsh-local-source-row" onSubmit={event => {
        event.preventDefault()
        if (destination && state === null) dialog.set({ kind: 'confirm', target, destination })
      }}>
        <button ref={pencil} type="button" className="dsh-local-button dsh-local-edit" aria-label={t('editSource')}
          title={t('editSource')} disabled={state !== null} onClick={() => {
            if (editing) input.current?.focus()
            else setEditing(true)
          }}>
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="m3 10-.6 3.5L6 13l7.2-7.2a1.5 1.5 0 0 0-2.1-2.1L3 10Zm6.8-5 2.1 2.1" />
          </svg>
        </button>
        <input ref={input} id={`${NS}-source`} className="dsh-local-source-input" type="text" spellCheck={false}
          autoCapitalize="off" autoComplete="off" readOnly={!editing || state !== null} value={draft}
          aria-invalid={invalid || undefined} aria-describedby={invalid ? `${NS}-source-error` : undefined}
          onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            if (event.key === 'Escape' && editing) {
              event.stopPropagation()
              setDraft(target.spec)
              setEditing(false)
              pencil.current?.focus()
            }
          }} />
        <button type="submit" className="dsh-local-button dsh-local-destructive" disabled={invalid}>{t('reload')}</button>
      </form>
      {invalid && <p id={`${NS}-source-error`} className="dsh-local-source-error">{t('invalidSource')}</p>}
    </section>
  }

  async function run(state: DialogState, destination = state.destination) {
    if (dialog.get() !== state) return
    const retry = 'retryInstall' in state && state.retryInstall === true
    if (!retry && state.kind !== 'confirm') return
    const { target } = state
    const result = await reload(manager, target, kind => dialog.set({ kind, target, destination }), retry, destination)
    if (disposed) return
    dialog.set({ ...result, target, destination })
    refresh()
  }

  function Overlay() {
    const state = useSyncExternalStore(dialog.subscribe, dialog.get)
    const modal = useRef<HTMLDialogElement>(null)
    const status = useRef<HTMLParagraphElement>(null)
    const dismiss = useRef<HTMLButtonElement>(null)
    useLocale()
    const open = state !== null
    const kind = state?.kind
    const waiting = kind === 'checking' || kind === 'removing' || kind === 'installing'
    useEffect(() => {
      const element = modal.current
      if (open && element && !element.open) element.showModal()
      return () => { if (element?.open) element.close() }
    }, [open])
    useEffect(() => {
      if (!open) return
      const focus = waiting ? status.current : dismiss.current
      focus?.focus()
    }, [open, waiting])
    if (!state) return <style>{css}</style>
    const { kind: phase, target, destination } = state
    const retry = 'retryInstall' in state && state.retryInstall === true
    const moving = destination !== target.spec
    const showSource = phase === 'confirm' || retry || phase === 'removeFailed' || phase === 'installFailed'
    return <>
      <style>{css}</style>
      <dialog ref={modal} className="dsh-local-dialog" aria-labelledby={`${NS}-title`} aria-describedby={`${NS}-status`}
        onCancel={event => { event.preventDefault(); if (!waiting) dialog.set(null) }}>
        <h3 id={`${NS}-title`}>{t('reload')}</h3>
        <p><strong>{target.name}</strong></p>
        <p ref={status} id={`${NS}-status`} role="status" tabIndex={-1}>{t(phase)}</p>
        {phase === 'confirm' && (/\.(?:tgz|tar\.gz)$/i.test(destination)
          ? <p>{t('archiveVersion')}</p> : moving && <p>{t('directoryCheck')}</p>)}
        {showSource ? <code>{destination}</code> : null}
        {'detail' in state && state.detail ? <p>{state.detail}</p> : null}
        {retry && moving && <p>{t('restoreSource')}<br /><code>{target.spec}</code></p>}
        <footer>
          {!waiting && <button type="button" className="dsh-local-button" ref={dismiss} autoFocus
            onClick={() => dialog.set(null)}>{t(phase === 'confirm' ? 'cancel' : 'close')}</button>}
          {phase === 'confirm' && <button type="button" className="dsh-local-button dsh-local-destructive"
            onClick={() => { void run(state) }}>{t('confirmAction')}</button>}
          {retry && moving && <button type="button" className="dsh-local-button"
            onClick={() => { void run(state, target.spec) }}>{t('restoreSource')}</button>}
          {retry && <button type="button" className="dsh-local-button"
            onClick={() => { void run(state) }}>{t('retry')}</button>}
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
    const section = ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({ name: 'plugins.detail.section', id: NS }, ReloadSection))
    const overlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS }, Overlay))
    return () => {
      disposed = true
      badge(); section(); overlay(); changed(); reset()
    }
  }, `${NS}: panel entries`)
}
