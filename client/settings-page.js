/**
 * The Voice settings page: one `settings.section` holding every knob this plugin
 * exposes, including the boot-sound module's own row.
 *
 * Text fields are saved by the button rather than per keystroke, so a half-typed
 * model name never reaches the host. Booleans and the length selector write
 * immediately — they are single decisions, and waiting for a save button on a
 * checkbox is a worse experience than an extra round trip.
 *
 * The API key is write-only by construction: the settings transport redacts it
 * (`role('secret')` on the host schema), so this page can learn *whether* a key is
 * set but can never read one back. Leaving the field blank therefore means
 * "unchanged" rather than "clear".
 */

/** Text the preview button synthesizes. */
var PREVIEW_TEXT = '语音模型配置正常，这是一段测试语音。'

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
  // refresh — never on every snapshot, or another window's write would fight the
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
      setMsg('已保存到宿主设置（settings.yaml）。')
    } catch (error) {
      setMsg('保存失败: ' + String(error))
    } finally {
      setBusy(false)
    }
  }

  async function preview() {
    setBusy(true)
    setMsg('正在合成试听…')
    var res = await rpc('speak', { text: PREVIEW_TEXT })
    setBusy(false)
    setMsg(res && res.ok ? '试听已生成，请看输入框下方的语音条。' : ('试听失败: ' + ((res && res.message) || 'unknown')))
  }

  async function openDir() {
    var res = await rpc('open')
    setMsg(res && res.ok ? '已打开输出目录。' : ('打开失败: ' + ((res && res.message) || 'unknown')))
  }

  async function clearDir() {
    var res = await rpc('clear')
    if (res && res.ok) {
      setLatest(null)
      setMsg('输出目录已清理（删除 ' + String(res.removed) + ' 个文件）。')
    } else {
      setMsg('清理失败: ' + ((res && res.message) || 'unknown'))
    }
  }

  var outputDir = (latest && latest.dir) ? latest.dir : '（读取中…）'
  var status = snapshot && snapshot.status

  return React.createElement('div', null,
    React.createElement('div', { style: HINT }, '语音合成使用阿里云百炼（DashScope）。配置保存在宿主的 settings.yaml 中，可直接编辑。'),

    status === 'unavailable'
      ? React.createElement('div', { style: HINT }, '宿主设置命名空间不可用——请确认插件宿主半边已加载。')
      : null,

    SettingsRow('API Key', [
      React.createElement('input', {
        key: 'key',
        type: 'password',
        style: INPUT,
        value: key,
        placeholder: keyConfigured(snapshot) ? '已配置（留空表示不修改）' : 'sk-...',
        onChange: function (e) { setKey(e.target.value) },
      }),
      React.createElement('span', { key: 'state', style: { flexShrink: 0, fontSize: '12px', color: T.textFaint } },
        keyConfigured(snapshot) ? '已配置' : '未配置'),
    ], 'apiKey'),

    SettingsRow('合成模型', React.createElement('input', {
      style: INPUT,
      value: model,
      placeholder: '如 cosyvoice-v3.5-plus',
      onChange: function (e) { setModel(e.target.value) },
    }), 'model'),
    React.createElement('div', { style: HINT, key: 'modelHint' },
      '必须与注册音色时使用的模型一致，否则引擎会拒绝请求。'),

    SettingsRow('音色 ID', React.createElement('input', {
      style: INPUT,
      value: voice,
      placeholder: '如 cosyvoice-v3.5-plus-bailian-...',
      onChange: function (e) { setVoice(e.target.value) },
    }), 'voiceId'),

    SettingsRow('语音回答', [
      React.createElement('input', {
        key: 'box',
        type: 'checkbox',
        style: CHECKBOX,
        checked: settings.reply === true,
        onChange: function (e) { setField('reply', e.target.checked) },
      }),
      React.createElement('span', { key: 'note', style: { fontSize: '12px', color: T.textFaint } },
        settings.reply === true ? '每次回答都会附上语音' : '仅文字回答（默认）'),
    ], 'reply'),

    SettingsRow('语音长度', React.createElement('select', {
      style: Object.assign({}, INPUT, { fontFamily: 'inherit', cursor: 'pointer' }),
      value: String(settings.length || 'short'),
      onChange: function (e) { setField('length', e.target.value) },
    },
    React.createElement('option', { value: 'short' }, '简短摘要（一两句，推荐）'),
    React.createElement('option', { value: 'auto' }, '自动（由 AI 判断）'),
    React.createElement('option', { value: 'full' }, '完整回答（较长、较慢）')), 'length'),

    SettingsRow('输出目录', [
      React.createElement('span', {
        key: 'path',
        style: { flex: '1', minWidth: '0', fontSize: '12px', fontFamily: 'monospace', color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        title: outputDir,
      }, outputDir),
      React.createElement('button', { key: 'open', type: 'button', style: BUTTON, onClick: openDir }, '打开文件夹'),
      React.createElement('button', { key: 'clear', type: 'button', style: BUTTON, onClick: clearDir }, '清理文件'),
    ], 'dir'),
    SettingsRow('目录覆盖', React.createElement('input', {
      style: INPUT,
      value: dir,
      placeholder: '留空则使用插件自己的目录',
      onChange: function (e) { setDir(e.target.value) },
    }), 'outputDirOverride'),

    SettingsRow('开机提示音', [
      React.createElement('input', {
        key: 'box',
        type: 'checkbox',
        style: SWITCH,
        checked: settings.bootSound !== false,
        onChange: function (e) { setField('bootSound', e.target.checked) },
      }),
      React.createElement('span', { key: 'note', style: { fontSize: '12px', color: T.textFaint } },
        settings.bootSound !== false
          ? '打开页面后，首次点击或按键时播放提示音'
          : '已关闭，打开页面时不播放提示音'),
    ], 'bootSound'),

    React.createElement('div', { style: { display: 'flex', gap: '10px', paddingTop: '14px' } },
      React.createElement('button', { type: 'button', style: BUTTON, onClick: save, disabled: busy }, busy ? '处理中…' : '保存'),
      React.createElement('button', { type: 'button', style: BUTTON, onClick: preview, disabled: busy }, '试听'),
      React.createElement('button', { type: 'button', style: BUTTON, onClick: function () { seed(true); refreshLatest(); setMsg('已重新读取。') } }, '刷新')),

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
      label: '语音',
    }, function VoiceSectionPage() {
      return VoiceSettingsPage({ scope: scope })
    })
  })
}
