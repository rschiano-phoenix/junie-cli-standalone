const fs = require('fs');
const path = require('path');
const config = require('../config/config');

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

    async initializeProjects(gitService) {
        console.log(`[${new Date().toISOString()}] Initialisation des espaces de travail des projets...`);
        const projects = this.loadProjects();
        
        for (const project of projects) {
            const projectKey = project.name || project.trello.boardId || 'unknown';
            const projectWorkspace = gitService.cleanProjectWorkspace(projectKey);
            
            console.log(`[Init] Configuration du projet : ${projectKey}`);
            
            for (const repoUrl of (project.repos || [])) {
                const repoName = path.basename(repoUrl, '.git');
                const localPath = path.join(projectWorkspace, repoName);
                
                console.log(`[Init] Clonage de ${repoName}...`);
                const cloned = await gitService.runCommand('git', ['clone', repoUrl, localPath]);
                
                if (cloned) {
                    // On se place par défaut sur develop pour être prêt
                    await gitService.runCommand('git', ['checkout', 'develop'], localPath);
                }
            }
        }
        console.log(`[${new Date().toISOString()}] Initialisation terminée.`);
    }
}

module.exports = new ProjectService();
