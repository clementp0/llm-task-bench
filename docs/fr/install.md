[English](../en/install.md) | **Français** · [Retour au README](README.md)

# Installation manuelle

## Depuis la release

1. Téléchargez le `.dmg` depuis la [dernière release](https://github.com/clementp0/llm-task-bench/releases/latest) : `arm64` pour les Mac Apple Silicon (M1 et suivants), `x64` pour les Mac Intel.
2. Ouvrez-le et glissez LLM Task Bench dans Applications.
3. Ouvrez l'app une fois. macOS la bloque car elle n'est pas notarisée par Apple : allez dans **Réglages Système → Confidentialité et sécurité**, descendez et cliquez sur **Ouvrir quand même**. Nécessaire uniquement la première fois.

   Ou depuis un terminal :

   ```bash
   xattr -dr com.apple.quarantine "/Applications/LLM Task Bench.app"
   ```

## Prérequis

- macOS et `git`.
- Au moins un de ces outils :
  - [Claude Code](https://claude.com/claude-code), connecté.
  - [OpenCode](https://opencode.ai). Ajoutez des fournisseurs (OpenRouter, OpenAI, Mistral…) avec `opencode auth login`.

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

Icône perso : placez un PNG de 1024×1024 dans `build/icon.png` avant `npm run dist`.
