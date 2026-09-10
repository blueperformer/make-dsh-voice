/**
 * Locating the harness' own packages without a bare import.
 *
 * A plugin installed from a **local path** arrives as a symlink, so Node resolves
 * its imports from the package's *real* directory — the checkout, which lies
 * outside the profile tree. The parent walk then never reaches
 * `$DSH_HOME/profiles/node_modules`, the flat fallback that makes harness
 * packages resolvable from any profile, and `import '@deepseek-ai/dsh-tools'`
 * fails. That is precisely the workflow a reader of the repository tries first:
 * clone, then install from the checkout.
 *
 * So the harness packages are located through an anchor *inside* that fallback
 * directory and imported by file URL. What this depends on is the published
 * package names, not where the plugin happens to live.
 *
 * The same file also owns the harness-home resolution, which has to be available
 * before any harness package can be loaded — hence the local copy rather than an
 * import of the package that provides it.
 * @module dsh-voice/harness
 */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Environment variable carrying an explicit harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Resolve the DeepSeek Harness home.
 *
 * Precedence, highest first: an explicit argument, `$DSH_HOME`, then `~/.dsh`.
 * A blank `$DSH_HOME` counts as unset, so an empty override never resolves the
 * home to the working directory.
 * @param configured - explicit override, which wins over the environment.
 * @param env - environment mapping to read `DSH_HOME` from.
 * @returns the absolute harness home.
 */
export function dshHome(configured, env = process.env) {
  const fromEnv = env[DSH_HOME_ENV]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'))
  const expanded = selected === '~' ? homedir() : selected.replace(/^~[/\\]/, '')
  return resolve(expanded)
}

/**
 * The resolution anchor: a path inside the flat module fallback directory.
 *
 * The file itself never exists — `createRequire` only needs it as a starting
 * point, and Node's own parent walk from here finds `profiles/node_modules`,
 * which holds one link per package the installation depends on.
 * @returns the absolute anchor path.
 */
export function harnessAnchor() {
  return join(dshHome(), 'profiles', '_dsh-voice-anchor.js')
}

/**
 * Import one harness package by name, resolved from the harness installation.
 * @param specifier - the package name, as published.
 * @returns the package's module namespace.
 * @throws {Error} when the package cannot be found, naming both the anchor and the likely cause.
 */
export async function loadHarnessModule(specifier) {
  const anchor = harnessAnchor()
  let entry
  try {
    entry = createRequire(anchor).resolve(specifier)
  } catch (cause) {
    throw new Error(
      `dsh-voice: 无法定位 ${specifier}（解析锚点：${anchor}）。`
      + '该锚点用于找到 DSH 安装自身的包；若目录不存在，说明 DSH_HOME 指向了错误的位置，'
      + '或这个 DSH 版本没有提供该包。',
      { cause },
    )
  }
  return import(pathToFileURL(entry).href)
}
