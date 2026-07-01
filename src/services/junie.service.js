const { spawn } = require('child_process');
const path = require('path');
const config = require('../config/config');

class JunieService {
    async getUsage(apiKey) {
        if (config.DRY_RUN) {
            return { cost: 0, tokens: 0 };
        }
        return new Promise((resolve) => {
            console.log(`[Junie] Récupération de l'usage actuel...`);
            // On lance Junie avec la commande /usage pour récupérer l'état actuel du compte
            const junie = spawn('junie', ['--auth', apiKey, '/usage'], {
                env: { ...process.env, JUNIE_API_KEY: apiKey }
            });

            let output = '';
            junie.stdout.on('data', d => { output += d.toString(); });
            junie.stderr.on('data', d => { output += d.toString(); });

            junie.on('close', () => {
                const costMatch = output.match(/Total cost[:\s]+(\$[\d.,]+)/i);
                const tokensMatch = output.match(/Total tokens[:\s]+([\d.,]+)/i);
                
                const costStr = costMatch ? costMatch[1].replace(/[^\d.]/g, '') : '0';
                const tokensStr = tokensMatch ? tokensMatch[1].replace(/[^\d]/g, '') : '0';
                
                resolve({
                    cost: parseFloat(costStr) || 0,
                    tokens: parseInt(tokensStr, 10) || 0
                });
            });
        });
    }

    async run(repoPath, card, apiKey) {
        if (config.DRY_RUN) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [DRY RUN] Starting Junie in: ${repoPath}`);
            const maskedApiKey = apiKey ? `${apiKey.substring(0, 5)}...` : '<missing>';
            console.log(`[Junie] [DRY RUN] Command: junie --auth ${maskedApiKey} --brave "${card.desc || card.name}"`);
            return {
                code: 0,
                cost: '$0.00 (Dry Run)',
                tokens: '0 (Dry Run)',
                repo: path.basename(repoPath)
            };
        }
        return new Promise((resolve) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] Starting Junie in: ${repoPath}`);
            
            const junie = spawn('junie', ['--auth', apiKey, '--brave', card.desc || card.name], {
                cwd: repoPath,
                env: { ...process.env, JUNIE_API_KEY: apiKey }
            });

            let output = '';
            junie.stdout.on('data', d => { output += d; console.log(`[Junie] ${d.toString().trim()}`); });
            junie.stderr.on('data', d => { output += d; console.error(`[Junie Error] ${d.toString().trim()}`); });

            junie.on('close', (code) => {
                // Regex plus flexibles pour capturer les coûts et tokens
                // Junie peut afficher : "Total cost: $0.12" ou "Total tokens: 1,234"
                const costMatch = output.match(/Total cost[:\s]+(\$[\d.,]+)/i);
                const tokensMatch = output.match(/Total tokens[:\s]+([\d.,]+)/i);
                
                resolve({
                    code,
                    cost: costMatch ? costMatch[1] : '0.00$',
                    tokens: tokensMatch ? tokensMatch[1].replace(/,/g, '') : '0',
                    repo: path.basename(repoPath),
                    output: output // Optionnel : garder l'output pour debug
                });
            });
        });
    }
}

module.exports = new JunieService();
