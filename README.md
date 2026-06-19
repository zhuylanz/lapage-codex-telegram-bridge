# LaPage Codex Telegram Bridge

Run a persistent Codex CLI session behind a private Telegram bot. Telegram messages are written into a pseudo-terminal-backed Codex session, and Codex terminal output is sent back to Telegram in chunks.

## Setup

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Get your Telegram numeric user ID, for example from [@userinfobot](https://t.me/userinfobot).
3. Install dependencies:

   ```sh
   npm install
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
- `MAX_TELEGRAM_CHARS` defaults to `3500` and is capped below Telegram's message limit.
- The bridge uses macOS `script(1)` to provide the pseudo-terminal Codex expects.

## Security

This bridge exposes a local Codex CLI session through Telegram. Keep the bot private, use a strict allowlist, and point `CODEX_CWD` at a directory you are comfortable controlling remotely.
