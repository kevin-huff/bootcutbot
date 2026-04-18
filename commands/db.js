import { JsoningPg } from '../lib/jsoningPg.js';

// Namespaces mirror the old db/<name>.json filenames (minus extension).
const settings_db = new JsoningPg('queue_settings');
const queue_db = new JsoningPg('queue');
const turns_db = new JsoningPg('turns');
const deaths_db = new JsoningPg('deaths');
const ratings_db = new JsoningPg('ratings');
const historical_turns_db = new JsoningPg('historical_turns');
const crowd_sound_db = new JsoningPg('crowd_sounds');

// Lock mechanism for concurrent operations
const lock = { isLocked: false };

async function acquireLock() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (!lock.isLocked) {
        lock.isLocked = true;
        resolve();
      } else {
        setTimeout(tryAcquire, 10);
      }
    };
    tryAcquire();
  });
}

function releaseLock() {
  lock.isLocked = false;
}

export {
  settings_db,
  queue_db,
  turns_db,
  deaths_db,
  ratings_db,
  historical_turns_db,
  crowd_sound_db,
  acquireLock,
  releaseLock
};
