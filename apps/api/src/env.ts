import 'dotenv/config';
import path from 'node:path';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.API_PORT ?? 3001),
  databaseUrl: req('DATABASE_URL'),
  jwtSecret: req('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_MB ?? 15) * 1024 * 1024,
  appUrl: process.env.APP_URL ?? 'http://localhost:8080',
  // Integração WhatsApp (Meta Cloud API) — opcional; sem as credenciais fica inativa
  whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
  whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? 'gestao-ti-verify',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  // Agente de inventário — sem token definido, a coleta automática fica desligada
  agentToken: process.env.AGENT_TOKEN ?? '',
};

if (env.nodeEnv === 'production' && env.jwtSecret.startsWith('dev-')) {
  throw new Error('JWT_SECRET de desenvolvimento não pode ser usado em produção.');
}
