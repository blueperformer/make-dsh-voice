/**
 * verify.mjs — check the shipped artifact and the host logic headlessly.
 *
 * `lib/client.js` never runs in Node during normal use, so a typo there would
 * otherwise surface only as a missing settings page with nothing in the console.
 * This script executes the real emitted bundle against fake browser globals and
 * asserts what `apply` actually did, then exercises the host half's pure logic
 * (the audio store and the command line it hands the shell service).
 *
 * Only the settings-schema group needs the harness' own packages, which are
 * resolved from a DSH installation. Where none exists — a CI runner — that group
 * reports `skip` and names the anchor it looked under, rather than failing for a
 * reason that says nothing about this plugin.
 *
 * Usage: node verify.mjs
 */

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CODE = readFileSync(join(HERE, 'lib', 'client.js'), 'utf8')

let failures = 0
/**
 * Record one assertion.
 * @param label - what was checked.
 * @param ok - whether it held.
 * @param detail - optional observed value.
 */
function check(label, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

/**
 * Record a group of assertions that could not run here.
 *
 * Deliberately not a pass: a check that tested nothing must never look green.
 * @param label - what was skipped.
 * @param why - why it could not run.
 */
function skip(label, why) {
  console.log(` skip  ${label} — ${why}`)
}

/** The fakes stay installed for the whole run: the bundle reads `document` at call time. */
let savedGlobals

/**
 * Install fake browser globals.
 * @param fakes - what to install.
 */
function installFakes(fakes) {
  savedGlobals ??= {
    window: globalThis.window,
    document: globalThis.document,
    Audio: globalThis.Audio,
    fetch: globalThis.fetch,
  }
  globalThis.window = fakes.window
  globalThis.document = fakes.document
  globalThis.Audio = fakes.Audio
  globalThis.fetch = fakes.fetch
}

/** Put the real globals back. */
function restoreFakes() {
  if (savedGlobals === undefined) return
  globalThis.window = savedGlobals.window
  globalThis.document = savedGlobals.document
  globalThis.Audio = savedGlobals.Audio
  globalThis.fetch = savedGlobals.fetch
}

/** A settings-scope double whose snapshot is whatever the test seeds. */
function makeScope(value, secrets) {
  const listeners = new Set()
  return {
    boundNamespaces: [],
    setCalls: [],
    getSnapshot() {
      return { status: 'ready', value, base: undefined, user: value, revision: 1, writable: true, mode: 'host', secrets }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(field, next) { this.setCalls.push([field, next]); return Promise.resolve() },
    unset(field) { this.setCalls.push([field, undefined]); return Promise.resolve() },
    emit() { for (const listener of listeners) listener() },
  }
}

/** A slots double mirroring the real contract: inject() runs the callback on declaration. */
function makeSlots(registrations) {
  return {
    inject(_key, callback) { return callback() },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  }
}

/** A React double that renders honestly enough to assert on the tree, and runs mount effects so polling is observable. */
const ReactDouble = {
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useEffect(fn) {
    // Effects run on mount, as React would: without this the voice bar's polling
    // loop never starts and the test would pass on an inert component.
    const cleanup = fn()
    if (typeof cleanup === 'function') ReactDouble.effectCleanups.push(cleanup)
  },
  effectCleanups: [],
  useRef(initial) { return { current: initial } },
  createElement(type, props, ...children) {
    const flat = children.flat()
    return { type, props: props ?? {}, children: flat }
  },
}

/**
 * Execute the emitted bundle against fake globals.
 * @param options - settings value, secrets, and a fetch double.
 * @returns the observed effect record.
 */
function runBundle(options = {}) {
  const registrations = []
  const listeners = []
  const audioInstances = []
  const errors = []
  const scope = makeScope(options.value ?? {}, options.secrets ?? [])
  const slots = makeSlots(registrations)
  const fetchCalls = []

  class FakeAudio {
    constructor(src) {
      this.src = src
      this.preload = ''
      this.currentTime = 0
      audioInstances.push(this)
    }

    play() {
      this.played = (this.played ?? 0) + 1
      return Promise.reject(new Error('NotAllowedError'))
    }

    pause() { this.paused = true }
  }

  const document = {
    addEventListener(type, handler, capture) { listeners.push({ type, handler, capture }) },
    removeEventListener(type, handler) { listeners.push({ type, handler, removed: true }) },
  }

  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'settingsScope') return { bind: (spec) => { scope.boundNamespaces.push(spec.namespace); return scope } }
      return undefined
    },
    inject(_deps, callback) { callback({ get: (name) => ctx.get(name) }) },
    effect(fn) { return fn() },
  }

  let handoff
  installFakes({
    window: { __ModuleLoader__: { load(h) { handoff = h } } },
    document,
    Audio: FakeAudio,
    fetch: (url, init) => {
      fetchCalls.push({ url, init })
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ ok: true, dir: '/tmp/voice', clip: null })),
      })
    },
  })

  const originalError = console.error
  console.error = (...args) => { errors.push(args) }
  try {
    new Function(CODE)()
    const registeredId = handoff?.id
    const exportsObj = handoff.factory((spec) => {
      if (spec === 'react') return ReactDouble
      throw new Error(`unexpected require(${JSON.stringify(spec)})`)
    })
    exportsObj.apply(ctx)
    return { registeredId, exportsObj, scope, slots, registrations, listeners, audioInstances, errors, fetchCalls }
  } finally {
    console.error = originalError
  }
}

/** Every string leaf in a rendered tree. */
function texts(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(texts)
  return texts(node.children)
}

/** Depth-first search for the first element matching the predicate. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (predicate(node)) return node
  return find(node.children, predicate)
}

/** Every listener still armed on the fake document. */
function armed(record) {
  return record.listeners.filter(entry => entry.removed !== true)
}

console.log('bundle registration')
const run = runBundle({ value: { model: 'cosyvoice-v3.5-plus', voiceId: 'v1', reply: false, length: 'short', bootSound: true, outputDir: '' } })
check('factory registers the plugin id', run.registeredId === 'dsh-voice', run.registeredId)
check('factory exports an apply function', typeof run.exportsObj?.apply === 'function')
check('apply ran without swallowing an error', run.errors.length === 0, JSON.stringify(run.errors))

console.log('\nsettings scope and slots')
check('bound the settings namespace "voice"', run.scope.boundNamespaces[0] === 'voice', JSON.stringify(run.scope.boundNamespaces))
const ids = run.registrations.map(entry => `${entry.options.name}#${entry.options.id ?? entry.options.key}`)
check('contributed the voice bar to the composer dock', ids.includes('conversation.composer.dock#voice-bar'), JSON.stringify(ids))
check('contributed the settings page', ids.includes('settings.section#voice'), JSON.stringify(ids))
check('registered exactly two contributions', run.registrations.length === 2, String(run.registrations.length))

console.log('\nsettings page renders every row')
const page = run.registrations.find(entry => entry.options.name === 'settings.section')
const tree = page.component({})
const labels = texts(tree).join(' | ')
for (const label of ['API Key', '合成模型', '音色 ID', '语音回答', '语音长度', '输出目录', '开机提示音']) {
  check(`row "${label}" is present`, labels.includes(label))
}
const keyInput = find(tree, n => n.type === 'input' && n.props.type === 'password')
check('the API key field is a password input', keyInput !== undefined)
check('the API key field starts empty (write-only)', keyInput?.props?.value === '')
check('an unset key reports 未配置', labels.includes('未配置'))
const bootBox = find(tree, n => n.type === 'input' && n.props['aria-label'] === undefined && n.props.type === 'checkbox' && n.props.checked === true)
check('the boot-sound toggle renders checked when on', bootBox !== undefined)

console.log('\nvoice bar: no clip yet renders nothing')
// Checked here, before any later runBundle() replaces the fake fetch these
// closures read at call time.
const bar = run.registrations.find(entry => entry.options.name === 'conversation.composer.dock')
const fetchesBefore = run.fetchCalls.length
check('the bar renders null before any clip exists', bar.component({}) === null)
// The polling loop starts in a mount effect and the request is async, so let the
// microtask queue drain before looking for it.
await new Promise(resolve => { setTimeout(resolve, 0) })
const barFetches = run.fetchCalls.slice(fetchesBefore).map(call => String(call.url))
check('the bar polls the host route on mount', barFetches.some(url => url.includes('/dsh-voice/latest')), JSON.stringify(barFetches))

console.log('\nboot sound')
check('created one Audio element', run.audioInstances.length === 1)
check('the clip is fetched from the host route', run.audioInstances[0]?.src === '/dsh-voice/boot', run.audioInstances[0]?.src)
const armedTypes = armed(run).map(entry => entry.type).sort()
check('armed pointerdown/keydown/click', JSON.stringify(armedTypes) === '["click","keydown","pointerdown"]', JSON.stringify(armedTypes))
check('listeners use capture phase', run.listeners.every(entry => entry.capture === true))

console.log('\nboot sound: first gesture spends exactly one playback')
const gesture = armed(run).find(entry => entry.type === 'click')
gesture.handler()
gesture.handler()
check('two gestures still play once', run.audioInstances[0].played === 2, `play() calls: ${run.audioInstances[0].played} (1 immediate + 1 gesture)`)
check('all three listeners disarmed', run.listeners.filter(e => e.removed === true).length === 3)

console.log('\nboot sound: stored preference off')
const off = runBundle({ value: { bootSound: false } })
check('apply still ran cleanly', off.errors.length === 0, JSON.stringify(off.errors))
check('no Audio element is created', off.audioInstances.length === 0)
check('the settings page is still registered', off.registrations.some(e => e.options.name === 'settings.section'))

console.log('\nboot sound: a late "off" retracts the arming')
const late = runBundle({ value: { bootSound: true } })
check('armed optimistically before settings arrived', late.audioInstances.length === 1)
const lateScope = late.scope
const originalGetSnapshot = lateScope.getSnapshot
lateScope.getSnapshot = () => ({ ...originalGetSnapshot.call(lateScope), value: { bootSound: false } })
lateScope.emit()
check('disarmed after the stored false arrived', late.listeners.filter(e => e.removed === true).length === 3,
  JSON.stringify(late.listeners.filter(e => e.removed === true).map(e => e.type)))

restoreFakes()

console.log('\nhost half: settings schema')
const { loadHarnessModule, harnessAnchor } = await import(pathToFileURL(join(HERE, 'host', 'harness.js')).href)
const { voiceSettingsSchema, VOICE_NAMESPACE } = await import(pathToFileURL(join(HERE, 'host', 'settings.js')).href)
// The schema and its secret redaction are implemented by the harness' own
// packages, so these checks need a DSH installation to resolve them from. A CI
// runner has none, and failing there would say nothing about this plugin — the
// schema is exercised for real the moment the plugin mounts. Skipping is
// explicit rather than silent, and never counts as a pass.
let schemastery
let redactSecrets
try {
  const mod = await loadHarnessModule('@deepseek-ai/schemastery')
  schemastery = mod.default ?? mod
  redactSecrets = (await loadHarnessModule('@deepseek-ai/dsh-settings')).redactSecrets
} catch (error) {
  schemastery = undefined
}
if (schemastery === undefined || typeof redactSecrets !== 'function') {
  skip('schema defaults and key redaction', `no DSH installation resolvable from ${harnessAnchor()}`)
} else {
  const schema = voiceSettingsSchema(schemastery)
  check('namespace is "voice"', VOICE_NAMESPACE === 'voice', VOICE_NAMESPACE)
  const defaults = schema({})
  check('defaults are complete', defaults.model === 'cosyvoice-v3.5-plus' && defaults.reply === false
    && defaults.length === 'short' && defaults.bootSound === true && defaults.outputDir === '', JSON.stringify(defaults))
  const redacted = redactSecrets(schema, { ...defaults, apiKey: 'sk-do-not-leak' })
  check('the API key never appears in a redacted value', JSON.stringify(redacted.value).includes('sk-do-not-leak') === false)
  check('redaction reports the key as set', redacted.secrets.some(s => s.path[0] === 'apiKey' && s.set === true), JSON.stringify(redacted.secrets))
}

console.log('\nhost half: audio store')
const { AudioStore, clipStamp, resolveOutputDir } = await import(pathToFileURL(join(HERE, 'host', 'synth.js')).href)
check('clipStamp has the request-time shape', /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(clipStamp(new Date(2026, 8, 10, 13, 5, 57))), clipStamp(new Date(2026, 8, 10, 13, 5, 57)))
check('an empty override resolves to the plugin directory', /voice[\\/]audio$/.test(resolveOutputDir('')), resolveOutputDir(''))
check('a configured override is honoured verbatim', resolveOutputDir('  /somewhere/else  ') === '/somewhere/else', resolveOutputDir('  /somewhere/else  '))
const guard = new AudioStore(() => 'D:/does-not-matter')
check('a traversal name is refused', guard.pathOf('../../secret.mp3') === undefined)
check('a non-clip name is refused', guard.pathOf('notes.txt') === undefined)
// A real directory, so this asserts the existence check rather than a guess.
const scratch = join(HERE, '.verify-tmp')
mkdirSync(scratch, { recursive: true })
try {
  const real = new AudioStore(() => scratch)
  const written = real.write(Buffer.from('not really audio'))
  check('write() names the clip by request time', /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp3$/.test(written.name), written.name)
  const second = real.write(Buffer.from('again'))
  check('write() never overwrites (collision gets a suffix)', second.name !== written.name && /_\d+\.mp3$/.test(second.name), second.name)
  check('latest() returns the newest clip', real.latest().name === second.name, real.latest().name)
  check('a real clip name resolves to its path', real.pathOf(written.name) !== undefined)
  check('a well-formed but absent name is refused', real.pathOf('1999-01-01_00-00-00.mp3') === undefined)
  check('clear() removes every clip', real.clear() === 2 && real.list().length === 0)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log('\nhost half: the command line handed to the shell service')
// Regression guard for the bug that broke synthesis in the field: on Windows this
// harness' shell service evaluates the line as PowerShell, where a quoted command
// name followed by another quoted string is a parse error. Only path-like
// arguments may be quoted.
{
  let captured
  const fakeCtx = {
    shell: {
      resolve(spec) { captured = spec; return spec },
      async run() { return { exitCode: 0, stdout: { text: 'AA==' }, stderr: { text: '' } } },
    },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-read', workspaceRoot: '/tmp' }) },
  }
  const { VoiceSynthesizer } = await import(pathToFileURL(join(HERE, 'host', 'synth.js')).href)
  const scope = { get: () => ({ apiKey: 'k', voiceId: 'v', model: 'm', outputDir: '' }) }
  const store = { write: bytes => ({ name: 'x.mp3', path: '/x.mp3', bytes: bytes.length }) }
  await new VoiceSynthesizer(fakeCtx, scope, store).synthesize('hello')
  const command = String(captured?.command ?? '')
  check('the command was built at all', command !== '')
  check('the interpreter is NOT quoted', !command.startsWith('"'), command.slice(0, 40))
  check('the command starts with a bare interpreter name', /^[a-z0-9._-]+ "/i.test(command), command.slice(0, 40))
  check('the script path IS quoted (it may contain spaces)', /"[^"]*synthesize\.py"/.test(command), command)
  check('the shell keeps the plugin directory as workdir', String(captured?.workdir).endsWith('dsh-voice'), String(captured?.workdir))
  check('the payload travels in the environment, never the command line',
    command.includes('hello') === false && captured?.env?.DSH_VOICE_TEXT === 'hello')
  check('the resolved sandbox policy is passed through, with no hard-coded root',
    captured?.sandboxPolicy?.workspaceRoot === '/tmp', JSON.stringify(captured?.sandboxPolicy))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
