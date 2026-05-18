import { registerAs } from '@nestjs/config';

export default registerAs('hcm', () => ({
  baseUrl: process.env.HCM_BASE_URL || 'http://localhost:4000',
  timeoutMs: parseInt(process.env.HCM_TIMEOUT_MS ?? '5000', 10),
}));
