import { ForbiddenException } from '@nestjs/common';
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks';
import { TwilioWebhooksController } from './twilio-webhooks.controller';

describe('TwilioWebhooksController', () => {
  const url = 'https://api.labrisa.com.ar/webhooks/twilio/whatsapp-status';
  const params = {
    MessageSid: 'SM1',
    MessageStatus: 'undelivered',
    ErrorCode: '63016',
  };
  const originalOrigin = process.env.API_ORIGIN;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  let controller: TwilioWebhooksController;
  let deliveryService: { applyStatus: jest.Mock };

  beforeEach(() => {
    process.env.API_ORIGIN = 'https://api.labrisa.com.ar';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    deliveryService = { applyStatus: jest.fn() };
    controller = new TwilioWebhooksController(deliveryService as never);
  });

  afterAll(() => {
    process.env.API_ORIGIN = originalOrigin;
    process.env.TWILIO_AUTH_TOKEN = originalToken;
  });

  it('applies the status when the signature is valid', async () => {
    const signature = getExpectedTwilioSignature(
      'test-auth-token',
      url,
      params,
    );

    await controller.whatsappStatus(signature, params);

    expect(deliveryService.applyStatus).toHaveBeenCalledWith(
      'SM1',
      'undelivered',
      '63016',
    );
  });

  it('rejects a missing signature', async () => {
    await expect(
      controller.whatsappStatus(undefined, params),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deliveryService.applyStatus).not.toHaveBeenCalled();
  });

  it('rejects a signature made with a different token', async () => {
    const forged = getExpectedTwilioSignature(
      'someone-elses-token',
      url,
      params,
    );

    await expect(
      controller.whatsappStatus(forged, params),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a valid signature replayed with altered params', async () => {
    const signature = getExpectedTwilioSignature(
      'test-auth-token',
      url,
      params,
    );

    await expect(
      controller.whatsappStatus(signature, {
        ...params,
        MessageStatus: 'delivered',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validates against API_ORIGIN, so a signature for another host does not pass', async () => {
    const signature = getExpectedTwilioSignature(
      'test-auth-token',
      'https://attacker.example/webhooks/twilio/whatsapp-status',
      params,
    );

    await expect(
      controller.whatsappStatus(signature, params),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed without an auth token or an https origin', async () => {
    const signature = getExpectedTwilioSignature(
      'test-auth-token',
      url,
      params,
    );

    delete process.env.TWILIO_AUTH_TOKEN;
    await expect(
      controller.whatsappStatus(signature, params),
    ).rejects.toBeInstanceOf(ForbiddenException);

    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.API_ORIGIN = 'http://localhost:3001';
    await expect(
      controller.whatsappStatus(signature, params),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
