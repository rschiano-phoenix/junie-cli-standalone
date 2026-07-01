const { spawn } = require('child_process');
const path = require('path');
const config = require('../config/config');
const { maskSecret } = require('../utils/format');

const MAX_CAPTURED_OUTPUT_LENGTH = 100000;

class JunieService {
    async run(repoPath, card, apiKey) {
        if (config.DRY_RUN) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [DRY RUN] Starting Junie in: ${repoPath}`);
            const maskedApiKey = maskSecret(apiKey, 5);
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
                env: { ...process.env, JUNIE_API_KEY: apiKey },
                timeout: config.GIT.COMMAND_TIMEOUT_MS,
            });

            let output = '';
            const appendOutput = (data) => {
                output = `${output}${data.toString()}`.slice(-MAX_CAPTURED_OUTPUT_LENGTH);
            };

            junie.stdout.on('data', d => { appendOutput(d); console.log(`[Junie] ${d.toString().trim()}`); });
            junie.stderr.on('data', d => { appendOutput(d); console.error(`[Junie Error] ${d.toString().trim()}`); });

            junie.on('error', (error) => {
                resolve({
                    code: 1,
                    cost: '0.00$',
                    tokens: '0',
                    repo: path.basename(repoPath),
                    error: error.message,
                    output,
                });
            });

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
                    output,
                });
            });
        });
    }
}

module.exports = new JunieService();
