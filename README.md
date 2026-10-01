<p align="center">
  <img src="resources/volante-icon.png" width="128" alt="Volante" />
</p>

<h1 align="center">Volante</h1>

<p align="center"><b>One private hub between your AI apps and your MCP servers.</b></p>

<p align="center">
  <a href="https://github.com/Be-Aesthetics/volante/stargazers"><img src="https://img.shields.io/github/stars/Be-Aesthetics/volante?style=social" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://github.com/Be-Aesthetics/volante/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Be-Aesthetics/volante/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="https://github.com/Be-Aesthetics/volante/releases/latest"><img src="https://img.shields.io/github/v/release/Be-Aesthetics/volante?label=release&color=fc3a1e" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Be-Aesthetics/volante?color=0d0d0d" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-0d0d0d" alt="Platform: Windows | macOS" />
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-fc3a1e" alt="MCP compatible" /></a>
</p>

<p align="center">
  <a href="https://github.com/Be-Aesthetics/volante/releases/latest">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="https://github.com/Be-Aesthetics/volante/issues">Issues</a>
</p>

<br />

<p align="center">
  <img src="docs/screenshot.png" alt="Volante home screen" />
</p>

## How it works

Volante is a desktop app that runs a single [MCP](https://modelcontextprotocol.io) endpoint on your computer.

1. **Add your servers once.** Webflow, GitHub, a browser, your files, anything that speaks MCP.
2. **Connect your AI apps once.** Claude Code, Claude Desktop, Cursor, VS Code and others, in one click each.
3. **Ask your AI.** Every app can now use every server, with the permissions you choose, and every request shows up in Volante's activity log.

## Features

- **Any MCP server.** Local commands, remote Streamable HTTP or SSE servers. Servers that use OAuth sign in through your browser.
- **Several Webflow workspaces.** Add each workspace by name; each gets its own sign-in, its own tool prefix and its own permissions, so your AI always knows which workspace it is working in.
- **Permissions per server.** *Allow everything*, *Look only*, *No deleting* or *Choose tools*, with a switch per tool on top. Tools are tagged as reads, changes or deletes, from the server's own annotations or, failing that, from the tool name.
- **No name clashes.** Tools are prefixed per server (`webflow_acme__list_sites`, `github__create_issue`).
- **One-click connect** for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI and Codex, plus import of the servers those apps already have. Each app's config file is backed up (`*.volante.bak`) before its first edit.
- **Activity log** of every request: arguments, result, duration and which app asked.
- **Stays out of the way.** Lives in the system tray or menu bar, can start when you sign in, and the stdio bridge starts it on demand for apps that launch MCP servers as processes.

## Install

Grab the installer for your system from the [latest release](https://github.com/Be-Aesthetics/volante/releases/latest).

| System | File |
| --- | --- |
| Windows 10 / 11 | `Volante-Setup-<version>.exe` |
| macOS, Apple Silicon (M1 and later) | `Volante-<version>-arm64.dmg` |
| macOS, Intel | `Volante-<version>-x64.dmg` |

The installers aren't code-signed yet, so the first launch needs one extra step:

- **Windows:** if SmartScreen appears, choose **More info → Run anyway**.
- **macOS:** open the app once, then go to **System Settings → Privacy & Security** and click **Open Anyway** next to the message about Volante.

## Security

- Listens on `127.0.0.1` only, behind a bearer token, and rejects requests with a foreign `Host` or `Origin` header.
- Environment variables, headers and OAuth tokens are encrypted at rest by the operating system (DPAPI on Windows, the Keychain on macOS).
- Nothing is sent anywhere except to the MCP servers you add.

## How apps connect

| App | Transport |
| --- | --- |
| Claude Code, Cursor, VS Code, Windsurf, Gemini CLI | Streamable HTTP to `http://127.0.0.1:47900/mcp` with `Authorization: Bearer <token>` |
| Claude Desktop, Codex | Volante's own executable in Node mode as a stdio bridge (`out/main/bridge.js`) |

## Build from source

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with live reload |
| `npm run typecheck` | Type-check the main process and the UI |
| `npm run build` | Bundle into `out/` |
| `npm run dist` | Build the Windows installer into `release/` |
| `npm run dist:mac` | Build the macOS installers into `release/` (run on a Mac) |
| `npm run icons` | Re-render the app and tray icons |

Pushing a tag like `v1.0.0` builds both installers on GitHub Actions and attaches them to a draft release.

`ROUTER_DATA_DIR=<folder>` runs against a separate config folder, which is handy for testing. `scripts/smoke-test.cjs` checks a running instance end to end against `scripts/fixture-server.cjs`.

## Credits

Built with [Electron](https://www.electronjs.org), [React](https://react.dev), the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [Iconoir](https://iconoir.com) icons.

Fonts: [Inter Tight](https://github.com/rsms/inter-tight) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), bundled under the SIL Open Font License 1.1 (see `src/renderer/src/fonts/`).

## License

[MIT](LICENSE) © BE Aesthetics
