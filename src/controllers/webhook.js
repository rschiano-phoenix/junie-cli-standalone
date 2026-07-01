const config = require('../config/config');
const projectService = require('../services/project.service');
const trelloService = require('../services/trello.service');
const gitService = require('../services/git.service');
const junieService = require('../services/junie.service');
const { parseCurrency, parseInteger, getCallbackUrl } = require('../utils/format');

class WebhookController {
    constructor() {
        this.activeProjects = new Set();
    }

    async handleWebhook(req, res) {
        return this.handleCommonWebhook(req, res, 'initial');
    }

    async handleImprovementWebhook(req, res) {
        return this.handleCommonWebhook(req, res, 'improve');
    }

    async handleCommonWebhook(req, res, type) {
        const { action } = req.body;
        const listId = action?.data?.listAfter?.id;
        const listName = action?.data?.listAfter?.name;
        const boardId = action?.data?.board?.id;

        if (!listId) return res.sendStatus(200);

        // Dynamically load projects to pick up changes
        const loadedProjects = projectService.loadProjects();
        
        // Find project by listId OR (boardId AND listName)
        const project = loadedProjects.find(p => {
            const configTrello = p.trello;
            if (type === 'initial') {
                return (configTrello.targetListId === listId) || 
                       (configTrello.boardId === boardId && configTrello.targetListName && configTrello.targetListName.toLowerCase() === listName?.toLowerCase()) ||
                       (configTrello.boardId === boardId && !configTrello.targetListId && !configTrello.targetListName && listName?.toLowerCase() === "a développer");
            } else {
                return (configTrello.improveListId === listId) || 
                       (configTrello.boardId === boardId && configTrello.improveListName && configTrello.improveListName.toLowerCase() === listName?.toLowerCase()) ||
                       (configTrello.boardId === boardId && !configTrello.improveListId && !configTrello.improveListName && listName?.toLowerCase() === "a reprendre");
            }
        });

        if (!project) {
            console.log(`[Webhook] [${type}] No project found for list ID: ${listId} or Name: ${listName} on Board: ${boardId}. Skipping.`);
            return res.sendStatus(200);
        }

        if (action?.type === 'updateCard') {
            await this.processCard(req, res, project, type);
        } else {
            res.sendStatus(200);
        }
    }

    async processCard(req, res, project, type = 'initial') {
        const { action } = req.body;
        const cardId = action.data.card.id;
        const projectKey = project.name || project.trello.targetListId || project.trello.targetListName || project.trello.boardId;

        if (this.activeProjects.has(projectKey)) {
            console.log(`[Webhook] Project ${projectKey} is already busy. Skipping.`);
            return res.sendStatus(200);
        }

        const credentials = config.getTrelloCredentials(project);
        const callbackUrl = getCallbackUrl(credentials.callbackUrl, type);

        if (!credentials.key || !credentials.secret || !callbackUrl) {
            console.error(`[Webhook] Missing Trello configuration for project: ${projectKey}. Required: key, secret, callbackUrl.`);
            return res.status(500).send('Trello configuration missing. Please check global .env or project configuration.');
        }

        if (!credentials.token) {
            console.error(`[Webhook] No Trello token found for project: ${projectKey}. Please run /auth/trello.`);
            return res.status(401).send('Trello token missing. Please authorize the bridge at /auth/trello');
        }

        if (!trelloService.verifyWebhook(req, credentials.secret, callbackUrl)) {
            console.error(`[Webhook] Invalid signature for project: ${projectKey} (Type: ${type})`);
            console.error(`[Webhook] Used callback URL for verification: ${callbackUrl}`);
            return res.status(403).send('Invalid signature');
        }

        this.activeProjects.add(projectKey);
        res.sendStatus(200); // Ack Trello early

        try {
            const card = await trelloService.getCard(cardId, credentials);
            let instruction = card.desc || card.name;

            if (type === 'improve') {
                const comments = await trelloService.getCardComments(cardId, credentials);
                if (comments && comments.length > 0) {
                    // Les commentaires sont triés du plus récent au plus ancien
                    instruction = comments[0].data.text;
                }
            }

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
            const introMsg = type === 'improve' ? "Je vais appliquer les modifications demandées !" : "Je m'occupe de ce ticket.";
            const planComment = `👋 Bonjour ! ${introMsg}

Voici mon plan d'action pour aujourd'hui :
1. Préparer un espace de travail tout propre.
2. Récupérer ou créer la branche dédiée \`trello/${card.idShort}\` sur chaque dépôt.
3. Laisser Junie opérer sa magie sur :
${reposText}
4. Vous faire un rapport complet dès que j'ai fini.

Je commence tout de suite ! 🚀`;
            await trelloService.addComment(cardId, planComment, credentials);

            const branchName = `trello/${card.idShort}`;
            const baseBranch = project.baseBranch || 'develop';
            const apiKey = config.getJunieApiKey(project);

            if (!apiKey) {
                console.error(`[Webhook] Missing Junie API key for project: ${projectKey}.`);
                await trelloService.addComment(cardId, '❌ Junie API key is missing. Configure `JUNIE_API_KEY` globally or `junieApiKey` on the project.', credentials);
                return;
            }

            console.log(`[Webhook] [${type}] Processing card: ${card.name} for ${projectKey}`);
            console.log(`[Webhook] [${type}] Instruction: ${instruction.substring(0, 50)}...`);

            if (!Array.isArray(project.repos) || project.repos.length === 0) {
                console.error(`[Webhook] No repository configured for project: ${projectKey}.`);
                await trelloService.addComment(cardId, '❌ No repository configured for this project. Add at least one repository in `repos`.', credentials);
                return;
            }

            const projectWorkspace = gitService.getProjectWorkspace(projectKey);
            
            const results = [];

            for (const repoUrl of (project.repos || [])) {
                const setup = await gitService.setupRepo(repoUrl, projectWorkspace, branchName, baseBranch);
                
                if (!setup.success) {
                    results.push({ code: 1, repo: setup.repoName, error: setup.error, cost: '0.00$', tokens: '0' });
                    continue;
                }

                const result = await junieService.run(setup.localPath, instruction, apiKey);
                
                if (result.code === 0) {
                    // Commit des changements (inclut git add -A en interne)
                    const commitMsg = `Junie: ${card.name} (Trello #${card.idShort})`;
                    const committed = await gitService.commit(setup.localPath, commitMsg);

                    if (committed) {
                        // Récupération des statistiques du diff après le commit
                        result.diffStat = await gitService.getDiffStat(setup.localPath, baseBranch);
                        
                        // Push des changements sur la branche distante
                        if (await gitService.push(setup.localPath, branchName)) {
                            result.code = 0; // Succès réel
                        } else {
                            result.code = 1;
                            result.error = 'Push Git impossible';
                        }
                    } else {
                        result.code = 1;
                        result.error = 'Commit Git impossible (aucun changement ou erreur)';
                    }

                    // Retour sur branche de base (en forçant pour être sûr)
                    await gitService.checkout(setup.localPath, baseBranch, true);
                }

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
        
        // Calcul de la consommation totale
        let totalCost = 0;
        let totalTokens = 0;
        
        results.forEach(r => {
            totalCost += parseCurrency(r.cost);
            totalTokens += parseInteger(r.tokens);
        });

        const summary = results.map(r => {
            let line = `- **${r.repo}** : ${r.code === 0 ? '✅ Réussi' : '❌ Échoué (' + (r.error || 'Erreur ' + r.code) + ')'} (Coût : ${r.cost}, Tokens : ${r.tokens})`;
            if (r.diffStat) {
                line += `\n  \`\`\`text\n  ${r.diffStat.split('\n').join('\n  ')}\n  \`\`\``;
            }
            return line;
        }).join('\n');

        const consumptionSummary = `💰 **Consommation totale** : $${totalCost.toFixed(2)} | 🪙 **Tokens** : ${totalTokens.toLocaleString()}`;
        const finalComment = `J'ai terminé mon travail ! Voici un petit résumé de ce qui a été fait :\n\n${summary}\n\n${consumptionSummary}`;

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

        const statusEmoji = allSuccess ? '🎉' : '😕';
        const statusText = allSuccess ? 'est terminée avec succès' : 'a rencontré quelques obstacles';

        if (destinationListId) {
            await trelloService.moveCard(cardId, destinationListId, credentials);
            await trelloService.addComment(cardId, `${statusEmoji} La tâche ${statusText} !\n\n${finalComment}`, credentials);
        } else {
            await trelloService.addComment(cardId, `${statusEmoji} La tâche ${statusText} !\n\n${finalComment}\n\n*Note : Je n'ai pas trouvé de liste de destination où ranger la carte.*`, credentials);
        }
    }
}

module.exports = new WebhookController();
