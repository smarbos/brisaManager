import { defaultPaymentRequests, paymentsSettled } from './payment-requests';

describe('defaultPaymentRequests', () => {
  it.each(['BOOKING', 'DIRECT', 'OTHER'] as const)('asks for the payment and the deposit on %s reservations', (source) => {
    expect(defaultPaymentRequests(source)).toEqual({ askForPayment: true, askForDeposit: true });
  });

  // Airbnb guests pay through Airbnb, which doesn't allow collecting payment outside it.
  it('asks for nothing on Airbnb reservations', () => {
    expect(defaultPaymentRequests('AIRBNB')).toEqual({ askForPayment: false, askForDeposit: false });
  });
});

describe('paymentsSettled', () => {
  const received = new Date();

  it.each([
    // askForPayment, askForDeposit, payment, deposit, settled
    [false, false, null, null, true],
    [true, false, null, null, false],
    [true, false, received, null, true],
    [false, true, received, null, false],
    [false, true, null, received, true],
    [true, true, received, null, false],
    [true, true, null, received, false],
    [true, true, received, received, true],
  ])('ask payment %s, ask deposit %s, received %p / %p: %s', (askForPayment, askForDeposit, payment, deposit, settled) => {
    expect(
      paymentsSettled({ askForPayment, askForDeposit, confirmationPaymentReceivedAt: payment, depositReceivedAt: deposit }),
    ).toBe(settled);
  });
});
