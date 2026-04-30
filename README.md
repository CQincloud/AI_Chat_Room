# 聊天室 AI 语音升级版

一个基于 `Express + Socket.IO + Vue 3` 的聊天室项目，支持公开聊天、用户私聊，以及 `AI Assistant` 的文本/语音混合对话。

## 功能特性

- 公开聊天
- 用户私聊
- `AI Assistant` 私聊
- 文本输入 + 语音输入混合对话
- 回复自动朗读 / 静音模式切换
- ASR / TTS / LLM 多引擎切换
- 电话模式（按住说话、允许打断朗读）
- 多轮上下文保留
- 清空 AI 对话历史

## 技术栈

### 前端

- Vue 3（CDN 方式接入，尽量少改原有代码）
- 原生 JavaScript
- Socket.IO Client
- MediaRecorder / Web Audio API
- SpeechRecognition / SpeechSynthesis（浏览器降级能力）

### 后端

- Node.js
- Express
- Socket.IO
- FastAPI（可选语音服务）

### 模型与语音能力

- LLM：
  - DeepSeek API
  - OpenAI Compatible API
  - Ollama（本地模型，如 Qwen）
- ASR：
  - SenseVoice（预留接入）
  - Whisper（预留接入）
  - 浏览器 SpeechRecognition 降级
- TTS：
  - CosyVoice（预留接入）
  - pyttsx3（预留接入）
  - Edge TTS
  - 浏览器 SpeechSynthesis 降级

## 项目结构

```text
.
├─ public/
│  ├─ css/
│  │  └─ index.css
│  ├─ js/
│  │  └─ index.js
│  ├─ img/
│  └─ index.html
├─ voice-backend/
│  ├─ main.py
│  ├─ README.md
│  └─ requirements.txt
├─ server.js
├─ package.json
├─ .env.example
└─ README.md
```

## 当前架构

项目按 **ASR -> LLM -> TTS** 的思路拆分为三层：

1. 前端层  
   负责页面渲染、录音控制、语音波形、设置面板、消息展示与音频播放。

2. Node 业务层  
   入口文件是 [`server.js`](./server.js)。  
   负责聊天室消息、AI 会话上下文、LLM 调用、语音接口代理。

3. Python 语音服务层  
   入口文件是 [`voice-backend/main.py`](./voice-backend/main.py)。  
   负责 ASR / TTS 接口和可选的本地模型衔接。

## 浏览器可直接使用的能力

即使没有部署 Python 语音后端，页面也可以正常打开并部分可用：

- 文本对话：可直接使用
- AI 回复朗读：可回退到浏览器自带语音
- 语音识别：若浏览器支持 `SpeechRecognition`，可回退到浏览器识别

如果配置了 Python 语音后端，则会优先使用你选择的 ASR / TTS 引擎。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制一份 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

Windows PowerShell 也可以直接手动新建 `.env`。

示例配置：

```env
PORT=9000

DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=

DEFAULT_LLM_BACKEND=deepseek-api
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b

VOICE_BACKEND_URL=http://127.0.0.1:8001
```

说明：

- 如果你主要使用 DeepSeek，至少要配置 `DEEPSEEK_API_KEY`
- 如果你主要使用本地 Ollama，把 `DEFAULT_LLM_BACKEND=ollama`
- 如果还没启动 Python 语音服务，可以先不配置 `VOICE_BACKEND_URL`

### 3. 启动项目

```bash
npm start
```

启动后浏览器打开：

```text
http://localhost:9000
```

## AI 语音界面说明

进入聊天室后，点击左侧 `AI Assistant`，即可进入 AI 语音对话模式。

### 你会看到这些能力

- `🔊 朗读回复 / 🔇 静音模式`
- `📞 电话模式`
- `⚙️ 设置`
- `🧹 清空对话`
- `🎙️ 麦克风按钮`
- 回复气泡中的 `▶️ 重播` 和 `⏹️ 停止朗读`

### 语音交互流程

1. 点击麦克风开始录音
2. 说话结束后自动识别成文字
3. 识别文本自动发送给 LLM
4. AI 回复显示为文字
5. 如果开启朗读，系统自动播报回复

### 电话模式

电话模式开启后：

- 麦克风按钮会变成“按住说话”
- 按下开始录音，松开发送
- 如果 AI 正在朗读，再次按住说话会先中断朗读
- 回复会有更明显的逐字显示效果

## 前端已接入 Vue 3

当前版本已经将前端接入 Vue 3，但保持了“尽量少修改业务逻辑”的策略：

- 页面渲染改为 Vue 响应式管理
- 原有 AI 请求、录音、ASR、TTS、Socket.IO 逻辑基本保留
- 不引入构建工具，直接通过 CDN 使用 Vue 3

也就是说，现在的前端是：

- `Vue 3` 负责状态和模板渲染
- 原有业务函数继续承担录音、发消息、调用 AI、播放语音的逻辑

## 可选的 Python 语音后端

如果你要完整启用 SenseVoice / Whisper / CosyVoice / Edge TTS / Ollama 这套链路，请查看：

- [`voice-backend/README.md`](./voice-backend/README.md)

其中包含：

- FastAPI 启动方式
- `requirements.txt`
- `/asr`、`/tts`、`/chat`、`/health` 接口说明
- SenseVoice / Whisper / CosyVoice / Edge TTS / Ollama 的接入位置

## 主要接口

Node 服务新增并维护这些接口：

- `GET /api/voice/config`
- `POST /api/voice/asr`
- `POST /api/voice/tts`
- `POST /api/ai/chat`
- `POST /api/ai/history/clear`

## 开发说明

### 前端入口

- [`public/index.html`](./public/index.html)
- [`public/js/index.js`](./public/js/index.js)
- [`public/css/index.css`](./public/css/index.css)

### 后端入口

- [`server.js`](./server.js)

### 语音服务入口

- [`voice-backend/main.py`](./voice-backend/main.py)

## 已知情况

- `SenseVoice` / `Whisper` / `CosyVoice` / `pyttsx3` 当前是预留接入点，不是开箱即用
- 浏览器语音识别依赖运行环境，某些内嵌浏览器或 WebView 可能不稳定
- 若未启动 Python 语音后端，语音功能会依赖浏览器降级能力

## 安全提示

- 不要把真实 API Key 写进前端代码
- 不要把 `.env` 提交到 GitHub
- 如果 Key 曾经出现在聊天记录、日志或截图里，建议立即更换

## License

如果你准备公开到 GitHub，建议补充一个 `LICENSE` 文件。
