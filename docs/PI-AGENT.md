# Pi agent in Code Studio

Pi is available in the AI hub and as an Agent Task runtime. It uses the official Pi JSONL RPC protocol, adapted to adOmnia's existing agent host. The managed package is `@earendil-works/pi-coding-agent@1.4.0`; custom installations must report version 1.4 or later.

## Setup

1. Open Code Studio, the AI hub, then **Pi** and **Pi settings**.
2. Install the managed package, or select an existing Pi executable / CLI JavaScript entry. Installation requires Node.js and npm and happens only when requested.
3. Configure credentials with Pi itself. The settings dialog shows the command for the selected installation. Run it in a terminal, use `/login` for supported OAuth providers, or configure Pi's own API keys and model settings.
4. Enable Pi. Pick the model and thinking level from the chat controls. A connected RPC process does not establish that its provider credentials or inference endpoint work.

An existing Node/Pi installation can be used without downloading a second copy. Managed installation lives in the application data directory under `pi-runtime`; it does not install Pi globally.

## Behavior

- Chat uses the shared project context, attachments, streaming, stop, tool activity, permission UI and post-turn review.
- Each project chat and task session gets its own Pi process and working directory. Starting a new chat closes the old process. Native Pi history persistence is disabled (`--no-session`).
- Model and thinking controls come from Pi. Images use native prompt blocks; the bridge rejects them if the selected model does not advertise image input.
- Completion waits for `agent_settled`, including retries and compaction. `agent_end` alone does not complete a turn. Stop clears queued messages and aborts the active turn.
- adOmnia loads its own confirmation extension and disables automatic third-party extension loading. Each tool call goes through the shared permission host. Pi extension UI methods other than adOmnia's confirmation are cancelled explicitly.
- File-tool paths outside the project, excluded paths and symlink escapes are rejected. Shell commands require review and are not sandboxed. Project context exclusions are not a shell sandbox.
- Projects whose AI policy requires a local-only provider cannot use this general Pi adapter. A local model configured inside Pi is not automatically classified as local by adOmnia.

Pi's provider credentials remain managed by Pi. MCP server configuration and interactive third-party extension UI are not exposed through this adapter. Slash prompts can be entered directly, but this version does not populate Pi's command discovery palette.

Official protocol: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md

## Verification

Automated bridge tests exercise isolated session lifecycle, streaming completion after `agent_end`, cancellation, text-only image rejection, model/thinking discovery, permission allow/deny and excluded paths. The optional `TestInstalledPiHandshake` uses `ADOMNIA_PI_SMOKE_SCRIPT` to connect to an installed official CLI and load the embedded extension.

On 2026-10-29 the handshake passed against Pi 1.4.0 installed in a temporary test directory. Frontend and Go builds passed. A browser fixture checks the actual hub/chat/settings components and session controls; it does not establish a native Wails provider turn. Authenticated model inference, a native desktop editing turn and task execution with Pi remain manual acceptance checks.
