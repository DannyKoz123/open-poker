// Chip unit = 1 cent. All chip values in the engine are integer cents.
// These helpers format cent values for display.

const stakeFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format a blind level (in cents) as a dollar string like "0.05" or "10". */
export function formatStake(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) && dollars >= 1
    ? wholeFmt.format(dollars)
    : stakeFmt.format(dollars);
}

/** Format a stake pair as "sb/bb". */
export function formatStakePair(smallBlind: number, bigBlind: number): string {
  return `${formatStake(smallBlind)}/${formatStake(bigBlind)}`;
}

const chipFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a chip count (in cents) as a dollar string like "$1.50" or "$200.00". */
export function formatChips(cents: number): string {
  return chipFmt.format(cents / 100);
}

/** Convert a dollar amount to integer cents. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Convert integer cents to a dollar amount. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}
