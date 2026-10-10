**English** | [Français](docs/fr/README.md)

# LLM Task Bench

Small Mac app to compare the AI models you already use, on your own tasks.

One prompt, several models: for each one the app shows whether it succeeded, the time, the tokens used and the cost.

Works with Claude Code and OpenCode, so with every model already available through those tools (OpenRouter included). No API keys to enter.

**[Download the latest version](https://github.com/clementp0/llm-task-bench/releases/latest)** · [Manual installation](docs/en/install.md)

Same FizzBuzz task sent to 17 models. The script has to run and print "FizzBuzz" on line 15.
<img width="1392" height="914" alt="image" src="https://github.com/user-attachments/assets/66122873-6f8a-4fc9-937a-4ffb4b492a8e" />

## Features:

- Detects installed providers.
- Choose the models to test.
- Works on a copy of the project, the original is left untouched.
- Output of each model available (files, screenshots…).
- MCP provided: Figma, Playwright, Chrome DevTools, Shopify Dev, Context7. You can add your own.
- Models that error out or have no credits are set aside and don't affect the ranking.

## Success

By default, an attempt succeeds if it finishes without error. Two optional checks:

- some text the answer must contain;
- a shell command run in the project folder after the attempt, which must exit 0. Example: `! grep -rEq '#[0-9a-fA-F]{6}' assets` fails if hard-coded colors are left.

Each model gets a score out of 100 based on success rate, time and cost.

## License

MIT, see [LICENSE](LICENSE).

## Translations

Pull requests welcome.

- **App**: copy `locales/en.json` to `locales/<code>.json`, translate, set `_name`. Missing keys fall back to English.
- **Docs**: copy `docs/en/` to `docs/<code>/`, translate, then add the language to the switcher line at the top of each page.
