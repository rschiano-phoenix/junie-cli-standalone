# Trello-Junie Bridge

Ce projet est un service Node.js autonome qui fait le pont entre les tickets Trello et Junie CLI. Il permet d'automatiser le développement en déclenchant Junie lorsqu'une carte est déplacée dans une colonne spécifique.

## Fonctionnalités Clés

- **Multi-projets** : Gérez plusieurs projets Trello et dépôts Git depuis une seule instance.
- **Workflow Git Automatisé** : Clonage automatique, passage sur `develop`, et création de branches dédiées (`trello-ticket-ID`).
- **Déploiement en Review** : Déclenchement automatique de GitHub Actions pour déployer des environnements de review.
- **Isolation via Workspace** : Chaque tâche s'exécute dans un environnement propre et nettoyé automatiquement.
- **Reporting Trello** : Rapport automatique de consommation (coût/tokens) posté en commentaire du ticket une fois terminé.
- **Sécurité** : Validation systématique des signatures de webhooks Trello (HMAC-SHA1).
- **Prêt pour la Production** : Support Docker et Systemd.

## Documentation

- [**Guide d'Installation**](INSTALLATION.md) : Comment mettre en place le bridge sur votre serveur.
- [**Configuration d'un Projet**](PROJECT_SETUP.md) : Comment ajouter et configurer un nouveau projet.
- [**Documentation Technique**](ARCHITECTURE.md) : Comprendre le rôle des différents composants et l'architecture du code.

## Licence

MIT
