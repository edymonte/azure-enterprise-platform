// Entry point: `npm --prefix portal start`.
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);

await app.start();
const url = `http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}/`;
console.log(`Learning portal: ${url}`);
console.log(`Repository:      ${config.repoRoot}`);
console.log(`Progress data:   ${config.dataDir}`);
if (config.unlockAll) console.log('VALIDATION MODE: every session is unlocked (PORTAL_UNLOCK_ALL=1).');
console.log('Press Ctrl+C to stop.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.stop();
    process.exit(0);
  });
}
