const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { maskSecret, getCallbackUrl } = require('../utils/format');

class ProjectService {
    constructor() {
        this.projectsDir = config.PATHS.PROJECTS_DIR;
        this.ensureDirectoryExists();
    }

    ensureDirectoryExists() {
        if (!fs.existsSync(this.projectsDir)) {
            fs.mkdirSync(this.projectsDir, { recursive: true });
        }
    }

    loadProjects() {
        const projects = [];
        if (fs.existsSync(this.projectsDir)) {
            const files = fs.readdirSync(this.projectsDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(this.projectsDir, file), 'utf8');
                        const projectConfig = JSON.parse(content);
                        if (projectConfig.trello) {
                            projects.push(projectConfig);
                        }
                    } catch (e) {
                        console.error(`Error loading project ${file}:`, e.message);
                    }
                }
            });
        }
        return projects;
    }

    logWebhookCommand(project) {
        const creds = config.getTrelloCredentials(project);
        const idModel = project.trello?.boardId || project.trello?.targetListId;
        
        const key = creds.key ? maskSecret(creds.key) : '<VOTRE_TRELLO_KEY>';
        const token = creds.token ? maskSecret(creds.token) : '<VOTRE_TRELLO_TOKEN>';
        const initialUrl = getCallbackUrl(creds.callbackUrl, 'initial');
        const improveUrl = getCallbackUrl(creds.callbackUrl, 'improve');

        console.log(`[Dry Run] [Projet: ${project.name || 'Inconnu'}] Commandes pour créer les webhooks Trello :`);
        console.log('[Dry Run] Les secrets sont masqués dans les logs. Remplacez les valeurs TRELLO_KEY/TRELLO_TOKEN si vous copiez cette commande.');
        
        console.log(`1. Webhook Initial (A développer) :`);
        console.log(`curl -X POST -H "Content-Type: application/json" \\
  "https://api.trello.com/1/webhooks/?key=${key}&token=${token}" \\
  -d '{
    "description": "Junie Bridge Initial - ${project.name || 'Projet'}",
    "callbackURL": "${initialUrl}",
    "idModel": "${idModel || '<ID_DU_TABLEAU_OU_DE_LA_LISTE>'}"
  }'`);

        console.log(`2. Webhook Amélioration (A reprendre) :`);
        console.log(`curl -X POST -H "Content-Type: application/json" \\
  "https://api.trello.com/1/webhooks/?key=${key}&token=${token}" \\
  -d '{
    "description": "Junie Bridge Improve - ${project.name || 'Projet'}",
    "callbackURL": "${improveUrl}",
    "idModel": "${idModel || '<ID_DU_TABLEAU_OU_DE_LA_LISTE>'}"
  }'`);
        console.log('------------------------------------------------------------');
    }

    async initializeProjects(gitService) {
        console.log(`[${new Date().toISOString()}] Initialisation des espaces de travail des projets...`);
        const projects = this.loadProjects();
        
        for (const project of projects) {
            const projectKey = project.name || project.trello.boardId || 'unknown';
            const baseBranch = project.baseBranch || 'develop';

            if (config.DRY_RUN) {
                this.logWebhookCommand(project);
            }

            const projectWorkspace = gitService.getProjectWorkspace(projectKey);
            
            console.log(`[Init] Configuration du projet : ${projectKey}`);
            
            for (const repoUrl of (project.repos || [])) {
                // Pour l'initialisation, on se contente de préparer le repo sur la branche de base
                // On utilise setupRepo avec branchName = baseBranch pour éviter de créer une branche trello/xxx inutile
                await gitService.setupRepo(repoUrl, projectWorkspace, baseBranch, baseBranch);
            }
        }
        console.log(`[${new Date().toISOString()}] Initialisation terminée.`);
    }
}

module.exports = new ProjectService();
