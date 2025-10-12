const connectedDice = {};

var this_js_script = $('script[src*=main]');
var data = this_js_script.attr('data'); 
const templateData = JSON.parse(data);
let timerStatus = 'idle';

const formatMsAsDisplay = (ms) => {
  const totalMs = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
};

console.log('templateData',templateData);
$(document).ready(function() {
    $("#img1").attr("src", "portal.jpg");
    $(".fart-button").click(function() {
      playFart();
    });

    // Select all buttons on the page
    const buttons = document.querySelectorAll('button');

    // Attach an event listener to each button
    buttons.forEach(button => {
      button.addEventListener('click', maybeFire);
    });

  });
  var socket = io();
  socket.on("connect", () => {
    console.log('socket connected:',socket.connected); // true
  });
  socket.on('alt_splot_swap', function(data) {
    if (!data || data.id === undefined || data.id === null) { return; }
    const spotId = String(data.id);
    const entryEl = document.getElementById(`splotEntry_${spotId}`);
    const dotEl = document.getElementById(`splot_dot_${spotId}`);
    const container = document.getElementById(`splot_${spotId}`);

    const hellfireSet = new Set((data.hellfireSpotIds || []).map((value) => String(value)));
    const heavenfireSet = new Set((data.heavenFireSpotIds || []).map((value) => String(value)));
    const hasAltFlag = typeof data.isAlt === 'boolean';
    const isAlt = hasAltFlag ? Boolean(data.isAlt) : false;
    const isHeavenfire = heavenfireSet.has(spotId) || (spotId === '6' && isAlt && !hellfireSet.has(spotId));
    const isHellfire = !isHeavenfire && (hellfireSet.has(spotId) || (isAlt && spotId !== '6'));
    const altActive = hasAltFlag ? isAlt : (isHeavenfire || (isHellfire && spotId !== '6'));

    const baseEntry = data.entry ?? '';
    const altEntry = data.alt_entry ?? baseEntry;
    const baseDots = data.splot_dot ?? 0;
    const altDots = data.alt_splot_dot ?? baseDots;

    if (entryEl) {
      const activeEntry = altActive ? altEntry : baseEntry;
      entryEl.textContent = activeEntry;
    }
    if (dotEl) {
      const activeDots = altActive ? altDots : baseDots;
      dotEl.textContent = activeDots;
    }
    if (container) {
      container.classList.toggle('is-heavenfire', isHeavenfire);
      container.classList.toggle('is-hellfire', isHellfire);
      if (isHeavenfire) {
        container.dataset.heavenfire = 'true';
      } else {
        delete container.dataset.heavenfire;
      }
      if (isHellfire) {
        container.dataset.hellfire = 'true';
      } else {
        delete container.dataset.hellfire;
      }
    }
  });
  // Twitch chat connection
  const client = new tmi.Client({
      options: { debug: true },
        identity: {
          username: templateData.username,
          password: templateData.password
        },
        channels: templateData.channels
  });
  client.connect().catch(console.error);
  // Create an array to store the last 10 messages
  let lastTenMessages = [];
  // Variable to store the desired username
  let desiredUsername = templateData.current_turn;
  let isChatOpen = true;
  // Listen for new messages in the chat
  client.on("message", (channel, tags, message, self) => {
    // Check if the message is from the desired user
    if (tags.username.toLowerCase() === desiredUsername.toLowerCase()) {
      // Add the message to the array
      lastTenMessages.push({ username: tags.username, message });
      // Remove the first element of the array if it exceeds 10 elements
      if (lastTenMessages.length > 10) {
        lastTenMessages.shift();
      }
      // Update the page with the new message
      updatePage(lastTenMessages);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    socket.on("new_turn", function(msg){
      console.log("new_turn");
      desiredUsername = msg;
      lastTenMessages = [];
      updateTurn(msg);
    });
    socket.on("random_splot", function(msg){
      console.log("random_splot",msg);
      generate_splot(msg);
    });
    socket.on("win_sound", function(msg){
      Object.values(connectedDice).forEach((diceInstance) => {
         diceInstance.pulseLed(5, 30, 20, [0, 255, 0]); // Example green color for "win"
      });
      const win_sound = document.getElementById(`win_sound`);
      win_sound.volume = 0.1;
      win_sound.play();
    });

    socket.on("lose_sound", function(msg){
      Object.values(connectedDice).forEach((diceInstance) => {
         diceInstance.pulseLed(5, 30, 20, [255, 0, 0]); // Example red color for "lose"
      });
      const lose_sound = document.getElementById(`lose_sound`);
      lose_sound.volume = 0.2;
      lose_sound.play();
    });
    socket.on('add_time', (additionalSeconds) => {
      CountDown.AddTime(additionalSeconds);
      if (CountDown.IsRunning()) {
        timerStatus = 'running';
      } else if (CountDown.GetRemainingMs() > 0) {
        timerStatus = (timerStatus === 'paused') ? 'paused' : 'idle';
      } else {
        timerStatus = 'idle';
      }
    });
    $.getJSON("historical_splots.json", function(data) {
      var keys = Object.keys(data);
      $('.splotEntry').autocomplete({
          source: keys
      });
    });
    updateTurn(templateData.current_turn);
    CountDown.ResetDisplay();
    timerStatus = 'idle';
    $('#autoPick').click(function(){
      client.connect()
      .then((data) => {
        client.say(templateData.channels[0],'!ap');
        client.disconnect();
      }).catch((err) => {
          console.log(err);
      });
    });
    $('#randomPick').click(function(){
      client.connect()
      .then((data) => {
        client.say(templateData.channels[0], '!random');
        client.disconnect();
      }).catch((err) => {
          console.log(err);
      });
    });
    $('#nextPick').click(function(){
      client.connect()
      .then((data) => {
        client.say(templateData.channels[0], '!next');
        client.disconnect();
      }).catch((err) => {
          console.log(err);
      });
    });
    $('#toggle_ai').click(function(){
      console.log('toggle ai');
      socket.emit('ai_toggle', 'ai_off', (response) => {
        console.log(response);
        //Change the name of the button depending on the boolean returned
        if(response){
          $('#toggle_ai').text('Disable AI');
        } else {
          $('#toggle_ai').text('Enable AI');
        }
      });

    });
    $('#pause').click(function(){
      if (timerStatus !== 'running') { return; }
      let timer_data = {
        'action' : 'pause',
        'timer_display' : $('#timer_display').text()
      };
      socket.emit('timer_admin', timer_data, (response) => {
        console.log(response);
      });
      CountDown.Pause();
      timerStatus = CountDown.GetRemainingMs() > 0 ? 'paused' : 'idle';
    });
    $('#resume').click(function(){
      let remaining = CountDown.GetRemainingMs();
      if (timerStatus === 'idle') {
        if (remaining <= 0) {
          startTimer();
          remaining = CountDown.GetRemainingMs();
        }
        if (remaining <= 0) {
          return;
        }
        const display = formatMsAsDisplay(remaining);
        let timer_data = {
          action: 'start',
          timer_value: remaining,
          timer_display: display
        };
        socket.emit('timer_admin', timer_data, (response) => {
          console.log(response);
        });
        CountDown.Start(remaining);
        timerStatus = 'running';
        return;
      }
      if (timerStatus === 'paused' && remaining > 0) {
        const display = formatMsAsDisplay(remaining);
        let timer_data = {
          action: 'resume',
          timer_display: display
        };
        socket.emit('timer_admin', timer_data, (response) => {
          console.log(response);
        });
        CountDown.Resume();
        timerStatus = 'running';
      }
    });
  }, false);
  var CountDown = (function ($) {
    var TimeOut = 10000;
    var TimeGap = 1000;
    var running = false;
    var endTime = Date.now();
    var remainingMs = 0;
    var timerHandle = null;
    var $timerDisplay = $();
    var $pauseBtn = $();
    var $resumeBtn = $();
    var $resetBtn = $();

    var ensureElements = function () {
      if ($timerDisplay.length === 0) { $timerDisplay = $('#timer_display'); }
      if ($pauseBtn.length === 0) { $pauseBtn = $('#pause'); }
      if ($resumeBtn.length === 0) { $resumeBtn = $('#resume'); }
      if ($resetBtn.length === 0) { $resetBtn = $('#reset'); }
    };

    var formatSegment = function (value) {
      return String(Math.max(0, Math.floor(value))).padStart(2, '0');
    };

    var cancelTick = function () {
      if (timerHandle) {
        clearTimeout(timerHandle);
        timerHandle = null;
      }
    };

    var setDisplay = function (ms) {
      ensureElements();
      var clamped = Math.max(0, Math.floor(ms));
      var totalSeconds = Math.floor(clamped / 1000);
      var minutes = Math.floor(totalSeconds / 60);
      var seconds = totalSeconds % 60;
      $timerDisplay.text(formatSegment(minutes) + ':' + formatSegment(seconds));
    };

    var setButtonsForState = function (state) {
      ensureElements();
      switch (state) {
        case 'running':
          $pauseBtn.removeClass('d-none').show();
          $resumeBtn.addClass('d-none').hide();
          $resetBtn.hide();
          break;
        case 'paused':
          $pauseBtn.removeClass('d-none').hide();
          $resumeBtn.removeClass('d-none').show();
          $resetBtn.show();
          break;
        case 'idle':
          $pauseBtn.addClass('d-none').hide();
          $resumeBtn.removeClass('d-none').show();
          $resetBtn.show();
          break;
        case 'expired':
          $pauseBtn.addClass('d-none').hide();
          $resumeBtn.removeClass('d-none').show();
          $resetBtn.show();
          break;
        default:
          $pauseBtn.addClass('d-none').hide();
          $resumeBtn.addClass('d-none').hide();
          $resetBtn.show();
      }
    };

    var applyExpiredState = function () {
      ensureElements();
      running = false;
      remainingMs = 0;
      cancelTick();
      setDisplay(0);
      $timerDisplay.css('color', 'red');
      setButtonsForState('expired');
      timerStatus = 'idle';
    };

    var tick = function () {
      if (!running) { return; }
      var now = Date.now();
      remainingMs = Math.max(0, endTime - now);
      if (remainingMs <= 0) {
        applyExpiredState();
        return;
      }
      setDisplay(remainingMs);
      timerHandle = setTimeout(tick, TimeGap);
    };

    var Start = function (timeoutMs) {
      var parsed = Number(timeoutMs);
      if (!Number.isFinite(parsed)) {
        parsed = TimeOut;
      } else if (parsed > 0) {
        TimeOut = parsed;
      }
      remainingMs = Math.max(0, parsed);
      cancelTick();
      if (remainingMs <= 0) {
        applyExpiredState();
        return;
      }
      running = true;
      endTime = Date.now() + remainingMs;
      ensureElements();
      $timerDisplay.css('color', 'black');
      setDisplay(remainingMs);
      setButtonsForState('running');
      timerHandle = setTimeout(tick, TimeGap);
    };

    var Pause = function () {
      if (!running) { return; }
      remainingMs = Math.max(0, endTime - Date.now());
      running = false;
      cancelTick();
      setDisplay(remainingMs);
      setButtonsForState(remainingMs > 0 ? 'paused' : 'expired');
      $timerDisplay.css('color', remainingMs > 0 ? 'black' : 'red');
    };

    var Resume = function () {
      if (running || remainingMs <= 0) { return; }
      running = true;
      endTime = Date.now() + remainingMs;
      ensureElements();
      $timerDisplay.css('color', 'black');
      setButtonsForState('running');
      cancelTick();
      setDisplay(remainingMs);
      timerHandle = setTimeout(tick, TimeGap);
    };

    var AddTime = function (secondsToAdd) {
      var deltaMs = Number(secondsToAdd) * 1000;
      if (!Number.isFinite(deltaMs)) { return; }
      if (running) {
        remainingMs = Math.max(0, endTime - Date.now()) + deltaMs;
        endTime = Date.now() + remainingMs;
        cancelTick();
        timerHandle = setTimeout(tick, TimeGap);
      } else {
        remainingMs = Math.max(0, remainingMs) + deltaMs;
      }
      if (remainingMs <= 0) {
        applyExpiredState();
        return;
      }
      setDisplay(remainingMs);
      if (!running) {
        setButtonsForState('paused');
        ensureElements();
        $timerDisplay.css('color', 'black');
      }
    };

    var Prime = function (durationMs) {
      var parsed = Number(durationMs);
      if (!Number.isFinite(parsed) || parsed < 0) {
        parsed = 0;
      }
      cancelTick();
      running = false;
      remainingMs = parsed;
      setDisplay(parsed);
      ensureElements();
      $timerDisplay.css('color', 'black');
      setButtonsForState('idle');
      timerStatus = 'idle';
    };

    var ResetDisplay = function () {
      Prime(0);
    };

    return {
      Start: Start,
      Pause: Pause,
      Resume: Resume,
      AddTime: AddTime,
      Prime: Prime,
      ResetDisplay: ResetDisplay,
      IsRunning: function () { return running; },
      GetRemainingMs: function () { return remainingMs; }
    };
  })(jQuery);


  function updateTurn(text) {
      document.getElementById("current_player").innerHTML = "Current Player: " + text;
  }

  function updateBoard(splot_data){    
    var edit_string = "<button onClick = 'popEditModal(" + splot_data.id + ")' class='btn btn-sm btn-dark' title='Edit Splot'><i class='fa-solid fa-pen'></i></button>" + "\n";    
    var ba_complete_string = "<button onClick = 'breakAwaySplot("+ splot_data.id +")' class='btn btn-sm btn-dark' title='BA Replace Splot'><i class='fa-solid fa-dice-one'></i></button>" + "\n" +
    "<button onClick = 'completeSplot(" + splot_data.id + ")' class='btn btn-sm btn-dark'  title='Complete Splot'><i class='fa-solid fa-circle-check'></i></button>" + "\n";
    var splot_dots = '<span class="fa-stack"><span class="fa-regular fa-circle fa-stack-2x"></span><strong class="fa-stack-1x" id="splot_dot_' + splot_data.id + '">' + splot_data.splot_dot + '</strong></span>'+ "\n";
    var splot_dot_increase = "<button onClick = 'splotDotIncrease(" + splot_data.id + ")' class='btn btn-sm btn-dark'  title='Increase Splot Dot'><i class='fa-solid fa-plus-circle'></i></button>" + "\n";
    var splot_dot_decrease = "<button onClick = 'splotDotDecrease(" + splot_data.id + ")' class='btn btn-sm btn-dark'  title='Decrease Splot Dot'><i class='fa-solid fa-minus-circle'></i></button>" + "\n";
    var fart_button = "<button onClick = 'swapSplot(" + splot_data.id + ")'class='btn btn-sm btn-dark swap_splot'  title='Swap Splot'><i class='fa-solid fa-arrow-right-arrow-left'></i></button>";
    var alt_entry_string = splot_data.alt_entry ?
    "<p>ALT SPLOT: <span id='altSplotEntry_" + splot_data.id + "'>" + splot_data.alt_entry +"</span> : <span id='alt_splot_dot_" + splot_data.id + "'>" + splot_data.alt_splot_dot + "</span> dots</p>" :
    '';

    var innerHTML = "<div class='row'>" +
      '<div class="col-md-8">' +
        '<h3 >' + splot_data.id + ': <span id="splotEntry_' + splot_data.id + '">' + splot_data.entry + '</span></h3>' +
        alt_entry_string +
      '</div>' +
      '<div class="col-md-1">' +
        '<span class="fa-stack float-right fa-beat">' +
          '<span class="fa-regular fa-circle fa-stack-2x"></span>' +
          '<strong class="fa-stack-1x" id="splot_dot_' + splot_data.id + '">' + splot_data.splot_dot + '</strong>' +
        '</span>' +
      '</div>' +
      '<div class="col-md-3" id="new_splot_'+ splot_data.id +'_buttons">' + 
        '<div class="row">' +
          '<div class="col-md-12">' +
              '<div class="btn-group" role="group">' +
                splot_dot_increase + ba_complete_string +
              "</div>" +
          "</div>" +
        "</div>" +
        '<div class="row">' +
          '<div class="col-md-12">' +
              '<div class="btn-group" role="group">' +
                splot_dot_decrease + edit_string + fart_button + 
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
        
    var this_splot = document.getElementById('splot_' + splot_data.id);

    if (this_splot) {
        this_splot.innerHTML = innerHTML;
    } else {
      var div = document.createElement("div");
      div.className = "col-md-6";
      div.id = 'splot_' + splot_data.id;
      div.innerHTML = innerHTML;
      document.getElementById("board").appendChild(div);
    }
  }

  function getSplotData(splot_id) {
    let splot_data = { id: splot_id };
  
    const splotDotsElement = document.getElementById("splot_dot_" + splot_id);
    const splotEntryElement = document.getElementById("splotEntry_" + splot_id);
    const altSplotDotsElement = document.getElementById("alt_splot_dot_" + splot_id);
    const altSplotEntryElement = document.getElementById("altSplotEntry_" + splot_id);
  
    if (splotDotsElement) {
      splot_data.splot_dot = parseInt(splotDotsElement.innerHTML);
    }
    if (splotEntryElement) {
      splot_data.entry = splotEntryElement.innerHTML.trim();
    }
    if (altSplotDotsElement) {
      splot_data.alt_splot_dot = parseInt(altSplotDotsElement.innerHTML);
    }
    if (altSplotEntryElement) {
      splot_data.alt_entry = altSplotEntryElement.innerHTML.trim();
    }
  
    console.log('getSplotData', splot_data);
    return splot_data;
  }
  
  // Breakaway Editing
  function breakawayDecrease(ba_id){
    let baData = getBreakawayData(ba_id);
    let new_ba_dot = baData.ba_dots - 1;
    let ba_data = {
        id: ba_id,
        name: baData.name,
        ba_dots: new_ba_dot
    }
    console.log(ba_data);
    updateBreakaways(ba_data)
    socket.emit('ba_admin', ba_data, (response) => {
      console.log(response);
    });
  }
  function breakawayIncrease(ba_id){
    let baData = getBreakawayData(ba_id);
    let new_ba_dot = parseInt(baData.ba_dots) + 1;
    let ba_data = {
        id: ba_id,
        name: baData.name,
        ba_dots: new_ba_dot
    }
    console.log(ba_data);
    updateBreakaways(ba_data)
    socket.emit('ba_admin', ba_data, (response) => {
      console.log(response);
    });
  }
  function popEditBreakawayModal(ba_id) {
    let baData = getBreakawayData(ba_id);
    console.log('popEditBreakawayModal',baData);
    $('#editBreakawayId').val(baData.id);
    $('#addBreakawayName').val(baData.name);
    $('#addBreakawayDots').val(baData.ba_dot);
    $('#editBreakaway').modal('show');
  }
  function editBreakaway() {
    let ba_id = $('#editBreakawayId').val();
    let ba_name = $('#addBreakawayName').val();
    let ba_dot = $('#addBreakawayDots').val();
    let ba_data = {
        id: ba_id,
        name: ba_name,
        ba_dot: ba_dot
    }
    updateBreakaways(ba_data)
    socket.emit('ba_admin', ba_data, (response) => {
      console.log(response);
    });
    $('#editBreakaway').modal('hide');
  }
  function addBreakaway() {
    let ba_count = document.getElementById("breakaways").childElementCount;
    let ba_id = ba_count + 1;
    let ba_name = $('#addBreakawayName').val();
    let ba_dots = $('#addBreakawayDots').val();
    let ba_data = {
        id: ba_id,
        name: ba_name,
        ba_dots: ba_dots
    }
    console.log('ba_data',ba_data);
    updateBreakaways(ba_data)
    socket.emit('ba_admin', ba_data, (response) => {
      console.log(response);
    });
    $('#addBreakaway').modal('hide');
  }

  function updateBreakaways(ba_data){    
    var ba_dot_increase = "<button onClick = 'breakawayIncrease(" + ba_data.id + ")' class='btn btn-sm btn-dark'  title='Increase Splot Dot'><i class='fa-solid fa-plus-circle'></i></button>" + "\n";
    var ba_dot_decrease = "<button onClick = 'breakawayDecrease(" + ba_data.id + ")' class='btn btn-sm btn-dark'  title='Decrease Splot Dot'><i class='fa-solid fa-minus-circle'></i></button>" + "\n";
    var ba_edit = "<button onClick = 'popEditBreakawayModal(" + ba_data.id + ")' class='btn btn-sm btn-dark'  title='Edit Breakaway'><i class='fa-solid fa-pen'></i></button>" + "\n";
    var innerHTML = '<div class="row">' +
            '<div class="col-md-8">' +
              '<h3><span id=\'breakawayName_' + ba_data.id + '\'>'+ ba_data.name + '</span> Breakaways</h3>' +
            '</div>' +
            '<div class="col-md-1">' +
              '<span class="fa-stack float-right fa-beat">' +
                '<span class="fa-regular fa-circle fa-stack-2x"></span>' +
                '<strong class="fa-stack-1x" id="ba_dot_' + ba_data.id + '">' +
                  ba_data.ba_dots +
                '</strong>' +
              '</span>' +
            '</div>' +
            '<div class="col-md-3">' +
              ba_dot_increase +
              ba_dot_decrease +
              ba_edit +
              "<button class='btn btn-sm btn-dark fart-button'  title='Careful'><i class='fa-solid fa-poop'></i></button>" +
            '</div>' +
            '</div>' + "\n";
        
    var this_ba = document.getElementById('breakaway_' + ba_data.id);

    if (this_ba) {
        this_ba.innerHTML = innerHTML;
    } else {
      var div = document.createElement("div");
      div.className = "col-md-6";
      div.id = 'breakaway_' + ba_data.id;
      div.innerHTML = innerHTML;
      document.getElementById("breakaways").appendChild(div);
    }
  }

  function getBreakawayData(ba_id){
    let current_ba_dots = parseInt(document.getElementById("ba_dot_" + ba_id).innerHTML);
    let current_ba_name = document.getElementById("breakawayName_" + ba_id).innerHTML.trim();
    let ba_data = {
        id: ba_id,
        name: current_ba_name,
        ba_dots: current_ba_dots
    }
    console.log('getBreakawayData',ba_data)
    return ba_data;
  }

  function clearBreakaways(){
    if (confirm("Sure you wanna clear the breakaways?") == true) {
      socket.emit('clear_breakaways', 'clear', (response) => {
            console.log(response);
      });
      document.getElementById("breakaways").innerHTML = "";
    }
  }

  function breakAwaySplot(splot_id){
    let splot_data = getSplotData(splot_id);
    splot_data.action = 'Breakaway Replace';
    socket.emit('log_action', splot_data, (response) => {
      console.log(response);
    });
    popEditModal(splot_id);
  }
  function completeSplot(splot_id){
    let splot_data = getSplotData(splot_id);
    splot_data.action = 'Completed';
    let new_splot_data = {
        id: splot_id,
        entry: "Blank Splot",
        splot_dot: 1
    }
    updateBoard(new_splot_data)
    socket.emit('board_admin', new_splot_data, (response) => {
      console.log(response);
    });
    socket.emit('log_action', splot_data, (response) => {
      console.log(response);
    });
  }
  
  function splotDotDecrease(splot_id){
    let spotData = getSplotData(splot_id);
    let new_splot_dot = spotData.splot_dot - 1;
    let splot_data = {
        id: splot_id,
        entry: spotData.entry,
        splot_dot: new_splot_dot,
        alt_entry: spotData.alt_entry,
        alt_splot_dot: spotData.alt_splot_dot,
    }
    console.log(splot_data);
    updateBoard(splot_data)
    socket.emit('board_admin', splot_data, (response) => {
      console.log(response);
    });
  }
  function splotDotIncrease(splot_id){
    let spotData = getSplotData(splot_id);
    let new_splot_dot = spotData.splot_dot + 1;
    let splot_data = {
        id: splot_id,
        entry: spotData.entry,
        splot_dot: new_splot_dot,
        alt_entry: spotData.alt_entry,
        alt_splot_dot: spotData.alt_splot_dot,
    }
    console.log(splot_data);
    updateBoard(splot_data)
    socket.emit('board_admin', splot_data, (response) => {
      console.log(response);
    });
  }

  function swapSplot(splot_id){
    let splotData = getSplotData(splot_id);
    
    let splot_data = {
        id: splot_id,
        entry: splotData.entry,
        splot_dot: splotData.splot_dot,
        alt_entry: splotData.alt_entry,
        alt_splot_dot: splotData.alt_splot_dot,
        // No need to send isAlt here, as the server will manage the state
    }
    console.log('alt_splot_swap', splot_data);
    socket.emit('alt_splot_swap', splot_data, (response) => {
      console.log(response);
    });
  }

  function popEditModal(splot_id) {
    let splot_data = getSplotData(splot_id);
    console.log('popeditmodal',splot_data);
    $('#editSplotId').val(splot_data.id);
    $('#editSplotEntry').val(splot_data.entry);
    $('#editSplotDot').val(splot_data.splot_dot);
    $('#editAltSplotEntry').val(splot_data.alt_entry);
    $('#editAltSplotDot').val(splot_data.alt_splot_dot);
    $('#editSplot').modal('show');
  }
  function editSplot() {
    let splot_id = $('#editSplotId').val();
    let splot_entry = $('#editSplotEntry').val();
    let splot_dot = $('#editSplotDot').val();
    let alt_splot_entry = $('#editAltSplotEntry').val();
    let alt_splot_dot = $('#editAltSplotDot').val();
    let splot_data = {
        id: splot_id,
        entry: splot_entry,
        splot_dot: splot_dot,
        alt_entry: alt_splot_entry,
        alt_splot_dot: alt_splot_dot
    }
    updateBoard(splot_data)
    socket.emit('board_admin', splot_data, (response) => {
      console.log(response);
    });
    $('#editSplot').modal('hide');
  }
  function addSplot() {
    let splot_count = document.getElementById("board").childElementCount;
    let splot_id = splot_count + 1;
    let splot_entry = $('#addSplotEntry').val();
    let splot_dot = $('#addSplotDot').val();
    let alt_splot_entry = $('#addAltSplotEntry').val();
    let alt_splot_dot = $('#addAltSplotDot').val();
    let splot_data = {
        id: splot_id,
        entry: splot_entry,
        splot_dot: splot_dot,
        alt_entry: alt_splot_entry,
        alt_splot_dot: alt_splot_dot
    }
    updateBoard(splot_data)
    socket.emit('board_admin', splot_data, (response) => {
      console.log(response);
    });
    $('#addSplot').modal('hide');
  }
  function startTimer() {
    let minutesAndSecOut = ($('#timer').val() || '0:00').trim();
    if (!minutesAndSecOut.includes(':')) {
      minutesAndSecOut = minutesAndSecOut + ':00';
    }
    let minutesAndSec = minutesAndSecOut.split(':').map(function(part) {
      return part.trim();
    });
    let minutes = parseInt(minutesAndSec[0], 10);
    let seconds = minutesAndSec.length > 1 ? parseInt(minutesAndSec[1], 10) : 0;
    if (Number.isNaN(minutes)) { minutes = 0; }
    if (Number.isNaN(seconds)) { seconds = 0; }
    minutes = Math.max(0, minutes);
    seconds = Math.max(0, seconds);
    let totalSecondsOut = minutes * 60 + seconds;
    let milsecondsOut = totalSecondsOut * 1000;

    const normalizedMinutes = Math.floor(totalSecondsOut / 60);
    const normalizedSeconds = totalSecondsOut % 60;
    const displayMinutes = String(normalizedMinutes).padStart(2, '0');
    const displaySeconds = String(normalizedSeconds).padStart(2, '0');

    CountDown.Prime(milsecondsOut);
    timerStatus = 'idle';

    let timer_data = {
        timer_value: milsecondsOut,
        timer_display: displayMinutes + ':' + displaySeconds,
        action: 'set'
    }
    console.log(timer_data);
    socket.emit('timer_admin', timer_data, (response) => {
      console.log(response);
    });
  }
  function clearBoard(){
      // javascript confirm
      if (!confirm('Are you sure you want to clear the board?')) {
        return;
      }
      $('#board').fadeOut();
      document.getElementById("board").innerHTML = "";
      $('#board').fadeIn();
      socket.emit('clear_board', true, (response) => {
        console.log(response);
      });
    }
    function get_random_splot(){
      socket.emit('get_random_splot', true, (response) => {
        console.log(response);
        // Set value of .splot_entry but uppercase the words
        let splot_entry_words = response.split(' ');
        let splot_entry_words_upper = [];
        for (let i = 0; i < splot_entry_words.length; i++) {
          splot_entry_words_upper.push(splot_entry_words[i].charAt(0).toUpperCase() + splot_entry_words[i].slice(1));
        }
        let splot_entry_upper = splot_entry_words_upper.join(' ');
        console.log('splot_entry_upper',splot_entry_upper);
        $('.splotEntry').val(splot_entry_upper);    

      });
    }
    function generate_splot(random_splot) {
      $('#addSplotEntry').val(random_splot);
    }
    function playFart(){
      // Get a random number between 0 and 9
      const randomNumber = Math.floor(Math.random() * 10);
      // Get the audio element with the ID of "fart_0" through "fart_9"
      const fart = document.getElementById(`fart_${randomNumber}`);
      fart.play();
    }
    function maybeFire() {
      // Generate a random number between 0 and 1
      const randomNumber = Math.random();

      // If the random number is less than 0.2, execute the function
      if (randomNumber < 0.02) {
        playFart();
      }
    }
    // Toggle the chat window
    function toggleChat() {
      isChatOpen = !isChatOpen;
      document.querySelector("#messages-list").style.display = isChatOpen ? "block" : "none";
      document.querySelector("#chat-toggle").className = isChatOpen ? "fas fa-chevron-down" : "fas fa-chevron-up";
    }

    // Update the page with the new messages
    function updatePage(messages) {
      // Clear any existing messages
      document.querySelector("#messages-list").innerHTML = "";

      // Loop through each message and add a bootstrap toast for the message
      messages.forEach(({ username, message }) => {
		const toast = document.createElement("div");
		toast.className = "toast";
		toast.setAttribute("role", "alert");
		toast.setAttribute("aria-live", "assertive");
		toast.setAttribute("aria-atomic", "true");
		toast.setAttribute("data-delay", "45000");
		toast.innerHTML = `
		  <div class="toast-header">
			<strong class="mr-auto">${username}</strong>
			<small class="text-muted">just now</small>
			<button type="button" class="ml-2 mb-1 close" data-dismiss="toast" aria-label="Close">
			  <span aria-hidden="true">&times;</span>
			</button>
		  </div>
		  <div class="toast-body">
			${message}
		  </div>
		`;

		document.querySelector("#messages-list").appendChild(toast);
		new bootstrap.Toast(toast).show();
      });
    }
/**
 * @fileoverview GoDice class for connecting to and controlling a GoDice Bluetooth die.
 * @author GoDice
 * @license MIT
 * @version 1.0.0
 * 
 * Dice stuff starts here.
 * 
 */

// Open the Bluetooth connection dialog for choosing a GoDice to connect
function openConnectionDialog() {
	const newDice = new GoDice();
	newDice.requestDevice();
}

/**
 * Get a new dice element or it's instance if it already exists
 * @param {string} diceId - the die unique identifier	 
 */
function getDiceHtmlEl(diceId) {
    let diceHtmlEl = document.getElementById(diceId);
    if (!diceHtmlEl) {
        diceHtmlEl = document.createElement("div");
        diceHtmlEl.id = diceId;
        diceHtmlEl.className = "dice-wrapper";
    }
    return diceHtmlEl;
}


GoDice.prototype.onDiceConnected = function (diceId, diceInstance) {
  console.log("Dice connected: ", diceId);

  connectedDice[diceId] = diceInstance;

  const diceHtmlEl = getDiceHtmlEl(diceId);
  while (diceHtmlEl.firstChild) {
      diceHtmlEl.removeChild(diceHtmlEl.lastChild);
  }

  const diceHost = document.getElementById("dice-host");

  const diceName = document.createElement('div');
  diceName.className = 'dice-name';
  diceName.textContent = `Dice ID: ${diceId}`;
  diceHtmlEl.append(diceName);

  const diceTitleInput = document.createElement('input');
  diceTitleInput.type = 'text';
  diceTitleInput.placeholder = 'Enter Dice Title';
  diceTitleInput.id = `dice-title-${diceId}`;
  diceHtmlEl.append(diceTitleInput);

  const batteryLevelButton = document.createElement('button');
  batteryLevelButton.className = 'btn btn-outline-primary';
  batteryLevelButton.onclick = diceInstance.getBatteryLevel.bind(diceInstance);
  batteryLevelButton.textContent = 'Get Battery Level';
  diceHtmlEl.append(batteryLevelButton);

  const batteryIndicator = document.createElement('div');
  batteryIndicator.id = `${diceId}-battery-indicator`;
  diceHtmlEl.append(batteryIndicator);

  const colorProfile = [[0, 0, 255], [0, 0, 255]];

  const ledOnButton = document.createElement('button');
  ledOnButton.className = 'btn btn-outline-primary';
  ledOnButton.onclick = diceInstance.setLed.bind(diceInstance, colorProfile[0], colorProfile[1]);
  ledOnButton.textContent = 'Switch On Led';
  diceHtmlEl.append(ledOnButton);

  const ledOffButton = document.createElement('button');
  ledOffButton.className = 'btn btn-outline-primary';
  ledOffButton.onclick = diceInstance.setLed.bind(diceInstance, [0], [0]);
  ledOffButton.textContent = 'Switch Off Led';
  diceHtmlEl.append(ledOffButton);

  const ledPulseButton = document.createElement('button');
  ledPulseButton.className = 'btn btn-outline-primary';
  ledPulseButton.onclick = diceInstance.pulseLed.bind(diceInstance, 5, 30, 20, [0, 0, 255]);
  ledPulseButton.textContent = 'Pulse';
  diceHtmlEl.append(ledPulseButton);

  const getDiceColorButton = document.createElement('button');
  getDiceColorButton.className = 'btn btn-outline-primary';
  getDiceColorButton.onclick = diceInstance.getDiceColor.bind(diceInstance);
  getDiceColorButton.textContent = 'Get Dice Color';
  diceHtmlEl.append(getDiceColorButton);

  const d6Button = document.createElement('button');
  d6Button.className = 'diebtn btn-outline-primary';
  d6Button.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D6);
  d6Button.textContent = 'D6';
  diceHtmlEl.append(d6Button);

  const d20Button = document.createElement('button');
  d20Button.className = 'diebtn btn-outline-primary';
  d20Button.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D20);
  d20Button.textContent = 'D20';
  diceHtmlEl.append(d20Button);

  const d10Button = document.createElement('button');
  d10Button.className = 'diebtn btn-outline-primary';
  d10Button.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D10);
  d10Button.textContent = 'D10';
  diceHtmlEl.append(d10Button);

  const d10XButton = document.createElement('button');
  d10XButton.className = 'diebtn btn-outline-primary';
  d10XButton.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D10X);
  d10XButton.textContent = 'D10X';
  diceHtmlEl.append(d10XButton);

  const d4Button = document.createElement('button');
  d4Button.className = 'diebtn btn-outline-primary';
  d4Button.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D4);
  d4Button.textContent = 'D4';
  diceHtmlEl.append(d4Button);

  const d8Button = document.createElement('button');
  d8Button.className = 'diebtn btn-outline-primary';
  d8Button.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D8);
  d8Button.textContent = 'D8';
  diceHtmlEl.append(d8Button);

  const d12Button = document.createElement('button');
  d12Button.className = 'diebtn btn-outline-primary';
  d12Button.onclick = diceInstance.setDieType.bind(diceInstance, GoDice.diceTypes.D12);
  d12Button.textContent = 'D12';
  diceHtmlEl.append(d12Button);

  const colorIndicator = document.createElement('div');
  colorIndicator.id = `${diceId}-color-indicator`;
  diceHtmlEl.append(colorIndicator);

  const dieStatus = document.createElement('div');
  dieStatus.id = `${diceId}-die-status`;
  diceHtmlEl.append(dieStatus);

  diceHost.appendChild(diceHtmlEl);

  reinitializeDiceEventListeners(diceId, diceInstance);
};


function reinitializeDiceEventListeners(diceId, diceInstance) {
  diceInstance.onStable = function (diceId, value, xyzArray, diceInstance) {
      console.log("Stable event: ", diceId, value);
      testForSpecialRoll(diceInstance, value);
      const diceIndicatorEl = document.getElementById(diceId + "-die-status");
      diceIndicatorEl.textContent = "Stable: " + value;
  };

  diceInstance.onTiltStable = function (diceId, value, xyzArray, diceInstance) {
      console.log("TiltStable: ", diceId, value);
      testForSpecialRoll(diceInstance, value);
      const diceIndicatorEl = document.getElementById(diceId + "-die-status");
      diceIndicatorEl.textContent = "Tilt Stable: " + value;
  };

  diceInstance.onFakeStable = function (diceId, value, xyzArray, diceInstance) {
      console.log("FakeStable: ", diceId, value);
      testForSpecialRoll(diceInstance, value);
      const diceIndicatorEl = document.getElementById(diceId + "-die-status");
      diceIndicatorEl.textContent = "Fake Stable: " + value;
  };

  diceInstance.onMoveStable = function (diceId, value, xyzArray, diceInstance) {
      console.log("MoveStable: ", diceId, value);
      testForSpecialRoll(diceInstance, value);
      const diceIndicatorEl = document.getElementById(diceId + "-die-status");
      diceIndicatorEl.textContent = "Move Stable: " + value;
  };

  diceInstance.onBatteryLevel = function (diceId, batteryLevel, diceInstance) {
      console.log("BatteryLevel: ", diceId, batteryLevel);
      diceInstance.pulseLed(5, 30, 20, [0, 255, 0]);
      const batteryLevelEl = document.getElementById(diceId + "-battery-indicator");
      batteryLevelEl.textContent = batteryLevel;
  };

  diceInstance.onDiceColor = function (diceId, color) {
      const colorMapping = {
          BLACK: [255, 255, 255],
          RED: [255, 0, 0],
          GREEN: [0, 255, 0],
          BLUE: [0, 0, 255],
          YELLOW: [255, 255, 0],
          ORANGE: [255, 165, 0],
      };
      console.log("DiceColor: ", diceId, color);
      const colorName = Object.entries(this.diceColour).find(([name, number]) => number === color)[0];
      const colorRGB = colorMapping[colorName];
      const diceColorEl = document.getElementById(diceId + "-color-indicator");
      diceColorEl.textContent = "Color: " + colorName;
      diceInstance.pulseLed(5, 30, 20, colorRGB);
  };
}

GoDice.prototype.onRollStart = (diceId) => {
	console.log("Roll Start: ", diceId);

	// get rolling indicator
	const diceIndicatorEl = document.getElementById(diceId + "-die-status");

	// show rolling 
	diceIndicatorEl.textContent = "Rollling....";
};

GoDice.prototype.onDiceDisconnected = function (diceId, diceInstance) {
  console.log("Dice Disconnected: ", diceId);
  const diceIndicatorEl = document.getElementById(diceId + "-die-status");
  const globalMessages = document.getElementById('dice-message-container');
  const existingAlert = document.getElementById(`dice-alert-${diceId}`);
  if (existingAlert) {
      return;
  }
  const alertEl = document.createElement('div');
  alertEl.className = 'alert alert-danger fade show';
  var diceName = document.getElementById("dice-title-" + diceId).value;

  alertEl.innerHTML = `${diceName} ${this.getDiceType(diceInstance)} Disconnect`;
  alertEl.onclick = diceInstance.attemptReconnect.bind(diceId, diceInstance);
  alertEl.id = `dice-alert-${diceId}`;
  globalMessages.prepend(alertEl);
  diceIndicatorEl.textContent = "disconnected";
  diceInstance.attemptReconnect(diceId, diceInstance);
};

  
GoDice.prototype.onStable = function (diceId, value, xyzArray, diceInstance) {
  console.log("Stable event: ", diceId, value);
  testForSpecialRoll(diceInstance, value);
  const diceIndicatorEl = document.getElementById(diceId + "-die-status");
  diceIndicatorEl.textContent = "Stable: " + value;
};

GoDice.prototype.onTiltStable = function (diceId, value, xyzArray, diceInstance) {
  console.log("TiltStable: ", diceId, value);
  testForSpecialRoll(diceInstance, value);
  const diceIndicatorEl = document.getElementById(diceId + "-die-status");
  diceIndicatorEl.textContent = "Tilt Stable: " + value;
};

GoDice.prototype.onFakeStable = function (diceId, value, xyzArray, diceInstance) {
  console.log("FakeStable: ", diceId, value);
  testForSpecialRoll(diceInstance, value);
  const diceIndicatorEl = document.getElementById(diceId + "-die-status");
  diceIndicatorEl.textContent = "Fake Stable: " + value;
};

GoDice.prototype.onMoveStable = function (diceId, value, xyzArray, diceInstance) {
  console.log("MoveStable: ", diceId, value);
  testForSpecialRoll(diceInstance, value);
  const diceIndicatorEl = document.getElementById(diceId + "-die-status");
  diceIndicatorEl.textContent = "Move Stable: " + value;
};


GoDice.prototype.onBatteryLevel = (diceId, batteryLevel, diceInstance) => {
	console.log("BetteryLevel: ", diceId, batteryLevel);
	diceInstance.pulseLed(5, 30, 20, [0, 255, 0]);
	// get dice battery indicator element
	const batteryLevelEl = document.getElementById(diceId + "-battery-indicator");

	// put battery level value into battery indicator html element
	batteryLevelEl.textContent = batteryLevel;
};

GoDice.prototype.onDiceColor = function(diceId, color) {
	colorMapping = {
		BLACK: [255, 255, 255],
		RED: [255, 0, 0],
		GREEN: [0, 255, 0],
		BLUE: [0, 0, 255],
		YELLOW: [255, 255, 0],
		ORANGE: [255, 165, 0],
	}

	console.log("DiceColor: ", diceId, color);
	const colorName = Object.entries(this.diceColour).find(([name, number]) => number === color)[0];
	console.log(colorName);
	const colorRGB = colorMapping[colorName];
	
	// get dice color indicator element
	const diceColorEl = document.getElementById(diceId + "-color-indicator");

	// put dice color value into battery indicator html element
	diceColorEl.textContent = "Color: " + colorName;

	// Pulse Led
	this.pulseLed(5, 30, 20, colorRGB);
};


const textArea = document.getElementById("log");

function testForSpecialRoll(diceInstance, value) {
  const dieTypeValue = diceInstance.dieType;
  const diceTitle = document.getElementById("dice-title-" + diceInstance.bluetoothDevice.id).value;
  console.log('diceTitle', diceTitle);
  console.log('value', value);
  console.log('dieTypeValue', dieTypeValue);

  value = Number(value);

  if (dieTypeValue === 0) {
    switch (value) {
      case 1:
        if (diceTitle === 'RPG') {
          playSoundAndPulseLed(diceInstance, 'lose', [255, 0, 0]);
        } else {
          playSoundAndPulseLed(diceInstance, 'win', [0, 0, 255]);
        }
        break;
      case 3:
        if (diceTitle !== 'RPG') {
          playSoundAndPulseLed(diceInstance, 'lose', [255, 0, 0]);
        }
        break;
      case 6:
        playSoundAndPulseLed(diceInstance, 'win', [0, 0, 255]);
        break;
    }
  }

  // Ensure logRoll is called
  logRoll(diceInstance.bluetoothDevice.id, value, diceInstance);
}


function playSoundAndPulseLed(diceInstance, soundType, color) {
  console.log(soundType);
  diceInstance.pulseLed(5, 30, 20, color);
  const sound = document.getElementById(`${soundType}_sound`);
  sound.volume = soundType === 'win' ? 0.1 : 0.2;
  sound.play();
  console.log(`Pulsing LED with color: ${color}`);
}


function logRoll(diceId, rollValue, diceInstance) {
  console.log("logRoll called with", diceId, rollValue);

  var diceName = document.getElementById("dice-title-" + diceId).value;
  console.log("Dice Name:", diceName);
  
  const uuid = generateUUID();
  var timestamp = new Date();
  var timestampString = timestamp.toLocaleString();
  var log = document.getElementById("roll-log");

  if (log) {
    log.insertAdjacentHTML('afterbegin', `<pre>[${timestampString}]: ${diceName} ${getDiceType(diceInstance)} rolled a ${rollValue}</pre>`);
  } else {
    console.warn("Element with ID 'roll-log' not found.");
  }

  const globalRollMessage = document.getElementById('dice-message-container');
  const alertRoll = document.createElement('div');
  alertRoll.className = 'alert alert-info fade show';
  alertRoll.innerHTML = `${diceName} ${getDiceType(diceInstance)} rolled a ${rollValue}`;
  alertRoll.id = `dice-alert-${diceId}-${uuid}`;

  if (globalRollMessage) {
    globalRollMessage.prepend(alertRoll);
  } else {
    console.warn("Element with ID 'dice-message-container' not found.");
  }

  setTimeout(() => {
    alertRoll.remove();
  }, 5000);

  const roll_data = {
    'dice_id': diceId,
    'roll_value': rollValue,
    'dice_name': diceName,
    'dice_type': getDiceType(diceInstance),
    'timestamp': timestampString
  };

  socket.emit('dice_roll', roll_data, (response) => {
    console.log(response);
  });
}


function getDiceType(diceInstance) {
  const dieTypeValue = diceInstance.dieType;
  const dieTypeString = Object.keys(GoDice.diceTypes).find(key => GoDice.diceTypes[key] === dieTypeValue);
  return dieTypeString;
}

// Ensure getDiceType is defined within the GoDice prototype
GoDice.prototype.getDiceType = function (diceInstance) {
  const dieTypeValue = diceInstance.dieType;
  const dieTypeString = Object.keys(GoDice.diceTypes).find(key => GoDice.diceTypes[key] === dieTypeValue);
  return dieTypeString;
}


// Add the generateUUID function
function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
	  var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
	  return v.toString(16);
	});
}
