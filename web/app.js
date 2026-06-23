const TOKEN_KEY = 'yt-dlp-fork.token';

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  authGate: $('auth-gate'),
  tokenForm: $('token-form'),
  tokenInput: $('token'),
  forgetToken: $('forget-token'),
  convertForm: $('convert-form'),
  url: $('url'),
  convertBtn: $('convert-btn'),
  status: $('status'),
  stage: $('stage'),
  title: $('title'),
  bar: $('bar'),
  percent: $('percent'),
  speed: $('speed'),
  eta: $('eta'),
  error: $('error'),
  resetBtn: $('reset-btn'),
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function show(el) {
  el.hidden = false;
}
function hide(el) {
  el.hidden = true;
}

function showApp() {
  hide(els.authGate);
  show(els.app);
}

function showAuthGate() {
  hide(els.app);
  show(els.authGate);
  els.tokenInput.focus();
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.message ?? `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = json?.code;
    throw err;
  }
  return json;
}

async function* readSSE(path, signal) {
  const res = await fetch(path, {
    headers: { ...authHeaders(), Accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SSE ${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = parseSseChunk(chunk);
      if (event) yield event;
    }
  }
}

function parseSseChunk(chunk) {
  let type = 'message';
  let data = '';
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    else if (field === 'data') data += (data ? '\n' : '') + value;
  }
  if (!data) return null;
  try {
    return { type, data: JSON.parse(data) };
  } catch {
    return { type, data };
  }
}

function resetStatus() {
  hide(els.status);
  hide(els.error);
  hide(els.resetBtn);
  els.bar.style.width = '0%';
  els.percent.textContent = '0%';
  els.speed.textContent = '';
  els.eta.textContent = '';
  els.title.textContent = '';
  els.error.textContent = '';
  els.stage.textContent = 'queued';
}

function setStage(stage) {
  els.stage.textContent = stage.replace(/_/g, ' ');
}

function setProgress(p) {
  if (typeof p.percent === 'number') {
    const pct = Math.max(0, Math.min(100, p.percent));
    els.bar.style.width = `${pct}%`;
    els.percent.textContent = `${pct.toFixed(1)}%`;
  }
  if (p.speed) els.speed.textContent = p.speed;
  if (p.eta) els.eta.textContent = `ETA ${p.eta}`;
  if (p.stage) setStage(p.stage);
}

async function triggerDownload(url, fileName) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download failed: ${text}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

let currentAbort = null;

async function runConversion(url) {
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();

  resetStatus();
  show(els.status);
  els.convertBtn.disabled = true;

  try {
    const { jobId, eventsUrl } = await postJson('/convert', { url });

    for await (const event of readSSE(eventsUrl, currentAbort.signal)) {
      if (event.type === 'progress') {
        setProgress(event.data);
      } else if (event.type === 'state') {
        if (event.data.title) els.title.textContent = event.data.title;
        if (event.data.status) setStage(event.data.status);
      } else if (event.type === 'done') {
        setProgress({ percent: 100, stage: 'done' });
        await triggerDownload(`/jobs/${jobId}/download`, event.data.fileName);
        break;
      } else if (event.type === 'failed') {
        throw new Error(event.data.message ?? 'Conversion failed');
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.status === 401) {
      clearToken();
      showAuthGate();
      return;
    }
    els.error.textContent = err.message;
    show(els.error);
  } finally {
    els.convertBtn.disabled = false;
    show(els.resetBtn);
    currentAbort = null;
  }
}

function init() {
  if (!getToken()) {
    showAuthGate();
  } else {
    showApp();
  }

  els.tokenForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = els.tokenInput.value.trim();
    if (!t) return;
    setToken(t);
    els.tokenInput.value = '';
    showApp();
    els.url.focus();
  });

  els.forgetToken.addEventListener('click', () => {
    clearToken();
    showAuthGate();
  });

  els.convertForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = els.url.value.trim();
    if (u) void runConversion(u);
  });

  els.resetBtn.addEventListener('click', () => {
    if (currentAbort) currentAbort.abort();
    resetStatus();
    els.url.value = '';
    els.url.focus();
  });
}

init();
