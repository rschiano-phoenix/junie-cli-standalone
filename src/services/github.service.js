const axios = require('axios');
const config = require('../config/config');

class GithubService {
    async triggerReviewWorkflow(repoUrl, branchName) {
        const repoPath = this.parseRepoPath(repoUrl);
        if (!repoPath) {
            throw new Error(`Impossible d'analyser le chemin du dépôt à partir de l'URL : ${repoUrl}`);
        }

        const token = config.GITHUB.TOKEN;
        if (!token) {
            throw new Error('GITHUB_TOKEN n\'est pas configuré');
        }

        const url = `https://api.github.com/repos/${repoPath}/actions/workflows/build_deploy_review.yml/dispatches`;
        
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
