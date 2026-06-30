const express = require('express');
const webhookController = require('./controllers/webhook.controller');

const app = express();

// Middleware to capture raw body for Trello signature verification
app.use(express.json({
    verify: (req, res, buf) => { 
        req.rawBody = buf.toString(); 
    }
}));

// Endpoints
app.head('/webhook', (req, res) => res.sendStatus(200));
app.post('/webhook', (req, res) => webhookController.handleWebhook(req, res));

module.exports = app;
