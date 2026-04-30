# Chat Room + AI Voice Assistant

一个基于 `Node.js + Express + Socket.IO + Vue 3 + Vite` 的聊天室项目，支持公开聊天、用户私聊，以及 `AI Assistant` 的文本/语音混合对话。

## Features

- 公开聊天
- 用户私聊
- AI 私聊
- 文本输入 + 语音输入混合对话
- 自动朗读回复 / 静音模式切换
- ASR / TTS / LLM 多引擎切换
- 电话模式（按住说话、允许打断朗读）
- 多轮上下文记忆
- 清空 AI 对话历史

## Tech Stack

### Frontend

- Vue 3
- Vite
- Socket.IO Client
- MediaRecorder / Web Audio API
- SpeechRecognition / SpeechSynthesis（浏览器降级）

### Backend

- Node.js
- Express
- Socket.IO
- FastAPI（可选语音后端）

### LLM / Voice

- DeepSeek API
- OpenAI Compatible API
- Ollama
- SenseVoice（预留接入）
- Whisper（预留接入）
- CosyVoice（预留接入）
- pyttsx3（预留接入）
- Edge TTS

## Project Structure

```text
.
├─ index.html
├─ src/
│  ├─ App.vue
│  ├─ main.js
│  └─ style.css
├─ public/
│  ├─ img/
│  └─ css/
│     └─ index.css
├─ voice-backend/
│  ├─ main.py
│  ├─ README.md
│  └─ requirements.txt
├─ server.js
├─ vite.config.js
├─ package.json
├─ .env.example
└─ README.md
```

## Architecture

项目按 `ASR -> LLM -> TTS` 分为三层：

1. 前端层  
   负责聊天界面、录音控制、波形展示、设置面板、消息渲染与音频播放。

2. Node 业务层  
   入口文件是 [`server.js`](./server.js)。  
   负责聊天室消息、AI 会话上下文、LLM 调用、语音接口代理。

3. Python 语音服务层  
   入口文件是 [`voice-backend/main.py`](./voice-backend/main.py)。  
   负责 ASR / TTS 接口和可选的本地模型衔接。

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

复制一份 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

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

- 使用 DeepSeek 时，至少需要配置 `DEEPSEEK_API_KEY`
- 使用本地 Ollama 时，可将 `DEFAULT_LLM_BACKEND=ollama`
- 未启动 Python 语音后端时，可先不配置 `VOICE_BACKEND_URL`

### 3. Start in development

前端：

```bash
npm run dev
```

后端：

```bash
npm run dev:server
```

开发时打开：

- 前端：[http://localhost:5173](http://localhost:5173)
- 后端 API：[http://localhost:9000](http://localhost:9000)

### 4. Build and deploy

```bash
npm run build
npm start
```

构建后由 `server.js` 直接托管 `dist`，浏览器打开：

[http://localhost:9000](http://localhost:9000)

## AI Voice UI

进入聊天室后，点击左侧 `AI Assistant` 即可进入 AI 语音对话模式。

支持：

- 朗读回复 / 静音模式切换
- 电话模式
- 设置面板
- 清空对话
- 麦克风录音
- 回复重播 / 停止朗读

## Main APIs

- `GET /api/voice/config`
- `POST /api/voice/asr`
- `POST /api/voice/tts`
- `POST /api/ai/chat`
- `POST /api/ai/history/clear`

## Voice Backend

如果你要完整启用 SenseVoice / Whisper / CosyVoice / Edge TTS / Ollama 这套链路，请查看：

- [`voice-backend/README.md`](./voice-backend/README.md)

## Notes

- `SenseVoice` / `Whisper` / `CosyVoice` / `pyttsx3` 当前是预留接入点，不是开箱即用
- 浏览器语音识别依赖运行环境，某些内嵌浏览器或 WebView 可能不稳定
- 未启动 Python 语音后端时，语音功能会依赖浏览器降级能力

## Security

- 不要把真实 API Key 写进前端代码
- 不要把 `.env` 提交到 GitHub
- 若 Key 已在聊天记录、日志或截图中出现，建议立即更换
