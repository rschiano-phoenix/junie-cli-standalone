const app = require('./src/app');
const config = require('./src/config/config');
const projectService = require('./src/services/project.service');
const gitService = require('./src/services/git.service');

const PORT = config.PORT;

async function bootstrap() {
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