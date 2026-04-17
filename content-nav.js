(() => {
  "use strict";

  const BOOT_KEY = "__cgptQuickNavigationNav__";
  const HOST_ID = "cgpt-nav-host";
  const SHADOW_MOUNT_ID = "cgpt-nav-shadow-mount";
  const PASSIVE = { passive: true };

  if (globalThis[BOOT_KEY]?.scheduleRebuild) {
    globalThis[BOOT_KEY].scheduleRebuild();
    return;
  }

  const state = {
    userMessages: [],
    currentIndex: -1,
    hovered: false,
    scheduledRebuild: false,
    scheduledActive: false,
    listUserScrollAt: 0,
    programmaticListScroll: false,
    rebuildTimer: 0,
    observer: null,
    themeObserver: null,
    scrollEl: null,
    rootEl: null,
    panelEl: null,
    listEl: null,
    tipEl: null,
    hoverTipTimer: 0,
    lastHref: location.href,
  };

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex = "2147483647";

    document.documentElement.appendChild(host);
    return host;
  }

  function isDarkTheme() {
    const html = document.documentElement;
    const body = document.body;
    return Boolean(
      html?.classList.contains("dark") ||
        body?.classList.contains("dark") ||
        html?.getAttribute("data-theme") === "dark" ||
        body?.getAttribute("data-theme") === "dark" ||
        html?.getAttribute("data-ds-dark-theme") ||
        body?.getAttribute("data-ds-dark-theme"),
    );
  }

  function updateThemeFlag(shadowRoot) {
    const host = shadowRoot?.host;
    if (!host) return;
    host.setAttribute("data-cgpt-theme", isDarkTheme() ? "dark" : "light");
  }

  function updateRightOffset() {
    if (!state.rootEl) return;

    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );
    const minOverlayGutter = 14;
    const baseRight = 16;
    const extra = Math.max(scrollbarWidth, minOverlayGutter);
    state.rootEl.style.right = `${baseRight + extra}px`;
  }

  function updateListMaxHeight() {
    if (!state.listEl) return;
    const maxHeight = Math.min(250, Math.max(120, window.innerHeight - 80));
    state.listEl.style.maxHeight = `${Math.round(maxHeight)}px`;
    state.rootEl?.style.setProperty(
      "--cgpt-list-max-height",
      `${Math.round(maxHeight)}px`,
    );
  }

  function updateListLayout() {
    const list = state.listEl;
    const panel = state.panelEl;
    if (!list || !panel) return;

    const baseTop = 20;
    const baseRight = 0;
    const baseBottom = 20;
    const baseLeft = 24;

    list.style.padding = `${baseTop}px ${baseRight}px ${baseBottom}px ${baseLeft}px`;
    list.style.justifyContent = "flex-start";

    const items = Array.from(list.querySelectorAll("[data-cgpt-nav='item']"));
    if (!items.length) {
      list.scrollTop = 0;
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const contentHeight = last.offsetTop + last.offsetHeight - first.offsetTop;
    const availableHeight = Math.max(0, panel.clientHeight - baseTop - baseBottom);

    if (contentHeight <= availableHeight + 1) {
      list.style.justifyContent = "center";
      list.scrollTop = 0;
    }
  }

  function updatePanelMasks() {
    const panel = state.panelEl;
    const list = state.listEl;
    if (!panel || !list) return;

    const canScroll = list.scrollHeight > list.clientHeight + 1;
    if (!state.hovered || !canScroll) {
      panel.classList.add("cgpt-mask-off");
      panel.classList.remove("cgpt-mask-top-off", "cgpt-mask-bottom-off");
      return;
    }

    const atTop = list.scrollTop <= 1;
    const atBottom =
      list.scrollTop + list.clientHeight >= list.scrollHeight - 1;

    panel.classList.remove("cgpt-mask-off");
    panel.classList.toggle("cgpt-mask-top-off", atTop);
    panel.classList.toggle("cgpt-mask-bottom-off", atBottom);
  }

  function clearHoverTip() {
    if (state.hoverTipTimer) {
      clearTimeout(state.hoverTipTimer);
      state.hoverTipTimer = 0;
    }

    if (state.tipEl) {
      state.tipEl.classList.remove("is-on");
      state.tipEl.textContent = "";
    }
  }

  function scheduleHoverTip(itemEl, text) {
    clearHoverTip();

    state.hoverTipTimer = window.setTimeout(() => {
      if (!state.tipEl || !itemEl.isConnected || !state.hovered) return;

      const panelRect = state.panelEl?.getBoundingClientRect();
      const itemRect = itemEl.getBoundingClientRect();
      const pad = 8;
      const gap = 12;
      const anchorLeft = panelRect ? panelRect.left : itemRect.left;
      const available = Math.max(180, anchorLeft - gap - pad);

      state.tipEl.style.maxWidth = `${Math.min(520, Math.floor(available))}px`;
      state.tipEl.textContent = text || "";
      state.tipEl.classList.add("is-on");

      requestAnimationFrame(() => {
        if (!state.tipEl) return;

        const tipRect = state.tipEl.getBoundingClientRect();
        let left = anchorLeft - gap - tipRect.width;
        let top = itemRect.top + itemRect.height / 2 - tipRect.height / 2;

        if (left < pad) left = pad;
        if (top < pad) top = pad;

        const maxTop = window.innerHeight - tipRect.height - pad;
        if (top > maxTop) top = maxTop;

        state.tipEl.style.left = `${Math.round(left)}px`;
        state.tipEl.style.top = `${Math.round(top)}px`;
      });
    }, 1900);
  }

  function isScrollableY(el) {
    if (!el) return false;
    const overflowY = window.getComputedStyle(el).overflowY;
    return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
  }

  function resolveScrollEl(seedEl) {
    let node = seedEl?.parentElement || null;
    const candidates = [];
    const minHeight = Math.min(520, Math.floor(window.innerHeight * 0.4));
    const minWidth = Math.min(520, Math.floor(window.innerWidth * 0.35));

    while (node && node !== document.documentElement) {
      if (isScrollableY(node) && node.scrollHeight > node.clientHeight + 40) {
        const largeEnough =
          node.clientHeight >= minHeight &&
          node.clientWidth >= minWidth &&
          node.clientHeight > 200;
        if (largeEnough) candidates.push(node);
      }
      node = node.parentElement;
    }

    if (!candidates.length) return window;
    candidates.sort((a, b) => b.clientHeight - a.clientHeight);
    return candidates[0];
  }

  function bindScrollEl(next) {
    const previous = state.scrollEl;
    if (previous === next) return;

    if (previous) {
      const target = previous === window ? window : previous;
      target.removeEventListener("scroll", scheduleActiveFromScroll, PASSIVE);
    }

    state.scrollEl = next;

    if (next) {
      const target = next === window ? window : next;
      target.addEventListener("scroll", scheduleActiveFromScroll, PASSIVE);
    }
  }

  function ensureScrollBinding() {
    if (!state.userMessages.length) {
      bindScrollEl(null);
      return;
    }

    const index = Math.min(
      state.userMessages.length - 1,
      Math.max(0, state.currentIndex >= 0 ? state.currentIndex : 0),
    );
    const seed = state.userMessages[index] || state.userMessages[0];
    bindScrollEl(resolveScrollEl(seed));
  }

  function getScrollTop() {
    if (!state.scrollEl || state.scrollEl === window) {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }
    return state.scrollEl.scrollTop;
  }

  function getViewportHeight() {
    if (!state.scrollEl || state.scrollEl === window) {
      return window.innerHeight || 800;
    }
    return state.scrollEl.clientHeight || window.innerHeight || 800;
  }

  function getMessageTopInScroll(messageEl) {
    if (!state.scrollEl || state.scrollEl === window) {
      return messageEl.getBoundingClientRect().top + (window.scrollY || 0);
    }

    const scrollRect = state.scrollEl.getBoundingClientRect();
    const messageRect = messageEl.getBoundingClientRect();
    return messageRect.top - scrollRect.top + state.scrollEl.scrollTop;
  }

  function normalizeText(text) {
    return (text || "").replace(/\u200B/g, "").replace(/\s+/g, " ").trim();
  }

  function titleFromText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return "-";
    return normalized.length > 80
      ? `${normalized.slice(0, 80)}...`
      : normalized;
  }

  function sortNodesByDomOrder(nodes) {
    return nodes.sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function findUserMessages() {
    const byRole = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]'),
    ).filter((el) => normalizeText(el.textContent).length > 0);

    if (byRole.length) return sortNodesByDomOrder(byRole);

    const articles = Array.from(document.querySelectorAll("article")).filter(
      (el) => normalizeText(el.textContent).length > 0,
    );

    return sortNodesByDomOrder(articles);
  }

  function extractUserText(el) {
    return normalizeText(el.innerText || el.textContent || "");
  }

  function findClosestIndexByYLive(y) {
    const count = state.userMessages.length;
    if (!count) return -1;

    let low = 0;
    let high = count - 1;

    while (low < high) {
      const mid = (low + high) >> 1;
      const top = getMessageTopInScroll(state.userMessages[mid]);
      if (top < y) low = mid + 1;
      else high = mid;
    }

    const index = low;
    if (index <= 0) return 0;
    if (index >= count) return count - 1;

    const previous = index - 1;
    const prevTop = getMessageTopInScroll(state.userMessages[previous]);
    const currentTop = getMessageTopInScroll(state.userMessages[index]);

    return Math.abs(prevTop - y) <= Math.abs(currentTop - y)
      ? previous
      : index;
  }

  function keepItemVisibleInList(itemEl) {
    if (!state.listEl) return;

    const pad = 14;
    const itemTop = itemEl.offsetTop;
    const itemBottom = itemTop + itemEl.offsetHeight;
    const viewTop = state.listEl.scrollTop;
    const viewBottom = viewTop + state.listEl.clientHeight;
    let nextTop = null;

    if (itemTop < viewTop + pad) {
      nextTop = Math.max(0, itemTop - pad);
    } else if (itemBottom > viewBottom - pad) {
      nextTop = Math.max(0, itemBottom - state.listEl.clientHeight + pad);
    }

    if (nextTop === null) return;

    state.programmaticListScroll = true;
    state.listEl.scrollTop = nextTop;
    requestAnimationFrame(() => {
      state.programmaticListScroll = false;
      updatePanelMasks();
    });
  }

  function setActive(index, options = {}) {
    state.currentIndex = index;
    if (!state.listEl) return;

    const items = Array.from(
      state.listEl.querySelectorAll("[data-cgpt-nav='item']"),
    );

    items.forEach((item) => {
      item.classList.remove("cgpt-active", "cgpt-active-closed");
    });

    const activeItem = items.find((item) => Number(item.dataset.index) === index);
    if (!activeItem) return;

    const canScrollList = state.listEl.scrollHeight > state.listEl.clientHeight + 1;
    const ensureVisible = options.ensureVisible !== false && canScrollList;

    activeItem.classList.add(state.hovered ? "cgpt-active" : "cgpt-active-closed");

    if (ensureVisible) keepItemVisibleInList(activeItem);
  }

  function scrollToMessage(messageEl) {
    if (!messageEl) return;
    ensureScrollBinding();

    if (state.scrollEl && state.scrollEl !== window) {
      const top = Math.max(0, getMessageTopInScroll(messageEl) - 80);
      state.scrollEl.scrollTo({ top, left: 0, behavior: "smooth" });
      return;
    }

    messageEl.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      window.scrollBy({ top: -80, left: 0, behavior: "auto" });
    }, 120);
  }

  function jumpRelative(delta) {
    if (!state.userMessages.length) return;

    let next = state.currentIndex;
    if (next < 0) next = 0;
    next += delta;
    next = Math.max(0, Math.min(state.userMessages.length - 1, next));

    scrollToMessage(state.userMessages[next]);
    setActive(next, { ensureVisible: true });
  }

  function setOpen(open) {
    const panel = state.panelEl;
    const list = state.listEl;
    if (!panel || !list) return;

    panel.classList.toggle("cgpt-open", open);
    panel.classList.toggle("cgpt-mask-off", !open);

    list.querySelectorAll("[data-cgpt-nav='text']").forEach((label) => {
      label.classList.toggle("cgpt-open", open);
    });

    if (state.currentIndex < 0 && state.userMessages.length) {
      ensureScrollBinding();
      const y = getScrollTop() + Math.round(getViewportHeight() * 0.25);
      const index = findClosestIndexByYLive(y);
      if (index >= 0) state.currentIndex = index;
    }

    updateListLayout();

    if (state.currentIndex >= 0) {
      setActive(state.currentIndex, { ensureVisible: true });
    }

    if (!open) clearHoverTip();
    updatePanelMasks();
  }

  function ensureStyle(shadowRoot) {
    if (shadowRoot.querySelector('style[data-cgpt-nav="1"]')) return;

    const style = document.createElement("style");
    style.setAttribute("data-cgpt-nav", "1");
    style.textContent = `
      :host, * { box-sizing: border-box; }

      :host {
        --cgpt-bg: rgba(255,255,255,.94);
        --cgpt-border: rgba(0,0,0,.06);
        --cgpt-text: rgb(9, 9, 9);
        --cgpt-text-muted: rgba(17, 17, 17, 0.75);
        --cgpt-mark: rgba(0, 0, 0, 0.4);
        --cgpt-accent: rgb(37, 99, 235);
        --cgpt-shadow: 0 10px 26px rgba(0,0,0,.12);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      }

      :host([data-cgpt-theme="dark"]) {
        --cgpt-bg: rgba(21,21,23,.92);
        --cgpt-border: rgba(255,255,255,.10);
        --cgpt-text: rgba(248,250,255,.92);
        --cgpt-text-muted: rgba(248,250,255,.55);
        --cgpt-mark: rgba(255,255,255,.22);
        --cgpt-shadow: 0 10px 26px rgba(0,0,0,.45);
      }

      .cgpt-root {
        user-select: none;
        z-index: 2147483647;
        border-radius: 8px;
        align-items: center;
        width: 34px;
        height: 300px;
        transition: all .2s;
        display: flex;
        position: fixed;
        top: 50%;
        right: 16px;
        transform: translateY(-50%);
        pointer-events: auto;
      }

      .cgpt-hit {
        position: absolute;
        left: -20px;
        top: -44px;
        bottom: -44px;
        width: 20px;
        background: transparent;
      }

      .cgpt-bg {
        width: 34px;
        height: var(--cgpt-bg-height, 180px);
        -webkit-backdrop-filter: blur(5px);
        backdrop-filter: blur(5px);
        z-index: -1;
        background-color: rgba(255,255,255,.80);
        border-radius: 16px;
        max-height: calc(100% - 8px);
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
      }

      :host([data-cgpt-theme="dark"]) .cgpt-bg {
        background-color: rgba(21,21,23,.60);
      }

      .cgpt-panel {
        pointer-events: auto;
        border: 1px solid transparent;
        border-radius: 16px;
        width: 34px;
        height: var(--cgpt-bg-height, 180px);
        max-width: 240px;
        transition: width .2s, height .2s, background .2s, box-shadow .2s, border-color .2s;
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        overflow: hidden;
        background: transparent;
        box-shadow: none;
      }

      .cgpt-panel.cgpt-open {
        background: var(--cgpt-bg);
        box-shadow: var(--cgpt-shadow);
        border: 1px solid var(--cgpt-border);
        height: var(--cgpt-list-max-height, 250px);
        width: 240px;
      }

      .cgpt-panel:before,
      .cgpt-panel:after {
        content: "";
        z-index: 2;
        pointer-events: none;
        opacity: 0;
        background: linear-gradient(#fff 20.19%, rgba(255,255,255,0) 100%);
        width: 100%;
        height: 32px;
        transition: opacity .2s;
        position: absolute;
        left: 0;
      }

      :host([data-cgpt-theme="dark"]) .cgpt-panel:before,
      :host([data-cgpt-theme="dark"]) .cgpt-panel:after {
        background: linear-gradient(180deg, var(--cgpt-bg) 20.19%, rgba(35,35,36,0) 100%);
      }

      .cgpt-panel:before { top: 0; }
      .cgpt-panel:after { bottom: 0; transform: rotate(180deg); }
      .cgpt-panel.cgpt-open:before,
      .cgpt-panel.cgpt-open:after { opacity: 1; transition: none; }
      .cgpt-panel.cgpt-mask-bottom-off:after,
      .cgpt-panel.cgpt-mask-top-off:before,
      .cgpt-panel.cgpt-mask-off:before,
      .cgpt-panel.cgpt-mask-off:after { opacity: 0; }

      .cgpt-list {
        max-height: 250px;
        padding: var(--cgpt-page-padding, 20px 0 20px 24px);
        overscroll-behavior: contain;
        flex-direction: column;
        align-items: flex-end;
        display: flex;
        height: 100%;
        position: relative;
        overflow-y: auto;
        scrollbar-width: none;
      }

      .cgpt-list::-webkit-scrollbar { display: none; }
      .cgpt-panel:not(.cgpt-open) .cgpt-list { overflow-y: hidden; }

      .cgpt-item {
        cursor: pointer;
        height: 20px;
        color: var(--cgpt-text-muted);
        justify-content: flex-end;
        align-items: center;
        width: calc(100% - 6px);
        margin-top: 10px;
        margin-right: 8px;
        line-height: 20px;
        display: flex;
      }

      .cgpt-item.cgpt-first { margin-top: 0; }

      .cgpt-mark-wrap {
        flex-shrink: 0;
        justify-content: center;
        align-items: center;
        width: 16px;
        height: 20px;
        display: flex;
      }

      .cgpt-mark {
        background-color: var(--cgpt-mark);
        border-radius: 4px;
        flex-shrink: 0;
        width: 8px;
        height: 2px;
        transition: background-color .2s, transform .2s;
        transform-origin: 50%;
        transform: scaleX(1);
      }

      .cgpt-panel:not(.cgpt-open) .cgpt-item.cgpt-active-closed .cgpt-mark {
        background-color: var(--cgpt-accent);
        transform: scaleX(1.6);
        opacity: 1;
      }

      .cgpt-text {
        font-size: 13px;
        line-height: 20px;
        font-weight: 400;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0;
        margin-right: 0;
        transition: opacity .1s, color .2s;
        overflow: hidden;
        flex: 1 1 auto;
        min-width: 0;
        text-align: left;
      }

      .cgpt-text.cgpt-open { opacity: 1; }
      .cgpt-panel.cgpt-open .cgpt-item { justify-content: flex-start; }
      .cgpt-panel.cgpt-open .cgpt-mark-wrap { margin-left: auto; }
      .cgpt-panel.cgpt-open .cgpt-text { margin-right: 12px; }

      .cgpt-panel.cgpt-open .cgpt-item:hover,
      .cgpt-panel.cgpt-open .cgpt-item:hover .cgpt-text {
        color: var(--cgpt-text);
      }

      .cgpt-panel.cgpt-open .cgpt-item:hover .cgpt-mark {
        background-color: var(--cgpt-text);
      }

      .cgpt-panel.cgpt-open .cgpt-item.cgpt-active .cgpt-text {
        color: var(--cgpt-accent);
        font-weight: 500;
      }

      .cgpt-panel.cgpt-open .cgpt-item.cgpt-active .cgpt-mark {
        background-color: var(--cgpt-accent);
        transform: scaleX(1.5);
      }

      .cgpt-tip {
        position: fixed;
        z-index: 2147483647;
        max-width: 520px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(0,0,0,0.86);
        color: rgba(255,255,255,0.96);
        font-size: 13px;
        line-height: 17px;
        box-shadow: 0 12px 28px rgba(0,0,0,0.25);
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity 140ms ease, transform 140ms ease;
      }

      .cgpt-tip.is-on {
        opacity: 1;
        transform: translateY(0);
      }

      @media not all and (min-width: 768px) {
        .cgpt-root { display: none; }
      }
    `;

    shadowRoot.appendChild(style);
  }

  function ensureUI() {
    const host = ensureHost();

    let mount = host.querySelector(`#${SHADOW_MOUNT_ID}`);
    if (!mount) {
      mount = document.createElement("div");
      mount.id = SHADOW_MOUNT_ID;
      mount.style.pointerEvents = "auto";
      host.appendChild(mount);
    }

    let shadowRoot = mount.shadowRoot;
    if (!shadowRoot) shadowRoot = mount.attachShadow({ mode: "open" });

    ensureStyle(shadowRoot);
    updateThemeFlag(shadowRoot);

    let root = shadowRoot.querySelector('[data-cgpt-nav="root"]');
    if (!root) {
      root = document.createElement("div");
      root.className = "cgpt-root";
      root.setAttribute("data-cgpt-nav", "root");
      root.style.setProperty("--cgpt-page-padding", "20px 0 20px 24px");
      root.style.setProperty("--cgpt-bg-height", "180px");

      const hit = document.createElement("div");
      hit.className = "cgpt-hit";
      root.appendChild(hit);

      const background = document.createElement("div");
      background.className = "cgpt-bg";
      root.appendChild(background);

      const panel = document.createElement("div");
      panel.className = "cgpt-panel cgpt-mask-off";
      panel.setAttribute("data-cgpt-nav", "panel");

      const list = document.createElement("div");
      list.className = "cgpt-list";
      list.setAttribute("data-cgpt-nav", "list");
      list.addEventListener(
        "scroll",
        () => {
          if (!state.programmaticListScroll) {
            state.listUserScrollAt = Date.now();
          }
          updatePanelMasks();
        },
        PASSIVE,
      );

      panel.appendChild(list);
      root.appendChild(panel);

      const tip = document.createElement("div");
      tip.className = "cgpt-tip";
      tip.setAttribute("data-cgpt-nav", "tip");
      shadowRoot.appendChild(tip);

      root.addEventListener("mouseenter", () => {
        state.hovered = true;
        setOpen(true);
      });

      root.addEventListener("mouseleave", () => {
        state.hovered = false;
        setOpen(false);
      });

      root.addEventListener(
        "wheel",
        (event) => {
          if (!state.userMessages.length) return;

          const canScrollList =
            state.hovered &&
            state.listEl &&
            state.listEl.scrollHeight > state.listEl.clientHeight + 1;

          if (canScrollList) return;

          event.preventDefault();
          jumpRelative(event.deltaY > 0 ? 1 : -1);
        },
        { passive: false },
      );

      shadowRoot.appendChild(root);

      state.rootEl = root;
      state.panelEl = panel;
      state.listEl = list;
      state.tipEl = tip;
    } else {
      state.rootEl = root;
      state.panelEl = shadowRoot.querySelector('[data-cgpt-nav="panel"]');
      state.listEl = shadowRoot.querySelector('[data-cgpt-nav="list"]');
      state.tipEl = shadowRoot.querySelector('[data-cgpt-nav="tip"]');
    }

    updateRightOffset();
    updateListMaxHeight();
    setOpen(Boolean(state.hovered));
    updateListLayout();

    return shadowRoot;
  }

  function rebuildList() {
    const shadowRoot = ensureUI();
    const root = shadowRoot.querySelector('[data-cgpt-nav="root"]');
    const list = shadowRoot.querySelector('[data-cgpt-nav="list"]');
    if (!list) return;

    const messages = findUserMessages();
    state.userMessages = messages;
    ensureScrollBinding();

    if (root) root.style.display = messages.length ? "" : "none";
    list.innerHTML = "";

    if (!messages.length) {
      state.currentIndex = -1;
      clearHoverTip();
      updatePanelMasks();
      return;
    }

    const fragment = document.createDocumentFragment();

    messages.forEach((messageEl, index) => {
      const fullText = extractUserText(messageEl);
      const title = titleFromText(fullText);

      const item = document.createElement("div");
      item.className = "cgpt-item";
      item.setAttribute("data-cgpt-nav", "item");
      if (index === 0) item.classList.add("cgpt-first");
      item.dataset.index = String(index);

      const label = document.createElement("div");
      label.className = "cgpt-text";
      label.setAttribute("data-cgpt-nav", "text");
      label.textContent = title;

      const markWrap = document.createElement("div");
      markWrap.className = "cgpt-mark-wrap";

      const mark = document.createElement("div");
      mark.className = "cgpt-mark";

      markWrap.appendChild(mark);
      item.appendChild(label);
      item.appendChild(markWrap);

      item.addEventListener("click", () => {
        scrollToMessage(messageEl);
        setActive(index, { ensureVisible: true });
      });

      item.addEventListener("mouseenter", () => {
        if (!state.hovered) return;
        const needsTip =
          fullText &&
          (fullText.length > title.length || label.scrollWidth > label.clientWidth + 1);
        if (needsTip) scheduleHoverTip(item, fullText);
      });

      item.addEventListener("mouseleave", clearHoverTip);
      fragment.appendChild(item);
    });

    list.appendChild(fragment);

    updateThemeFlag(shadowRoot);
    updateRightOffset();
    updateListMaxHeight();
    setOpen(Boolean(state.hovered));
    updateListLayout();
    updateActiveByScroll(true);
    updatePanelMasks();

    if (state.currentIndex < 0) {
      const y = getScrollTop() + Math.round(getViewportHeight() * 0.25);
      const index = findClosestIndexByYLive(y);
      if (index >= 0) setActive(index, { ensureVisible: true });
    }
  }

  function scheduleRebuild() {
    if (state.scheduledRebuild) return;
    state.scheduledRebuild = true;

    state.rebuildTimer = window.setTimeout(() => {
      state.scheduledRebuild = false;
      state.rebuildTimer = 0;
      rebuildList();
    }, 160);
  }

  function updateActiveByScroll(force = false) {
    if (!state.userMessages.length) return;

    ensureScrollBinding();

    const y = getScrollTop() + Math.round(getViewportHeight() * 0.25);
    const index = findClosestIndexByYLive(y);
    if (index < 0) return;
    if (!force && index === state.currentIndex) return;

    const canScrollList = Boolean(
      state.listEl && state.listEl.scrollHeight > state.listEl.clientHeight + 1,
    );
    const userIsScrollingOpenList =
      state.hovered &&
      canScrollList &&
      Date.now() - state.listUserScrollAt <= 350;

    setActive(index, { ensureVisible: !userIsScrollingOpenList });
  }

  function scheduleActiveFromScroll() {
    if (state.scheduledActive) return;
    state.scheduledActive = true;

    requestAnimationFrame(() => {
      state.scheduledActive = false;
      updateActiveByScroll(false);
    });
  }

  function handlePossibleRouteChange() {
    if (location.href === state.lastHref) return;
    state.lastHref = location.href;
    scheduleRebuild();
  }

  function startObservers() {
    if (!state.observer) {
      state.observer = new MutationObserver(() => {
        handlePossibleRouteChange();
        scheduleRebuild();
      });

      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    if (!state.themeObserver) {
      state.themeObserver = new MutationObserver(() => {
        const shadowRoot = state.rootEl?.getRootNode?.();
        if (shadowRoot) updateThemeFlag(shadowRoot);
      });

      state.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme", "data-ds-dark-theme"],
      });

      if (document.body) {
        state.themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ["class", "data-theme", "data-ds-dark-theme"],
        });
      }
    }
  }

  function boot() {
    ensureUI();
    rebuildList();
    startObservers();

    window.addEventListener(
      "resize",
      () => {
        updateRightOffset();
        updateListMaxHeight();
        scheduleRebuild();
      },
      PASSIVE,
    );

    window.addEventListener("pageshow", scheduleRebuild, PASSIVE);
    window.addEventListener("popstate", scheduleRebuild, PASSIVE);
    window.addEventListener("hashchange", scheduleRebuild, PASSIVE);
    window.addEventListener("load", scheduleRebuild, { once: true });

    window.addEventListener(
      "message",
      (event) => {
        if (event.origin !== location.origin) return;
        if (event.data?.type === "cgpt-nav-rebuild") {
          scheduleRebuild();
        }
      },
      PASSIVE,
    );
  }

  globalThis[BOOT_KEY] = {
    scheduleRebuild,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
