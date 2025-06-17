import * as domActions from "./domActions.js";
import * as utils from "./utils.js";

export const socket = io();
console.log(domActions);
export function initializeSocketEvents(social_scores) {
  var socket = io();
  socket.on("connect", () => {
    console.log(socket.connected); // true
  });
  socket.on("youtube_added", function (youtube) {
    console.log("youtube_added");
    utils.addYoutube(youtube);
    utils.countVideos();
  });
  socket.on("youtube_remove", function (thumbnail_url) {
    console.log("youtube_deleted");
    domActions.deleteYoutube(thumbnail_url);
  });

  socket.on("update_youtube_moderated", function (thumbnail_url) {
    console.log("update_youtube_moderated");
    domActions.mark_safe(thumbnail_url);
  });
  socket.on("boo_threshold", function (boo_threshold) {
    console.log("boo_threshold met");
    const boo_sound = document.getElementById(`boo`);
    boo_sound.volume = 0.5;
    boo_sound.play();
  });
  socket.on("newRating", (username, rating) => {
    // Get the existing leaderboard array
    const oldLeaderboardArray = utils.getLeaderboardArray(social_scores);
  
    // Update the social_scores object with the new rating
    if (!social_scores[username]) {
      social_scores[username] = [];
    }
    social_scores[username].push(rating);
  
    // Get the previous weighted rating and rank for the user, or set them to null if the user has no previous rating
    let previousRank = null;
    let previousWeightedRating = null;
    const userEntry = oldLeaderboardArray.find((entry) => entry[0] === username);
    if (userEntry) {
      previousRank = oldLeaderboardArray.findIndex((entry) => entry[0] === username) + 1;
      previousWeightedRating = userEntry[3];
    } else {
      previousWeightedRating = null;
    }
  
    // Call the updateLeaderboard function to refresh the leaderboard
    utils.updateLeaderboard(social_scores);
  
    // Calculate the user's current rank and weighted rating
    const currentLeaderboardArray = utils.getLeaderboardArray(social_scores);
    const currentRank = currentLeaderboardArray.findIndex((entry) => entry[0] === username) + 1;
    const currentWeightedRating = currentLeaderboardArray.find((entry) => entry[0] === username)[3];
  
    // Show the modal with the user's information
    domActions.showModal(username, currentWeightedRating, currentRank, previousWeightedRating, previousRank, rating);
  });
}
