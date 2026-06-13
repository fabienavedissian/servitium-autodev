import pino from 'pino';
import type { Config } from './config';

export type Logger = pino.Logger;

export function createLogger(cfg?: Pick<Config, 'LOG_LEVEL'>): Logger {
  return pino({ level: cfg?.LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info' });
}
