import { jest } from '@jest/globals';

const state = { queue_open: false, firsts_first: false };

const queueClear = jest.fn();
const turnsClear = jest.fn();
const settingsSet = jest.fn();
const settingsGet = jest.fn();
const abbadabbabotSay = jest.fn();

jest.unstable_mockModule('../commands/db.js', () => ({
  queue_db: { clear: queueClear },
  turns_db: { clear: turnsClear },
  settings_db: { set: settingsSet, get: settingsGet }
}));

jest.unstable_mockModule('../utils.js', () => ({
  abbadabbabotSay
}));

jest.unstable_mockModule('../constants.js', () => ({
  state
}));

const {
  handleOpenCommand,
  handleCloseCommand,
  handleFirstsFirstCommand,
  handleClearAllCommand,
  handleClearTurnsCommand,
  handleClearCommand
} = await import('../commands/queueManagement.js');

function createContext() {
  return { client: { say: jest.fn() }, io: { emit: jest.fn() }, tags: { username: 'user' } };
}

describe('queue management commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.queue_open = false;
    state.firsts_first = false;
  });

  test('handleOpenCommand opens queue and announces', async () => {
    const { client, io, tags } = createContext();
    await handleOpenCommand('#chan', tags, client, io);
    expect(state.queue_open).toBe(true);
    expect(settingsSet).toHaveBeenCalledWith('queue_open', true);
    expect(abbadabbabotSay).toHaveBeenCalledWith('#chan', client, tags, 'formally announce the opening of the queue to the chat');
    expect(io.emit).toHaveBeenCalledWith('new_turn', 'Queue Just Opened');
  });

  test('handleCloseCommand closes queue and announces', async () => {
    const { client, io, tags } = createContext();
    await handleCloseCommand('#chan', tags, client, io);
    expect(state.queue_open).toBe(false);
    expect(settingsSet).toHaveBeenCalledWith('queue_open', false);
    expect(abbadabbabotSay).toHaveBeenCalledWith('#chan', client, tags, 'formally announce the closing of the queue to the chat');
    expect(io.emit).toHaveBeenCalledWith('new_turn', 'Queue Closed');
  });

  test('handleFirstsFirstCommand toggles mode', async () => {
    const { client } = createContext();
    await handleFirstsFirstCommand('#chan', {}, client);
    expect(state.firsts_first).toBe(true);
    expect(client.say).toHaveBeenCalledWith('#chan', expect.stringContaining('ACTIVATED'));
    await handleFirstsFirstCommand('#chan', {}, client);
    expect(state.firsts_first).toBe(false);
    expect(client.say).toHaveBeenCalledWith('#chan', expect.stringContaining('DEACTIVATED'));
  });

  test('handleClearAllCommand clears queue and turns', async () => {
    const { client, io, tags } = createContext();
    await handleClearAllCommand('#chan', tags, client, io);
    expect(queueClear).toHaveBeenCalled();
    expect(turnsClear).toHaveBeenCalled();
    expect(abbadabbabotSay).toHaveBeenCalledWith('#chan', client, tags, 'formally announce the clearing of the queue and turns to the chat');
    expect(io.emit).toHaveBeenCalledWith('new_turn', 'Turns Cleared');
  });

  test('handleClearTurnsCommand clears turns', async () => {
    const { client, io, tags } = createContext();
    await handleClearTurnsCommand('#chan', tags, client, io);
    expect(turnsClear).toHaveBeenCalled();
    expect(abbadabbabotSay).toHaveBeenCalledWith('#chan', client, tags, 'formally announce that turns have been reset');
    expect(io.emit).toHaveBeenCalledWith('new_turn', 'Turns Cleared');
  });

  test('handleClearCommand clears queue', async () => {
    const { client, tags } = createContext();
    await handleClearCommand('#chan', tags, client);
    expect(queueClear).toHaveBeenCalled();
    expect(abbadabbabotSay).toHaveBeenCalledWith('#chan', client, tags, 'formally announce the clearing of the queue to the chat');
  });
});
