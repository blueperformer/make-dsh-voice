# dsh-voice

给 DeepSeek Harness 网页界面加上语音能力，**一个包内含四个模块**：

| 模块 | 作用 |
| --- | --- |
| **`voice_speak` 工具** | AI 用你注册的复刻音色把文字合成语音 |
| **语音条** | 对话输入框下方的单行播放器，自动跟随最新语音 |
| **语音设置页** | 设置 → 语音：密钥 / 模型 / 音色 / 回答策略 / 长度 / 输出目录 |
| **开机提示音** | 打开页面后首次交互时播放，可在设置页开关 |

合成走阿里云百炼（DashScope）的 `cosyvoice` 系列模型。

[English →](README.md)

---

## 环境要求
- 本插件的运行环境全为Windows 11,在其他操作系统Linux、MACOS上未作测试
- 带 Web profile 的 DeepSeek Harness（`dsh web`）。
- `pnpm` 在 `PATH` 上（`dsh plugin` 会把参数转发给它）。
- **Python 3** 并安装 DashScope SDK，以及 `ffmpeg`：
  ```bash
  pip install dashscope
  ```
  ffmpeg 是可选的；没有它只会跳过前导静音那一步，其余照常工作。(注意从项目发布为止 python 3.14暂时不支持该库)
- 阿里云百炼网址https://bailian.console.aliyun.com/
  一个阿里云百炼 API Key，以及一个**已注册的复刻音色 ID**。
  如果嫌麻烦可以尝试该音色(本人提取的一款音色)
  MODEL_ID=cosyvoice-v3.5-plus
  VOICE_ID=cosyvoice-v3.5-plus-bailian-8b77bd1294fd46b4a5dfea5df9be727c
- 合成模型必须与注册音色时使用的模型**一致**，否则引擎会直接拒绝请求。

## 安装

```bash
# 从本地克隆安装……
dsh plugin --profile web add /指向/dsh-voice 的绝对路径

# ……或直接从 git 安装
dsh plugin --profile web add github:blueperformer/make-dsh-voice
```

然后**重启 DSH**。安装就这一步：包声明了 `dsh.bundle`，CLI 会自动把它追加到 profile 的
`dsh.profile.bundles`，包自带的 `cordis.patch.yml` 负责贡献插件行。**不需要手改任何配置。**

> bundle 层在启动时组装，所以重启才是激活它的一步。

重启后打开 **设置 → 语音**，粘贴一次 API Key。**请确保粘贴时其余插件安全性,之后密钥不会再回传给浏览器**，
输入框只显示"已配置"。

## 设置项

所有配置都在 `$DSH_HOME/settings.yaml` 的 `voice:` 段，**你可以直接编辑该文件**，
运行中的插件会热读取。

```yaml
voice:
  apiKey: ''                 # 密钥：永不回传浏览器
  model: cosyvoice-v3.5-plus # 必须与注册音色时一致
  voiceId: cosyvoice-v3.5-plus-bailian-...
  reply: false               # 是否让 AI 每次回答都附语音
  length: short              # short | auto | full
  bootSound: true
  outputDir: ''              # 留空 = $DSH_HOME/voice/audio
```

| 字段 | 说明 |
| --- | --- |
| `apiKey` | schemastery 的 `role('secret')` 字段。设置通道会把它从**所有**发往浏览器的值里剥离，所以页面只能知道"是否已配置"，永远读不到明文。写入仍然可用，因为客户端写的是**按路径的增量编辑**，而不是重述整份文档。 |
| `reply` | 每轮注入系统提示，所以开关一改，**下一次回答**立刻生效，不用重启。 |
| `length` | `short` 要求一两句；`auto` 交给模型判断；`full` 念完整回答。 |
| `outputDir` | 任意绝对路径。默认把音频放在 harness home 里。 |

文本框用「保存」按钮提交；复选框和长度选择器**改了就写**。

## 换成你自己的开机音

```bash
cp /路径/你的音频.mp3 assets/boot.mp3
```

**不需要重新构建**——宿主从 `/dsh-voice/boot` 流式发送这个文件，换完只要刷新页面。

**开机音无法在首次交互前播放。** 浏览器禁止在文档被交互之前播放有声音频，所以模块挂了
两个触发点、只花掉一次播放：挂载时立刻试播（只有浏览器本来就允许时才成功，例如
`chrome --autoplay-policy=no-user-gesture-required`），否则退回到你第一次点击/按键。

## 合成调优

两个参数在 `synthesize.py` 顶部：

- `DEFAULT_ENGLISH_PAD = 'to'` —— 在多次测试中,在部分场景下引擎会吞掉英文开头的首音节，用一个无意义垫词承担损耗。
  中文不受影响，不会加垫词。
- `DEFAULT_LEAD_SILENCE_MS = 400` —— 用 ffmpeg 插入前导静音，避免播放器削掉第一个音节。

两者也都有命令行开关，而且 `synthesize.py` 可以单独使用：

```bash
python synthesize.py --text "你好"
python synthesize.py --text "hello" --output ./a.mp3 --lead-silence-ms 800
```

## 卸载

```bash
dsh plugin --profile web remove dsh-voice
```

CLI 会同步修正层列表，所以这个包也会自动从 `dsh.profile.bundles` 移除。重启 DSH。
`voice:` 设置段会留下，无害。

## 原理

```
package.json        dsh.bundle.patch（安装接线）+ dsh.client（浏览器行）
cordis.patch.yml    本插件贡献的唯一一行 composition
host/index.js       总装：设置命名空间、系统提示、工具、路由
host/settings.js    voice 设置 schema（apiKey 是密钥字段）
host/synth.js       音频目录 + 通往 Python 的桥
host/routes.js      /dsh-voice/{latest,audio,speak,boot,open,clear}
host/harness.js     定位 DSH 自身的包（见下方）
synthesize.py       合成脚本
client/*.js         浏览器模块，由 build.mjs 拼接成 lib/client.js
lib/client.js       【生成文件】浏览器真正执行的产物
build.mjs           拼接 + 产物断言
verify.mjs          两个半边共 53 项行为断言
```

三个值得知道的设计决定。

**浏览器半边走 HTTP，而不是类型化远程 RPC。** 路由就是普通的 Node handler，
所以插件不需要生成 wire schema 就能送 JSON 和音频字节，浏览器那边也保持手写、
除了拼接之外没有任何构建步骤。

**Python 完全不写文件。** 它把音频以 base64 打到 stdout，由宿主用 `node:fs` 落盘。
所以子进程不需要写权限、不需要可写工作区、也不需要临时输入文件——这正是本插件
**没有"写入被拒"这类失败、也没有临时文件要清理**的原因。

**harness 自身的包通过 `host/harness.js` 定位，而不是按名字 import。**
用本地路径安装的插件是一个软链，Node 会从包的**真实目录**解析它的导入——也就是那个
checkout，位于 profile 树之外。于是父目录上溯永远到不了
`$DSH_HOME/profiles/node_modules`（让 harness 包在任何 profile 下可解析的扁平回退目录），
裸 `import '@deepseek-ai/dsh-tools'` 会报 `ERR_MODULE_NOT_FOUND`。
而这恰恰是本仓库读者最先做的事：克隆，然后从 checkout 安装。
shim 通过该回退目录里的一个锚点定位这些包再按文件 URL 导入，因此只依赖**已发布的包名**。


## 排错

**什么都没出现。** 检查插件行是否进了启动清单：

```bash
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-voice[^"]*'
```

没有输出说明包不在 composition 里——确认它出现在
`$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` 中，并且**你重启过**。

**提示"未配置 API Key"。** 在 设置 → 语音 里粘贴一次。如果显示"已配置"但合成仍失败，
说明 Key 无效或没有 DashScope 权限。

**引擎报 418。** 合成模型与注册音色时的模型不一致，两者必须相同。

**找不到 `python`。** 插件会依次尝试 `python`、`python3`、`py`，并缓存可用的那个。
请安装 Python 3 与 DashScope SDK。

**工具失败且报错很长。** 宿主会原样转述脚本的 stderr（截断到 700 字），通常能直接指出
真实原因——缺包、Key 错、或模型与音色不匹配。

## 已知限制

- **界面为中文**，工具描述也是。(作者英文水平不行,且大部分内容还未落地后续会更新)
- **绑定在 DSH 的内部接口上**，鉴于DSH插件的信任模型,本文使用的以下接口没有公开稳定性承诺：
  `dsh.client` 清单格式、`__DSH_BOOT__`、`window.__ModuleLoader__.load`、`settings.section` 与
  `conversation.composer.dock` 两个 slot、`dsh.bundle.patch`、以及 shim 解析的那些包名。
  已在 DSH `0.1.0-rc.7` 上验证。
- **本地路径安装等于活链接** DSH 运行期间改动 checkout 会影响运行中的插件；
  客户端 bundle 在下次刷新页面时生效，宿主半边在下次重启时生效。
- **有概率ai不回复**因为本插件是提示词注入的操作形式,ai有概率忽视该提示。
