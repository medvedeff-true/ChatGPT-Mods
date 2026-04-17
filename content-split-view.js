(() => {
  "use strict";

  const BOOT_KEY = "__cgptQuickNavigationSplitView__";
  const SPLIT_BTN_ID = "cgpt-split-btn";
  const SPLIT_OVERLAY_ID = "cgpt-split-overlay";
  const SPLIT_CLOSE_ID = "cgpt-split-close-btn";
  const SPLIT_ACTIVE_CLASS = "cgpt-split-active";
  const SPLIT_STYLE_ID = "cgpt-split-style";
  const PASSIVE = { passive: true };

  if (window !== window.top) return;

  if (globalThis[BOOT_KEY]?.ensureSplitButton) {
    globalThis[BOOT_KEY].ensureSplitButton();
    return;
  }

  const state = {
    splitActive: false,
    overlay: null,
    closeBtn: null,
    cleanupDragListeners: null,
    escapeHandler: null,
    previousHtmlOverflow: "",
    previousBodyOverflow: "",
    ensureTimer: 0,
    lastHref: location.href,
  };

  function ensureStyle() {
    if (document.getElementById(SPLIT_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = SPLIT_STYLE_ID;
    style.textContent = `
      html.${SPLIT_ACTIVE_CLASS} #cgpt-nav-host,
      html.${SPLIT_ACTIVE_CLASS} #cgpt-save-dropdown-wrap,
      html.${SPLIT_ACTIVE_CLASS} .cgpt-attach-tooltip {
        display: none !important;
      }
    `;

    document.documentElement.appendChild(style);
  }

  function injectNavIntoIframe(iframe) {
    if (!iframe) return;

    iframe.addEventListener("load", () => {
      const nudge = () => {
        try {
          iframe.contentWindow?.postMessage(
            { type: "cgpt-nav-rebuild" },
            location.origin,
          );
        } catch (_error) {}
      };

      window.setTimeout(nudge, 400);
      window.setTimeout(nudge, 1200);
    });
  }

  function teardownDragListeners() {
    if (state.cleanupDragListeners) {
      state.cleanupDragListeners();
      state.cleanupDragListeners = null;
    }
  }

  function createPane(url, label) {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      flex: 1;
      min-width: 0;
      position: relative;
      display: flex;
      flex-direction: column;
      background: #fff;
    `;

    const bar = document.createElement("div");
    bar.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(0,0,0,0.06);
      border-bottom: 1px solid rgba(0,0,0,0.08);
      font-size: 11px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: rgba(0,0,0,0.45);
      min-height: 26px;
      user-select: none;
      flex-shrink: 0;
    `;
    bar.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      <span>${label}</span>
    `;

    const frame = document.createElement("iframe");
    frame.src = url;
    frame.style.cssText = `
      flex: 1;
      width: 100%;
      border: none;
      display: block;
      background: #fff;
    `;
    frame.setAttribute("allow", "clipboard-read; clipboard-write");

    injectNavIntoIframe(frame);

    wrap.appendChild(bar);
    wrap.appendChild(frame);

    return { wrap, frame };
  }

  function createSplitOverlay() {
    if (document.getElementById(SPLIT_OVERLAY_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = SPLIT_OVERLAY_ID;
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      display: flex;
      background: #000;
      gap: 2px;
    `;

    const currentUrl = location.href;
    const newChatUrl = new URL("/", location.origin).toString();
    const { wrap: leftWrap, frame: leftFrame } = createPane(currentUrl, "Чат 1");
    const { wrap: rightWrap, frame: rightFrame } = createPane(newChatUrl, "Чат 2");

    const divider = document.createElement("div");
    divider.style.cssText = `
      width: 4px;
      cursor: col-resize;
      background: rgba(128,128,128,0.25);
      flex-shrink: 0;
      position: relative;
      transition: background 0.15s;
    `;

    divider.addEventListener("mouseenter", () => {
      divider.style.background = "rgba(37,99,235,0.45)";
    });

    divider.addEventListener("mouseleave", () => {
      if (!state.cleanupDragListeners) {
        divider.style.background = "rgba(128,128,128,0.25)";
      }
    });

    divider.addEventListener("mousedown", (event) => {
      event.preventDefault();

      const startX = event.clientX;
      const startLeftWidth = leftWrap.getBoundingClientRect().width;
      divider.style.background = "rgba(37,99,235,0.7)";
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      leftFrame.style.pointerEvents = "none";
      rightFrame.style.pointerEvents = "none";

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const totalWidth = overlay.clientWidth - 4;
        const nextLeftWidth = Math.max(
          240,
          Math.min(totalWidth - 240, startLeftWidth + deltaX),
        );

        leftWrap.style.flex = "none";
        leftWrap.style.width = `${nextLeftWidth}px`;
        rightWrap.style.flex = "1";
        rightWrap.style.width = "";
      };

      const onMouseUp = () => {
        divider.style.background = "rgba(128,128,128,0.25)";
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        leftFrame.style.pointerEvents = "";
        rightFrame.style.pointerEvents = "";
        teardownDragListeners();
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);

      state.cleanupDragListeners = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        divider.style.background = "rgba(128,128,128,0.25)";
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        leftFrame.style.pointerEvents = "";
        rightFrame.style.pointerEvents = "";
      };
    });

    const closeBtn = document.createElement("button");
    closeBtn.id = SPLIT_CLOSE_ID;
    closeBtn.type = "button";
    closeBtn.title = "Закрыть split view";
    closeBtn.style.cssText = `
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px 4px 8px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(30,30,30,0.82);
      backdrop-filter: blur(6px);
      cursor: pointer;
      font-size: 12px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: rgba(255,255,255,0.85);
      transition: background 0.15s;
    `;
    closeBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      Закрыть split
    `;

    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.background = "rgba(60,60,60,0.9)";
    });

    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.background = "rgba(30,30,30,0.82)";
    });

    closeBtn.addEventListener("click", () => {
      closeSplitView();
    });

    overlay.appendChild(leftWrap);
    overlay.appendChild(divider);
    overlay.appendChild(rightWrap);
    document.body.appendChild(overlay);
    document.body.appendChild(closeBtn);

    state.overlay = overlay;
    state.closeBtn = closeBtn;
  }

  function openSplitView() {
    if (state.splitActive) return;

    ensureStyle();
    state.splitActive = true;
    state.previousHtmlOverflow = document.documentElement.style.overflow;
    state.previousBodyOverflow = document.body.style.overflow;

    document.documentElement.classList.add(SPLIT_ACTIVE_CLASS);
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    removeSplitButton();
    createSplitOverlay();

    state.escapeHandler = (event) => {
      if (event.key === "Escape") closeSplitView();
    };

    document.addEventListener("keydown", state.escapeHandler, true);
  }

  function closeSplitView() {
    if (!state.splitActive) return;

    state.splitActive = false;
    teardownDragListeners();

    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }

    if (state.closeBtn) {
      state.closeBtn.remove();
      state.closeBtn = null;
    }

    if (state.escapeHandler) {
      document.removeEventListener("keydown", state.escapeHandler, true);
      state.escapeHandler = null;
    }

    document.documentElement.classList.remove(SPLIT_ACTIVE_CLASS);
    document.documentElement.style.overflow = state.previousHtmlOverflow;
    document.body.style.overflow = state.previousBodyOverflow;

    ensureSplitButton();
  }

  function removeSplitButton() {
    const button = document.getElementById(SPLIT_BTN_ID);
    if (button) button.remove();
  }

  function createSplitButton() {
    if (document.getElementById(SPLIT_BTN_ID) || state.splitActive) return;

    const button = document.createElement("button");
    button.id = SPLIT_BTN_ID;
    button.type = "button";
    button.title = "Открыть два чата рядом";
    button.setAttribute("aria-label", "Split view - два чата рядом");
    button.style.cssText = `
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483639;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px 4px 8px;
      border-radius: 20px;
      border: 1px solid rgba(128,128,128,0.22);
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: inherit;
      opacity: 0.45;
      transition: opacity 0.15s, background 0.15s, border-color 0.15s;
      pointer-events: auto;
    `;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="2" width="5" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
        <rect x="8" y="2" width="5" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
      </svg>
      <span>Split</span>
    `;

    button.addEventListener("mouseenter", () => {
      button.style.opacity = "0.85";
      button.style.background = "rgba(128,128,128,0.10)";
      button.style.borderColor = "rgba(128,128,128,0.40)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.opacity = "0.45";
      button.style.background = "transparent";
      button.style.borderColor = "rgba(128,128,128,0.22)";
    });

    button.addEventListener("click", openSplitView);
    document.body.appendChild(button);
  }

  function ensureSplitButton() {
    if (!document.body || state.splitActive) return;
    createSplitButton();
  }

  function scheduleEnsureSplitButton() {
    if (state.ensureTimer) return;
    state.ensureTimer = window.setTimeout(() => {
      state.ensureTimer = 0;
      ensureSplitButton();
    }, 0);
  }

  function handlePossibleRouteChange() {
    if (location.href === state.lastHref) return;
    state.lastHref = location.href;
    scheduleEnsureSplitButton();
  }

  function boot() {
    ensureStyle();

    const observer = new MutationObserver(() => {
      handlePossibleRouteChange();
      if (!state.splitActive && !document.getElementById(SPLIT_BTN_ID)) {
        scheduleEnsureSplitButton();
      }
    });

    const start = () => {
      ensureSplitButton();
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };

    window.addEventListener("pageshow", ensureSplitButton, PASSIVE);
    window.addEventListener("popstate", ensureSplitButton, PASSIVE);
    window.addEventListener("hashchange", ensureSplitButton, PASSIVE);

    start();
  }

  globalThis[BOOT_KEY] = {
    ensureSplitButton,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
