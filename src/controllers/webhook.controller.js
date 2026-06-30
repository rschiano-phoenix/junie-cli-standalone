const config = require('../config/config');
const projectService = require('../services/project.service');
const trelloService = require('../services/trello.service');
const gitService = require('../services/git.service');
const junieService = require('../services/junie.service');

class WebhookController {
    constructor() {
        this.activeProjects = new Set();
    }

    async handleWebhook(req, res) {
        const { action } = req.body;
        const listId = action?.data?.listAfter?.id;

        if (!listId) return res.sendStatus(200);

        // Dynamically load projects to pick up changes
        const loadedProjects = projectService.loadProjects();
        const project = loadedProjects[listId];

        if (!project) {
            console.log(`[Webhook] No project found for list ID: ${listId}. Skipping.`);
            return res.sendStatus(200);
        }

        if (action?.type === 'updateCard' && listId === project.trello.targetListId) {
            await this.processCard(req, res, project);
        } else {
            res.sendStatus(200);
        }
    }

    async processCard(req, res, project) {
        const { action } = req.body;
        const cardId = action.data.card.id;
        const projectKey = project.name || project.trello.targetListId;

        if (this.activeProjects.has(projectKey)) {
            console.log(`[Webhook] Project ${projectKey} is already busy. Skipping.`);
            return res.sendStatus(200);
        }

        const credentials = {
            key: project.trello?.key || config.TRELLO.KEY,
            token: project.trello?.token || config.TRELLO.TOKEN,
            secret: project.trello?.secret || config.TRELLO.SECRET,
            callbackUrl: project.trello?.callbackUrl || config.TRELLO.CALLBACK_URL
        };

        if (!trelloService.verifyWebhook(req, credentials.secret, credentials.callbackUrl)) {
            console.error(`[Webhook] Invalid signature for project: ${projectKey}`);
            return res.status(403).send('Invalid signature');
        }

        this.activeProjects.add(projectKey);
        res.sendStatus(200); // Ack Trello early

        try {
            const card = await trelloService.getCard(cardId, credentials);
            const branchName = `trello/${card.idShort}`;
            const apiKey = project.junieApiKey || config.JUNIE.API_KEY;

            console.log(`[Webhook] Processing card: ${card.name} for ${projectKey}`);

            const projectWorkspace = gitService.cleanProjectWorkspace(projectKey);
            const results = [];

            for (const repoUrl of (project.repos || [])) {
                const setup = await gitService.setupRepo(repoUrl, projectWorkspace, branchName);
                
                if (!setup.success) {
                    results.push({ code: 1, repo: setup.repoName, error: setup.error, cost: 'N/A', tokens: 'N/A' });
                    continue;
                }

                const result = await junieService.run(setup.localPath, card, apiKey);
                results.push(result);
            }

            await this.finalizeTrelloCard(cardId, project, results, credentials);

        } catch (err) {
            console.error(`[Webhook Error]`, err.message);
        } finally {
            this.activeProjects.delete(projectKey);
        }
    }

    async finalizeTrelloCard(cardId, project, results, credentials) {
        const allSuccess = results.length > 0 && results.every(r => r.code === 0);
        const summary = results.map(r => 
            `- Repo ${r.repo}: ${r.code === 0 ? '✅' : '❌ (' + (r.error || 'Code ' + r.code) + ')'} | Cost: ${r.cost} | Tokens: ${r.tokens}`
        ).join('\n');

        const finalComment = `Junie execution summary:\n${summary}`;

        if (allSuccess) {
            await trelloService.moveCard(cardId, project.trello.doneListId, credentials);
            await trelloService.addComment(cardId, `✅ Task completed successfully!\n${finalComment}`, credentials);
        } else {
            await trelloService.addComment(cardId, `❌ Junie failed on some repositories.\n${finalComment}`, credentials);
        }
    }
}

module.exports = new WebhookController();
