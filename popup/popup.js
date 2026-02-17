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

  function buildMatcher(pattern, isRegex) {
    if (isRegex) {
      try {
        const re = new RegExp(pattern);
        return (url) => re.test(url) || re.test(stripProtocol(url));
      } catch (e) {
        console.warn(`TabUnhoarder: invalid regex "${pattern}" — ${e.message}`);
        return null;
      }
    }
    if (hasProtocol(pattern)) {
      return (url) => url.startsWith(pattern);
    }
    return (url) => stripProtocol(url).startsWith(pattern);
  }

  function shouldIncludeTab(url, keepPatterns, keepMatchers, removeMatchers) {
    // Keep always wins — check exact match first, then regex/prefix
    const urlBare = stripProtocol(url);
    if (keepPatterns.some((p) => url === p || urlBare === p)) {
      return false;
    }
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
  }

  const debouncedSave = debounce(saveSettings, 300);

  // --- View Switching ---

  function showConfigView() {
    confirmView.classList.add("hidden");
    configView.classList.remove("hidden");
    tabListEl.innerHTML = "";
    confirmStatusEl.hidden = true;
  }

  function showConfirmView(tabs) {
    configView.classList.add("hidden");
    confirmView.classList.remove("hidden");

    const count = tabs.length;
    const noun = count === 1 ? "tab" : "tabs";
    confirmTitleEl.textContent = `Tabs to close (${count})`;
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

      let iconEl;
      if (tab.favIconUrl) {
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
    const noun = count === 1 ? "tab" : "tabs";
    closeSelectedBtnEl.textContent = `Close Selected (${count})`;
  }

  // --- Status ---

  function showStatus(el, message) {
    el.textContent = message;
    el.hidden = false;
    setTimeout(() => {
      el.hidden = true;
    }, 4000);
  }

  // --- Find Button Label ---

  const FIND_LABEL = "Find Tabs";

  async function updateFindButtonLabel() {
    if (reviewBeforeCloseEl.checked) {
      findTabsBtnEl.textContent = FIND_LABEL;
      return;
    }

    const removePatterns = parsePatterns(removeUrlsEl.value);
    if (removePatterns.length === 0) {
      findTabsBtnEl.textContent = "Close Tabs";
      return;
    }

    const keepPatterns = parsePatterns(keepUrlsEl.value);
    const keepMatchers = keepPatterns
      .map((p) => buildMatcher(p, regexKeepEl.checked))
      .filter(Boolean);
    const removeMatchers = removePatterns
      .map((p) => buildMatcher(p, regexRemoveEl.checked))
      .filter(Boolean);

    if (removeMatchers.length === 0) {
      findTabsBtnEl.textContent = "Close Tabs";
      return;
    }

    const queryOptions = onlyThisWindowEl.checked
      ? { currentWindow: true }
      : {};
    const tabs = await browser.tabs.query(queryOptions);
    const count = tabs.filter(
      (tab) => tab.url && !tab.pinned && shouldIncludeTab(tab.url, keepPatterns, keepMatchers, removeMatchers)
    ).length;

    const noun = count === 1 ? "tab" : "tabs";
    findTabsBtnEl.textContent = count > 0 ? `Close ${count} ${noun}` : "Close Tabs";
  }

  const debouncedUpdateLabel = debounce(updateFindButtonLabel, 300);

  // --- Find Tabs ---

  async function findTabs() {
    const removePatterns = parsePatterns(removeUrlsEl.value);

    if (removePatterns.length === 0) {
      showStatus(configStatusEl, "No removal patterns specified.");
      return;
    }

    const keepPatterns = parsePatterns(keepUrlsEl.value);

    // Build matchers with independent regex settings
    const keepMatchers = keepPatterns
      .map((p) => buildMatcher(p, regexKeepEl.checked))
      .filter(Boolean);
    const removeMatchers = removePatterns
      .map((p) => buildMatcher(p, regexRemoveEl.checked))
      .filter(Boolean);

    if (removeMatchers.length === 0) {
      showStatus(configStatusEl, "All removal patterns are invalid.");
      return;
    }

    const queryOptions = onlyThisWindowEl.checked
      ? { currentWindow: true }
      : {};
    const tabs = await browser.tabs.query(queryOptions);

    const matchingTabs = tabs.filter(
      (tab) => tab.url && !tab.pinned && shouldIncludeTab(tab.url, keepPatterns, keepMatchers, removeMatchers)
    );

    if (matchingTabs.length === 0) {
      showStatus(configStatusEl, "No matching tabs found.");
      return;
    }

    if (reviewBeforeCloseEl.checked) {
      showConfirmView(matchingTabs);
    } else {
      const tabIds = matchingTabs.map((tab) => tab.id);
      await browser.tabs.remove(tabIds);
      const noun = tabIds.length === 1 ? "tab" : "tabs";
      showStatus(configStatusEl, `Closed ${tabIds.length} ${noun}.`);
    }
  }

  // --- Close Selected ---

  async function closeSelected() {
    const tabIds = getCheckedTabIds();

    if (tabIds.length === 0) {
      showStatus(confirmStatusEl, "No tabs selected.");
      return;
    }

    closeSelectedBtnEl.disabled = true;
    closeSelectedBtnEl.textContent = "Closing...";

    try {
      await browser.tabs.remove(tabIds);
      const noun = tabIds.length === 1 ? "tab" : "tabs";
      showStatus(confirmStatusEl, `Closed ${tabIds.length} ${noun}.`);
      setTimeout(showConfigView, 1500);
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
  await updateFindButtonLabel();

  keepUrlsEl.addEventListener("input", () => { debouncedSave(); debouncedUpdateLabel(); });
  removeUrlsEl.addEventListener("input", () => { debouncedSave(); debouncedUpdateLabel(); });
  regexKeepEl.addEventListener("change", () => { saveSettings(); updateFindButtonLabel(); });
  regexRemoveEl.addEventListener("change", () => { saveSettings(); updateFindButtonLabel(); });
  onlyThisWindowEl.addEventListener("change", () => { saveSettings(); updateFindButtonLabel(); });
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
      await updateFindButtonLabel();
    }
  });

  closeSelectedBtnEl.addEventListener("click", closeSelected);
  backBtnEl.addEventListener("click", showConfigView);
  toggleSelectAllEl.addEventListener("click", toggleSelectAll);
});
