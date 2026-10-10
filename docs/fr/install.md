[English](../en/install.md) | **Français** · [Retour au README](README.md)

# Installation manuelle

## Depuis la release

1. Télécharge le `.dmg` depuis la [dernière release](https://github.com/clementp0/llm-task-bench/releases/latest) : `arm64` pour les Mac Apple Silicon (M1 et suivants), `x64` pour les Mac Intel.
2. Ouvre-le et glisse LLM Task Bench dans Applications.
3. La première fois, fais un clic droit sur l'app et choisis **Ouvrir**. L'app n'est pas signée par Apple, macOS demande donc une seule fois.

## Prérequis

- macOS et `git`.
- Au moins un de ces outils :
  - [Claude Code](https://claude.com/claude-code), connecté.
  - [OpenCode](https://opencode.ai). Ajoute des fournisseurs (OpenRouter, OpenAI, Mistral…) avec `opencode auth login`.

## Depuis les sources

Nécessite Node.js 20 ou plus.

```bash
git clone https://github.com/clementp0/llm-task-bench.git
cd llm-task-bench
npm install
npm start          # lancer en développement
npm test           # vérification du moteur
npm run dist       # construire dist/*.dmg
```

Icône perso : place un PNG de 1024×1024 dans `build/icon.png` avant `npm run dist`.
