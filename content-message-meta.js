(() => {
  "use strict";

  const BOOT_KEY = "__cgptQuickNavigationMessageMeta__";
  const STYLE_ID = "cgpt-message-meta-style";
  const TIME_CLASS = "cgpt-inline-time";
  const TIME_ROW_CLASS = "cgpt-inline-time-row";
  const INFO_BTN_CLASS = "cgpt-attach-info-btn";
  const TOOLTIP_CLASS = "cgpt-attach-tooltip";
  const COMPOSER_MARK_ATTR = "data-cgpt-composer-files";
  const TIMESTAMP_ATTR = "data-cgpt-ts-injected";
  const PASSIVE = { passive: true };

  if (window !== window.top) return;

  if (globalThis[BOOT_KEY]?.scheduleRun) {
    globalThis[BOOT_KEY].scheduleRun();
    return;
  }

  const timeCache = new WeakMap();
  let timer = 0;
  let conversationTimestampCache = {
    conversationId: null,
    stamps: null,
    promise: null,
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${TIME_CLASS} {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        line-height: 1.2;
        color: color-mix(in srgb, currentColor 45%, transparent);
        white-space: nowrap;
        pointer-events: none;
        padding: 0 2px 2px;
      }

      .${TIME_CLASS}[data-cgpt-ts-inline="1"] {
        display: inline-flex;
        align-items: center;
        margin-top: 0;
        margin-left: 8px;
        padding: 0;
        line-height: 1;
      }

      .${TIME_ROW_CLASS} {
        display: flex;
        align-items: center;
        width: 100%;
        min-height: 14px;
        margin-top: 6px;
        padding: 0 2px 2px;
        pointer-events: none;
      }

      .${TIME_ROW_CLASS}[data-cgpt-ts-align="user"] {
        justify-content: flex-end;
      }

      .${TIME_ROW_CLASS}[data-cgpt-ts-align="assistant"] {
        justify-content: flex-start;
      }

      .${INFO_BTN_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        min-width: 18px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: help;
        padding: 0;
        opacity: .82;
        margin-right: 8px;
      }

      .${INFO_BTN_CLASS}:hover {
        opacity: 1;
        background: color-mix(in srgb, currentColor 10%, transparent);
      }

      .${TOOLTIP_CLASS} {
        position: fixed;
        z-index: 2147483646;
        max-width: min(420px, calc(100vw - 24px));
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(19, 19, 22, 0.96);
        color: rgba(255,255,255,0.96);
        box-shadow: 0 14px 30px rgba(0,0,0,.28);
        font-size: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity .12s ease, transform .12s ease;
      }

      .${TOOLTIP_CLASS}.is-on {
        opacity: 1;
        transform: translateY(0);
      }
    `;

    document.documentElement.appendChild(style);
  }

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function getReactProps(el) {
    if (!el || typeof el !== "object") return null;

    for (const key in el) {
      if (key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")) {
        try {
          const value = el[key];
          if (key.startsWith("__reactFiber$") && value?.memoizedProps) {
            return value.memoizedProps;
          }
          if (value) return value;
        } catch (_error) {}
      }
    }

    return null;
  }

  function getConversationIdFromLocation() {
    const parts = location.pathname.split("/").filter(Boolean);
    const cIndex = parts.lastIndexOf("c");
    if (cIndex >= 0 && parts[cIndex + 1]) return parts[cIndex + 1];
    if (parts[0] === "c" && parts[1]) return parts[1];
    return null;
  }

  function maybeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    if (typeof value === "number" && Number.isFinite(value)) {
      if (value > 1e12) return new Date(value);
      if (value > 1e9) return new Date(value * 1000);
    }

    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return null;
      if (/^\d{10}(\.\d+)?$/.test(text)) return new Date(Number(text) * 1000);
      if (/^\d{13}$/.test(text)) return new Date(Number(text));
      if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ||
        /^\d{4}-\d{2}-\d{2} /.test(text)
      ) {
        const date = new Date(text);
        if (!Number.isNaN(date.getTime())) return date;
      }
    }

    return null;
  }

  function findTimestampInObject(obj, depth = 0, seen = new WeakSet()) {
    if (!obj || depth > 5 || typeof obj !== "object" || seen.has(obj)) {
      return null;
    }

    seen.add(obj);

    for (const key of [
      "create_time",
      "createTime",
      "timestamp",
      "time",
      "updated_at",
      "update_time",
    ]) {
      if (!(key in obj)) continue;
      const date = maybeDate(obj[key]);
      if (date && !Number.isNaN(date.getTime()) && date.getFullYear() >= 2020) {
        return date;
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "function") continue;

      if (typeof value === "string" || typeof value === "number") {
        if (/time|date|created|updated/i.test(key)) {
          const date = maybeDate(value);
          if (date && !Number.isNaN(date.getTime()) && date.getFullYear() >= 2020) {
            return date;
          }
        }
        continue;
      }

      const nestedDate = maybeDate(value);
      if (
        nestedDate &&
        !Number.isNaN(nestedDate.getTime()) &&
        nestedDate.getFullYear() >= 2020
      ) {
        return nestedDate;
      }

      if (value && typeof value === "object") {
        const nested = findTimestampInObject(value, depth + 1, seen);
        if (nested) return nested;
      }
    }

    return null;
  }

  function formatTimestamp(date) {
    if (!date || Number.isNaN(date.getTime())) return "";

    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

    if (sameDay) return `сегодня, ${time}`;
    if (isYesterday) return `вчера, ${time}`;

    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  async function fetchConversationTimestamps() {
    const conversationId = getConversationIdFromLocation();
    if (!conversationId) return null;

    if (
      conversationTimestampCache.conversationId === conversationId &&
      Array.isArray(conversationTimestampCache.stamps)
    ) {
      return conversationTimestampCache.stamps;
    }

    if (
      conversationTimestampCache.conversationId === conversationId &&
      conversationTimestampCache.promise
    ) {
      return conversationTimestampCache.promise;
    }

    const promise = fetch(`/backend-api/conversation/${conversationId}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const mapping = data?.mapping || {};
        const stamps = Object.values(mapping)
          .map((node) => {
            const message = node?.message;
            const role = message?.author?.role || node?.author?.role || null;
            const date = maybeDate(
              message?.create_time || node?.create_time || message?.update_time,
            );

            return role && date ? { role, date } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.date - b.date)
          .map((entry) => ({
            role: entry.role,
            text: formatTimestamp(entry.date),
          }));

        conversationTimestampCache = {
          conversationId,
          stamps,
          promise: null,
        };

        return stamps;
      })
      .catch(() => {
        conversationTimestampCache = {
          conversationId,
          stamps: null,
          promise: null,
        };
        return null;
      });

    conversationTimestampCache = {
      conversationId,
      stamps: null,
      promise,
    };

    return promise;
  }

  function extractTimestampForMessage(messageEl) {
    if (!messageEl) return "";

    const cached = timeCache.get(messageEl);
    if (cached) return cached;

    let found = null;
    const candidates = [
      messageEl,
      messageEl.parentElement,
      messageEl.closest("[data-testid], article, section, li, div"),
      ...Array.from(messageEl.querySelectorAll("*")).slice(0, 120),
    ].filter(Boolean);

    for (const node of candidates) {
      const props = getReactProps(node);
      if (!props) continue;

      const date = findTimestampInObject(props);
      if (date) {
        found = date;
        break;
      }
    }

    if (!found) {
      const timeEl =
        messageEl.querySelector("time[datetime], [datetime]") ||
        messageEl.parentElement?.querySelector?.("time[datetime], [datetime]");
      const raw = timeEl?.getAttribute("datetime") || timeEl?.textContent || "";
      found = maybeDate(raw);
    }

    const formatted = found ? formatTimestamp(found) : "";
    if (formatted) timeCache.set(messageEl, formatted);
    return formatted;
  }

  function getMessageScope(messageEl) {
    return (
      messageEl.closest('[data-testid*="conversation-turn" i]') ||
      messageEl.closest('[data-testid*="turn" i]') ||
      messageEl.closest("article") ||
      messageEl.closest("section") ||
      messageEl.closest("li") ||
      messageEl.parentElement ||
      messageEl
    );
  }

  function isMenuLikeButton(button) {
    if (!button || !isVisibleElement(button)) return false;

    const label = normalizeText(
      button.getAttribute("aria-label") ||
        button.getAttribute("title") ||
        button.innerText ||
        button.textContent ||
        "",
    );

    if (button.getAttribute("aria-haspopup") === "menu") return true;
    if (/more|menu|options|actions|details|ещ[её]|меню|действ/iu.test(label)) {
      return true;
    }

    return false;
  }

  function getActionSearchRoots(messageEl) {
    const scope = getMessageScope(messageEl);
    return Array.from(
      new Set(
        [
          messageEl,
          messageEl.parentElement,
          scope,
          scope?.parentElement,
          scope?.nextElementSibling,
        ].filter(Boolean),
      ),
    );
  }

  function findButtonRow(button, boundary) {
    let row = button?.parentElement || null;

    while (row) {
      const styles = window.getComputedStyle(row);
      const buttonCount = row.querySelectorAll("button").length;
      if (
        styles.display === "flex" ||
        styles.display === "inline-flex" ||
        styles.display === "grid" ||
        buttonCount > 1
      ) {
        return row;
      }

      if (row === boundary) break;
      row = row.parentElement;
    }

    return button?.parentElement || null;
  }

  function findActionPlacement(messageEl) {
    const scope = getMessageScope(messageEl);
    const scopeRect = scope.getBoundingClientRect();
    const buttons = [];

    getActionSearchRoots(messageEl).forEach((root) => {
      root.querySelectorAll("button").forEach((button) => {
        if (!isVisibleElement(button) || buttons.includes(button)) return;

        const rect = button.getBoundingClientRect();
        const verticallyNear =
          rect.bottom >= scopeRect.top - 16 && rect.top <= scopeRect.bottom + 56;
        const horizontallyNear =
          rect.left <= scopeRect.right + 56 && rect.right >= scopeRect.left - 56;

        if (verticallyNear && horizontallyNear) {
          buttons.push(button);
        }
      });
    });

    if (!buttons.length) return { row: null, anchor: null };

    buttons.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top || aRect.left - bRect.left;
    });

    const menuButton = buttons.find(isMenuLikeButton) || buttons[buttons.length - 1];
    return { row: findButtonRow(menuButton, scope), anchor: menuButton };
  }

  function canUseInlinePlacement(row, anchor) {
    if (!row || !anchor || anchor.parentNode !== row) return false;

    let current = row;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const styles = window.getComputedStyle(current);
      if (styles.display === "none" || styles.visibility === "hidden") {
        return false;
      }

      const opacity = Number.parseFloat(styles.opacity || "1");
      if (Number.isFinite(opacity) && opacity < 0.35) {
        return false;
      }

      current = current.parentElement;
    }

    return true;
  }

  function upsertFooterTimestamp(scope, role, timeEl) {
    let footer = scope.querySelector(`[data-cgpt-ts-row="1"]`);
    if (!footer) {
      footer = document.createElement("div");
      footer.className = TIME_ROW_CLASS;
      footer.setAttribute("data-cgpt-ts-row", "1");
      scope.appendChild(footer);
    }

    footer.setAttribute(
      "data-cgpt-ts-align",
      role === "user" ? "user" : "assistant",
    );
    footer.replaceChildren(timeEl);
  }

  function upsertTimestamp(messageEl, role, text) {
    const scope = getMessageScope(messageEl);
    let timeEl =
      scope.querySelector(`[data-cgpt-ts="1"]`) ||
      messageEl.querySelector(`[data-cgpt-ts="1"]`);

    if (!timeEl) {
      timeEl = document.createElement("div");
      timeEl.className = TIME_CLASS;
      timeEl.setAttribute("data-cgpt-ts", "1");
    }

    timeEl.textContent = text;

    const { row, anchor } = findActionPlacement(messageEl);
    if (canUseInlinePlacement(row, anchor)) {
      scope.querySelector(`[data-cgpt-ts-row="1"]`)?.remove();
      timeEl.setAttribute("data-cgpt-ts-inline", "1");
      timeEl.style.textAlign = "";
      anchor.insertAdjacentElement("afterend", timeEl);
    } else {
      timeEl.removeAttribute("data-cgpt-ts-inline");
      timeEl.style.textAlign = role === "user" ? "right" : "left";
      upsertFooterTimestamp(scope, role, timeEl);
    }

    messageEl.setAttribute(TIMESTAMP_ATTR, "1");
    scope.setAttribute(TIMESTAMP_ATTR, "1");
    timeCache.set(messageEl, text);
  }

  async function injectTimestamps() {
    const messageEls = Array.from(
      document.querySelectorAll("[data-message-author-role]"),
    );
    if (!messageEls.length) return;

    const missing = [];

    messageEls.forEach((messageEl) => {
      const existingText = normalizeText(
        messageEl.querySelector("[data-cgpt-ts='1']")?.textContent || "",
      );
      const text = existingText || extractTimestampForMessage(messageEl);
      if (!text) {
        missing.push(messageEl);
        return;
      }

      upsertTimestamp(
        messageEl,
        messageEl.getAttribute("data-message-author-role") || "assistant",
        text,
      );
    });

    if (!missing.length) return;

    const fallbackStamps = await fetchConversationTimestamps();
    if (!Array.isArray(fallbackStamps) || !fallbackStamps.length) return;

    const orderedStamps = fallbackStamps.filter(
      (entry) => entry.role === "user" || entry.role === "assistant",
    );

    let stampIndex = 0;
    missing.forEach((messageEl) => {
      const role = messageEl.getAttribute("data-message-author-role") || "assistant";

      while (
        stampIndex < orderedStamps.length &&
        orderedStamps[stampIndex].role !== role
      ) {
        stampIndex += 1;
      }

      const match = orderedStamps[stampIndex];
      if (!match?.text) return;

      upsertTimestamp(messageEl, role, match.text);
      stampIndex += 1;
    });
  }

  function getTooltip() {
    let tooltip = document.querySelector(`.${TOOLTIP_CLASS}`);
    if (tooltip) return tooltip;

    tooltip = document.createElement("div");
    tooltip.className = TOOLTIP_CLASS;
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(anchor, text) {
    const tooltip = getTooltip();
    tooltip.textContent = text;
    tooltip.classList.add("is-on");

    const anchorRect = anchor.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    let left = anchorRect.left;
    let top = anchorRect.bottom + 8;

    if (left + tipRect.width > window.innerWidth - 12) {
      left = window.innerWidth - tipRect.width - 12;
    }
    if (left < 12) left = 12;
    if (top + tipRect.height > window.innerHeight - 12) {
      top = anchorRect.top - tipRect.height - 8;
    }
    if (top < 12) top = 12;

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    const tooltip = document.querySelector(`.${TOOLTIP_CLASS}`);
    if (tooltip) tooltip.classList.remove("is-on");
  }

  function isVisibleElement(el) {
    if (!el?.isConnected) return false;
    const styles = window.getComputedStyle(el);
    if (styles.display === "none" || styles.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDeleteLikeText(text) {
    return /\b(delete|remove|удалить)\b/iu.test(normalizeText(text));
  }

  function extractFileNameFromText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return null;

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

  function resolveComposerElement() {
    const root = document.querySelector("#prompt-textarea");
    if (root) {
      if (root.matches("textarea, [contenteditable='true']")) return root;
      const nested = root.querySelector("[contenteditable='true'], textarea");
      if (nested) return nested;
    }

    return (
      document.querySelector("textarea[placeholder]") ||
      document.querySelector("[contenteditable='true'][role='textbox']") ||
      document.querySelector("[contenteditable='true'][data-lexical-editor='true']") ||
      document.querySelector("div[contenteditable='true']")
    );
  }

  function locateComposerForm() {
    const composer = resolveComposerElement();
    return composer?.closest("form") || null;
  }

  function extractSingleAttachmentName(el) {
    const ariaLabel = (el.getAttribute?.("aria-label") || "").trim();
    const title = (el.getAttribute?.("title") || "").trim();

    let directText = "";
    for (const child of el.childNodes || []) {
      if (child.nodeType === Node.TEXT_NODE) {
        directText = normalizeText(child.textContent);
        if (directText) break;
      }
    }

    for (const source of [directText, title, ariaLabel]) {
      if (!source) continue;
      const name = extractFileNameFromText(source);
      if (name) return name;
    }

    return null;
  }

  function collectComposerAttachmentData() {
    const form = locateComposerForm();
    if (!form) return { form: null, names: [], anchor: null };

    const names = [];
    const seen = new Set();
    let anchor = null;
    const fileExtPattern = /\.[a-zA-Z0-9]{1,6}(\s|$)/;
    const candidates = new Set();

    form.querySelectorAll("[aria-label], [title]").forEach((el) => {
      const value = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      if (!isVisibleElement(el)) return;
      if (isDeleteLikeText(value)) return;
      if (fileExtPattern.test(value)) candidates.add(el);
    });

    form
      .querySelectorAll('[data-testid*="attach" i], [class*="attach" i], [class*="file" i]')
      .forEach((container) => {
        container.querySelectorAll("span, p, div").forEach((el) => {
          if (!isVisibleElement(el)) return;
          const text = normalizeText(el.textContent || "");
          if (isDeleteLikeText(text)) return;
          if (fileExtPattern.test(text) && !text.includes("\n") && text.length < 200) {
            candidates.add(el);
          }
        });
      });

    candidates.forEach((el) => {
      const name = extractSingleAttachmentName(el);
      if (!name || seen.has(name)) return;
      seen.add(name);
      names.push(name);
      if (!anchor) anchor = el.closest("button, a") || el;
    });

    return { form, names, anchor };
  }

  function updateComposerAttachmentInfo() {
    const { form, names, anchor } = collectComposerAttachmentData();
    if (!form) return;

    let host = form.querySelector(`[${COMPOSER_MARK_ATTR}="1"]`);

    if (names.length < 2 || !anchor) {
      if (host) host.remove();
      return;
    }

    if (!host) {
      host = document.createElement("button");
      host.type = "button";
      host.className = INFO_BTN_CLASS;
      host.setAttribute(COMPOSER_MARK_ATTR, "1");
      host.textContent = "i";
      host.title = "";
      host.setAttribute("aria-label", "");
      (anchor.parentElement || form).insertBefore(host, anchor);
      host.addEventListener("mouseleave", hideTooltip);
      host.addEventListener("blur", hideTooltip);
    }

    const tooltipText = names.map((name, index) => `${index + 1}. ${name}`).join("\n");
    host.onmouseenter = () => showTooltip(host, tooltipText);
    host.onfocus = () => showTooltip(host, tooltipText);
  }

  function run() {
    ensureStyle();
    void injectTimestamps();
    updateComposerAttachmentInfo();
  }

  function scheduleRun() {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      run();
    }, 250);
  }

  const observer = new MutationObserver(scheduleRun);
  const start = () => {
    run();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  globalThis[BOOT_KEY] = {
    scheduleRun,
  };

  window.addEventListener("pageshow", scheduleRun, PASSIVE);
  window.addEventListener("popstate", scheduleRun, PASSIVE);
  window.addEventListener("resize", hideTooltip, PASSIVE);
  window.addEventListener("scroll", hideTooltip, PASSIVE);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
