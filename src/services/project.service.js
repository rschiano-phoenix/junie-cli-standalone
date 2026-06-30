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
        const projects = {};
        if (fs.existsSync(this.projectsDir)) {
            const files = fs.readdirSync(this.projectsDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(this.projectsDir, file), 'utf8');
                        const projectConfig = JSON.parse(content);
                        if (projectConfig.trello && projectConfig.trello.targetListId) {
                            projects[projectConfig.trello.targetListId] = projectConfig;
                        }
                    } catch (e) {
                        console.error(`Error loading project ${file}:`, e.message);
                    }
                }
            });
        }
        return projects;
    }
}

module.exports = new ProjectService();
