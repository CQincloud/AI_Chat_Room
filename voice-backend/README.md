# FastAPI 语音后端

这个目录提供的是 **ASR / LLM / TTS 语音服务模板**，供前端聊天室通过 `VOICE_BACKEND_URL` 调用。

## 启动前准备

### 1. 安装依赖

```powershell
pip install -r requirements.txt
```

### 2. 配置环境变量

你可以在当前终端中设置：

```powershell
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
$env:OLLAMA_MODEL="qwen2.5:7b"
$env:OPENAI_API_KEY=""
$env:OPENAI_BASE_URL=""
$env:OPENAI_MODEL=""
```

如果你要接 SenseVoice / Whisper / CosyVoice，请在 [main.py](D:\Trae code\前端学习\node.js\11聊天室\voice-backend\main.py:1) 中对应函数位置接入你本地的模型调用。

## 启动服务

```powershell
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

启动后，根项目 `.env` 中配置：

```env
VOICE_BACKEND_URL=http://127.0.0.1:8001
```

然后重新启动 Node 聊天室服务。

## 已提供接口

- `GET /health`
- `POST /asr`
- `POST /tts`
- `POST /chat`

## 当前实现说明

- `ASR`
  - `sensevoice` 和 `whisper` 入口已经预留
  - 默认会返回占位错误，提醒你接入实际模型
- `TTS`
  - `edge-tts` 可以直接用
  - `cosyvoice` 和 `pyttsx3` 已预留接入点
- `LLM`
  - 已支持直接请求本地 Ollama
  - 也预留了 OpenAI Compatible API 调用位置

## 推荐接入顺序

1. 先跑通 `edge-tts`，验证朗读链路
2. 再接入 `ollama`
3. 最后接入 `SenseVoice` 或 `Whisper`
