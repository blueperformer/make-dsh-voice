/**
 * Shared client-side plumbing for every dsh-voice module.
 *
 * All of these files are concatenated into one bundle by `build.mjs` and share a
 * single factory scope, so a function declared here is directly callable from
 * `voice-bar.js`, `settings-page.js`, and `boot-sound.js`. The order in
 * `build.mjs` is the declaration order.
 *
 * The bundle is a plain classic script: no TypeScript, no JSX, no imports, and
 * nothing but `react` from the module table.
 */

/** Route prefix owned by the host half. */
var ROUTE_PREFIX = '/dsh-voice'

/** Settings namespace registered by the host half. */
var VOICE_NAMESPACE = 'voice'

/** Must equal this package's name: the boot-graph row id is the registration key. */
var PLUGIN_ID = 'dsh-voice'

/** Surface tokens from the host theme, each with a fallback so a missing token degrades instead of blanking. */
var T = {
  text: 'var(--dsw-alias-label-primary, inherit)',
  textDim: 'var(--dsw-alias-label-secondary, inherit)',
  textFaint: 'var(--dsw-alias-label-tertiary, inherit)',
  border: 'var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.24))',
  borderSoft: 'var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.16))',
  panel: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.06))',
  accent: 'var(--dsw-alias-brand-primary, currentColor)',
}

/** Row layout shared by every settings row, mirroring the shipped rows. */
var ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '14px 0',
  borderBottom: '1px solid ' + T.borderSoft,
}

/** The label column of a settings row. */
var ROW_LABEL = {
  flex: 'none',
  width: '96px',
  fontSize: '13px',
  lineHeight: '20px',
  color: T.textDim,
}

/** The flexible column of a settings row. */
var ROW_BODY = {
  flex: '1',
  minWidth: '0',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}

/** A text input matching the host's own rows. */
var INPUT = {
  flex: '1',
  minWidth: '0',
  padding: '6px 9px',
  borderRadius: '6px',
  border: '1px solid ' + T.border,
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
  color: T.text,
  font: 'inherit',
  fontSize: '12px',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
}

/** A secondary button. */
var BUTTON = {
  flex: 'none',
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid ' + T.border,
  background: 'transparent',
  color: T.text,
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
}

/** Muted explanatory text under a row. */
var HINT = {
  fontSize: '12px',
  lineHeight: '18px',
  color: T.textFaint,
  padding: '2px 0 10px',
}

/** A native checkbox tinted with the brand accent. */
var CHECKBOX = {
  width: '18px',
  height: '18px',
  margin: '0',
  cursor: 'pointer',
  accentColor: T.accent,
}

/** A native toggle switch drawn from a checkbox, so no component library is needed. */
var SWITCH = {
  width: '16px',
  height: '16px',
  margin: '0',
  cursor: 'pointer',
  accentColor: T.accent,
}

/**
 * Call one host route.
 *
 * Never throws: a failed call resolves to `{ ok: false, message }` so a render
 * path cannot crash on a transient host error.
 * @param action - route name under the plugin prefix (for example `latest`).
 * @param body - JSON body for a POST; omit for a GET.
 * @returns the parsed response, or a failure envelope.
 */
async function rpc(action, body) {
  try {
    const response = await fetch(ROUTE_PREFIX + '/' + action, body === undefined
      ? { method: 'GET' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
    const text = await response.text()
    if (text === '') return { ok: response.ok }
    try {
      return JSON.parse(text)
    } catch (error) {
      return { ok: false, message: '返回内容不是合法 JSON' }
    }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

/**
 * The audio URL for a clip descriptor.
 * @param clip - a `{ url }` descriptor, or null.
 * @returns the URL, or null.
 */
function clipUrl(clip) {
  return clip && clip.url ? clip.url : null
}

/**
 * Subscribe a component to the voice settings scope.
 *
 * Polling-free: the scope publishes a fresh snapshot on every committed change,
 * including the ones this page did not make, so two browsers stay in step.
 * @param scope - the bound settings scope.
 * @returns `[snapshot, setField, unsetField]`.
 */
function useVoiceSettings(scope) {
  var state = React.useState(function () { return scope.getSnapshot() })
  var snapshot = state[0]
  var setSnapshot = state[1]
  React.useEffect(function () {
    setSnapshot(scope.getSnapshot())
    return scope.subscribe(function () { setSnapshot(scope.getSnapshot()) })
  }, [scope])
  return [
    snapshot,
    function (field, value) { return scope.set(field, value) },
    function (field) { return scope.unset(field) },
  ]
}

/**
 * The settings value, or an empty object while the first read is in flight.
 * @param snapshot - a settings scope snapshot.
 * @returns the resolved settings object.
 */
function settingsOf(snapshot) {
  return snapshot && snapshot.value ? snapshot.value : {}
}

/**
 * Bind the `voice` settings namespace to this plugin's lifecycle.
 * @param ctx - the client plugin context.
 * @returns the scope, or null when the settings service is unavailable.
 */
function bindSettingsScope(ctx) {
  var binder = ctx.get('settingsScope')
  if (binder === undefined || typeof binder.bind !== 'function') return null
  return binder.bind({ namespace: VOICE_NAMESPACE })
}

/**
 * Wait for one client service, then run `run` with it.
 *
 * The declarative `dsh.client.inject` edges already park this plugin until its
 * packages are loaded, so this is the belt to that suspenders: a client cordis
 * whose service appears a tick later must still produce its contribution rather
 * than dropping it with nothing in the console.
 * @param ctx - the client plugin context.
 * @param name - the service name to wait for.
 * @param run - invoked once with a defined service.
 */
function whenService(ctx, name, run) {
  if (typeof ctx.get === 'function') {
    var present = ctx.get(name)
    if (present !== undefined) {
      run(present)
      return
    }
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject([name], function (child) {
        var service = typeof child.get === 'function' ? child.get(name) : undefined
        if (service !== undefined) run(service)
      })
      return
    } catch (error) {
      // Fall through to the timer rather than losing the contribution.
    }
  }
  var tries = 0
  var timer = setInterval(function () {
    if (++tries > 200) {
      clearInterval(timer)
      return
    }
    var service = typeof ctx.get === 'function' ? ctx.get(name) : undefined
    if (service !== undefined) {
      clearInterval(timer)
      run(service)
    }
  }, 100)
}

/**
 * Register one slot contribution, waiting until both the slot registry and the
 * slot declaration exist.
 *
 * Two waits, because they fail differently and both fail silently. The registry
 * arrives with `dsh-client-runtime`; a missing one would drop the contribution
 * with nothing in the console. `slots.inject` then covers the slot itself: it
 * runs the callback when the declaration already exists and again after a later
 * declaration, so a plugin that mounts first still contributes — and a section
 * that unmounts takes the row with it.
 * @param ctx - the client plugin context.
 * @param key - the slot key to contribute to.
 * @param contribute - returns the contribution's disposer.
 */
function contribute(ctx, key, contribute) {
  whenService(ctx, 'slots', function (slots) {
    if (typeof slots.inject !== 'function') return
    slots.inject(key, function () { return contribute(slots) })
  })
}
