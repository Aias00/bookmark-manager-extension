const DEFAULT_SETTINGS = {
  concurrency: 5,
  timeoutMs: 8000
};

const state = {
  invalidBookmarks: [],
  filteredBookmarks: [],
  domainPreview: [],
  duplicates: [],
  progressTotal: 0,
  progressDone: 0,
  startTime: null,
  folderTree: [],
  selectedFolderIds: new Set(),
  expandedFolderIds: new Set(),
  pendingRetryIds: new Set(),
  retryTotal: 0,
  isScanning: false,
  searchQuery: "",
  errorFilter: "all",
  loadedChildrenIds: new Set(),
  loadingFolderId: null
};

const elements = {
  scanBtn: document.getElementById("scanBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  previewBtn: document.getElementById("previewBtn"),
  organizeBtn: document.getElementById("organizeBtn"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  progressPercent: document.getElementById("progressPercent"),
  timerText: document.getElementById("timerText"),
  cancelBtn: document.getElementById("cancelBtn"),
  statusBadge: document.getElementById("statusBadge"),
  invalidList: document.getElementById("invalidList"),
  invalidSummary: document.getElementById("invalidSummary"),
  selectAllInvalid: document.getElementById("selectAllInvalid"),
  retrySelectedBtn: document.getElementById("retrySelectedBtn"),
  domainList: document.getElementById("domainList"),
  domainSummary: document.getElementById("domainSummary"),
  concurrencyInput: document.getElementById("concurrencyInput"),
  timeoutInput: document.getElementById("timeoutInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  folderTree: document.getElementById("folderTree"),
  folderSummary: document.getElementById("folderSummary"),
  reloadFoldersBtn: document.getElementById("reloadFoldersBtn"),
  searchInput: document.getElementById("searchInput"),
  errorFilter: document.getElementById("errorFilter"),
  duplicateSummary: document.getElementById("duplicateSummary"),
  scanDuplicatesBtn: document.getElementById("scanDuplicatesBtn"),
  duplicateList: document.getElementById("duplicateList")
};

let port = null;

const getPort = () => {
  if (port) return port;
  port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    setStatus("Disconnected");
  });
  return port;
};

const setStatus = (text) => {
  elements.statusBadge.textContent = text;
};

const setProgress = (done, total) => {
  state.progressDone = done;
  state.progressTotal = total;
  elements.progressText.textContent = `${done} / ${total}`;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  elements.progressBar.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
};

const setTimer = () => {
  if (!state.startTime) {
    elements.timerText.textContent = "Ready";
    return;
  }
  const seconds = Math.round((Date.now() - state.startTime) / 1000);
  elements.timerText.textContent = `Elapsed ${seconds}s`;
};

const handlePortMessage = (message) => {
  if (message.type === "progress") {
    setProgress(message.completed, message.total);
    setTimer();
    return;
  }

  if (message.type === "scanResult") {
    state.isScanning = false;
    state.invalidBookmarks = message.invalid || [];
    renderInvalidList();
    setStatus(`Scan complete (${message.invalid.length} invalid)`);
    setProgress(message.total || 0, message.total || 0);
    setTimer();
    elements.deleteBtn.disabled = state.invalidBookmarks.length === 0;
    enableActionsAfterIdle();
    return;
  }

  if (message.type === "previewResult") {
    state.domainPreview = message.domains || [];
    renderDomainPreview();
    setStatus(`Preview ready (${state.domainPreview.length} domains)`);
    elements.organizeBtn.disabled = state.domainPreview.length === 0;
    enableActionsAfterIdle();
    return;
  }

  if (message.type === "organizeResult") {
    setStatus(`Organized ${message.moved} bookmarks`);
    setProgress(message.moved, message.moved);
    setTimer();
    enableActionsAfterIdle();
    return;
  }

  if (message.type === "deleteResult") {
    setStatus(`Deleted ${message.deleted} bookmarks`);
    elements.deleteBtn.disabled = true;
    elements.selectAllInvalid.checked = false;
    state.invalidBookmarks = state.invalidBookmarks.filter((item) => !message.deletedIds.includes(item.id));
    renderInvalidList();
    enableActionsAfterIdle();
    return;
  }

  if (message.type === "error") {
    setStatus(`Error: ${message.message}`);
    enableActionsAfterIdle();
  }

  if (message.type === "retryResult") {
    handleRetryResult(message);
  }
};

const filterBookmarks = () => {
  const query = state.searchQuery.toLowerCase();
  const errorType = state.errorFilter;

  state.filteredBookmarks = state.invalidBookmarks.filter((bookmark) => {
    const matchesSearch =
      !query ||
      (bookmark.title && bookmark.title.toLowerCase().includes(query)) ||
      (bookmark.url && bookmark.url.toLowerCase().includes(query));

    const matchesErrorType = errorType === "all" || bookmark.errorType === errorType;

    return matchesSearch && matchesErrorType;
  });
};

const renderInvalidList = () => {
  filterBookmarks();
  elements.invalidList.innerHTML = "";
  if (state.invalidBookmarks.length === 0) {
    elements.invalidSummary.textContent = "No invalid bookmarks.";
    elements.selectAllInvalid.checked = false;
    elements.retrySelectedBtn.disabled = true;
    return;
  }

  const total = state.invalidBookmarks.length;
  const filtered = state.filteredBookmarks.length;
  elements.invalidSummary.textContent =
    filtered === total
      ? `${total} invalid bookmarks found.`
      : `${filtered} of ${total} bookmarks shown.`;
  elements.selectAllInvalid.checked = true;
  elements.retrySelectedBtn.disabled = filtered === 0;

  state.filteredBookmarks.forEach((bookmark) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "checkbox";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.id = bookmark.id;

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = bookmark.title || "(Untitled)";

    const url = document.createElement("span");
    url.className = "url";
    url.textContent = bookmark.url;

    const errorMeta = document.createElement("div");
    errorMeta.className = "error-meta";

    const errorBadge = document.createElement("span");
    errorBadge.className = `error-badge ${getErrorClass(bookmark.errorType)}`;
    errorBadge.textContent = formatErrorLabel(bookmark);
    errorBadge.title = formatErrorDetails(bookmark);

    const retryBtn = document.createElement("button");
    retryBtn.className = "retry-btn";
    retryBtn.textContent = "Retry";
    retryBtn.dataset.id = bookmark.id;

    errorMeta.appendChild(errorBadge);
    errorMeta.appendChild(retryBtn);

    label.appendChild(checkbox);
    label.appendChild(title);

    li.appendChild(label);
    li.appendChild(url);
    li.appendChild(errorMeta);
    elements.invalidList.appendChild(li);
  });
};

const renderDomainPreview = () => {
  elements.domainList.innerHTML = "";
  if (state.domainPreview.length === 0) {
    elements.domainSummary.textContent = "No preview yet.";
    return;
  }
  elements.domainSummary.textContent = `${state.domainPreview.length} domains detected.`;

  state.domainPreview.forEach((item) => {
    const li = document.createElement("li");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = `${item.domain}`;

    const count = document.createElement("span");
    count.className = "url";
    count.textContent = `${item.count} bookmarks`;

    li.appendChild(title);
    li.appendChild(count);
    elements.domainList.appendChild(li);
  });
};

const getErrorClass = (type) => {
  switch (type) {
    case "http":
      return "error-http";
    case "timeout":
      return "error-timeout";
    case "cors":
      return "error-cors";
    case "network":
      return "error-network";
    default:
      return "error-unknown";
  }
};

const formatErrorLabel = (bookmark) => {
  if (bookmark.status && Number.isFinite(Number(bookmark.status))) {
    return `HTTP ${bookmark.status}`;
  }
  return bookmark.errorType ? bookmark.errorType.toUpperCase() : "ERROR";
};

const formatErrorDetails = (bookmark) => {
  const parts = [];
  if (bookmark.errorType) parts.push(`Type: ${bookmark.errorType}`);
  if (bookmark.status) parts.push(`Status: ${bookmark.status}`);
  if (bookmark.errorMessage) parts.push(`Message: ${bookmark.errorMessage}`);
  if (bookmark.attempts) parts.push(`Retries: ${Math.max(0, bookmark.attempts - 1)}`);
  return parts.join("\n");
};

const buildFolderNodes = (nodes = [], lazy = true) =>
  nodes
    .filter((node) => !node.url)
    .map((node) => ({
      id: node.id,
      title: node.title || "(Untitled Folder)",
      hasChildren: node.children && node.children.length > 0,
      children: lazy ? [] : buildFolderNodes(node.children || [], lazy)
    }));

const updateFolderSummary = () => {
  const count = state.selectedFolderIds.size;
  if (count === 0) {
    elements.folderSummary.textContent = "All folders selected.";
    return;
  }
  elements.folderSummary.textContent = `${count} folder${count === 1 ? "" : "s"} selected.`;
};

const renderFolderTree = () => {
  elements.folderTree.innerHTML = "";
  const container = document.createElement("div");
  container.className = "folder-list";
  renderFolderNodes(state.folderTree, container, 0);
  elements.folderTree.appendChild(container);
  updateFolderSummary();
};

const renderFolderNodes = (nodes, container, depth) => {
  nodes.forEach((node) => {
    const row = document.createElement("div");
    row.className = "folder-row";
    row.style.paddingLeft = `${depth * 12}px`;

    const hasChildren = node.hasChildren || (node.children && node.children.length > 0);
    const isExpanded = state.expandedFolderIds.has(node.id) || depth === 0;
    const isLoading = state.loadingFolderId === node.id;

    if (depth === 0 && hasChildren) {
      state.expandedFolderIds.add(node.id);
    }

    const toggle = document.createElement("button");
    toggle.className = "folder-toggle";
    toggle.dataset.id = node.id;
    toggle.disabled = !hasChildren || isLoading;
    if (isLoading) {
      toggle.textContent = "⋯";
    } else if (hasChildren) {
      toggle.textContent = isExpanded ? "▾" : "▸";
    } else {
      toggle.textContent = "•";
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "folder-checkbox";
    checkbox.dataset.id = node.id;
    checkbox.checked = state.selectedFolderIds.has(node.id);

    const title = document.createElement("span");
    title.className = "folder-title";
    title.textContent = node.title;

    row.appendChild(toggle);
    row.appendChild(checkbox);
    row.appendChild(title);
    container.appendChild(row);

    if (hasChildren && isExpanded && node.children && node.children.length > 0) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "folder-children";
      renderFolderNodes(node.children, childrenContainer, depth + 1);
      container.appendChild(childrenContainer);
    }
  });
};

// ===== 书签去重功能 =====

const findDuplicates = async () => {
  const tree = await chrome.bookmarks.getTree();
  const allBookmarks = flattenBookmarks(tree);

  const urlMap = new Map();
  const duplicates = [];

  allBookmarks.forEach((bookmark) => {
    if (!bookmark.url) return;

    const normalizedUrl = normalizeUrl(bookmark.url);

    if (urlMap.has(normalizedUrl)) {
      const existing = urlMap.get(normalizedUrl);
      const duplicateGroup = duplicates.find((g) => g.url === normalizedUrl);

      if (duplicateGroup) {
        duplicateGroup.bookmarks.push(bookmark);
      } else {
        duplicates.push({
          url: normalizedUrl,
          bookmarks: [existing, bookmark],
          count: 2
        });
      }
    } else {
      urlMap.set(normalizedUrl, bookmark);
    }
  });

  return duplicates.sort((a, b) => b.count - a.count);
};

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    // 移除 hash 和 trailing slash
    return parsed.origin + parsed.pathname.replace(/\/$/, "") + parsed.search;
  } catch {
    return url;
  }
};

const flattenBookmarks = (nodes, result = []) => {
  nodes.forEach((node) => {
    if (node.url) {
      result.push(node);
    }
    if (node.children) {
      flattenBookmarks(node.children, result);
    }
  });
  return result;
};

const getBookmarkPath = async (bookmarkId) => {
  const path = [];
  let current = await new Promise((resolve) => {
    chrome.bookmarks.get(bookmarkId, (nodes) => resolve(nodes && nodes[0]));
  });

  while (current) {
    path.unshift(current.title || "Root");
    if (current.parentId) {
      current = await new Promise((resolve) => {
        chrome.bookmarks.get(current.parentId, (nodes) => resolve(nodes && nodes[0]));
      });
    } else {
      break;
    }
  }

  return path.join(" > ");
};

const renderDuplicateList = () => {
  elements.duplicateList.innerHTML = "";

  if (state.duplicates.length === 0) {
    elements.duplicateSummary.textContent = "No duplicates found.";
    return;
  }

  const totalBookmarks = state.duplicates.reduce((sum, d) => sum + d.count, 0);
  const redundantBookmarks = totalBookmarks - state.duplicates.length;
  elements.duplicateSummary.textContent =
    `${state.duplicates.length} duplicate URLs (${redundantBookmarks} redundant bookmarks)`;

  state.duplicates.forEach((duplicate) => {
    const group = document.createElement("li");
    group.className = "duplicate-group";

    const header = document.createElement("div");
    header.className = "duplicate-header";

    const url = document.createElement("span");
    url.className = "duplicate-url";
    url.textContent = duplicate.url;
    url.title = duplicate.url;

    const count = document.createElement("span");
    count.className = "duplicate-count";
    count.textContent = `${duplicate.count} copies`;

    header.appendChild(url);
    header.appendChild(count);
    group.appendChild(header);

    const bookmarksList = document.createElement("div");
    bookmarksList.className = "duplicate-bookmarks";

    duplicate.bookmarks.forEach((bookmark, index) => {
      const item = document.createElement("label");
      item.className = "duplicate-item checkbox";

      const checkbox = document.createElement("input");
      checkbox.type = "radio";
      checkbox.name = `duplicate-${duplicate.url}`;
      checkbox.dataset.id = bookmark.id;
      checkbox.dataset.url = duplicate.url;
      checkbox.checked = index === 0;

      const path = document.createElement("span");
      path.className = "duplicate-path";
      path.textContent = bookmark.title || "(Untitled)";

      const folderPath = document.createElement("span");
      folderPath.className = "duplicate-folder";
      folderPath.textContent = "Loading...";

      // 异步加载路径
      getBookmarkPath(bookmark.id).then((pathStr) => {
        folderPath.textContent = pathStr;
      });

      item.appendChild(checkbox);
      item.appendChild(path);
      item.appendChild(folderPath);
      bookmarksList.appendChild(item);
    });

    const actions = document.createElement("div");
    actions.className = "duplicate-actions";

    const keepBtn = document.createElement("button");
    keepBtn.className = "ghost";
    keepBtn.textContent = "Keep Selected";
    keepBtn.dataset.url = duplicate.url;

    actions.appendChild(keepBtn);
    bookmarksList.appendChild(actions);

    group.appendChild(bookmarksList);
    elements.duplicateList.appendChild(group);
  });
};

const handleScanDuplicates = async () => {
  elements.scanDuplicatesBtn.disabled = true;
  elements.duplicateSummary.textContent = "Scanning...";
  state.duplicates = [];

  try {
    state.duplicates = await findDuplicates();
    renderDuplicateList();
  } catch (error) {
    elements.duplicateSummary.textContent = "Error scanning duplicates.";
    console.error("Duplicate scan error:", error);
  }

  elements.scanDuplicatesBtn.disabled = false;
};

const handleDeleteDuplicates = async (url) => {
  const group = state.duplicates.find((d) => d.url === url);
  if (!group) return;

  const selectedRadio = document.querySelector(
    `input[name="duplicate-${url}"]:checked`
  );
  if (!selectedRadio) return;

  const keepId = selectedRadio.dataset.id;
  const toDelete = group.bookmarks.filter((b) => b.id !== keepId);

  if (!confirm(`Delete ${toDelete.length} duplicate bookmark(s)?`)) {
    return;
  }

  for (const bookmark of toDelete) {
    await new Promise((resolve) => {
      chrome.bookmarks.remove(bookmark.id, resolve);
    });
  }

  // 从列表中移除
  state.duplicates = state.duplicates.filter((d) => d.url !== url);
  renderDuplicateList();
};

// ===== 结束书签去重功能 =====

const loadFolderTree = async () => {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  state.folderTree = buildFolderNodes(root ? root.children || [] : []);
  renderFolderTree();
};

const loadFolderChildren = async (folderId) => {
  if (state.loadedChildrenIds.has(folderId)) {
    return;
  }

  state.loadingFolderId = folderId;
  renderFolderTree();

  const subTree = await new Promise((resolve) => {
    chrome.bookmarks.getSubTree(folderId, (nodes) => resolve(nodes || []));
  });

  const folder = findFolderById(state.folderTree, folderId);
  if (folder && subTree[0]) {
    folder.children = buildFolderNodes(subTree[0].children || [], false);
    state.loadedChildrenIds.add(folderId);
  }

  state.loadingFolderId = null;
  renderFolderTree();
};

const findFolderById = (nodes, id) => {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFolderById(node.children, id);
      if (found) return found;
    }
  }
  return null;
};

const getSettings = async () => {
  const stored = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
};

const saveSettings = async () => {
  const concurrency = Number(elements.concurrencyInput.value);
  const timeoutMs = Number(elements.timeoutInput.value);
  const settings = {
    concurrency: Number.isFinite(concurrency) ? Math.min(Math.max(concurrency, 1), 10) : DEFAULT_SETTINGS.concurrency,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1000), 20000) : DEFAULT_SETTINGS.timeoutMs
  };
  await chrome.storage.sync.set({ settings });
  setStatus("Settings saved");
};

const loadSettings = async () => {
  const settings = await getSettings();
  elements.concurrencyInput.value = settings.concurrency;
  elements.timeoutInput.value = settings.timeoutMs;
};

const loadLastScan = async () => {
  const stored = await chrome.storage.local.get("lastScan");
  if (stored.lastScan) {
    state.invalidBookmarks = stored.lastScan.invalid || [];
    renderInvalidList();
    elements.deleteBtn.disabled = state.invalidBookmarks.length === 0;
    elements.invalidSummary.textContent = stored.lastScan.summary || "Previous scan loaded.";
  }
};

const getSelectedInvalidIds = () => {
  const checkboxes = elements.invalidList.querySelectorAll("input[type='checkbox']");
  return Array.from(checkboxes)
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.dataset.id);
};

const getSelectedFolderIds = () => Array.from(state.selectedFolderIds);

const disableActions = (disabled) => {
  elements.scanBtn.disabled = disabled;
  elements.previewBtn.disabled = disabled;
  elements.organizeBtn.disabled = disabled || state.domainPreview.length === 0;
  elements.deleteBtn.disabled = disabled || state.invalidBookmarks.length === 0;
  const selectedIds = getSelectedInvalidIds();
  elements.retrySelectedBtn.disabled = disabled || selectedIds.length === 0;
  elements.cancelBtn.style.display = state.isScanning ? "block" : "none";
};

const startTimer = () => {
  state.startTime = Date.now();
  setTimer();
};

const resetTimer = () => {
  state.startTime = null;
  setTimer();
};

const handleScan = async () => {
  state.isScanning = true;
  disableActions(true);
  setStatus("Scanning...");
  setProgress(0, 0);
  startTimer();

  const settings = await getSettings();
  getPort().postMessage({ action: "SCAN_BOOKMARKS", settings });
};

const handleCancel = () => {
  if (!state.isScanning) return;
  getPort().postMessage({ action: "CANCEL_SCAN" });
  state.isScanning = false;
  setStatus("Cancelling...");
};

const handlePreview = () => {
  disableActions(true);
  setStatus("Building preview...");
  setProgress(0, 0);
  startTimer();
  getPort().postMessage({ action: "PREVIEW_DOMAINS", folderIds: getSelectedFolderIds() });
};

const handleOrganize = () => {
  if (!confirm("Organize bookmarks by domain? This will move bookmarks into new folders.")) {
    return;
  }
  disableActions(true);
  setStatus("Organizing...");
  setProgress(0, 0);
  startTimer();
  getPort().postMessage({ action: "ORGANIZE_BY_DOMAIN", folderIds: getSelectedFolderIds() });
};

const handleDelete = () => {
  const selectedIds = getSelectedInvalidIds();
  if (selectedIds.length === 0) {
    setStatus("No bookmarks selected.");
    return;
  }
  if (!confirm(`Delete ${selectedIds.length} invalid bookmarks? This cannot be undone.`)) {
    return;
  }
  disableActions(true);
  setStatus("Deleting...");
  setProgress(0, selectedIds.length);
  startTimer();
  getPort().postMessage({ action: "DELETE_BOOKMARKS", ids: selectedIds });
};

const handleSelectAll = (event) => {
  const checked = event.target.checked;
  elements.invalidList.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = checked;
  });
  updateRetrySelectedState();
};

const handleRetrySelected = () => {
  const selectedIds = getSelectedInvalidIds();
  if (selectedIds.length === 0) {
    setStatus("No bookmarks selected.");
    return;
  }
  disableActions(true);
  setStatus(`Retrying ${selectedIds.length} bookmarks...`);
  setProgress(0, selectedIds.length);
  startTimer();
  state.pendingRetryIds = new Set(selectedIds);
  state.retryTotal = selectedIds.length;
  selectedIds.forEach((id) => {
    getPort().postMessage({ action: "RETRY_BOOKMARK", id });
  });
};

const handleRetrySingle = (id) => {
  if (!id) return;
  disableActions(true);
  setStatus("Retrying bookmark...");
  setProgress(0, 1);
  startTimer();
  state.pendingRetryIds = new Set([id]);
  state.retryTotal = 1;
  getPort().postMessage({ action: "RETRY_BOOKMARK", id });
};

const updateRetrySelectedState = () => {
  const selectedIds = getSelectedInvalidIds();
  elements.retrySelectedBtn.disabled = selectedIds.length === 0;
};

const handleInvalidListClick = (event) => {
  const target = event.target;
  if (target && target.classList.contains("retry-btn")) {
    handleRetrySingle(target.dataset.id);
  }
};

const handleInvalidListChange = (event) => {
  const target = event.target;
  if (target && target.matches("input[type='checkbox']")) {
    updateRetrySelectedState();
  }
};

const updateInvalidBookmark = (payload) => {
  const index = state.invalidBookmarks.findIndex((item) => item.id === payload.id);
  if (payload.ok) {
    if (index >= 0) {
      state.invalidBookmarks.splice(index, 1);
    }
  } else if (index >= 0) {
    state.invalidBookmarks[index] = { ...state.invalidBookmarks[index], ...payload };
  }
  renderInvalidList();
};

const handleRetryResult = (message) => {
  updateInvalidBookmark(message);
  if (state.pendingRetryIds.has(message.id)) {
    state.pendingRetryIds.delete(message.id);
    const completed = state.retryTotal - state.pendingRetryIds.size;
    setProgress(completed, state.retryTotal);
  }
  if (state.pendingRetryIds.size === 0) {
    setStatus("Retry finished.");
    enableActionsAfterIdle();
  }
};

const enableActionsAfterIdle = () => {
  disableActions(false);
  resetTimer();
};

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "idle") {
    if (state.pendingRetryIds.size === 0) {
      enableActionsAfterIdle();
    }
  }
});

const init = async () => {
  await loadSettings();
  await loadLastScan();
  await loadFolderTree();
  elements.scanBtn.addEventListener("click", handleScan);
  elements.cancelBtn.addEventListener("click", handleCancel);
  elements.previewBtn.addEventListener("click", handlePreview);
  elements.organizeBtn.addEventListener("click", handleOrganize);
  elements.deleteBtn.addEventListener("click", handleDelete);
  elements.saveSettingsBtn.addEventListener("click", saveSettings);
  elements.selectAllInvalid.addEventListener("change", handleSelectAll);
  elements.retrySelectedBtn.addEventListener("click", handleRetrySelected);
  elements.invalidList.addEventListener("click", handleInvalidListClick);
  elements.invalidList.addEventListener("change", handleInvalidListChange);
  elements.searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderInvalidList();
  });
  elements.errorFilter.addEventListener("change", (event) => {
    state.errorFilter = event.target.value;
    renderInvalidList();
  });
  elements.folderTree.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("folder-toggle")) {
      const id = target.dataset.id;
      if (state.expandedFolderIds.has(id)) {
        state.expandedFolderIds.delete(id);
        renderFolderTree();
      } else {
        state.expandedFolderIds.add(id);
        if (!state.loadedChildrenIds.has(id)) {
          loadFolderChildren(id);
        } else {
          renderFolderTree();
        }
      }
      return;
    }
    if (target.classList.contains("folder-checkbox")) {
      const id = target.dataset.id;
      if (target.checked) {
        state.selectedFolderIds.add(id);
      } else {
        state.selectedFolderIds.delete(id);
      }
      updateFolderSummary();
    }
  });
  elements.reloadFoldersBtn.addEventListener("click", loadFolderTree);
  elements.scanDuplicatesBtn.addEventListener("click", handleScanDuplicates);
  elements.duplicateList.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("ghost") && target.textContent === "Keep Selected") {
      const url = target.dataset.url;
      handleDeleteDuplicates(url);
    }
  });
};

init();
