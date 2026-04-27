import asyncio
import base64
import os
import tempfile
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Chat Voice Backend", version="0.1.0")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


class AsrRequest(BaseModel):
    audio_base64: str
    mime_type: str = "audio/webm"
    engine: Literal["sensevoice", "whisper"] = "sensevoice"


class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    engine: Literal["cosyvoice", "pyttsx3", "edge-tts"] = "cosyvoice"
    rate: float = 1.0
    pitch: float = 1.0


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    backend: Literal["ollama", "openai-compatible"] = "ollama"
    model: Optional[str] = None


def decode_audio_to_tempfile(audio_base64: str, suffix: str = ".webm") -> Path:
    audio_bytes = base64.b64decode(audio_base64)
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_file.write(audio_bytes)
    temp_file.close()
    return Path(temp_file.name)


async def run_sensevoice_asr(audio_path: Path) -> str:
    raise HTTPException(
        status_code=501,
        detail=f"SenseVoice 尚未接入。请在 voice-backend/main.py 中实现 run_sensevoice_asr。收到文件：{audio_path.name}"
    )


async def run_whisper_asr(audio_path: Path) -> str:
    raise HTTPException(
        status_code=501,
        detail=f"Whisper 尚未接入。请在 voice-backend/main.py 中实现 run_whisper_asr。收到文件：{audio_path.name}"
    )


async def run_edge_tts(text: str, rate: float, pitch: float) -> tuple[str, str]:
    try:
        import edge_tts
    except ImportError as error:
        raise HTTPException(status_code=500, detail=f"缺少 edge-tts 依赖：{error}") from error

    output_path = Path(tempfile.mkstemp(suffix=".mp3")[1])

    try:
      rate_percent = int((rate - 1) * 100)
      pitch_hz = int((pitch - 1) * 20)
      communicate = edge_tts.Communicate(
          text=text,
          voice="zh-CN-XiaoxiaoNeural",
          rate=f"{rate_percent:+d}%",
          pitch=f"{pitch_hz:+d}Hz"
      )
      await communicate.save(str(output_path))
      audio_bytes = output_path.read_bytes()
      return base64.b64encode(audio_bytes).decode("utf-8"), "audio/mpeg"
    finally:
      output_path.unlink(missing_ok=True)


async def run_cosyvoice_tts(text: str, rate: float, pitch: float) -> tuple[str, str]:
    raise HTTPException(
        status_code=501,
        detail="CosyVoice 尚未接入。请在 voice-backend/main.py 中实现 run_cosyvoice_tts。"
    )


async def run_pyttsx3_tts(text: str, rate: float, pitch: float) -> tuple[str, str]:
    raise HTTPException(
        status_code=501,
        detail="pyttsx3 尚未接入。请在 voice-backend/main.py 中实现 run_pyttsx3_tts。"
    )


async def run_ollama_chat(messages: list[ChatMessage], model: Optional[str]) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json={
                "model": model or OLLAMA_MODEL,
                "stream": False,
                "messages": [message.model_dump() for message in messages]
            }
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    data = response.json()
    reply = (data.get("message") or {}).get("content", "").strip()

    if not reply:
        raise HTTPException(status_code=500, detail="Ollama 返回空内容。")

    return reply


async def run_openai_compatible_chat(messages: list[ChatMessage], model: Optional[str]) -> str:
    if not OPENAI_API_KEY or not OPENAI_BASE_URL:
        raise HTTPException(status_code=500, detail="缺少 OPENAI_API_KEY 或 OPENAI_BASE_URL。")

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            f"{OPENAI_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": model or OPENAI_MODEL,
                "messages": [message.model_dump() for message in messages],
                "temperature": 0.7
            }
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    data = response.json()
    reply = (((data.get("choices") or [{}])[0]).get("message") or {}).get("content", "").strip()

    if not reply:
        raise HTTPException(status_code=500, detail="OpenAI Compatible 接口返回空内容。")

    return reply


@app.get("/health")
async def health():
    return {
        "ok": True,
        "ollama_base_url": OLLAMA_BASE_URL,
        "ollama_model": OLLAMA_MODEL
    }


@app.post("/asr")
async def asr(request: AsrRequest):
    suffix = ".wav" if "wav" in request.mime_type else ".webm"
    audio_path = decode_audio_to_tempfile(request.audio_base64, suffix=suffix)

    try:
        if request.engine == "sensevoice":
            text = await run_sensevoice_asr(audio_path)
        else:
            text = await run_whisper_asr(audio_path)

        return {
            "text": text,
            "engine": request.engine
        }
    finally:
        audio_path.unlink(missing_ok=True)


@app.post("/tts")
async def tts(request: TtsRequest):
    if request.engine == "edge-tts":
        audio_base64, mime_type = await run_edge_tts(request.text, request.rate, request.pitch)
    elif request.engine == "cosyvoice":
        audio_base64, mime_type = await run_cosyvoice_tts(request.text, request.rate, request.pitch)
    else:
        audio_base64, mime_type = await run_pyttsx3_tts(request.text, request.rate, request.pitch)

    return {
        "audio_base64": audio_base64,
        "mime_type": mime_type,
        "engine": request.engine
    }


@app.post("/chat")
async def chat(request: ChatRequest):
    if request.backend == "ollama":
        reply = await run_ollama_chat(request.messages, request.model)
    else:
        reply = await run_openai_compatible_chat(request.messages, request.model)

    return {
        "reply": reply,
        "backend": request.backend,
        "model": request.model or OLLAMA_MODEL
    }


@app.on_event("shutdown")
async def shutdown_event():
    await asyncio.sleep(0)
