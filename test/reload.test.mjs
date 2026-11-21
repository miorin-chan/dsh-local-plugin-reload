import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installSource, localSource, reload, reloadTarget } from '../lib/reload.js'

const bundle = {
  name: 'local-example', source: 'link:/work/local example', installed: true,
  availability: 'profile', removable: true, enabled: false, version: '1.0.0',
}
const target = reloadTarget(bundle)
const ok = value => ({ ok: true, value })
const accepted = ok({ status: 'accepted', kind: 'path', bundle: true, name: bundle.name, version: '1.1.0' })
const alreadyInstalled = ok({ status: 'refused', problem: 'already-installed', reason: `${bundle.name} is already installed` })

function fixture(destination = bundle.source) {
  const stages = []
  const calls = []
  let installed = true
  const service = {
    async listBundles() { return ok(installed ? [bundle] : []) },
    async inspect(spec, options) {
      assert.equal(spec, destination)
      assert.deepEqual(options, {})
      return installed ? alreadyInstalled : accepted
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      installed = false
      return ok({ application: 'applied' })
    },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      installed = true
      return ok({ application: 'applied' })
    },
  }
  return { service, calls, stages, run: retry => reload(service, target, stage => stages.push(stage), retry, destination) }
}

test('local source covers linked and file dependencies and excludes registry, git and built-in bundles', () => {
  for (const source of [bundle.source, 'file:/tmp/plugin.tgz', 'link:C:\\plugins\\example']) {
    assert.equal(localSource({ ...bundle, source }), source)
  }
  for (const source of ['example@1.0.0', 'github:example/plugin', 'https://example.org/plugin.tgz', 'link:../example']) {
    assert.equal(localSource({ ...bundle, source }), undefined)
  }
  assert.equal(localSource({ ...bundle, installed: false }), undefined)
  assert.equal(localSource({ ...bundle, availability: 'installation' }), undefined)
  assert.equal(reloadTarget({ ...bundle, removable: false }), undefined)
  assert.equal(reloadTarget({ ...bundle, name: 'dsh-local-plugin-reload' }), undefined)
})

test('protects an aggregate that owns the reload plugin and permits other aggregates', () => {
  const rows = [{ rowId: 'reload', moduleName: 'dsh-local-plugin-reload' }]
  assert.equal(reloadTarget({ ...bundle, enabled: true, rows }), undefined)
  assert.equal(reloadTarget({ ...bundle, rows: [], error: { code: 'invalid-patch' } }), undefined)
  assert.equal(reloadTarget({ ...bundle, rows: [{ ...rows[0], moduleName: 'another-plugin' }] }).name, bundle.name)
})

test('uninstalls then reinstalls from the same spec with the prior enablement and the current source version', async () => {
  const { stages, calls, run } = fixture()
  assert.deepEqual(await run(), { kind: 'done' })
  assert.deepEqual(stages, ['checking', 'removing', 'installing'])
  assert.deepEqual(calls, [
    ['remove', bundle.name],
    ['install', bundle.source, { enabled: false, expected: { name: bundle.name, version: '1.1.0' } }],
  ])
})

test('normalizes absolute destinations and rejects relative paths and remote specs', () => {
  assert.equal(installSource(' /work/new location ', bundle.source), 'link:/work/new location')
  assert.equal(installSource('/work/new.tgz', bundle.source), 'file:/work/new.tgz')
  assert.equal(installSource('file:/work/copied folder', bundle.source), 'file:/work/copied folder')
  for (const input of ['', '../plugin', 'https://example.com/plugin.tgz', 'file:../plugin', 'link:/one\n/two']) {
    assert.equal(installSource(input, bundle.source), undefined)
  }
})

test('reinstalls a bundle from a different local path and preserves its enablement', async () => {
  const destination = 'link:/work/moved plugin'
  const { calls, run } = fixture(destination)
  assert.deepEqual(await run(), { kind: 'done' })
  assert.deepEqual(calls, [
    ['remove', bundle.name],
    ['install', destination, { enabled: false, expected: { name: bundle.name, version: '1.1.0' } }],
  ])
})

test('a changed inventory, missing source or different manifest name leaves the original bundle installed', async () => {
  const stale = fixture()
  stale.service.listBundles = async () => ok([{ ...bundle, enabled: true }])
  assert.equal((await stale.run()).kind, 'changed')
  assert.deepEqual(stale.calls, [])

  for (const response of [
    { status: 'refused', problem: 'not-a-package', reason: 'the path does not exist' },
    { status: 'refused', problem: 'already-installed', reason: 'someone-else is already installed' },
    { ...accepted.value, name: 'someone-else' },
  ]) {
    const example = fixture()
    example.service.inspect = async () => ok(response)
    assert.equal((await example.run()).kind, 'source')
    assert.deepEqual(example.calls, [])
  }
})

test('removal failure prevents installation', async () => {
  const { service, calls, run } = fixture()
  service.removeBundle = async () => ok({ application: 'failed', error: { code: 'bundle-in-use' } })
  assert.deepEqual(await run(), { kind: 'removeFailed', detail: 'bundle-in-use' })
  assert.deepEqual(calls, [])
})

test('offers recovery when removal succeeded but its remote reply was lost', async () => {
  const { service, calls, run } = fixture()
  const remove = service.removeBundle
  service.removeBundle = async name => {
    await remove(name)
    throw new Error('connection lost')
  }
  assert.deepEqual(await run(), { kind: 'removeFailed', detail: 'connection lost', retryInstall: true })
  assert.deepEqual(calls, [['remove', bundle.name]])
  assert.deepEqual(await run(true), { kind: 'done' })
})

test('an activation failure after installing the files points back to the existing bundle', async () => {
  const { service, run } = fixture()
  service.installBundle = async () => ok({ stage: 'enable', application: 'failed', error: { code: 'operation-error' } })
  assert.deepEqual(await run(), { kind: 'activationFailed', detail: 'operation-error' })
})

test('retry after removal installs without removing twice and reports a required restart', async () => {
  const { service, calls, run } = fixture()
  const install = service.installBundle
  service.installBundle = async () => ok({ application: 'failed', error: { code: 'operation-error' } })
  assert.deepEqual(await run(), { kind: 'installFailed', detail: 'operation-error', retryInstall: true })
  service.installBundle = async (...args) => {
    await install(...args)
    return ok({ application: 'restart-required' })
  }
  assert.deepEqual(await run(true), { kind: 'restart' })
  assert.deepEqual(calls.map(([operation]) => operation), ['remove', 'install'])
  assert.equal((await run(true)).kind, 'changed')
})
