// Starts the webhook server:  npm start
import { createApp } from './app.js';
import { config, requireConfig } from './config.js';
import { log } from './logger.js';

try {
  requireConfig(['whatsappToken', 'phoneNumberId', 'verifyToken', 'appSecret', 'anthropicApiKey']);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

createApp().listen(config.port, () => {
  log.info(`Server listening on http://localhost:${config.port}`, { model: config.model });
  log.info('Webhook path: /webhook  (expose it with VS Code Port Forwarding, see README)');
});
