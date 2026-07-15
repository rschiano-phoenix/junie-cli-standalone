const config = require('../config/config');
const projectService = require('../services/project.service');
const trelloService = require('../services/trello.service');
const gitService = require('../services/git.service');
const junieService = require('../services/junie.service');
const githubService = require('../services/github.service');
const dbService = require('../services/db.service');
const { parseCurrency, parseInteger, getCallbackUrl, sleep, sanitizeName } = require('../utils/format');

class WebhookController {
    constructor() {
        this.activeProjects = new Set();
    }

    getBranchName(card) {
        if (card.labels && card.labels.length > 0) {
            const customLabel = card.labels.find(label => label.name && !label.name.startsWith('ENGINE-') && label.name !== 'EN REVIEW');
            if (customLabel) {
                const labelName = customLabel.name;
                const branchName = labelName.startsWith('trello-') ? labelName : `trello-${labelName}`;
                return sanitizeName(branchName);
            }
        }
        return `trello-${card.idShort}`;
    }

    async handleWebhook(req, res) {
        return this.handleCommonWebhook(req, res, 'initial');
    }

    async handleImprovementWebhook(req, res) {
        return this.handleCommonWebhook(req, res, 'improve');
    }

    async handleReviewWebhook(req, res) {
        return this.handleCommonWebhook(req, res, 'review');
    }

    async handleReviewDeployed(req, res) {
        const cardId = req.body?.cardId || req.query?.cardId;
        const projectName = req.body?.project || req.query?.project;
        
        if (!cardId || !projectName) {
            console.error(`[handleReviewDeployed] Missing cardId (${cardId}) or project (${projectName})`);
            return res.status(400).send('Missing cardId or project.');
        }

        const project = projectService.loadProjects().find(p => p.name === projectName);
        if (!project) {
            console.error(`[handleReviewDeployed] Project not found: ${projectName}`);
            return res.status(404).send('Project not found.');
        }

        const credentials = config.getTrelloCredentials(project);
        if (!credentials.token) {
            console.error(`[handleReviewDeployed] No Trello token found for project: ${projectName}`);
            return res.status(401).send('Trello token missing.');
        }

        try {
            const card = await trelloService.getCard(cardId, credentials);
            const branchName = this.getBranchName(card);
            const hasEnReviewTag = card.labels && card.labels.some(label => label.name === 'EN REVIEW');

            let deployedListId = project.trello.deployedListId;
            if (!deployedListId && (project.trello.deployedListName || project.trello.boardId)) {
                const name = project.trello.deployedListName || "Déployé";
                deployedListId = await trelloService.getListIdByName(project.trello.boardId, name, credentials);
            }
            
            if (deployedListId) {
                // Synchronisation de la base de données si configurée
                if (project.environments?.source && project.environments?.target) {
                    if (hasEnReviewTag) {
                        await trelloService.addComment(cardId, `ℹ️ Le ticket est déjà marqué "EN REVIEW", la synchronisation de la base de données est ignorée pour préserver les données de test.`, credentials);
                    } else {
                        await trelloService.addComment(cardId, `🔄 Lancement de la synchronisation de la base de données (source -> target)...`, credentials);
                        try {
                            await dbService.sync(project, branchName);
                            await trelloService.addComment(cardId, `✅ Synchronisation de la base de données terminée !`, credentials);
                        } catch (syncErr) {
                            console.error(`[DB Sync Error]`, syncErr.message);
                            await trelloService.addComment(cardId, `⚠️ Échec de la synchronisation de la base de données : ${syncErr.message}\n\nLa carte ne sera pas déplacée dans "Déployé".`, credentials);
                            return res.status(500).send(`Database synchronization failed. Card not moved.`);
                        }
                    }
                }

                await trelloService.moveCard(cardId, deployedListId, credentials);
                
                if (!hasEnReviewTag) {
                    await trelloService.addLabel(cardId, 'EN REVIEW', credentials);
                }

                await trelloService.addComment(cardId, `✅ Le déploiement est maintenant terminé ! La carte a été déplacée dans la colonne "Déployé".`, credentials);

                console.log(`[handleReviewDeployed] Card ${cardId} moved to Deployed for project ${projectName}`);
                return res.send('Card moved.');
            } else {
                console.error(`[handleReviewDeployed] Destination list "Déployé" not found for project ${projectName}`);
                return res.status(404).send('Destination list not found.');
            }
        } catch (err) {
            console.error(`[handleReviewDeployed Error]`, err.message);
            return res.status(500).send(err.message);
        }
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
            } else if (type === 'improve') {
                return (configTrello.improveListId === listId) || 
                       (configTrello.boardId === boardId && configTrello.improveListName && configTrello.improveListName.toLowerCase() === listName?.toLowerCase()) ||
                       (configTrello.boardId === boardId && !configTrello.improveListId && !configTrello.improveListName && listName?.toLowerCase() === "a reprendre");
            } else if (type === 'review') {
                return (configTrello.reviewListId === listId) || 
                       (configTrello.boardId === boardId && configTrello.reviewListName && configTrello.reviewListName.toLowerCase() === listName?.toLowerCase()) ||
                       (configTrello.boardId === boardId && !configTrello.reviewListId && !configTrello.reviewListName && listName?.toLowerCase() === "à déployer en review");
            }
        });

        if (!project) {
            console.log(`[Webhook] [${type}] No project found for list ID: ${listId} or Name: ${listName} on Board: ${boardId}. Skipping.`);
            return res.sendStatus(200);
        }

        if (action?.type === 'updateCard') {
            if (type === 'review') {
                await this.processReviewCard(req, res, project);
            } else {
                await this.processCard(req, res, project, type);
            }
        } else {
            res.sendStatus(200);
        }
    }

    async processReviewCard(req, res, project) {
        const { action } = req.body;
        const cardId = action.data.card.id;
        const projectKey = project.name || project.trello.targetListId || project.trello.targetListName || project.trello.boardId;

        const credentials = config.getTrelloCredentials(project);
        const callbackUrl = getCallbackUrl(credentials.callbackUrl, 'review');

        if (!credentials.key || !credentials.secret || !callbackUrl) {
            console.error(`[Webhook] Missing Trello configuration for project: ${projectKey}.`);
            return res.status(500).send('Trello configuration missing.');
        }

        if (!trelloService.verifyWebhook(req, credentials.secret, callbackUrl)) {
            console.error(`[Webhook] Invalid signature for project: ${projectKey} (Type: review)`);
            return res.status(403).send('Invalid signature');
        }

        res.sendStatus(200); // Ack Trello early

        try {
            const card = await trelloService.getCard(cardId, credentials);
            const branchName = this.getBranchName(card);
            
            await trelloService.addComment(cardId, `🚀 Je lance le déploiement en review pour la branche \`${branchName}\` sur GitHub Actions...`, credentials);

            const results = [];
            for (const repoUrl of (project.repos || [])) {
                try {
                    const success = await githubService.triggerReviewWorkflow(repoUrl, branchName);
                    results.push({ repo: repoUrl, success });
                } catch (err) {
                    results.push({ repo: repoUrl, success: false, error: err.message });
                }
            }

            const summary = results.map(r => {
                const repoName = githubService.parseRepoPath(r.repo) || r.repo;
                return `- **${repoName}** : ${r.success ? '✅ Déploiement lancé' : '❌ Échec (' + (r.error || 'Erreur') + ')'}`;
            }).join('\n');

            await trelloService.addComment(cardId, `Résultat du lancement des déploiements en review :\n\n${summary}`, credentials);

            const allSuccess = results.length > 0 && results.every(r => r.success);

            if (allSuccess) {
                // Au lieu de déplacer immédiatement, on lance le suivi par polling
                this.monitorReviewDeployments(cardId, project, results.filter(r => r.success).map(r => r.repo), branchName, credentials);
            }

        } catch (err) {
            console.error(`[Webhook Review Error]`, err.message);
        }
    }

    async monitorReviewDeployments(cardId, project, repoUrls, branchName, credentials) {
        console.log(`[Polling] Démarrage du suivi des déploiements pour la carte ${cardId} (${branchName})`);
        
        try {
            // 1. Attendre un peu que GitHub enregistre les runs
            await sleep(10000);

            const repoResults = [];
            const pollingTasks = repoUrls.map(async (repoUrl) => {
                const repoPath = githubService.parseRepoPath(repoUrl);
                const repoName = repoPath || repoUrl;

                // Trouver le run
                const run = await githubService.getLatestWorkflowRun(repoPath, branchName);
                if (!run) {
                    console.error(`[Polling] Impossible de trouver un run pour ${repoPath} sur ${branchName}`);
                    repoResults.push({ repo: repoName, status: 'not_found' });
                    return;
                }

                console.log(`[Polling] Suivi du run ${run.id} pour ${repoPath}`);
                const conclusion = await githubService.pollWorkflowStatus(repoPath, run.id);
                repoResults.push({ repo: repoName, status: conclusion, url: run.html_url });
            });

            await Promise.all(pollingTasks);

            // 2. Analyser les résultats globaux
            const allSuccess = repoResults.length > 0 && repoResults.every(r => r.status === 'success');
            const summary = repoResults.map(r => {
                let icon = '❓';
                if (r.status === 'success') icon = '✅';
                else if (r.status === 'failure') icon = '❌';
                else if (r.status === 'timed_out') icon = '⏳';
                
                return `- **${r.repo}** : ${icon} ${r.status}${r.url ? ` ([logs](${r.url}))` : ''}`;
            }).join('\n');

            if (allSuccess) {
                const card = await trelloService.getCard(cardId, credentials);
                const hasEnReviewTag = card.labels && card.labels.some(label => label.name === 'EN REVIEW');

                let deployedListId = project.trello.deployedListId;
                if (!deployedListId && (project.trello.deployedListName || project.trello.boardId)) {
                    const name = project.trello.deployedListName || "Déployé";
                    deployedListId = await trelloService.getListIdByName(project.trello.boardId, name, credentials);
                }

                if (deployedListId) {
                    // Synchronisation de la base de données si configurée
                    if (project.environments?.source && project.environments?.target) {
                        if (hasEnReviewTag) {
                            await trelloService.addComment(cardId, `ℹ️ Le ticket est déjà marqué "EN REVIEW", la synchronisation de la base de données est ignorée pour préserver les données de test.`, credentials);
                        } else {
                            await trelloService.addComment(cardId, `🔄 Lancement de la synchronisation de la base de données (source -> target)...`, credentials);
                            try {
                                await dbService.sync(project, branchName);
                                await trelloService.addComment(cardId, `✅ Synchronisation de la base de données terminée !`, credentials);
                            } catch (syncErr) {
                                console.error(`[DB Sync Error]`, syncErr.message);
                                await trelloService.addComment(cardId, `⚠️ Échec de la synchronisation de la base de données : ${syncErr.message}\n\nLa carte ne sera pas déplacée dans "Déployé".`, credentials);
                                // On ne déplace pas la carte si la synchro échoue
                                return;
                            }
                        }
                    }

                    await trelloService.moveCard(cardId, deployedListId, credentials);
                    
                    if (!hasEnReviewTag) {
                        await trelloService.addLabel(cardId, 'EN REVIEW', credentials);
                    }

                    await trelloService.addComment(cardId, `✅ Déploiement réussi sur tous les dépôts !\n\n${summary}`, credentials);
                }
            } else {
                let blockedListId = project.trello.blockedListId || project.trello.improveListId;
                if (!blockedListId && project.trello.boardId) {
                    blockedListId = await trelloService.getListIdByName(project.trello.boardId, "Bloqué", credentials);
                }

                if (blockedListId) {
                    await trelloService.moveCard(cardId, blockedListId, credentials);
                }
                await trelloService.addComment(cardId, `⚠️ Le déploiement n'a pas totalement réussi.\n\n${summary}\n\nLa carte a été déplacée pour vérification.`, credentials);
            }

        } catch (err) {
            console.error(`[Polling Error]`, err.message);
            await trelloService.addComment(cardId, `❌ Erreur lors du suivi du déploiement : ${err.message}`, credentials);
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
            const branchName = this.getBranchName(card);
            const reposText = (project.repos || []).map(r => `- ${r}`).join('\n');
            const introMsg = type === 'improve' ? "Je vais appliquer les modifications demandées !" : "Je m'occupe de ce ticket.";
            const planComment = `👋 Bonjour ! ${introMsg}

Voici mon plan d'action pour aujourd'hui :
1. Préparer un espace de travail tout propre.
2. Récupérer ou créer la branche dédiée \`${branchName}\` sur chaque dépôt.
3. Laisser Junie opérer sa magie sur :
${reposText}
4. Vous faire un rapport complet dès que j'ai fini.

Je commence tout de suite ! 🚀`;
            await trelloService.addComment(cardId, planComment, credentials);

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
            
            const reposSetup = [];
            const setupResults = [];

            for (const repoUrl of (project.repos || [])) {
                const setup = await gitService.setupRepo(repoUrl, projectWorkspace, branchName, baseBranch);
                if (setup.success) {
                    reposSetup.push(setup);
                } else {
                    setupResults.push({ code: 1, repo: setup.repoName, error: setup.error, cost: '0.00$', tokens: '0' });
                }
            }

            if (reposSetup.length === 0) {
                await this.finalizeTrelloCard(cardId, project, setupResults, credentials);
                return;
            }

            // Un seul appel à Junie pour tout le workspace
            const junieResult = await junieService.run(projectWorkspace, instruction, apiKey);
            
            const results = [...setupResults];

            for (let i = 0; i < reposSetup.length; i++) {
                const setup = reposSetup[i];
                const repoResult = { 
                    repo: setup.repoName, 
                    code: junieResult.code, 
                    error: junieResult.error,
                    // On n'attribue le coût qu'au premier dépôt pour éviter de le multiplier dans le résumé Trello
                    cost: i === 0 ? junieResult.cost : '0.00$',
                    tokens: i === 0 ? junieResult.tokens : '0'
                };

                if (junieResult.code === 0) {
                    // Commit des changements (inclut git add -A en interne)
                    const commitMsg = `Junie: ${card.name} (Trello #${card.idShort})`;
                    const committed = await gitService.commit(setup.localPath, commitMsg);

                    if (committed) {
                        // Récupération des statistiques du diff après le commit
                        repoResult.diffStat = await gitService.getDiffStat(setup.localPath, baseBranch);
                        
                        // Push des changements sur la branche distante
                        if (await gitService.push(setup.localPath, branchName)) {
                            repoResult.code = 0; // Succès réel
                        } else {
                            repoResult.code = 1;
                            repoResult.error = 'Push Git impossible';
                        }
                    } else {
                        repoResult.code = 1;
                        repoResult.error = 'Commit Git impossible';
                    }

                    // Retour sur branche de base (en forçant pour être sûr)
                    await gitService.checkout(setup.localPath, baseBranch, true);
                }

                results.push(repoResult);
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
