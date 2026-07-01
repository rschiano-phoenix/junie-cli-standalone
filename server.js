const app = require('./src/app');
const config = require('./src/config/config');
const projectService = require('./src/services/project.service');
const gitService = require('./src/services/git.service');

const PORT = config.PORT;

async function bootstrap() {
    console.log(`[${new Date().toISOString()}] Starting Trello-Junie Bridge...`);
    
    // SSH Auth Diagnosis
    if (config.GIT.SSH_AUTH_SOCK) {
        console.log(`[Init] SSH Agent socket detected: ${config.GIT.SSH_AUTH_SOCK}`);
    } else if (config.GIT.SSH_COMMAND && config.GIT.SSH_COMMAND.includes('-i')) {
        console.log(`[Init] SSH using explicit key via GIT_SSH_COMMAND.`);
    } else {
        console.log(`[Init] No SSH agent or explicit key detected. SSH clones may require no passphrase or will fail.`);
    }

    try {
        await projectService.initializeProjects(gitService);
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Failed to initialize projects:`, err);
    }

    app.listen(PORT, () => {
        console.log(`[${new Date().toISOString()}] Trello-Junie Bridge listening on port ${PORT}`);
        if (config.DRY_RUN) {
            console.log(`[${new Date().toISOString()}] !!! DRY RUN MODE ENABLED !!!`);
        }
    });
}

bootstrap();