function weighted_rating(avgScore, numRatings, m, C) {
  return (numRatings / (numRatings + m)) * avgScore + (m / (numRatings + m)) * C;
}

function average_rating_of_all_users(social_scores) {
  let totalRatings = 0;
  let totalUsers = 0;

  for (const scores of Object.values(social_scores)) {
    totalRatings += scores.map(Number).reduce((a, b) => a + b, 0);
    totalUsers += scores.length;
  }

  return totalRatings / totalUsers;
}

export function updateLeaderboard(social_scores, user_count = 10) {
  const m = 5; // e.g., 10
  const C = average_rating_of_all_users(social_scores); // e.g., average_rating_of_all_users()

  const leaderboard = Object.entries(social_scores)
    .map(([user, scores]) => {
      const avgScore =
        scores.map(Number).reduce((a, b) => a + b, 0) / scores.length;
      const numRatings = scores.length;
      const weightedRating = weighted_rating(avgScore, numRatings, m, C);
      return { user, avgScore, numRatings, weightedRating };
    })
    .sort((a, b) => b.weightedRating - a.weightedRating)
    .slice(0, user_count);

  const leaderboardDiv = $("#leaderboard");

  // Fade out the old leaderboard
  leaderboardDiv.fadeOut(500, function () {
    leaderboardDiv.empty();
    const row = $("<div>").addClass("row");
    leaderboard.forEach(({ user, avgScore, numRatings, weightedRating }, index) => {
      const colUser = $("<div>").addClass("col-12 col-md-12 mb-12");
      const rank = index + 1;
      const userDiv = $("<div>").addClass("user p-3 border rounded");
      userDiv.html(`
        <div class="d-flex justify-content-between align-items-center mb-2">
          <span class="font-weight-bold">${rank}. ${user}</span>
          <span class="badge badge-primary badge-pill">${numRatings} ratings</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-2">
          <span>Weighted Social Score:</span>
          <span class="font-weight-bold">${weightedRating.toFixed(2)}</span>
        </div>
      `);
      colUser.append(userDiv);
      row.append(colUser);
    });
    leaderboardDiv.append(row);

    // Fade in the new leaderboard
    leaderboardDiv.fadeIn(500);
  });
}

