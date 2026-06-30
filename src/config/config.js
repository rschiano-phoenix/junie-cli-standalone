const path = require('path');
require('dotenv').config();

module.exports = {
    TRELLO: {
        KEY: process.env.TRELLO_KEY,
        TOKEN: process.env.TRELLO_TOKEN,
        SECRET: process.env.TRELLO_SECRET,
        CALLBACK_URL: process.env.TRELLO_CALLBACK_URL,
    },
    JUNIE: {
        API_KEY: process.env.JUNIE_API_KEY,
    },
    PORT: process.env.PORT || 3000,
    PATHS: {
        PROJECTS_DIR: path.join(process.cwd(), 'projects'),
        WORKSPACE_DIR: path.join(process.cwd(), 'workspace'),
    }
};
