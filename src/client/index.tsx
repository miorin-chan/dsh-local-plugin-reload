import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginDetailProps, PluginTabProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
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
type AccessProps = Pick<PropsRuntime<'plugins.detail.section'>, 'useRemoteAccess'>
type DetailProps = PluginDetailProps & AccessProps

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
.dsh-local-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 12px; }
.dsh-local-card {
  min-width: 0; display: grid; gap: 6px; text-align: start; padding: 14px; border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer;
}
.dsh-local-card:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-local-card-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; overflow-wrap: anywhere; }
.dsh-local-card code { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.dsh-local-recoveries { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
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
  const inventory = store<readonly BundleInfo[] | 'error' | null>(null)
  let inventoryRequested = false
  const dialog = store<DialogState | null>(null)
  const recoveries = store<readonly DialogState[]>([])
  let pending: Promise<void> | undefined
  let requested = false
  let disposed = false

  function refresh(): void {
    inventoryRequested = true
    requested = true
    if (pending !== undefined) return
    pending = (async () => {
      do {
        requested = false
        try {
          const answer = await manager.listBundles()
          if (!disposed) inventory.set(answer.ok ? answer.value : 'error')
        } catch {
          if (!disposed) inventory.set('error')
        }
      } while (requested && !disposed)
    })().finally(() => { pending = undefined })
  }

  function useInventory({ useRemoteAccess }: AccessProps, active = true) {
    const canList = useRemoteAccess('pluginManager/listBundles')
    const bundles = useSyncExternalStore(inventory.subscribe, inventory.get)
    useEffect(() => { if (canList && active) refresh() }, [canList, active])
    return canList ? bundles : 'error'
  }

  function useBundle(props: DetailProps): BundleInfo | undefined {
    const name = props.subject.kind === 'item' ? undefined : props.subject.pkg.name
    const bundles = useInventory(props, name !== undefined)
    return name && bundles && bundles !== 'error' ? bundles.find(bundle => bundle.name === name) : undefined
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

  function LocalTab(props: PluginTabProps & AccessProps) {
    const bundles = useInventory(props)
    const canInstall = props.useRemoteAccess('pluginManager/installBundle')
    const canInspect = props.useRemoteAccess('pluginManager/inspect')
    const failures = useSyncExternalStore(recoveries.subscribe, recoveries.get)
    const locale = useLocale()
    if (bundles === 'error') return <p role="status">{t('listError')}</p>
    if (bundles === null) return <p role="status">{t('loading')}</p>
    const entries = bundles.filter(bundle => localSource(bundle) !== undefined).map(bundle => ({
      name: bundle.name, title: bundle.meta?.title ? ctx.locale.resolveText(bundle.meta.title) : bundle.name,
    })).sort((left, right) => left.title.localeCompare(right.title, locale.active))
    const recoverable = canInstall && canInspect
      ? failures.filter(failure => !bundles.some(bundle => bundle.installed && bundle.name === failure.target.name)) : []
    return <>
      {recoverable.length > 0 && <div className="dsh-local-recoveries">
        {recoverable.map(failure => <button key={failure.target.name} type="button" className="dsh-local-button"
          onClick={() => dialog.set(failure)}>{t('retry')} · {failure.target.name}</button>)}
      </div>}
      {entries.length === 0 ? <p role="status">{t('empty')}</p> : <div className="dsh-local-list">
        {entries.map(({ name, title }) => <button key={name} type="button" className="dsh-local-card"
          onClick={() => props.openPackage(name)}>
          <span className="dsh-local-card-title"><strong>{title}</strong><span className="dsh-local-badge">{t('badge')}</span></span>
          {title !== name && <code>{name}</code>}
        </button>)}
      </div>}
    </>
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
          title={t('editSource')} disabled={state !== null} onClick={() => { setEditing(true); input.current?.focus() }}>
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
    const settled = { ...result, target, destination }
    const other = recoveries.get().filter(item => item.target.name !== target.name)
    recoveries.set('retryInstall' in result && result.retryInstall ? [...other, settled] : other)
    dialog.set(settled)
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
        {retry ? <p>{t('recovery')}</p> : null}
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
    const refreshIfRequested = () => { if (inventoryRequested) refresh() }
    const changed = ctx.remote.$on('plugin-manager/changed', refreshIfRequested)
    const reset = ctx.on('connection/reset', refreshIfRequested)
    const badge = ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({ name: 'plugins.detail.badge', id: NS }, Badge))
    const section = ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({ name: 'plugins.detail.section', id: NS }, ReloadSection))
    const tab = ctx.slots.inject('plugins.tab', () => ctx.slots.register({ name: 'plugins.tab', id: NS, label: () => t('badge'), order: -10 }, LocalTab))
    const overlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS }, Overlay))
    return () => {
      disposed = true
      badge(); section(); tab(); overlay(); changed(); reset()
    }
  }, `${NS}: panel entries`)
}
