import { buildApp } from './app.js';
import { env } from './env.js';
import { startScheduler } from './scheduler.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  startScheduler();
  app.log.info(`API Gestão TI ouvindo na porta ${env.port}`);
}

main().catch((err) => {
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
