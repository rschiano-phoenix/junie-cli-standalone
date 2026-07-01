const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { sanitizeName } = require('../utils/format');

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

    getProjectWorkspace(projectName) {
        const projectPath = path.join(this.workspaceDir, sanitizeName(projectName));
        if (config.DRY_RUN) {
            console.log(`[Git] [DRY RUN] Would ensure workspace: ${projectPath}`);
            return projectPath;
        }
        if (!fs.existsSync(projectPath)) {
            console.log(`[Git] Creating workspace: ${projectPath}`);
            fs.mkdirSync(projectPath, { recursive: true });
        }
        return projectPath;
    }

    async runCommand(command, args = [], cwd) {
        try {
            if (config.DRY_RUN) {
                console.log(`[Git] [DRY RUN] Executing: ${this.formatCommand(command, args)} in ${cwd || 'root'}`);
                return { success: true, stdout: '', stderr: '', status: 0 };
            }

            const isSsh = args.some(arg => typeof arg === 'string' && (arg.includes('git@') || arg.includes('ssh://')));
            if (isSsh && !config.GIT.SSH_AUTH_SOCK && (!config.GIT.SSH_COMMAND || !config.GIT.SSH_COMMAND.includes('-i'))) {
                console.warn(`[Git Warning] Tentative d'accès SSH détectée (${command} ${args.join(' ')}), mais SSH_AUTH_SOCK n'est pas défini et aucune clé n'est forcée via GIT_SSH_COMMAND. L'authentification risque d'échouer.`);
            }

            const env = this.buildGitEnvironment();
            console.log(`[Git] Executing: ${this.formatCommand(command, args)} in ${cwd || 'root'}`);
            const result = spawnSync(command, args, {
                cwd,
                env,
                stdio: 'pipe', // Changé de 'inherit' à 'pipe' pour capturer la sortie
                encoding: 'utf8',
                timeout: config.GIT.COMMAND_TIMEOUT_MS,
            });
            if (result.error) throw result.error;

            if (result.status !== 0) {
                console.error(`[Git Error] Command failed with status ${result.status}`);
                console.error(`[Git Error] stdout: ${result.stdout}`);
                console.error(`[Git Error] stderr: ${result.stderr}`);
            }

            return {
                success: result.status === 0,
                status: result.status,
                stdout: result.stdout,
                stderr: result.stderr
            };
        } catch (e) {
            console.error(`[Git Error] ${e.message}`);
            if (e.code === 'ETIMEDOUT') {
                console.error('[Git Error] Command timed out. If your SSH key has a passphrase, make sure it is loaded in ssh-agent before starting the bridge.');
            }
            return {
                success: false,
                error: e.message
            };
        }
    }

    formatCommand(command, args = []) {
        return [command, ...args].map(arg => {
            const value = String(arg);
            return /\s/.test(value) ? JSON.stringify(value) : value;
        }).join(' ');
    }

    buildGitEnvironment() {
        const env = {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_AUTHOR_NAME: config.GIT.USER_NAME,
            GIT_AUTHOR_EMAIL: config.GIT.USER_EMAIL,
            GIT_COMMITTER_NAME: config.GIT.USER_NAME,
            GIT_COMMITTER_EMAIL: config.GIT.USER_EMAIL,
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

    async add(cwd) {
        const result = await this.runCommand('git', ['add', '-A'], cwd);
        return result.success;
    }

    async commit(cwd, message) {
        if (!await this.add(cwd)) return false;
        const result = await this.runCommand('git', ['commit', '-m', message], cwd);
        
        // Si le commit échoue, on vérifie si c'est parce qu'il n'y a rien à committer
        if (!result.success) {
            if (result.stdout?.includes('nothing to commit') || result.stderr?.includes('nothing to commit')) {
                console.log(`[Git] Nothing to commit in ${cwd}`);
                return true; // On considère ça comme un succès fonctionnel
            }
            return false;
        }
        return true;
    }

    async push(cwd, branchName) {
        // On utilise -u pour lier la branche à l'origin
        const result = await this.runCommand('git', ['push', '-u', 'origin', branchName], cwd);
        return result.success;
    }

    async checkout(cwd, branchName, force = false) {
        const args = ['checkout'];
        if (force) args.push('-f');
        args.push(branchName);
        const result = await this.runCommand('git', args, cwd);
        return result.success;
    }

    async reset(cwd) {
        await this.runCommand('git', ['reset', '--hard', 'HEAD'], cwd);
        await this.runCommand('git', ['clean', '-fd'], cwd);
    }

    async setupRepo(repoUrl, projectWorkspace, branchName, baseBranch = 'develop') {
        const repoName = path.basename(repoUrl, '.git');
        const localPath = path.join(projectWorkspace, repoName);
        const gitDir = path.join(localPath, '.git');

        // 1. Clone or Fetch
        if (fs.existsSync(gitDir)) {
            console.log(`[Git] Dépôt déjà présent, récupération des mises à jour pour ${repoName}...`);
            // Nettoyage avant de commencer pour éviter les conflits de checkout
            await this.reset(localPath);
            const fetch = await this.runCommand('git', ['fetch', 'origin'], localPath);
            if (!fetch.success) {
                return { success: false, repoName, error: `Fetch failed: ${fetch.stderr || fetch.error}` };
            }
        } else {
            console.log(`[Git] Clonage de ${repoName}...`);
            const clone = await this.runCommand('git', ['clone', repoUrl, localPath]);
            if (!clone.success) {
                return { success: false, repoName, error: `Clone failed: ${clone.stderr || clone.error}` };
            }
        }

        // 2. Tenter de réutiliser la branche si elle existe
        // On essaie d'abord un checkout force (écrase les modifs locales si elles existent encore)
        let checkoutBranch = await this.runCommand('git', ['checkout', '-f', branchName], localPath);
        
        // Si ça échoue, on tente de la traquer explicitement depuis origin
        if (!checkoutBranch.success) {
            checkoutBranch = await this.runCommand('git', ['checkout', '-f', '-t', `origin/${branchName}`], localPath);
        }

        if (checkoutBranch.success) {
            console.log(`[Git] Branche ${branchName} trouvée, utilisation de la branche existante.`);
            // Si ce n'est pas la branche de base, on essaie de pull les nouveautés
            if (branchName !== baseBranch) {
                await this.runCommand('git', ['pull', 'origin', branchName], localPath);
            }
            return { success: true, repoName, localPath };
        }

        // 3. Sinon, on repart de la branche de base pour la créer
        console.log(`[Git] Branche ${branchName} non trouvée, création à partir de ${baseBranch}...`);
        
        const checkoutBase = await this.runCommand('git', ['checkout', '-f', baseBranch], localPath);
        if (!checkoutBase.success) {
            return { success: false, repoName, error: `Checkout ${baseBranch} failed: ${checkoutBase.stderr || checkoutBase.error}` };
        }
        
        // Pull latest from base branch
        await this.runCommand('git', ['pull', 'origin', baseBranch], localPath);

        // Create and checkout new branch
        const createBranch = await this.runCommand('git', ['checkout', '-b', branchName], localPath);
        if (!createBranch.success) {
            // Si l'erreur est "already exists", on tente un checkout simple avant d'abandonner
            if (createBranch.stderr?.includes('already exists') || createBranch.stdout?.includes('already exists')) {
                console.log(`[Git] Branche ${branchName} déjà existante localement, basculement...`);
                const retryCheckout = await this.runCommand('git', ['checkout', '-f', branchName], localPath);
                if (retryCheckout.success) {
                    return { success: true, repoName, localPath };
                }
            }
            return { success: false, repoName, error: `Failed to create branch ${branchName}: ${createBranch.stderr || createBranch.error}` };
        }
        
        // Pousser la branche immédiatement sur le dépôt distant (si différente de base)
        if (branchName !== baseBranch) {
            await this.push(localPath, branchName);
        }

        return { success: true, repoName, localPath };
    }

    async getDiffStat(cwd, baseBranch = 'develop') {
        try {
            if (config.DRY_RUN) return "1 file changed, 10 insertions(+), 5 deletions(-)";

            const env = this.buildGitEnvironment();
            const result = spawnSync('git', ['diff', '--stat', baseBranch], {
                cwd,
                env,
                encoding: 'utf8',
                timeout: config.GIT.COMMAND_TIMEOUT_MS,
            });
            if (result.error) throw result.error;
            return result.stdout.trim() || "Aucun changement détecté par git diff.";
        } catch (e) {
            return "Erreur lors de la récupération des statistiques diff.";
        }
    }
}

module.exports = new GitService();
