const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/config');

class TrelloService {
    verifyWebhook(req, secret, callbackUrl) {
        if (!secret || !callbackUrl) {
            console.error(`[Trello] Missing secret or callbackUrl for verification`);
            return false;
        }
        const headerHash = req.headers['x-trello-webhook'];
        if (!headerHash) return false;
        const content = req.rawBody + callbackUrl;
        const computedHash = crypto.createHmac('sha1', secret).update(content).digest('base64');
        return computedHash === headerHash;
    }

    async getCard(cardId, credentials) {
        const { key, token } = credentials;
        const response = await axios.get(`https://api.trello.com/1/cards/${cardId}?key=${key}&token=${token}`);
        return response.data;
    }

    async moveCard(cardId, listId, credentials) {
        if (config.DRY_RUN) {
            console.log(`[Trello] [DRY RUN] Would move card ${cardId} to list ${listId}`);
            return { status: 200, data: {} };
        }
        const { key, token } = credentials;
        return axios.put(`https://api.trello.com/1/cards/${cardId}?key=${key}&token=${token}`, { idList: listId });
    }

    async addComment(cardId, text, credentials) {
        if (config.DRY_RUN) {
            console.log(`[Trello] [DRY RUN] Would add comment to card ${cardId}: ${text}`);
            return { status: 200, data: {} };
        }
        const { key, token } = credentials;
        return axios.post(`https://api.trello.com/1/cards/${cardId}/actions/comments?key=${key}&token=${token}`, { text });
    }
}

module.exports = new TrelloService();
