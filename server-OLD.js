const EventEmitter = require('events');
const myEmitter = new EventEmitter();
myEmitter.setMaxListeners(50);  // Increase to 50
const tmi = require("tmi.js");
const request = require("request");
const express = require("express");
const socketIo = require("socket.io");
const crypto = require('crypto');
const Fuse = require('fuse.js')
const dotenv = require('dotenv');
const moment = require('moment-timezone');
dotenv.config();
const ElevenLabs = require("elevenlabs-node");
const http = require("http");
const path = require('path');
const basicAuth = require('express-basic-auth')
const app = express();
const port = 3000;
const server = http.createServer(app);
const io = socketIo(server);
const fetch = require('node-fetch');
const streamLabsIo = require("socket.io-client");
const streamlabsSocket = streamLabsIo(`https://sockets.streamlabs.com?token=${process.env.streamlabs_socket_token}`, {transports: ['websocket']});
const splotStates = {}; // This object will hold the state of each splot

var dir = path.join(__dirname, 'public');
app.use(express.static(dir, {
  maxAge: '1d'
}));

server.listen(3000, () => {
  console.log('listening on *:3000');
});

const jsoning = require("jsoning");
let queue_db = new jsoning("db/queue.json");
let turns_db = new jsoning("db/turns.json");
let deaths_db = new jsoning("db/deaths.json");
let ratings_db = new jsoning("db/ratings.json");
let settings_db = new jsoning("db/queue_settings.json");
let dice_tracker_db = new jsoning("db/dice_tracker.json");
let board_db = new jsoning('db/board_db.json');
let breakaways_db = new jsoning('db/breakaways_db.json');
let historical_splots_db = new jsoning("db/historical_splots.json");
let action_log_db = new jsoning("db/action_log.json");
let step_timer_db = new jsoning("db/step_timer.json");
let historical_turns_db = new jsoning("db/historical_turns.json");
let dice_log_db = new jsoning("db/dice_log.json");
let crowd_sound_db = new jsoning("db/crowd_sounds.json");
let users_in_chat_db = new jsoning("db/users_in_chat.json");
let votes_db = new jsoning("db/votes.json");
let ai_memory_limit = 0;
const openai_chatbot_model_id = process.env.openai_chatbot_model_id;

const { Configuration, OpenAIApi } = require("openai");
const { CensorSensor } = require('censor-sensor');

// Toggles for queue
//Queue closed by default
var queue_open = false;
var firsts_first = true;
//var current_turn = "none yet";
var death_count = 0;
var magic_number = 0;
var ai_enabled = true;
var boo_threshold = 2;
var lol_threshold = 3;
var clap_threshold = 2;
var fart_threshold = 2;
var moan_threshold = 3;
let next_only = false;
let random_only = false;
const end_time = 1708317900;
const bot_display_name = "abbadabbabot";

// Track rate limit
const userRatingsTimestamps = {};
const ratings_uncapped = false; // Set to true to disable rate limiting

const censor = new CensorSensor();
censor.disableTier(2)
censor.disableTier(3)
censor.disableTier(4)
censor.disableTier(5)

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
console.log('bot_account',process.env.bot_account)
const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.bot_account,
    password: process.env.oauth,
  },
  channels: [process.env.twitch_channel],
});

client.connect();
//Get the current turn
let all_turns = turns_db.get('turns');
if(all_turns == null){
  var current_turn = "None... yet";
} else {
  var current_turn = all_turns[0]["display-name"];
}
// TTS Stuff
const voice = new ElevenLabs(
  {
      apiKey:  process.env.elevenlabs_key, // Your API key from Elevenlabs
      voiceId: process.env.elevenlabs_voice_id, // A Voice ID from Elevenlabs
  }
);

//Connect to streamlabs socket
streamlabsSocket.on('event', (eventData) => {
  if (eventData.type === 'donation') {
    let username = eventData.message[0].name;
    let amount = parseFloat(eventData.message[0].amount);
    handlePaidQueue(username, 'donation', amount);
    //code to handle donation events
    console.log('donation:', eventData.message);
  }
  if (eventData.for === 'twitch_account') {
    switch(eventData.type) {
      case 'follow':
        //code to handle follow events
        console.log('follow:', eventData.message);
        break;
      case 'bits':

        //code to handle bits events
        console.log('bits:', eventData.message);
        break;
      case 'subscription':
        let username = eventData.message[0].name;
        handlePaidQueue(username, 'subscription');
        //code to handle subscription events
        console.log('subscription:', eventData.message);
        break;
      default:
        //default case
        console.log('other event:', eventData.message);
    }
  }
});
// Function to handle paid queue updates
function handlePaidQueue(username, type, amount = 0) {
  let queue = queue_db.get("queue") || [];
  let userIndex = queue.findIndex(queueItem => queueItem.username === username);
  let priorityIncrease = 1;

  if (type === 'subscription') {
    priorityIncrease = 6; // Adjust as desired
  } else if (type === 'donation') {
    priorityIncrease = Math.floor(amount); // Increase per dollar
  }

  if (userIndex >= 0) {
    if (!queue[userIndex].priority) {
      queue[userIndex].priority = 1;
    }
    queue[userIndex].priority += priorityIncrease;
    queue_db.set("queue", queue);
  }
}
io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on("board_admin", (arg, callback) => {
    console.log('board_admin');
    console.log('arg:',arg);
    let current_board = board_db.get('board');
    //make queue empty if null
    if (current_board == null) {
      current_board = [];
    }
    console.log('current_board:', current_board);
    //see if the splot id exists
    var splot_id_exists = current_board.findIndex(function (current_board, index) {
      if (current_board.id == arg.id) return true;
    });
    
    console.log('does splot id exist:', splot_id_exists);
    // New splot
    if (splot_id_exists == -1) {
      console.log('add splot')
      board_db.push('board', arg);
    } else {
      console.log('update splot')
      current_board.forEach((this_splot, index) => {
        if(this_splot.id == arg.id){
          current_board[index] = arg;
          board_db.set('board', current_board);
          console.log('updating dadabase');
        }
      })
    }
    console.log('checking for blank splot')
    // Make sure it isn't a blank splot
    if(arg.entry.toLowerCase !== "blank splot" ){
      // Check to see if the splot is a duplicate
      let historical_splots_dupe_check = historical_splots_db.get(arg.entry.toLowerCase());
      console.log('historical_splots_dupe_check:', historical_splots_dupe_check);
      // If it is not a duplicate add it.
      if (historical_splots_dupe_check == null) {      
        let yourDate = new Date()
        const offset = yourDate.getTimezoneOffset()
        yourDate = new Date(yourDate.getTime() - (4*60*1000))
        let date = yourDate.toISOString();
        historical_splots_db.set(arg.entry.toLowerCase(), date);
        console.log('adding historical splot:', arg.entry);
      }
    }
    console.log('Should send board_update');
    io.emit('board_update', arg);
    callback("got it");
  });
  socket.on("ba_admin", (arg, callback) => {
    let current_breakaways = breakaways_db.get('breakaways');
    //make queue empty if null
    if (current_breakaways == null) {
      current_breakaways = [];
    }
    console.log('current_breakaways:', current_breakaways);
    //see if the splot exists
    var ba_exists = current_breakaways.findIndex(function (current_breakaway, index) {
      if (current_breakaway.id == arg.id) return true;
    });
    
    console.log(ba_exists);
    if (ba_exists == -1) {
      console.log('add breakaway')
      breakaways_db.push('breakaways', arg);
    } else {
      console.log('update breakaway')
      current_breakaways.forEach((this_ba, index) => {
        if(this_ba.id == arg.id){
          current_breakaways[index] = arg;
          breakaways_db.set('breakaways', current_breakaways);
        }
      })
    }
    callback("got it");
    io.emit('ba_update', arg);
  });

  socket.on("alt_splot_swap", (splotData, callback) => {
    // Toggle the state of the splot
    if (splotStates[splotData.id]) {
      splotStates[splotData.id].isAlt = !splotStates[splotData.id].isAlt;
    } else {
      // If it's the first time, initialize the state
      splotStates[splotData.id] = { isAlt: true };
    }
    
    // Emit the updated state along with the splot data
    io.emit('alt_splot_swap', { ...splotData, isAlt: splotStates[splotData.id].isAlt });
  });
  socket.on("clear_board", (arg, callback) => {
    board_db.set('board',[])
    console.log(arg);
    callback("board_cleared");
    io.emit('clear_board', []);
  });
  socket.on("log_action", (arg, callback) => {
    callback("action_logged");
    action_log_db.push(arg.entry, arg);
  });
  socket.on("timer_admin", (arg, callback) => {
    callback("timer_admin timer updated");
    io.emit('timer_server', arg);
  });
  // get_random_splot
  socket.on("get_random_splot", (arg, callback) => {
    var random_splot = get_random_splot();
    callback(random_splot);
  });
   socket.on('dice_roll', (arg, callback) => {
    var current_dice_roll = dice_log_db.get('dice_roll');
    if (current_dice_roll == null) {
      current_dice_roll = [];
    }
    console.log('current_dice_roll:', current_dice_roll);
    //add the dice roll
    dice_log_db.push('dice_roll', arg);
    //emite the dice roll
    io.emit('dice_rolled', arg);
    callback("dice_roll processed");
  });
  socket.on('ai_toggle', (arg, callback) => {
    // toggle ai_enabled variable
    ai_enabled = !ai_enabled;
    console.log('ai_enabled:', ai_enabled);
    callback(ai_enabled);
  });
  socket.on('updateNotification', (message) => {
    io.emit('newNotification', message);    
    settings_db.set('notification', message)
  });
  socket.on('play_win', (message, callback) => {
    io.emit('win_sound', message);  
    callback('win passed');
  });
  socket.on('play_lose', (message, callback) => {
    io.emit('lose_sound', message);
    callback('loser passed');
  });
  socket.on('play_sound', (message, callback) => {
    console.log(message, 'sound alert triggered');
    io.emit('soundAlert', message.type);
    callback('sound passed');
  });
  socket.on('godVote', async (message, callback) => {
    let godName = message.godName;
    let vote = message.vote;
    // Only allow one vote per god
    let godVotes = await votes_db.get('godVotes');
    // Make sure there are godVotes
    if (!godVotes) {
      godVotes = [];
    }
    const godVote = godVotes.find(vote => vote.user === godName);
    let oldVote = null;
    if (godVote) {
      oldVote = godVote.vote;
      // Don't do anything if the vote is the same
      if (godVote.vote !== vote) {
        // Update the vote
        godVote.vote = vote;
        await votes_db.set('godVotes', godVotes);
        io.emit('change_god_vote', {user: godName, vote: vote, oldVote: oldVote});
      }
    } else {    
      // push to the vote db
      await votes_db.push('godVotes', {user: godName, vote: vote});
      // Emit the vote
      io.emit('god-vote', {user: godName, vote: vote});
    }
  });

});


app.use(express.static("public"));
app.set("view engine", "ejs");
app.get('/historical_splots.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'db/historical_splots.json'));
});
app.get('/dice_log.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'dice_log.json'));
});
app.get('/diceData', function(req, res){
  res.render("diceData.ejs", {
    banner_image: process.env.banner_image,
  });
});
app.get('/just_timer', function(req, res){
  res.render("just_timer.ejs", {
  });
});
app.get('/turn', function(req, res){
  res.render("turn.ejs", {
    current_turn: current_turn,
  });
});
app.get('/countdown', (req, res) => {
  const time = req.query.end || "00:00:00"; // Default to midnight if no time provided
  // Combine current date with provided time and convert to EST
  const dateTimeEST = moment.tz(`${moment().format('YYYY-MM-DD')}T${time}`, "America/New_York").format();
  
  res.render('countdown', { endTime: dateTimeEST });
});
app.get('/timer', function(req, res){
  res.render("timer.ejs", {
    end_time: end_time*1000,
  });
});
app.get('/menu', function(req, res){
  res.render("menu.ejs", {
    queue_open: queue_open,
    first_turn_first: firsts_first,
    banner_image: process.env.banner_image,
    current_turn: current_turn,
  });
});
app.get('/board', function(req, res){
  let current_breakaways = breakaways_db.get('breakaways');
  if(current_breakaways == null){
    current_breakaways = [];
  }
  res.render("integrated_boardhell.ejs", {
    board: board_db.get('board'),
    breakaways: current_breakaways,
    current_turn: current_turn,
  });
});
app.get('/board_big', function(req, res){
  res.render("board_big.ejs", {
    board: board_db.get('board'),
    current_turn: current_turn,
  });
});
app.get('/ratings', function(req, res){
  res.render("ratings.ejs", {
    ratings: ratings_db.get('ratings'),
    banner_image: process.env.banner_image,
  });
});
app.get('/bootcut_board', function(req, res){
  let current_breakaways = breakaways_db.get('breakaways');
  if(current_breakaways == null){
    current_breakaways = [];
  }
  res.render("bootcut_board.ejs", {
    board: board_db.get('board'),
    breakaways: current_breakaways,
    current_turn: current_turn,
  });
});
app.get('/breakaways', function(req, res){
  let current_breakaways = breakaways_db.get('breakaways');
  if(current_breakaways == null){
    current_breakaways = [];
  }
  res.render("breakaways.ejs", {
    board: board_db.get('board'),
    breakaways: current_breakaways,
    current_turn: current_turn,
  });
});
app.get('/splot_db', function(req, res){
  const historical_splots = historical_splots_db.all();
  res.render("historical_splots.ejs", {
    splots: historical_splots,
    banner_image: process.env.banner_image,
  });
});
app.get('/board_admin', basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), function(req, res){
  var breakaways = breakaways_db.get('breakaways')
  if (breakaways == null) {
    var breakaways = [];
  }
  res.render("board_admin.ejs", {
    data: {
      board: board_db.get('board'),
      breakaways: breakaways,
      current_turn: current_turn,
      username: process.env.bot_account,
      password: process.env.oauth,  
      channels: [process.env.twitch_channel]
    }
  });
});
app.get("/", function (req, res) {
  let last_turn_id = settings_db.get('turn_count') || 0;
  let this_turn_id = last_turn_id + 1;

  let queue = queue_db.get("queue") || [];
  let turn_counter = turns_db.get("turns") || [];

  // Function to check if a user has had a turn
  function hasUserHadTurn(username) {
    return turn_counter.some(turn => turn.username === username);
  }

  // Filter the queue based on "First Turns First" mode
  let eligibleQueue = [];
  if (firsts_first) {
    // Users who haven't had a turn yet
    eligibleQueue = queue.filter(user => !hasUserHadTurn(user.username));
    // If no eligible users, include all users
    if (eligibleQueue.length === 0) {
      eligibleQueue = queue.slice(); // Copy the queue
    }
  } else {
    eligibleQueue = queue.slice(); // Copy the queue
  }

  // Sort the eligible users by priority and joinTime
  eligibleQueue.sort((a, b) => {
    const priorityDifference = (b.priority || 1) - (a.priority || 1);
    if (priorityDifference !== 0) {
      return priorityDifference; // Sort by priority
    } else {
      return a.joinTime - b.joinTime; // Sort by joinTime (earlier first)
    }
  });

  // For each user in the eligible queue, calculate their turn count
  eligibleQueue.forEach(user => {
    let turn_count = turn_counter.reduce((acc, cur) => (cur.username === user.username ? ++acc : acc), 0);
    user.turn_count = turn_count;
    // Format joinTime for display
    user.joinTimeFormatted = new Date(user.joinTime).toLocaleString();
  });

  // For previous turns, format the turn time if needed
  turn_counter.forEach(turn => {
    turn.turnTimeFormatted = new Date(turn.joinTime).toLocaleString();
  });

  res.render("index.ejs", {
    eligibleQueue: eligibleQueue || [],
    turns: turn_counter,
    queue_open: queue_open,
    first_turn_first: firsts_first,
    banner_image: process.env.banner_image,
    current_turn: current_turn,
    magic_number: magic_number,
    end_time: end_time * 1000,
    turn_count: this_turn_id
  });
});



app.get("/deaths", function (req, res) {
  var deaths = deaths_db.get("deaths");
  if (deaths == null) {
    var deaths = 0;
  }
  res.render("deathcounter.ejs", {
    death_count: deaths,
  });
});
app.get("/rolls", function (req, res) {
  res.render("rolls.ejs");
});
app.get("/rolls", function (req, res) {
  res.render("rolls.ejs");
});
app.get("/crowd_sound", function (req, res) {
  res.render("crowd_sound.ejs");
});
app.get('/notification_admin', basicAuth({
  users: { [process.env.noti_user]: process.env.noti_pass },
  challenge: true,
}), function (req, res) {
  res.render('notification_admin', {
    notification: settings_db.get('notification')
  });
});
app.get('/chaz_roll', basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), function (req, res) {
  res.render("chaz_roll.ejs");
});
app.get('/notification', (req, res) => {
  res.render('notification', {
    notification: settings_db.get('notification')
  });
});
app.get('/tts', (req, res) => {
  const filePath = __dirname + '/public/audio/output.mp3';
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(filePath);
});
app.get('/progress', async (req, res) => {
  res.render('progress', {
    votes: await votes_db.get('votes'),
    godVotes: await votes_db.get('godVotes')
  });
});
app.get('/god_dash', basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), (req, res) => {

  res.render('god_dash');
});

client.on("cheer", (channel, userstate, message) => {
  
    console.log('userstate of cheer',userstate);
    console.log('message of cheer', message);
});

client.on("cheer", async (channel, userstate, message) => {
  // Only proceed if the queue is open
  if (queue_open) {
    let queue = queue_db.get("queue") || [];
    let username = userstate["display-name"];
    let userIndex = queue.findIndex(queueItem => queueItem.username.toLowerCase() === userstate.username.toLowerCase());
    let priorityIncrease = Math.floor(userstate.bits / 100); // Increase per 100 bits

    if (userIndex >= 0) {
      // User is in the queue, increase their priority
      if (!queue[userIndex].priority) {
        queue[userIndex].priority = 1;
      }
      queue[userIndex].priority += priorityIncrease;
      queue_db.set("queue", queue);
      client.say(channel, `@${username}, your queue priority has increased to ${queue[userIndex].priority}!`);
    }
  }
});

client.on("cheer", async (channel, userstate, message) => {
    /**if(userstate.bits == 99) {
    console.log('voteGuilty');
    // push to the vote db
    await votes_db.push('votes', {user: userstate['display-name'], vote: 'guilty'});
    // Emite the vote
    io.emit('vote', {user: userstate['display-name'], vote: 'guilty'});
  }
  if(userstate.bits == 101) {
        // push to the vote db
        await votes_db.push('votes', {user: userstate['display-name'], vote: 'not-guilty'});
        // Emite the vote
        io.emit('vote', {user: userstate['display-name'], vote: 'not-guilty'});
  }

  if(userstate.bits == 200) {
    console.log('objection:', message);
    // Pull out the message
    let strippedMessage = message.toLowerCase().replace('cheer200 ','');
    // Send to abbadabbabot
    let objection = await abbadabbabotText(`Please announce to chat and the celestial court this objection brought up by ${userstate['display-name']}: "${strippedMessage}" Try to always remember to say "Objection! Your Honor" before the objection. Be sure to state the whole objection, then make it seem like you disagree with any objection given.`, 'objection');
    console.log('objection:', objection);
    await gen_and_play_tts(`${objection}`);
    io.emit('play_tts');
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'Authorization': `Bearer ${process.env.streamlabs_access_token}`
      },
      body: JSON.stringify({
        type: 'donation',
        sound_href: 'https://leantube.org/tts',
        message: `${userstate['display-name']} has made an objection:`,
        user_message: `${strippedMessage}`,
        duration: '10000',
      })
    };

    fetch('https://streamlabs.com/api/v2.0/alerts', options)
    .then(async response => {
      console.log('response:', response)
      const contentType = response.headers.get("content-type");
      if(contentType && contentType.includes("application/json")) {
        return response.json();
      } else {
        const text = await response.text();
        throw new Error(`Expected JSON, got ${contentType}: ${text}`);
      }
    })
    .then(response => console.log(response))
    .catch(err => console.error(err));
  } **/
  
  if(userstate.bits == 99) {
    io.emit('kermit_sex', userstate);
  }
  if(userstate.bits == 399) {
    io.emit('jarjar', userstate);
  }
  if(userstate.bits == 299 ) {
    io.emit('draculaAngel', userstate);
  }
  if(userstate.bits == 450) {
    io.emit('ash_spit', userstate);
  }
  if(userstate.bits >= 100 ) {
    // Add 2 minutes to the timer for every 100 bits
    let additionalSeconds = Math.floor(userstate.bits / 100) * 120;
    // Round to nearest 5 seconds
    additionalSeconds = Math.ceil(additionalSeconds / 5) * 5;    
    console.log('additionalSeconds:', additionalSeconds);
    io.emit('add_time', additionalSeconds);
  }
  console.log('bit redeem',userstate);
});
client.on("message", async (channel, tags, message, self) => {
    // Ignore echoed messages.
    //if (self && !message.toLowerCase().startsWith("!join")) return;
    if(!await users_in_chat_db.has(tags.username)) {
          console.log('username joined:', tags.username);
          await users_in_chat_db.push(tags.username, Date.now());
    }
    let isMod = tags.mod || tags["user-type"] === "mod";
    let isBroadcaster = channel.slice(1) === tags.username;
    let isModUp = isMod || isBroadcaster;
    if(message.toLocaleLowerCase().includes("deez nutz") || message.toLocaleLowerCase().includes("deeznutz") || message.toLocaleLowerCase().includes("deeze nuts") || message.toLocaleLowerCase().includes("deezenuts") || message.toLocaleLowerCase().includes("deez nuts")){
      settings_db.math("deeze_nutz", "add", 1);
      console.log("deeze nutz added");
    }
    if (message.toLowerCase().startsWith("!dn_count")) {
        (async () => {
          var dn_count = settings_db.get("deeze_nutz");
          const abbabot_response = abbadabbabotSay(channel, client, tags, 'There has been ' + dn_count + ' deeze nutz jokes told in chat.','',`- ${dn_count} deeze nutz since 7/21/22`);
        })();
    }
    if (message.toLowerCase().startsWith("!abbadabbabot")) {
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        var stripped_message = message.replace('!abbadabbabot ','');
        const abbabot_response = abbadabbabotSay(channel, client, tags, stripped_message);
      }
    }
    if(message.toLowerCase().startsWith("!open_ratings")) {
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        //set queue_open to true
        ratings_uncapped = true;

        //let the chat know what is up
        client.say(channel, `@${tags["display-name"]} has uncapped the ratings command.`);
      }
    }
    if(message.toLowerCase().startsWith("!close_ratings")) {
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        //set queue_open to true
        ratings_uncapped = false;

        //let the chat know what is up
        client.say(channel, `@${tags["display-name"]} has enabled ratings rate limit.`);
      }
    }
    // Manual timer add
    if(message.toLowerCase().startsWith("!add_time")) {
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        //get the time to add
        var time_to_add = parseInt(message.replace('!add_time ',''));
        //emite the add_time
        io.emit('add_time', time_to_add);
      }
    }
    if(message.toLowerCase().startsWith("!test1")) {
      if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot" || isMod ) {
        console.log('!testing');
        let fakeUserstate = {'badge-info': { subscriber: '17' },
            badges: { subscriber: '2012', 'twitch-recap-2023': '1' },
            bits: '300',
            color: '#22B345',
            'display-name': 'alton_darwin',
            emotes: null,
            'first-msg': false,
            flags: null,
            id: '6b8c1e5c-619d-4e31-b425-91b45ae36909',
            mod: false,
            'returning-chatter': false,
            'room-id': '47230289',
            subscriber: true,
            'tmi-sent-ts': '1703314471933',
            turbo: false,
            'user-id': '653212161',
            'user-type': null,
            'emotes-raw': null,
            'badge-info-raw': 'subscriber/17',
            'badges-raw': 'subscriber/2012,twitch-recap-2023/1',
            username: 'alton_darwin',
            'message-type': 'chat'
          };
      
          io.emit('draculaAngel', fakeUserstate);
      }    
    }
  if(message.toLowerCase().startsWith("!test2")) {
      if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot"  || isMod ) {
        console.log('!testing');
        let fakeUserstate = {'badge-info': { subscriber: '17' },
            badges: { subscriber: '2012', 'twitch-recap-2023': '1' },
            bits: '300',
            color: '#22B345',
            'display-name': 'alton_darwin',
            emotes: null,
            'first-msg': false,
            flags: null,
            id: '6b8c1e5c-619d-4e31-b425-91b45ae36909',
            mod: false,
            'returning-chatter': false,
            'room-id': '47230289',
            subscriber: true,
            'tmi-sent-ts': '1703314471933',
            turbo: false,
            'user-id': '653212161',
            'user-type': null,
            'emotes-raw': null,
            'badge-info-raw': 'subscriber/17',
            'badges-raw': 'subscriber/2012,twitch-recap-2023/1',
            username: 'alton_darwin',
            'message-type': 'chat'
          };
      
          io.emit('jarjar', fakeUserstate);
      }    
    }
    if(message.toLowerCase().startsWith("!test3")) {
      if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot"  || isMod ) {
        console.log('!testing');
        let fakeUserstate = {'badge-info': { subscriber: '17' },
            badges: { subscriber: '2012', 'twitch-recap-2023': '1' },
            bits: '300',
            color: '#22B345',
            'display-name': 'alton_darwin',
            emotes: null,
            'first-msg': false,
            flags: null,
            id: '6b8c1e5c-619d-4e31-b425-91b45ae36909',
            mod: false,
            'returning-chatter': false,
            'room-id': '47230289',
            subscriber: true,
            'tmi-sent-ts': '1703314471933',
            turbo: false,
            'user-id': '653212161',
            'user-type': null,
            'emotes-raw': null,
            'badge-info-raw': 'subscriber/17',
            'badges-raw': 'subscriber/2012,twitch-recap-2023/1',
            username: 'alton_darwin',
            'message-type': 'chat'
          };
      
          io.emit('ash_spit', fakeUserstate);
      }    
    }
  if(message.toLowerCase().startsWith("!test4")) {
      if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot" || isMod ) {
        console.log('!testing');
        let fakeUserstate = {'badge-info': { subscriber: '17' },
            badges: { subscriber: '2012', 'twitch-recap-2023': '1' },
            bits: '300',
            color: '#22B345',
            'display-name': 'alton_darwin',
            emotes: null,
            'first-msg': false,
            flags: null,
            id: '6b8c1e5c-619d-4e31-b425-91b45ae36909',
            mod: false,
            'returning-chatter': false,
            'room-id': '47230289',
            subscriber: true,
            'tmi-sent-ts': '1703314471933',
            turbo: false,
            'user-id': '653212161',
            'user-type': null,
            'emotes-raw': null,
            'badge-info-raw': 'subscriber/17',
            'badges-raw': 'subscriber/2012,twitch-recap-2023/1',
            username: 'alton_darwin',
            'message-type': 'chat'
          };
      
          io.emit('kermit_sex', fakeUserstate);
      }    
    }
    if(message.toLowerCase().startsWith("clap")) {
      // get the clap db
      var current_claps = await crowd_sound_db.get("claps");
      console.log('current_claps', current_claps);
      //make sure current_claps isn't null
      if (current_claps !== null) {
        // check the timestamp of the first clap
        var first_clap = current_claps[0];
        console.log('first_clap', first_clap);
        var clap_timestamp = first_clap.timestamp;
        var current_timestamp = Date.now();
        //If it's older than 5  minutes clear the claps_
        if (current_timestamp - clap_timestamp > 300000) {
          console.log('clearing claps');
          await crowd_sound_db.set('claps');
        }     
        // check if the user has claped
        if (crowd_sound_db.get('claps')) {
          var claped = crowd_sound_db.get('claps').filter(function(claps) {
            return claps.user === tags['display-name'];
          });
        } else {
          claped = [];
        }
        console.log('claped', claped);
        // if they have claped don't count it
        if (claped.length == 0) {
          //add the new clap
          var clap = {
            user: tags["display-name"],
            timestamp: Date.now()
          };
          await crowd_sound_db.push('claps',clap);
          var new_claps = await crowd_sound_db.get('claps');
          console.log('new_claps', new_claps);
          // See if this will put us over the threshold
          if (new_claps.length == clap_threshold) {
            // emit the clap threshold
            io.emit("clap_threshold", true);
            //announce the clap
            say(channel,client,tags,'Clap');
          }
        } else {
          console.log('user already claped');
        }
      } else {
        console.log('no claps yet')
        //add the new clap
        var clap = {
          user: tags["display-name"],
          timestamp: Date.now()
        };
        crowd_sound_db.push('claps',clap);
      }
    }
const laugh_regex = /(lmao|roflmao|rofl|lolol|lol|hehe|haha|lel|kek|lolwut|lul|kekw|lmfao)/gi;
const lols_key = "lols";
  
if (tags['display-name'].toLowerCase() !==bot_display_name.toLowerCase() && laugh_regex.test(message.toLowerCase())) {
  // get the laugh db
  const current_lols = await crowd_sound_db.get(lols_key) || [];
  console.log('current_lols', current_lols);

  // check the timestamp of the first lol
  const first_lol = current_lols[0];
  console.log('first_lol', first_lol);
  const lol_timestamp = first_lol?.timestamp || 0;
  const current_timestamp = Date.now();

  // If it's older than 5 minutes clear the lols_
  if (current_timestamp - lol_timestamp > 300000) {
    console.log('clearing lols');
    await crowd_sound_db.set(lols_key, []);
  }

  // check if the user has loled
  const user_lols = await crowd_sound_db.get(lols_key) || [];
  const loled = user_lols.filter(function(lols) {
    return lols.user === tags['display-name'];
  });
  console.log('loled', loled);

  // if they have loled don't count it
  if (loled.length == 0) {
    // add the new lol
    const lol = {
      user: tags["display-name"],
      timestamp: Date.now()
    };
    await crowd_sound_db.push(lols_key, lol);
    const new_lols = await crowd_sound_db.get(lols_key);
    console.log('new_lols', new_lols);

    // See if this will put us over the threshold
    if (new_lols.length >= lol_threshold) {
      // emit the lol threshold
      io.emit("lol_threshold", true);
      // announce the lol
      say(channel, client, tags, 'LUL');
      console.log('clearing lols');
      await crowd_sound_db.set(lols_key, []);
      loled.length = 0;
    }
  } else {
    console.log('user already loled');
  }
}
const fart_regex = /(!fart|toot|poot|fart|fluff|whoopee|rip one|break wind|cut the cheese|pass gas|queef|dutch oven)/gi;
const farts_key = "farts";

if (tags['display-name'].toLowerCase() !== bot_display_name.toLowerCase() && fart_regex.test(message.toLowerCase()) && tags.subscriber) {
  // get the fart db
  const current_farts = await crowd_sound_db.get(farts_key) || [];
  console.log('current_farts', current_farts);

  // check the timestamp of the first fart
  const first_fart = current_farts[0];
  console.log('first_fart', first_fart);
  const fart_timestamp = first_fart?.timestamp || 0;
  const current_timestamp = Date.now();

  // If it's older than 5 minutes, clear the farts
  if (current_timestamp - fart_timestamp > 300000) {
    console.log('clearing farts');
    await crowd_sound_db.set(farts_key, []);
  }

  // check if the user has farted
  const user_farts = await crowd_sound_db.get(farts_key) || [];
  const farted = user_farts.filter(function(farts) {
    return farts.user === tags['display-name'];
  });
  console.log('farted', farted);

  // if they have not farted, count it
  if (farted.length == 0) {
    // add the new fart
    const fart = {
      user: tags["display-name"],
      timestamp: Date.now()
    };
    await crowd_sound_db.push(farts_key, fart);
    const new_farts = await crowd_sound_db.get(farts_key);
    console.log('new_farts', new_farts);

    // Randomize the threshold increase by 0, 1, 2, or 3
    const randomIncrease = Math.floor(Math.random() * 4); // Generates 0, 1, 2, or 3
    const dynamicThreshold = fart_threshold + randomIncrease;
    console.log('fart_threshold: ',fart_threshold)
    // See if this will put us over the dynamic threshold
    if (new_farts.length >= dynamicThreshold) {
      // emit the fart threshold
      io.emit('soundAlert', 'fart');
      // announce the fart
      say(channel, client, tags, 'Someone let one rip! 💨');
      console.log('clearing farts');
      await crowd_sound_db.set(farts_key, []);
      farted.length = 0;
    }
  } else {
    console.log('user already farted');
  }
}
const moan_regex = /(moan|groan|whine|sigh|grunt|whimper|abbaboxDownbad)/gi;
const moans_key = "moans";

if (tags['display-name'].toLowerCase() !== bot_display_name.toLowerCase() && moan_regex.test(message.toLowerCase()) && tags.subscriber) {
  // get the moan db
  const current_moans = await crowd_sound_db.get(moans_key) || [];
  console.log('current_moans', current_moans);

  // check the timestamp of the first moan
  const first_moan = current_moans[0];
  console.log('first_moan', first_moan);
  const moan_timestamp = first_moan?.timestamp || 0;
  const current_timestamp = Date.now();

  // If it's older than 5 minutes, clear the moans
  if (current_timestamp - moan_timestamp > 300000) {
    console.log('clearing moans');
    await crowd_sound_db.set(moans_key, []);
  }

  // check if the user has moaned
  const user_moans = await crowd_sound_db.get(moans_key) || [];
  const moaned = user_moans.filter(function(moans) {
    return moans.user === tags['display-name'];
  });
  console.log('moaned', moaned);

  // if they have not moaned, count it
  if (moaned.length == 0) {
    // add the new moan
    const moan = {
      user: tags["display-name"],
      timestamp: Date.now()
    };
    await crowd_sound_db.push(moans_key, moan);
    const new_moans = await crowd_sound_db.get(moans_key);
    console.log('new_moans', new_moans);

    // Randomize the threshold increase by 0, 1, 2, or 3
    const randomIncrease = Math.floor(Math.random() * 4); // Generates 0, 1, 2, or 3
    const dynamicThreshold = moan_threshold;

    // See if this will put us over the dynamic threshold
    if (new_moans.length >= dynamicThreshold) {
      // emit the moan threshold
      io.emit('soundAlert', 'moan');
      // announce the moan
      say(channel, client, tags, 'Someone let out a moan! 🗣️');
      console.log('clearing moans');
      await crowd_sound_db.set(moans_key, []);
      moaned.length = 0;
    }
  } else {
    console.log('user already moaned');
  }
}
// Listen for the lol_threshold event
/*io.on("lol_threshold", async function() {
  console.log("lol threshold reached, clearing lols");
  await crowd_sound_db.set(lols_key, []);
});*/
if(message.toLowerCase().startsWith("!voteguilty")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    console.log('voteGuilty');
    // push to the vote db
    await votes_db.push('votes', {user: tags['display-name'], vote: 'guilty'});
    // Emite the vote
    io.emit('vote', {user: tags['display-name'], vote: 'guilty'});
  }
}
if(message.toLowerCase().startsWith("!votenotguilty")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    // push to the vote db
    await votes_db.push('votes', {user: tags['display-name'], vote: 'not-guilty'});
    // Emite the vote
    io.emit('vote', {user: "VOZWrtSVqNIq0WUjiVGCYMFxs", vote: 'not-guilty'});
  }
}
if(message.toLowerCase().startsWith("!godguilty")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    console.log('voteGuilty');
    // push to the vote db
    await votes_db.push('godVotes', {user: tags['display-name'], vote: 'guilty'});
    // Emite the vote
    io.emit('vote', {user: tags['display-name'], vote: 'guilty'});
  }
}
if(message.toLowerCase().startsWith("!godnotguilty")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    // push to the vote db
    await votes_db.push('godVotes', {user: tags['display-name'], vote: 'not-guilty'});
    // Emite the vote
    io.emit('vote', {user: "VOZWrtSVqNIq0WUjiVGCYMFxs", vote: 'not-guilty'});
  }
}
if(message.toLowerCase().startsWith("!nextonly")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    next_only = true;
    abbadabbabotSay(channel, client, tags, `Let chat know that it is next turns only for next hour`,'',`- next only mode`);

    
  }
}
if(message.toLowerCase().startsWith("!randomonly")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    random_only = true;
        abbadabbabotSay(channel, client, tags, `Let chat know that it is random turns only for next hour`,'',`- next only mode`);

  }
}
if(message.toLowerCase().startsWith("!normalturns")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    random_only = false;
    next_only = false;
            abbadabbabotSay(channel, client, tags, `Let chat know that turns are back to normal`,'',`- regular turns mode`);


  }
} 
    if (message.toLowerCase() === "!boo") {
      // get the boo db
      var current_boos = await crowd_sound_db.get("boos");
      console.log('current_boos', current_boos);
      //make sure current_boos boos isn't null
      if (current_boos !== null) {
        // check the timestamp of the first boo
        var first_boo = current_boos[0];
        console.log('first_boo', first_boo);
        var boo_timestamp = first_boo.timestamp;
        var current_timestamp = Date.now();
        //If it's older than 5  minutes clear the boos
        if (current_timestamp - boo_timestamp > 300000) {
          console.log('clearing boos');
          await crowd_sound_db.set('boos');
        }     
        // check if the user has booed
        if (crowd_sound_db.get('boos')) {
          var booed = crowd_sound_db.get('boos').filter(function(boos) {
            return boos.user === tags['display-name'];
          });
        } else {
          booed = [];
        }
        console.log('booed', booed);
        // if they have booed don't count it
        if (booed.length == 0) {
          //add the new boo
          var boo = {
            user: tags["display-name"],
            timestamp: Date.now()
          };
          await crowd_sound_db.push('boos',boo);
          var new_boos = await crowd_sound_db.get('boos');
          console.log('new_boos', new_boos);
          // See if this will put us over the threshold
          if (new_boos.length == boo_threshold) {
            // emit the boo threshold
            io.emit("boo_threshold", true);
            //announce the boo
            say(channel,client,tags,'boo');
          }
        } else {
          console.log('user already booed');
        }
      } else {
        console.log('no boos yet')
        //add the new boo
        var boo = {
          user: tags["display-name"],
          timestamp: Date.now()
        };
        crowd_sound_db.push('boos',boo);
      }
    }
    if (message.toLowerCase() === "!wakeup") {
      var greetings = [
        `Can you give your Uncle Abbabox a message in this chat? Let him know it's stream time and we need him to wake up.`,
        `Can you give your Uncle Abbabox a message in this chat? Tell uncle abbabox that his Bathtime is over people are waiting for him.`,
        `Riff on the quote to try and pressure Uncle Abbabox to start stream already: An abba is never late, nor is he early. He arrives precisely when he means to.`,
      ];
      var random_index = Math.floor(Math.random() * greetings.length);

      abbadabbabotSay(channel,client,tags,`Tell @abbabox ${greetings[random_index]}`);

    }
    	if (message.toLowerCase() === "!timeleft") {
        const unixTimestamp = end_time; // Example Unix timestamp
        const currentTime = Date.now() / 1000; // Current time in Unix timestamp format

        const secondsDiff = unixTimestamp - currentTime; // Calculate difference in seconds

        const hours = Math.floor(secondsDiff / 3600); // Calculate hours
        const minutes = Math.floor((secondsDiff % 3600) / 60); // Calculate minutes
        const seconds = Math.floor(secondsDiff % 60); // Calculate seconds

        console.log(`${hours}h ${minutes}m ${seconds}s`); // Output difference in hh:mm:ss format
        
        
        const stringList = ['and why that\'s amazing.', 'and tell us something chat can do during that amount of time', 'and tell us the dangers of staying up that long']; // List of three strings

        const randomIndex = Math.floor(Math.random() * stringList.length); // Choose a random index from 0 to 2
        const randomFlavor = stringList[randomIndex];

	      abbadabbabotSay(channel, client, tags, `Tell chat that abbabox has ${hours}h ${minutes}m ${seconds}s left in his 24 hour stream, ${randomFlavor}`,'',` - ${hours}h ${minutes}m ${seconds}s - <3 abbadabbabot`);

    } 
    if (message.toLowerCase() === "!rise") {
      abbadabbabotSay(channel, client, tags, `create a cheeky quote about how you're going to rise from the ashes like a phoenix.`);
    }
    if (message.toLowerCase().startsWith("!deeznutz")) {
      var deezenutz_data = message.split(" ");
      if(deezenutz_data.length > 1){
          var subject = message.replace('!deeznutz ', '')
          abbadabbabotSay(channel, client, tags, `tell us a deez nutz joke about ${subject}`);
      } else {
          abbadabbabotSay(channel, client, tags, `tell us a deez nutz joke`);
      }
    }
    if (message.toLowerCase() === "!justice") {
      abbadabbabotSay(channel, client, tags, `Defend abbabox from the charge of involuntary manslaughter`);
    }
    if (message.toLowerCase() === "!chesthair") {
      abbadabbabotSay(channel, client, tags, `abbabox wants you to List 3 random facts about his chest hair.`);
    }
    if (message.toLowerCase() === "!backhair") {
      abbadabbabotSay(channel, client, tags, `abbabox wants you to List 3 random facts about his back hair. (He doesn't have much but mostly on the sides)`);
    }
    if (message.toLowerCase() === "!something") {
      abbadabbabotSay(channel, client, tags, `abbabox wants you to List give some random site about fish eyes or something weird. It was at 17 hours into a 24 hour stream so he probably doesn't know what he's talking about, but he's making orders so do your best.`);
    }
    if (message.toLowerCase() === "!butthair") {
      abbadabbabotSay(channel, client, tags, `abbabox wants you to List 3 random facts about his butt hair. (it's a mess)`);
    }
    if (message.toLowerCase() === "!exercise") {
      abbadabbabotSay(channel, client, tags, `Try to convince Abbabox to exercise.`);
    }
    if (message.toLowerCase() === "!pc") {
      abbadabbabotSay(channel, client, tags, `write me a funny message letting chat know they met the goal for Abba's new pc and he loves us all for it.`,'','- https://www.cyberpowerpc.com/system/Prebuilt-Gaming-PC-GLX-99616');
    }
    if (message.toLowerCase().startsWith("!cherish")) {
      const targetUser = message.split(" ")[1] || tags["display-name"];
      const atSymbol = targetUser.startsWith("@") ? "" : "@";
      abbadabbabotSay(channel, client, tags, `Tell ${atSymbol}${targetUser} that abbabox cherishes their butt in a spiritual way. But make it rhyme.`);
    }
    if (message.toLowerCase().startsWith("!warn")){
      var warn_data = message.split(" ");
      abbadabbabotSay(channel, client, tags, `Give ${warn_data[1]} a warning for bad behavior.`);
    }
    if (message.toLowerCase().startsWith("!auto_pick") || message.toLowerCase().startsWith("!ap") && (tags.username == "abbadabbabot" || tags.username == "zilchgnu" || tags.username == "abbabox")) {
      (async () => {
        var last_turn_id = await settings_db.get('turn_count');
        var this_turn_id = last_turn_id ++;
        console.log('this_turn_id: ',this_turn_id);
        console.log('this_turn_id % 3',this_turn_id % 3);
        if(next_only) {
          client.say(
            channel,
            `!next - This is turn ${this_turn_id}`
          );
          return;
        }
        if(random_only) {
          client.say(
            channel,
            `!random - This is turn ${this_turn_id}`
          );
          return;
        }
        if(this_turn_id % 3 == 0) {
          //abbadabbabotSay(channel, client, tags, `announce to chat that you are auto picking next for the next turn in a funny way`,'!next ',` - This is turn ${this_turn_id}`);
          client.say(
            channel,
            `!next - This is turn ${this_turn_id}`
          );
        } else {
          //abbadabbabotSay(channel, client, tags, `announce to chat that you are auto picking random for the next turn in a funny way`,'!random ',` - This is turn ${this_turn_id}`);
          client.say(
            channel,
            `!random - This is turn ${this_turn_id}`
          );
        }
      })();  
    }
    if (message.toLowerCase().startsWith("!log_roll")) {
      var roll_data = message.split(" ");
      var this_dice_rolls = dice_tracker_db.get(roll_data[1]);

      if (this_dice_rolls == null) {
        this_dice_rolls = [roll_data[2]];
      } else {
        this_dice_rolls.push(roll_data[2]);
      }
      dice_tracker_db.set(roll_data[1], this_dice_rolls);

      const roll_counts = {};

      for (const element of this_dice_rolls) {
        if (roll_counts[element]) {
          roll_counts[element] += 1;
        } else {
          roll_counts[element] = 1;
        }
      }
      var roll_count_ordinal = ordinal_suffix_of(roll_counts[roll_data[2]]);
      client.say(
        channel,
        `This is the ${roll_count_ordinal} ${roll_data[2]} rolled on the ${roll_data[1]}`
      );
    }
    if (message.toLowerCase() === "!reset_roll_log") {
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        dice_tracker_db.clear();
        client.say(channel, `The Roll Tracker has been reset.`);
      }
    }
    if (message.toLowerCase() === "!magic_number") {
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
            io.emit('jarjar');

        client.say(channel, `The Magic Number is ${magic_number}`);
      }
    }
    if (message.toLowerCase().startsWith("!rate")) {
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        var rating_statement = message.split("!rate")[1];
        var item = rating_statement.split('|')[0];
        var rating = rating_statement.split('|')[1];
        var rating_obj = { 'item': item.trim(), 'rating': rating.trim(), 'timestamp': Math.floor(Date.now() / 1000)};
        ratings_db.push("ratings", rating_obj);

        abbadabbabotSay(channel, client, tags, `First and foremost make your response sound steven wright joke. Tell Chat that Abba has given the ${item} a rating of ${rating} out of 4 but do it in a funny way, try to make it viral. Keep your response to a sentence or two please.`,'Rating Logged - ',` ${item} - ${rating} out of 4`);

      }
    }
    if (message.toLowerCase().startsWith("!rating ")) {
      const currentTime = Date.now();
      var item_to_find = message.split("!rating ")[1];
      var ratings = ratings_db.get("ratings");
      if (userRatingsTimestamps[tags["display-name"]] && currentTime - userRatingsTimestamps[tags["display-name"]] < 5 * 60 * 1000 && ratings_uncapped == false && isBroadcaster == false && isMod == false) {
        // Skip the rest of the code if the user has used the !rating command within the last 5 minutes
        console.log('user has used the !rating command within the last 5 minutes')
        return;
      }
      // Update the timestamp for the user
      userRatingsTimestamps[tags["display-name"]] = currentTime;

      const options = {
        includeScore: true,
        keys: ['item'],
        threshold: 0.1
      }
      const ratings_search = new Fuse(ratings, options);
      
      var result = ratings_search.search(item_to_find);

      if(result.length > 0){
        abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} that Abba has given ${result[0].item.item} a rating of ${result[0].item.rating} out of 4 it could be a movie, show, game, or food`,'',` ${result[0].item.item} - ${result[0].item.rating}/4`);
      }else{
        abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} that couldn't find that rating.`,'',' - Rating not found');
      }
    }
    if (message.toLowerCase() === "!ded") {
      console.log('ded added');
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        var deaths = deaths_db.get("deaths");
        deaths++;
        deaths_db.set("deaths", deaths);
        io.emit('updateDeathCount',deaths);
        //abbadabbabotSay(channel, client, tags, `Tell chat that abbabox just has crashed for the ${deaths} time and give abbabox a some driving tips.`,'',' - ' + deaths + ' crashes');
        abbadabbabotSay(channel, client, tags, `Tell chat that abbabox just has killed ${deaths} players in his RPG.`,'',' - ' + deaths + ' deaths');

        if (deaths % 10 == 0 && deaths !== 0) {
          //client.say(channel, `This Death Brings SUFFERING!`);
        }
      }
    }
    if (message.toLowerCase() === "!ded_count") {
      var deaths = deaths_db.get("deaths");
      abbadabbabotSay(channel, client, tags, `Tell chat that abbabox has killed ${deaths} players in his RPG in a funny way use a bunch of emojis .`,'',' - ' + deaths + ' deaths');

      if (deaths % 10 == 0 && deaths !== 0) {
        //client.say(channel, `This Death Brings SUFFERING!`);
      }
    }
    if (message.toLowerCase() === "!ded_reset") {
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        var deaths = deaths_db.get("deaths");

        deaths_db.set("deaths", 0);
        io.emit('updateDeathCount',0);
        abbadabbabotSay(channel, client, tags, `Tell chat about how harsh of a GM abba is`,'',' - deaths set to 0');
      }
    }
  if (message.toLowerCase().startsWith("!ded_set")) {
      if (isBroadcaster || tags.username == "zilchgnu" || isMod) {
        var deaths = deaths_db.get("deaths");
        var death_count = message.split("!ded_set")[1];
        deaths_db.set("deaths", death_count);
        io.emit('updateDeathCount',death_count);

        abbadabbabotSay(channel, client, tags, `Tell chat about how harsh of a GM abba is`,'',' - deaths set to ' + death_count);

      }
    }
if (message.toLowerCase().startsWith("!join")) {
  var queue = queue_db.get("queue") || [];
  var turn_counter = turns_db.get("turns") || [];

  if (queue_open) {
    var in_queue = queue.findIndex(queueItem => queueItem.username === tags.username);

    if (in_queue < 0) {
      var turn_count = turn_counter.reduce((acc, cur) => (cur.username === tags.username ? ++acc : acc), 0);
      tags.turn_count = turn_count;
      tags.priority = 1; // Default priority
      tags.joinTime = Date.now(); // Record the join time
      queue_db.push("queue", tags);

      var place_in_queue = queue.length + 1;
      var place_ordinal = ordinal_suffix_of(place_in_queue);

      client.say(
        channel,
        `@${tags["display-name"]}, added to queue with priority ${tags.priority}! You're ${place_ordinal} in the queue.`
      );
    } else {
      var place_in_queue = in_queue + 1;
      var place_ordinal = ordinal_suffix_of(place_in_queue);

      client.say(
        channel,
        `@${tags["display-name"]}, you're already in the queue at position ${place_ordinal} with priority ${queue[in_queue].priority}.`
      );
    }
  } else {
    abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} that the queue is closed in a silly way.`);
  }
}


    if (message.toLowerCase().startsWith("!leave")) {
      //get the queue db
      let queue = queue_db.get("queue");
      //make queue empty if null
      if (queue == null) {
        queue = [];
      }
      //Check if the user is in the queue
      var in_queue = queue.findIndex(function (queue, index) {
        if (queue.username == tags.username) return true;
      });
      //check if user is in queue
      if (in_queue < 0) {
        abbadabbabotSay(channel,client,tags,`Tell ${tags["display-name"]} you can't find them in the queue`,'','- @' + tags["display-name"]);
      } else {
        //remove user from queue
        queue.splice(in_queue, 1);
        //update the database
        let queue_update = queue_db.set("queue", queue);
        abbadabbabotSay(channel,client,tags,`Tell chat that ${tags["display-name"]} has left the queue and let them know they'll be missed`,'','- @' + tags["display-name"]);

      }
    }
if (message.toLowerCase().startsWith("!next")) {
  if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
    let queue = queue_db.get("queue") || [];
    let turn_counter = turns_db.get("turns") || [];

    // Function to check if a user has had a turn
    function hasUserHadTurn(username) {
      return turn_counter.some(turn => turn.username === username);
    }

    // Filter the queue based on "First Turns First" mode
    let eligibleQueue = [];
    if (firsts_first) {
      // Users who haven't had a turn yet
      eligibleQueue = queue.filter(user => !hasUserHadTurn(user.username));
      // If no eligible users, include all users
      if (eligibleQueue.length === 0) {
        eligibleQueue = queue.slice(); // Copy the queue
      }
    } else {
      eligibleQueue = queue.slice(); // Copy the queue
    }

    // Sort the eligible users by priority and joinTime
    eligibleQueue.sort((a, b) => {
      const priorityDifference = (b.priority || 1) - (a.priority || 1);
      if (priorityDifference !== 0) {
        return priorityDifference; // Sort by priority
      } else {
        return a.joinTime - b.joinTime; // Sort by joinTime (earlier first)
      }
    });

    // Select the next user
    let current_player = eligibleQueue[0];

    if (current_player) {
      // Remove the selected user from the queue
      let userIndex = queue.findIndex(user => user.username === current_player.username);
      queue.splice(userIndex, 1);
      queue_db.set("queue", queue);

      // Update the turn counter
      turns_db.push("turns", current_player);

      // Update current_turn
      current_turn = current_player["display-name"];
      io.emit('new_turn', `${current_player["display-name"]}`);

      // Notify the user
      let turn_count = turn_counter.reduce(
        (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
        0
      );

      let turn_ordinal = ordinal_suffix_of(turn_count + 1);
      client.say(
        channel,
        `@${current_player["display-name"]}, it's your turn! This is your ${turn_ordinal} turn.`
      );
    } else {
      client.say(channel, `No users are in the queue.`);
    }
  }
}


    if (message.toLowerCase().startsWith("!random")) {
      if (isBroadcaster || tags.username == "zilchgnu" || tags.username == "abbadabbabot") {
        let queue = queue_db.get("queue") || [];
        let turn_counter = turns_db.get("turns") || [];

        // Function to check if a user has had a turn
        function hasUserHadTurn(username) {
          return turn_counter.some(turn => turn.username === username);
        }

        // Filter the queue based on "First Turns First" mode
        let eligibleQueue = [];
        if (firsts_first) {
          // Users who haven't had a turn yet
          eligibleQueue = queue.filter(user => !hasUserHadTurn(user.username));
          // If no eligible users, include all users
          if (eligibleQueue.length === 0) {
            eligibleQueue = queue.slice(); // Copy the queue
          }
        } else {
          eligibleQueue = queue.slice(); // Copy the queue
        }

        // Find the highest priority among eligible users
        let highestPriority = Math.max(...eligibleQueue.map(user => user.priority || 1));

        // Filter users with the highest priority
        let highestPriorityUsers = eligibleQueue.filter(user => (user.priority || 1) === highestPriority);

        // Randomly select a user from the highest priority group
        let random_index = crypto.randomInt(highestPriorityUsers.length);
        let current_player = highestPriorityUsers[random_index];

        if (current_player) {
          // Remove the selected user from the queue
          let userIndex = queue.findIndex(user => user.username === current_player.username);
          queue.splice(userIndex, 1);
          queue_db.set("queue", queue);

          // Update the turn counter
          turns_db.push("turns", current_player);

          // Update current_turn
          current_turn = current_player["display-name"];
          io.emit('new_turn', `${current_player["display-name"]}`);

          // Notify the user
          let turn_count = turn_counter.reduce(
            (acc, cur) => (cur.username === current_player.username ? ++acc : acc),
            0
          );

          let turn_ordinal = ordinal_suffix_of(turn_count + 1);
          client.say(
            channel,
            `@${current_player["display-name"]}, you've been randomly selected! This is your ${turn_ordinal} turn.`
          );
        } else {
          client.say(channel, `No users are in the queue.`);
        }
      }
    }



    if (message.toLowerCase() === "!list") {
      //return page with list of queue
      abbadabbabotSay(channel,client,tags,`Announce to @${tags["display-name"]} that we have a list that they can use to find their place in the queue.`, '', ' ' + process.env.queue_list_url);
    }
    if (message.toLowerCase() === "!menu" || message.toLowerCase() === "!commands") {
      //return page with list of queue
      abbadabbabotSay(channel,client,tags,`Tell @${tags["display-name"]} they can use menu to find abbadabbabot chat commands.`, '', ' ' + process.env.queue_list_url + '/menu');
    }
    if (message.toLowerCase() === "!splots_db") {
      //return page with list of queue
      abbadabbabotSay(channel,client,tags,`Tell @${tags["display-name"]} they can use the following link to get ideas for splots.`, '', ' ' + process.env.queue_list_url +  '/splot_db');
    }
    if (message.toLowerCase() === "!ratings") {
      //return page with list of queue
      abbadabbabotSay(channel,client,tags,`Tell @${tags["display-name"]} that look at the list themselves.`, '', ' ' + process.env.ratings_list_url);
    }
    if (message.toLowerCase() === "!joeydoodah" ||message.toLowerCase() === "!joey") {
      //return page with list of queue
      abbadabbabotSay(channel,client,tags,`Tell Chat a a real short story about JoeyDoodah, the eldest abbaboxer to have enjoyed the stream. The tar chewing, gasoline drinking, dirty joke telling, nonagenarian fan who sadly passed away.`, '', '- RIP Joey Doodah');
    }
    if (message.toLowerCase() === "!position") {
      let queue = queue_db.get("queue") || [];
      let turn_counter = turns_db.get("turns") || [];

      // Function to check if a user has had a turn
      function hasUserHadTurn(username) {
        return turn_counter.some(turn => turn.username === username);
      }

      // Filter the queue based on "First Turns First" mode
      let eligibleQueue = [];
      if (firsts_first) {
        // Users who haven't had a turn yet
        eligibleQueue = queue.filter(user => !hasUserHadTurn(user.username));
        // If no eligible users, include all users
        if (eligibleQueue.length === 0) {
          eligibleQueue = queue.slice(); // Copy the queue
        }
      } else {
        eligibleQueue = queue.slice(); // Copy the queue
      }

      // Sort the eligible users by priority and joinTime
      eligibleQueue.sort((a, b) => {
        const priorityDifference = (b.priority || 1) - (a.priority || 1);
        if (priorityDifference !== 0) {
          return priorityDifference; // Sort by priority
        } else {
          return a.joinTime - b.joinTime; // Sort by joinTime (earlier first)
        }
      });

      let in_queue = eligibleQueue.findIndex(queueItem => queueItem.username === tags.username);

      if (in_queue < 0) {
        abbadabbabotSay(channel, client, tags, `Tell @${tags["display-name"]} you can't find them in the queue.`);
      } else {
        let place_in_queue = in_queue + 1;
        let place_ordinal = ordinal_suffix_of(place_in_queue);
        let userPriority = eligibleQueue[in_queue].priority || 1;

        abbadabbabotSay(channel, client, tags, `@${tags["display-name"]}, you are ${place_ordinal} in the queue with priority ${userPriority}.`);
      }
    }


    //allow people to join the queue
    if (message.toLowerCase() === "!open") {
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu") {
        //set queue_open to true
        queue_open = true;

        //let the chat know what is up
        abbadabbabotSay(channel,client,tags,'formally announce the opening of the queue to the chat');
      }
      io.emit('new_turn', `Queue Just Opened`);
    }
    //toggle ai_enabled mode
    if (message.toLowerCase() === "!toggle_ai") {
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu") {
        //toggle ai_enabled
        ai_enabled = !ai_enabled;
        // set string for current status of ai_enabled
        var ai_enabled_status = ai_enabled ? "enabled" : "disabled";
        //let the chat know what is up
        abbadabbabotSay(channel,client,tags,`Let chat know AI is now ${ai_enabled_status}.`);
      }
    }

    //stop people from joining the queue
    if (message.toLowerCase() === "!close") {
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu") {
        //set queue_open to true
        queue_open = false;
        //let the chat know what is up
        abbadabbabotSay(channel,client,tags,'formally announce the closing of the queue to the chat');
        io.emit('new_turn', `Queue Closed`);

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
    if (message.toLowerCase() === "!clear_all") {
      //clear the queue
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu") {
        queue_db.clear();
        turns_db.clear();
        abbadabbabotSay(channel,client,tags,'formally announce the _ing of the queue to the chat');
        var current_player = []
        io.emit('new_turn', `Turns Cleared`);
      }
    }
    if (message.toLowerCase() === "!clear_turns") {
      //clear the queue
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu") {
        turns_db.clear();
        abbadabbabotSay(channel,client,tags,'formally announce that turns have been reset');
        var current_player = []
        io.emit('new_turn', `Turns Cleared`);

      }
    }
    if (message.toLowerCase() === "!clear") {
      //clear the queue
      //check if mod
      if (isBroadcaster || tags.username == "zilchgnu") {
        queue_db.clear();
        abbadabbabotSay(channel,client,tags,'formally announce the clearing of the queue to the chat');
      }
    }

    if (message.toLowerCase() === "!auto_splot" && tags["display-name"] == current_turn) {
      var random_splot = get_random_splot();
      say(channel, client, tags, `${random_splot}`, '@' + tags["display-name"] + ' ', '- <3 abbabot');
    }
    if (message.toLowerCase() === "!suggest_splot" && tags.username == "zilchgnu") {
      var random_splot = get_random_splot();
      say(channel, client, tags, `${random_splot}`, '@' + tags["display-name"] + ' ', '- <3 abbabot');
    }
});
function removeURLs(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, "");
}

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

const system_text_string = `First and foremost keep your response short and concise and try to rhyme. The shorter the response the better. We are going to have a roleplay. You will respond to all of my questions as Abbadabbabot. Abbadabbabot is the MC for Abbabox's twitch and discord. Abbadabbabot has a real edgy personality. He really likes to make jokes, and say things that on the surface may sound crude or rude. His personality causes him to curse frequently and sometimes be rude to people talking to him. But everyone around here loves his personality and we can't get enough of him. Abbabox is a twitch streamer who is known for his home brew interactive twitch gameshow Bootcut and his competitive free mediashare streams.`
let messageArray = [
  {"role": "system","content": process.env.openai_system_text_string }
];
async function abbadabbabotSay(channel, client, tags, message, prefix="", postfix="") {
  console.log('ai_enabled', ai_enabled);
  if (ai_enabled) {
    const messageContent = `${tags.username}: ` + message;
    const newMessage = {
      "role": "user",
      "content": messageContent
    };
    messageArray.push(newMessage);
    console.log('usermessage',messageArray);
    try {
     const response = await openai.createChatCompletion(
       {
        model: "gpt-4o",
        messages: messageArray,
        temperature: 1.3,
        frequency_penalty: 0,
        presence_penalty: 0,
        user: tags.username
      });
      const censored_response = removeURLs(censor.cleanProfanity(response.data.choices[0]['message']['content'].trim())).replace(/^Abbadabbabot: /, '').replace(/^"|"$/g, '');
      
      const newResponse = {
        "role": "assistant",
        "content": censored_response
      };
      messageArray.push(newResponse);
      // Remove the 2nd and 3rd elements if longer than 21 elements.
      if (messageArray.length >= 1) {
          // Remove the 2nd and 3rd elements
          messageArray.splice(1, 2);
          console.log('trimming message array')
      }

      client.say(channel, prefix + censored_response + postfix);
      return new Promise(resolve => {
        resolve('resolved');
      });
    }
    catch (error) {
      ai_enabled = false;
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
        error = error.response.status;
      } else {
        console.log(error.message);
        error = error.message;
      }
      client.say(channel, prefix + '- ai offline - ' + 'prompt: ' + message + postfix);
      return new Promise(resolve => {
        resolve('resolved');
      });
    }
  }else{
    client.say(channel, prefix + '- ai offline - ' + 'prompt: ' + message + postfix);
    return new Promise(resolve => {
      resolve('resolved');
    });
  }
}

  function say(channel, client, tags, message, prefix="", postfix="") {
     client.say(channel, prefix + message + postfix);
    return new Promise(resolve => {
      resolve('resolved');
    });
  }
function get_random_splot() {
  const historical_splots = historical_splots_db.all();
  const splot_values = Object.keys(historical_splots);
  
  // Calculate a random index based on the length of splot_values
  const randomIndex = crypto.randomInt(splot_values.length);

  // Select the random splot
  const random_splot = splot_values[randomIndex];

  return random_splot;
}

client.on("join", async (channel, username, self) => {
    if(!await users_in_chat_db.has(username)) {
          console.log('username joined:', username);
          await users_in_chat_db.push(username, Date.now());
    }
});

client.on("part", async (channel, username, self) => {
    console.log('username left:', username);
    await users_in_chat_db.delete(username);
});
async function abbadabbabotText(message) {
  console.log("ai_enabled", ai_enabled);
  if (ai_enabled) {
    const messageContent = `user: ` + message;
    const newMessage = {
      role: "user",
      content: messageContent,
    };

    // Separate the "system" messages from the rest
    const systemMessages = messageArray.filter(message => message.role === "system");
    const otherMessages = messageArray.filter(message => message.role !== "system");

    // Trim the non-system messages to the desired length
    while (otherMessages.length > ai_memory_limit) {
      otherMessages.shift(); // Remove the oldest non-system message
    }

    // Combine the system messages with the trimmed non-system messages
    messageArray = [...systemMessages, ...otherMessages];
    messageArray.push(newMessage);
    console.log("trimmed messageArray:", messageArray);

    try {
      const response = await openai.createChatCompletion({
        model: openai_chatbot_model_id,
        messages: messageArray,
        temperature: 1.25,
        frequency_penalty: 1.0,
        presence_penalty: 1.0,
        user: 'user',
      });
      const censored_response = removeURLs(
        censor.cleanProfanity(
          response.data.choices[0]["message"]["content"].trim()
        )
      )
        .replace(/^Abbadabbabot: /, "")
        .replace(/^"|"$/g, "");

      const newResponse = {
        role: "assistant",
        content: censored_response,
      };
      messageArray.push(newResponse);

      return censored_response;
    } catch (error) {
      ai_enabled = false;
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
        error = error.response.status;
      } else {
        console.log(error.message);
        error = error.message;
      }
      return "- ai offline - " + "prompt: " + message;
    }
  } else {
    return "- ai offline - " + "prompt: " + message;
  }
}

async function gen_and_play_tts(message,model='eleven_multilingual_v2') {
  const voiceResponse = await voice.textToSpeech({
    // Required Parameters
    textInput:       message,                // The text you wish to convert to speech
    fileName:        `./public/audio/output.mp3`,       // The filename to save the audio to
    // Optional Parameters
    stability:       0.3,                            // The stability for the converted speech
    similarityBoost: 0.9,                            // The similarity boost for the converted speech
    modelId:         model,                          // The ElevenLabs Model ID
    style:           0.3,                            // The style exaggeration for the converted speech
    responseType:    "stream",                       // The streaming type (arraybuffer, stream, json)
    speakerBoost:    true                            // The speaker boost for the converted speech
  }).then((res) => {
    //res.pipe(fs.createWriteStream(`./public/audio/output.mp3`));
    console.log('tts done');
    io.emit("play_tts", message);
  });
} 