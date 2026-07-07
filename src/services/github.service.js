const axios = require('axios');
const config = require('../config/config');

class GithubService {
    constructor() {
        this.defaultWorkflow = 'build_deploy_review.yml';
    }

    async triggerReviewWorkflow(repoUrl, branchName) {
        const repoPath = this.parseRepoPath(repoUrl);
        if (!repoPath) {
            throw new Error(`Impossible d'analyser le chemin du dépôt à partir de l'URL : ${repoUrl}`);
        }

        const token = config.GITHUB.TOKEN;
        if (!token) {
            throw new Error('GITHUB_TOKEN n\'est pas configuré');
        }

        const url = `https://api.github.com/repos/${repoPath}/actions/workflows/${this.defaultWorkflow}/dispatches`;
        
        console.log(`[GitHub] Déclenchement du workflow de review pour ${repoPath} sur la branche ${branchName}`);
        
        if (config.DRY_RUN) {
            console.log(`[GitHub] [DRY RUN] Appel POST vers ${url} avec ref: ${branchName}`);
            return true;
        }

        try {
            const response = await axios.post(url, {
                ref: branchName
            }, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            // GitHub dispatches return 204 No Content on success
            return response.status === 204;
        } catch (error) {
            console.error(`[GitHub Error] Échec du déclenchement du workflow : ${error.message}`);
            if (error.response) {
                console.error(`[GitHub Error] Statut : ${error.response.status}, Données : ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async getLatestWorkflowRun(repoPath, branchName) {
        const token = config.GITHUB.TOKEN;
        const url = `https://api.github.com/repos/${repoPath}/actions/workflows/${this.defaultWorkflow}/runs`;

        try {
            const response = await axios.get(url, {
                params: {
                    branch: branchName,
                    per_page: 1
                },
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            const runs = response.data.workflow_runs;
            return runs && runs.length > 0 ? runs[0] : null;
        } catch (error) {
            console.error(`[GitHub Error] Impossible de récupérer les runs pour ${repoPath} : ${error.message}`);
            return null;
        }
    }

    async pollWorkflowStatus(repoPath, runId, onUpdate) {
        const token = config.GITHUB.TOKEN;
        const url = `https://api.github.com/repos/${repoPath}/actions/runs/${runId}`;
        const maxAttempts = 60; // 60 essais * 10s = 10 minutes max
        const interval = 10000; // 10 secondes

        let attempts = 0;
        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'Authorization': `Bearer ${token}`,
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                });

                const run = response.data;
                console.log(`[GitHub] Run ${runId} (${repoPath}) : ${run.status} / ${run.conclusion || 'en cours'}`);

                if (onUpdate) {
                    onUpdate(run);
                }

                if (run.status === 'completed') {
                    return run.conclusion; // 'success', 'failure', 'cancelled', etc.
                }
            } catch (error) {
                console.error(`[GitHub Error] Erreur lors du polling du run ${runId} : ${error.message}`);
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        return 'timed_out';
    }

    parseRepoPath(repoUrl) {
        // Gère git@github.com:owner/repo.git
        const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^.]+)(\.git)?/);
        if (sshMatch) {
            return `${sshMatch[1]}/${sshMatch[2]}`;
        }

        // Gère https://github.com/owner/repo.git
        const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^.]+)(\.git)?/);
        if (httpsMatch) {
            return `${httpsMatch[1]}/${httpsMatch[2]}`;
        }

        return null;
    }
}

module.exports = new GithubService();
