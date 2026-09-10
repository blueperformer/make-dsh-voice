# dsh-voice

Voice for the [DeepSeek Harness](https://github.com/deepseek-ai) Web UI, in one
package:

| Module | What it does |
| --- | --- |
| **`voice_speak` tool** | The agent synthesizes speech with your own cloned voice |
| **Voice bar** | A single-line player docked under the composer, following the newest clip |
| **Voice settings page** | Settings → 语音: key, model, voice, reply policy, length, output folder |
| **Boot sound** | Plays a clip at the first user gesture after the page loads, toggleable |

Synthesis runs through Alibaba Cloud Bailian (DashScope) `cosyvoice` models.

![no dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)

[中文说明 →](README.zh.md)

---

## Requirements

- **Windows 11.** That is the only environment this plugin has been run in;
  Linux and macOS are untested.
- DeepSeek Harness with the Web profile (`dsh web`).
- `pnpm` on `PATH` — `dsh plugin` forwards to it.
- **Python 3** with the DashScope SDK, and **ffmpeg** on `PATH`:
  ```bash
  pip install dashscope
  ```
  ffmpeg is optional; without it the lead-silence step is skipped and everything
  else still works. (Note: as of this release the library does not yet support
  Python 3.14.)
- An Alibaba Cloud Bailian API key from
  <https://bailian.console.aliyun.com/>, plus an **enrolled voice id**.
  If you would rather not enroll your own, you can try the one this project uses
  (a voice extracted by the author):
  ```
  MODEL_ID=cosyvoice-v3.5-plus
  VOICE_ID=cosyvoice-v3.5-plus-bailian-8b77bd1294fd46b4a5dfea5df9be727c
  ```
- The synthesis model must be the one the voice was enrolled under, or the engine
  rejects the request outright.
- Node.js 18+ only if you want to rebuild the browser bundle; the committed
  `lib/client.js` is ready to use.

## Install

```bash
# from a clone...
dsh plugin --profile web add /absolute/path/to/dsh-voice

# ...or straight from git
dsh plugin --profile web add github:blueperformer/make-dsh-voice
```

Then **restart DSH**. That is the whole install: the package declares
`dsh.bundle`, so the CLI appends it to the profile's `dsh.profile.bundles`, and
its own `cordis.patch.yml` contributes the plugin row. Nothing to hand-edit.

> A bundle layer is composed at boot, so the restart is what activates it.

Then open **Settings → 语音** and paste your API key once. Satisfy yourself that
your other plugins are trustworthy before you do — a DSH plugin shares the host
process and can read the settings document. After the paste, the key is never
sent back to the browser; the field reports `已配置` instead.

## Settings

Every value lives in `$DSH_HOME/settings.yaml` under the `voice:` section, which
you can edit by hand; the running plugin hot-reloads the file.

```yaml
voice:
  apiKey: ''                 # secret: never returned to the browser
  model: cosyvoice-v3.5-plus # must match the model the voice was enrolled under
  voiceId: cosyvoice-v3.5-plus-bailian-...
  reply: false               # whether the agent speaks every reply
  length: short              # short | auto | full
  bootSound: true
  outputDir: ''              # empty = $DSH_HOME/voice/audio
```

| Field | Notes |
| --- | --- |
| `apiKey` | A schemastery `role('secret')` field. The settings transport strips it from every value sent to a browser, so the page can learn *whether* a key is set but never read one. Writes still work because the scope writes path-addressed edits rather than restating a document. |
| `reply` | Injected into the system prompt each turn, so toggling it changes the very next answer with no restart. |
| `length` | `short` asks for one or two sentences; `auto` lets the model choose; `full` speaks the whole answer. |
| `outputDir` | Any absolute path. The default keeps audio inside the harness home. |

Text fields save on the button; checkboxes and the length selector write
immediately.

## Use your own boot clip

```bash
cp /path/to/clip.mp3 assets/boot.mp3
```

No rebuild needed — the host streams the file from `/dsh-voice/boot`, so
replacing the clip only requires a page reload.

**A boot sound cannot play before the first user interaction.** Browsers refuse
unmuted audio before the document has been interacted with, so the module arms
two triggers and spends exactly one playback: an immediate attempt (which wins
only where autoplay is already permitted — for example `chrome
--autoplay-policy=no-user-gesture-required`) and, failing that, your first
pointer/key/click.

## Synthesis tuning

Both knobs live at the top of `synthesize.py`:

- `DEFAULT_ENGLISH_PAD = 'to'` — across repeated testing the engine eats the first
  syllable of an English-led clip in some cases; a throwaway pad word absorbs that
  loss. Chinese is unaffected and gets no pad.
- `DEFAULT_LEAD_SILENCE_MS = 400` — lead silence via ffmpeg, so the first
  syllable is not clipped by the player.

Both are also command-line flags, and `synthesize.py` runs standalone:

```bash
python synthesize.py --text "hello"
python synthesize.py --text "hello" --output ./a.mp3 --lead-silence-ms 800
```

## Uninstall

```bash
dsh plugin --profile web remove dsh-voice
```

The CLI reconciles the layer list, so the package also leaves
`dsh.profile.bundles`. Restart DSH. Your `voice:` settings section is left
behind and harmless.

## How it works

```
package.json        dsh.bundle.patch (install wiring) + dsh.client (the browser row)
cordis.patch.yml    the one row this plugin adds to the composition
host/index.js       wiring: settings namespace, prompt contribution, tool, routes
host/settings.js    the voice settings schema (apiKey is a secret field)
host/synth.js       the audio directory and the bridge to Python
host/routes.js      /dsh-voice/{latest,audio,speak,boot,open,clear}
host/harness.js     resolving the harness' own packages (see below)
synthesize.py       the synthesizer
client/*.js         browser modules, concatenated into lib/client.js by build.mjs
lib/client.js       generated bundle — the artifact the browser runs
build.mjs           concatenation + artifact assertions
verify.mjs          53 behavioral assertions over both halves
```

Three decisions are worth knowing about.

**The browser half talks HTTP, not typed remote RPC.** A route is a plain Node
handler, so the plugin ships JSON and audio bytes without generating a wire
schema, and the browser side stays hand-written with no build step beyond
concatenation.

**Python never writes a file.** It returns the clip as base64 on stdout and the
host writes it with `node:fs`. So the subprocess needs no write permission, no
writable workspace, and no temporary input file — which is why this plugin has no
"write denied" failure mode and no temp-file cleanup to do.

**The harness packages are resolved through `host/harness.js`, not imported by
name.** A plugin installed from a local path arrives as a symlink, so Node
resolves its imports from the package's *real* directory — the checkout, which
lies outside the profile tree. The parent walk then never reaches
`$DSH_HOME/profiles/node_modules`, the flat fallback that makes harness packages
resolvable, and a bare `import '@deepseek-ai/dsh-tools'` fails with
`ERR_MODULE_NOT_FOUND`. That is exactly what a reader of this repository does
first: clone, then install from the checkout. The shim locates those packages
through an anchor inside that fallback directory and imports them by file URL, so
only the published names matter.

## Troubleshooting

**Nothing appears.** Check the row reached the boot manifest:

```bash
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-voice[^"]*'
```

Empty means the package is not in the composition — confirm it is listed in
`$DSH_HOME/profiles/web/package.json` under `dsh.profile.bundles`, and that you
restarted.

**"未配置 API Key".** Paste the key in Settings → 语音. If the row reports
`已配置` but synthesis still fails, the key is wrong or lacks DashScope access.

**Engine returns error 418.** The synthesis model does not match the model the
voice was enrolled under. They must be identical.

**`python` not found.** The plugin tries `python`, then `python3`, then `py` and
caches whichever works. Install Python 3 and the DashScope SDK.

**The tool fails and the message is long.** The host surfaces the script's stderr
verbatim (truncated to 700 characters), so it usually names the real cause —
missing package, bad key, or a model/voice mismatch.

## Limitations

- **Chinese UI.** Every user-facing string is Chinese, the tool description
  included. (The author's English is limited and much of the intended content is
  not written yet; updates will follow.)
- **It binds to DSH internals.** Given the trust model DSH plugins run under,
  none of the interfaces used here carry a public stability promise: the
  `dsh.client` manifest shape, `__DSH_BOOT__`, `window.__ModuleLoader__.load`,
  the `settings.section` and `conversation.composer.dock` slots,
  `dsh.bundle.patch`, and the harness package names the shim resolves. Verified
  against `0.1.0-rc.7`.
- **A local-path install is a live link** Editing the checkout while DSH runs
  affects the running plugin; the client bundle is picked up on the next page
  load, the host half on the next restart.
- **The agent may not speak.** Voice replies are driven by prompt injection, so
  the model can ignore the instruction and answer in text only. Expect this to
  happen sometimes.
