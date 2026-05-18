export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
  },
  database: {
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  hcm: {
    baseUrl: process.env.HCM_BASE_URL || 'http://localhost:4000',
    timeoutMs: parseInt(process.env.HCM_TIMEOUT_MS ?? '5000', 10),
  },
});
