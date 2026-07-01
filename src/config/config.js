const path = require('path');
require('dotenv').config();

const fs = require('fs');

const tokenPath = path.join(process.cwd(), '.trello_token');
let trelloToken = process.env.TRELLO_TOKEN;

if (!trelloToken && fs.existsSync(tokenPath)) {
    trelloToken = fs.readFileSync(tokenPath, 'utf8').trim();
}

function readEnv(name, defaultValue = undefined) {
    return process.env[name] || defaultValue;
}

const config = {
    TRELLO: {
        KEY: readEnv('TRELLO_KEY'),
        TOKEN: trelloToken,
        SECRET: readEnv('TRELLO_SECRET'),
        CALLBACK_URL: readEnv('TRELLO_CALLBACK_URL'),
    },
    JUNIE: {
        API_KEY: readEnv('JUNIE_API_KEY'),
        COMMAND_TIMEOUT_MS: Number(readEnv('JUNIE_COMMAND_TIMEOUT_MS', 1800000)), // 30 minutes par défaut
    },
    GIT: {
        SSH_COMMAND: readEnv('GIT_SSH_COMMAND'),
        SSH_AUTH_SOCK: readEnv('SSH_AUTH_SOCK'),
        COMMAND_TIMEOUT_MS: Number(readEnv('GIT_COMMAND_TIMEOUT_MS', 120000)),
        USER_NAME: readEnv('GIT_USER_NAME', 'Junie Bridge'),
        USER_EMAIL: readEnv('GIT_USER_EMAIL', 'junie-bridge@example.com'),
    },
    DRY_RUN: process.env.DRY_RUN === 'true',
    PORT: readEnv('PORT', 3000),
    PATHS: {
        PROJECTS_DIR: path.join(process.cwd(), 'projects'),
        WORKSPACE_DIR: path.join(process.cwd(), 'workspace'),
    }
};

config.getTrelloCredentials = function getTrelloCredentials(project = {}) {
    return {
        key: project.trello?.key || config.TRELLO.KEY,
        token: config.TRELLO.TOKEN,
        secret: project.trello?.secret || config.TRELLO.SECRET,
        callbackUrl: project.trello?.callbackUrl || config.TRELLO.CALLBACK_URL,
        boardId: project.trello?.boardId
    };
};

config.getJunieApiKey = function getJunieApiKey(project = {}) {
    return project.junieApiKey || config.JUNIE.API_KEY;
};

module.exports = config;
