const createMock = jest.fn();
const mockTwilioConstructor = jest.fn().mockImplementation(() => ({ messages: { create: createMock } }));

jest.mock('twilio', () => mockTwilioConstructor);

import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let deliveryService: { recordSend: jest.Mock };
  const originalApiOrigin = process.env.API_ORIGIN;

  afterAll(() => {
    process.env.API_ORIGIN = originalApiOrigin;
  });

  beforeEach(() => {
    createMock.mockReset();
    mockTwilioConstructor.mockClear();
    mockTwilioConstructor.mockImplementation(() => ({ messages: { create: createMock } }));
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
    // No https origin: no statusCallback, so these tests see Twilio's call exactly as before.
    delete process.env.API_ORIGIN;
    deliveryService = { recordSend: jest.fn() };
    service = new WhatsappService(deliveryService as never);
  });

  it('sends a message to a normalized phone number and returns true', async () => {
    createMock.mockResolvedValue({ sid: 'SM123' });

    const result = await service.sendMessage('+54 9 11 2233-4455', 'Hola!');

    expect(result).toBe(true);
    expect(createMock).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+5491122334455',
      body: 'Hola!',
    });
  });

  it('returns false and never calls Twilio when the phone cannot be normalized', async () => {
    const result = await service.sendMessage('not a phone number', 'Hola!');

    expect(result).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns false when the Twilio API call throws', async () => {
    createMock.mockRejectedValue(new Error('Twilio is down'));

    const result = await service.sendMessage('+5491122334455', 'Hola!');

    expect(result).toBe(false);
  });

  it('returns false, without throwing, when the Twilio client fails to construct', async () => {
    mockTwilioConstructor.mockImplementationOnce(() => {
      throw new Error('Authentication Error - invalid username');
    });

    const result = await service.sendMessage('+5491122334455', 'Hola!');

    expect(result).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('does not attempt to construct the Twilio client during instantiation', () => {
    mockTwilioConstructor.mockClear();

    new WhatsappService(deliveryService as never);

    expect(mockTwilioConstructor).not.toHaveBeenCalled();
  });
  describe('sendTemplate', () => {
    const message = {
      templateSid: 'HX123',
      variables: { '1': 'María', '2': 'tok-1' },
      fallbackBody: 'Hola María, entrá acá: https://x/r/tok-1',
    };

    it('sends the approved template with stringified variables and no body', async () => {
      createMock.mockResolvedValue({ sid: 'SM123' });

      const result = await service.sendTemplate('+5491122334455', message);

      expect(result).toBe(true);
      expect(createMock).toHaveBeenCalledWith({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+5491122334455',
        contentSid: 'HX123',
        contentVariables: JSON.stringify({ '1': 'María', '2': 'tok-1' }),
      });
    });

    it('falls back to the freeform body when no template SID is configured', async () => {
      createMock.mockResolvedValue({ sid: 'SM123' });

      const result = await service.sendTemplate('+5491122334455', { ...message, templateSid: undefined });

      expect(result).toBe(true);
      expect(createMock).toHaveBeenCalledWith({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+5491122334455',
        body: 'Hola María, entrá acá: https://x/r/tok-1',
      });
    });

    it('returns false when the phone cannot be normalized', async () => {
      const result = await service.sendTemplate('not a phone number', message);

      expect(result).toBe(false);
      expect(createMock).not.toHaveBeenCalled();
    });

    it('returns false when Twilio rejects the template send', async () => {
      createMock.mockRejectedValue(new Error('Content SID not found'));

      const result = await service.sendTemplate('+5491122334455', message);

      expect(result).toBe(false);
    });
  });
  describe('delivery tracking', () => {
    const context = { reservationId: 'res-1', kind: 'CHECKIN_LINK' as const };

    it('records an accepted send with its Twilio SID and status', async () => {
      createMock.mockResolvedValue({ sid: 'SM123', status: 'queued' });

      await service.sendMessage('+5491122334455', 'Hola!', context);

      expect(deliveryService.recordSend).toHaveBeenCalledWith(context, {
        accepted: true,
        twilioSid: 'SM123',
        status: 'queued',
      });
    });

    it('records a Twilio refusal as rejected, with Twilio\'s error code', async () => {
      createMock.mockRejectedValue(Object.assign(new Error('Not a WhatsApp number'), { code: 63003 }));

      const result = await service.sendMessage('+5491122334455', 'Hola!', context);

      expect(result).toBe(false);
      expect(deliveryService.recordSend).toHaveBeenCalledWith(context, {
        accepted: false,
        errorCode: '63003',
        errorMessage: 'Not a WhatsApp number',
      });
    });

    it('records an invalid phone as rejected without calling Twilio', async () => {
      await service.sendMessage('not a phone', 'Hola!', context);

      expect(createMock).not.toHaveBeenCalled();
      expect(deliveryService.recordSend).toHaveBeenCalledWith(context, expect.objectContaining({ accepted: false }));
    });

    it('records nothing when no context is given', async () => {
      createMock.mockResolvedValue({ sid: 'SM123' });

      await service.sendMessage('+5491122334455', 'Hola!');

      expect(deliveryService.recordSend).not.toHaveBeenCalled();
    });

    it('registers the status callback only for an https API origin', async () => {
      createMock.mockResolvedValue({ sid: 'SM123' });
      process.env.API_ORIGIN = 'https://api.labrisa.com.ar/';

      await service.sendMessage('+5491122334455', 'Hola!', context);

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ statusCallback: 'https://api.labrisa.com.ar/webhooks/twilio/whatsapp-status' }),
      );

      createMock.mockClear();
      process.env.API_ORIGIN = 'http://localhost:3001';

      await service.sendMessage('+5491122334455', 'Hola!', context);

      expect(createMock.mock.calls[0][0]).not.toHaveProperty('statusCallback');
    });
  });
});
