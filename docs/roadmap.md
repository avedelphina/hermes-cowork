# Roadmap

Deferred ideas — not scheduled, revisit when the core Chat/Cowork split settles.

## Read-only transcript viewer for external sessions

Hermes dashboard `/api/sessions` lists conversations started outside this app
(CLI, gateway, Krisp). Today they are hidden from the Chat list because the app
can only *list* them, not open them — ACP `session/load` expects an ACP session
id minted by this app's own `session/new`.

To show them read-only:
- Add a dashboard route (e.g. `GET /api/sessions/:id`) that returns the stored
  transcript, and allow it through the REST proxy in `main/ipc/handlers.ts`.
- Render it in a non-interactive transcript pane (no composer, no approvals).
- In `chat/SessionList.tsx`, restore an "Other sessions" section that opens that
  pane instead of calling `acp.load`.

## Dedicated Code mode

Removed 2026-09-03. It was `ChatSurface` + a read-only `FileBrowser` of the
active project's folder, and overlapped almost entirely with "Chat + a
project" now that chats are project-aware.

If it comes back, make it earn the separate mode: inline diffs, edit-in-place,
a real editor pane, or agent file operations surfaced in the tree — not just a
file preview next to the chat.
