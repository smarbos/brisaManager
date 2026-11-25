import { ReservationSource } from '../reservations/types';

// What a new reservation asks the guest to transfer, by channel — the same starting values as
// the API's payment-requests.ts.
export function defaultPaymentRequests(source: ReservationSource) {
  const asked = source !== 'AIRBNB';
  return { askForPayment: asked, askForDeposit: asked };
}
