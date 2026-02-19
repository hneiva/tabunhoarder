"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  // DOM references — Config view
  const configView = document.getElementById("configView");
  const keepUrlsEl = document.getElementById("keepUrls");
  const removeUrlsEl = document.getElementById("removeUrls");
  const regexKeepEl = document.getElementById("regexKeep");
  const regexRemoveEl = document.getElementById("regexRemove");
  const onlyThisWindowEl = document.getElementById("onlyThisWindow");
  const reviewBeforeCloseEl = document.getElementById("reviewBeforeClose");
  const findTabsBtnEl = document.getElementById("findTabsBtn");
  const configStatusEl = document.getElementById("configStatus");

  // DOM references — Confirm view
  const confirmView = document.getElementById("confirmView");
  const confirmTitleEl = document.getElementById("confirmTitle");
  const toggleSelectAllEl = document.getElementById("toggleSelectAll");
  const tabListEl = document.getElementById("tabList");
  const closeSelectedBtnEl = document.getElementById("closeSelectedBtn");
  const backBtnEl = document.getElementById("backBtn");
  const confirmStatusEl = document.getElementById("confirmStatus");

  const STORAGE_KEY = "tabunhoarder_settings";

  // --- Utilities ---

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function parsePatterns(text) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function stripProtocol(url) {
    return url.replace(/^https?:\/\//, "");
  }

  function hasProtocol(pattern) {
    return /^https?:\/\//.test(pattern);
  }

  const MAX_REGEX_LENGTH = 200;

  function hasNestedQuantifiers(pattern) {
    // Detect patterns that cause catastrophic backtracking:
    // (a+)+, (a*)+, (a?)+, (\w+)*, (\d*)+ etc.
    // Walks the string tracking whether each group contains a quantifier,
    // then checks if the group itself is quantified.
    const groupStack = [];
    let hasQuantifierInGroup = false;
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\") {
        // Escaped char — skip it but don't skip quantifier detection.
        // \d, \w, \s etc. are matchable atoms, not literal chars to ignore.
        i++;
        continue;
      }
      if (ch === "[") {
        // Skip character classes entirely — content inside [] is not quantifiable
        while (i < pattern.length && pattern[i] !== "]") {
          if (pattern[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (ch === "(") {
        groupStack.push(hasQuantifierInGroup);
        hasQuantifierInGroup = false;
      } else if (ch === ")") {
        const groupHadQuantifier = hasQuantifierInGroup;
        hasQuantifierInGroup = groupStack.pop() || false;
        const next = pattern[i + 1];
        if (groupHadQuantifier && (next === "+" || next === "*" || next === "?" || next === "{")) {
          return true;
        }
      } else if (ch === "+" || ch === "*" || ch === "?") {
        hasQuantifierInGroup = true;
      } else if (ch === "{" && /^\{\d+,\d*\}/.test(pattern.slice(i))) {
        hasQuantifierInGroup = true;
      }
    }
    return false;
  }

  function buildMatcher(pattern, isRegex) {
    if (isRegex) {
      if (pattern.length > MAX_REGEX_LENGTH) {
        return { error: `Pattern too long (${pattern.length} chars, max ${MAX_REGEX_LENGTH})` };
      }
      if (hasNestedQuantifiers(pattern)) {
        return { error: "Pattern rejected — nested quantifiers can cause hangs" };
      }
      try {
        const re = new RegExp(pattern);
        return (url) => re.test(url) || re.test(stripProtocol(url));
      } catch (e) {
        return { error: `Invalid regex — ${e.message}` };
      }
    }
    if (hasProtocol(pattern)) {
      return (url) => url.startsWith(pattern);
    }
    return (url) => stripProtocol(url).startsWith(pattern);
  }

  function buildMatchers(patterns, isRegex) {
    const matchers = [];
    const errors = [];
    for (const p of patterns) {
      const result = buildMatcher(p, isRegex);
      if (typeof result === "function") {
        matchers.push(result);
      } else if (result && result.error) {
        errors.push(`"${p}": ${result.error}`);
      }
    }
    return { matchers, errors };
  }

  function shouldIncludeTab(url, keepMatchers, removeMatchers) {
    // Keep always wins
    if (keepMatchers.some((matcher) => matcher(url))) {
      return false;
    }
    return removeMatchers.some((matcher) => matcher(url));
  }

  // --- Persistence ---

  async function restoreSettings() {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const settings = result[STORAGE_KEY];
    if (!settings) return;

    keepUrlsEl.value = settings.keepUrls || "";
    removeUrlsEl.value = settings.removeUrls || "";
    regexKeepEl.checked = settings.regexKeep || false;
    regexRemoveEl.checked = settings.regexRemove || false;
    onlyThisWindowEl.checked = settings.onlyThisWindow || false;
    reviewBeforeCloseEl.checked = settings.reviewBeforeClose !== false;
  }

  async function saveSettings() {
    try {
      await browser.storage.local.set({
        [STORAGE_KEY]: {
          keepUrls: keepUrlsEl.value,
          removeUrls: removeUrlsEl.value,
          regexKeep: regexKeepEl.checked,
          regexRemove: regexRemoveEl.checked,
          onlyThisWindow: onlyThisWindowEl.checked,
          reviewBeforeClose: reviewBeforeCloseEl.checked,
        },
      });
    } catch (err) {
      console.error("TabUnhoarder: failed to save settings:", err);
    }
  }

  const debouncedSave = debounce(saveSettings, 300);

  // --- View Switching ---

  let returnToConfigTimer = null;

  function showConfigView() {
    if (returnToConfigTimer) {
      clearTimeout(returnToConfigTimer);
      returnToConfigTimer = null;
    }
    confirmView.classList.add("hidden");
    configView.classList.remove("hidden");
    tabListEl.innerHTML = "";
    confirmStatusEl.hidden = true;
  }

  function showConfirmView(tabs) {
    configView.classList.add("hidden");
    confirmView.classList.remove("hidden");

    confirmTitleEl.textContent = `Tabs to close (${tabs.length})`;
    toggleSelectAllEl.textContent = "Deselect All";

    renderTabList(tabs);
  }

  // --- Tab List Rendering ---

  function renderTabList(tabs) {
    tabListEl.innerHTML = "";

    for (const tab of tabs) {
      const item = document.createElement("label");
      item.className = "tab-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.tabId = tab.id;
      checkbox.addEventListener("change", updateCloseButtonLabel);

      const safeFavIcon = tab.favIconUrl && /^(https?:|data:|moz-extension:)/.test(tab.favIconUrl);
      let iconEl;
      if (safeFavIcon) {
        iconEl = document.createElement("img");
        iconEl.className = "tab-favicon";
        iconEl.src = tab.favIconUrl;
        iconEl.alt = "";
        iconEl.addEventListener("error", () => {
          const fallback = document.createElement("div");
          fallback.className = "tab-favicon-fallback";
          iconEl.replaceWith(fallback);
        });
      } else {
        iconEl = document.createElement("div");
        iconEl.className = "tab-favicon-fallback";
      }

      const info = document.createElement("div");
      info.className = "tab-info";

      const title = document.createElement("div");
      title.className = "tab-title";
      title.textContent = tab.title || "(Untitled)";

      const url = document.createElement("div");
      url.className = "tab-url";
      url.textContent = tab.url || "";

      info.appendChild(title);
      info.appendChild(url);

      item.appendChild(checkbox);
      item.appendChild(iconEl);
      item.appendChild(info);

      tabListEl.appendChild(item);
    }
  }

  function getCheckedTabIds() {
    const checkboxes = tabListEl.querySelectorAll('input[type="checkbox"]');
    const ids = [];
    for (const cb of checkboxes) {
      if (cb.checked) {
        ids.push(Number(cb.dataset.tabId));
      }
    }
    return ids;
  }

  function updateCloseButtonLabel() {
    const count = getCheckedTabIds().length;
    closeSelectedBtnEl.textContent = `Close Selected (${count})`;
  }

  // --- Status ---

  const statusTimers = new WeakMap();

  function showStatus(el, message) {
    const prev = statusTimers.get(el);
    if (prev) clearTimeout(prev);

    el.textContent = message;
    el.hidden = false;
    statusTimers.set(el, setTimeout(() => {
      el.hidden = true;
      statusTimers.delete(el);
    }, 4000));
  }

  // --- Find Button Label ---

  function updateFindButtonLabel() {
    findTabsBtnEl.textContent = reviewBeforeCloseEl.checked ? "Find Tabs" : "Close Tabs";
  }

  // --- Window safety ---

  function safeTabIds(tabIds, allTabs) {
    // Ensure at least one tab remains open per window to prevent window closure
    const tabsById = new Map(allTabs.map((t) => [t.id, t]));
    const closingSet = new Set(tabIds.filter((id) => tabsById.has(id)));

    // Count remaining tabs per window after proposed closure
    const windowTabCounts = new Map();
    for (const tab of allTabs) {
      const wid = tab.windowId;
      if (!windowTabCounts.has(wid)) windowTabCounts.set(wid, 0);
      if (!closingSet.has(tab.id)) {
        windowTabCounts.set(wid, windowTabCounts.get(wid) + 1);
      }
    }

    // Find which windows would become empty
    const emptyWindows = new Set();
    for (const [wid, remaining] of windowTabCounts) {
      if (remaining === 0) emptyWindows.add(wid);
    }

    // For each empty window, spare one tab
    const sparedWindows = new Set();
    const safe = [];
    for (const id of closingSet) {
      const wid = tabsById.get(id)?.windowId;
      if (emptyWindows.has(wid) && !sparedWindows.has(wid)) {
        sparedWindows.add(wid);
        continue;
      }
      safe.push(id);
    }
    return safe;
  }

  // --- Find Tabs ---

  async function findTabs() {
    const removePatterns = parsePatterns(removeUrlsEl.value);

    if (removePatterns.length === 0) {
      showStatus(configStatusEl, "No removal patterns specified.");
      return;
    }

    const keepPatterns = parsePatterns(keepUrlsEl.value);

    const keep = buildMatchers(keepPatterns, regexKeepEl.checked);
    const remove = buildMatchers(removePatterns, regexRemoveEl.checked);
    const allErrors = [...keep.errors, ...remove.errors];

    if (keep.errors.length > 0 && keepPatterns.length > 0) {
      if (keep.matchers.length === 0) {
        showStatus(configStatusEl, `Warning: all keep patterns invalid — ${keep.errors.join("; ")}`);
        return;
      }
      // Some keep patterns failed — warn but continue with valid ones
      console.warn("TabUnhoarder: some keep patterns invalid:", keep.errors);
    }

    if (remove.matchers.length === 0) {
      showStatus(configStatusEl, allErrors.length > 0
        ? `Invalid patterns: ${allErrors.join("; ")}`
        : "All removal patterns are invalid.");
      return;
    }

    const queryOptions = onlyThisWindowEl.checked
      ? { currentWindow: true }
      : {};
    const tabs = await browser.tabs.query(queryOptions);

    const matchingTabs = tabs.filter(
      (tab) => tab.url && !tab.pinned && !tab.active && shouldIncludeTab(tab.url, keep.matchers, remove.matchers)
    );

    if (matchingTabs.length === 0) {
      showStatus(configStatusEl, "No matching tabs found.");
      return;
    }

    if (reviewBeforeCloseEl.checked) {
      showConfirmView(matchingTabs);
    } else {
      const candidateIds = matchingTabs.map((tab) => tab.id);
      const result = await closeTabs(candidateIds);
      showStatus(configStatusEl, result);
    }
  }

  // --- Close Tabs (shared) ---

  async function closeTabs(candidateIds) {
    const allTabs = await browser.tabs.query({});
    const tabIds = safeTabIds(candidateIds, allTabs);
    if (tabIds.length === 0) {
      return "Cannot close — it would leave a window empty.";
    }

    const results = await Promise.allSettled(tabIds.map((id) => browser.tabs.remove(id)));
    const closed = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - closed;

    const skipped = candidateIds.length - tabIds.length;
    let msg = `Closed ${closed} tab${closed !== 1 ? "s" : ""}.`;
    if (failed > 0) msg += ` ${failed} already gone.`;
    if (skipped > 0) msg += ` Kept ${skipped} to avoid empty window${skipped !== 1 ? "s" : ""}.`;
    return msg;
  }

  // --- Close Selected ---

  async function closeSelected() {
    const candidateIds = getCheckedTabIds();

    if (candidateIds.length === 0) {
      showStatus(confirmStatusEl, "No tabs selected.");
      return;
    }

    closeSelectedBtnEl.disabled = true;
    closeSelectedBtnEl.textContent = "Closing...";

    try {
      const result = await closeTabs(candidateIds);
      showStatus(confirmStatusEl, result);
      returnToConfigTimer = setTimeout(showConfigView, 1500);
    } catch (err) {
      showStatus(confirmStatusEl, `Error: ${err.message}`);
      console.error("TabUnhoarder close error:", err);
    } finally {
      closeSelectedBtnEl.disabled = false;
      updateCloseButtonLabel();
    }
  }

  // --- Toggle Select All ---

  function toggleSelectAll(e) {
    e.preventDefault();
    const checkboxes = tabListEl.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
    const newState = !allChecked;

    for (const cb of checkboxes) {
      cb.checked = newState;
    }

    toggleSelectAllEl.textContent = newState ? "Deselect All" : "Select All";
    updateCloseButtonLabel();
  }

  // --- Event Wiring ---

  await restoreSettings();
  updateFindButtonLabel();

  keepUrlsEl.addEventListener("input", debouncedSave);
  removeUrlsEl.addEventListener("input", debouncedSave);
  regexKeepEl.addEventListener("change", saveSettings);
  regexRemoveEl.addEventListener("change", saveSettings);
  onlyThisWindowEl.addEventListener("change", saveSettings);
  reviewBeforeCloseEl.addEventListener("change", () => { saveSettings(); updateFindButtonLabel(); });

  findTabsBtnEl.addEventListener("click", async () => {
    findTabsBtnEl.disabled = true;
    findTabsBtnEl.textContent = reviewBeforeCloseEl.checked ? "Searching..." : "Closing...";
    try {
      await findTabs();
    } catch (err) {
      showStatus(configStatusEl, `Error: ${err.message}`);
      console.error("TabUnhoarder find error:", err);
    } finally {
      findTabsBtnEl.disabled = false;
      updateFindButtonLabel();
    }
  });

  closeSelectedBtnEl.addEventListener("click", closeSelected);
  backBtnEl.addEventListener("click", showConfigView);
  toggleSelectAllEl.addEventListener("click", toggleSelectAll);
});
