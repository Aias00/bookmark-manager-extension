# Changelog

## 1.0.0 - 2026-02-25
- First public release.
- Scan all bookmarks and detect invalid links (HTTP errors, timeout, network, CORS, unknown).
- Retry invalid links individually or in batch.
- Delete invalid bookmarks individually or in batch.
- Organize bookmarks by domain.
- Domain Preview now supports expandable per-domain bookmark lists.
- URL links shown in the UI are clickable and open in a new tab.
- Duplicate URL scan and selective duplicate cleanup.
- Improved selection behavior for invalid bookmark list (no unexpected auto-select).
- Manifest host permissions narrowed from `<all_urls>` to `http://*/*` and `https://*/*`.
