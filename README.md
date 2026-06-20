# LaPage Codex Telegram Bridge

Run a persistent Codex CLI session behind a private Telegram bot. Telegram messages are written into a detached tmux-backed Codex session, and Codex terminal output is sent back to Telegram in chunks.

## Setup

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Get your Telegram numeric user ID, for example from [@userinfobot](https://t.me/userinfobot).
3. Install dependencies:

   ```sh
   npm install
   ```

   Also make sure `tmux` is installed:

   ```sh
   tmux -V
   ```

4. Create your local config:

   ```sh
   cp .env.example .env
   ```

5. Edit `.env`:

   ```sh
   TELEGRAM_BOT_TOKEN=123456:your_real_token
   TELEGRAM_ALLOWED_USER_IDS=your_numeric_telegram_user_id
   CODEX_CWD=/Users/huylan
   ```

6. Start the bridge:

   ```sh
   npm run dev
   ```

## Commands

- `/status` shows the Codex process state, working directory, and buffered output size.
- `/flush` sends buffered Codex output immediately.
- `/interrupt` sends Ctrl-C to Codex.
- `/restart` restarts the Codex PTY session.
- `/stop` stops Codex; the next normal message starts it again.
- Any other Telegram text is sent directly to Codex followed by Enter.

## Configuration

- `TELEGRAM_ALLOWED_USER_IDS` is a comma-separated allowlist. Keep this private.
- `CODEX_CWD` controls where Codex starts.
- `CODEX_COMMAND` defaults to `codex`.
- `CODEX_ARGS` can pass extra startup args to Codex, for example `--approval-policy never` if supported by your installed CLI.
- `CODEX_SUBMIT_KEY` controls which key submits a Telegram prompt to Codex. It defaults to `Enter`.
- `CODEX_SUBMIT_DELAY_MS` waits after pasting text before pressing submit. It defaults to `800` because Codex needs a short delay after tmux paste.
- `TMUX_SESSION` controls the detached tmux session name.
- `POLL_INTERVAL_MS` controls how often the bridge reads new tmux output.
- `CODEX_STARTUP_DELAY_MS` gives Codex time to initialize before the first Telegram prompt is pasted.
- `STREAM_EDIT_INTERVAL_MS` controls how often the bot may edit the streaming Telegram response. It defaults to `650`.
- `STREAM_MIN_CHANGE_CHARS` avoids tiny no-op edits. It defaults to `24`.
- `TYPING_INTERVAL_MS` controls how often the bot sends Telegram's typing indicator while Codex is working. It defaults to `4000`.
- `MAX_TELEGRAM_CHARS` defaults to `3500` and is capped below Telegram's message limit.
- The bridge uses `tmux` to provide the pseudo-terminal Codex expects.

## Tmux Debugging

Attach to the live Codex session from a terminal:

```sh
tmux attach -t codex-telegram-bridge
```

Detach without stopping Codex by pressing `Ctrl-b`, then `d`.

## Security

This bridge exposes a local Codex CLI session through Telegram. Keep the bot private, use a strict allowlist, and point `CODEX_CWD` at a directory you are comfortable controlling remotely.
