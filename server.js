const app = require('./src/app');
const config = require('./src/config/config');

const PORT = config.PORT;

app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Trello-Junie Bridge listening on port ${PORT}`);
});