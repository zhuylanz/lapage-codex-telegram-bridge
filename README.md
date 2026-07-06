# LaPage Codex Telegram Bridge

Control a local **Codex CLI** session from Telegram without opening any inbound ports to the internet.

This package is useful when Codex runs on a home PC, workstation, homelab box, or private server and you want a simple mobile chat interface. The bridge starts `codex app-server` over stdio, receives Telegram messages from an allowlisted user, sends them into Codex, and streams Codex output back to Telegram.

## Why Use This

- No public SSH, HTTP, webhook, tunnel, or reverse proxy is required.
- Telegram provides the outbound connection path from your machine.
- Codex uses the app-server JSON-RPC protocol instead of terminal screen scraping.
- Stdio transport stays local-only and avoids exposing a network listener.
- Access is restricted to the Telegram user IDs you allowlist.

## Requirements

- Node.js 22 or newer
- npm
- Codex CLI available on `PATH`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your numeric Telegram user ID, for example from [@userinfobot](https://t.me/userinfobot)

Check prerequisites:

```sh
node --version
npm --version
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

Private chats get one isolated Codex app-server process and thread per allowed Telegram user. Group chats share one Codex session per group, so allowed users in the same group collaborate in the same Codex context.

In groups, the bot only responds to allowed users when the bot is mentioned, for example `@your_bot inspect this`, or when replying to one of the bot's messages. The bot mention is stripped before the prompt is sent to Codex.

If a user sends another prompt while their Codex turn is still active, the bridge rejects that prompt with a busy message. Send `/interrupt` first if you want to stop the current turn and replace it.

Codex output updates when app-server reports completed items. The bridge keeps a per-turn cache of completed messages, command summaries, and tool summaries, then edits/splits Telegram messages from that cache until the turn completes.

You can also send screenshots, documents, PDFs, videos, audio, or voice notes. The bridge downloads each attachment to `/tmp/codex-telegram-bridge/` with a random filename, includes the local path in the Codex prompt, and attaches images as `localImage` inputs for Codex vision.

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
| `CODEX_APPROVAL_POLICY` | `never` | App-server thread approval policy: `never`, `on-request`, `on-failure`, or `untrusted`. |
| `CODEX_SANDBOX` | `danger-full-access` | App-server thread sandbox: `danger-full-access`, `workspace-write`, or `read-only`. |
| `STREAM_EDIT_INTERVAL_MS` | `650` | Minimum interval between Telegram message edits. |
| `STREAM_MIN_CHANGE_CHARS` | `24` | Minimum text growth before editing mid-response. |
| `TYPING_INTERVAL_MS` | `4000` | How often to send Telegram typing action. |
| `MAX_TELEGRAM_CHARS` | `3500` | Max response chunk size below Telegram's message limit. |

## Telegram Commands

- `/status` — show your bridge state, stdio transport, working directory, and Codex command.
- `/flush` — force-render your completed Codex output.
- `/interrupt` — interrupt your active Codex turn.
- `/restart` — restart your Codex app-server session.
- `/stop` — stop your Codex app-server session.
- Any other text or attachment is sent directly to Codex as a prompt.

## Running as a Background Service

For a long-running home server setup, run the bridge with your preferred process manager, for example `systemd`, `pm2`, or `launchd`.

Example with `pm2`:

```sh
pm2 start codex-telegram-bridge --name codex-telegram-bridge
```

## Debugging Codex

The bridge runs Codex as a child process with stdio JSON-RPC. To inspect protocol behavior directly, run:

```sh
codex app-server --stdio
```

The bridge always starts Codex with `app-server --stdio`; `CODEX_COMMAND` only changes the binary path.

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
- Understand that `CODEX_APPROVAL_POLICY=never` and `CODEX_SANDBOX=danger-full-access` allow Codex to act with fewer confirmations and broader machine access.

## Repository

GitHub: <https://github.com/zhuylanz/lapage-codex-telegram-bridge>
