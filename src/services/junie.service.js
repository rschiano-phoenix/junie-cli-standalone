const { spawn } = require('child_process');
const path = require('path');

class JunieService {
    async run(repoPath, card, apiKey) {
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
                const costMatch = output.match(/Total cost: (\$[\d.]+)/i);
                const tokensMatch = output.match(/Total tokens: ([\d,]+)/i);
                resolve({
                    code,
                    cost: costMatch?.[1] || 'N/A',
                    tokens: tokensMatch?.[1] || 'N/A',
                    repo: path.basename(repoPath)
                });
            });
        });
    }
}

module.exports = new JunieService();
