const { spawn } = require('child_process');
const path = require('path');
const config = require('../config/config');

class DBService {
    /**
     * Exécute le script de synchronisation de base de données
     * @param {object} project Configuration du projet
     * @param {string} branchName Nom de la branche (optionnel, pour les envs de review)
     */
    async sync(project, branchName = '') {
        const source = project.environments?.source || {};
        const target = project.environments?.target || {};

        const args = [
            project.name || 'unknown',
            source.host || '',
            source.ssh_user || '',
            source.prefix || '',
            source.db_host || '',
            source.db_name || '',
            source.db_user || '',
            source.db_password || '',
            target.host || '',
            target.ssh_user || '',
            target.prefix || '',
            target.db_host || '',
            target.db_name || '',
            target.db_user || '',
            target.db_password || '',
            branchName
        ];

        const scriptPath = path.join(process.cwd(), 'script', 'sync_db.sh');

        if (config.DRY_RUN) {
            console.log(`[DB] [DRY RUN] Would execute: ${scriptPath} ${args.join(' ')}`);
            return { success: true, message: 'Dry run: sync skipped' };
        }

        console.log(`[DB] Starting sync: ${project.name}${branchName ? ' branch: ' + branchName : ''}`);

        return new Promise((resolve, reject) => {
            const child = spawn('/bin/bash', [scriptPath, ...args], {
                env: process.env,
                stdio: 'pipe',
                encoding: 'utf8'
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data;
                // On peut aussi logger en temps réel si on veut
                process.stdout.write(`[DB Sync stdout] ${data}`);
            });

            child.stderr.on('data', (data) => {
                stderr += data;
                process.stderr.write(`[DB Sync stderr] ${data}`);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`[DB] Sync completed successfully for ${projectName}`);
                    resolve({ success: true, stdout });
                } else {
                    console.error(`[DB] Sync failed for ${projectName} with code ${code}`);
                    reject(new Error(`sync_db.sh failed with code ${code}\n${stderr}`));
                }
            });

            child.on('error', (err) => {
                console.error(`[DB] Failed to start sync script: ${err.message}`);
                reject(err);
            });
        });
    }
}

module.exports = new DBService();
