import {
  isProblemStatus,
  shouldApplyStatus,
  whatsappStatusCallbackUrl,
} from './whatsapp-message-status';

describe('shouldApplyStatus', () => {
  it('moves forward through the normal lifecycle', () => {
    expect(shouldApplyStatus('queued', 'sent')).toBe(true);
    expect(shouldApplyStatus('sent', 'delivered')).toBe(true);
    expect(shouldApplyStatus('delivered', 'read')).toBe(true);
    expect(shouldApplyStatus('sent', 'undelivered')).toBe(true);
  });

  it('ignores out-of-order callbacks that would move it backwards', () => {
    expect(shouldApplyStatus('delivered', 'sent')).toBe(false);
    expect(shouldApplyStatus('read', 'delivered')).toBe(false);
    expect(shouldApplyStatus('undelivered', 'sent')).toBe(false);
  });

  it('ignores a failure reported after a delivery, and duplicates', () => {
    expect(shouldApplyStatus('delivered', 'failed')).toBe(false);
    expect(shouldApplyStatus('undelivered', 'failed')).toBe(false);
    expect(shouldApplyStatus('sent', 'sent')).toBe(false);
  });

  it('ignores statuses Twilio may add that this code does not know', () => {
    expect(shouldApplyStatus('queued', 'something-new')).toBe(false);
  });
});

describe('isProblemStatus', () => {
  it('flags our own rejections and Twilio delivery failures only', () => {
    expect(isProblemStatus('rejected')).toBe(true);
    expect(isProblemStatus('undelivered')).toBe(true);
    expect(isProblemStatus('failed')).toBe(true);
    expect(isProblemStatus('sent')).toBe(false);
    expect(isProblemStatus('delivered')).toBe(false);
  });
});

describe('whatsappStatusCallbackUrl', () => {
  const original = process.env.API_ORIGIN;
  afterEach(() => {
    process.env.API_ORIGIN = original;
  });

  it('builds the webhook URL from an https API_ORIGIN, trailing slash or not', () => {
    process.env.API_ORIGIN = 'https://api.labrisa.com.ar/';
    expect(whatsappStatusCallbackUrl()).toBe(
      'https://api.labrisa.com.ar/webhooks/twilio/whatsapp-status',
    );
  });

  it('returns null for a non-https or missing origin', () => {
    process.env.API_ORIGIN = 'http://localhost:3001';
    expect(whatsappStatusCallbackUrl()).toBeNull();
    delete process.env.API_ORIGIN;
    expect(whatsappStatusCallbackUrl()).toBeNull();
  });
});
