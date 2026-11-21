import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

type Manager = Pick<ClientRemote['pluginManager'], 'listBundles' | 'inspect' | 'removeBundle' | 'installBundle'>

export interface ReloadTarget {
  readonly name: string
  readonly spec: string
  readonly enabled: boolean
  readonly version?: string
}

type Failure = 'changed' | 'source' | 'removeFailed' | 'installFailed'
export type Outcome = { kind: 'done' | 'restart' | 'overridden' }
  | { kind: Failure; detail?: string; retryInstall?: boolean }

export function localSource(bundle: BundleInfo): string | undefined {
  const spec = bundle.source
  return bundle.installed && bundle.availability !== 'installation' && spec !== undefined
    && /^(?:link|file):(?:[/\\]|[a-z]:[/\\])/i.test(spec) ? spec : undefined
}

export function reloadTarget(bundle: BundleInfo): ReloadTarget | undefined {
  const spec = localSource(bundle)
  if (spec === undefined || !bundle.removable || bundle.readOnlyReason !== undefined
    || bundle.name === 'dsh-local-plugin-reload') return undefined
  return { name: bundle.name, spec, enabled: bundle.enabled, ...bundle.version === undefined ? {} : { version: bundle.version } }
}

export async function reload(
  manager: Manager, target: ReloadTarget, stage: (stage: 'checking' | 'removing' | 'installing') => void,
  retryInstall = false,
): Promise<Outcome> {
  let failure: Failure = 'changed'
  let removed = retryInstall
  try {
    stage('checking')
    const inventory = await manager.listBundles()
    if (!inventory.ok) return { kind: failure, detail: inventory.error.message, retryInstall: removed }
    const existing = inventory.value.find(bundle => bundle.name === target.name)
    const current = existing && reloadTarget(existing)
    if (retryInstall ? existing?.installed === true : current === undefined || current.spec !== target.spec
      || current.enabled !== target.enabled || current.version !== target.version) {
      return { kind: 'changed' }
    }

    failure = 'source'
    const before = await manager.inspect(target.spec)
    if (!before.ok) return { kind: failure, detail: before.error.message, retryInstall: removed }
    if (before.value.status === 'refused') {
      // For an installed directory this API reports the manifest name only in the refusal reason.
      const expectedRefusal = before.value.problem === 'already-installed'
        && before.value.reason === `${target.name} is already installed`
      if (retryInstall || !expectedRefusal) return { kind: failure, detail: before.value.reason, retryInstall: removed }
    }
    if (before.value.status === 'accepted' && before.value.kind !== 'tarball' && before.value.name !== target.name) {
      return { kind: failure, retryInstall: removed }
    }
    // The manager's tarball inspection only verifies that the file exists.
    if (before.value.status === 'accepted' && before.value.kind === 'tarball' && target.version === undefined) {
      return { kind: failure, retryInstall: removed }
    }

    if (!retryInstall) {
      failure = 'removeFailed'
      stage('removing')
      const removal = await manager.removeBundle(target.name)
      if (!removal.ok) return { kind: failure, detail: removal.error.message }
      if (removal.value.error || ['failed', 'cancelled'].includes(removal.value.application)) {
        const detail = removal.value.error?.diagnostic ?? removal.value.error?.code ?? removal.value.application
        return { kind: failure, detail }
      }
      removed = true
    }

    failure = 'installFailed'
    stage('installing')
    const inspected = retryInstall ? before : await manager.inspect(target.spec)
    if (!inspected.ok) return { kind: failure, detail: inspected.error.message, retryInstall: removed }
    if (inspected.value.status === 'refused') return { kind: failure, detail: inspected.value.reason, retryInstall: removed }
    const { kind, name, version } = inspected.value
    const expectedVersion = kind === 'tarball' ? target.version : version
    if ((kind !== 'tarball' && (kind !== 'path' || name !== target.name)) || !expectedVersion) {
      return { kind: failure, retryInstall: removed }
    }
    const installation = await manager.installBundle(target.spec, {
      enabled: target.enabled,
      expected: { name: target.name, version: expectedVersion },
    })
    if (!installation.ok) return { kind: failure, detail: installation.error.message, retryInstall: removed }
    const result = installation.value
    switch (result.application) {
      case 'applied': return { kind: 'done' }
      case 'restart-required': return { kind: 'restart' }
      case 'overridden': return { kind: 'overridden' }
      default: {
        const detail = result.error?.diagnostic ?? result.error?.code ?? result.application
        return { kind: failure, detail, retryInstall: removed }
      }
    }
  } catch (error) {
    return { kind: failure, detail: error instanceof Error ? error.message : String(error), retryInstall: removed }
  }
}
