// Terminal chat simulator:  npm run chat   (or: node scripts/chat.js [--phone 40700000000])
// Uses the SAME handler as the WhatsApp webhook, so you can test conversations without WhatsApp.
// Bookings go to data/appointments.json + data/calendar.ics like in production.
import readline from 'node:readline/promises';
import { requireConfig, config } from '../src/config.js';
import { handleIncomingMessage } from '../src/handler.js';
import { clearConversation } from '../src/memory.js';

try {
  requireConfig(['anthropicApiKey']);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const phoneArg = process.argv.indexOf('--phone');
const phone = phoneArg > -1 ? process.argv[phoneArg + 1] : '40700000000'; // fake test number

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`Clinic agent simulator (model: ${config.model}, test phone: ${phone})`);
console.log('Type a message and press Enter. Commands: /reset (forget the conversation), /quit\n');

// The simulator "delivers" messages by printing them.
const send = async (_to, body) => console.log(`\n🏥 Clinic: ${body}\n`);

while (true) {
  let line;
  try {
    line = (await rl.question('You: ')).trim();
  } catch {
    break; // input closed (Ctrl+D / piped input ended)
  }
  if (!line) continue;
  if (line === '/quit' || line === '/exit') break;
  if (line === '/reset') {
    clearConversation(phone);
    console.log('(conversation cleared)\n');
    continue;
  }
  const { status } = await handleIncomingMessage(phone, line, { send });
  if (status === 'paused') {
    console.log('(Conversation was handed to a human, so the bot stays silent. Type /reset to start over.)\n');
  }
}

rl.close();
