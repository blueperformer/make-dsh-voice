/**
 * The `voice` settings namespace: the plugin's entire configuration surface.
 *
 * Registered host-side, so DSH persists it in the user settings document
 * (`$DSH_HOME/settings.yaml`) where it stays hand-editable — which is also why
 * the field names are plain and every default is useful on its own.
 *
 * `apiKey` carries `role('secret')`: every wire surface redacts it, so the
 * browser can learn *whether* a key is set but never read it back. Writes still
 * work from the browser because the settings scope writes path-addressed ops
 * against the section it holds rather than restating a whole document.
 *
 * The schema is a factory rather than a module-level constant because
 * schemastery is resolved from the harness installation at apply time (see
 * `./harness.js`); importing it here at module scope would reintroduce the bare
 * import that breaks path-installed plugins.
 * @module dsh-voice/settings
 */

/** Settings namespace owned by this plugin (lowercase kebab-case, as DSH requires). */
export const VOICE_NAMESPACE = 'voice'

/** Accepted voice-reply lengths; `short` keeps a spoken answer to a sentence or two. */
export const VOICE_LENGTHS = ['short', 'auto', 'full']

/** Field carrying the Bailian API key. Secret: redacted on every wire surface. */
export const API_KEY_FIELD = 'apiKey'

/** Default synthesis model. Must match the model the voice was enrolled under. */
export const DEFAULT_MODEL = 'cosyvoice-v3.5-plus'

/**
 * Build the durable voice settings schema.
 * @param z - the schemastery entry point, resolved from the harness installation.
 * @returns the schema registered for {@link VOICE_NAMESPACE}.
 */
export function voiceSettingsSchema(z) {
  return z.object({
    /** Alibaba Cloud Bailian API key (`sk-...`). Secret. */
    apiKey: z.string().role('secret').default(''),
    /** Synthesis model; a mismatch with the enrolment model makes the engine reject the request. */
    model: z.string().default(DEFAULT_MODEL),
    /** Enrolled (cloned) voice id from the Bailian console. */
    voiceId: z.string().default(''),
    /** Whether the agent should speak every reply. Injected into the system prompt. */
    reply: z.boolean().default(false),
    /** How much of the answer to speak. */
    length: z.union([...VOICE_LENGTHS]).default('short'),
    /** Play a clip at the first user gesture after the page loads. */
    bootSound: z.boolean().default(true),
    /** Where synthesized audio is written. Empty means the plugin's own directory under the harness home. */
    outputDir: z.string().default(''),
  })
}
