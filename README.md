# 聊天室 AI 语音升级版

这是一个基于 `Express + Socket.IO` 的聊天室项目，支持：

- 公开聊天
- 用户私聊
- `AI Assistant` 私聊
- 文本输入 + 语音输入混合对话
- 回复自动朗读 / 静音模式切换
- ASR / TTS / LLM 多引擎切换
- 电话模式（按住说话、允许打断朗读）

## 当前架构

项目默认采用你要求的 **ASR → LLM → TTS** 思路拆分：

- 前端：负责录音、波形展示、设置面板、朗读控制
- Node 服务：[server.js](D:\Trae code\前端学习\node.js\11聊天室\server.js:1)
  - 负责聊天室、AI 会话上下文、LLM 调用、语音接口代理
- Python 语音后端：[voice-backend/main.py](D:\Trae code\前端学习\node.js\11聊天室\voice-backend\main.py:1)
  - 负责 SenseVoice / Whisper / CosyVoice / Edge TTS 等能力接入

## 浏览器可直接使用的能力

即使还没有部署 Python 语音后端，页面也可以打开并使用：

- 文本对话：可直接使用
- AI 回复朗读：会优先回退到浏览器自带语音
- 语音识别：若浏览器支持 `SpeechRecognition`，会自动降级使用浏览器识别

如果你配置了 Python 语音后端，则会优先走你设置的 ASR / TTS 引擎。

## 启动步骤

### 1. 配置根目录 `.env`

可以直接参考 [\.env.example](D:\Trae code\前端学习\node.js\11聊天室\.env.example:1)：

```env
PORT=9000
DEEPSEEK_API_KEY=你的DeepSeekKey
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

DEFAULT_LLM_BACKEND=deepseek-api
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b

VOICE_BACKEND_URL=http://127.0.0.1:8001
```

说明：

- 如果你主要用 DeepSeek，至少要配置 `DEEPSEEK_API_KEY`
- 如果你主要用本地 Ollama，把 `DEFAULT_LLM_BACKEND=ollama`
- 如果还没启动 Python 语音后端，可以先不配 `VOICE_BACKEND_URL`

### 2. 安装 Node 依赖

```powershell
npm install
```

### 3. 启动聊天室服务

```powershell
npm start
```

启动后浏览器打开：

[http://localhost:9000](http://localhost:9000)

## AI 语音界面说明

进入聊天室后，点击左侧 `AI Assistant`，即可进入升级后的 AI 对话窗口。

你会看到这些新增能力：

- `🔊 朗读回复 / 🔇 静音模式`
- `📞 电话模式`
- `⚙️ 设置`
- `🧹 清空对话`
- `🎙️ 麦克风按钮`
- 回复气泡的 `▶️ 重播` 和 `⏹️ 停止朗读`

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
- 若 AI 正在朗读，你再次按住说话会先中断朗读
- 回复采用更强的逐字显示效果

## 可选的 Python 语音后端

如果你要真正使用 SenseVoice / CosyVoice / Edge TTS / Ollama 这套完整链路，请继续看：

[voice-backend/README.md](D:\Trae code\前端学习\node.js\11聊天室\voice-backend\README.md:1)

里面已经包含：

- FastAPI 启动方式
- `requirements.txt`
- `/asr`、`/tts`、`/chat`、`/health` 接口说明
- SenseVoice / Whisper / CosyVoice / Edge TTS / Ollama 的接入位置

## 主要接口

Node 服务新增了这些接口：

- `GET /api/voice/config`
- `POST /api/voice/asr`
- `POST /api/voice/tts`
- `POST /api/ai/chat`
- `POST /api/ai/history/clear`

## 安全提醒

- 不要把真实 API key 写进前端代码
- 不要把 `.env` 提交到仓库
- 如果 key 曾经在聊天、截图或日志里出现过，建议立刻更换
