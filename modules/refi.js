process.env.TZ = 'UTC';
require('dotenv').config();

const fs = require('fs');
const Banchojs = require("bancho.js");
const matches = [];
const client = new Banchojs.BanchoClient({
  username: process.env.IRC_USERNAME,
  password: process.env.IRC_PASSWORD,
  apiKey: process.env.OSU_API_KEY,
  limiterTimespan: 8000
});
const openLobbies = [];
client.connect();

const AWAITING_PLAYERS = 0, WARMUP = -1, ROLLING = 1, FIRST_BAN = 2, SECOND_BAN = 3, PICKING_MAP = 4, PLAYING = 5;

module.exports = {
  destroy: async function(){
    for(let i = 0; i < openLobbies.length; i ++) await openLobbies[i].closeLobby();
    client.disconnect();
  },
  matchOptions: function(P1, P2, tourneyAcronym, referees, threshold, enforceMods, gameMode, teamMode, scoringMode, warmupCount){
    this.P1 = P1;
    this.P2 = P2;
    this.acronym = tourneyAcronym;
    this.referees = referees;
    this.threshold = threshold;
    this.enforceMods = enforceMods;
    this.gameMode = gameMode;
    this.teamMode = teamMode;
    this.scoringMode = scoringMode;
    this.warmups = warmupCount;
  },
  VSmatch: function(mappool, options, callback){
    if(!callback) callback = () => {};
    return new Promise(async function(response, reject){
      //let MAPPOOL = JSON.parse(fs.readFileSync("./mappool.json"))["RX1"];
      const MAPPOOL = Object.assign({}, mappool);
      callback(`Mappool (${Object.keys(MAPPOOL).length}): ${Object.keys(MAPPOOL)}`);
      let TIEBREAKER = 0;
      if(MAPPOOL.TB) TIEBREAKER = MAPPOOL.TB.id;
      if(!TIEBREAKER) callback("Warning: There is no tiebreaker!!");
      delete MAPPOOL.TB;

      const PLAYER1 = options.P1;
      const PLAYER2 = options.P2;
      const TOURNEY = options.acronym;
      const REFS = options.referees;
      const POINT_THRESHOLD = options.threshold;
      const ENFORCE_MODS = options.enforceMods;
      const SCORING_MODE = options.scoringMode; // 0 - SV1, 1 - ACC, 2 - COMBO, 3 - SV2
      var WARMUPS = options.warmups; // 1 per player
      let lastMods = 0;

      const players = {}, playerStats = {};
      players[PLAYER1] = players[PLAYER2] = 1;

      if(POINT_THRESHOLD*2 > Object.keys(MAPPOOL).length) throw "Insufficient maps. Point threshold too big!";
      callback(`${TOURNEY}: (${PLAYER1}) vs. (${PLAYER2}) \n// First to ${POINT_THRESHOLD}, Best of ${POINT_THRESHOLD*2-1}`);

      	const channel = await client.createLobby(`${TOURNEY}: (${PLAYER1}) vs. (${PLAYER2})`)
      	const lobby = channel.lobby;
        openLobbies.push(lobby);
        let playerTurns, turn = 1;
      	if(lobby == null) throw new Error("missing api key");
        lobby.state = AWAITING_PLAYERS;

        const terminate = async () => {
          const payload = {
            link: `https://osu.ppy.sh/mp/${lobby.id}`,
            options: Object.assign({}, options),
            mappool: Object.assign({}, mappool),
            outcome: `${playerStats[PLAYER1].p} : ${playerStats[PLAYER1].s} | ${playerStats[PLAYER2].s} : ${playerStats[PLAYER2].p} // First to ${POINT_THRESHOLD}, Best of ${POINT_THRESHOLD*2-1}`
          };
        	callback("Closing lobby and disconnecting...");
        	await lobby.closeLobby();
          openLobbies.splice(openLobbies.indexOf(lobby), 1);
          response(payload);
        }

      	callback("Multiplayer link: https://osu.ppy.sh/mp/"+lobby.id);

        channel.on("message", async CM => {
          callback(`${CM.user.ircUsername}: ${CM.message}`);
          if(CM.message == "nf!exit" && REFS.includes(CM.user.ircUsername)){
            callback("Removing client presence from match.");
            reject(`Bot removed from match via \`nf!exit\` by \`${CM.user.ircUsername}\``)
            return;
          }
          switch(lobby.state){
            case ROLLING:
              const messages = CM.message.split(' rolls ');
              if(CM.user.ircUsername == "BanchoBot" && messages.length > 1 && !playerStats[messages[0]]){
                playerStats[messages[0]] = { // virtual private server lul
                  v: parseInt(messages[1].split(' ')[0]) % 101, // value
                  p: messages[0], // person
                  s: 0 // score (for scorekeeping)
                };
                callback(messages[0], "rolled", messages[1]);
                if(Object.keys(playerStats).length >= 2){
                  playerTurns = Object.values(playerStats).sort((a, b) => a.v - b.v); // least
                  channel.sendMessage(playerTurns[turn].p + "'s turn to ban. Choices: " + Object.keys(MAPPOOL));
                  lobby.state = FIRST_BAN;
                }
              }
              break;
            case FIRST_BAN:
            case SECOND_BAN:
              if(playerTurns[turn].p == CM.user.ircUsername.replace(/_/g, ' ')){
                if(!MAPPOOL[CM.message]) return; //channel.sendMessage("Invalid ban pick. Choices: " + Object.keys(MAPPOOL));
                let messagePrepend = CM.message + " has been removed. // ";
                delete MAPPOOL[CM.message];
                if(lobby.state == FIRST_BAN){
                  turn = (turn + 1) % 2; // 1;
                  lobby.state = SECOND_BAN;
                  channel.sendMessage(messagePrepend + playerTurns[turn].p + "'s turn to ban. Choices: " + Object.keys(MAPPOOL));
                }else{
                  turn = (turn + 1) % 2; // delete
                  lobby.state = PICKING_MAP;
                  channel.sendMessage(messagePrepend + playerTurns[turn].p + "'s turn to pick. Choices: " + Object.keys(MAPPOOL));
                }
              }
              break;
            case PICKING_MAP:
              if(playerTurns[turn].p == CM.user.ircUsername.replace(/_/g, ' ') && MAPPOOL[CM.message]){
                const M = MAPPOOL[CM.message];
                const MODS = Banchojs.BanchoMods.parseBitFlags(M.mods);
                M.name = CM.message;
                lobby.state = PLAYING;
                if(lastMods&64 != M.mods&64) lobby.setMods(MODS, !ENFORCE_MODS);
                lastMods = M.mods;

                const messageAppend = "\nMatch will start immediately if everyone is ready. If you are missing a map, hurry up and download it.\n!!! Reminder: Failure to use the specified mods (above) will result in a disqualified score for the map.";
                callback(`Now playing: ${M.name}`);
                await lobby.setMap(M.id);
                await channel.sendMessage(`Next map: ${M.name} // Required mods: ${MODS.map(e => e.longMod).join(', ')} [${MODS.map(e => e.shortMod).join('').toUpperCase()}]` + messageAppend);
                //await channel.sendMessage("Match will start immediately if everyone is ready. If you are missing a map, hurry up and download it.\n!!! Reminder: Failure to use the specified mods (above) will result in a disqualified score for the map.");

                delete MAPPOOL[CM.message];

                //await lobby.setMods(CM.message.substring(0, 2) == "FM" ? "" : CM.message.substring(0, 2), true /*CM.message.substring(0, 2) == "FM"*/);
                await lobby.startMatch(180);
              }
              break;
          }
        });

        lobby.on("allPlayersReady", () => {
          if(lobby.state == PLAYING) lobby.startMatch();
          if(lobby.state == WARMUP) lobby.startMatch(10);
        });
        lobby.on("playerJoined", async LP => {
          if(players[LP.player.user.username]){
            players[LP.player.user.username] = 2;
            if(lobby.state == WARMUP) lobby.setHost(WARMUPS%1 ? PLAYER1 : PLAYER2);
            if(!Object.values(players).includes(1)){
              if(WARMUPS){
                lobby.state = WARMUP;
                lobby.setHost(WARMUPS%1 ? PLAYER1 : PLAYER2);
                channel.sendMessage("There will be " + WARMUPS + " warmups. If you do not want a warmup, please put a very short map.");
              }else{
                await lobby.clearHost();
                await lobby.setMods("", true);
                lobby.state = ROLLING;
                channel.sendMessage("Please roll now, your first roll will be counted.");
              }
            }
          }else{
            if(REFS.includes(LP.player.user.username)){
              lobby.addRef(REFS);
            }else{
              lobby.kickPlayer(LP.player.user.id);
            }
          }
        });
        lobby.on("playerLeft", LP => {
          if(players[LP.user.username]){
            players[LP.user.username] = 1;
            lobby.invitePlayer(LP.user.username);
          }
        })
      	lobby.on("matchStart", () => {
      		callback("Match on "+lobby.beatmap.id+" started...");
      	});
      	lobby.on("matchFinished", async (scores) => {
          if(lobby.state == WARMUP){
            WARMUPS --;
            if(WARMUPS > 0){
              lobby.setHost(WARMUPS%2 ? PLAYER1 : PLAYER2);
              channel.sendMessage("There are now " + WARMUPS + " warmup(s) left.");
            }else{
              lobby.state = ROLLING;
              channel.sendMessage("Please roll now, your first roll will be counted.");
            }
            return;
          }

      		callback("\nMatch ended! =========================");
      		for(let scoreId in scores){
      			callback("#"+(Number(scoreId)+1)+": "+scores[scoreId].player.user.username+" "+scores[scoreId].score+" "+scores[scoreId].pass);
            if(Number(scoreId) == 0){
              playerStats[scores[scoreId].player.user.username].s ++;
            }
          }
          await channel.sendMessage(`${playerStats[PLAYER1].p} : ${playerStats[PLAYER1].s} | ${playerStats[PLAYER2].s} : ${playerStats[PLAYER2].p} // First to ${POINT_THRESHOLD}, Best of ${POINT_THRESHOLD*2-1}`);
          const messagePrepend = `${playerStats[PLAYER1].p} : ${playerStats[PLAYER1].s} | ${playerStats[PLAYER2].s} : ${playerStats[PLAYER2].p} // First to ${POINT_THRESHOLD}, Best of ${POINT_THRESHOLD*2-1} // `;
          if(playerStats[PLAYER1].s >= POINT_THRESHOLD){
            await channel.sendMessage(messagePrepend+`${playerStats[PLAYER1].p} wins! // Lobby will close in 180 seconds.`);
            callback(JSON.stringify(playerStats));
            setTimeout(() => channel.sendMessage("Notice: Lobby will close in 30 seconds."), 150000);
            setTimeout(terminate, 180000);
          }else if(playerStats[PLAYER2].s >= POINT_THRESHOLD){
            await channel.sendMessage(messagePrepend+`${playerStats[PLAYER2].p} wins! // Lobby will close in 180 seconds.`);
            callback(JSON.stringify(playerStats));
            setTimeout(() => channel.sendMessage("Notice: Lobby will close in 30 seconds."), 150000);
            setTimeout(terminate, 180000);
          }else if(TIEBREAKER && playerStats[PLAYER1].s + playerStats[PLAYER2].s >= (POINT_THRESHOLD*2-2)){
            channel.sendMessage(messagePrepend+"The tiebreaker has been picked. Match will start immediately if everyone is ready. If you are missing a map, hurry up and download it. XD");
            lobby.state = PLAYING;
            await lobby.setMap(TIEBREAKER);
            await lobby.setMods("", true);
            await lobby.startMatch(180);
          }else{
            lobby.state = PICKING_MAP;
            turn = (!turn)+0;
            channel.sendMessage(messagePrepend+playerTurns[turn].p + "'s turn to pick. Choices: " + Object.keys(MAPPOOL));
          }
      	});

        await Promise.all([lobby.setMap(TIEBREAKER || 22538), lobby.setSize(4), lobby.setPassword(TOURNEY), channel.sendMessage(`!mp set 0 ${SCORING_MODE} ${Math.random().toString(36).slice(2)}`)]);
        if(!ENFORCE_MODS) lobby.setMods("", true);
        await lobby.invitePlayer(PLAYER1);
        lobby.invitePlayer(PLAYER2);
        lobby.addRef(REFS);
      }).catch(console.error);
  }
};
