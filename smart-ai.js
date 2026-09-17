(function (global) {
  'use strict';

  const PROVIDER_STORAGE = 'ielts-ai-provider-v2';
  const KEY_STORAGE = 'ielts-ai-key-v2:';
  const MODEL_STORAGE = 'ielts-ai-model-v2:';
  const DEFAULT_PROVIDER = 'zhipu';
  const PROVIDERS = Object.freeze({
    zhipu: Object.freeze({
      label: '智谱 GLM · 国内免费模型',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      defaultModel: 'glm-4.7-flash',
      keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
      supportsAudio: false,
      kind: 'openai'
    }),
    bailian: Object.freeze({
      label: '阿里百炼 · 通义千问',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      defaultModel: 'qwen-flash',
      keyUrl: 'https://bailian.console.aliyun.com/',
      supportsAudio: false,
      kind: 'openai'
    }),
    siliconflow: Object.freeze({
      label: '硅基流动 · 国内模型',
      endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
      defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      supportsAudio: false,
      kind: 'openai'
    })
  });
  const DEFAULT_MODEL = PROVIDERS[DEFAULT_PROVIDER].defaultModel;
  const DEFAULT_TIMEOUT_MS = 60000;
  const AUDIO_MIME_TYPES = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm'
  ];

  let memoryProvider = '';
  const memoryKeys = {};
  const memoryModels = {};

  class IELTSAIError extends Error {
    constructor(code, message, options) {
      super(message);
      this.name = 'IELTSAIError';
      this.code = code;
      this.status = options && options.status ? options.status : 0;
      if (options && options.cause) this.cause = options.cause;
    }
  }

  function storageGet(key) {
    try {
      return global.sessionStorage ? global.sessionStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (!global.sessionStorage) return false;
      global.sessionStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      if (global.sessionStorage) global.sessionStorage.removeItem(key);
    } catch (_) {
      // The in-memory fallback is still cleared below.
    }
  }

  function setApiKey(value, providerValue) {
    const provider = sanitizeProvider(providerValue || getProvider());
    const key = String(value || '').trim();
    if (!key) {
      clearApiKey(provider);
      return;
    }
    memoryKeys[provider] = key;
    storageSet(KEY_STORAGE + provider, key);
  }

  function getApiKey(providerValue) {
    const provider = sanitizeProvider(providerValue || getProvider());
    return memoryKeys[provider] || storageGet(KEY_STORAGE + provider) || '';
  }

  function clearApiKey(providerValue) {
    const provider = sanitizeProvider(providerValue || getProvider());
    memoryKeys[provider] = '';
    storageRemove(KEY_STORAGE + provider);
  }

  function sanitizeModel(value, providerValue) {
    const fallback = getProviderInfo(providerValue).defaultModel;
    const model = String(value || fallback).trim();
    if (!/^[A-Za-z0-9._:/-]+$/.test(model)) {
      throw new IELTSAIError('INVALID_MODEL', '模型名称格式不正确。');
    }
    return model;
  }

  function setModel(value, providerValue) {
    const provider = sanitizeProvider(providerValue || getProvider());
    const model = sanitizeModel(value || PROVIDERS[provider].defaultModel, provider);
    memoryModels[provider] = model;
    storageSet(MODEL_STORAGE + provider, model);
    return model;
  }

  function clearAllSettings() {
    Object.keys(PROVIDERS).forEach(provider => {
      memoryKeys[provider] = '';
      memoryModels[provider] = '';
      storageRemove(KEY_STORAGE + provider);
      storageRemove(MODEL_STORAGE + provider);
    });
    memoryProvider = '';
    storageRemove(PROVIDER_STORAGE);
  }

  function getModel(providerValue) {
    const provider = sanitizeProvider(providerValue || getProvider());
    const stored = memoryModels[provider] || storageGet(MODEL_STORAGE + provider) || PROVIDERS[provider].defaultModel;
    return sanitizeModel(stored, provider);
  }

  function friendlyHttpError(status, apiMessage, provider) {
    const label = provider && provider.label ? provider.label : '国内 AI';
    const message = String(apiMessage || '').slice(0, 500);
    if (status === 400) return new IELTSAIError('BAD_REQUEST', message || 'AI 请求格式不正确。', { status });
    if (status === 401 || status === 403) return new IELTSAIError('AUTH_FAILED', label + ' API Key 无效或无权限。', { status });
    if (status === 429) return new IELTSAIError('RATE_LIMITED', label + ' 免费额度已用完或请求过于频繁，请稍后再试。', { status });
    if (status >= 500) return new IELTSAIError('SERVICE_UNAVAILABLE', label + ' 服务暂时不可用，请稍后再试。', { status });
    return new IELTSAIError('HTTP_ERROR', message || (label + ' 请求失败，HTTP ' + status + '。'), { status });
  }

  function candidateText(payload) {
    const candidates = payload && Array.isArray(payload.candidates) ? payload.candidates : [];
    const text = candidates
      .flatMap(candidate => candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [])
      .map(part => typeof part.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();

    if (text) return text;
    const blockReason = payload && payload.promptFeedback && payload.promptFeedback.blockReason;
    if (blockReason) throw new IELTSAIError('BLOCKED', '请求被 AI 平台安全策略拦截：' + blockReason + '。');
    throw new IELTSAIError('EMPTY_RESPONSE', 'AI 没有返回可用内容。');
  }

  function openAIText(payload) {
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    const text = Array.isArray(content)
      ? content.map(part => part && (part.text || part.content) || '').join('\n').trim()
      : String(content || '').trim();
    if (!text) throw new IELTSAIError('EMPTY_RESPONSE', '国内 AI 没有返回可用内容。');
    return text;
  }

  function findBalancedJson(text) {
    for (let start = 0; start < text.length; start += 1) {
      const opening = text[start];
      if (opening !== '{' && opening !== '[') continue;
      const closing = opening === '{' ? '}' : ']';
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') {
          quoted = true;
        } else if (char === opening) {
          depth += 1;
        } else if (char === closing) {
          depth -= 1;
          if (depth === 0) return text.slice(start, i + 1);
        }
      }
    }
    return '';
  }

  function extractJSON(value) {
    if (value && typeof value === 'object') return value;
    const text = String(value || '').trim();
    if (!text) throw new IELTSAIError('INVALID_JSON', 'AI 返回了空的 JSON 内容。');

    const unfenced = text
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const candidates = [unfenced, findBalancedJson(unfenced)].filter(Boolean);
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_) {
        // Try the next candidate before returning a useful application error.
      }
    }
    throw new IELTSAIError('INVALID_JSON', 'AI 返回内容不是有效 JSON，请重试。');
  }

  function blobToBase64(blob) {
    if (!(blob instanceof Blob)) {
      return Promise.reject(new IELTSAIError('INVALID_AUDIO', '需要提供有效的音频 Blob。'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        const comma = value.indexOf(',');
        if (comma < 0) reject(new IELTSAIError('AUDIO_ENCODING_FAILED', '音频编码失败。'));
        else resolve(value.slice(comma + 1));
      };
      reader.onerror = () => reject(new IELTSAIError('AUDIO_ENCODING_FAILED', '音频编码失败。', { cause: reader.error }));
      reader.readAsDataURL(blob);
    });
  }

  async function blobToInlineData(blob) {
    if (!(blob instanceof Blob)) {
      throw new IELTSAIError('INVALID_AUDIO', '需要提供有效的音频 Blob。');
    }
    if (blob.size > 14 * 1024 * 1024) {
      throw new IELTSAIError('AUDIO_TOO_LARGE', '录音超过 14 MB，请缩短后重新录制。');
    }
    const rawType = String(blob.type || 'audio/mp4').split(';')[0].toLowerCase();
    const mimeType = rawType === 'audio/m4a' || rawType === 'audio/x-m4a' ? 'audio/mp4' : rawType;
    return {
      inlineData: {
        mimeType,
        data: await blobToBase64(blob)
      }
    };
  }

  function normaliseParts(parts) {
    if (!Array.isArray(parts)) return [];
    return parts.filter(part => part && typeof part === 'object').map(part => {
      if (typeof part.text === 'string') return { text: part.text };
      if (part.inlineData && typeof part.inlineData.data === 'string') throw new IELTSAIError('AUDIO_UNSUPPORTED', '国内免费模型仅接收文字，录音不会上传。');
      throw new IELTSAIError('INVALID_PART', 'AI 请求包含不支持的内容类型。');
    });
  }

  async function generate(options) {
    const opts = options || {};
    const providerId = sanitizeProvider(opts.provider || getProvider());
    const provider = getProviderInfo(providerId);
    const apiKey = String(opts.apiKey || getApiKey(providerId)).trim();
    if (!apiKey) throw new IELTSAIError('MISSING_API_KEY', '请先在设置中填写' + provider.label + '的 API Key。');
    if (opts.audioBlob && !provider.supportsAudio) {
      throw new IELTSAIError('AUDIO_UNSUPPORTED', '当前国内免费模型使用文字分析。请先用语音转写，录音不会上传。');
    }

    const model = sanitizeModel(opts.model || getModel(providerId), providerId);
    const parts = normaliseParts(opts.parts);
    if (typeof opts.prompt === 'string' && opts.prompt.trim()) parts.unshift({ text: opts.prompt.trim() });
    if (!parts.length && !Array.isArray(opts.contents)) {
      throw new IELTSAIError('EMPTY_REQUEST', '请先提供需要分析的内容。');
    }

    const messages = [];
    if (typeof opts.systemInstruction === 'string' && opts.systemInstruction.trim()) {
      messages.push({ role: 'system', content: opts.systemInstruction.trim() });
    }
    if (Array.isArray(opts.contents) && opts.contents.length) {
      opts.contents.forEach(item => {
        const text = Array.isArray(item.parts) ? item.parts.map(part => part && part.text || '').filter(Boolean).join('\n') : '';
        if (text) messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content: text });
      });
    } else {
      let prompt = parts.map(part => part.text || '').filter(Boolean).join('\n').trim();
      if (opts.responseSchema) prompt += '\n\n只返回符合以下 JSON Schema 的有效 JSON，不要使用 Markdown 代码块：\n' + JSON.stringify(opts.responseSchema);
      else if (opts.json) prompt += '\n\n只返回有效 JSON，不要使用 Markdown 代码块。';
      messages.push({ role: 'user', content: prompt });
    }
    const body = {
      model,
      messages,
      temperature: Number.isFinite(opts.temperature) ? opts.temperature : 0.2,
      max_tokens: Number.isFinite(opts.maxOutputTokens) ? opts.maxOutputTokens : 2048,
      stream: false
    };

    const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let removeOuterAbort = null;
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else {
        const abort = () => controller.abort();
        opts.signal.addEventListener('abort', abort, { once: true });
        removeOuterAbort = () => opts.signal.removeEventListener('abort', abort);
      }
    }

    try {
      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });

      let payload;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      if (!response.ok) {
        const apiMessage = payload && ((payload.error && payload.error.message) || payload.message || payload.msg);
        throw friendlyHttpError(response.status, apiMessage, provider);
      }
      const text = openAIText(payload);
      return {
        text,
        json: opts.json || opts.responseSchema ? extractJSON(text) : null,
        usage: payload && payload.usage ? payload.usage : null,
        model,
        provider: providerId
      };
    } catch (error) {
      if (error instanceof IELTSAIError) throw error;
      if (error && error.name === 'AbortError') {
        const code = opts.signal && opts.signal.aborted ? 'CANCELLED' : 'TIMEOUT';
        const message = code === 'CANCELLED' ? 'AI 请求已取消。' : 'AI 请求超时，请检查网络后重试。';
        throw new IELTSAIError(code, message, { cause: error });
      }
      throw new IELTSAIError('NETWORK_ERROR', '无法连接' + provider.label + '，请检查网络和 API Key。', { cause: error });
    } finally {
      clearTimeout(timer);
      if (removeOuterAbort) removeOuterAbort();
    }
  }

  async function generateText(prompt, options) {
    const result = await generate(Object.assign({}, options || {}, { prompt, json: false, responseSchema: null }));
    return result.text;
  }

  async function generateJSON(prompt, options) {
    const result = await generate(Object.assign({}, options || {}, { prompt, json: true }));
    return result.json;
  }

  function selectRecorderMime(preferred) {
    if (!global.MediaRecorder) return '';
    const candidates = Array.isArray(preferred) && preferred.length ? preferred : AUDIO_MIME_TYPES;
    if (typeof global.MediaRecorder.isTypeSupported !== 'function') return '';
    return candidates.find(type => global.MediaRecorder.isTypeSupported(type)) || '';
  }

  async function createAudioRecorder(options) {
    const opts = options || {};
    if (!global.isSecureContext) {
      throw new IELTSAIError('INSECURE_CONTEXT', '录音需要 HTTPS 安全页面。');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !global.MediaRecorder) {
      throw new IELTSAIError('RECORDER_UNSUPPORTED', '当前浏览器不支持网页录音。');
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: opts.constraints || { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      throw new IELTSAIError(denied ? 'MIC_PERMISSION_DENIED' : 'MIC_UNAVAILABLE', denied ? '麦克风权限被拒绝，请在 Safari 网站设置中允许访问。' : '无法打开麦克风。', { cause: error });
    }

    const mimeType = selectRecorderMime(opts.mimeTypes);
    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      throw new IELTSAIError('RECORDER_START_FAILED', '浏览器无法创建录音器。', { cause: error });
    }

    let chunks = [];
    let startedAt = 0;
    let stopTimer = null;
    let donePromise = null;
    let resolveDone = null;
    let rejectDone = null;
    let cancelled = false;

    function stopTracks() {
      stream.getTracks().forEach(track => track.stop());
    }

    recorder.ondataavailable = event => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onerror = event => {
      clearTimeout(stopTimer);
      stopTracks();
      if (rejectDone) rejectDone(new IELTSAIError('RECORDING_FAILED', '录音过程中发生错误。', { cause: event.error }));
    };
    recorder.onstop = () => {
      clearTimeout(stopTimer);
      stopTracks();
      if (!resolveDone && !rejectDone) return;
      if (cancelled) {
        rejectDone(new IELTSAIError('RECORDING_CANCELLED', '录音已取消。'));
      } else {
        const actualType = recorder.mimeType || mimeType || (chunks[0] && chunks[0].type) || 'audio/mp4';
        resolveDone({
          blob: new Blob(chunks, { type: actualType }),
          mimeType: actualType,
          durationMs: Math.max(0, Date.now() - startedAt)
        });
      }
      resolveDone = null;
      rejectDone = null;
    };

    return {
      get state() { return recorder.state; },
      get mimeType() { return recorder.mimeType || mimeType; },
      start(timeslice) {
        if (recorder.state !== 'inactive' || donePromise) {
          throw new IELTSAIError('RECORDER_BUSY', '录音器已经启动。');
        }
        chunks = [];
        cancelled = false;
        startedAt = Date.now();
        donePromise = new Promise((resolve, reject) => {
          resolveDone = resolve;
          rejectDone = reject;
        });
        recorder.start(Number(timeslice) > 0 ? Number(timeslice) : 1000);
        const maxDurationMs = Math.max(1000, Number(opts.maxDurationMs) || 90000);
        stopTimer = setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, maxDurationMs);
        return donePromise;
      },
      stop() {
        if (!donePromise) return Promise.reject(new IELTSAIError('NOT_RECORDING', '录音尚未开始。'));
        if (recorder.state === 'recording' || recorder.state === 'paused') recorder.stop();
        return donePromise;
      },
      cancel() {
        cancelled = true;
        clearTimeout(stopTimer);
        if (recorder.state === 'recording' || recorder.state === 'paused') recorder.stop();
        else stopTracks();
      }
    };
  }

  function getPreferredVoice(lang) {
    if (!global.speechSynthesis) return null;
    const voices = global.speechSynthesis.getVoices();
    const requested = String(lang || 'en-GB').toLowerCase();
    return voices.find(voice => String(voice.lang).toLowerCase() === requested)
      || voices.find(voice => String(voice.lang).toLowerCase().startsWith(requested.split('-')[0]))
      || null;
  }

  function warmVoices() {
    if (!global.speechSynthesis) return [];
    global.speechSynthesis.getVoices();
    return global.speechSynthesis.getVoices();
  }

  let speechRunId = 0;
  let activeUtterance = null;
  let activeSpeechReject = null;

  function splitSpeechChunks(text, maxLength) {
    const limit = Math.max(120, Number(maxLength) || 220);
    const sentences = String(text || '').match(/[^.!?;:\n]+[.!?;:]*(?:\s+|$)|[^\n]+$/g) || [String(text || '')];
    const chunks = [];
    let current = '';
    const append = part => {
      const value = part.trim();
      if (!value) return;
      if (!current) current = value;
      else if ((current + ' ' + value).length <= limit) current += ' ' + value;
      else { chunks.push(current); current = value; }
    };
    sentences.forEach(sentence => {
      const value = sentence.trim();
      if (value.length <= limit) { append(value); return; }
      const words = value.split(/\s+/);
      let piece = '';
      words.forEach(word => {
        if (!piece) piece = word;
        else if ((piece + ' ' + word).length <= limit) piece += ' ' + word;
        else { append(piece); piece = word; }
      });
      append(piece);
    });
    if (current) chunks.push(current);
    return chunks;
  }

  function speak(text, options) {
    const opts = options || {};
    const content = String(text || '').trim();
    if (!content) return Promise.reject(new IELTSAIError('EMPTY_SPEECH', '没有可朗读的文字。'));
    if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) {
      return Promise.reject(new IELTSAIError('TTS_UNSUPPORTED', '当前浏览器不支持文字朗读。'));
    }

    if (opts.cancelExisting !== false) stopSpeaking();
    const runId = ++speechRunId;
    const limited = content.slice(0, Number(opts.maxChars) || 1200);
    const chunks = splitSpeechChunks(limited, opts.chunkChars);
    const lang = opts.lang || 'en-GB';
    const rate = Math.min(2, Math.max(0.5, Number(opts.rate) || 0.95));
    const pitch = Math.min(2, Math.max(0, Number(opts.pitch) || 1));
    const volume = Math.min(1, Math.max(0, Number(opts.volume) || 1));
    const voice = getPreferredVoice(lang);

    return new Promise((resolve, reject) => {
      let index = 0;
      activeSpeechReject = reject;
      const finish = value => {
        if (runId !== speechRunId) return;
        activeUtterance = null;
        activeSpeechReject = null;
        resolve(value);
      };
      const playNext = () => {
        if (runId !== speechRunId) return;
        if (index >= chunks.length) { finish({ chunks:chunks.length, voice }); return; }
        const utterance = new SpeechSynthesisUtterance(chunks[index++]);
        activeUtterance = utterance;
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.volume = volume;
        if (voice) utterance.voice = voice;
        utterance.onend = playNext;
        utterance.onerror = event => {
          if (runId !== speechRunId) return;
          activeUtterance = null;
          activeSpeechReject = null;
          reject(new IELTSAIError('TTS_FAILED', '朗读失败，请点击播放按钮重试。', { cause:event.error || event }));
        };
        global.speechSynthesis.speak(utterance);
      };
      playNext();
    });
  }

  function stopSpeaking() {
    speechRunId += 1;
    if (global.speechSynthesis) global.speechSynthesis.cancel();
    activeUtterance = null;
    if (activeSpeechReject) {
      const reject = activeSpeechReject;
      activeSpeechReject = null;
      reject(new IELTSAIError('TTS_CANCELLED', '朗读已停止。'));
    }
  }

  function sanitizeProvider(value) {
    const provider = String(value || DEFAULT_PROVIDER).trim().toLowerCase();
    if (!PROVIDERS[provider]) throw new IELTSAIError('INVALID_PROVIDER', '请选择受支持的国内 AI 平台。');
    return provider;
  }

  function setProvider(value) {
    const provider = sanitizeProvider(value);
    memoryProvider = provider;
    storageSet(PROVIDER_STORAGE, provider);
    return provider;
  }

  function getProvider() {
    const value = memoryProvider || storageGet(PROVIDER_STORAGE) || DEFAULT_PROVIDER;
    return PROVIDERS[value] ? value : DEFAULT_PROVIDER;
  }

  function getProviderInfo(value) {
    return PROVIDERS[sanitizeProvider(value || getProvider())];
  }

  global.IELTSAI = Object.freeze({
    version: '2.0.0',
    DEFAULT_PROVIDER,
    DEFAULT_MODEL,
    PROVIDERS,
    AUDIO_MIME_TYPES: AUDIO_MIME_TYPES.slice(),
    IELTSAIError,
    setKey: setApiKey,
    getKey: getApiKey,
    setApiKey,
    getApiKey,
    clearApiKey,
    clearAllSettings,
    setProvider,
    getProvider,
    getProviderInfo,
    supportsAudio: providerValue => getProviderInfo(providerValue).supportsAudio,
    setModel,
    getModel,
    extractJSON,
    blobToBase64,
    blobToInlineData,
    generate,
    generateText,
    generateJSON,
    selectRecorderMime,
    createAudioRecorder,
    getPreferredVoice,
    warmVoices,
    speak,
    stopSpeaking
  });
})(window);
