import { ordinal_suffix_of } from '../utils.js';

describe('ordinal_suffix_of', () => {
  const cases = [
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [22, '22nd'],
    [103, '103rd'],
  ];

  test.each(cases)('returns correct suffix for %i', (input, expected) => {
    expect(ordinal_suffix_of(input)).toBe(expected);
  });
});
