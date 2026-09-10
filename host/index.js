/**
 * dsh-voice — node half.
 *
 * One row in the composition and one package to install, carrying four things:
 *
 *   1. a `voice` settings namespace, persisted in the harness' own user settings
 *      document;
 *   2. a per-turn system-prompt contribution telling the agent whether to speak;
 *   3. the `voice_speak` tool;
 *   4. the HTTP surface the browser half reads — latest clip, clip bytes,
 *      synthesize, reveal the folder, clear it.
 *
 * The harness packages it needs are resolved through `./harness.js` rather than
 * imported by name, so the plugin works when installed from a local checkout as
 * well as from a registry. Everything stateful lives in a collaborator
 * ({@link AudioStore}, {@link VoiceSynthesizer}); this file is the wiring.
 * @module dsh-voice
 */

import { fileURLToPath } from 'node:url'
import { loadHarnessModule } from './harness.js'
import { VOICE_NAMESPACE, voiceSettingsSchema } from './settings.js'
import { AudioStore, VoiceSynthesizer } from './synth.js'
import { voiceRoutes } from './routes.js'

/** Stable cordis plugin name. */
export const name = 'dsh-voice'

/**
 * Required services.
 *
 * `webServer` is a hard dependency rather than an optional one: the browser half
 * is useless without its routes, so parking the plugin until routes can be
 * registered is the honest behavior — a half-mounted voice plugin would show an
 * empty bar with nothing to explain it.
 */
export const inject = ['settings', 'shell', 'sandboxPolicy', 'tools', 'systemPrompt', 'webServer']

/**
 * The per-turn instruction that decides whether the model speaks.
 * @param settings - the resolved voice settings.
 * @returns the prompt text for the current turn.
 */
function replyInstruction(settings) {
  if (!settings.reply) {
    return 'Voice reply: OFF. Answer in text only; do not call voice_speak unless the user explicitly asks to hear this reply.'
  }
  const lengthRule = settings.length === 'full'
    ? 'Speak the complete answer.'
    : settings.length === 'auto'
      ? 'Choose a natural length yourself, usually a few sentences.'
      : 'Speak a SHORT summary of the answer, one or two sentences at most, in the same language as your text reply.'
  return 'Voice reply: ON. After composing your text answer, call the voice_speak tool so the user can HEAR it. '
    + lengthRule
    + ' The text reply still matters; the speech is delivered alongside it.'
}

/**
 * Reveal a directory in the platform's file manager.
 *
 * Three spellings because there is no portable one. `cmd /c start` needs an
 * empty title argument on Windows: with a single quoted argument, Windows reads
 * it as the window title instead of the path.
 * @param ctx - the plugin context, supplying the shell service.
 * @param dir - the absolute directory to reveal.
 */
async function revealDirectory(ctx, dir) {
  const command = process.platform === 'win32'
    ? `cmd /c start "" "${dir}"`
    : process.platform === 'darwin'
      ? `open "${dir}"`
      : `xdg-open "${dir}"`
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    timeoutMs: 15_000,
    stdoutMaxBytes: 4096,
    // The deployment's own policy, never a hard-coded root: this plugin is
    // mounted process-wide and has no session to resolve one from.
    sandboxPolicy: ctx.sandboxPolicy.resolve(),
  }))
  if (result.exitCode !== 0) {
    const detail = String((result.stderr && result.stderr.text) || '').trim()
    throw new Error(`打开目录失败: ${detail === '' ? `exit ${String(result.exitCode)}` : detail.slice(0, 200)}`)
  }
}

/**
 * Mount the plugin.
 * @param ctx - the host context.
 */
export async function apply(ctx) {
  const [{ defineTool }, { settingsNamespace }, schemastery] = await Promise.all([
    loadHarnessModule('@deepseek-ai/dsh-tools'),
    loadHarnessModule('@deepseek-ai/dsh-settings'),
    loadHarnessModule('@deepseek-ai/schemastery'),
  ])
  const z = schemastery.default ?? schemastery

  const scope = ctx.settings.register(settingsNamespace(VOICE_NAMESPACE), voiceSettingsSchema(z))
  const store = new AudioStore(() => scope.get().outputDir)
  const synth = new VoiceSynthesizer(ctx, scope, store)
  const log = (message) => { ctx.logger?.warn?.(`[dsh-voice] ${message}`) }

  // The reply policy is re-read on every assembly, so toggling it in the
  // settings page changes the very next turn with no restart.
  ctx.systemPrompt.context({
    name: 'voice-reply-settings',
    order: 120,
    text: () => replyInstruction(scope.get()),
  })

  ctx.tools.register(defineTool({
    name: 'voice_speak',
    description: '将指定文本用已注册的复刻音色合成为语音。当用户要求"用语音说/朗读/念出来/speak/read aloud"或需要语音回复时调用。合成成功后返回语音文件路径, 界面会自动播放。',
    parameters: {
      text: { type: 'string', required: true, description: '要朗读/合成的文本内容。' },
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      },
    },
    async execute(args) {
      const text = String((args && args.text) || '').trim()
      if (text === '') return '错误: text 为空。'
      try {
        const clip = await synth.synthesize(text)
        return `语音合成成功:\n${clip.path}\n(${String(clip.bytes)} bytes, 已就绪可供播放)`
      } catch (error) {
        return `语音合成失败: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }))

  for (const route of voiceRoutes({
    store,
    synth,
    bootClip: fileURLToPath(new URL('../assets/boot.mp3', import.meta.url)),
    log,
    openDir: dir => revealDirectory(ctx, dir),
  })) {
    ctx.webServer.register(route)
  }
}
