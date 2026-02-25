const DEFAULT_SETTINGS = {
  concurrency: 5,
  timeoutMs: 8000
};

let cancelScan = false;

// 点击扩展图标时打开独立页面
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});

const isHttpUrl = (url) => /^https?:/i.test(url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const classifyError = (error) => {
  const message = (error && error.message) || "Fetch failed";
  if (error && error.name === "AbortError") {
    return { errorType: "timeout", errorMessage: "Request timed out" };
  }
  if (/cors/i.test(message)) {
    return { errorType: "cors", errorMessage: message };
  }
  if (error instanceof TypeError) {
    return { errorType: "network", errorMessage: message };
  }
  return { errorType: "unknown", errorMessage: message };
};

const getSettings = async () => {
  const stored = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
};

const getBookmarksTree = () =>
  new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => resolve(tree));
  });

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

const checkUrl = async (url, timeoutMs) => {
  const maxAttempts = 3;
  const backoff = [1000, 2000];
  const history = [];

  const tryFetch = async (method, controller) => {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    return response;
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await tryFetch("HEAD", controller);
      if (response.status === 405 || response.status === 403 || response.status === 401) {
        response = await tryFetch("GET", controller);
      }
      const ok = response.status >= 200 && response.status < 400;
      if (ok) {
        history.push({ ok: true, status: response.status });
        return {
          ok: true,
          status: response.status,
          attempts: history.length,
          history
        };
      }
      const message = response.statusText ? `${response.status} ${response.statusText}` : `HTTP ${response.status}`;
      history.push({ ok: false, status: response.status, errorType: "http", errorMessage: message });
    } catch (error) {
      const classified = classifyError(error);
      history.push({ ok: false, errorType: classified.errorType, errorMessage: classified.errorMessage });
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxAttempts - 1) {
      await delay(backoff[attempt]);
    }
  }

  const last = history[history.length - 1] || {};
  return {
    ok: false,
    status: last.status,
    errorType: last.errorType || "unknown",
    errorMessage: last.errorMessage || "Fetch failed",
    attempts: history.length || 0,
    history
  };
};

const runWithConcurrency = async (items, limit, worker, onProgress) => {
  const safeLimit = Math.max(1, Number(limit) || 1);
  let index = 0;
  let inFlight = 0;
  let completed = 0;
  const results = new Array(items.length);

  return new Promise((resolve) => {
    if (items.length === 0) {
      resolve(results);
      return;
    }

    const launchNext = () => {
      if (cancelScan) {
        cancelScan = false;
        resolve(results);
        return;
      }

      while (inFlight < safeLimit && index < items.length) {
        const current = index++;
        inFlight += 1;
        Promise.resolve(worker(items[current]))
          .then((result) => {
            results[current] = result;
          })
          .catch((error) => {
            results[current] = { ok: false, error: error.message || "Unknown error" };
          })
          .finally(() => {
            inFlight -= 1;
            completed += 1;
            if (onProgress) onProgress(completed, items.length);
            if (cancelScan) {
              cancelScan = false;
              resolve(results);
              return;
            }
            if (completed >= items.length) {
              resolve(results);
              return;
            }
            launchNext();
          });
      }
    };

    launchNext();
  });
};

const extractDomain = (url) => new URL(url).hostname.replace(/^www\./i, "");

const buildDomainGroups = (bookmarks) => {
  const groups = new Map();

  bookmarks.forEach((bookmark) => {
    if (!bookmark.url || !isHttpUrl(bookmark.url)) return;
    try {
      const domain = extractDomain(bookmark.url);
      if (!groups.has(domain)) {
        groups.set(domain, []);
      }
      groups.get(domain).push({
        id: bookmark.id,
        title: bookmark.title || "(Untitled)",
        url: bookmark.url
      });
    } catch (error) {
      return;
    }
  });

  return Array.from(groups.entries())
    .map(([domain, bookmarksInDomain]) => ({
      domain,
      count: bookmarksInDomain.length,
      bookmarks: bookmarksInDomain.sort((a, b) => a.title.localeCompare(b.title))
    }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
};

const findRootFolder = async () => {
  const tree = await getBookmarksTree();
  const root = tree[0];
  if (!root || !root.children) return null;

  const other = root.children.find((child) => child.title === "Other Bookmarks");
  return other || root.children[0] || root;
};

const getChildren = (id) =>
  new Promise((resolve) => {
    chrome.bookmarks.getChildren(id, (children) => resolve(children || []));
  });

const getSubTree = (id) =>
  new Promise((resolve) => {
    chrome.bookmarks.getSubTree(id, (nodes) => resolve(nodes || []));
  });

const getBookmarkById = (id) =>
  new Promise((resolve) => {
    chrome.bookmarks.get(id, (nodes) => resolve(nodes && nodes[0]));
  });

const createFolder = (parentId, title) =>
  new Promise((resolve) => {
    chrome.bookmarks.create({ parentId, title }, (node) => resolve(node));
  });

const moveBookmark = (id, parentId) =>
  new Promise((resolve) => {
    chrome.bookmarks.move(id, { parentId }, () => resolve());
  });

const removeBookmark = (id) =>
  new Promise((resolve) => {
    chrome.bookmarks.remove(id, () => resolve());
  });

const ensureFolder = async (parentId, title) => {
  const children = await getChildren(parentId);
  const existing = children.find((child) => !child.url && child.title === title);
  if (existing) return existing;
  return createFolder(parentId, title);
};

const collectFolderIds = (node, set) => {
  if (node.id) set.add(node.id);
  if (node.children) node.children.forEach((child) => collectFolderIds(child, set));
};

const scanBookmarks = async (port, settings) => {
  const tree = await getBookmarksTree();
  const allBookmarks = flattenBookmarks(tree);
  const targets = allBookmarks.filter((bookmark) => bookmark.url && isHttpUrl(bookmark.url));

  const invalid = [];
  const results = await runWithConcurrency(
    targets,
    settings.concurrency,
    async (bookmark) => {
      const result = await checkUrl(bookmark.url, settings.timeoutMs);
      if (!result.ok) {
        invalid.push({
          id: bookmark.id,
          title: bookmark.title,
          url: bookmark.url,
          status: result.status || "error",
          errorType: result.errorType || "unknown",
          errorMessage: result.errorMessage || "Fetch failed",
          attempts: result.attempts || 0,
          history: result.history || []
        });
      }
      return result;
    },
    (completed, total) => {
      port.postMessage({ type: "progress", completed, total });
    }
  );

  const summary = `${invalid.length} invalid out of ${targets.length} scanned.`;
  await chrome.storage.local.set({
    lastScan: {
      invalid,
      summary,
      total: targets.length
    }
  });

  port.postMessage({ type: "scanResult", invalid, total: targets.length, summary });
  chrome.runtime.sendMessage({ type: "idle" });
  return results;
};

const previewDomains = async (port) => {
  const tree = await getBookmarksTree();
  const allBookmarks = flattenBookmarks(tree);
  const domains = buildDomainGroups(allBookmarks);
  port.postMessage({ type: "previewResult", domains });
  chrome.runtime.sendMessage({ type: "idle" });
};

const organizeByDomain = async (port) => {
  const tree = await getBookmarksTree();
  const allBookmarks = flattenBookmarks(tree);
  const rootFolder = await findRootFolder();
  if (!rootFolder) {
    port.postMessage({ type: "error", message: "Root folder not found" });
    chrome.runtime.sendMessage({ type: "idle" });
    return;
  }

  const byDomainFolder = await ensureFolder(rootFolder.id, "By Domain");
  const byDomainTree = await getSubTree(byDomainFolder.id);
  const excludedIds = new Set();
  collectFolderIds(byDomainTree[0], excludedIds);

  const bookmarksToMove = allBookmarks.filter((bookmark) => {
    if (!bookmark.url || !isHttpUrl(bookmark.url)) return false;
    if (excludedIds.has(bookmark.id)) return false;
    return true;
  });

  let moved = 0;
  for (const bookmark of bookmarksToMove) {
    try {
      const domain = extractDomain(bookmark.url);
      const domainFolder = await ensureFolder(byDomainFolder.id, domain);
      await moveBookmark(bookmark.id, domainFolder.id);
      moved += 1;
      port.postMessage({ type: "progress", completed: moved, total: bookmarksToMove.length });
    } catch (error) {
      continue;
    }
  }

  port.postMessage({ type: "organizeResult", moved });
  chrome.runtime.sendMessage({ type: "idle" });
};

const updateLastScanAfterDelete = async (deletedIds = []) => {
  if (!Array.isArray(deletedIds) || deletedIds.length === 0) {
    return;
  }
  const stored = await chrome.storage.local.get("lastScan");
  if (!stored.lastScan) return;

  const deletedSet = new Set(deletedIds);
  const lastScan = stored.lastScan;
  const invalid = Array.isArray(lastScan.invalid)
    ? lastScan.invalid.filter((item) => !deletedSet.has(item.id))
    : [];
  const total = lastScan.total || invalid.length;
  const summary = `${invalid.length} invalid out of ${total} scanned.`;

  await chrome.storage.local.set({
    lastScan: {
      ...lastScan,
      invalid,
      summary
    }
  });
};

const deleteBookmarks = async (port, ids = []) => {
  let deleted = 0;
  for (const id of ids) {
    await removeBookmark(id);
    deleted += 1;
    port.postMessage({ type: "progress", completed: deleted, total: ids.length });
  }
  await updateLastScanAfterDelete(ids);
  port.postMessage({ type: "deleteResult", deleted, deletedIds: ids });
  chrome.runtime.sendMessage({ type: "idle" });
};

const updateLastScanAfterRetry = async (id, result) => {
  const stored = await chrome.storage.local.get("lastScan");
  if (!stored.lastScan) return;
  const lastScan = stored.lastScan;
  let invalid = Array.isArray(lastScan.invalid) ? [...lastScan.invalid] : [];

  if (result.ok) {
    invalid = invalid.filter((item) => item.id !== id);
  } else {
    const index = invalid.findIndex((item) => item.id === id);
    if (index >= 0) {
      invalid[index] = { ...invalid[index], ...result };
    }
  }

  const total = lastScan.total || invalid.length;
  const summary = `${invalid.length} invalid out of ${total} scanned.`;
  await chrome.storage.local.set({
    lastScan: {
      ...lastScan,
      invalid,
      summary
    }
  });
};

const retryBookmark = async (port, id, settings) => {
  if (!id) {
    port.postMessage({ type: "retryResult", id, ok: false, errorType: "unknown", errorMessage: "Missing id" });
    chrome.runtime.sendMessage({ type: "idle" });
    return;
  }

  const node = await getBookmarkById(id);
  if (!node || !node.url || !isHttpUrl(node.url)) {
    const payload = {
      type: "retryResult",
      id,
      ok: false,
      errorType: "unknown",
      errorMessage: "Bookmark not found or unsupported URL"
    };
    port.postMessage(payload);
    await updateLastScanAfterRetry(id, {
      ok: false,
      errorType: payload.errorType,
      errorMessage: payload.errorMessage
    });
    chrome.runtime.sendMessage({ type: "idle" });
    return;
  }

  const result = await checkUrl(node.url, settings.timeoutMs);
  const payload = {
    type: "retryResult",
    id,
    title: node.title,
    url: node.url,
    ...result
  };
  port.postMessage(payload);
  await updateLastScanAfterRetry(id, {
    ...result,
    title: node.title,
    url: node.url
  });
  chrome.runtime.sendMessage({ type: "idle" });
};

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (message) => {
    const settings = await getSettings();
    switch (message.action) {
      case "SCAN_BOOKMARKS":
        await scanBookmarks(port, { ...settings, ...(message.settings || {}) });
        break;
      case "PREVIEW_DOMAINS":
        await previewDomains(port);
        break;
      case "ORGANIZE_BY_DOMAIN":
        await organizeByDomain(port);
        break;
      case "DELETE_BOOKMARKS":
        await deleteBookmarks(port, message.ids || []);
        break;
      case "RETRY_BOOKMARK":
        await retryBookmark(port, message.id, settings);
        break;
      case "CANCEL_SCAN":
        cancelScan = true;
        break;
      default:
        port.postMessage({ type: "error", message: "Unknown action" });
        chrome.runtime.sendMessage({ type: "idle" });
    }
  });
});
