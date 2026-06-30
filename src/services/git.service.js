const { execSync } = require('child_process');
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
        if (fs.existsSync(projectPath)) {
            console.log(`[Git] Cleaning workspace: ${projectPath}`);
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
        fs.mkdirSync(projectPath, { recursive: true });
        return projectPath;
    }

    async runCommand(command, cwd) {
        try {
            console.log(`[Git] Executing: ${command} in ${cwd || 'root'}`);
            execSync(command, { cwd, stdio: 'inherit' });
            return true;
        } catch (e) {
            console.error(`[Git Error] ${e.message}`);
            return false;
        }
    }

    async setupRepo(repoUrl, projectWorkspace, branchName) {
        const repoName = path.basename(repoUrl, '.git');
        const localPath = path.join(projectWorkspace, repoName);

        // Clone
        if (!await this.runCommand(`git clone ${repoUrl} ${localPath}`)) {
            return { success: false, repoName, error: 'Clone failed' };
        }

        // Checkout develop
        if (!await this.runCommand(`git checkout develop`, localPath)) {
            return { success: false, repoName, error: 'Checkout develop failed' };
        }

        // Create and checkout branch
        if (!await this.runCommand(`git checkout -b ${branchName}`, localPath)) {
            return { success: false, repoName, error: `Failed to create branch ${branchName}` };
        }

        return { success: true, repoName, localPath };
    }
}

module.exports = new GitService();
