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
        const listName = action?.data?.listAfter?.name;
        const boardId = action?.data?.board?.id;

        if (!listId) return res.sendStatus(200);

        // Dynamically load projects to pick up changes
        const loadedProjects = projectService.loadProjects();
        
        // Find project by listId OR (boardId AND listName)
        const project = loadedProjects.find(p => 
            (p.trello.targetListId === listId) || 
            (p.trello.boardId === boardId && p.trello.targetListName && p.trello.targetListName.toLowerCase() === listName?.toLowerCase()) ||
            (p.trello.boardId === boardId && !p.trello.targetListId && !p.trello.targetListName && listName?.toLowerCase() === "a développer")
        );

        if (!project) {
            console.log(`[Webhook] No project found for list ID: ${listId} or Name: ${listName} on Board: ${boardId}. Skipping.`);
            return res.sendStatus(200);
        }

        if (action?.type === 'updateCard') {
            await this.processCard(req, res, project);
        } else {
            res.sendStatus(200);
        }
    }

    async processCard(req, res, project) {
        const { action } = req.body;
        const cardId = action.data.card.id;
        const projectKey = project.name || project.trello.targetListId || project.trello.targetListName || project.trello.boardId;

        if (this.activeProjects.has(projectKey)) {
            console.log(`[Webhook] Project ${projectKey} is already busy. Skipping.`);
            return res.sendStatus(200);
        }

        const credentials = config.getTrelloCredentials(project);

        if (!credentials.key || !credentials.secret || !credentials.callbackUrl) {
            console.error(`[Webhook] Missing Trello configuration for project: ${projectKey}. Required: key, secret, callbackUrl.`);
            return res.status(500).send('Trello configuration missing. Please check global .env or project configuration.');
        }

        if (!credentials.token) {
            console.error(`[Webhook] No Trello token found for project: ${projectKey}. Please run /auth/trello.`);
            return res.status(401).send('Trello token missing. Please authorize the bridge at /auth/trello');
        }

        if (!trelloService.verifyWebhook(req, credentials.secret, credentials.callbackUrl)) {
            console.error(`[Webhook] Invalid signature for project: ${projectKey}`);
            return res.status(403).send('Invalid signature');
        }

        this.activeProjects.add(projectKey);
        res.sendStatus(200); // Ack Trello early

        try {
            const card = await trelloService.getCard(cardId, credentials);

            // Move to "En cours" (In Progress)
            let inProgressListId = project.trello.inProgressListId;
            if (!inProgressListId && (project.trello.inProgressListName || project.trello.boardId)) {
                const name = project.trello.inProgressListName || "En cours";
                inProgressListId = await trelloService.getListIdByName(project.trello.boardId, name, credentials);
            }
            if (inProgressListId) {
                await trelloService.moveCard(cardId, inProgressListId, credentials);
            }

            // Add plan comment
            const reposText = (project.repos || []).map(r => `- ${r}`).join('\n');
            const planComment = `👷 **Début du développement**\n\nPlan de réalisation :\n1. Préparation de l'espace de travail.\n2. Création de la branche \`trello/${card.idShort}\`.\n3. Exécution de Junie sur :\n${reposText}\n4. Finalisation et rapport.`;
            await trelloService.addComment(cardId, planComment, credentials);

            const branchName = `trello/${card.idShort}`;
            const apiKey = config.getJunieApiKey(project);

            if (!apiKey) {
                console.error(`[Webhook] Missing Junie API key for project: ${projectKey}.`);
                await trelloService.addComment(cardId, '❌ Junie API key is missing. Configure `JUNIE_API_KEY` globally or `junieApiKey` on the project.', credentials);
                return;
            }

            console.log(`[Webhook] Processing card: ${card.name} for ${projectKey}`);

            if (!Array.isArray(project.repos) || project.repos.length === 0) {
                console.error(`[Webhook] No repository configured for project: ${projectKey}.`);
                await trelloService.addComment(cardId, '❌ No repository configured for this project. Add at least one repository in `repos`.', credentials);
                return;
            }

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

        const finalComment = `Résumé de l'exécution Junie :\n${summary}`;

        let destinationListId = null;
        if (allSuccess) {
            destinationListId = project.trello.doneListId;
            if (!destinationListId && (project.trello.doneListName || project.trello.boardId)) {
                const name = project.trello.doneListName || "Réalisé";
                destinationListId = await trelloService.getListIdByName(project.trello.boardId, name, credentials);
            }
        } else {
            destinationListId = project.trello.blockedListId || project.trello.failListId;
            if (!destinationListId && (project.trello.blockedListName || project.trello.failListName || project.trello.boardId)) {
                const name = project.trello.blockedListName || project.trello.failListName || "Bloqué";
                destinationListId = await trelloService.getListIdByName(project.trello.boardId, name, credentials);
            }
        }

        const statusEmoji = allSuccess ? '✅' : '❌';
        const statusText = allSuccess ? 'terminée avec succès' : 'bloquée par une erreur';

        if (destinationListId) {
            await trelloService.moveCard(cardId, destinationListId, credentials);
            await trelloService.addComment(cardId, `${statusEmoji} Tâche ${statusText} !\n\n${finalComment}`, credentials);
        } else {
            await trelloService.addComment(cardId, `${statusEmoji} Tâche ${statusText} !\n\n${finalComment}\n\nNote: Aucune liste de destination configurée.`, credentials);
        }
    }
}

module.exports = new WebhookController();
