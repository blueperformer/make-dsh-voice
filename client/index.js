/**
 * Bundle entry: wires the modules in this plugin together.
 *
 * `apply` must never throw. Every module here contributes UI or arms audio, and
 * a failure in one of them must not take the composer down with it — so the body
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
