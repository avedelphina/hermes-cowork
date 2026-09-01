# ACP integration notes — verified against Hermes 0.20.6

Recorded from a live `hermes acp` session on 2026-09-01 (Hermes Agent v0.20.6,
protocol v1, `azure-foundry:model-router`). Probe: initialize → session/new →
session/prompt → clean shutdown.

## Handshake

`initialize` request params we send:

```json
{ "protocolVersion": 1,
  "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false },
  "clientInfo": { "name": "hermes-cowork-desktop", "version": "0.1.0" } }
```

`initialize` result (trimmed):

```json
{ "protocolVersion": 1,
  "agentInfo": { "name": "hermes-agent", "version": "0.20.6" },
  "agentCapabilities": { "loadSession": true,
    "promptCapabilities": { "image": true },
    "sessionCapabilities": { "fork": {}, "list": {}, "resume": {} } },
  "authMethods": [ { "id": "azure-foundry", ... }, { "id": "hermes-setup", "type": "terminal", ... } ] }
```

- `sessionCapabilities.resume` / `.list` / `.fork` exist → Task 3.1 (resumable
  tasks) can lean on native ACP resume rather than re-implementing it.

## session/new

Result carries far more than `sessionId` (we currently read only that):

```json
{ "sessionId": "<uuid>",
  "_meta": { "hermes": { "sessionProvenance": {
      "acpSessionId", "currentHermesSessionId", "rootHermesSessionId",
      "parentHermesSessionId", "sessionKind": "root", "compressionDepth": 0 } } },
  "models": { "currentModelId": "azure-foundry:model-router", "availableModels": [ ... ] },
  "modes":  { "currentModeId": "default",
              "availableModes": [
                { "id": "default",       "name": "Default",      "description": "Ask before edits." },
                { "id": "accept_edits",  "name": "Accept Edits", "description": "Auto-allow workspace and /tmp edits; still asks for sensitive paths." },
                { "id": "dont_ask",      "name": "Don't Ask",    "description": "Auto-allow file edits for this session except sensitive paths." } ] } }
```

- **`models.currentModelId` + `availableModels`** → feed Task 1.2 (show resolved
  model/provider) and a future model switcher, no extra dashboard call needed.
- **`modes`** → Task 3.3 "Ask before acting" should map to a real ACP mode
  (`default` vs `accept_edits`/`dont_ask`), enforced agent-side, not a renderer
  toggle. Mode-set method still to be confirmed (likely `session/set_mode`).
- **`_meta.hermes.sessionProvenance`** → parent/child session linkage for
  Phase 5 multi-agent; `rootHermesSessionId` groups a task tree.

## session/update variants seen

For a trivial prompt: `agent_message_chunk`, `usage_update`,
`available_commands_update`, `session_info_update`.

- `agent_message_chunk`: `update.content = { "type": "text", "text": "…" }` —
  matches `acp-translator.extractTextFromContentBlock`. ✅
- `usage_update`, `available_commands_update`, `session_info_update`: dropped by
  the translator. ✅

Not yet exercised against 0.20.6 (trivial prompt can't force them): `tool_call`,
`tool_call_update`, `agent_thought_chunk`, `session/request_permission`,
cancellation (`session/cancel`). Translator code for these is written to the ACP
spec but should be confirmed with a prompt that triggers a tool call + approval.

## session/prompt

Resolves with:

```json
{ "stopReason": "end_turn",
  "usage": { "inputTokens": 15926, "outputTokens": 18, "thoughtTokens": 6,
             "cachedReadTokens": 0, "totalTokens": 15944 } }
```

We currently discard this and just emit `done`. `stopReason` (`end_turn`,
`max_tokens`, `refusal`, `cancelled`, …) and `usage` are worth surfacing later.

## Shutdown

`stdin.end()` → child exits `code 0` cleanly. Supervisor now forwards `exit` and
`error` as a fatal `session-error` semantic event (previously dropped).
