const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

loadEnvFile();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 9000);
const VOICE_BACKEND_URL = (process.env.VOICE_BACKEND_URL || '').replace(/\/$/, '');
const DEFAULT_LLM_BACKEND = process.env.DEFAULT_LLM_BACKEND || 'deepseek-api';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

const AI_USER = {
  id: 'ai-assistant',
  nickName: 'AI Assistant',
  avatar: 'img/g.webp'
};

const AI_SYSTEM_PROMPT =
  'You are a helpful AI assistant inside a realtime chat room. Reply in Chinese by default, be concise, warm, and practical.';

const users = [];
const aiSessions = new Map();

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) {
      return;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

function buildUserList() {
  return [...users, AI_USER];
}

function getAiHistory(sessionId) {
  if (!aiSessions.has(sessionId)) {
    aiSessions.set(sessionId, [{ role: 'system', content: AI_SYSTEM_PROMPT }]);
  }

  return aiSessions.get(sessionId);
}

function clearAiHistory(sessionId) {
  aiSessions.delete(sessionId);
}

function buildRecentHistory(history, currentUserMessage) {
  const nextHistory = [...history, currentUserMessage];

  return [nextHistory[0], ...nextHistory.slice(-10)];
}

function resolveOpenAiCompatibleConfig(settings = {}) {
  const backend = settings.llmBackend || DEFAULT_LLM_BACKEND;
  const isOpenAiCompatible = backend === 'openai-compatible';

  return {
    backend,
    apiKey: isOpenAiCompatible
      ? process.env.OPENAI_API_KEY
      : process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: (
      isOpenAiCompatible
        ? process.env.OPENAI_BASE_URL || `${DEFAULT_DEEPSEEK_BASE_URL}/v1`
        : process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL
    ).replace(/\/$/, ''),
    model:
      settings.llmModel ||
      (isOpenAiCompatible
        ? process.env.OPENAI_MODEL || 'gpt-4o-mini'
        : process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat')
  };
}

async function callOpenAiCompatibleChat(messages, settings = {}) {
  const config = resolveOpenAiCompatibleConfig(settings);

  if (!config.apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY or OPENAI_API_KEY');
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error('LLM returned an empty response');
  }

  return {
    reply,
    backend: config.backend,
    model: config.model
  };
}

async function callOllamaChat(messages, settings = {}) {
  const model = settings.llmModel || process.env.OLLAMA_MODEL || 'qwen2.5:7b';
  const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const reply = data?.message?.content?.trim();

  if (!reply) {
    throw new Error('Ollama returned an empty response');
  }

  return {
    reply,
    backend: 'ollama',
    model
  };
}

async function createAiReply({ sessionId, nickname, content, settings = {} }) {
  const history = getAiHistory(sessionId);
  const userMessage = {
    role: 'user',
    content: `${nickname || '用户'}: ${content}`
  };

  const messages = buildRecentHistory(history, userMessage);
  const llmBackend = settings.llmBackend || DEFAULT_LLM_BACKEND;

  const result =
    llmBackend === 'ollama'
      ? await callOllamaChat(messages, settings)
      : await callOpenAiCompatibleChat(messages, settings);

  history.splice(0, history.length, ...messages, {
    role: 'assistant',
    content: result.reply
  });

  return result;
}

async function proxyVoiceRequest(route, payload) {
  if (!VOICE_BACKEND_URL) {
    return {
      ok: false,
      status: 501,
      data: {
        message: 'VOICE_BACKEND_URL 未配置，请先启动 FastAPI 语音服务。',
        fallback: true
      }
    };
  }

  const response = await fetch(`${VOICE_BACKEND_URL}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data;

  try {
    data = await response.json();
  } catch (error) {
    data = { message: '语音服务返回了不可解析的结果。' };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

app.get('/api/voice/config', (_req, res) => {
  res.json({
    defaultSettings: {
      autoRead: true,
      phoneMode: false,
      asrEngine: 'sensevoice',
      ttsEngine: 'cosyvoice',
      llmBackend: DEFAULT_LLM_BACKEND,
      llmModel:
        DEFAULT_LLM_BACKEND === 'ollama'
          ? process.env.OLLAMA_MODEL || 'qwen2.5:7b'
          : process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat',
      speechRate: 1,
      speechPitch: 1
    },
    supportedEngines: {
      asr: ['sensevoice', 'whisper'],
      tts: ['cosyvoice', 'pyttsx3', 'edge-tts'],
      llm: ['ollama', 'deepseek-api', 'openai-compatible']
    },
    backendAvailability: {
      voiceBackendConfigured: Boolean(VOICE_BACKEND_URL),
      ollamaConfigured: true,
      deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY),
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY)
    }
  });
});

app.post('/api/voice/asr', async (req, res) => {
  const { audioBase64, mimeType, settings = {} } = req.body || {};

  if (!audioBase64) {
    res.status(400).json({ message: '缺少音频数据。' });
    return;
  }

  try {
    const result = await proxyVoiceRequest('/asr', {
      audio_base64: audioBase64,
      mime_type: mimeType || 'audio/webm',
      engine: settings.asrEngine || 'sensevoice'
    });

    res.status(result.status).json(result.data);
  } catch (error) {
    res.status(500).json({ message: `语音识别失败：${error.message}` });
  }
});

app.post('/api/voice/tts', async (req, res) => {
  const { text, settings = {} } = req.body || {};

  if (!text?.trim()) {
    res.status(400).json({ message: '缺少朗读文本。' });
    return;
  }

  try {
    const result = await proxyVoiceRequest('/tts', {
      text,
      engine: settings.ttsEngine || 'cosyvoice',
      rate: settings.speechRate || 1,
      pitch: settings.speechPitch || 1
    });

    if (result.status === 501) {
      res.status(200).json({
        mode: 'browser-fallback',
        message: result.data.message
      });
      return;
    }

    res.status(result.status).json(result.data);
  } catch (error) {
    res.status(500).json({ message: `语音合成失败：${error.message}` });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const { sessionId, nickname, message, settings = {}, source = 'text' } = req.body || {};

  if (!sessionId || !message?.trim()) {
    res.status(400).json({ message: '缺少 sessionId 或消息内容。' });
    return;
  }

  try {
    const result = await createAiReply({
      sessionId,
      nickname,
      content: message.trim(),
      settings
    });

    res.json({
      reply: result.reply,
      backend: result.backend,
      model: result.model,
      source
    });
  } catch (error) {
    res.status(500).json({
      message: `AI 回复失败：${error.message}`
    });
  }
});

app.post('/api/ai/history/clear', (req, res) => {
  const { sessionId } = req.body || {};

  if (!sessionId) {
    res.status(400).json({ message: '缺少 sessionId。' });
    return;
  }

  clearAiHistory(sessionId);
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  console.log(`${socket.id} connected`);

  socket.on('login', (data) => {
    if (!data?.nickname || !data?.avatarUrl) {
      return;
    }

    if (data.nickname.length > 16 || data.nickname.length < 1) {
      socket.emit('login_error', '昵称长度需要在 1 到 16 个字符之间');
      return;
    }

    const existingUser = users.find((user) => user.nickName === data.nickname);

    if (existingUser) {
      socket.emit('login_error', '昵称已被使用');
      return;
    }

    const newUser = {
      id: socket.id,
      nickName: data.nickname,
      avatar: data.avatarUrl
    };

    users.push(newUser);
    socket.userData = newUser;

    socket.emit('login_success', {
      id: socket.id,
      nickname: data.nickname,
      avatarUrl: data.avatarUrl
    });

    io.emit('join', `${data.nickname} 加入了聊天室`);
    io.emit('user_list', buildUserList());
  });

  socket.on('publicMessage', (data) => {
    if (!socket.userData || !data?.content?.trim()) {
      return;
    }

    io.emit('publicMessage', {
      nickname: socket.userData.nickName,
      avatarUrl: socket.userData.avatar,
      content: data.content.trim()
    });
  });

  socket.on('privateMessage', async (data) => {
    if (!socket.userData || !data?.content?.trim() || !data?.toId) {
      return;
    }

    const content = data.content.trim();

    if (data.toId === AI_USER.id) {
      socket.emit('ai_status', { loading: true });

      try {
        const result = await createAiReply({
          sessionId: socket.id,
          nickname: socket.userData.nickName,
          content,
          settings: data.settings || {}
        });

        socket.emit('privateMessage', {
          fromNickname: AI_USER.nickName,
          fromAvatar: AI_USER.avatar,
          content: result.reply,
          fromId: AI_USER.id,
          isAi: true
        });
      } catch (error) {
        console.error('AI reply error:', error.message);
        socket.emit('privateMessage', {
          fromNickname: AI_USER.nickName,
          fromAvatar: AI_USER.avatar,
          content: `AI 暂时不可用：${error.message}`,
          fromId: AI_USER.id,
          isAi: true
        });
      } finally {
        socket.emit('ai_status', { loading: false });
      }

      return;
    }

    io.to(data.toId).emit('privateMessage', {
      fromNickname: socket.userData.nickName,
      fromAvatar: socket.userData.avatar,
      content,
      fromId: socket.id
    });
  });

  socket.on('disconnect', () => {
    const index = users.findIndex((user) => user.id === socket.id);

    clearAiHistory(socket.id);

    if (index !== -1) {
      const leftUser = users[index];
      users.splice(index, 1);
      io.emit('user_list', buildUserList());
      io.emit('join', `${leftUser.nickName} 离开了聊天室`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}, http://localhost:${PORT}`);
});
