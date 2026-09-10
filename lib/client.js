// GENERATED FILE - do not edit by hand. Run `node build.mjs` instead.
// Sources: client/shared.js, client/voice-bar.js, client/boot-sound.js, client/settings-page.js, client/index.js

window.__ModuleLoader__.load({
	id: "dsh-voice",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");

		// ---- client/shared.js ----
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
		      return { ok: false, message: '\u8fd4\u56de\u5185\u5bb9\u4e0d\u662f\u5408\u6cd5 JSON' }
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
		 * declaration, so a plugin that mounts first still contributes \u2014 and a section
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

		// ---- client/voice-bar.js ----
		/**
		 * The persistent voice bar: a single-line player docked under the composer that
		 * follows the newest synthesized clip.
		 *
		 * It polls rather than subscribing, because the clip is produced by a *host*
		 * tool call and by the settings page's preview button, not by anything this page
		 * can observe \u2014 a push channel would have to be invented for a case a 1.5 s poll
		 * already covers. Plain `setInterval` rather than the client timer service keeps
		 * the module free of any service dependency.
		 */

		/** Poll period once the first response has arrived. */
		var VOICE_BAR_POLL_MS = 1500

		/** Early retries: the host routes may not have finished binding when the page boots. */
		var VOICE_BAR_RETRY_MS = [400, 1200, 2500]

		/**
		 * The docked voice bar.
		 * @returns the bar, or null while nothing has been synthesized yet.
		 */
		function VoiceBar() {
		  var clipState = React.useState(null)
		  var clip = clipState[0]
		  var setClip = clipState[1]
		  var statusState = React.useState('idle')
		  var status = statusState[0]
		  var setStatus = statusState[1]
		  var audioRef = React.useRef(null)
		  var autoTried = React.useRef(false)

		  React.useEffect(function () {
		    var cancelled = false
		    var shown = null

		    function tick() {
		      rpc('latest').then(function (res) {
		        if (cancelled || !res || !res.ok) return
		        var next = res.clip
		        if (next === null || next === undefined) return
		        if (shown === next.name) return
		        shown = next.name
		        autoTried.current = false
		        setClip({ name: next.name, url: clipUrl(next) })
		        setStatus('ready')
		      })
		    }

		    tick()
		    var retries = VOICE_BAR_RETRY_MS.map(function (delay) { return setTimeout(tick, delay) })
		    var timer = setInterval(tick, VOICE_BAR_POLL_MS)
		    return function () {
		      cancelled = true
		      clearInterval(timer)
		      retries.forEach(clearTimeout)
		    }
		  }, [])

		  // Autoplay once per new clip. Browsers refuse this without a user gesture, so a
		  // rejection is not an error \u2014 it is the signal to reveal the manual button.
		  React.useEffect(function () {
		    if (clip === null || audioRef.current === null || autoTried.current) return
		    autoTried.current = true
		    var played = audioRef.current.play()
		    if (played && played.catch) played.catch(function () { setStatus('blocked') })
		  }, [clip])

		  if (clip === null) return null

		  function replay() {
		    if (audioRef.current === null) return
		    var played = audioRef.current.play()
		    if (played && played.catch) played.catch(function () { setStatus('blocked') })
		  }

		  // One line, auto width, and no filename: the name is an implementation detail
		  // the listener has no use for.
		  return React.createElement('div', {
		    style: {
		      display: 'inline-flex',
		      alignItems: 'center',
		      flexWrap: 'nowrap',
		      gap: '8px',
		      padding: '4px 10px',
		      borderRadius: '8px',
		      fontSize: '12px',
		      background: T.panel,
		      color: T.text,
		      boxSizing: 'border-box',
		      overflow: 'hidden',
		      maxWidth: '100%',
		    },
		  },
		  React.createElement('span', { style: { flexShrink: 0, whiteSpace: 'nowrap' } }, '\ud83d\udd0a \u8bed\u97f3'),
		  React.createElement('button', {
		    type: 'button',
		    style: Object.assign({}, BUTTON, { flexShrink: 0, padding: '2px 10px' }),
		    onClick: replay,
		  }, status === 'blocked' ? '\u25b6 \u64ad\u653e' : '\u91cd\u64ad'),
		  React.createElement('audio', {
		    ref: audioRef,
		    controls: true,
		    preload: 'auto',
		    src: clip.url,
		    style: { width: '200px', height: '30px', flexShrink: 0 },
		  }))
		}

		/**
		 * Contribute the voice bar to the composer dock.
		 * @param ctx - the client plugin context.
		 */
		function registerVoiceBar(ctx) {
		  contribute(ctx, 'conversation.composer.dock', function (slots) {
		    return slots.register({
		      name: 'conversation.composer.dock',
		      id: 'voice-bar',
		      order: 10,
		      label: 'AI\u8bed\u97f3\u6761',
		    }, VoiceBar)
		  })
		}

		// ---- client/boot-sound.js ----
		/**
		 * The boot sound module: one clip, played once, at the first user gesture after
		 * the page loads.
		 *
		 * A boot sound cannot simply play on load. Browsers refuse unmuted audio before
		 * the user has interacted with the document, so a clip fired at page-open time is
		 * rejected outright. The module therefore arms two triggers and spends exactly
		 * one playback:
		 *
		 *   1. an immediate attempt at mount, which succeeds only where the browser
		 *      already permits autoplay (an autoplay-policy flag, a high media-engagement
		 *      index, or a per-site allowance) \u2014 that is the true "instant boot sound";
		 *   2. otherwise, the user's first pointer/key/click anywhere on the page.
		 *
		 * Whichever fires first disarms the other, so the clip never plays twice.
		 *
		 * The clip is served by the host (`/dsh-voice/boot`) rather than embedded in this
		 * bundle, so replacing `assets/boot.mp3` needs no rebuild.
		 */

		/** Host route streaming the boot clip. */
		var BOOT_CLIP_URL = ROUTE_PREFIX + '/boot'

		/**
		 * Arm the boot clip.
		 *
		 * The on/off decision is read at playback time rather than at arm time, so
		 * arming never waits on the settings transport. While the settings are still in
		 * flight the default (on) applies; a listener who turned the sound off has
		 * almost certainly done so long before this page loaded, and the subscription
		 * below retracts the arming as soon as a stored `false` arrives.
		 * @param ctx - the client plugin context, used for effect disposal.
		 * @param scope - the bound settings scope, or null when settings are unavailable.
		 */
		function registerBootSound(ctx, scope) {
		  function enabled() {
		    if (scope === null) return true
		    return settingsOf(scope.getSnapshot()).bootSound !== false
		  }

		  function arm() {
		    // With the settings already read and the sound off, do not arm at all: an
		    // armed element would still preload the clip for a listener who asked for
		    // silence. When the settings are still in flight the default (on) applies,
		    // and the subscription below retracts the arming if a stored `false` lands.
		    if (scope !== null && scope.getSnapshot().status === 'ready' && !enabled()) return undefined

		    var audio = new Audio(BOOT_CLIP_URL)
		    audio.preload = 'auto'
		    var spent = false
		    var stopWatching = null

		    function disarm() {
		      document.removeEventListener('pointerdown', onGesture, true)
		      document.removeEventListener('keydown', onGesture, true)
		      document.removeEventListener('click', onGesture, true)
		      if (stopWatching !== null) stopWatching()
		      stopWatching = null
		    }

		    function playNow() {
		      try {
		        audio.currentTime = 0
		        return audio.play()
		      } catch (error) {
		        return Promise.reject(error)
		      }
		    }

		    /** Spend the single playback, if it is still unspent and still wanted. */
		    function spend() {
		      if (spent || !enabled()) return
		      spent = true
		      disarm()
		      var played = playNow()
		      if (played && played.catch) played.catch(function () {})
		    }

		    /** First user contact with the page. */
		    function onGesture() {
		      spend()
		    }

		    // Armed first, so a gesture that lands during the immediate attempt still
		    // counts as the same single playback rather than racing it.
		    document.addEventListener('pointerdown', onGesture, true)
		    document.addEventListener('keydown', onGesture, true)
		    document.addEventListener('click', onGesture, true)

		    // The instant path: resolves only where autoplay is already permitted.
		    var instant = playNow()
		    if (instant && instant.then) {
		      instant.then(function () {
		        if (spent) return
		        spent = true
		        disarm()
		      }, function () {
		        // Refused, as expected on a normal page: the gesture path now owns it.
		      })
		    }

		    // A stored "off" that arrives late retracts the arming before the user can
		    // trigger it.
		    if (scope !== null && typeof scope.subscribe === 'function') {
		      stopWatching = scope.subscribe(function () {
		        if (enabled()) return
		        spent = true
		        disarm()
		      })
		    }

		    return function () {
		      disarm()
		      try {
		        audio.pause()
		      } catch (error) {
		        // A detached element needs no cleanup.
		      }
		    }
		  }

		  if (typeof ctx.effect === 'function') ctx.effect(arm, 'dsh-voice: boot sound')
		  else arm()
		}

		// ---- client/settings-page.js ----
		/**
		 * The Voice settings page: one `settings.section` holding every knob this plugin
		 * exposes, including the boot-sound module's own row.
		 *
		 * Text fields are saved by the button rather than per keystroke, so a half-typed
		 * model name never reaches the host. Booleans and the length selector write
		 * immediately \u2014 they are single decisions, and waiting for a save button on a
		 * checkbox is a worse experience than an extra round trip.
		 *
		 * The API key is write-only by construction: the settings transport redacts it
		 * (`role('secret')` on the host schema), so this page can learn *whether* a key is
		 * set but can never read one back. Leaving the field blank therefore means
		 * "unchanged" rather than "clear".
		 */

		/** Text the preview button synthesizes. */
		var PREVIEW_TEXT = '\u8bed\u97f3\u6a21\u578b\u914d\u7f6e\u6b63\u5e38\uff0c\u8fd9\u662f\u4e00\u6bb5\u6d4b\u8bd5\u8bed\u97f3\u3002'

		/**
		 * Whether the host reports a stored API key.
		 * @param snapshot - a settings scope snapshot.
		 * @returns whether a key is configured.
		 */
		function keyConfigured(snapshot) {
		  var secrets = snapshot && snapshot.secrets
		  if (!Array.isArray(secrets)) return false
		  return secrets.some(function (entry) { return entry.path && entry.path[0] === 'apiKey' && entry.set === true })
		}

		/**
		 * One labelled row.
		 * @param label - the label text.
		 * @param children - the row body.
		 * @param key - the React key.
		 * @returns the row element.
		 */
		function SettingsRow(label, children, key) {
		  return React.createElement('div', { style: ROW, key: key },
		    React.createElement('label', { style: ROW_LABEL }, label),
		    React.createElement('div', { style: ROW_BODY }, children))
		}

		/**
		 * The Voice settings page.
		 * @param props - slot props; the section supplies nothing this page uses.
		 * @returns the page element tree.
		 */
		function VoiceSettingsPage(props) {
		  var paired = useVoiceSettings(props.scope)
		  var snapshot = paired[0]
		  var setField = paired[1]
		  var settings = settingsOf(snapshot)

		  var modelState = React.useState('')
		  var model = modelState[0]
		  var setModel = modelState[1]
		  var voiceState = React.useState('')
		  var voice = voiceState[0]
		  var setVoice = voiceState[1]
		  var keyState = React.useState('')
		  var key = keyState[0]
		  var setKey = keyState[1]
		  var dirState = React.useState('')
		  var dir = dirState[0]
		  var setDir = dirState[1]
		  var msgState = React.useState('')
		  var msg = msgState[0]
		  var setMsg = msgState[1]
		  var busyState = React.useState(false)
		  var busy = busyState[0]
		  var setBusy = busyState[1]
		  var latestState = React.useState(null)
		  var latest = latestState[0]
		  var setLatest = latestState[1]

		  // Seed the editable fields from the host once, and again on an explicit
		  // refresh \u2014 never on every snapshot, or another window's write would fight the
		  // text being typed here.
		  var seeded = React.useRef(false)
		  function seed(force) {
		    if (seeded.current && !force) return
		    var value = settingsOf(props.scope.getSnapshot()).value
		    var current = settingsOf(props.scope.getSnapshot())
		    setModel(String(current.model || ''))
		    setVoice(String(current.voiceId || ''))
		    setDir(String(current.outputDir || ''))
		    setKey('')
		    seeded.current = true
		    return value
		  }
		  React.useEffect(function () {
		    seed(false)
		    refreshLatest()
		    var stop = props.scope.subscribe(function () { seed(false) })
		    return stop
		  }, [])

		  function refreshLatest() {
		    rpc('latest').then(function (res) {
		      if (res && res.ok) setLatest(res)
		    })
		  }

		  async function save() {
		    setBusy(true)
		    setMsg('')
		    try {
		      await setField('model', model.trim())
		      await setField('voiceId', voice.trim())
		      if (dir.trim() === '') await setField('outputDir', '')
		      else await setField('outputDir', dir.trim())
		      if (key.trim() !== '') {
		        await setField('apiKey', key.trim())
		        setKey('')
		      }
		      setMsg('\u5df2\u4fdd\u5b58\u5230\u5bbf\u4e3b\u8bbe\u7f6e\uff08settings.yaml\uff09\u3002')
		    } catch (error) {
		      setMsg('\u4fdd\u5b58\u5931\u8d25: ' + String(error))
		    } finally {
		      setBusy(false)
		    }
		  }

		  async function preview() {
		    setBusy(true)
		    setMsg('\u6b63\u5728\u5408\u6210\u8bd5\u542c\u2026')
		    var res = await rpc('speak', { text: PREVIEW_TEXT })
		    setBusy(false)
		    setMsg(res && res.ok ? '\u8bd5\u542c\u5df2\u751f\u6210\uff0c\u8bf7\u770b\u8f93\u5165\u6846\u4e0b\u65b9\u7684\u8bed\u97f3\u6761\u3002' : ('\u8bd5\u542c\u5931\u8d25: ' + ((res && res.message) || 'unknown')))
		  }

		  async function openDir() {
		    var res = await rpc('open')
		    setMsg(res && res.ok ? '\u5df2\u6253\u5f00\u8f93\u51fa\u76ee\u5f55\u3002' : ('\u6253\u5f00\u5931\u8d25: ' + ((res && res.message) || 'unknown')))
		  }

		  async function clearDir() {
		    var res = await rpc('clear')
		    if (res && res.ok) {
		      setLatest(null)
		      setMsg('\u8f93\u51fa\u76ee\u5f55\u5df2\u6e05\u7406\uff08\u5220\u9664 ' + String(res.removed) + ' \u4e2a\u6587\u4ef6\uff09\u3002')
		    } else {
		      setMsg('\u6e05\u7406\u5931\u8d25: ' + ((res && res.message) || 'unknown'))
		    }
		  }

		  var outputDir = (latest && latest.dir) ? latest.dir : '\uff08\u8bfb\u53d6\u4e2d\u2026\uff09'
		  var status = snapshot && snapshot.status

		  return React.createElement('div', null,
		    React.createElement('div', { style: HINT }, '\u8bed\u97f3\u5408\u6210\u4f7f\u7528\u963f\u91cc\u4e91\u767e\u70bc\uff08DashScope\uff09\u3002\u914d\u7f6e\u4fdd\u5b58\u5728\u5bbf\u4e3b\u7684 settings.yaml \u4e2d\uff0c\u53ef\u76f4\u63a5\u7f16\u8f91\u3002'),

		    status === 'unavailable'
		      ? React.createElement('div', { style: HINT }, '\u5bbf\u4e3b\u8bbe\u7f6e\u547d\u540d\u7a7a\u95f4\u4e0d\u53ef\u7528\u2014\u2014\u8bf7\u786e\u8ba4\u63d2\u4ef6\u5bbf\u4e3b\u534a\u8fb9\u5df2\u52a0\u8f7d\u3002')
		      : null,

		    SettingsRow('API Key', [
		      React.createElement('input', {
		        key: 'key',
		        type: 'password',
		        style: INPUT,
		        value: key,
		        placeholder: keyConfigured(snapshot) ? '\u5df2\u914d\u7f6e\uff08\u7559\u7a7a\u8868\u793a\u4e0d\u4fee\u6539\uff09' : 'sk-...',
		        onChange: function (e) { setKey(e.target.value) },
		      }),
		      React.createElement('span', { key: 'state', style: { flexShrink: 0, fontSize: '12px', color: T.textFaint } },
		        keyConfigured(snapshot) ? '\u5df2\u914d\u7f6e' : '\u672a\u914d\u7f6e'),
		    ], 'apiKey'),

		    SettingsRow('\u5408\u6210\u6a21\u578b', React.createElement('input', {
		      style: INPUT,
		      value: model,
		      placeholder: '\u5982 cosyvoice-v3.5-plus',
		      onChange: function (e) { setModel(e.target.value) },
		    }), 'model'),
		    React.createElement('div', { style: HINT, key: 'modelHint' },
		      '\u5fc5\u987b\u4e0e\u6ce8\u518c\u97f3\u8272\u65f6\u4f7f\u7528\u7684\u6a21\u578b\u4e00\u81f4\uff0c\u5426\u5219\u5f15\u64ce\u4f1a\u62d2\u7edd\u8bf7\u6c42\u3002'),

		    SettingsRow('\u97f3\u8272 ID', React.createElement('input', {
		      style: INPUT,
		      value: voice,
		      placeholder: '\u5982 cosyvoice-v3.5-plus-bailian-...',
		      onChange: function (e) { setVoice(e.target.value) },
		    }), 'voiceId'),

		    SettingsRow('\u8bed\u97f3\u56de\u7b54', [
		      React.createElement('input', {
		        key: 'box',
		        type: 'checkbox',
		        style: CHECKBOX,
		        checked: settings.reply === true,
		        onChange: function (e) { setField('reply', e.target.checked) },
		      }),
		      React.createElement('span', { key: 'note', style: { fontSize: '12px', color: T.textFaint } },
		        settings.reply === true ? '\u6bcf\u6b21\u56de\u7b54\u90fd\u4f1a\u9644\u4e0a\u8bed\u97f3' : '\u4ec5\u6587\u5b57\u56de\u7b54\uff08\u9ed8\u8ba4\uff09'),
		    ], 'reply'),

		    SettingsRow('\u8bed\u97f3\u957f\u5ea6', React.createElement('select', {
		      style: Object.assign({}, INPUT, { fontFamily: 'inherit', cursor: 'pointer' }),
		      value: String(settings.length || 'short'),
		      onChange: function (e) { setField('length', e.target.value) },
		    },
		    React.createElement('option', { value: 'short' }, '\u7b80\u77ed\u6458\u8981\uff08\u4e00\u4e24\u53e5\uff0c\u63a8\u8350\uff09'),
		    React.createElement('option', { value: 'auto' }, '\u81ea\u52a8\uff08\u7531 AI \u5224\u65ad\uff09'),
		    React.createElement('option', { value: 'full' }, '\u5b8c\u6574\u56de\u7b54\uff08\u8f83\u957f\u3001\u8f83\u6162\uff09')), 'length'),

		    SettingsRow('\u8f93\u51fa\u76ee\u5f55', [
		      React.createElement('span', {
		        key: 'path',
		        style: { flex: '1', minWidth: '0', fontSize: '12px', fontFamily: 'monospace', color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
		        title: outputDir,
		      }, outputDir),
		      React.createElement('button', { key: 'open', type: 'button', style: BUTTON, onClick: openDir }, '\u6253\u5f00\u6587\u4ef6\u5939'),
		      React.createElement('button', { key: 'clear', type: 'button', style: BUTTON, onClick: clearDir }, '\u6e05\u7406\u6587\u4ef6'),
		    ], 'dir'),
		    SettingsRow('\u76ee\u5f55\u8986\u76d6', React.createElement('input', {
		      style: INPUT,
		      value: dir,
		      placeholder: '\u7559\u7a7a\u5219\u4f7f\u7528\u63d2\u4ef6\u81ea\u5df1\u7684\u76ee\u5f55',
		      onChange: function (e) { setDir(e.target.value) },
		    }), 'outputDirOverride'),

		    SettingsRow('\u5f00\u673a\u63d0\u793a\u97f3', [
		      React.createElement('input', {
		        key: 'box',
		        type: 'checkbox',
		        style: SWITCH,
		        checked: settings.bootSound !== false,
		        onChange: function (e) { setField('bootSound', e.target.checked) },
		      }),
		      React.createElement('span', { key: 'note', style: { fontSize: '12px', color: T.textFaint } },
		        settings.bootSound !== false
		          ? '\u6253\u5f00\u9875\u9762\u540e\uff0c\u9996\u6b21\u70b9\u51fb\u6216\u6309\u952e\u65f6\u64ad\u653e\u63d0\u793a\u97f3'
		          : '\u5df2\u5173\u95ed\uff0c\u6253\u5f00\u9875\u9762\u65f6\u4e0d\u64ad\u653e\u63d0\u793a\u97f3'),
		    ], 'bootSound'),

		    React.createElement('div', { style: { display: 'flex', gap: '10px', paddingTop: '14px' } },
		      React.createElement('button', { type: 'button', style: BUTTON, onClick: save, disabled: busy }, busy ? '\u5904\u7406\u4e2d\u2026' : '\u4fdd\u5b58'),
		      React.createElement('button', { type: 'button', style: BUTTON, onClick: preview, disabled: busy }, '\u8bd5\u542c'),
		      React.createElement('button', { type: 'button', style: BUTTON, onClick: function () { seed(true); refreshLatest(); setMsg('\u5df2\u91cd\u65b0\u8bfb\u53d6\u3002') } }, '\u5237\u65b0')),

		    msg === '' ? null : React.createElement('div', { style: { paddingTop: '10px', fontSize: '12px', color: T.textDim } }, msg))
		}

		/**
		 * Contribute the Voice settings page.
		 * @param ctx - the client plugin context.
		 * @param scope - the bound settings scope.
		 */
		function registerSettingsPage(ctx, scope) {
		  contribute(ctx, 'settings.section', function (slots) {
		    return slots.register({
		      name: 'settings.section',
		      id: 'voice',
		      order: 30,
		      label: '\u8bed\u97f3',
		    }, function VoiceSectionPage() {
		      return VoiceSettingsPage({ scope: scope })
		    })
		  })
		}

		// ---- client/index.js ----
		/**
		 * Bundle entry: wires the modules in this plugin together.
		 *
		 * `apply` must never throw. Every module here contributes UI or arms audio, and
		 * a failure in one of them must not take the composer down with it \u2014 so the body
		 * is wrapped and each contribution is attempted independently.
		 *
		 * `lib/client.js` is generated from the files in this directory by `build.mjs`,
		 * which concatenates them in the order below; that order is the declaration
		 * order they rely on.
		 */

		/**
		 * Plugin body.
		 * @param ctx - the client plugin context.
		 */
		function apply(ctx) {
		  function withScope(scope) {
		    try {
		      registerVoiceBar(ctx)
		    } catch (error) {
		      console.error('[dsh-voice] voice bar failed:', error)
		    }
		    try {
		      registerSettingsPage(ctx, scope)
		    } catch (error) {
		      console.error('[dsh-voice] settings page failed:', error)
		    }
		    try {
		      registerBootSound(ctx, scope)
		    } catch (error) {
		      console.error('[dsh-voice] boot sound failed:', error)
		    }
		  }

		  whenService(ctx, 'settingsScope', function (binder) {
		    withScope(binder.bind({ namespace: VOICE_NAMESPACE }))
		  })
		}

		exports.apply = apply;
		return module.exports;
	}
});
