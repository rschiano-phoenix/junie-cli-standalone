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
        const response = await axios.get(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}`, {
            params: this.buildAuthParams(credentials),
        });
        return response.data;
    }

    async getBoardLists(boardId, credentials) {
        const response = await axios.get(`https://api.trello.com/1/boards/${encodeURIComponent(boardId)}/lists`, {
            params: this.buildAuthParams(credentials),
        });
        return response.data;
    }

    async getListIdByName(boardId, listName, credentials) {
        const lists = await this.getBoardLists(boardId, credentials);
        const list = lists.find(l => l.name.toLowerCase() === listName.toLowerCase());
        return list ? list.id : null;
    }

    async moveCard(cardId, listId, credentials) {
        if (config.DRY_RUN) {
            console.log(`[Trello] [DRY RUN] Would move card ${cardId} to list ${listId}`);
            return { status: 200, data: {} };
        }
        return axios.put(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}`, { idList: listId }, {
            params: this.buildAuthParams(credentials),
        });
    }

    async addComment(cardId, text, credentials) {
        if (config.DRY_RUN) {
            console.log(`[Trello] [DRY RUN] Would add comment to card ${cardId}: ${text}`);
            return { status: 200, data: {} };
        }
        return axios.post(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/actions/comments`, { text }, {
            params: this.buildAuthParams(credentials),
        });
    }

    async getBoardLabels(boardId, credentials) {
        const response = await axios.get(`https://api.trello.com/1/boards/${encodeURIComponent(boardId)}/labels`, {
            params: this.buildAuthParams(credentials),
        });
        return response.data;
    }

    async addLabel(cardId, labelName, credentials) {
        if (config.DRY_RUN) {
            console.log(`[Trello] [DRY RUN] Would add label "${labelName}" to card ${cardId}`);
            return { status: 200, data: {} };
        }

        try {
            // Pour éviter de créer des doublons de labels sur le board, on vérifie d'abord s'il existe déjà
            const card = await this.getCard(cardId, credentials);
            const boardLabels = await this.getBoardLabels(card.idBoard, credentials);
            
            const existingLabel = boardLabels.find(l => l.name && l.name.trim().toLowerCase() === labelName.toLowerCase());
            
            if (existingLabel) {
                // Si le label existe sur le board, on l'ajoute à la carte via son ID
                // Note: Si la carte a déjà ce label, Trello ignorera l'appel sans erreur
                return axios.post(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/idLabels`, { value: existingLabel.id }, {
                    params: this.buildAuthParams(credentials),
                });
            }
        } catch (err) {
            console.warn(`[Trello] Warning while checking existing labels: ${err.message}. Falling back to default addLabel.`);
        }

        // Si le label n'existe pas sur le board (ou erreur), on laisse Trello le créer et l'ajouter
        return axios.post(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/labels`, { name: labelName }, {
            params: this.buildAuthParams(credentials),
        });
    }

    async getCardComments(cardId, credentials) {
        const response = await axios.get(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/actions`, {
            params: {
                ...this.buildAuthParams(credentials),
                filter: 'commentCard',
                limit: 50
            },
        });
        return response.data;
    }

    buildAuthParams(credentials) {
        return {
            key: credentials.key,
            token: credentials.token,
        };
    }

    getAuthUrl() {
        const key = config.TRELLO.KEY;
        if (!key) return null;

        const callbackUrl = config.TRELLO.CALLBACK_URL;
        const name = "Trello-Junie Bridge";
        const scope = "read,write,account";
        const expiration = "never";
        const responseType = "token";

        let url = `https://trello.com/1/authorize?key=${key}&name=${encodeURIComponent(name)}&scope=${scope}&expiration=${expiration}&response_type=${responseType}`;

        if (callbackUrl) {
            // Trello supporte return_url pour rediriger après autorisation
            // On pointe vers notre endpoint de callback
            const returnUrl = callbackUrl.replace('/webhook', '/auth/trello/callback');
            url += `&return_url=${encodeURIComponent(returnUrl)}`;
        }

        return url;
    }
}

module.exports = new TrelloService();
