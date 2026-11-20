import { isAbsolute, resolve, parse } from 'node:path';
import { isIP } from 'node:net';

export type Config = ReturnType<typeof loadConfig>;
type Environment = Record<string, string | undefined>;

export class ConfigurationError extends Error {}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`${name} is required`);
  }
  return value;
}

export function databaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError('Database URL is invalid');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    !/^\/[a-zA-Z][a-zA-Z0-9_]*$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new ConfigurationError(
      'Database URL requires credentials and a database; URL options are not allowed',
    );
  }
  return url;
}

function origin(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError('Invalid allowed origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (production && url.protocol !== 'https:')
  ) {
    throw new ConfigurationError(
      'Origins must be exact HTTP origins, using HTTPS in production',
    );
  }
  return url.origin;
}

export function loadConfig(env: Environment = process.env) {
  const mode = required(env, 'NODE_ENV');
  if (!['development', 'test', 'production'].includes(mode)) {
    throw new ConfigurationError('Invalid NODE_ENV');
  }
  const production = mode === 'production';
  const connectionString = required(env, 'DATABASE_URL');
  databaseUrl(connectionString);
  const tlsValue = env.DB_TLS ?? 'false';
  if (!['true', 'false'].includes(tlsValue)) {
    throw new ConfigurationError('DB_TLS must be true or false');
  }
  if (production && tlsValue !== 'true') {
    throw new ConfigurationError('Production requires verified database TLS');
  }
  if (production) {
    origin(required(env, 'PUBLIC_API_ORIGIN'), true);
  }
  const origins = required(env, 'FRONTEND_ORIGINS')
    .split(',')
    .map((v) => origin(v.trim(), production));
  const requestLimit = env.REQUESTS_PER_MINUTE ?? '100';
  if (
    !/^\d+$/.test(requestLimit) ||
    +requestLimit < 1 ||
    +requestLimit > 10000
  ) {
    throw new ConfigurationError(
      'REQUESTS_PER_MINUTE must be between 1 and 10000',
    );
  }
  const portValue = env.PORT ?? '3000';
  if (!/^\d+$/.test(portValue) || +portValue < 1 || +portValue > 65535) {
    throw new ConfigurationError('Invalid PORT');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!isIP(host)) {
    throw new ConfigurationError('HOST must be a bind IP address');
  }
  const trustProxy = (env.TRUST_PROXY_CIDRS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const range of trustProxy) {
    const [ip, prefix, extra] = range.split('/');
    const family = isIP(ip ?? '');
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || +prefix > (family === 4 ? 32 : 128)))
    ) {
      throw new ConfigurationError(
        'TRUST_PROXY_CIDRS requires explicit IP addresses or CIDRs',
      );
    }
    if (prefix !== undefined && +prefix === 0) {
      throw new ConfigurationError('Do not trust every proxy');
    }
  }
  const demoValue = env.ENABLE_DEMO_AUTH ?? 'false';
  if (!['true', 'false'].includes(demoValue)) {
    throw new ConfigurationError('ENABLE_DEMO_AUTH must be true or false');
  }
  const demoAuth = demoValue === 'true';
  if (demoAuth) {
    if (
      production ||
      !['127.0.0.1', '::1'].includes(host) ||
      trustProxy.length
    ) {
      throw new ConfigurationError(
        'Demo sign-in requires a local non-production server without a proxy',
      );
    }
    localDatabaseTarget(mode, connectionString);
  }
  // 'manual': an admin checks a real host's identity (in person, video call or
  // documents) and records the method when approving. 'disabled' keeps real
  // host applications closed.
  const hostVerification = env.HOST_VERIFICATION_MODE ?? 'disabled';
  if (!['disabled', 'manual'].includes(hostVerification)) {
    throw new ConfigurationError(
      'HOST_VERIFICATION_MODE must be disabled or manual',
    );
  }
  const storageMode = env.MEDIA_STORAGE_MODE ?? 'local';
  if (!['local', 'single_server'].includes(storageMode)) {
    throw new ConfigurationError('Invalid MEDIA_STORAGE_MODE');
  }
  const singleServer = storageMode === 'single_server';
  if (
    singleServer &&
    (!production ||
      !['127.0.0.1', '::1'].includes(host) ||
      trustProxy.length !== 1 ||
      !['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(trustProxy[0]!))
  ) {
    throw new ConfigurationError(
      'Single-server media requires production and a loopback API behind one loopback proxy',
    );
  }
  const storageDir = env.MEDIA_STORAGE_DIR?.trim();
  const signingKey = env.MEDIA_SIGNING_KEY;
  let media: { directory: string; signingKey: string } | null = null;
  if (storageDir || signingKey || singleServer) {
    if (
      (!singleServer && (production || trustProxy.length > 0)) ||
      !['127.0.0.1', '::1'].includes(host) ||
      !storageDir ||
      !isAbsolute(storageDir) ||
      resolve(storageDir) === parse(storageDir).root ||
      !signingKey ||
      signingKey.length < 32
    ) {
      throw new ConfigurationError(
        'Media requires a private absolute directory, a 32-character key and a loopback API; ' +
          'local mode also requires a non-production server without a proxy',
      );
    }
    if (!singleServer) localDatabaseTarget(mode, connectionString);
    media = { directory: resolve(storageDir), signingKey };
  }
  return {
    media,
    requestsPerMinute: +requestLimit,
    mode,
    demoAuth,
    hostVerification: hostVerification as 'disabled' | 'manual',
    production,
    connectionString,
    origins,
    port: +portValue,
    host,
    databaseTls: tlsValue === 'true',
    databaseCaFile: env.DB_CA_FILE,
    trustProxy,
    logLevel: mode === 'test' ? 'silent' : 'info',
  };
}

export function localDatabaseTarget(mode: string, value: string): string {
  const url = databaseUrl(value);
  const expected =
    mode === 'development'
      ? 'sikkim_dev'
      : mode === 'test'
        ? 'sikkim_test'
        : undefined;
  if (
    !expected ||
    url.pathname !== `/${expected}` ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new ConfigurationError(
      'Seed/reset is restricted to local sikkim_dev or sikkim_test in its matching environment',
    );
  }
  return expected;
}
