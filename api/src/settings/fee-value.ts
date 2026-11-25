// A fee Settings value ("confirmationPaymentValue" / "securityDepositValue") is either a
// plain ARS amount ("210000") or a percentage of the reservation's total ("30%") — the
// admin types whichever makes sense, and this is how it's resolved for a real reservation.

export function resolveFeeAmount(raw: string, totalAmount: number): number {
  const trimmed = raw.trim();

  if (trimmed.endsWith('%')) {
    const percentage = Number(trimmed.slice(0, -1));
    if (Number.isNaN(percentage)) {
      return 0;
    }
    return Math.round(totalAmount * (percentage / 100) * 100) / 100;
  }

  const fixed = Number(trimmed);
  return Number.isNaN(fixed) ? 0 : fixed;
}

// Returns the percentage a value represents, or null when it's a fixed amount instead —
// used to decide whether a guest-facing label should show "(30%)" at all.
export function parsePercentage(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed.endsWith('%')) {
    return null;
  }
  const percentage = Number(trimmed.slice(0, -1));
  return Number.isNaN(percentage) ? null : percentage;
}

// The currency a resolved fee is shown in: a percentage is part of the total, so it's in the
// reservation's currency; a fixed amount is always typed in pesos (Settings says so), even on a
// USD reservation.
export function feeCurrency(raw: string, reservationCurrency: string): string {
  return parsePercentage(raw) === null ? 'ARS' : reservationCurrency;
}
