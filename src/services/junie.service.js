const { spawn } = require('child_process');
const path = require('path');
const config = require('../config/config');
const { maskSecret } = require('../utils/format');

const MAX_CAPTURED_OUTPUT_LENGTH = 100000;

class JunieService {
    async getBalance(repoPath, apiKey) {
        return new Promise((resolve) => {
            const junie = spawn('junie', ['--auth', apiKey, '--brave', '/usage'], {
                cwd: repoPath,
                env: { ...process.env, JUNIE_API_KEY: apiKey },
                timeout: 30000, // 30 secondes suffisent pour /usage
            });

            let output = '';
            junie.stdout.on('data', d => { output += d.toString(); });
            junie.stderr.on('data', d => { output += d.toString(); });

            junie.on('close', (code) => {
                const balanceMatch = output.match(/Balance left[:\s]+\$?([\d,.]+)/i);
                if (balanceMatch) {
                    const balance = parseFloat(balanceMatch[1].replace(',', '.'));
                    resolve(balance);
                } else {
                    resolve(null);
                }
            });

            junie.on('error', () => {
                resolve(null);
            });
        });
    }

    async run(repoPath, instruction, apiKey) {
        if (config.DRY_RUN) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [DRY RUN] Starting Junie in: ${repoPath}`);
            const maskedApiKey = maskSecret(apiKey, 5);
            console.log(`[Junie] [DRY RUN] Command: junie --auth ${maskedApiKey} --brave "${instruction}"`);
            return {
                code: 0,
                cost: '$0.00 (Dry Run)',
                tokens: '0 (Dry Run)',
                repo: path.basename(repoPath)
            };
        }

        const balanceBefore = await this.getBalance(repoPath, apiKey);

        const result = await new Promise((resolve) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] Starting Junie in: ${repoPath}`);

            const junie = spawn('junie', ['--auth', apiKey, '--brave', instruction], {
                cwd: repoPath,
                env: { ...process.env, JUNIE_API_KEY: apiKey },
                timeout: config.JUNIE.COMMAND_TIMEOUT_MS,
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

            junie.on('close', (code, signal) => {
                console.log(`[Junie] Process exited with code ${code}, signal ${signal}`);
                
                // Extraction plus robuste des coûts et tokens (capture tout jusqu'à la fin de ligne)
                const costMatch = output.match(/Total cost[:\s]+([^\r\n]+)/i);
                const tokensMatch = output.match(/Total tokens[:\s]+([^\r\n]+)/i);

                let error = null;
                if (code !== 0) {
                    if (signal === 'SIGTERM') {
                        error = `Dépassement du temps imparti (${config.JUNIE.COMMAND_TIMEOUT_MS / 1000}s)`;
                    } else {
                        error = `Code de sortie ${code}${signal ? ' (Signal ' + signal + ')' : ''}`;
                    }
                }

                resolve({
                    code: code === null ? 1 : code,
                    cost: costMatch ? costMatch[1].trim() : '0.00$',
                    tokens: tokensMatch ? tokensMatch[1].trim() : '0',
                    repo: path.basename(repoPath),
                    error,
                    output,
                });
            });
        });

        const balanceAfter = await this.getBalance(repoPath, apiKey);

        if (balanceBefore !== null && balanceAfter !== null) {
            const diff = balanceBefore - balanceAfter;
            // On s'assure que la différence est positive (en cas de recharge ou erreur de lecture)
            if (diff >= 0) {
                result.cost = `$${diff.toFixed(2)}`;
                console.log(`[Junie] Cost calculated from balance difference: ${result.cost} (Before: $${balanceBefore.toFixed(2)}, After: $${balanceAfter.toFixed(2)})`);
            }
        }

        return result;
    }
}

module.exports = new JunieService();
