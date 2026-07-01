const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

class GitService {
    constructor() {
        this.workspaceDir = config.PATHS.WORKSPACE_DIR;
        this.ensureDirectoryExists();
    }

    ensureDirectoryExists() {
        if (!fs.existsSync(this.workspaceDir)) {
            fs.mkdirSync(this.workspaceDir, { recursive: true });
        }
    }

    cleanProjectWorkspace(projectName) {
        const projectPath = path.join(this.workspaceDir, projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase());
        if (config.DRY_RUN) {
            console.log(`[Git] [DRY RUN] Would clean workspace: ${projectPath}`);
            return projectPath;
        }
        if (fs.existsSync(projectPath)) {
            console.log(`[Git] Cleaning workspace: ${projectPath}`);
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
        fs.mkdirSync(projectPath, { recursive: true });
        return projectPath;
    }

    async runCommand(command, args = [], cwd) {
        try {
            if (config.DRY_RUN) {
                console.log(`[Git] [DRY RUN] Executing: ${command} ${args.join(' ')} in ${cwd || 'root'}`);
                return true;
            }

            const isSsh = args.some(arg => typeof arg === 'string' && (arg.includes('git@') || arg.includes('ssh://')));
            if (isSsh && !config.GIT.SSH_AUTH_SOCK && (!config.GIT.SSH_COMMAND || !config.GIT.SSH_COMMAND.includes('-i'))) {
                console.warn(`[Git Warning] Tentative d'accès SSH détectée (${command} ${args.join(' ')}), mais SSH_AUTH_SOCK n'est pas défini et aucune clé n'est forcée via GIT_SSH_COMMAND. L'authentification risque d'échouer.`);
            }

            const env = this.buildGitEnvironment();
            console.log(`[Git] Executing: ${command} ${args.join(' ')} in ${cwd || 'root'}`);
            const result = spawnSync(command, args, {
                cwd,
                env,
                stdio: 'inherit',
                timeout: config.GIT.COMMAND_TIMEOUT_MS,
            });
            if (result.error) throw result.error;
            return result.status === 0;
        } catch (e) {
            console.error(`[Git Error] ${e.message}`);
            if (e.code === 'ETIMEDOUT') {
                console.error('[Git Error] Command timed out. If your SSH key has a passphrase, make sure it is loaded in ssh-agent before starting the bridge.');
            }
            return false;
        }
    }

    buildGitEnvironment() {
        const env = {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
        };

        if (config.GIT.SSH_COMMAND) {
            env.GIT_SSH_COMMAND = config.GIT.SSH_COMMAND;
            console.log('[Git] Using custom GIT_SSH_COMMAND.');
        }

        if (config.GIT.SSH_AUTH_SOCK) {
            env.SSH_AUTH_SOCK = config.GIT.SSH_AUTH_SOCK;
            console.log(`[Git] Using ssh-agent socket: ${config.GIT.SSH_AUTH_SOCK}`);
        }

        return env;
    }

    async setupRepo(repoUrl, projectWorkspace, branchName) {
        const repoName = path.basename(repoUrl, '.git');
        const localPath = path.join(projectWorkspace, repoName);

        // Clone
        if (!await this.runCommand('git', ['clone', repoUrl, localPath])) {
            return { success: false, repoName, error: 'Clone failed' };
        }

        // Checkout develop
        if (!await this.runCommand('git', ['checkout', 'develop'], localPath)) {
            return { success: false, repoName, error: 'Checkout develop failed' };
        }

        // Create and checkout branch
        if (!await this.runCommand('git', ['checkout', '-b', branchName], localPath)) {
            return { success: false, repoName, error: `Failed to create branch ${branchName}` };
        }

        return { success: true, repoName, localPath };
    }
}

module.exports = new GitService();
