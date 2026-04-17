(() => {
  "use strict";

  const BOOT_KEY = "__cgptQuickNavigationTempChat__";
  const TEMP_BTN_ID = "cgpt-temp-save-btn";
  const SAVE_WRAP_ID = "cgpt-save-dropdown-wrap";
  const TRANSFER_KEY = "cgpt_nav_transfer_payload";
  const TRANSFER_HASH_PREFIX = "#cgpt-transfer=";
  const TRANSFER_TTL_MS = 2 * 60 * 1000;
  const HIDE_TOOLTIP_CLASS = "cgpt-hide-temp-save-tooltip";
  const HIDDEN_TOOLTIP_ATTR = "data-cgpt-temp-tooltip-hidden";

  if (window !== window.top) return;

  if (globalThis[BOOT_KEY]?.scheduleCheck) {
    globalThis[BOOT_KEY].scheduleCheck();
    return;
  }

  const state = {
    checkTimer: 0,
    pushedTransferPayload: null,
    activeTransferToken: null,
    injectedTransferTokens: new Set(),
    lastHref: location.href,
    anchorEl: null,
    anchorMenuEl: null,
    tooltipSuppressed: false,
    tooltipObserver: null,
  };

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        if (globalThis.chrome?.storage?.local) {
          chrome.storage.local.set({ [key]: value }, () => resolve());
          return;
        }
      } catch (_error) {}

      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_error) {}

      resolve();
    });
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        if (globalThis.chrome?.storage?.local) {
          chrome.storage.local.get([key], (result) => {
            resolve(result?.[key] ?? null);
          });
          return;
        }
      } catch (_error) {}

      try {
        const raw = localStorage.getItem(key);
        resolve(raw ? JSON.parse(raw) : null);
        return;
      } catch (_error) {}

      resolve(null);
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      try {
        if (globalThis.chrome?.storage?.local) {
          chrome.storage.local.remove([key], () => resolve());
          return;
        }
      } catch (_error) {}

      try {
        localStorage.removeItem(key);
      } catch (_error) {}

      resolve();
    });
  }

  function isNearTop(el, limit = 220) {
    if (!el?.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= limit;
  }

  function isVisibleElement(el) {
    if (!el?.isConnected) return false;
    const styles = window.getComputedStyle(el);
    if (styles.display === "none" || styles.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isTempChatText(text) {
    return /^(temporary(\s+chat)?|временный(\s+чат)?)$/iu.test(
      normalizeText(text),
    );
  }

  function isIgnoredTempContext(el) {
    return Boolean(
      el?.closest(
        [
          '[role="menu"]',
          '[role="dialog"]',
          '[aria-modal="true"]',
          '[data-radix-popper-content-wrapper]',
          '[data-headlessui-portal]',
          "[hidden]",
          '[aria-hidden="true"]',
          "aside",
        ].join(", "),
      ),
    );
  }

  function isLikelyActiveTempBadge(el) {
    if (!el || !isVisibleElement(el) || !isNearTop(el) || isIgnoredTempContext(el)) {
      return false;
    }

    const text = normalizeText(el.innerText || el.textContent || "");
    const ariaLabel = normalizeText(el.getAttribute?.("aria-label") || "");
    const ownLabel = text || ariaLabel;

    if (!isTempChatText(ownLabel) && !isTempChatText(text) && !isTempChatText(ariaLabel)) {
      return false;
    }

    return ownLabel.length <= 24;
  }

  function findExactTempTextElement() {
    if (!document.body) return null;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!isTempChatText(node.textContent || "")) {
          return NodeFilter.FILTER_SKIP;
        }

        const parent = node.parentElement;
        if (!isLikelyActiveTempBadge(parent)) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const matches = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement) matches.push(node.parentElement);
    }

    matches.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top || aRect.left - bRect.left;
    });

    return matches[0] || null;
  }

  function findTempCandidates() {
    const candidates = new Set();
    const exactText = findExactTempTextElement();
    if (exactText) candidates.add(exactText);

    const direct = document.querySelector('[data-testid="temporary-chat-badge"]');
    if (isLikelyActiveTempBadge(direct)) candidates.add(direct);

    return Array.from(candidates);
  }

  function isTempChat() {
    return Boolean(findTempChatAnchor());
  }

  function findTempChatAnchor() {
    const exactText = findExactTempTextElement();
    if (exactText) return exactText;

    const direct = document.querySelector('[data-testid="temporary-chat-badge"]');
    return isLikelyActiveTempBadge(direct) ? direct : null;
  }

  function mergeRects(...rects) {
    const valid = rects.filter(Boolean);
    if (!valid.length) return null;

    const left = Math.min(...valid.map((rect) => rect.left));
    const top = Math.min(...valid.map((rect) => rect.top));
    const right = Math.max(...valid.map((rect) => rect.right));
    const bottom = Math.max(...valid.map((rect) => rect.bottom));

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function isSameHeaderLine(rectA, rectB, tolerance = 18) {
    if (!rectA || !rectB) return false;
    const centerA = rectA.top + rectA.height / 2;
    const centerB = rectB.top + rectB.height / 2;
    return Math.abs(centerA - centerB) <= tolerance;
  }

  function getTempBadgeRect(anchor, triggerEl) {
    if (!anchor || !isVisibleElement(anchor)) return null;

    const labelRect = anchor.getBoundingClientRect();
    const directBadge = document.querySelector('[data-testid="temporary-chat-badge"]');
    const directRect =
      isLikelyActiveTempBadge(directBadge) && isSameHeaderLine(labelRect, directBadge.getBoundingClientRect())
        ? directBadge.getBoundingClientRect()
        : null;

    const triggerRect =
      triggerEl && isVisibleElement(triggerEl) ? triggerEl.getBoundingClientRect() : null;

    let merged = mergeRects(labelRect, directRect, triggerRect) || labelRect;
    let current = anchor;

    for (let index = 0; index < 4; index += 1) {
      const sibling = current?.previousElementSibling;
      if (!sibling || !isVisibleElement(sibling)) break;

      const siblingRect = sibling.getBoundingClientRect();
      const gap = merged.left - siblingRect.right;
      if (!isSameHeaderLine(merged, siblingRect) || gap < -4 || gap > 18) break;

      merged = mergeRects(merged, siblingRect) || merged;
      current = sibling;
    }

    return merged;
  }

  function sortNodesByDomOrder(nodes) {
    return nodes.sort((a, b) => {
      if (a.el === b.el) return 0;
      const position = a.el.compareDocumentPosition(b.el);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function isDeleteLikeText(text) {
    return /\b(delete|remove|удалить)\b/iu.test(normalizeText(text));
  }

  function extractFileNameFromText(text) {
    const normalized = normalizeText(text);
    if (!normalized || isDeleteLikeText(normalized)) return null;

    const variants = [];

    if (normalized.includes(":")) {
      variants.push(normalized.slice(normalized.lastIndexOf(":") + 1).trim());
    }

    if (normalized.includes(" - ")) {
      variants.push(normalized.slice(normalized.lastIndexOf(" - ") + 3).trim());
    }

    variants.push(normalized);

    for (const variant of variants) {
      if (!variant) continue;

      const directMatch = variant.match(/^[^\\/:*?"<>|\n]+?\.[a-zA-Z0-9]{1,6}$/);
      if (directMatch) return directMatch[0].trim();

      const fileMatches = Array.from(
        variant.matchAll(/[^\\/:*?"<>|\n]+?\.[a-zA-Z0-9]{1,6}(?=$|\s|,|\))/g),
      );

      if (fileMatches.length) {
        return fileMatches[fileMatches.length - 1][0].trim();
      }
    }

    return null;
  }

  function extractMessageText(messageEl) {
    const clone = messageEl.cloneNode(true);
    clone
      .querySelectorAll(
        [
          "[data-cgpt-ts]",
          "[data-cgpt-nav]",
          "#cgpt-nav-host",
          `#${TEMP_BTN_ID}`,
          `#${SAVE_WRAP_ID}`,
          "button",
          '[role="button"]',
          "input",
          "textarea",
          "script",
          "style",
          "noscript",
          "canvas",
          "svg",
          "img",
          'button[aria-label*="Copy" i]',
          'button[aria-label*="Edit" i]',
          'button[aria-label*="Regenerate" i]',
          'button[aria-label*="Поделиться" i]',
        ].join(", "),
      )
      .forEach((node) => node.remove());

    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function extractMessageAttachments(messageEl) {
    const fileExtPattern = /\.[a-zA-Z0-9]{1,6}(\s|$)/;
    const seen = new Set();
    const names = [];

    messageEl
      .querySelectorAll("[aria-label], [title], a, span, p, div")
      .forEach((el) => {
        if (!isVisibleElement(el)) return;

        const values = [
          el.getAttribute?.("aria-label") || "",
          el.getAttribute?.("title") || "",
          normalizeText(el.textContent || ""),
        ];

        for (const value of values) {
          if (!value || !fileExtPattern.test(value) || isDeleteLikeText(value)) {
            continue;
          }

          const name = extractFileNameFromText(value);
          if (!name || seen.has(name)) continue;
          seen.add(name);
          names.push(name);
        }
      });

    return names;
  }

  function extractMessageImages(messageEl) {
    const seen = new Set();
    const images = [];

    messageEl.querySelectorAll("img").forEach((img, index) => {
      if (!isVisibleElement(img)) return;

      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width < 64 && height < 64) return;

      const alt = normalizeText(img.alt || img.getAttribute("aria-label") || "");
      if (/avatar|logo|icon/i.test(alt)) return;

      const src = (img.currentSrc || img.src || "").trim();
      let descriptor = "";

      if (/^https?:\/\//i.test(src)) {
        descriptor = alt ? `${alt}: ${src}` : src;
      } else if (src.startsWith("blob:") || src.startsWith("data:")) {
        descriptor = alt || `Изображение ${index + 1} присутствует в исходном чате`;
      } else if (alt) {
        descriptor = alt;
      }

      descriptor = normalizeText(descriptor);
      if (!descriptor || seen.has(descriptor)) return;
      seen.add(descriptor);
      images.push(descriptor);
    });

    return images;
  }

  function extractChatHistory() {
    const roleNodes = Array.from(
      document.querySelectorAll('[data-message-author-role]'),
    )
      .map((el) => ({
        el,
        role: (el.getAttribute("data-message-author-role") || "").toLowerCase(),
      }))
      .filter((entry) => entry.role === "user" || entry.role === "assistant");

    if (roleNodes.length) {
      return sortNodesByDomOrder(roleNodes)
        .map(({ el, role }) => ({
          role,
          text: extractMessageText(el),
          attachments: extractMessageAttachments(el),
          images: extractMessageImages(el),
        }))
        .filter(
          (entry) =>
            entry.text || entry.attachments.length || entry.images.length,
        );
    }

    return Array.from(document.querySelectorAll("article"))
      .map((el, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        text: extractMessageText(el),
        attachments: extractMessageAttachments(el),
        images: extractMessageImages(el),
      }))
      .filter(
        (entry) => entry.text || entry.attachments.length || entry.images.length,
      );
  }

  function buildTransferText(messages) {
    if (!messages.length) return null;

    const lines = [
      "Продолжай этот чат. Ниже полная история временного чата в порядке сообщений.",
      "Сохрани роли собеседников, учитывай текст, файлы и изображения из переписки.",
      "",
      "---",
    ];

    messages.forEach(({ role, text, attachments, images }, index) => {
      lines.push("");
      lines.push(`[${index + 1}] ${role === "user" ? "Пользователь" : "ChatGPT"}`);

      if (text) {
        lines.push("Текст:");
        lines.push(text);
      }

      if (attachments.length) {
        lines.push("Файлы:");
        attachments.forEach((name) => lines.push(`- ${name}`));
      }

      if (images.length) {
        lines.push("Изображения:");
        images.forEach((image) => lines.push(`- ${image}`));
      }
    });

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("Продолжай этот чат дальше и учитывай весь контекст выше.");

    return lines.join("\n");
  }

  async function setPendingTransfer(token, text) {
    await storageSet(`${TRANSFER_KEY}:${token}`, {
      token,
      text,
      createdAt: Date.now(),
      sourceHref: location.href,
      sourcePath: location.pathname,
    });
  }

  function getTransferTokenFromLocation() {
    const hash = location.hash || "";
    if (!hash.startsWith(TRANSFER_HASH_PREFIX)) return null;
    const token = hash.slice(TRANSFER_HASH_PREFIX.length).trim();
    return token || null;
  }

  function stripTransferHash() {
    try {
      const url = new URL(location.href);
      if (!url.hash.startsWith(TRANSFER_HASH_PREFIX)) return;
      url.hash = "";
      history.replaceState(history.state, "", url.toString());
    } catch (_error) {}
  }

  async function getPendingTransfer() {
    const token = getTransferTokenFromLocation();
    if (!token) return null;

    if (state.pushedTransferPayload?.token === token) {
      return state.pushedTransferPayload;
    }

    try {
      const payload = await storageGet(`${TRANSFER_KEY}:${token}`);
      if (
        !payload ||
        payload.token !== token ||
        typeof payload.text !== "string" ||
        !payload.text.trim()
      ) {
        await storageRemove(`${TRANSFER_KEY}:${token}`);
        stripTransferHash();
        return null;
      }

      if (
        !payload.createdAt ||
        Date.now() - payload.createdAt > TRANSFER_TTL_MS
      ) {
        await storageRemove(`${TRANSFER_KEY}:${token}`);
        stripTransferHash();
        return null;
      }

      return payload;
    } catch (_error) {
      await storageRemove(`${TRANSFER_KEY}:${token}`);
      stripTransferHash();
      return null;
    }
  }

  async function clearPendingTransfer(token) {
    state.pushedTransferPayload = null;
    state.activeTransferToken = null;
    if (!token) return;
    await storageRemove(`${TRANSFER_KEY}:${token}`);
    stripTransferHash();
  }

  function isFreshRootChat() {
    const path = location.pathname || "/";
    return path === "/" || /^\/c\/[a-z0-9-]+\/new$/i.test(path);
  }

  async function openNewChatWithText(text) {
    const token = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const url = new URL("/", location.origin);
    url.hash = `${TRANSFER_HASH_PREFIX.slice(1)}${encodeURIComponent(token)}`;

    await setPendingTransfer(token, text);

    const win = window.open(url.toString(), "_blank");
    if (!win) return;

    let attempts = 0;
    const relay = window.setInterval(() => {
      attempts += 1;
      if (attempts > 30 || win.closed) {
        clearInterval(relay);
        return;
      }

      try {
        win.postMessage(
          { type: "cgpt-temp-transfer", token, text },
          location.origin,
        );
      } catch (_error) {}
    }, 500);
  }

  function resolveComposerElement() {
    const direct = document.querySelector("#prompt-textarea");
    if (direct) {
      if (direct.matches("textarea, [contenteditable='true']")) return direct;
      const nested = direct.querySelector("[contenteditable='true'], textarea");
      if (nested) return nested;
    }

    return (
      document.querySelector("textarea[placeholder]") ||
      document.querySelector("[contenteditable='true'][role='textbox']") ||
      document.querySelector("[contenteditable='true'][data-lexical-editor='true']") ||
      document.querySelector("div[contenteditable='true']")
    );
  }

  function dispatchInputLikeEvents(target, text) {
    const host = target.closest("#prompt-textarea") || target;

    [target, host].forEach((el) => {
      try {
        el.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: text,
            inputType: "insertText",
          }),
        );
      } catch (_error) {}

      try {
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: text,
            inputType: "insertText",
          }),
        );
      } catch (_error) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }

      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_error) {}
    });
  }

  function setComposerValue(el, text) {
    if (!el) return false;
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      dispatchInputLikeEvents(el, text);
      return normalizeText(el.value) === normalizeText(text);
    }

    let inserted = false;

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      inserted = document.execCommand("insertText", false, text);
    } catch (_error) {}

    if (!inserted) {
      try {
        el.textContent = text;
      } catch (_error) {}
    }

    dispatchInputLikeEvents(el, text);
    const finalText = normalizeText(el.innerText || el.textContent || "");
    return finalText.includes(normalizeText(text).slice(0, 50));
  }

  function clickSendIfReady() {
    const selectors = [
      'button[data-testid*="send" i]:not([disabled])',
      'button[aria-label*="Send message" i]:not([disabled])',
      'button[aria-label*="Отправить" i]:not([disabled])',
      'button[aria-label*="Send prompt" i]:not([disabled])',
    ];

    const tryClick = (attempt = 0) => {
      const button = document.querySelector(selectors.join(","));
      if (button) {
        button.click();
        return;
      }

      const composer = resolveComposerElement();
      if (composer && attempt < 10) {
        composer.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
            code: "Enter",
          }),
        );
        composer.dispatchEvent(
          new KeyboardEvent("keyup", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
            code: "Enter",
          }),
        );
      }

      if (attempt < 15) {
        window.setTimeout(() => tryClick(attempt + 1), 250);
      }
    };

    window.setTimeout(() => tryClick(), 250);
  }

  function scheduleAfterHydration(fn) {
    const start = () => window.setTimeout(fn, 1200);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
  }

  async function injectTransferText() {
    const payload = await getPendingTransfer();
    if (!payload) return;
    if (!isFreshRootChat() || isTempChat()) return;
    if (state.activeTransferToken === payload.token) return;
    if (state.injectedTransferTokens.has(payload.token)) return;

    state.activeTransferToken = payload.token;

    const tryInject = async (attempt = 0) => {
      if (state.activeTransferToken !== payload.token) return;

      const composer = resolveComposerElement();
      if (!composer) {
        if (attempt < 60) {
          window.setTimeout(() => {
            void tryInject(attempt + 1);
          }, 350);
        } else {
          state.activeTransferToken = null;
        }
        return;
      }

      const ok = setComposerValue(composer, payload.text);
      if (!ok) {
        if (attempt < 60) {
          window.setTimeout(() => {
            void tryInject(attempt + 1);
          }, 350);
        } else {
          state.activeTransferToken = null;
        }
        return;
      }

      state.injectedTransferTokens.add(payload.token);
      await clearPendingTransfer(payload.token);
      clickSendIfReady();
    };

    scheduleAfterHydration(() => {
      void tryInject();
    });
  }

  async function saveChat() {
    const messages = extractChatHistory();
    if (!messages.length) {
      alert("Не удалось найти сообщения в чате.");
      return;
    }

    const text = buildTransferText(messages);
    if (text) await openNewChatWithText(text);
  }

  function injectDropdownStyles() {
    const styleId = "cgpt-save-dropdown-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      html.${HIDE_TOOLTIP_CLASS} [role="tooltip"],
      html.${HIDE_TOOLTIP_CLASS} [role="status"] {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #${SAVE_WRAP_ID} {
        position: fixed;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483640;
        width: max-content;
        height: max-content;
        pointer-events: none;
      }

      #${TEMP_BTN_ID} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 3px 10px;
        border-radius: 6px;
        border: 1px solid rgba(128,128,128,0.3);
        background: transparent;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        color: inherit;
        opacity: 0.7;
        transition: opacity 0.15s, background 0.15s, border-color 0.15s;
        line-height: 1;
        user-select: none;
        pointer-events: auto;
      }

      #${TEMP_BTN_ID}:hover {
        opacity: 1;
        background: rgba(128,128,128,0.10);
        border-color: rgba(128,128,128,0.45);
      }
    `;

    document.documentElement.appendChild(style);
  }

  function matchesTempTooltipText(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return false;

    return (
      normalized.includes("не будет отображаться") ||
      normalized.includes("журнале чатов") ||
      normalized.includes("won't appear") ||
      normalized.includes("chat history")
    );
  }

  function restoreHiddenTempTooltips() {
    document
      .querySelectorAll(`[${HIDDEN_TOOLTIP_ATTR}="1"]`)
      .forEach((node) => {
        node.style.opacity = node.dataset.cgptTempTooltipOpacity || "";
        node.style.visibility = node.dataset.cgptTempTooltipVisibility || "";
        node.style.pointerEvents = node.dataset.cgptTempTooltipPointerEvents || "";
        delete node.dataset.cgptTempTooltipOpacity;
        delete node.dataset.cgptTempTooltipVisibility;
        delete node.dataset.cgptTempTooltipPointerEvents;
        node.removeAttribute(HIDDEN_TOOLTIP_ATTR);
      });
  }

  function hideTempTooltipNode(node) {
    if (!node || node.getAttribute(HIDDEN_TOOLTIP_ATTR) === "1") return;

    node.setAttribute(HIDDEN_TOOLTIP_ATTR, "1");
    node.dataset.cgptTempTooltipOpacity = node.style.opacity || "";
    node.dataset.cgptTempTooltipVisibility = node.style.visibility || "";
    node.dataset.cgptTempTooltipPointerEvents = node.style.pointerEvents || "";
    node.style.opacity = "0";
    node.style.visibility = "hidden";
    node.style.pointerEvents = "none";
  }

  function suppressTempTooltips() {
    const candidates = new Set([
      ...document.querySelectorAll("[role='tooltip'], [role='status']"),
      ...document.querySelectorAll(
        "[data-radix-popper-content-wrapper], body > div, body > span, body > section, body > aside",
      ),
    ]);

    candidates.forEach((node) => {
      if (!node?.isConnected) return;

      const text = normalizeText(node.innerText || node.textContent || "");
      if (!matchesTempTooltipText(text)) return;

      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      hideTempTooltipNode(node);
    });
  }

  function setTooltipSuppression(enabled) {
    if (enabled) {
      state.tooltipSuppressed = true;
      document.documentElement.classList.add(HIDE_TOOLTIP_CLASS);
      suppressTempTooltips();

      if (!state.tooltipObserver && document.body) {
        state.tooltipObserver = new MutationObserver(() => {
          if (!state.tooltipSuppressed) return;
          suppressTempTooltips();
        });

        state.tooltipObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }

      return;
    }

    state.tooltipSuppressed = false;
    document.documentElement.classList.remove(HIDE_TOOLTIP_CLASS);
    state.tooltipObserver?.disconnect();
    state.tooltipObserver = null;
    restoreHiddenTempTooltips();
  }

  function findFlexRow(anchor, maxDepth = 6) {
    let current = anchor;
    for (let index = 0; index < maxDepth; index += 1) {
      if (!current?.parentElement) break;
      const parent = current.parentElement;
      const styles = window.getComputedStyle(parent);
      if (styles.display === "flex" || styles.display === "inline-flex") {
        return parent;
      }
      current = parent;
    }
    return anchor?.parentNode || null;
  }

  function findMenuLikeButton(container) {
    if (!container) return null;

    const buttons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.id !== TEMP_BTN_ID && isVisibleElement(button),
    );

    if (!buttons.length) return null;

    const explicit = buttons.find((button) => {
      const label = normalizeText(
        button.getAttribute("aria-label") ||
          button.getAttribute("title") ||
          button.innerText ||
          button.textContent ||
          "",
      );

      return (
        button.getAttribute("aria-haspopup") === "menu" ||
        /more|menu|options|actions|ещ[её]|меню|действ/iu.test(label)
      );
    });

    return explicit || buttons[buttons.length - 1];
  }

  function positionSaveButton(anchor) {
    const wrap = document.getElementById(SAVE_WRAP_ID);
    const targetAnchor = anchor || state.anchorEl;
    if (!wrap || !targetAnchor || !isVisibleElement(targetAnchor)) return;

    const triggerEl = targetAnchor.closest("button, [role='button'], a") || targetAnchor;
    const row = findFlexRow(triggerEl) || findFlexRow(targetAnchor);
    const menuButton = findMenuLikeButton(row);

    state.anchorEl = targetAnchor;
    state.anchorMenuEl = menuButton;

    wrap.style.visibility = "hidden";

    requestAnimationFrame(() => {
      const wrapEl = document.getElementById(SAVE_WRAP_ID);
      if (!wrapEl || !state.anchorEl || !isVisibleElement(state.anchorEl)) return;

      const labelRect = state.anchorEl.getBoundingClientRect();
      const badgeRect = getTempBadgeRect(state.anchorEl, triggerEl) || labelRect;
      const rowRect =
        row && isVisibleElement(row) ? row.getBoundingClientRect() : labelRect;
      const wrapRect = wrapEl.getBoundingClientRect();

      let left = Math.round(badgeRect.left - wrapRect.width - 10);
      const maxLeft = Math.round(badgeRect.left - wrapRect.width - 6);
      left = Math.max(12, Math.min(left, maxLeft));

      let top = Math.round(rowRect.top + rowRect.height / 2 - wrapRect.height / 2);
      const maxTop = window.innerHeight - wrapRect.height - 12;
      top = Math.max(12, Math.min(top, maxTop));

      wrapEl.style.left = `${left}px`;
      wrapEl.style.top = `${top}px`;
      wrapEl.style.visibility = "visible";
    });
  }

  function createSaveButton(anchor) {
    if (!anchor || document.getElementById(TEMP_BTN_ID)) return;

    injectDropdownStyles();

    const triggerEl = anchor.closest("button, [role='button'], a") || anchor;
    const row = findFlexRow(triggerEl) || findFlexRow(anchor);
    const menuButton = findMenuLikeButton(row);

    state.anchorEl = anchor;
    state.anchorMenuEl = menuButton;

    const wrap = document.createElement("span");
    wrap.id = SAVE_WRAP_ID;
    wrap.style.visibility = "hidden";

    const button = document.createElement("button");
    button.id = TEMP_BTN_ID;
    button.type = "button";
    button.setAttribute("aria-label", "Сохранить чат");
    button.textContent = "Сохранить";

    button.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    button.addEventListener("mouseenter", () => {
      setTooltipSuppression(true);
    });

    button.addEventListener("mouseleave", () => {
      setTooltipSuppression(false);
    });

    button.addEventListener("focus", () => {
      setTooltipSuppression(true);
    });

    button.addEventListener("blur", () => {
      setTooltipSuppression(false);
    });

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;

      const previousText = button.textContent;
      button.disabled = true;
      button.style.opacity = "0.6";
      button.textContent = "Сохраняю...";

      try {
        await saveChat();
      } finally {
        window.setTimeout(() => {
          setTooltipSuppression(false);
          button.disabled = false;
          button.style.opacity = "";
          button.textContent = previousText;
        }, 1200);
      }
    });

    wrap.appendChild(button);
    document.body.appendChild(wrap);
    positionSaveButton(anchor);
  }

  function removeSaveButton() {
    const wrap = document.getElementById(SAVE_WRAP_ID);
    if (wrap) wrap.remove();
    setTooltipSuppression(false);
    state.anchorEl = null;
    state.anchorMenuEl = null;
  }

  function handlePossibleRouteChange() {
    if (location.href === state.lastHref) return;
    state.lastHref = location.href;
    state.activeTransferToken = null;
  }

  function checkAndInject() {
    handlePossibleRouteChange();
    void injectTransferText();

    if (isTempChat()) {
      const anchor = findTempChatAnchor();
      if (anchor) {
        if (!document.getElementById(TEMP_BTN_ID)) {
          createSaveButton(anchor);
        } else {
          const triggerEl = anchor.closest("button, [role='button'], a") || anchor;
          state.anchorEl = anchor;
          state.anchorMenuEl = findMenuLikeButton(
            findFlexRow(triggerEl) || findFlexRow(anchor),
          );
          positionSaveButton(anchor);
        }
      }
    } else {
      removeSaveButton();
    }
  }

  function scheduleCheck() {
    if (state.checkTimer) return;
    state.checkTimer = window.setTimeout(() => {
      state.checkTimer = 0;
      checkAndInject();
    }, 400);
  }

  window.addEventListener(
    "message",
    (event) => {
      if (event.origin !== location.origin) return;

      const payload = event.data;
      const token = getTransferTokenFromLocation();
      if (
        !token ||
        !payload ||
        payload.type !== "cgpt-temp-transfer" ||
        payload.token !== token ||
        typeof payload.text !== "string"
      ) {
        return;
      }

      state.pushedTransferPayload = {
        token,
        text: payload.text,
        createdAt: Date.now(),
      };

      void storageSet(`${TRANSFER_KEY}:${token}`, state.pushedTransferPayload);
      scheduleCheck();
    },
    { passive: true },
  );

  const observer = new MutationObserver(scheduleCheck);
  const start = () => {
    checkAndInject();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  globalThis[BOOT_KEY] = {
    scheduleCheck,
  };

  window.addEventListener("pageshow", scheduleCheck, { passive: true });
  window.addEventListener("popstate", scheduleCheck, { passive: true });
  window.addEventListener("hashchange", scheduleCheck, { passive: true });
  window.addEventListener("resize", scheduleCheck, { passive: true });
  window.addEventListener("scroll", scheduleCheck, { passive: true, capture: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
