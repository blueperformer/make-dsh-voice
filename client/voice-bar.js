/**
 * The persistent voice bar: a single-line player docked under the composer that
 * follows the newest synthesized clip.
 *
 * It polls rather than subscribing, because the clip is produced by a *host*
 * tool call and by the settings page's preview button, not by anything this page
 * can observe — a push channel would have to be invented for a case a 1.5 s poll
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
  // rejection is not an error — it is the signal to reveal the manual button.
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
  React.createElement('span', { style: { flexShrink: 0, whiteSpace: 'nowrap' } }, '🔊 语音'),
  React.createElement('button', {
    type: 'button',
    style: Object.assign({}, BUTTON, { flexShrink: 0, padding: '2px 10px' }),
    onClick: replay,
  }, status === 'blocked' ? '▶ 播放' : '重播'),
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
      label: 'AI语音条',
    }, VoiceBar)
  })
}
