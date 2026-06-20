# Active Session Handoff

Updated: 2026-06-20 20:45 Asia/Ho_Chi_Minh

## Current Goal
- Build a Telegram chat bridge to a persistent Codex CLI PTY session.

## Current State
- Project folder created at `/Users/huylan/Code/lapage-codex-telegram-bride`.
- Bridge implementation uses tmux, sends prompts via `tmux set-buffer` + `paste-buffer`, waits `CODEX_SUBMIT_DELAY_MS`, then presses configurable submit key. Output relay now streams by editing one Telegram message with the latest Codex response block.

## Files Touched
- `package.json`: npm scripts and dependencies.
- `tsconfig.json`: TypeScript config.
- `.env.example`: environment template.
- `.gitignore`: local ignore rules.
- `src/index.ts`: minimal entrypoint wiring config and bridge lifecycle.
- `src/config.ts`: env parsing and typed config.
- `src/codex-session.ts`: tmux-backed Codex session lifecycle and input submission.
- `src/telegram-bridge.ts`: Telegram bot handlers, polling, flushing, status/help commands.
- `src/text.ts`: terminal normalization, pane cleanup, latest completed response extraction, Markdown escaping, chunking.
- `src/tmux.ts`: tmux command helpers and shell quoting.
- `.env`: updated local `CODEX_SUBMIT_KEY=Enter` and `CODEX_SUBMIT_DELAY_MS=800` without exposing secrets.
- `README.md`: setup and command documentation, including tmux attach/debug instructions.
- `.env.example`: added `TMUX_SESSION` and `POLL_INTERVAL_MS`.
- `package-lock.json`: locked installed dependencies.

## Commands Run
- `mkdir -p /Users/huylan/Code/lapage-codex-telegram-bride`: created project directory.
- `npm install`: installed dependencies.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm audit --audit-level=moderate`: passed with 0 vulnerabilities.
- `node getMe check`: Telegram bot auth passed for `@groot_agent_bot` without printing token.
- `npm run dev` smoke test: process stayed up for 8 seconds.
- `tmux` smoke test: passed outside sandbox; sandbox cannot access `/private/tmp/tmux-501/default`.
- `npm run dev` tmux smoke test: passed outside sandbox for 8 seconds.
- `npm run dev` submit smoke test: passed for 8 seconds after input-delivery changes.
- Real Codex tmux test with `.env` values: prompt `reply exactly ENV_SUBMIT_OK` submitted successfully and Codex replied `ENV_SUBMIT_OK`.
- `npm run dev` refactor smoke test: passed for 8 seconds after splitting modules.
- Parser test: working/progress pane returns `null`; completed bullet response returns the response only.
- Fixed parser false positive where normal response text containing “working” was treated as in-progress.
- Streaming parser test: partial response returns answer text while `isCodexWorking=true`; completed response returns final answer; progress bullet is excluded.

## Decisions Made
- Use Node.js with `grammy` and `tmux` for a persistent interactive Codex session.
- Use allowlisted Telegram user IDs by default.
- Switched from `node-telegram-bot-api` to `grammy` to avoid deprecated vulnerable dependencies.
- Replaced `script(1)` because Telegram run showed `script: tcgetattr/ioctl: Operation not supported on socket`.
- Default `CODEX_SUBMIT_KEY` is `Enter`; `C-j` did not submit in Codex v0.141.0. A short `CODEX_SUBMIT_DELAY_MS=800` after paste is required before pressing Enter.
- Raw tmux `pipe-pane` output contains noisy TUI diff/control artifacts like repeated `q`; use cleaned `capture-pane` snapshots instead.
- Do not send Codex progress snapshots repeatedly; wait for a completed `• ...` response block.
- For streaming, edit the same Telegram message every ~1.5s instead of sending multiple messages.

## Next Safe Step
- Run `npm run dev`, open Telegram chat with `@groot_agent_bot`, send `/status`, then send a Codex prompt. Current tested values are `CODEX_SUBMIT_KEY=Enter` and `CODEX_SUBMIT_DELAY_MS=800`.

## Warnings
- Do not put Telegram bot tokens or secrets in memory files.
- Telegram access exposes a local Codex CLI session; keep the allowlist strict.
