import { ordinal_suffix_of, sayBoardCommand } from '../utils.js';

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

describe('sayBoardCommand', () => {
  const fakeClient = () => {
    const calls = [];
    return { calls, say: async (...args) => { calls.push(args); } };
  };

  test.each(['!ap', '!random', '!next'])('posts %s to the channel', async (command) => {
    const client = fakeClient();
    await sayBoardCommand(client, '#abbabox', command);
    expect(client.calls).toEqual([['#abbabox', command]]);
  });

  test('refuses anything else and posts nothing', async () => {
    const client = fakeClient();
    await expect(sayBoardCommand(client, '#abbabox', '!clear_all')).rejects.toThrow('Not a board command');
    await expect(sayBoardCommand(client, '#abbabox', undefined)).rejects.toThrow('Not a board command');
    expect(client.calls).toEqual([]);
  });
});
