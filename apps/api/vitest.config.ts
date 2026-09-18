import { defineConfig } from 'vitest/config';

const TEST_DB = 'postgresql://gestao:gestao-ti-dev-2026@localhost:5433/gestao_ti_test?schema=public';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_DB,
      JWT_SECRET: 'segredo-de-teste-nao-usar-em-producao',
      NODE_ENV: 'test',
      UPLOAD_DIR: './uploads-test',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Todos os arquivos de teste compartilham o mesmo banco Postgres — rodar em
    // paralelo abre espaço pra estado global de um arquivo vazar pro outro
    // (já vimos isso com a criação de fixtures e com categorias de triagem do
    // WhatsApp). Sequencial evita essa classe de flakiness; a suíte ainda é
    // rápida o bastante pra isso não doer.
    fileParallelism: false,
  },
});
