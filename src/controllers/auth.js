const fs = require('fs');
const path = require('path');
const trelloService = require('../services/trello.service');

class AuthController {
    renderTrelloAuth(req, res) {
        const url = trelloService.getAuthUrl();
        if (!url) {
            return res.status(400).send('TRELLO_KEY is not configured in .env. Please configure it first.');
        }
        res.redirect(url);
    }

    renderTrelloCallback(req, res) {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Trello Auth Callback</title>
    <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f4f5f7; }
        .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); max-width: 500px; width: 100%; text-align: center; }
        code { background: #ebecf0; padding: 0.5rem; border-radius: 4px; display: block; margin: 1rem 0; word-break: break-all; }
        .success { color: #519839; font-weight: bold; }
        .instruction { font-size: 0.9rem; color: #5e6c84; }
    </style>
</head>
<body>
    <div class="card">
        <h2>Trello Authorization</h2>
        <div id="loading">Récupération du token...</div>
        <div id="result" style="display:none;">
            <p class="success">Authentification réussie !</p>
            <p>Le token a été automatiquement enregistré sur le serveur.</p>
        </div>
        <div id="error" style="display:none; color: #eb5a46;">
            <p id="error-message">Impossible de trouver le token dans l'URL.</p>
        </div>
    </div>
    <script>
        const hash = window.location.hash;
        if (hash && hash.includes('token=')) {
            const token = hash.split('token=')[1];
            
            fetch('/auth/trello/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })
            .then(res => res.json())
            .then(data => {
                document.getElementById('loading').style.display = 'none';
                if (data.success) {
                    document.getElementById('result').style.display = 'block';
                } else {
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error-message').textContent = "Erreur lors de l'enregistrement du token.";
                }
            })
            .catch(err => {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('error-message').textContent = "Erreur réseau lors de l'enregistrement.";
            });
        } else {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'block';
        }
    </script>
</body>
</html>
        `;
        res.send(html);
    }

    async saveToken(req, res) {
        const { token } = req.body;
        if (!token || typeof token !== 'string' || token.length < 16) {
            return res.status(400).json({ success: false, error: 'Token missing or invalid' });
        }

        try {
            fs.writeFileSync(path.join(process.cwd(), '.trello_token'), token, { encoding: 'utf8', mode: 0o600 });
            console.log(`[Auth] Trello token saved successfully.`);
            res.json({ success: true });
        } catch (err) {
            console.error(`[Auth] Error saving token:`, err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    }
}

module.exports = new AuthController();
