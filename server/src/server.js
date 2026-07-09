import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';

const config = loadConfig();
const db = createDatabase(config.databasePath);
const app = createApp({ db, config });

const server = app.listen(config.port, config.host, () => {
	console.log(`homepage-api listening on http://${config.host}:${config.port}`);
});

function shutdown(signal) {
	console.log(`received ${signal}, shutting down`);
	server.close(() => {
		db.close();
		process.exit(0);
	});
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
