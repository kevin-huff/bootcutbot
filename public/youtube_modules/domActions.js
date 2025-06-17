import * as utils from "./utils.js";
import { socket } from "./socketEvents.js";

const effects = [
  "slide",
  "clip",
  "fade",
  "blind",
  "explode",
  "puff",
  "fold",
  "scale",
  "drop",
  "bounce",
];

export function initializeDOMActions(social_scores) {
  var row;
  // Set up event handler for when the user clicks a star
  $(document).on("click", ".rating-button", function () {
    console.log("star click");
    var rating = $(this).data("value");
    var videoId = $(this).data("id");
    var rating = $("input[name='rating']:checked").val();
    $("#video-id").val(videoId); // set the value of the hidden input field to the video ID
    console.log("rating set", rating);
    $(".star").removeClass("selected");
    $(this).addClass("selected");
  });
  // Add event listener for the remove-youtube-btn class
  $(document).on("click", ".remove-youtube-btn", function () {
    const videoId = $(this).data("video-id");
    removeYoutube(videoId);
  });
  // Add event listener for the remove-youtube-btn class
  $(document).on("click", ".watch-youtube-btn", function () {
    const videoId = $(this).data("video-id");
    watchYoutube(videoId);
  });
  // Set up event handler for when the user clicks the "Submit" button
  $(document).on("click", "#submitRating", function () {
    var rating = $("input[name='rating']:checked").val();
    var id = $("#rateModal").data("id"); // Get the id value
    console.log("id", id);
    if (rating >= 0 && id) {
      var username = $("#username").val();
      console.log("username", username);
      console.log("rating", rating);
      $("#rateModal").modal("hide");
      socket.emit(
        "rateUser",
        {
          username: username,
          rating: rating,
        },
        function (response) {
          console.log("rateUser response:", response);
          // Do something with the response from the server, if needed
        }
      );
    }
  });
  $("#shuffle").click(function () {
    shuffleCards();
  });
  $("#make_fair").click(function () {
    makeFair(social_scores);
  });
  $("#social_sort").click(function () {
    socialSort(social_scores);
  });
  utils.updateLeaderboard(social_scores);
}

export function shuffleCards() {
  console.log('shuffleCards');
  const countdown = document.getElementById(`countdown`);
  countdown.volume = 0.5;
  countdown.play();
  // Get a reference to the container element
  const container = document.querySelector("#youtube_videos");

  // Get an array of all the cards inside the container element
  const cards = Array.from(container.querySelectorAll(".col"));

  // Fisher-Yates Shuffle algorithm
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  const numCards = cards.length;
  const totalTime = 25000; // 25 seconds in milliseconds
  const delayIncrement = totalTime / numCards;
  const animationDuration = 5000; // 5 seconds in milliseconds
  let cardsAnimated = 0; // Counter for the number of cards that have finished animating
  // randomly select a jquery ui effect
  var effect = effects[Math.floor(Math.random() * effects.length)];
  // Loop through the shuffled array and append each card to the container element with animation
  cards.forEach((card, index) => {
    // randomly select a jquery ui effect
    var effect = effects[Math.floor(Math.random() * effects.length)];
    $(card)
      .delay(delayIncrement * index)
      .hide(effect, {}, animationDuration, function () {
        container.appendChild(card);
        $(card).show(effect, {}, animationDuration, function () {
          // Increment the counter when the animation completes
          cardsAnimated++;

          // If all the cards have finished animating, enable the click handlers
          if (cardsAnimated === numCards) {
            enableClickHandlers();
          }
        });
      });
    // Disable the click handlers while the animations are running
    disableClickHandlers();
  });

  utils.countVideos();
}

export function makeFair(social_scores) {
  const countdown = document.getElementById(`countdown`);
  countdown.volume = 0.5;
  countdown.play();

  const container = document.querySelector("#youtube_videos");
  const cards = Array.from(container.querySelectorAll(".col"));

  const shuffledCards = [];
  let lastUsername = [];
  const numRatings = new Map();
  Object.entries(social_scores).forEach(([user, ratings]) => {
    numRatings.set(user, ratings.length);
  });

  while (cards.length > 0) {
    const filteredCards = cards.filter((card) => {
      const usernameElement = card.querySelector(".username");
      return usernameElement && usernameElement.textContent !== lastUsername;
    });

    if (filteredCards.length === 0) {
      lastUsername = "";
      continue;
    }

    filteredCards.sort((a, b) => {
      const aUsername = a.querySelector(".username").textContent;
      const bUsername = b.querySelector(".username").textContent;
      const aNumRatings = numRatings.get(aUsername) || 0;
      const bNumRatings = numRatings.get(bUsername) || 0;
      return aNumRatings - bNumRatings;
    });

    const userWithFewestRatings =
      filteredCards[0].querySelector(".username").textContent;
    const cardsFromUser = filteredCards.filter((card) => {
      return (
        card.querySelector(".username").textContent === userWithFewestRatings
      );
    });
    const chosenCard =
      cardsFromUser[Math.floor(Math.random() * cardsFromUser.length)];

    const index = cards.indexOf(chosenCard);
    cards.splice(index, 1);

    shuffledCards.push(chosenCard);
    lastUsername = chosenCard.querySelector(".username").textContent;
    const user = lastUsername;
    const numRatingsForUser = numRatings.get(user) || 0;
    numRatings.set(user, numRatingsForUser + 1);
  }

  container.innerHTML = "";

  const numCards = shuffledCards.length;
  const totalTime = 25000;
  const delayIncrement = totalTime / numCards;
  const animationDuration = 5000;
  let cardsAnimated = 0;

  shuffledCards.forEach((card, index) => {
    // randomly select a jquery ui effect
    var effect = effects[Math.floor(Math.random() * effects.length)];
    $(card)
      .delay(delayIncrement * index)
      .hide(effect, {}, animationDuration, function () {
        container.appendChild(card);
        $(card).show(effect, {}, animationDuration, function () {
          cardsAnimated++;

          if (cardsAnimated === numCards) {
            enableClickHandlers();
          }
        });
      });
    disableClickHandlers();
  });
}

export function socialSort(social_scores) {
  const countdown = document.getElementById(`countdown`);
  countdown.volume = 0.5;
  countdown.play();
  // Get a reference to the container element
  const container = document.querySelector("#youtube_videos");

  // Get an array of all the cards inside the container element
  const cards = Array.from(container.querySelectorAll(".col"));

  // Sort the cards based on the user's average rating
  cards.sort((card1, card2) => {
    const user1 = card1.querySelector(".username").textContent;
    const user2 = card2.querySelector(".username").textContent;

    const user1Rating = social_scores[user1] || [];
    const user2Rating = social_scores[user2] || [];

    const user1Average =
      user1Rating.reduce((sum, rating) => sum + parseFloat(rating), 0) /
      user1Rating.length;
    const user2Average =
      user2Rating.reduce((sum, rating) => sum + parseFloat(rating), 0) /
      user2Rating.length;

    if (isNaN(user1Average)) {
      return 1;
    }
    if (isNaN(user2Average)) {
      return -1;
    }
    return user2Average - user1Average;
  });

  const numCards = cards.length;
  const totalTime = 25500; // 30 seconds in milliseconds
  const delayIncrement = totalTime / numCards;
  const animationDuration = 5000; // 2 seconds in milliseconds
  let cardsAnimated = 0; // Counter for the number of cards that have finished animating
  // Loop through the sorted array and append each card to the container element with animation
  cards.forEach((card, index) => {
    // randomly select a jquery ui effect
    var effect = effects[Math.floor(Math.random() * effects.length)];
    $(card)
      .delay(delayIncrement * index)
      .hide(effect, {}, animationDuration, function () {
        container.appendChild(card);
        $(card).show(effect, {}, animationDuration, function () {
          // Increment the counter when the animation completes
          cardsAnimated++;

          // If all the cards have finished animating, enable the click handlers
          if (cardsAnimated === numCards) {
            enableClickHandlers();
          }
        });
      });
  });
  // Disable the click handlers while the animations are running
  disableClickHandlers();
  utils.countVideos();
}
export function removeYoutube(id) {
  var row = document.getElementById("row_" + id);
  var thumbnail_url = row.getElementsByTagName("img")[0].src;
  $("#row_" + id).toggle("explode", function () {
    row.remove();
    socket.emit("youtube_deleted", id, (response) => {
      console.log(response);
    });
    utils.countVideos();
  });
}

export function watchYoutube(id) {
  console.log("in watch youtube");
  var row = document.getElementById("row_" + id);

  // Show the rating modal dialog
  var rateModal = $("#rateModal");
  rateModal.attr("data-id", id); // Set the data-id attribute
  rateModal.modal("show");

  // Set the username in the modal dialog
  $("#rateModalLabel").text(
    "Rate this video for " + $(row).find(".username").text()
  );
  $("#username").val($(row).find(".username").text());
  $("#row_" + id).toggle("explode", function () {
    row.remove();
    const username = $(row).find(".username").text();
    const timestamp = new Date().toISOString();
    socket.emit("youtube_watched", id, username, timestamp, (response) => {
      console.log("youtube_watched_response", response);
      utils.updateWatchCount(response);
    });
    window.open("https://www.youtube.com/watch?v=" + id, "_blank");
    utils.countVideos();
  });
}


export function moderateYoutube(id) {
  var row = document.getElementById("row_" + id);
  var thumbnail_url = row.getElementsByTagName("img")[0].src;
  socket.emit("youtube_moderated", thumbnail_url, (response) => {
    console.log(response);
  });
}

export function mark_safe(thumbnail_url) {
  socket.emit("youtube_mark_safe", (response) => {
    console.log(response);
  });
}
export function deleteYoutube(thumbnail_url) {
  $("img[src='" + thumbnail_url + "']")
    .closest(".col")
    .fadeOut(300, function () {
      $(this).remove();
    });
  utils.countVideos();
}
export function showModal(
  username,
  weightedRating,
  rank,
  prevWeightedRating,
  prevRank,
  rating
) {
  const ratingModal = document.getElementById("rating-modal");
  if (!ratingModal) {
    // Handle the case where the element does not exist
    return;
  }

  const usernameSpan = document
    .getElementById("rating-username")
    ?.querySelector("span");
  const weightedRatingSpan = document
    .getElementById("rating-weighted")
    ?.querySelector("span");
  const rankSpan = document.getElementById("rating-rank")?.querySelector("span");
  const ratingChangeSpan = document
    .getElementById("rating-change-rating")
    ?.querySelector("span");
  const rankChangeSpan = document
    .getElementById("rating-change-rank")
    ?.querySelector("span");
  const thisRatingSpan = document.getElementById("this-rating");

  // Check if the elements exist before setting their textContent property
  if (usernameSpan) {
    usernameSpan.textContent = username;
  }
  if (weightedRatingSpan) {
    weightedRatingSpan.textContent = weightedRating.toFixed(2);
  }
  if (rankSpan) {
    rankSpan.textContent = rank;
  }
  if (thisRatingSpan) {
    thisRatingSpan.textContent = rating;
  }
  // Calculate the rating change and display it in the modal dialog
  if (ratingChangeSpan) {
    const ratingChange = (weightedRating - prevWeightedRating).toFixed(2);
    const ratingChangeText =
      ratingChange > 0 ? `(+${ratingChange})` : `(${ratingChange})`;
    ratingChangeSpan.textContent = ratingChangeText;
  }

  if (rankChangeSpan) {
    // Convert prevRank to a number if it's an array
    const previousRank = Array.isArray(prevRank) ? prevRank[prevRank.length - 1] : prevRank;
    console.log('previousRank', previousRank);
    console.log('currentRank', rank);
    let rankChangeText;
    if (previousRank && rank) {
      // Calculate the rank change when there is a previous rank and a new rank
      const rankChange = previousRank - rank;
      console.log('rankChange', rankChange);
      rankChangeText = rankChange > 0 ? `(+${rankChange})` : `(${Math.abs(rankChange)})`;
    } else if (!previousRank && rank) {
      // The user didn't have a rank before, so the entire rank is their gain
      rankChangeText = `(New rank: +${rank})`;
    } else {
      // In other cases, there is no change in rank
      rankChangeText = "(No change)";
    }
    rankChangeSpan.textContent = rankChangeText;
  }
  

  ratingModal.style.display = "block";
  setTimeout(() => {
    ratingModal.style.display = "none";
  }, 10000); // Hide the modal after 10 seconds
}



function disableClickHandlers() {
  $("#shuffle").prop("disabled", true);
  $("#make_fair").prop("disabled", true);
  $("#social_sort").prop("disabled", true);
}

function enableClickHandlers() {
  $("#shuffle").prop("disabled", false);
  $("#make_fair").prop("disabled", false);
  $("#social_sort").prop("disabled", false);
}
