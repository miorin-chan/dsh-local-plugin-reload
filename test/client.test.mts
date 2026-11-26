import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const react = require('react')

const fakePrimitives = {
  Button: props => react.createElement('button', props),
  Input: props => react.createElement('input', props),
  Switch: props => react.createElement('input', { type: 'checkbox', ...props }),
  Tag: props => react.createElement('span', props),
  Tooltip: props => react.createElement('span', { 'data-tooltip': props.label }, props.children),
  IconChevronRightOutlineRegular: props => react.createElement('svg', props),
  IconTrashOutlineRegular: props => react.createElement('svg', { 'data-icon': 'dsw-icon-trash-outline-regular', ...props }),
  PluginArtworkDefault: props => react.createElement('svg', props),
}

let registration
const previousWindow = globalThis.window
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry } } }
try { await import('../client.js') } finally { globalThis.window = previousWindow }
const factoryRequire = overrides => name => {
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives
  if (overrides?.[name]) return overrides[name]
  return require(name)
}
const plugin = registration.factory(factoryRequire())

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
    'plugins.detail.badge/dsh-local-plugin-reload', 'plugins.detail.section/dsh-local-plugin-reload',
    'plugins.tab/dsh-local-plugin-reload', 'shell.overlay/dsh-local-plugin-reload',
  ])
  for (const dispose of effects.reverse()) dispose()
  assert.equal(active.size, 0)
})


test('confirms and performs a card uninstall in the Local tab without opening details', async () => {
  const { apply } = registration.factory(factoryRequire({
    react: {
      ...react, useEffect: effect => effect(), useId: () => 'description',
      useRef: current => ({ current }), useState: value => [value, () => {}],
      useSyncExternalStore: (_subscribe, get) => get(),
    },
  }))
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

test('keeps the reload editor collapsed at the page bottom and opens it from the title badge', async () => {
  // Minimal hook state per component, enough to follow one render cycle and its effects.
  const states = new Map()
  let slots
  let cursor = 0
  let effects = []
  const slot = init => {
    const key = cursor++
    if (!(key in slots)) slots[key] = init()
    return key
  }
  const fakeReact = {
    ...react,
    useState: init => {
      const key = slot(() => init)
      const owner = slots
      return [owner[key], value => { owner[key] = value }]
    },
    useRef: current => slots[slot(() => ({ current }))],
    useEffect: (effect, deps) => {
      const key = slot(() => undefined)
      const previous = slots[key]
      if (!previous || !deps || deps.some((dep, index) => dep !== previous[index])) {
        slots[key] = deps ?? []
        effects.push(effect)
      }
    },
    useSyncExternalStore: (_subscribe, get) => get(),
    useId: () => 'id',
  }
  const render = (component, props) => {
    if (!states.has(component)) states.set(component, [])
    slots = states.get(component)
    cursor = 0
    effects = []
    const output = component(props)
    for (const effect of effects) effect()
    return output
  }
  const { apply } = registration.factory(factoryRequire({ react: fakeReact }))
  const views = new Map()
  const bundle = { name: '@a/dsh-demo', source: 'link:/fixtures/demo', installed: true, availability: 'profile',
    enabled: true, removable: true, rows: [] }
  apply({
    effect: install => install(), on: () => () => {},
    locale: { register: () => () => {}, resolveText: title => title, bind: () => key => key,
      subscribe: () => () => {}, getSnapshot: () => ({ active: 'en' }) },
    slots: { inject: (_name, mount) => mount(), register: ({ name }, view) => { views.set(name, view); return () => {} } },
    remote: { $on: () => () => {}, pluginManager: { listBundles: async () => ({ ok: true, value: [bundle] }) } },
  })
  const pkg = { name: bundle.name, rows: [] }
  const allowed = method => method !== 'pluginManager/denied'
  const page = { subject: { kind: 'bundle', pkg }, useRemoteAccess: allowed }
  const Badge = views.get('plugins.detail.badge')
  const Section = views.get('plugins.detail.section')
  render(Badge, page)
  await new Promise(resolve => setImmediate(resolve))

  // A row page and a page without install access keep the badge as a plain tag and draw no section.
  const rowPage = { subject: { kind: 'row', pkg, row: { rowId: 'r', moduleName: 'm', enabled: true } }, useRemoteAccess: allowed }
  const readOnly = { ...page, useRemoteAccess: method => method !== 'pluginManager/installBundle' }
  for (const props of [rowPage, readOnly]) {
    assert.equal(render(Badge, props).props.className, 'dsh-local-badge')
    assert.equal(render(Section, props), null)
  }

  const editor = render(Section, page)
  const Editor = editor.type
  const find = (node, predicate) => {
    if (Array.isArray(node)) return node.flatMap(child => find(child, predicate))
    if (!node?.props) return []
    return [...(predicate(node.props) ? [node.props] : []), ...find(node.props.children, predicate)]
  }
  const toggle = tree => find(tree, props => 'aria-expanded' in props)[0]
  const body = tree => find(tree, props => props.id === 'dsh-local-plugin-reload-section-body')[0]
  let tree = render(Editor, editor.props)
  assert.equal(tree.props.id, 'dsh-local-plugin-reload-section')
  assert.equal(toggle(tree)['aria-expanded'], false)
  assert.equal(body(tree).hidden, true)

  const badge = render(Badge, page)
  assert.equal(badge.props.label, 'sectionTitle')
  const button = badge.props.children
  assert.equal(button.props['aria-controls'], 'dsh-local-plugin-reload-section')
  button.props.onClick()
  render(Editor, editor.props)
  tree = render(Editor, editor.props)
  assert.equal(toggle(tree)['aria-expanded'], true)
  assert.equal(body(tree).hidden, false)

  // The request is consumed, so collapsing stays collapsed until the badge is used again.
  toggle(tree).onClick()
  tree = render(Editor, editor.props)
  assert.equal(body(tree).hidden, true)
})
