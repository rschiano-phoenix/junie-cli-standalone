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

4. **Récupérer l'ID du Tableau (Board ID) et des Listes** :
   - **Méthode Tableau (URL .json)** : 
     1. Ouvrez votre tableau Trello dans votre navigateur.
     2. Ajoutez `.json` à la fin de l'URL (ex: `https://trello.com/b/abc/mon-tableau.json`) et appuyez sur Entrée.
     3. L'ID du tableau est la valeur du champ `"id"` tout au début du fichier.
     4. Pour les listes, cherchez (Ctrl+F) le nom de votre liste (ex: "À faire") pour trouver son `"id"`.
   - **Méthode Carte (URL .json)** :
     1. Ouvrez n'importe quelle carte située dans la liste que vous voulez identifier.
     2. Ajoutez `.json` à la fin de l'URL dans la barre d'adresse et appuyez sur Entrée.
     3. Cherchez (Ctrl+F) le champ `"idList"`. La valeur associée est l'ID de la liste.

5. **Utilisation des noms de listes (Recommandé)** :
   Le bridge peut maintenant identifier les listes par leur nom. Si vous utilisez les noms suivants, aucune configuration d'ID de liste n'est nécessaire (seul le `boardId` est requis dans votre projet) :
   - Cible (déclenche Junie) : **"A développer"**
   - En cours (pendant le travail) : **"En cours"**
   - Succès (déplacement après Junie) : **"Réalisé"**
   - Échec (déplacement si erreur) : **"Bloqué"**

---

## Workflow Automatisé

Le bridge suit un workflow précis pour chaque ticket :
1. **Trigger** : Vous déplacez une carte dans la colonne **"A développer"**.
2. **Initialisation** : Le bridge déplace la carte dans **"En cours"** et ajoute un commentaire avec le plan de réalisation (dépôts ciblés, branche).
3. **Exécution** : Le bridge prépare le code (clone/branche) et lance Junie CLI.
4. **Finalisation** :
   - Si succès : La carte est déplacée dans **"Réalisé"** avec un résumé des métriques (coût/tokens).
   - Si erreur : La carte est déplacée dans **"Bloqué"** avec le détail de l'erreur rencontrée.

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
    "boardId": "ID_DU_TABLEAU",
    "targetListName": "A développer",
    "inProgressListName": "En cours",
    "doneListName": "Réalisé",
    "blockedListName": "Bloqué"
  },
  "repos": [
    "git@github.com:votre-compte/votre-repo.git"
  ]
}
```

La configuration Trello est volontairement séparée :
- **Global (`.env`)** : `TRELLO_KEY`, `TRELLO_SECRET`, `TRELLO_CALLBACK_URL` et le token sauvegardé automatiquement dans `.trello_token`, car ils décrivent l'intégration Trello et le serveur.
- **Projet (`projects/*.json`)** : `boardId`, `targetListName`, `doneListName`, `failListName`, `repos`, et éventuellement `junieApiKey` si un projet doit utiliser une clé Junie différente. 

> **Note sur les IDs** : Vous pouvez toujours utiliser `targetListId`, `doneListId` et `failListId` si vous préférez figer la configuration sur des IDs techniques.

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
