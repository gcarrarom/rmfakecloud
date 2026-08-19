# Unreleased

# 0.0.36

## Features

- Read EPUB chapters on demand in the web reader instead of converting or downloading the entire book.
- Broadcast web reading-position updates to connected tablet clients.

# 0.0.35

## Features

- Save and restore the current reading page for PDFs, EPUBs, and native documents.
- Show reading progress in document lists, the document tree, and viewers.

# 0.0.34

## Bug fixes

- Allow mobile document file lists to scroll through all files.
- Allow collapsed document folders to be reopened by clicking the selected folder.

# 0.0.32

## Bug fixes

- Improve desktop document browsing with a compact, resizable sidebar and correctly sized tree.

## Features

- Normalize ICE server configuration for tablet WebRTC compatibility.
- Add desktop client setup documentation for hosts-file and RMHook-based setups.

# 0.0.30

## Features

- Add WebSocket ping/pong keepalive and stale-session detection.

# 0.0.29

## Bug fixes

- Preserve page order in PDF previews and downloads for v6 documents.

# 0.0.25

## Features

- Software compatibility with 3.20 (cdb45df0b8314e637b5cdb722b10f0b262d74f56)
- Handle messaging integrations (a88aee6ea5ad846cd8aaab2bcbe2f82d2898e5f4)
- [Webhook messaging integration](https://ddvk.github.io/rmfakecloud/usage/integrations/#messaging-webhook) (479887ee4b335cd99f8a4cb4afeb7577681a217b)
- New option: `RMAPI_HWR_LANG_OVERRIDE` to override the language specified in myScript requests (#352)

## Internal change

- Refactor hash function (#365)
