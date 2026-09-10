/**
 * Audio storage and synthesis: the plugin's own data directory, and the bridge
 * to the Python synthesizer.
 *
 * Two decisions here are what make this package portable.
 *
 * **The plugin owns its files.** It writes with `node:fs` rather than through
 * the agent-facing `fs` service, exactly as the shipped JSON storage backend
 * does. That matters because this plugin is mounted once for the whole process
 * and has no session: a policy resolved without one falls back to a
 * deployment-wide root, so any hard-coded workspace path would be wrong on every
 * other machine. Owning a directory under the harness home removes the question
 * entirely.
 *
 * **Python never writes anything.** The clip comes back as base64 on stdout and
 * is written here. So the subprocess needs no write permission, no writable
 * workspace, and no temporary input file — the whole class of "write denied"
 * failures cannot occur.
 * @module dsh-voice/synth
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome } from './harness.js'

/** Synthesized clip filename: the request time, to the second. */
const CLIP_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.mp3$/

/** Interpreter candidates, in order. macOS and Linux rarely ship a bare `python`. */
const PYTHON_CANDIDATES = ['python', 'python3', 'py']

/** Stdout cap for one synthesis. A minute of speech is well under a megabyte; base64 inflates it by a third. */
const STDOUT_LIMIT = 64 * 1024 * 1024

/** Absolute path of the bundled synthesizer, resolved from this module's own location. */
export const SYNTH_SCRIPT = fileURLToPath(new URL('../synthesize.py', import.meta.url))

/** Zero-pad a number to a fixed width. */
function pad(value, width) {
  return String(value).padStart(width, '0')
}

/** The request-time stamp used for filenames: `2026-09-10_13-05-57`. */
export function clipStamp(now = new Date()) {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`
    + `_${pad(now.getHours(), 2)}-${pad(now.getMinutes(), 2)}-${pad(now.getSeconds(), 2)}`
}

/**
 * The plugin's audio directory: the configured override, else a directory this
 * plugin owns under the harness home.
 * @param configured - the `outputDir` setting (empty means the default).
 * @returns the absolute directory path.
 */
export function resolveOutputDir(configured) {
  const trimmed = String(configured || '').trim()
  return trimmed === '' ? join(dshHome(), 'voice', 'audio') : trimmed
}

/** Owns one audio directory: listing, newest lookup, and clearing. */
export class AudioStore {
  /**
   * @param getOutputDir - reads the current `outputDir` setting on every call, so a settings change needs no restart.
   */
  constructor(getOutputDir) {
    this.getOutputDir = getOutputDir
  }

  /** @returns the absolute directory this store currently writes to. */
  dir() {
    return resolveOutputDir(this.getOutputDir())
  }

  /** Create the directory if absent. @returns the directory path. */
  ensure() {
    const dir = this.dir()
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Write one clip, never overwriting: a name already taken gains an `_n` suffix.
   * @param bytes - the encoded audio.
   * @returns the written clip's name, absolute path, and size.
   */
  write(bytes) {
    const dir = this.ensure()
    const stamp = clipStamp()
    let name = `${stamp}.mp3`
    let n = 1
    while (existsSync(join(dir, name))) {
      name = `${stamp}_${String(n)}.mp3`
      n += 1
    }
    const path = join(dir, name)
    writeFileSync(path, bytes)
    return { name, path, bytes: bytes.length }
  }

  /**
   * Every stored clip, oldest name first.
   * @returns clip names (the stamp sorts lexicographically, so the name order is the time order).
   */
  list() {
    const dir = this.dir()
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir).filter(entry => CLIP_NAME.test(entry)).sort()
    } catch {
      return []
    }
  }

  /**
   * The most recent clip.
   * @returns its name and size, or undefined when the directory holds none.
   */
  latest() {
    const names = this.list()
    const name = names.at(-1)
    if (name === undefined) return undefined
    const path = join(this.dir(), name)
    try {
      return { name, path, bytes: statSync(path).size }
    } catch {
      return undefined
    }
  }

  /**
   * Resolve one clip name to a path inside the directory.
   *
   * The name is validated against the clip pattern rather than merely joined, so
   * a request can never walk out of the directory.
   * @param name - the clip filename to resolve.
   * @returns the absolute path, or undefined when the name is not a clip name.
   */
  pathOf(name) {
    const candidate = String(name || '')
    if (!CLIP_NAME.test(candidate)) return undefined
    const path = join(this.dir(), candidate)
    return existsSync(path) ? path : undefined
  }

  /**
   * Delete every clip in the directory.
   * @returns how many files were removed.
   */
  clear() {
    const dir = this.dir()
    let removed = 0
    for (const name of this.list()) {
      try {
        rmSync(join(dir, name), { force: true })
        removed += 1
      } catch {
        // A locked file (still open in a player) is skipped, not fatal.
      }
    }
    return removed
  }
}

/** Runs the bundled Python synthesizer and stores what it returns. */
export class VoiceSynthesizer {
  /**
   * @param ctx - the host plugin context.
   * @param scope - the `voice` settings scope.
   * @param store - the audio store.
   */
  constructor(ctx, scope, store) {
    this.ctx = ctx
    this.scope = scope
    this.store = store
    /** Cached interpreter that worked, so the probe cost is paid once. */
    this.interpreter = undefined
  }

  /**
   * Synthesize one text and store the clip.
   * @param text - what to say.
   * @returns the stored clip's name, path, and size.
   * @throws {Error} when the settings are incomplete or the synthesizer fails.
   */
  async synthesize(text) {
    const said = String(text || '').trim()
    if (said === '') throw new Error('没有可朗读的文本。')

    const settings = this.scope.get()
    const apiKey = String(settings.apiKey || '').trim()
    const voiceId = String(settings.voiceId || '').trim()
    if (apiKey === '') throw new Error('未配置 API Key。请在 设置 → 语音 中填写阿里云百炼的 Key。')
    if (voiceId === '') throw new Error('未配置音色 ID。请在 设置 → 语音 中填写复刻音色 ID。')

    const stdout = await this.run({
      DSH_VOICE_TEXT: said,
      DASHSCOPE_API_KEY: apiKey,
      DSH_VOICE_MODEL: String(settings.model || '').trim(),
      DSH_VOICE_VOICE_ID: voiceId,
    })

    const encoded = stdout.trim().split(/\s+/).join('')
    if (encoded === '') throw new Error('合成器没有返回音频数据。')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length === 0) throw new Error('合成器返回的音频数据为空。')
    return this.store.write(bytes)
  }

  /**
   * Run the synthesizer, discovering a working interpreter on first use.
   * @param env - the variables the script reads (added to the inherited environment).
   * @returns the script's stdout.
   */
  async run(env) {
    const candidates = this.interpreter === undefined ? PYTHON_CANDIDATES : [this.interpreter]
    const failures = []
    for (const interpreter of candidates) {
      const attempt = await this.spawn(interpreter, env)
      if (attempt.ok) {
        this.interpreter = interpreter
        return attempt.stdout
      }
      failures.push(`${interpreter}: ${attempt.detail}`)
    }
    throw new Error(`语音合成失败。\n${failures.join('\n')}`)
  }

  /**
   * Spawn the synthesizer once through the shell service.
   *
   * The shell service rather than `node:child_process`: in this harness'
   * confined modes a spawned program cannot open the named pipes that piped
   * stdio needs, so a direct `execFileSync` fails with EPERM while the shell
   * service's own capture path works.
   *
   * Nothing the user or the model wrote reaches the command line — the text
   * travels in an environment variable — so no quoting or escaping rule can be
   * violated by the payload.
   * @param interpreter - the Python executable to try.
   * @param env - extra environment variables.
   * @returns whether it succeeded, its stdout, and a failure detail when it did not.
   */
  async spawn(interpreter, env) {
    let result
    try {
      const spec = this.ctx.shell.resolve({
        // The interpreter stays UNQUOTED on purpose. On Windows this harness'
        // shell service evaluates the line as PowerShell, where a quoted command
        // name followed by another quoted string is a parse error
        // (`Unexpected token '"…"' in expression or statement`). PowerShell's
        // call operator would fix that dialect but `&` means "background" in
        // bash, and this line has to survive both. A bare command name resolves
        // through PATH in either shell, so only the path-like argument is quoted.
        command: interpreter + ' ' + quote(SYNTH_SCRIPT) + ' --stdout-base64',
        workdir: dirname(SYNTH_SCRIPT),
        timeoutMs: 180_000,
        stdoutMaxBytes: STDOUT_LIMIT,
        env: { ...process.env, ...env },
        // The deployment's own policy, never a hard-coded root: this plugin is
        // mounted process-wide and has no session to resolve one from.
        sandboxPolicy: this.ctx.sandboxPolicy.resolve(),
      })
      result = await this.ctx.shell.run(spec)
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    if (result.exitCode === 0) {
      return { ok: true, stdout: String((result.stdout && result.stdout.text) || '') }
    }
    const stderr = String((result.stderr && result.stderr.text) || '').trim()
    const stdout = String((result.stdout && result.stdout.text) || '').trim()
    return {
      ok: false,
      detail: `exit ${String(result.exitCode)} — ${(stderr || stdout || 'no output').slice(0, 700)}`,
    }
  }
}

/**
 * Quote one path-like command-line argument.
 *
 * Only for arguments that are paths. A command *name* must stay bare: on Windows
 * the shell service evaluates the line as PowerShell, where `"cmd" "arg"` is a
 * syntax error, while a bare `cmd "arg"` is valid in PowerShell and bash alike.
 * @param value - the path to quote.
 * @returns the quoted path.
 */
function quote(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"'
}
