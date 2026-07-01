const express = require('express');
const webhookController = require('./controllers/webhook');
const authController = require('./controllers/auth');

const app = express();

// Middleware to capture raw body for Trello signature verification
app.use(express.json({
    verify: (req, res, buf) => { 
        req.rawBody = buf.toString(); 
    }
}));

// Endpoints
app.get('/', (req, res) => res.redirect('/auth/trello'));
app.get('/webhook', (req, res) => res.send('Trello-Junie Bridge: Webhook endpoint is active. Use HEAD or POST for Trello integration.'));
app.head('/webhook', (req, res) => res.sendStatus(200));
app.post('/webhook', (req, res) => webhookController.handleWebhook(req, res));

// Improvement Webhook
app.get('/webhook/improve', (req, res) => res.send('Trello-Junie Bridge: Improvement webhook endpoint is active.'));
app.head('/webhook/improve', (req, res) => res.sendStatus(200));
app.post('/webhook/improve', (req, res) => webhookController.handleImprovementWebhook(req, res));

// Trello Auth Endpoints
app.get('/auth/trello', (req, res) => authController.renderTrelloAuth(req, res));
app.get('/auth/trello/callback', (req, res) => authController.renderTrelloCallback(req, res));
app.post('/auth/trello/save', (req, res) => authController.saveToken(req, res));

module.exports = app;
