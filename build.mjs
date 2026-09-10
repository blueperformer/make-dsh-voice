/**
 * build.mjs — concatenate the client modules into lib/client.js.
 *
 * The client half has to reach the browser as ONE self-contained classic script
 * that registers itself with the module table, so there is no bundler here and
 * nothing to resolve: the modules are plain scripts sharing one factory scope,
 * listed below in declaration order. A function declared in `shared.js` is
 * therefore directly callable from every later file.
 *
 * The clip is NOT embedded. The host serves it at `/dsh-voice/boot`, so replacing
 * `assets/boot.mp3` needs no rebuild — which is also why this output is small and
 * has no binary payload to keep in sync.
 *
 * No build tooling, no dependencies: plain Node.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Package name; also the boot-graph row id the bundle must register under. */
const PLUGIN_ID = 'dsh-voice'

/**
 * Client modules in concatenation order — declaration order, so a later file may
 * call anything an earlier one declared.
 */
const MODULES = [
  'client/shared.js',
  'client/voice-bar.js',
  'client/boot-sound.js',
  'client/settings-page.js',
  'client/index.js',
]

const target = join(HERE, 'lib', 'client.js')

const parts = []
for (const relative of MODULES) {
  const source = readFileSync(join(HERE, relative), 'utf8').replace(/\s+$/, '')
  parts.push(`\t\t// ---- ${relative} ----`)
  parts.push(...toAscii(source).split('\n').map(line => (line === '' ? '' : `\t\t${line}`)))
  parts.push('')
}

/**
 * Escape every non-ASCII code point so the emitted artifact is pure ASCII.
 *
 * The plugin's UI strings are Chinese, and a served script whose charset is ever
 * guessed wrong shows mojibake in the settings page. Escaping removes the
 * assumption: `\uXXXX` inside a string literal is the same string, and the escape
 * is inert inside a comment. `verify.mjs` asserts the rendered labels still come
 * out as the intended text, so a broken escape cannot pass unnoticed.
 * @param text - the source text.
 * @returns the same text with every non-ASCII code point escaped.
 */
function toAscii(text) {
  return text.replace(/[^\u0000-\u007F]/gu, (char) => {
    const code = char.codePointAt(0)
    if (code <= 0xFFFF) return `\\u${code.toString(16).padStart(4, '0')}`
    // Astral code points must be emitted as a surrogate pair.
    const high = Math.floor((code - 0x10000) / 0x400) + 0xD800
    const low = ((code - 0x10000) % 0x400) + 0xDC00
    return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
  })
}

const bundle = [
  '// GENERATED FILE - do not edit by hand. Run `node build.mjs` instead.',
  '// Sources: ' + MODULES.join(', '),
  '',
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(PLUGIN_ID)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  '',
  '\t\tvar React = require("react");',
  '',
  ...parts,
  '\t\texports.apply = apply;',
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, bundle, 'utf8')

// Refuse to report success on an artifact that cannot work. These are the
// failures that would otherwise surface only as a silently missing UI.
const emitted = readFileSync(target, 'utf8')
const problems = []
if (!emitted.includes(`id: ${JSON.stringify(PLUGIN_ID)}`)) problems.push(`does not register "${PLUGIN_ID}"`)
if (!emitted.includes('exports.apply = apply;')) problems.push('does not export apply')
if (!emitted.includes('function apply(ctx)')) problems.push('has no apply function')
for (const symbol of ['registerVoiceBar', 'registerSettingsPage', 'registerBootSound']) {
  if (!emitted.includes(`function ${symbol}(`)) problems.push(`is missing ${symbol}`)
}
if (/[^\u0000-\u007F]/.test(emitted)) problems.push('contains non-ASCII bytes (escape them so the served script cannot be mis-decoded)')
if (problems.length > 0) {
  throw new Error(`dsh-voice: emitted bundle ${problems.join('; ')}`)
}

console.log(`dsh-voice: modules ${String(MODULES.length)}`)
console.log(`dsh-voice: wrote   ${target} (${String(emitted.length)} bytes, ASCII-only)`)
console.log(`dsh-voice: verified id "${PLUGIN_ID}", apply exported, all three modules present`)
