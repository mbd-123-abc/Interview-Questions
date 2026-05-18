import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Verifies the X-HCM-Signature header on incoming HCM webhook requests.
 *
 * The signature is expected to be an HMAC-SHA256 hex digest of the raw
 * request body, keyed with HCM_WEBHOOK_SECRET.
 *
 * If HCM_WEBHOOK_SECRET is not set (e.g. local dev / tests), the guard
 * passes through without verification so existing tests are unaffected.
 */
@Injectable()
export class HcmWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.HCM_WEBHOOK_SECRET;

    // No secret configured — bypass (dev/test mode)
    if (!secret) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const signature = req.headers['x-hcm-signature'] as string | undefined;

    if (!signature) {
      throw new UnauthorizedException('Missing X-HCM-Signature header');
    }

    // NestJS/Express parses the body before guards run, so we re-serialize.
    // For production, consider using rawBody middleware for exact byte fidelity.
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid X-HCM-Signature');
    }

    return true;
  }
}
