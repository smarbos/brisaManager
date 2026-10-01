const createMock = jest.fn();
const mockTwilioConstructor = jest.fn().mockImplementation(() => ({ messages: { create: createMock } }));

jest.mock('twilio', () => mockTwilioConstructor);

import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  let service: WhatsappService;

  beforeEach(() => {
    createMock.mockReset();
    mockTwilioConstructor.mockClear();
    mockTwilioConstructor.mockImplementation(() => ({ messages: { create: createMock } }));
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
    service = new WhatsappService();
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

    new WhatsappService();

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
});
