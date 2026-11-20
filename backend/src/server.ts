import { buildApp } from './app.js';
import { ConfigurationError, loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await buildApp(config);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 10000).unref();
      void app
        .close()
        .then(() => clearTimeout(deadline))
        .catch(() => {
          process.exitCode = 1;
        });
    });
  }
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  console.error(
    error instanceof ConfigurationError
      ? `API startup failed: ${error.message}`
      : 'API startup failed. Check configuration and port availability.',
  );
  process.exitCode = 1;
}
