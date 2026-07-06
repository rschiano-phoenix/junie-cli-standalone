# Configuration d'un Nouveau Projet

Ce guide détaille les étapes nécessaires pour ajouter un nouveau projet au Trello-Junie Bridge.

## 1. Créer le fichier de configuration

Chaque projet doit avoir son propre fichier JSON dans le dossier `projects/`. Le nom du fichier servira d'identifiant interne.

Créez par exemple `projects/mon-nouveau-projet.json` :

```json
{
  "name": "Mon Nouveau Projet",
  "baseBranch": "develop",
  "trello": {
    "boardId": "ID_DU_TABLEAU_TRELLO",
    "targetListName": "A développer",
    "improveListName": "A reprendre",
    "reviewListName": "À déployer en review",
    "inProgressListName": "En cours",
    "doneListName": "Réalisé",
    "deployedListName": "Déployé",
    "blockedListName": "Bloqué"
  },
  "repos": [
    "git@github.com:organisation/repo-api.git",
    "git@github.com:organisation/repo-front.git"
  ]
}
```

### Paramètres clés :
- `name` : Nom affiché dans les logs et les commentaires.
- `baseBranch` : La branche sur laquelle Junie doit se baser et où les changements seront poussés.
- `trello.boardId` : L'ID technique du tableau Trello (voir [Installation](INSTALLATION.md#obtenir-les-identifiants-trello)).
- `trello.*ListName` : Le nom des colonnes Trello. Si vous utilisez les noms par défaut ci-dessus, le bridge les reconnaîtra automatiquement.
- `repos` : Liste des dépôts Git à cloner et sur lesquels Junie ou les déploiements de review s'exécuteront.

## 2. Configurer les Webhooks Trello

Pour que le bridge réagisse aux mouvements de cartes, vous devez enregistrer des webhooks auprès de Trello.

### Option A : Utiliser les logs de démarrage (Recommandé)

1. Redémarrez le bridge (ou lancez-le en mode `DRY_RUN=true`).
2. Le bridge détectera le nouveau projet et affichera dans la console les commandes `curl` prêtes à l'emploi.
3. Copiez et exécutez ces commandes dans votre terminal.

### Option B : Création manuelle

Exécutez les trois commandes suivantes pour créer les webhooks nécessaires auprès de Trello. Remplacez `VOTRE_TRELLO_KEY`, `VOTRE_TRELLO_TOKEN`, `ID_DU_TABLEAU` et `https://votre-serveur.com` par vos valeurs réelles.

**1. Webhook Initial (A développer)** :
```bash
curl -X POST -H "Content-Type: application/json" \
  "https://api.trello.com/1/webhooks/?key=VOTRE_TRELLO_KEY&token=VOTRE_TRELLO_TOKEN" \
  -d '{
    "description": "Junie Bridge Initial - Mon Projet",
    "callbackURL": "https://votre-serveur.com/webhook",
    "idModel": "ID_DU_TABLEAU"
  }'
```

**2. Webhook Amélioration (A reprendre)** :
```bash
curl -X POST -H "Content-Type: application/json" \
  "https://api.trello.com/1/webhooks/?key=VOTRE_TRELLO_KEY&token=VOTRE_TRELLO_TOKEN" \
  -d '{
    "description": "Junie Bridge Improve - Mon Projet",
    "callbackURL": "https://votre-serveur.com/webhook/improve",
    "idModel": "ID_DU_TABLEAU"
  }'
```

**3. Webhook Review (À déployer en review)** :
```bash
curl -X POST -H "Content-Type: application/json" \
  "https://api.trello.com/1/webhooks/?key=VOTRE_TRELLO_KEY&token=VOTRE_TRELLO_TOKEN" \
  -d '{
    "description": "Junie Bridge Review - Mon Projet",
    "callbackURL": "https://votre-serveur.com/webhook/review",
    "idModel": "ID_DU_TABLEAU"
  }'
```

## 3. Prérequis Git

Assurez-vous que le serveur a bien accès aux dépôts configurés :
- Si vous utilisez SSH, la clé publique doit être ajoutée aux "Deploy Keys" sur GitHub/GitLab.
- Le serveur doit avoir les droits d'écriture (Push) sur la branche de base.

## 4. Redémarrage

Après avoir ajouté le fichier `.json` dans `projects/`, vous devez redémarrer le service pour qu'il initialise les dépôts dans le workspace :

```bash
# Si Docker
docker compose -f .docker/docker-compose.yml restart

# Si Systemd
sudo systemctl restart trello-junie
```

Le bridge va cloner automatiquement les nouveaux dépôts dans le dossier `workspace/` au démarrage.
