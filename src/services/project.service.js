const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { maskSecret } = require('../utils/format');

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
        const callbackUrl = creds.callbackUrl || '<VOTRE_TRELLO_CALLBACK_URL>';

        console.log(`[Dry Run] [Projet: ${project.name || 'Inconnu'}] Commande pour créer le webhook Trello :`);
        console.log('[Dry Run] Les secrets sont masqués dans les logs. Remplacez les valeurs TRELLO_KEY/TRELLO_TOKEN si vous copiez cette commande.');
        console.log(`curl -X POST -H "Content-Type: application/json" \\
  "https://api.trello.com/1/webhooks/?key=${key}&token=${token}" \\
  -d '{
    "description": "Junie Bridge Webhook - ${project.name || 'Projet'}",
    "callbackURL": "${callbackUrl}",
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

            const projectWorkspace = gitService.cleanProjectWorkspace(projectKey);
            
            console.log(`[Init] Configuration du projet : ${projectKey}`);
            
            for (const repoUrl of (project.repos || [])) {
                const repoName = path.basename(repoUrl, '.git');
                const localPath = path.join(projectWorkspace, repoName);
                
                console.log(`[Init] Clonage de ${repoName}...`);
                const cloned = await gitService.runCommand('git', ['clone', repoUrl, localPath]);
                
                if (cloned) {
                    await gitService.runCommand('git', ['checkout', baseBranch], localPath);
                }
            }
        }
        console.log(`[${new Date().toISOString()}] Initialisation terminée.`);
    }
}

module.exports = new ProjectService();
