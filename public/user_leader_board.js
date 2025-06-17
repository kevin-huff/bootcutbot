import * as socketEvents from './leader_board_modules/socketEvents.js';
import * as domActions from './leader_board_modules/domActions.js';
import * as utils from './leader_board_modules/utils.js';

const social_scores = window.socialScoresData;

document.addEventListener('DOMContentLoaded', function () {
socketEvents.initializeSocketEvents(social_scores);
domActions.initializeDOMActions();
utils.updateLeaderboard(social_scores,1000);
});