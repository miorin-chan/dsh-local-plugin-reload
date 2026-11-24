import { Button } from '@deepseek-ai/dsh-client-ui-primitives/src/Button.tsx'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives/src/Input.tsx'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives/src/Switch.tsx'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives/src/Tag.tsx'
// Same glyph as the DSH 0.2.2-rc.5 PackageDetail uninstall button.
import { IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives/src/icons/index.tsx'
import { PluginArtworkDefault } from '@deepseek-ai/dsh-client-ui-primitives/src/plugin-artwork.tsx'
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
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { installSource, localSource, reload, reloadTarget, uninstall, uninstallTarget, type Outcome, type ReloadTarget, type UninstallOutcome } from '../lib/reload.js'
import { LABELS } from './labels.js'

// Mirror sortPackages/shortName from dsh-client-ui-plugin-manager 0.2.2-rc.5.
// The plugins.tab contract does not expose the Installed list order.
function installedSortKey(name: string): string {
  const unscoped = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name
  return unscoped.replace(/^dsh-(?:host-|client-)?/, '')
}

const NS = 'dsh-local-plugin-reload'
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager']

type ContextFace = Pick<Context, 'effect' | 'on'> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
}
type DetailProps = PluginDetailProps & Pick<PropsRuntime<'plugins.detail.badge'>, 'useRemoteAccess'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-local-plugin-reload': keyof typeof LABELS.en
  }
}
type ReloadDialogState = { operation: 'reload'; target: ReloadTarget; destination: string } & (
  { kind: 'confirm' | 'checking' | 'removing' | 'installing' } | Outcome
)
type UninstallDialogState = { operation: 'uninstall'; target: ReloadTarget; title: string } & (
  { kind: 'uninstallConfirm' | 'removing' } | UninstallOutcome
)
type DialogState = ReloadDialogState | UninstallDialogState

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

// Populated by the build from the official CSS modules.
declare const officialCss: string

const css = officialCss + `

.dsh-local-badge.dsh-local-badge { height: 18px; padding: 0 7px; font-size: 10px; line-height: 1; }
/* Match the built-in plugin card's spacing and typography. */
.dsh-local-list { display: flex; flex-direction: column; gap: 2px; list-style: none; margin: 0; padding: 0; }
.dsh-local-card {
  position: relative; display: flex; align-items: center; gap: 14px;
  min-width: 0; margin: 0 -8px; padding: 8px; border-radius: var(--dsw-radius-xl, 16px);
}
.dsh-local-card:active { background: var(--dsw-alias-interactive-bg-active); }
@media (hover: hover) { .dsh-local-card:hover { background: var(--dsw-alias-interactive-bg-hover); } }
.dsh-local-card-icon {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 48px; height: 48px; border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg, 14px); color: var(--dsw-alias-label-secondary);
}
.dsh-local-card-icon img { object-fit: contain; }
.dsh-local-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dsh-local-card-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dsh-local-card-open {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0; border: 0; background: transparent; color: inherit;
  font: inherit; font-size: 14px; line-height: 20px; font-weight: 500; text-align: start; cursor: pointer;
}
.dsh-local-card-open::after { content: ''; position: absolute; inset: 0; border-radius: var(--dsw-radius-xl, 16px); }
.dsh-local-card-open:focus-visible { outline: none; }
.dsh-local-card-open:focus-visible::after {
  border-radius: var(--dsw-radius-xl, 16px);
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}
.dsh-local-card-description {
  font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden;
}
.dsh-local-card-end { position: relative; z-index: 1; flex: none; display: flex; align-items: center; gap: 8px; }
.dsh-local-card-notice { margin: 0 0 8px 62px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-local-card-notice:empty { margin: 0; }
.dsh-local-list-status { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.dsh-local-destructive { color: var(--dsw-alias-state-error-primary); }
/* Match PackageDetail's danger outline in dsh-client-ui-plugin-manager 0.2.2-rc.5. */
.dsh-local-uninstall.dsh-local-uninstall {
  width: 28px; padding: 0; color: var(--dsw-alias-state-error-primary);
  --dsh-button-outline-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
  --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.dsh-local-source-section { flex: 0 0 100%; min-width: 0; margin: 8px 0; }
.dsh-local-source-section label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; }
.dsh-local-source-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; }
.dsh-local-source-row button[type='submit'] { max-width: 100%; height: auto; min-height: 28px; white-space: normal; }
.dsh-local-source-input { flex: 1 1 120px; min-width: 0; }
.dsh-local-source-input input { font-family: monospace; }
.dsh-local-edit.dsh-local-edit { width: 28px; padding: 0; }
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
.dsh-local-dialog footer button { height: auto; min-height: 28px; white-space: normal; }
`

export function apply(ctx: ContextFace): void {
  const manager = ctx.remote.pluginManager
  const inventory = store<readonly BundleInfo[] | 'error' | null>(null)
  let inventoryRequested = false
  const dialog = store<DialogState | null>(null)
  let pending: Promise<void> | undefined
  let requested = false
  let disposed = false

  function refresh(): Promise<void> {
    inventoryRequested = true
    requested = true
    if (pending !== undefined) return pending
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
    return pending
  }

  function useInventory(useRemoteAccess: DetailProps['useRemoteAccess'], view: string | undefined) {
    const canList = useRemoteAccess('pluginManager/listBundles')
    const bundles = useSyncExternalStore(inventory.subscribe, inventory.get)
    useEffect(() => { if (canList && view !== undefined) refresh() }, [canList, view])
    return canList ? bundles : 'error'
  }

  function useBundle({ subject, useRemoteAccess }: DetailProps): BundleInfo | undefined {
    const name = subject.kind === 'item' ? undefined : subject.pkg.name
    const bundles = useInventory(useRemoteAccess, name)
    return bundles && bundles !== 'error' ? bundles.find(bundle => bundle.name === name) : undefined
  }

  ctx.effect(() => ctx.locale.register(NS, LABELS), `${NS}: locale`)
  const t = ctx.locale.bind(NS)
  const useLocale = () => useSyncExternalStore(
    listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot(),
  )

  function Badge(props: DetailProps) {
    const bundle = useBundle(props)
    useLocale()
    return bundle && localSource(bundle) ? <Tag tone="info" className="dsh-local-badge">{t('badge')}</Tag> : null
  }

  const toggles = store<ReadonlyMap<string, 'busy' | 'toggleFailed' | 'toggleRestart' | 'toggleOverridden'>>(new Map())

  function LocalCard({ bundle, title, onOpen, canToggle, canRemove }: {
    bundle: BundleInfo; title: string; onOpen: () => void; canToggle: boolean; canRemove: boolean
  }) {
    const description = bundle.meta?.description ? ctx.locale.resolveText(bundle.meta.description) : bundle.description
    const icon = bundle.meta?.icon
    const [failedIcon, setFailedIcon] = useState<string>()
    const descriptionId = useId()
    const action = useSyncExternalStore(toggles.subscribe, toggles.get).get(bundle.name)
    const busy = action === 'busy'
    const target = canRemove ? uninstallTarget(bundle) : undefined
    const uninstallLabel = t('uninstallPlugin', { name: title })
    const locked = !canToggle || bundle.readOnlyReason !== undefined
      || (!bundle.enabled && (bundle.availability === 'missing' || bundle.error !== undefined))

    async function toggle(enabled: boolean) {
      if (locked || toggles.get().get(bundle.name) === 'busy') return
      toggles.set(new Map(toggles.get()).set(bundle.name, 'busy'))
      let notice: 'toggleFailed' | 'toggleRestart' | 'toggleOverridden' | undefined = 'toggleFailed'
      try {
        const result = await manager.setBundleEnabled(bundle.name, enabled)
        if (result.ok) {
          switch (result.value.application) {
            case 'applied': notice = undefined; break
            case 'restart-required': notice = 'toggleRestart'; break
            case 'overridden': notice = 'toggleOverridden'; break
          }
        }
      } catch {
        notice = 'toggleFailed'
      } finally {
        if (!disposed) {
          await refresh()
          const next = new Map(toggles.get())
          if (notice) next.set(bundle.name, notice)
          else next.delete(bundle.name)
          toggles.set(next)
        }
      }
    }

    return <li><div className="dsh-local-card">
      <span className="dsh-local-card-icon" aria-hidden="true">
        {icon && icon !== failedIcon
          ? <img src={icon} width="36" height="36" alt="" onError={() => setFailedIcon(icon)} />
          : <PluginArtworkDefault />}
      </span>
      <div className="dsh-local-card-main">
        <div className="dsh-local-card-title">
          <button type="button" className="dsh-local-card-open" aria-describedby={description ? descriptionId : undefined}
            onClick={onOpen}>{title}</button>
          <Tag tone="info" className="dsh-local-badge">{t('badge')}</Tag>
        </div>
        {description && <span className="dsh-local-card-description" id={descriptionId}>{description}</span>}
      </div>
      <span className="dsh-local-card-end" aria-busy={busy || undefined}>
        {target && <Button size="sm" variant="outline" className="dsh-local-uninstall" disabled={busy}
          icon={<IconTrashOutlineRegular size={13} />} aria-label={uninstallLabel} title={uninstallLabel} onClick={() => {
            if (dialog.get() === null) dialog.set({ operation: 'uninstall', kind: 'uninstallConfirm', target, title })
          }} />}
        <Switch className="dsh-local-card-switch" label={t('togglePlugin', { name: title })}
          checked={bundle.enabled} disabled={locked || busy} onChange={enabled => { void toggle(enabled) }} />
      </span>
    </div><p role="status" className="dsh-local-card-notice">{action && action !== 'busy' ? t(action) : null}</p></li>
  }

  function LocalTab({ openPackage, useRemoteAccess }: PluginTabProps & Pick<DetailProps, 'useRemoteAccess'>) {
    const bundles = useInventory(useRemoteAccess, NS)
    const canToggle = useRemoteAccess('pluginManager/setBundleEnabled')
    const canRemove = useRemoteAccess('pluginManager/removeBundle')
    useLocale()
    if (bundles === 'error') return <p className="dsh-local-list-status" role="status">{t('listError')}</p>
    if (bundles === null) return <p className="dsh-local-list-status" role="status">{t('listLoading')}</p>
    const local = bundles.filter(bundle => localSource(bundle) !== undefined)
      .sort((a, b) => installedSortKey(a.name).localeCompare(installedSortKey(b.name)))
      .map(bundle => ({ bundle, title: bundle.meta?.title ? ctx.locale.resolveText(bundle.meta.title) : bundle.name }))
    if (local.length === 0) return <p className="dsh-local-list-status" role="status">{t('listEmpty')}</p>
    return <ul className="dsh-local-list">
      {local.map(({ bundle, title }) => <LocalCard key={bundle.name} bundle={bundle} title={title} canToggle={canToggle} canRemove={canRemove}
        onOpen={() => openPackage(bundle.name)} />)}
    </ul>
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
        if (destination && state === null) dialog.set({ operation: 'reload', kind: 'confirm', target, destination })
      }}>
        <Button size="sm" variant="outline" ref={pencil} type="button" className="dsh-local-edit" aria-label={t('editSource')}
          title={t('editSource')} disabled={state !== null} onClick={() => {
            if (editing) input.current?.focus()
            else setEditing(true)
          }}>
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="m3 10-.6 3.5L6 13l7.2-7.2a1.5 1.5 0 0 0-2.1-2.1L3 10Zm6.8-5 2.1 2.1" />
          </svg>
        </Button>
        <Input ref={input} id={`${NS}-source`} className="dsh-local-source-input" type="text" spellCheck={false}
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
        <Button size="sm" variant="outline" type="submit" className="dsh-local-destructive" disabled={invalid}>{t('reload')}</Button>
      </form>
      {invalid && <p id={`${NS}-source-error`} className="dsh-local-source-error">{t('invalidSource')}</p>}
    </section>
  }

  async function runReload(state: ReloadDialogState, destination = state.destination) {
    if (dialog.get() !== state) return
    const retry = 'retryInstall' in state && state.retryInstall === true
    if (!retry && state.kind !== 'confirm') return
    const { target } = state
    const result = await reload(manager, target, kind => dialog.set({ operation: 'reload', kind, target, destination }), retry, destination)
    if (disposed) return
    dialog.set({ operation: 'reload', ...result, target, destination })
    refresh()
  }

  async function runUninstall(state: UninstallDialogState) {
    if (dialog.get() !== state || state.kind !== 'uninstallConfirm') return
    dialog.set({ ...state, kind: 'removing' })
    const result = await uninstall(manager, state.target)
    if (disposed) return
    await refresh()
    if (!disposed) dialog.set({ ...state, ...result })
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
    const { kind: phase, target } = state
    const reloadState = state.operation === 'reload' ? state : undefined
    const uninstallState = state.operation === 'uninstall' ? state : undefined
    const confirming = phase === 'confirm' || phase === 'uninstallConfirm'
    const retry = reloadState && 'retryInstall' in reloadState && reloadState.retryInstall === true
    const moving = reloadState !== undefined && reloadState.destination !== target.spec
    const showSource = reloadState && (phase === 'confirm' || retry || phase === 'removeFailed' || phase === 'installFailed')
    return <>
      <style>{css}</style>
      <dialog ref={modal} className="dsh-local-dialog" aria-labelledby={`${NS}-title`} aria-describedby={`${NS}-status`}
        onCancel={event => { event.preventDefault(); if (!waiting) dialog.set(null) }}>
        <h3 id={`${NS}-title`}>{t(uninstallState ? 'uninstall' : 'reload')}</h3>
        <p><strong>{uninstallState?.title ?? target.name}</strong></p>
        <p ref={status} id={`${NS}-status`} role="status" tabIndex={-1}>{t(phase)}</p>
        {reloadState?.kind === 'confirm' && (/\.(?:tgz|tar\.gz)$/i.test(reloadState.destination)
          ? <p>{t('archiveVersion')}</p> : moving && <p>{t('directoryCheck')}</p>)}
        {showSource ? <code>{reloadState.destination}</code> : null}
        {'detail' in state && state.detail ? <p>{state.detail}</p> : null}
        {retry && moving && <p>{t('restoreSource')}<br /><code>{target.spec}</code></p>}
        <footer>
          {!waiting && <Button size="sm" variant="outline" ref={dismiss} autoFocus
            onClick={() => dialog.set(null)}>{t(confirming ? 'cancel' : 'close')}</Button>}
          {reloadState?.kind === 'confirm' && <Button size="sm" variant="outline" className="dsh-local-destructive"
            onClick={() => { void runReload(reloadState) }}>{t('confirmAction')}</Button>}
          {uninstallState?.kind === 'uninstallConfirm' && <Button size="sm" variant="outline" className="dsh-local-destructive"
            onClick={() => { void runUninstall(uninstallState) }}>{t('uninstall')}</Button>}
          {reloadState && retry && moving && <Button size="sm" variant="outline"
            onClick={() => { void runReload(reloadState, target.spec) }}>{t('restoreSource')}</Button>}
          {reloadState && retry && <Button size="sm" variant="outline"
            onClick={() => { void runReload(reloadState) }}>{t('retry')}</Button>}
        </footer>
      </dialog>
    </>
  }

  ctx.effect(() => {
    const refreshIfRequested = () => { if (inventoryRequested) refresh() }
    const changed = ctx.remote.$on('plugin-manager/changed', refreshIfRequested)
    const reset = ctx.on('connection/reset', refreshIfRequested)
    const badge = ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({ name: 'plugins.detail.badge', id: NS }, Badge))
    // The detail title wraps slot entries, so the editor can take the full next line.
    const reloadRow = ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({
      name: 'plugins.detail.badge', id: `${NS}.reload`, order: 100,
    }, ReloadSection))
    const tab = ctx.slots.inject('plugins.tab', () => ctx.slots.register({
      name: 'plugins.tab', id: NS, label: () => t('badge'), order: -10,
    }, LocalTab))
    const overlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS }, Overlay))
    return () => {
      disposed = true
      badge(); reloadRow(); tab(); overlay(); changed(); reset()
    }
  }, `${NS}: panel entries`)
}
