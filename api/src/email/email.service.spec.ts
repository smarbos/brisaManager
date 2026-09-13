jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

import { Resend } from 'resend';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let sendMock: jest.Mock;

  beforeEach(() => {
    process.env.EMAIL_FROM = 'reservas@labrisa.com.ar';
    process.env.ALERT_EMAIL = 'owner@labrisa.com.ar';
    service = new EmailService();
    sendMock = (Resend as unknown as jest.Mock).mock.results[
      (Resend as unknown as jest.Mock).mock.results.length - 1
    ].value.emails.send;
  });

  it('sends the initial confirmation email', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(
      service.sendInitialConfirmationEmail('guest@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc'),
    ).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'guest@example.com' }));
  });

  it('throws when Resend returns an error for the initial email', async () => {
    sendMock.mockResolvedValue({ error: { message: 'bounced' } });

    await expect(
      service.sendInitialConfirmationEmail('bad@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc'),
    ).rejects.toThrow('bounced');
  });

  it('sends the final confirmation email', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(service.sendFinalConfirmationEmail('guest@example.com', 'Jane Doe')).resolves.toBeUndefined();
  });

  it('sendAlert never throws even if Resend fails', async () => {
    sendMock.mockRejectedValue(new Error('network error'));

    await expect(service.sendAlert('Something failed', 'details here')).resolves.toBeUndefined();
  });
});
