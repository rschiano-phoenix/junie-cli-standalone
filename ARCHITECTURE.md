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

### 3. Contrôleur (`src/controllers/webhook.controller.js`)
C'est le "cerveau" du projet. Il reçoit les webhooks Trello et coordonne les services :
1. Valide la signature de la requête.
2. Vérifie si le projet n'est pas déjà en cours de traitement (système de verrouillage).
3. Prépare les dépôts Git via le `GitService`.
4. Lance Junie sur chaque dépôt via le `JunieService`.
5. Poste le résumé consolidé sur Trello et déplace la carte via le `TrelloService`.

### 4. Configuration (`src/config/config.js`)
Centralise toutes les variables d'environnement (`.env`) et définit les chemins absolus pour le projet afin d'éviter les erreurs de contexte lors de l'exécution (notamment sous Docker).

### 5. Dossier `projects/`
Contient les définitions des projets. Le bridge est multi-projets : chaque fichier `.json` définit un mapping entre une liste Trello et un ou plusieurs dépôts Git.

### 6. Dossier `workspace/`
Utilisé comme zone de travail temporaire. À chaque nouveau ticket, le bridge supprime le contenu lié au projet et repart d'un clone propre pour éviter les conflits de fichiers.

## Flux de Données

1. **Trello** envoie un `POST /webhook`.
2. **`app.js`** capture le corps brut pour la validation.
3. **`WebhookController`** identifie le projet.
4. **`GitService`** prépare le code source dans `workspace/`.
5. **`JunieService`** traite la demande.
6. **`TrelloService`** met à jour le ticket.
