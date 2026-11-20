import { loadConfig } from '../src/config.js';

export const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://sikkim_app:test-only@127.0.0.1:5432/sikkim_test',
  FRONTEND_ORIGINS: 'http://localhost:5173',
};

export const testConfig = () => loadConfig(testEnvironment);
