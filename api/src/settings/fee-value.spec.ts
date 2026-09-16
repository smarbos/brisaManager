import { parsePercentage, resolveFeeAmount } from './fee-value';

describe('resolveFeeAmount', () => {
  it('resolves a percentage value against the total', () => {
    expect(resolveFeeAmount('30%', 100000)).toBe(30000);
  });

  it('resolves a fixed value regardless of the total', () => {
    expect(resolveFeeAmount('150000', 100000)).toBe(150000);
  });

  it('rounds a percentage result to 2 decimal places', () => {
    expect(resolveFeeAmount('30%', 123456.78)).toBe(37037.03);
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(resolveFeeAmount(' 30% ', 100000)).toBe(30000);
    expect(resolveFeeAmount(' 150000 ', 100000)).toBe(150000);
  });

  it('treats an unparseable value as 0 rather than throwing', () => {
    expect(resolveFeeAmount('not a number', 100000)).toBe(0);
    expect(resolveFeeAmount('%', 100000)).toBe(0);
  });
});

describe('parsePercentage', () => {
  it('returns the numeric percentage when the value ends with %', () => {
    expect(parsePercentage('30%')).toBe(30);
  });

  it('returns null for a fixed amount', () => {
    expect(parsePercentage('150000')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parsePercentage(' 30% ')).toBe(30);
  });
});
