/**
 * The mock chat page: a self-contained ChatGPT look-alike (sidebar, conversation column, composer
 * with a contenteditable input whose placeholder is "Ask anything", a send button). It reports the
 * composer text and sends to the mock server, and polls it for test commands (clear, close).
 */
export const MOCK_CHAT_TITLE = 'Mock Chat — Dumbledore test page'
export const MOCK_CHAT_PLACEHOLDER = 'Ask anything'

export const MOCK_CHAT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${MOCK_CHAT_TITLE}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0d0d0d; background: #fff; font-size: 16px; }
  body { display: flex; }
  nav { width: 260px; background: #f9f9f9; padding: 12px; display: flex; flex-direction: column; gap: 4px;
    border-right: 1px solid #ececec; }
  nav .brand { font-weight: 600; padding: 8px; }
  nav .item { padding: 8px; border-radius: 8px; font-size: 14px; color: #333; }
  nav .item.active { background: #ececec; }
  nav .label { font-size: 12px; color: #8f8f8f; padding: 16px 8px 4px; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  header { height: 56px; display: flex; align-items: center; padding: 0 20px; font-size: 18px; font-weight: 600; }
  #thread { flex: 1; overflow-y: auto; padding: 16px 0 24px; }
  .col { max-width: 768px; margin: 0 auto; padding: 0 24px; }
  .msg { margin: 22px 0; line-height: 1.6; }
  .msg.user { display: flex; justify-content: flex-end; }
  .msg.user .bubble { background: #f4f4f4; border-radius: 18px; padding: 10px 18px; max-width: 70%; white-space: pre-wrap; }
  .msg.assistant p { margin: 0 0 12px; }
  .typing { color: #8f8f8f; }
  .composer-wrap { padding: 8px 0 28px; }
  .composer { display: flex; align-items: flex-end; gap: 8px; border: 1px solid #e3e3e3; border-radius: 28px;
    padding: 12px 12px 12px 22px; box-shadow: 0 2px 10px rgba(0,0,0,.05); background: #fff; }
  #prompt-textarea { flex: 1; min-height: 28px; max-height: 200px; overflow-y: auto; outline: none; line-height: 28px;
    white-space: pre-wrap; word-break: break-word; }
  #prompt-textarea:empty::before { content: attr(data-placeholder); color: #8f8f8f; pointer-events: none; }
  #send { width: 36px; height: 36px; border-radius: 50%; border: 0; background: #0d0d0d; color: #fff; font-size: 18px;
    cursor: pointer; }
  #send:disabled { background: #d7d7d7; cursor: default; }
  .hint { text-align: center; font-size: 12px; color: #8f8f8f; margin-top: 8px; }
</style>
</head>
<body>
<nav aria-label="Chat history">
  <div class="brand">ChatGPT</div>
  <div class="item">New chat</div>
  <div class="label">Today</div>
  <div class="item active">Photosynthesis basics</div>
  <div class="item">Organic chemistry: SN1 vs SN2</div>
  <div class="label">Previous 7 days</div>
  <div class="item">Linear algebra eigenvalues</div>
  <div class="item">Essay outline on the French Revolution</div>
</nav>
<main>
  <header>ChatGPT 4o</header>
  <div id="thread" role="log" aria-label="Conversation"><div class="col" id="messages"></div></div>
  <div class="composer-wrap"><div class="col">
    <form class="composer" id="composer">
      <div id="prompt-textarea" contenteditable="true" role="textbox" aria-multiline="true"
        aria-label="Message" aria-placeholder="${MOCK_CHAT_PLACEHOLDER}" data-placeholder="${MOCK_CHAT_PLACEHOLDER}"></div>
      <button id="send" type="submit" aria-label="Send prompt" data-testid="send-button" disabled>&#8593;</button>
    </form>
    <div class="hint">Mock chat for Dumbledore tests. Nothing leaves this computer.</div>
  </div></div>
</main>
<script>
(function () {
  var input = document.getElementById('prompt-textarea');
  var send = document.getElementById('send');
  var list = document.getElementById('messages');
  var thread = document.getElementById('thread');
  function text() { return input.innerText.replace(/\\u00a0/g, ' ').replace(/\\n$/, ''); }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function el(tag, cls, content) {
    var e = document.createElement(tag); if (cls) e.className = cls; if (content != null) e.textContent = content; return e;
  }
  function render(messages, pending) {
    list.textContent = '';
    messages.forEach(function (m, i) {
      var row = el('div', 'msg ' + m.role);
      if (m.role === 'user') { row.appendChild(el('div', 'bubble', m.text)); }
      else if (pending && i === messages.length - 1) { row.appendChild(el('p', 'typing', 'Thinking…')); }
      else { m.text.split('\\n\\n').forEach(function (p) { row.appendChild(el('p', null, p)); }); }
      list.appendChild(row);
    });
    thread.scrollTop = thread.scrollHeight;
  }
  function sync() { send.disabled = text().trim() === ''; post('/api/input', { text: text() }); }
  function submit() {
    var t = text().trim();
    if (!t) return;
    input.textContent = '';
    sync();
    post('/api/send', { text: t }).then(function (state) {
      render(state.messages, true);
      setTimeout(function () { render(state.messages, false); }, 300);
    });
  }
  input.addEventListener('input', sync);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  document.getElementById('composer').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  function poll() {
    fetch('/api/command').then(function (r) { return r.json(); }).then(function (c) {
      if (c.command === 'close') { post('/api/closed', {}).finally(function () { window.close(); }); }
      if (c.command === 'clear') { input.textContent = ''; sync(); }
      if (c.command === 'reset') { input.textContent = ''; render([], false); sync(); }
    }).catch(function () {}).finally(function () { setTimeout(poll, 300); });
  }
  fetch('/state').then(function (r) { return r.json(); }).then(function (s) { render(s.messages, false); });
  poll();
  input.focus();
})();
</script>
</body>
</html>
`
