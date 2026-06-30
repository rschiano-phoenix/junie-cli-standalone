# Guide d'Installation - Trello-Junie Bridge

Ce guide explique comment installer et configurer le bridge entre Trello et Junie CLI.

## Prérequis

- **Docker** et **Docker Compose** (recommandé)
- OU **Node.js 20+** et **Git** installés sur le serveur.
- Une **Clef API Junie** (récupérable sur [junie.jetbrains.com/cli](https://junie.jetbrains.com/cli)).
- Des identifiants **Trello** (API Key, Token, Secret).

---

## Méthode 1 : Docker (Recommandé)

C'est la méthode la plus simple car elle inclut toutes les dépendances (Junie CLI, Git, etc.).

1. **Cloner le projet** sur votre serveur.
2. **Configurer l'environnement** :
   Copiez le fichier d'exemple et remplissez-le.
   ```bash
   cp .docker/.env.example .env
   ```
   Éditez `.env` avec vos informations (notamment `JUNIE_API_KEY` et `TRELLO_CALLBACK_URL`).

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
    "doneListId": "ID_LISTE_DE_FIN",
    "key": "CLEF_TRELLO_SPECIFIQUE",
    "token": "TOKEN_TRELLO_SPECIFIQUE",
    "secret": "SECRET_WEBHOOK_TRELLO",
    "callbackUrl": "https://votre-domaine.com/webhook"
  },
  "repos": [
    "git@github.com:votre-compte/votre-repo.git"
  ]
}
```

---

## Création du Webhook Trello

Pour que Trello envoie les événements au bridge, vous devez créer un webhook manuellement (une seule fois par projet) :

```bash
curl -X POST -H "Content-Type: application/json" \
  "https://api.trello.com/1/webhooks/?key=VOTRE_TRELLO_KEY&token=VOTRE_TRELLO_TOKEN" \
  -d '{
    "description": "Junie Bridge Webhook",
    "callbackURL": "https://votre-domaine.com/webhook",
    "idModel": "ID_LISTE_A_SURVEILLER"
  }'
```

Le bridge validera automatiquement la signature HMAC du webhook lors de la réception des événements.
