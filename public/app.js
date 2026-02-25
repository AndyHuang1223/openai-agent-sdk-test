const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const clearBtn = document.getElementById("clear-btn");

const sessionIdKey = "agent-chat-session-id";
let sessionId = localStorage.getItem(sessionIdKey);
if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem(sessionIdKey, sessionId);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLanguageToken(token) {
  const normalized = token.trim().toLowerCase();
  const aliases = {
    csharp: "csharp",
    "c#": "csharp",
    cpp: "cpp",
    "c++": "cpp",
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
  };

  return aliases[normalized] ?? normalized;
}

function toLanguageClass(language) {
  if (!language) {
    return "";
  }

  const safeLanguage = language.replace(/[^a-z0-9-]/g, "");
  if (!safeLanguage) {
    return "";
  }

  return ` class="language-${safeLanguage}"`;
}

function getLanguageLabel(language) {
  if (!language) {
    return "純文字";
  }

  const labels = {
    csharp: "C#",
    cpp: "C++",
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    bash: "Bash",
    json: "JSON",
    html: "HTML",
    css: "CSS",
    sql: "SQL",
    yaml: "YAML",
    xml: "XML",
  };

  return labels[language] ?? language.toUpperCase();
}

function renderCodeBlock(codeText, language) {
  const languageClass = toLanguageClass(language);
  const languageLabel = escapeHtml(getLanguageLabel(language));

  return `<div class="code-block"><div class="code-block-meta"><span class="code-language-badge">${languageLabel}</span><button type="button" class="copy-code-btn">複製</button></div><pre><code${languageClass}>${escapeHtml(codeText)}</code></pre></div>`;
}

function highlightCodeBlocks(container) {
  const highlighter = window.hljs;
  if (!highlighter || typeof highlighter.highlightElement !== "function") {
    return;
  }

  container.querySelectorAll("pre code").forEach((codeElement) => {
    highlighter.highlightElement(codeElement);
  });
}

let toastTimer = null;
let toastEl = null;

function ensureToastElement() {
  if (toastEl) {
    return toastEl;
  }

  toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  document.body.appendChild(toastEl);
  return toastEl;
}

function showToast(message, variant = "success") {
  const element = ensureToastElement();
  element.textContent = message;
  element.className = `toast show ${variant}`;

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    element.className = "toast";
  }, 1500);
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return html;
}

function renderMarkdown(markdownText) {
  const lines = markdownText.replace(/\r\n/g, "\n").split("\n");
  const htmlParts = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let codeLanguage = "";
  let fenceChar = "`";
  let fenceLength = 3;
  let inUnorderedList = false;
  let inOrderedList = false;

  function closeLists() {
    if (inUnorderedList) {
      htmlParts.push("</ul>");
      inUnorderedList = false;
    }
    if (inOrderedList) {
      htmlParts.push("</ol>");
      inOrderedList = false;
    }
  }

  for (const line of lines) {
    if (inCodeBlock) {
      const closingFencePattern = new RegExp(
        `^\\s*${fenceChar}{${fenceLength},}\\s*$`,
      );
      if (closingFencePattern.test(line)) {
        htmlParts.push(renderCodeBlock(codeBuffer.join("\n"), codeLanguage));
        inCodeBlock = false;
        codeBuffer = [];
        codeLanguage = "";
        fenceChar = "`";
        fenceLength = 3;
        continue;
      }

      codeBuffer.push(line);
      continue;
    }

    const openingFence = line.match(/^\s*([`~]{3,})(?:\s*([^\s`~]+))?.*$/);
    if (openingFence) {
      closeLists();
      inCodeBlock = true;
      fenceChar = openingFence[1][0];
      fenceLength = openingFence[1].length;
      codeLanguage = openingFence[2]
        ? normalizeLanguageToken(openingFence[2])
        : "";
      codeBuffer = [];
      continue;
    }

    if (!line.trim()) {
      closeLists();
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      closeLists();
      htmlParts.push("<hr />");
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      htmlParts.push(
        `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`,
      );
      continue;
    }

    const unorderedItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (unorderedItem) {
      if (inOrderedList) {
        htmlParts.push("</ol>");
        inOrderedList = false;
      }
      if (!inUnorderedList) {
        htmlParts.push("<ul>");
        inUnorderedList = true;
      }
      htmlParts.push(`<li>${renderInlineMarkdown(unorderedItem[1])}</li>`);
      continue;
    }

    const orderedItem = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedItem) {
      if (inUnorderedList) {
        htmlParts.push("</ul>");
        inUnorderedList = false;
      }
      if (!inOrderedList) {
        htmlParts.push("<ol>");
        inOrderedList = true;
      }
      htmlParts.push(`<li>${renderInlineMarkdown(orderedItem[1])}</li>`);
      continue;
    }

    closeLists();
    htmlParts.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  if (inCodeBlock) {
    htmlParts.push(renderCodeBlock(codeBuffer.join("\n"), codeLanguage));
  }

  closeLists();
  return htmlParts.join("\n");
}

function setMessageContent(node, role, text) {
  if (role === "agent") {
    node.innerHTML = renderMarkdown(text);
    highlightCodeBlocks(node);
    return;
  }
  node.textContent = text;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

messagesEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest(".copy-code-btn");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const codeBlock = button.closest(".code-block");
  const preElement = codeBlock?.querySelector("pre");
  const codeElement = codeBlock?.querySelector("pre code");
  const codeText =
    preElement?.innerText ??
    preElement?.textContent ??
    codeElement?.textContent ??
    "";

  if (!codeText.trim()) {
    button.textContent = "無內容";
    showToast("這個區塊沒有可複製內容", "error");
    setTimeout(() => {
      button.textContent = "複製";
    }, 1200);
    return;
  }

  try {
    await copyTextToClipboard(codeText);
    button.textContent = "已複製";
    showToast("已複製程式碼", "success");
  } catch {
    button.textContent = "失敗";
    showToast("複製失敗，請再試一次", "error");
  }

  setTimeout(() => {
    button.textContent = "複製";
  }, 1200);
});

function appendMessage(role, text) {
  const item = document.createElement("div");
  item.className = `msg ${role}`;
  setMessageContent(item, role, text);
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return item;
}

async function resetSession() {
  try {
    await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // ignore reset errors and still reset local session
  }

  sessionId = crypto.randomUUID();
  localStorage.setItem(sessionIdKey, sessionId);
  messagesEl.innerHTML = "";
}

async function sendMessage(message) {
  const userNode = appendMessage("user", message);
  if (!userNode) return;

  const agentNode = appendMessage("agent", "");

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({ error: "請求失敗" }));
    agentNode.textContent = `錯誤：${payload.error ?? "請求失敗"}`;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let agentText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    agentText += decoder.decode(value, { stream: true });
    setMessageContent(agentNode, "agent", agentText);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  agentText += decoder.decode();
  setMessageContent(agentNode, "agent", agentText);
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;

  inputEl.value = "";
  sendBtn.disabled = true;
  clearBtn.disabled = true;
  inputEl.disabled = true;

  try {
    await sendMessage(message);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "請求失敗";
    appendMessage("agent", `錯誤：${messageText}`);
  } finally {
    sendBtn.disabled = false;
    clearBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }
});

clearBtn.addEventListener("click", async () => {
  clearBtn.disabled = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  try {
    await resetSession();
  } finally {
    clearBtn.disabled = false;
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }
});
