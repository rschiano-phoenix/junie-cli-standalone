# Guide d'Installation - Trello-Junie Bridge

Ce guide explique comment installer et configurer le bridge entre Trello et Junie CLI.

## Prérequis

- **Docker** et **Docker Compose** (recommandé)
- OU **Node.js 20+** et **Git** installés sur le serveur.
- Une **Clef API Junie** (récupérable sur [junie.jetbrains.com/cli](https://junie.jetbrains.com/cli)).
- Des identifiants **Trello** (API Key, Secret) - *Voir section dédiée ci-dessous*.

---

## Obtenir les identifiants Trello

Trello a migré la gestion de ses clés API vers le portail des Power-Ups. Voici comment obtenir vos accès :

1. **Créer un Power-Up** :
   - Rendez-vous sur le [Power-Up Admin Portal](https://trello.com/power-ups/admin).
   - Cliquez sur **Nouveau Power-Up**.
   - Donnez-lui un nom (ex: `Junie Bridge`), choisissez votre Workspace et cliquez sur **Créer**.

2. **Récupérer la Clé (Key) et le Secret** :
   - Dans le menu de gauche, allez dans l'onglet **Clé API**.
   - Cliquez sur **Générer une nouvelle clé API**.
   - Vous y trouverez votre **Clé** (Key) et votre **Secret** (utilisé pour sécuriser les webhooks).

3. **Générer et Enregistrer le Token Automatiquement** :
   - Assurez-vous que votre serveur est lancé et que `TRELLO_KEY` est renseignée dans votre `.env`.
   - Rendez-vous sur `http://votre-serveur:3000/` (ou `/auth/trello`).
   - Autorisez l'accès. Le token sera automatiquement récupéré et sauvegardé sur votre serveur dans un fichier `.trello_token`. Vous n'avez plus besoin de le configurer manuellement.

---

## Méthode 1 : Docker (Recommandé)

C'est la méthode la plus simple car elle inclut toutes les dépendances (Junie CLI, Git, etc.).

1. **Cloner le projet** sur votre serveur.
2. **Configurer l'environnement** :
   Copiez le fichier d'exemple et remplissez-le.
   ```bash
   cp .docker/.env.example .env
   ```
   Éditez `.env` avec vos informations globales (`TRELLO_KEY`, `TRELLO_SECRET`, `TRELLO_CALLBACK_URL`, `JUNIE_API_KEY`).
   
   > **Note sur `TRELLO_CALLBACK_URL`** : Ce n'est pas une valeur fournie par Trello, mais l'URL **publique** de votre serveur bridge. Elle doit impérativement se terminer par `/webhook` (ex: `https://mon-domaine.com/webhook`). Si vous testez localement, utilisez **ngrok** pour obtenir une URL publique.
   Vous pouvez également activer le mode simulation en ajoutant `DRY_RUN=true`.

3. **Lancer le service** :
   ```bash
   docker compose -f .docker/docker-compose.yml up -d --build
   ```

Le bridge est maintenant accessible sur le port `3000`.

---

## Méthode 2 : Installation Manuelle (Systemd)

Si vous préférez ne pas utiliser Docker :

1. **Installer les dépendances** :
   ```bash
   npm install
   ```
2. **Installer Junie CLI** :
   Suivez les instructions sur le site officiel de Junie.
3. **Configurer le fichier .env** à la racine.
4. **Configurer Systemd** :
   - Adaptez le fichier `trello-junie.service` (chemins, utilisateur).
   - Copiez-le dans `/etc/systemd/system/`.
   - Activez-le :
     ```bash
     sudo systemctl enable trello-junie
     sudo systemctl start trello-junie
     ```

---

## Configuration d'un Projet

Chaque projet que vous souhaitez automatiser doit avoir son fichier JSON dans le dossier `projects/`.

Exemple `projects/mon-projet.json` :
```json
{
  "name": "Mon Projet",
  "trello": {
    "targetListId": "ID_LISTE_A_SURVEILLER",
    "doneListId": "ID_LISTE_DE_FIN"
  },
  "repos": [
    "git@github.com:votre-compte/votre-repo.git"
  ]
}
```

La configuration Trello est volontairement séparée :
- **Global (`.env`)** : `TRELLO_KEY`, `TRELLO_SECRET`, `TRELLO_CALLBACK_URL` et le token sauvegardé automatiquement dans `.trello_token`, car ils décrivent l'intégration Trello et le serveur.
- **Projet (`projects/*.json`)** : `targetListId`, `doneListId`, `repos`, et éventuellement `junieApiKey` si un projet doit utiliser une clé Junie différente. `doneListId` est recommandé ; s'il est absent, la carte sera commentée mais pas déplacée après succès.
- **Exception** : `key`, `secret` et `callbackUrl` peuvent encore être placés dans un projet pour un cas multi-Power-Up, mais ce n'est pas le mode recommandé.

---

## Création du Webhook Trello

Pour que Trello envoie les événements au bridge, vous devez créer un webhook manuellement (une seule fois par projet) :

```bash
curl -X POST -H "Content-Type: application/json" \
  "https://api.trello.com/1/webhooks/?key=VOTRE_TRELLO_KEY&token=VOTRE_TOKEN" \
  -d '{
    "description": "Junie Bridge Webhook",
    "callbackURL": "https://votre-domaine.com/webhook",
    "idModel": "ID_LISTE_A_SURVEILLER"
  }'
```

Le bridge validera automatiquement la signature HMAC du webhook lors de la réception des événements.
