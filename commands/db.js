import jsoning from 'jsoning';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database instances
const settings_db = new jsoning(join(__dirname, "../db/queue_settings.json"));
const queue_db = new jsoning(join(__dirname, "../db/queue.json"));
const turns_db = new jsoning(join(__dirname, "../db/turns.json"));
const deaths_db = new jsoning(join(__dirname, "../db/deaths.json"));
const ratings_db = new jsoning(join(__dirname, "../db/ratings.json"));
const historical_turns_db = new jsoning(join(__dirname, "../db/historical_turns.json"));
const crowd_sound_db = new jsoning(join(__dirname, "../db/crowd_sounds.json"));

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
