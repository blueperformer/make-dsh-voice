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
 *      index, or a per-site allowance) — that is the true "instant boot sound";
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
