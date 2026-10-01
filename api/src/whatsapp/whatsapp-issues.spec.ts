import {
  computeWhatsappIssues,
  LatestWhatsappMessage,
} from './whatsapp-issues';

const now = new Date('2026-10-01T12:00:00Z');
const futureStay = {
  checkIn: new Date('2026-10-10'),
  datesConfirmedAt: null,
  confirmationPaymentReceivedAt: null,
};

function message(
  kind: LatestWhatsappMessage['kind'],
  status: string,
  errorCode: string | null = null,
) {
  return { kind, status, errorCode, createdAt: now };
}

describe('computeWhatsappIssues', () => {
  it('flags rejected and undelivered messages, with their error code', () => {
    const issues = computeWhatsappIssues(
      futureStay,
      [
        message('CHECKIN_LINK', 'undelivered', '63016'),
        message('DEPOSIT_REMINDER', 'rejected'),
      ],
      now,
    );

    expect(issues).toEqual([
      { kind: 'CHECKIN_LINK', status: 'undelivered', errorCode: '63016' },
      { kind: 'DEPOSIT_REMINDER', status: 'rejected', errorCode: null },
    ]);
  });

  it('does not flag messages that are in flight or delivered', () => {
    const issues = computeWhatsappIssues(
      futureStay,
      [
        message('CHECKIN_LINK', 'sent'),
        message('RESERVATION_REMINDER', 'delivered'),
      ],
      now,
    );

    expect(issues).toEqual([]);
  });

  it('drops a failed check-in link once the guest has confirmed their dates', () => {
    const issues = computeWhatsappIssues(
      { ...futureStay, datesConfirmedAt: new Date('2026-09-30') },
      [message('CHECKIN_LINK', 'undelivered')],
      now,
    );

    expect(issues).toEqual([]);
  });

  it('drops a failed deposit reminder once the confirmation payment is received', () => {
    const issues = computeWhatsappIssues(
      { ...futureStay, confirmationPaymentReceivedAt: new Date('2026-09-30') },
      [message('DEPOSIT_REMINDER', 'failed')],
      now,
    );

    expect(issues).toEqual([]);
  });

  it('drops a failed reservation reminder once the stay has started', () => {
    const issues = computeWhatsappIssues(
      { ...futureStay, checkIn: new Date('2026-09-28') },
      [message('RESERVATION_REMINDER', 'undelivered')],
      now,
    );

    expect(issues).toEqual([]);
  });
});
