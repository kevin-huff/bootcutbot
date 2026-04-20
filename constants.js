import dotenv from 'dotenv';
import { JsoningPg } from './lib/jsoningPg.js';

dotenv.config();

const settings_db = new JsoningPg('queue_settings');
let queueOpen = await settings_db.get('queue_open');
if (queueOpen === null || queueOpen === undefined) {
  queueOpen = false;
  await settings_db.set('queue_open', queueOpen);
}

let firstsFirst = await settings_db.get('firsts_first');
if (firstsFirst === null || firstsFirst === undefined) {
  firstsFirst = true;
  await settings_db.set('firsts_first', firstsFirst);
}

let virginsFirst = await settings_db.get('virgins_first');
if (virginsFirst === null || virginsFirst === undefined) {
  virginsFirst = false;
  await settings_db.set('virgins_first', virginsFirst);
}

export const state = {
  current_turn: "None... yet",
  active_splot: null,
  end_time: 1708317900,
  queue_open: queueOpen,
  firsts_first: firstsFirst,
  virgins_first: virginsFirst,
  ai_enabled: true,
  death_count: 0,
  laugh_regex: /\b(l(?:mao|o+l|mfao|ul)|ro(?:fl(?:mao)?)|h[ae]h[ae]+|kek(?:w)?|lel|lolwut|LUL|KEKW|OMEGALUL|4Head|EleGiggle|Jebaited|HeyGuys)\b/gi,
  fart_regex: /\b(?:!?fart|toot|poot|fluff|whoopee|rip\s+one|break\s+wind|cut\s+the\s+cheese|pass\s+gas|queef|dutch\s+oven)\b/gi,
  moan_regex: /\b(m(?:oan|mm+)|groan|whin(?:e|ing)|sigh|grunt|whimper|abbaboxDownbad|KappaPride|gachiGASM)\b/gi,
  clap_regex: /\b(abbaboxClap|clap(?:s|ped)?|👏|o7|PogChamp|KappaClaus|FrankerZ|PogU|Pog(?:Bones|Off)?)\b/gi,
  boo_regex: /\b(?:!?bo{2,}(?:ing)?|hiss(?:ing)?|boohoo|boos|jeer(?:ing)?|heckle|abbaboxSeethe|BibleThump|NotLikeThis|FailFish|DansGame)\b/gi,
};
