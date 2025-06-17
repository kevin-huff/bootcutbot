import * as socketEvents from './youtube_modules/socketEvents.js';
import * as domActions from './youtube_modules/domActions.js';
import * as utils from './youtube_modules/utils.js';

const social_scores = window.socialScoresData;

document.addEventListener('DOMContentLoaded', function () {
  socketEvents.initializeSocketEvents(social_scores);
  domActions.initializeDOMActions(social_scores);
  utils.countVideos();
});
