import dotenv from 'dotenv';
import jsoning from 'jsoning';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const settings_db = new jsoning(join(__dirname, 'db/queue_settings.json'));
let queueOpen = await settings_db.get('queue_open');
if (queueOpen === undefined) {
  queueOpen = false;
  await settings_db.set('queue_open', queueOpen);
}

export const state = {
  current_turn: "None... yet",
  end_time: 1708317900,
  queue_open: queueOpen,
  firsts_first: true,
  ai_enabled: true,
  death_count: 0,
  laugh_regex: /\b(l(?:mao|o+l|mfao|ul)|ro(?:fl(?:mao)?)|h[ae]h[ae]+|kek(?:w)?|lel|lolwut|LUL|KEKW|OMEGALUL|4Head|EleGiggle|Jebaited|HeyGuys)\b/gi,
  fart_regex: /\b(?:!?fart|toot|poot|fluff|whoopee|rip\s+one|break\s+wind|cut\s+the\s+cheese|pass\s+gas|queef|dutch\s+oven)\b/gi,
  moan_regex: /\b(m(?:oan|mm+)|groan|whin(?:e|ing)|sigh|grunt|whimper|abbaboxDownbad|KappaPride|gachiGASM)\b/gi,
  clap_regex: /\b(abbaboxClap|clap(?:s|ped)?|👏|o7|PogChamp|KappaClaus|FrankerZ|PogU|Pog(?:Bones|Off)?)\b/gi,
  boo_regex: /\b(?:!?bo{2,}(?:ing)?|hiss(?:ing)?|boohoo|boos|jeer(?:ing)?|heckle|abbaboxSeethe|BibleThump|NotLikeThis|FailFish|DansGame)\b/gi,
};
