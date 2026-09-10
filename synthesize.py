#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音合成脚本 —— 既可被 DSH 插件宿主调用, 也可命令行单独使用。

两种输出模式:
  * 默认        把 mp3 写到 --output(或脚本旁的 output/tmp/<申请时间>.mp3), 路径打到 stdout。
  * --stdout-base64  把 mp3 以 base64 打到 stdout, **不写任何文件**。

插件宿主一律用后者: 不受沙箱写策略约束
(这是写 output 被拒的原因)。落盘由宿主用 node:fs 完成。

配置来源(优先级从高到低):
    1. 命令行参数:      --api-key / --model / --voice / --text
    2. 系统环境变量:    DASHSCOPE_API_KEY / DSH_VOICE_MODEL / DSH_VOICE_VOICE_ID / DSH_VOICE_TEXT
                        (兼容旧名 MODEL_ID / VOICE_ID)
    3. 脚本同目录(或向上逐级)的 .env 同名键 —— 仅为单独使用时方便

诊断信息一律走 stderr, 因此 stdout 上永远只有你要的产物。

用法:
    python synthesize.py --text "要合成的话"
    python synthesize.py --text "..." --output ./a.mp3
    python synthesize.py --stdout-base64       # 从 DSH_VOICE_TEXT 读文本, base64 到 stdout
"""

import argparse
import base64
import os
import shutil
import subprocess
import sys
import tempfile
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT_DIR = os.path.join(SCRIPT_DIR, 'output')
DEFAULT_LEAD_SILENCE_MS = 400  # 通用前导静音优化用户体验; 0 = 不插入
DEFAULT_ENGLISH_PAD = 'to'    # English lead-in word: Prevents the first sound from being missed. Leave empty if not needed.
                            # 英文开头的垫词: 防止用户听不见第一个音，如果不需要令其为空

def log(message):
    """诊断输出: 永远走 stderr, 以免污染 stdout 产物。"""
    print(message, file=sys.stderr)


def request_time_stamp():
    """申请时间戳, 形如 2026-09-10_13-05-57。"""
    return time.strftime('%Y-%m-%d_%H-%M-%S')


def is_mainly_english(text):
    """
    粗略判断文本是否以英文为主。
    """
    latin = 0
    cjk = 0
    for ch in text:
        o = ord(ch)
        if 0x41 <= o <= 0x5A or 0x61 <= o <= 0x7A:
            latin += 1
        elif 0x4E00 <= o <= 0x9FFF:
            cjk += 1
    if latin == 0:
        return False
    if cjk == 0:
        return True
    return latin > cjk


# ---------------------------------------------------------------- .env 支持
def find_env_file():
    """从当前目录和脚本目录向上逐级查找 .env, 返回路径或 None。"""
    for start in (os.getcwd(), SCRIPT_DIR):
        d = os.path.abspath(start)
        while True:
            p = os.path.join(d, '.env')
            if os.path.isfile(p):
                return p
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    return None


def load_dotenv(path):
    """解析简单的 KEY=VALUE 格式 .env。"""
    values = {}
    if not path:
        return values
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[len('export '):].strip()
        if '=' not in line:
            continue
        key, _, val = line.partition('=')
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        if key:
            values[key] = val
    return values


def parse_args():
    parser = argparse.ArgumentParser(description='语音合成执行脚本')
    parser.add_argument('--text', default='', help='要合成的文本(与 --input-file 二选一)')
    parser.add_argument('--input-file', default='',
                        help='从 UTF-8 文本文件读取要合成的文本')
    parser.add_argument('--stdout-base64', action='store_true',
                        help='把 mp3 以 base64 写到 stdout, 不落盘(宿主调用用这个)')
    parser.add_argument('--voice', default='', help='音色 ID(缺省读配置)')
    parser.add_argument('--model', default='', help='合成模型(缺省读配置)')
    parser.add_argument('--api-key', default='', help='百炼 API Key(缺省读配置)')
    parser.add_argument('--output', default='', help='输出 mp3 路径(缺省写到脚本旁的 output/)')
    parser.add_argument('--lead-silence-ms', type=int, default=DEFAULT_LEAD_SILENCE_MS,
                        help='开头前导静音毫秒数(默认 %d; 0=关闭)' % DEFAULT_LEAD_SILENCE_MS)
    parser.add_argument('--english-pad', default=DEFAULT_ENGLISH_PAD,
                        help='英文文本开头的垫词(默认 %r; 空串=关闭)' % DEFAULT_ENGLISH_PAD)
    parser.add_argument('--env-file', default=None, help='手动指定 .env 路径')
    return parser.parse_args()


def pick_value(cmd_val, names, dotenv_values, default=''):
    """按 命令行 > 环境变量 > .env 的优先级取一个配置值。"""
    if cmd_val and cmd_val.strip():
        return cmd_val.strip()
    for name in names:
        found = os.environ.get(name, '')
        if found.strip():
            return found.strip()
    for name in names:
        found = dotenv_values.get(name, '')
        if found.strip():
            return found.strip()
    return default


def insert_lead_silence(audio, lead_ms):
    """用 ffmpeg 在音频开头插入静音, 返回新的音频字节。

    临时文件放系统临时目录(而不是输出目录旁边), 并在结束时清理 —— 输出目录
    里因此只会出现最终的 mp3。ffmpeg 缺失或失败时原样返回, 合成结果不受影响。
    """
    if lead_ms <= 0:
        return audio
    if shutil.which('ffmpeg') is None:
        log('WARNING: 未找到 ffmpeg, 跳过前导静音')
        return audio

    workdir = tempfile.mkdtemp(prefix='dsh-voice-')
    src = os.path.join(workdir, 'in.mp3')
    dst = os.path.join(workdir, 'out.mp3')
    try:
        with open(src, 'wb') as f:
            f.write(audio)
        cmd = [
            'ffmpeg', '-y', '-loglevel', 'error',
            '-i', src,
            '-af', 'adelay=%d:all=1' % lead_ms,
            '-acodec', 'libmp3lame', '-q:a', '4',
            dst,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            log('WARNING: 插入前导静音失败: %s' % (result.stderr or result.stdout).strip())
            return audio
        with open(dst, 'rb') as f:
            return f.read()
    except OSError as exc:
        log('WARNING: 插入前导静音失败: %s' % exc)
        return audio
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main():
    args = parse_args()
    dotenv_values = load_dotenv(args.env_file or find_env_file())

    api_key = pick_value(args.api_key, ['DASHSCOPE_API_KEY'], dotenv_values)
    model = pick_value(args.model, ['DSH_VOICE_MODEL', 'MODEL_ID'], dotenv_values)
    voice = pick_value(args.voice, ['DSH_VOICE_VOICE_ID', 'VOICE_ID'], dotenv_values)

    if not api_key or api_key.startswith('<'):
        log('ERROR: 未找到有效的 DASHSCOPE_API_KEY')
        sys.exit(2)
    if not model:
        log('ERROR: 未找到合成模型(DSH_VOICE_MODEL / MODEL_ID)')
        sys.exit(2)
    if not voice:
        log('ERROR: 未找到音色 ID(DSH_VOICE_VOICE_ID / VOICE_ID)')
        sys.exit(2)

    text = args.text
    if not text and args.input_file:
        with open(args.input_file, 'r', encoding='utf-8') as f:
            text = f.read()
    if not text:
        text = os.environ.get('DSH_VOICE_TEXT', '')
    if not text.strip():
        log('ERROR: 未提供文本(--text / --input-file / DSH_VOICE_TEXT)')
        sys.exit(2)

    # 英文主文本: 引擎对英文开头的首音节损耗大(中文无此问题), 前面加一个垫词
    # (默认 to)承担损耗; 用逗号与正文分隔, 垫词与正文间有轻停顿, 正文开头最清晰。
    english_pad = (args.english_pad or '').strip()
    pad_used = ''
    if english_pad and is_mainly_english(text):
        if not text.lstrip().lower().startswith(english_pad.lower()):
            text = english_pad + ', ' + text
            pad_used = english_pad

    try:
        import dashscope
        from dashscope.audio.tts_v2 import SpeechSynthesizer
    except ImportError:
        log('ERROR: 缺少 dashscope 依赖, 请先安装:  pip install dashscope')
        sys.exit(2)

    dashscope.api_key = api_key
    synthesizer = SpeechSynthesizer(model=model, voice=voice, callback=None)
    audio = synthesizer.call(text)

    if not audio:
        log('ERROR: 合成失败, 引擎没有返回音频(检查模型与音色是否匹配 —— 不匹配会报 418)')
        sys.exit(3)

    lead_ms = args.lead_silence_ms or 0
    audio = insert_lead_silence(audio, lead_ms)

    if args.stdout_base64:
        # 纯 base64, 前后不加任何其他 stdout 输出。
        sys.stdout.write(base64.b64encode(audio).decode('ascii'))
        sys.stdout.write('\n')
        sys.stdout.flush()
    else:
        output = args.output
        if not output:
            os.makedirs(DEFAULT_OUTPUT_DIR, exist_ok=True)
            base = request_time_stamp()
            output = os.path.join(DEFAULT_OUTPUT_DIR, base + '.mp3')
            n = 1
            while os.path.exists(output):
                output = os.path.join(DEFAULT_OUTPUT_DIR, '%s_%d.mp3' % (base, n))
                n += 1
        with open(output, 'wb') as f:
            f.write(audio)
        print('OK: %s' % output)
        print('RESULT_PATH=%s' % os.path.abspath(output))

    log('[Metric] requestId=%s bytes=%d lead_ms=%d english_pad=%r' % (
        synthesizer.get_last_request_id(), len(audio), lead_ms, pad_used))


if __name__ == '__main__':
    main()
