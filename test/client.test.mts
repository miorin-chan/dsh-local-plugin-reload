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


test('confirms and performs a card uninstall in the Local tab without opening details', async () => {
  const require = createRequire(import.meta.url)
  const { apply } = registration.factory(name => name === 'react' ? {
    ...require('react'), useEffect: effect => effect(), useId: () => 'description',
    useRef: current => ({ current }), useState: value => [value, () => {}],
    useSyncExternalStore: (_subscribe, get) => get(),
  } : require(name))
  const slots = new Map()
  let inventory = [
    { name: 'protected', source: 'link:/fixtures/protected', installed: true, enabled: false, removable: false,
      meta: { title: 'Beta' } },
    { name: '@a/dsh-client-enabled', source: 'link:/fixtures/enabled', installed: true, enabled: true, removable: true,
      meta: { title: 'Alpha' } },
    { name: '@z/dsh-host-demo', source: 'link:/fixtures/demo', installed: true, enabled: false, removable: true,
      meta: { title: 'Zulu' } },
  ]
  const removed = []
  const opened = []
  apply({
    effect: install => install(), on: () => () => {},
    locale: { register: () => () => {}, resolveText: title => title, bind: () => (key, { name } = {}) => name ? key + ' ' + name : key,
      getSnapshot: () => ({ active: 'en' }) },
    slots: { inject: (_name, mount) => mount(), register: ({ name }, view) => { slots.set(name, view); return () => {} } },
    remote: {
      $on: () => () => {},
      pluginManager: {
        listBundles: async () => ({ ok: true, value: inventory }),
        removeBundle: async name => {
          removed.push(name)
          inventory = inventory.filter(bundle => bundle.name !== name)
          return { ok: true, value: { application: 'applied' } }
        },
      },
    },
  })
  function find(node, predicate) {
    if (Array.isArray(node)) return node.flatMap(child => find(child, predicate))
    if (!node?.props) return []
    return [...(predicate(node.props) ? [node.props] : []), ...find(node.props.children, predicate)]
  }
  const tab = slots.get('plugins.tab')
  const overlay = slots.get('shell.overlay')
  const render = (canRemove = true) => tab({ openPackage: name => opened.push(name),
    useRemoteAccess: method => canRemove || method !== 'pluginManager/removeBundle' })
  const settle = () => new Promise(resolve => setImmediate(resolve))
  const cards = () => render().props.children
  const cardButtons = () => cards().flatMap(card => find(card.type(card.props), props => props['aria-label']?.startsWith('uninstallPlugin')))
  const modalButton = label => find(overlay(), props => props.children === label && typeof props.onClick === 'function')[0]
  render()
  await settle()
  assert.equal(render(false).props.children[0].props.canRemove, false)
  assert.deepEqual(cards().map(card => [card.props.bundle.name, card.props.title]), [
    ['@z/dsh-host-demo', 'Zulu'], ['@a/dsh-client-enabled', 'Alpha'], ['protected', 'Beta'],
  ])
  assert.deepEqual(cardButtons().map(props => props['aria-label']), ['uninstallPlugin Zulu'])
  const trash = cardButtons()[0]
  assert.equal(trash.title, 'uninstallPlugin Zulu')
  assert.equal(trash.variant, 'outline')
  assert.equal(trash.children, undefined)
  assert.match(trash.icon.type(trash.icon.props).props['data-icon'], /trash-outline/)
  trash.onClick()
  assert.deepEqual(removed, [])
  modalButton('cancel').onClick()
  assert.deepEqual(removed, [])
  cardButtons()[0].onClick()
  const confirm = modalButton('uninstall')
  confirm.onClick()
  confirm.onClick()
  await settle()
  assert.deepEqual(removed, ['@z/dsh-host-demo'])
  assert.equal(find(overlay(), props => props.role === 'status')[0].children, 'uninstallDone')
  modalButton('close').onClick()
  assert.deepEqual(cards().map(card => card.props.bundle.name), ['@a/dsh-client-enabled', 'protected'])
  assert.deepEqual(opened, [])
})
