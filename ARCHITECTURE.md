# Documentation Technique - Architecture du Bridge

Ce document explique l'organisation du code et le rôle de chaque composant du projet Trello-Junie Bridge.

## Structure Globale

```text
.
├── projects/           # Fichiers de configuration JSON par projet
├── workspace/          # Dossier temporaire pour les clones Git (éphémère)
├── .docker/            # Configuration Docker (Dockerfile, Compose)
├── src/                # Code source modulaire
│   ├── config/         # Configuration et variables d'environnement
│   ├── services/       # Logique métier isolée par domaine
│   ├── controllers/    # Gestionnaires de requêtes et orchestration
│   └── app.js          # Configuration de l'application Express
└── server.js           # Point d'entrée du serveur
```

## Rôle des Éléments

### 1. Point d'entrée (`server.js`)
Initialise le serveur Express et écoute sur le port configuré. C'est le fichier à lancer pour démarrer l'application.

### 2. Services (`src/services/`)
Les services encapsulent la logique métier pour chaque intégration externe :

- **`project.service.js`** : Charge et gère les fichiers de configuration situés dans le dossier `projects/`. Il permet de retrouver quel projet est concerné par un webhook Trello.
- **`trello.service.js`** : Gère toute la communication avec l'API Trello (récupérer une carte, la déplacer, ajouter un commentaire) et la vérification de la signature HMAC pour la sécurité.
- **`git.service.js`** : Responsable des opérations Git. Il nettoie le workspace, clone les dépôts, se place sur la branche `develop` et crée une branche spécifique pour le ticket Trello.
- **`junie.service.js`** : Orchestre l'exécution de Junie CLI via des sous-processus. Il capture la sortie pour extraire les métriques de consommation (coût, tokens).

### Mode Dry Run

Si la variable d'environnement `DRY_RUN` est définie à `true`, le bridge simulera les opérations Git, Junie et Trello (déplacement de cartes, ajout de commentaires) sans les exécuter réellement. Les commandes et actions prévues seront affichées dans les logs du serveur. C'est idéal pour tester la configuration sans modifier vos dépôts ou vos tableaux Trello.

### 3. Contrôleurs (`src/controllers/`)
Les contrôleurs orchestrent les services pour répondre aux requêtes entrantes :

- **`webhook.js`** : Reçoit les webhooks Trello. Il valide la signature, prépare le code source via `GitService`, lance Junie via `JunieService` et met à jour Trello via `TrelloService`.
- **`auth.js`** : Gère le flux d'authentification Trello. Il fournit une interface simple pour générer le `TRELLO_TOKEN` nécessaire à l'application.

### 4. Configuration (`src/config/config.js`)
Centralise toutes les variables d'environnement (`.env`), charge le token Trello persistant (`.trello_token`) et définit les chemins absolus pour éviter les erreurs de contexte lors de l'exécution (notamment sous Docker).

La règle de placement est la suivante :
- **Configuration globale** : clés d'intégration et paramètres du serveur (`TRELLO_KEY`, `TRELLO_SECRET`, `TRELLO_CALLBACK_URL`, `JUNIE_API_KEY`, `PORT`, `DRY_RUN`).
- **Configuration projet** : listes Trello à surveiller/destination, dépôts Git et éventuelle surcharge `junieApiKey`.
- **Compatibilité avancée** : les champs Trello `key`, `secret` et `callbackUrl` restent supportés au niveau projet pour gérer plusieurs Power-Ups, mais ils ne sont pas nécessaires dans le cas standard.

### 5. Dossier `projects/`
Contient les définitions des projets. Le bridge est multi-projets : chaque fichier `.json` définit un mapping entre une liste Trello et un ou plusieurs dépôts Git. Au démarrage, le serveur parcourt tous ces fichiers pour initialiser les espaces de travail correspondants.

### 6. Dossier `workspace/`
Utilisé comme zone de travail temporaire. Lors de l'initialisation du serveur, tous les dépôts des projets configurés sont clonés ici. À chaque nouveau ticket, le bridge nettoie le dossier spécifique du projet et repart d'un clone propre pour éviter les conflits de fichiers.

## Flux de Données

1. **Initialisation** : Au lancement (`server.js`), le `ProjectService` appelle `GitService` pour cloner tous les dépôts définis dans `projects/` sur leur branche par défaut (`develop`).
2. **Trello** envoie un `POST /webhook`.
3. **`app.js`** capture le corps brut pour la validation.
4. **`WebhookController`** identifie le projet.
5. **`GitService`** prépare le code source dans `workspace/`.
6. **`JunieService`** traite la demande.
7. **`TrelloService`** met à jour le ticket.
