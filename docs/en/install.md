**English** | [Français](../fr/install.md) · [Back to README](../../README.md)

# Manual installation

## From the release

1. Download the `.dmg` from the [latest release](https://github.com/clementp0/llm-task-bench/releases/latest): `arm64` for Apple Silicon (M1 and later), `x64` for Intel Macs.
2. Open it and drag LLM Task Bench to Applications.
3. The first time, right-click the app and choose **Open**. The app isn't signed by Apple, so macOS asks once.

## Requirements

- macOS and `git`.
- At least one of:
  - [Claude Code](https://claude.com/claude-code), signed in.
  - [OpenCode](https://opencode.ai). Add providers (OpenRouter, OpenAI, Mistral…) with `opencode auth login`.

## From source

Needs Node.js 20 or later.

```bash
git clone https://github.com/clementp0/llm-task-bench.git
cd llm-task-bench
npm install
npm start          # run in development
npm test           # engine self-check
npm run dist       # build dist/*.dmg
```

Custom icon: put a 1024×1024 PNG in `build/icon.png` before `npm run dist`.
