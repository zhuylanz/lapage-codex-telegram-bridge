# LaPage Codex Telegram Bridge

Control a local **Codex CLI** session from Telegram without opening any inbound ports to the internet.

This package is useful when Codex runs on a home PC, workstation, homelab box, or private server and you want a simple mobile chat interface. The bridge starts Codex inside a detached `tmux` session, receives Telegram messages from an allowlisted user, sends them into Codex, and relays Codex output back to Telegram.

## Why Use This

- No public SSH, HTTP, webhook, tunnel, or reverse proxy is required.
- Telegram provides the outbound connection path from your machine.
- Codex keeps running in `tmux`, so the session can survive terminal disconnects.
- Access is restricted to the Telegram user IDs you allowlist.

## Requirements

- Node.js 22 or newer
- npm
- `tmux`
- Codex CLI available on `PATH`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your numeric Telegram user ID, for example from [@userinfobot](https://t.me/userinfobot)

Check prerequisites:

```sh
node --version
npm --version
tmux -V
codex --version
```

## Quick Start

Install the package globally:

```sh
npm install -g @lapage/codex-telegram-bridge
```

Create the default config file:

```sh
codex-telegram-bridge init
```

This creates:

```text
~/.lapage-codex-telegram-bridge/.env
```

Edit the config file:

```sh
$EDITOR ~/.lapage-codex-telegram-bridge/.env
```

At minimum, set these values:

```sh
TELEGRAM_BOT_TOKEN=123456:your_real_bot_token
TELEGRAM_ALLOWED_USER_IDS=123456789
CODEX_CWD=~/Code/your-project
```

Start the bridge:

```sh
codex-telegram-bridge
```

Open your Telegram bot chat and send `/status`. Any normal message after that is sent to Codex as a prompt.

## Configuration File

By default, the CLI reads:

```text
~/.lapage-codex-telegram-bridge/.env
```

A local `.env` in the current working directory is also supported, which is useful for development or per-project overrides.

Use a custom config file with:

```sh
CODEX_TELEGRAM_BRIDGE_ENV=/path/to/.env codex-telegram-bridge
```

## Configuration Options

| Variable | Default | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | required | Telegram bot token from BotFather. |
| `TELEGRAM_ALLOWED_USER_IDS` | required | Comma-separated numeric Telegram user IDs allowed to use the bot. |
| `CODEX_CWD` | current directory | Working directory where Codex starts. `~` is supported. |
| `CODEX_COMMAND` | `codex` | Codex command or binary path. |
| `CODEX_ARGS` | `--search --yolo` | Extra Codex startup arguments. |
| `CODEX_SUBMIT_KEY` | `Enter` | tmux key used to submit a prompt to Codex. |
| `CODEX_SUBMIT_DELAY_MS` | `800` | Delay after pasting text before pressing submit. |
| `CODEX_STARTUP_DELAY_MS` | `1500` | Delay before first prompt if Codex has not produced output yet. |
| `TMUX_SESSION` | `codex-telegram-bridge` | Detached tmux session name. |
| `CODEX_COLS` | `120` | tmux pane width. |
| `CODEX_ROWS` | `40` | tmux pane height. |
| `POLL_INTERVAL_MS` | `500` | How often the bridge polls tmux output. |
| `FLUSH_INTERVAL_MS` | `1200` | Delay before flushing non-stream fallback output. |
| `STREAM_EDIT_INTERVAL_MS` | `650` | Minimum interval between Telegram message edits. |
| `STREAM_MIN_CHANGE_CHARS` | `24` | Minimum text growth before editing mid-response. |
| `TYPING_INTERVAL_MS` | `4000` | How often to send Telegram typing action. |
| `MAX_TELEGRAM_CHARS` | `3500` | Max response chunk size below Telegram's message limit. |

## Telegram Commands

- `/status` — show bridge state, tmux session, working directory, and Codex command.
- `/flush` — force-read and relay the latest Codex response.
- `/interrupt` — send Ctrl-C to Codex.
- `/restart` — restart the Codex tmux session.
- `/stop` — stop the Codex tmux session.
- Any other text is sent directly to Codex as a prompt.

## Running as a Background Service

For a long-running home server setup, run the bridge with your preferred process manager, for example `systemd`, `pm2`, `launchd`, or a persistent `tmux` session.

Example with `tmux`:

```sh
tmux new -s codex-telegram-bridge-runner 'codex-telegram-bridge'
```

Detach from tmux with:

```text
Ctrl-b, then d
```

## Debugging Codex

The bridge itself runs Codex inside another detached `tmux` session. Attach to it with:

```sh
tmux attach -t codex-telegram-bridge
```

If `TMUX_SESSION` is changed in the config file, use that session name instead.

## Install From Source

Use source install if you want to modify or contribute to the bridge:

```sh
git clone https://github.com/zhuylanz/lapage-codex-telegram-bridge.git
cd lapage-codex-telegram-bridge
npm install
cp .env.example .env
npm run dev
```

Build and run locally:

```sh
npm run build
npm start
```

## Development

```sh
npm run typecheck
npm run build
npm run dev
```

## Security Notes

This bridge exposes a local Codex CLI session through Telegram. Treat the bot as remote control for your machine.

Recommended safeguards:

- Only allow trusted Telegram user IDs in `TELEGRAM_ALLOWED_USER_IDS`.
- Do not share your Telegram bot token.
- Run the bridge under a user account with appropriate file permissions.
- Point `CODEX_CWD` at a workspace you are comfortable controlling remotely.
- Understand that `CODEX_ARGS=--yolo` allows Codex to act with fewer confirmations.

## Repository

GitHub: <https://github.com/zhuylanz/lapage-codex-telegram-bridge>
