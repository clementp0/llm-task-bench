[English](../../README.md) | **Français**

# LLM Task Bench

Petite app Mac pour comparer les modèles d'IA que vous utilisez déjà, sur vos propres tâches.

Un prompt, plusieurs modèles : l'app indique pour chacun s'il a réussi, le temps, les tokens consommés et le coût.

Fonctionne avec Claude Code et OpenCode, donc avec tous les modèles déjà accessibles depuis ces outils (OpenRouter compris). Pas de clé d'API à saisir.

**[Télécharger la dernière version](https://github.com/clementp0/llm-task-bench/releases/latest)** · [Installation manuelle](install.md)

_Exemple : La même tâche FizzBuzz envoyée à 17 modèles. Le script doit s'exécuter et afficher « FizzBuzz » à la ligne 15.

<img width="1392" height="914" alt="image" src="https://github.com/user-attachments/assets/66122873-6f8a-4fc9-937a-4ffb4b492a8e" />

## Fonctionnalités :

- Détection des fournisseurs installés.
- Choix des modèles à tester.
- Travail sur une copie du projet, l'original n'est pas modifié.
- Fichiers produits par chaque modèle consultables (fichiers, captures…).
- MCP fournis : Figma, Playwright, Chrome DevTools, Shopify Dev, Context7. Possibilité d'ajouter les vôtres.
- Les modèles en erreur ou sans crédits sont mis à part et ne faussent pas le classement.

## Réussite

Par défaut, un essai est réussi s'il se termine sans erreur. Deux vérifications optionnelles :

- un texte que la réponse doit contenir ;
- une commande shell lancée dans le dossier du projet après l'essai, qui doit renvoyer 0. Exemple : `! grep -rEq '#[0-9a-fA-F]{6}' assets` échoue s'il reste des couleurs en dur.

Chaque modèle reçoit un score sur 100 selon son taux de réussite, son temps et son coût.

## Licence

MIT, voir [LICENSE](../../LICENSE).

## Traductions

Les pull requests sont les bienvenues.

- **App** : copier `locales/en.json` en `locales/<code>.json`, traduire, renseigner `_name`. Les clés manquantes s'affichent en anglais.
- **Docs** : copier `docs/en/` en `docs/<code>/`, traduire, puis ajouter la langue dans la ligne de sélection en haut de chaque page.
