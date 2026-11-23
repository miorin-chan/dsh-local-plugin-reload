import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

let registration
const previousWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry } } }
try { await import('../client.js') } finally { globalThis.window = previousWindow }
const plugin = registration.factory(createRequire(import.meta.url))

test('registers the Local tab, detail extensions and dialog, then releases all effects on unload', () => {
  assert.equal(registration.id, '@miorin/dsh-local-plugin-reload')
  assert.ok(plugin.inject.includes('remote.pluginManager'))
  const effects = []
  const active = new Set()
  const register = key => {
    active.add(key)
    return () => { active.delete(key) }
  }
  plugin.apply({
    effect(install) { effects.push(install()) },
    on: register,
    locale: {
      register(namespace, labels) {
        assert.equal(Object.keys(labels).length, 8)
        return register(namespace)
      },
      bind: () => key => key,
    },
    slots: { inject: (_name, mount) => mount(), register: options => register(`${options.name}/${options.id}`) },
    remote: { pluginManager: {}, $on: register },
  })
  assert.deepEqual([...active].sort(), [
    'connection/reset', 'dsh-local-plugin-reload', 'plugin-manager/changed',
    'plugins.detail.badge/dsh-local-plugin-reload', 'plugins.detail.badge/dsh-local-plugin-reload.reload',
    'plugins.tab/dsh-local-plugin-reload', 'shell.overlay/dsh-local-plugin-reload',
  ])
  for (const dispose of effects.reverse()) dispose()
  assert.equal(active.size, 0)
})
