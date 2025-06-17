const tmi = require("tmi.js");
const request = require("request");
const express = require("express");
const app = express();
const port = 3000;

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.bot_account,
    password: process.env.oauth,
  },
  channels: [process.env.twitch_channel],
});

client.connect();
//Queue closed by default
var queue_open = false;
var queue = [];
var turn_counter = [];
var firsts_first = false;

app.use(express.static("public"));
app.set("view engine", "ejs");
app.get("/", function (req, res) {
  res.render("index.ejs", {
    queue: queue,
    turns: turn_counter,
    queue_open: queue_open,
    first_turn_first: firsts_first,
    banner_image: process.env.banner_image
  });
});

app.listen(port, () => {
  console.log(`BootcutBot listening on port ${port}`);
});

client.on("message", (channel, tags, message, self) => {
  // Ignore echoed messages.
  if (self) return;
  
  let isMod = tags.mod || tags['user-type'] === 'mod';
  let isBroadcaster = channel.slice(1) === tags.username;
  let isModUp = isMod || isBroadcaster;
    
  if (message.toLowerCase() === "!hello") {
    client.say(channel, `@${tags.username}, heya!`);
  }
  //Let a user join the queue
  if (message.toLowerCase().startsWith("!join")) {
    if (queue_open) {
      //check if user is in queue
      var in_queue = queue.findIndex(function (queue, index) {
        if (queue.username == tags.username) return true;
      });

      if (in_queue < 0) {
        //check the turn counter
        var turn_count = turn_counter.reduce(
          (acc, cur) => (cur.username === tags.username ? ++acc : acc),
          0
        );
        tags.turn_count = turn_count;
        //add user to queue
        queue.push(tags);
        //Get their position
        var place_in_queue = queue.length;
        var place_ordinal = ordinal_suffix_of(place_in_queue);
        //Check if in firsts_first mode
        if (firsts_first && turn_count > 0) {
          var turn_ordinal = ordinal_suffix_of(turn_count + 1);
          //Let them know they are in
          client.say(
            channel,
            `@${tags["display-name"]}, added to queue! You're ${place_ordinal} in the queue, this will be your ${turn_ordinal} turn. Note: Firsts Turns First Mode is on, so any players who haven't gone yet will be picked before you.`
          );
        } else {
          //Let them know they are in
          client.say(
            channel,
            `@${tags["display-name"]}, added to queue! You're ${place_ordinal} in the queue.`
          );
        }
      } else {
        //Get their position
        var place_in_queue = in_queue + 1;
        var place_ordinal = ordinal_suffix_of(place_in_queue);
        //Light shame for trying to requeue while in queue
        client.say(
          channel,
          `@${tags["display-name"]} you're already queued silly. You're ${place_ordinal} in the queue.`
        );
      }
    } else {
      client.say(
        channel,
        `@${tags["display-name"]} the queue is closed. Try again later.`
      );
    }
  }
  if (message.toLowerCase() === "!leave") {
    //Check if the user is in the queue
    var in_queue = queue.findIndex(function (queue, index) {
      if (queue.username == tags.username) return true;
    });
    //check if user is in queue
    if (in_queue < 0) {
      //Let them know they aren't in the queue
      client.say(channel, `@${tags["display-name"]} you're not in the queue.`);
    } else {
      //remove user from queue
      queue.splice(in_queue, 1);
      client.say(channel, `@${tags["display-name"]} has left the queue.`);
    }
  }
  if (message.toLowerCase() === "!next") {
    //check if broadcaster
    if (isBroadcaster || tags.username == "zilchgnu") {
      //Check for firsts_first
      if (firsts_first) {
        var found_zero_turn = false;
        var i = 0;
        var dupe_queue = queue.slice();
        //loop over the whole queue
        while (i < queue.length) {
          //get the next element from the dupe_queue
          var current_player = dupe_queue[0];
          //check the turn counter
          var turn_count = turn_counter.reduce(
            (acc, cur) =>
              cur.username === current_player.username ? ++acc : acc,
            0
          );
          //see if this a 0 turn player
          if (turn_count === 0) {
            found_zero_turn = true;
            break;
          } else {
            //remove this player from the dupe queue
            dupe_queue.splice(0, 1);
          }
          i++;
        }
        
        //If we didn't find a 0 turn player then just go random
        if (!found_zero_turn) {
          client.say(
            channel,
            `No Zero Turn Players found. Picking the next player.`
          );
          current_player = queue[0];
        }
      } else {
        var current_player = queue[0];
      }
      //Check if user is in chat
      //'+ process.env.twitch_account +'
      request.get(
        "https://tmi.twitch.tv/group/user/" +
          process.env.twitch_channel +
          "/chatters",
        function (error, response, body) {
          if (!error && response.statusCode == 200) {
            //this page returns a list of the users in chat refreshed like every 5 min as json
            var chat = JSON.parse(body);
            var in_chat = false;
            //Different types of chatters are in different objects loop through and check each of them
            for (const [key, value] of Object.entries(chat.chatters)) {
              console.log(current_player);
              //see if the user is in any of the chats
              var in_chat = value.includes(current_player.username);
              if (in_chat) {
                break;
              }
            }
            if (in_chat) {
              //remove user from queue
              queue.splice(0, 1);
              //check the turn counter
              const turn_count = turn_counter.reduce(
                (acc, cur) =>
                  cur.username === current_player.username ? ++acc : acc,
                0
              );
              //add them to the turn counter
              turn_counter.push(current_player);
              //let them know
              if (turn_count > 0) {
                var turn_ordinal = ordinal_suffix_of(turn_count + 1);
                client.say(
                  channel,
                  `@${current_player["display-name"]} has been choosen again, this is your ${turn_ordinal} turn.`
                );
              } else {
                client.say(
                  channel,
                  `@${current_player["display-name"]} step on up to the battle board of doom!`
                );
              }
            } else {
              //remove user from queue
              queue.splice(0, 1);
              //Add them to the end of the queue
              queue.push(current_player);
              //let them know
              client.say(
                channel,
                `@${current_player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !next again`
              );
            }
          }
          //TODO: Handle any errors getting the list of chatters
        }
      );
    }
  }
  if (message.toLowerCase() === "!random") {
    //check if broadcaster
    if (isBroadcaster || tags.username == "zilchgnu") {
      //Check for firsts_first
      if (firsts_first) {
        var found_zero_turn = false;
        var i = 0;
        var dupe_queue = queue.slice();
        //loop over the whole queue
        while (i < queue.length) {
          //get a random element from the dupe_queue
          var random_index = Math.floor(Math.random() * dupe_queue.length);
          //get the player
          var current_player = queue[random_index];

          //check the turn counter
          var turn_count = turn_counter.reduce(
            (acc, cur) =>
              cur.username === current_player.username ? ++acc : acc,
            0
          );
          //see if this a 0 turn player
          if ((turn_count = 0)) {
            found_zero_turn = true;
            break;
          } else {
            //remove this player from the dupe queue
            dupe_queue.splice(random_index, 1);
          }
          i++;
        }
        //If we didn't find a 0 turn player then just go random
        if (!found_zero_turn) {
          client.say(
            channel,
            `No Zero Turn Players found. Picking any random player.`
          );
          //Pick a random player from the queue
          var random_index = Math.floor(Math.random() * queue.length);
          var current_player = queue[random_index];
        }
      } else {
        //Pick a random player from the queue
        var random_index = Math.floor(Math.random() * queue.length);
        var current_player = queue[random_index];
      }

      //check the turn counter
      turn_count = turn_counter.reduce(
        (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
        0
      );
      //Check if user is in chat
      request.get(
        "https://tmi.twitch.tv/group/user/" +
          process.env.twitch_channel +
          "/chatters",
        function (error, response, body) {
          if (!error && response.statusCode == 200) {
            //this page returns a list of the users in chat refreshed like every 5 min as json
            var chat = JSON.parse(body);
            var in_chat = false;
            //Different types of chatters are in different objects loop through and check each of them
            for (const [key, value] of Object.entries(chat.chatters)) {
              //see if the user is in any of the chats
              var in_chat = value.includes(current_player.username);
              if (in_chat) {
                break;
              }
            }
            if (in_chat) {
              //remove user from queue
              queue.splice(random_index, 1);
              //add them to the turn counter
              turn_counter.push(current_player);
              //let them know
              if (turn_count > 0) {
                var turn_ordinal = ordinal_suffix_of(turn_count + 1);
                client.say(
                  channel,
                  `@${current_player["display-name"]} has been randomly selected, this is your ${turn_ordinal} turn.`
                );
              } else {
                client.say(
                  channel,
                  `@${current_player["display-name"]} has been randomly selected, step on up to the battle board of doom!`
                );
              }
            } else {
              //remove user from queue
              queue.splice(random_index, 1);
              //Add them to the end of the queue
              queue.push(current_player);
              //let them know
              client.say(
                channel,
                `@${current_player["display-name"]} hasn't been in chat for a while, moving them to the back of the queue. Please run !random again`
              );
            }
          }
          //TODO: Handle any errors getting the list of chatters
        }
      );
    }
  }
  if (message.toLowerCase() === "!list") {
    //return page with list of queue
    client.say(
      channel,
      `@${tags["display-name"]} you can view the full queue and previous turns here. ${process.env.queue_list_url}`
    );
  }
  if (message.toLowerCase() === "!position") {
    //reply to user with their position in queue
    //Check if the user is in the queue
    var in_queue = queue.findIndex(function (queue, index) {
      if (queue.username == tags.username) return true;
    });
    //See if they are in the queue
    if (in_queue < 0) {
      //tell them they aren't in the queue
      client.say(
        channel,
        `@${tags["display-name"]} can't find you in the queue babe.`
      );
    } else {
      //Get their position
      var place_in_queue = in_queue + 1;
      var place_ordinal = ordinal_suffix_of(place_in_queue);
      //let the know their place.
      client.say(
        channel,
        `@${tags["display-name"]} you are ${place_ordinal} in the queue babe.`
      );
    }
  }
  //allow people to join the queue
  if (message.toLowerCase() === "!open") {
    //check if mod
    if (isBroadcaster || tags.username == "zilchgnu") {
      //set queue_open to true
      queue_open = true;
      //let the chat know what is up
      client.say(channel, `@${tags["display-name"]} has opened the queue!`);
    }
  }
  //stop people from joining the queue
  if (message.toLowerCase() === "!close") {
    //check if mod
    if (isBroadcaster|| tags.username == "zilchgnu") {
      //set queue_open to true
      queue_open = false;
      //let the chat know what is up
      client.say(channel, `@${tags["display-name"]} has closed the queue!`);
    }
  }
  //stop people from joining the queue
  if (message.toLowerCase() === "!firsts_first") {
    //check if mod
    if (isBroadcaster || tags.username == "zilchgnu") {
      //toggle firsts only
      if (!firsts_first) {
        //set queue_open to true
        firsts_first = true;
        //let the chat know what is up
        client.say(
          channel,
          `First Turns First Mode ACTIVATED. The queue will choose players without a turn first.`
        );
      } else {
        //set queue_open to true
        firsts_first = false;
        //let the chat know what is up
        client.say(
          channel,
          `First Turns First Mode DEACTIVATED. The queue has been returned to normal. `
        );
      }
    }
  }
  if (message.toLowerCase() === "!clear") {
    //clear the queue
    //check if mod
    if (isBroadcaster || tags.username == "zilchgnu") {
      queue = [];
      turn_counter = [];
      client.say(
        channel,
        `The Glorious @${tags["display-name"]} has cleared the queue!`
      );
    }
  }
});

function ordinal_suffix_of(i) {
  var j = i % 10,
    k = i % 100;
  if (j == 1 && k != 11) {
    return i + "st";
  }
  if (j == 2 && k != 12) {
    return i + "nd";
  }
  if (j == 3 && k != 13) {
    return i + "rd";
  }
  return i + "th";
}
