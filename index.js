process.env.TZ = 'UTC';
require('dotenv').config()

const Discord = require('discord.js');
const challonge = require('challonge');
const nodeosu = require('node-osu');
const fs = require('fs');
const refi = require('./modules/refi');
const config = JSON.parse(fs.readFileSync('./config.json'));
const data = {
  players: JSON.parse(fs.readFileSync(config.PATH.player_data)),
  starboard: JSON.parse(fs.readFileSync(config.PATH.starboard_data)),
  users: JSON.parse(fs.readFileSync(config.PATH.user_data)),
  matches: JSON.parse(fs.readFileSync(config.PATH.match_data)),
  mappools: JSON.parse(fs.readFileSync(config.PATH.mappool_data))
};
const challongeClient = challonge.createClient({
  apiKey: process.env.CHALLONGE_TOKEN
});
const osu = new nodeosu.Api(process.env.OSU_API_KEY, {
    // baseUrl: sets the base api url (default: https://osu.ppy.sh/api)
    notFoundAsError: true, // Reject on not found instead of returning nothing. (default: true)
    completeScores: false // When fetching scores also return the beatmap (default: false)
})
const client = new Discord.Client();

let playerlist = Object.keys(data.players).map(e => data.players[e]);
let mapcount = Object.keys(config.mapcodes).length;
let mapcodelist = Object.keys(config.mapcodes);

let channels = {};
let key, lastcmd = {}, activeMatches = {};

process.on("SIGINT", async () => {
  console.log("\nExiting...");
  await client.destroy(); console.log("Disconnected from Discord");
  await refi.destroy(); console.log("Disconnected from osu!Bancho");
  process.exit();
});

console.log("NF!TOURNEY BOT running %s", config.version);
client.login(process.env.DISCORD_TOKEN);
client.on("ready", () => {
  console.log('Logged in as %s - %s\n', client.user.username, client.user.id);
  client.user.setPresence({ game: { name: config.prefix+'help', type: 0} });
  channels.starboard = client.channels.get(config.starboard.channel);

  //setInterval(cmds.challongesync.exec, 4*60*60*1000); // 4 hours

  Object.keys(config.challonge.rounds).forEach(e => {
    config.challonge.defaultTime[config.challonge.rounds[e]] = config.challonge.defaultTime[e];
  });

  Object.keys(data.starboard.messages).forEach(e => {
    client.channels.get(data.starboard.messages[e].channel).fetchMessage(e).catch(error => {
      console.log("Error with %s. >> %s", e, error)
    });
  });

  for(let i in cmds){
    if(!cmds[i].alias) continue;
    for(let a of cmds[i].alias){
      cmds[a] = cmds[i];
      console.log(`Linked ${a} with ${i}`);
    }
  }
});
client.on("message", (message) => {
  if(message.author.id == client.user.id || !message.content.startsWith(config.prefix)) return;
  //if(!data.users[message.author.id]) ;
  let split = message.content.replace(config.prefix, '').split(' ');
  let cmd = split[0].toLowerCase();
  if(cmds[cmd]){
    let cd = (5000 - (Date.now() - lastcmd[message.author.id]));
    if(cd > 0) return message.channel.send(cd + "ms of cooldown remain");
    try{
      if(cmds[cmd].permission){
        if(cmds[cmd].permission & 1 && !message.member.hasPermission('MANAGE_ROLES')) throw "Missing `MANAGE_ROLES` permission."
        if(cmds[cmd].permission & 2 && !config.ADMIN[message.author.id]) throw "Missing `BOT_ADMIN` permission."
      }
      response = cmds[cmd].exec(message, ...split.slice(1));
    }catch(err){
      message.channel.send({embed: {
        title: "Error!",
        color: 16729122,
        description: err.toString()
      }});
    }
    lastcmd[message.author.id] = Date.now();
  }
});
client.on("messageReactionAdd", (messageReaction, user) => {
  if(messageReaction.message.guild.id != '530645640280277003' || messageReaction.message.channel.id == config.starboard.channel) return;
  if(user.id == client.user.id){
    messageReaction.count --;
    messageReaction.remove();
  }
  if(messageReaction.emoji.name == '\u2B50' && messageReaction.count >= config.starboard.THRESHOLD) addToStarboard(messageReaction.message, messageReaction.count);
  //                              star emoji
});
client.on("messageReactionRemove", (messageReaction, user) => {
  if(messageReaction.message.guild.id != '530645640280277003') return;
  if(messageReaction.emoji.name == '\u2B50' && data.starboard.messages[messageReaction.message.id]) addToStarboard(messageReaction.message, messageReaction.count);
  //                              star emoji
});

function regenKey(){
  //http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
  key = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  console.log(key);
}
function addToStarboard(message, starCount){
  if(message.guild == null) return;
  let RichEmbed = {
    thumbnail: {
      url: message.author.avatarURL
    },
    color: message.member.colorRole ? message.member.colorRole.color : 9936031,
    //description: message.content,
    fields: [
      {
        name: "Author",
        value: message.author.toString(),
        inline: true
      },
      {
        name: "Channel",
        value: message.channel.toString(),
        inline: true
      },
      {
        name: "Message",
        value: message.content || "None"
      },
      {
        name: "Source",
        value: "[Jump](" + message.url + ")"
      }
    ],
    footer: {
      text: '\u2B50' // star emoji
    },
    timestamp: new Date(),
  };
  if([...message.attachments.values()].length) RichEmbed.image = { url: [...message.attachments.values()][0].url };
  if(starCount >= 5) RichEmbed.footer.text = '\uD83C\uDF20'; // falling star emoji
  if(starCount >= 10) RichEmbed.footer.text = '\uD83C\uDF1F'; // big star emoji
  RichEmbed.footer.text += " " + starCount;

  let origin = message;
  if(data.starboard.messages[origin.id]){
    if(starCount > 0){
      RichEmbed.timestamp = data.starboard.messages[origin.id].time ? new Date(data.starboard.messages[origin.id].time) : new Date();
      channels.starboard.fetchMessage(data.starboard.messages[origin.id].sid).then(message => message.edit({
        embed: RichEmbed
      }).then(message => {
        data.starboard.messages[origin.id].ct = starCount;
        data.starboard.messages[origin.id].sid = message.id;
        fs.writeFile(config.PATH.starboard_data, JSON.stringify(data.starboard), 'utf8', (err) => {
          if(err) throw err;
          console.log('Updated starboard (star changed)', new Date().toLocaleString());
        });
      }));
    }else{
      channels.starboard.fetchMessage(data.starboard.messages[origin.id].sid).then(message => message.delete());
      delete data.starboard.messages[origin.id];
      fs.writeFile(config.PATH.starboard_data, JSON.stringify(data.starboard), 'utf8', (err) => {
        if(err) throw err;
        console.log('Updated starboard (message removed)', new Date().toLocaleString());
      });
    }
  }else{
    channels.starboard.send({
      embed: RichEmbed
    }).then(message => {
      data.starboard.messages[origin.id] = {
        ct: starCount,
        aid: message.author.id,
        channel: origin.channel.id,
        sid: message.id,
        time: Date.now()
      }
      fs.writeFile(config.PATH.starboard_data, JSON.stringify(data.starboard), 'utf8', (err) => {
        if(err) throw err;
        console.log('Updated starboard (star changed)', new Date().toLocaleString());
      });
    });
  }
}

const cmds = {
  help: {
    params: "(cmd)",
    desc: "list commands",
    exec: (message, cmd) => {
      if(cmd){
        if(!cmds[cmd]) throw "that doesnt exist";
        message.channel.send({embed: {
          title: config.prefix + cmd + ' ' + cmds[cmd].params,
          description: "*Aliases: " + (cmds[cmd].alias || "none") + "*\n" + cmds[cmd].desc
        }});
      }else{
        message.channel.send({embed: { description: Object.keys(_cmds).filter(e => _cmds[e].permission ? message.member.hasPermission('MANAGE_ROLES') : true).join('\n') }});
      }
    }
  },
  ping: {
    params: "",
    desc: "check ping/latency time",
    exec: (message) => {
      let startTime = Date.now();
      message.channel.send(message.author.toString() + " ping!").then(message => message.edit('Time taken: ' + (Date.now() - startTime) + 'ms'))
    }
  },
  time: {
    alias: "utc",
    desc: "show the time in UTC",
    exec: (message) => message.channel.send(`> It is currently ${new Date()}`)
  },
  roll: {
    params: "(maximum)",
    desc: "random number generator",
    exec: (message, max) => message.channel.send(message.author.toString() + " rolled a " + Math.ceil(Math.random() * (parseInt(max) || 100)))
  },
  forcestarboardcheck: {
    alias: ["fsc"],
    params: "[messageID]",
    desc: "forces a starboard check on the message (must be done from same channel)",
    exec: (message, messageID) => {
      message.channel.fetchMessage(messageID).then(message => message.react('\u2B50'));
    }
  },
  vsmatch: {
    params: "[player1] [player2]",
    desc: "starts a new 1v1 NF!RX match (use ; for spaces in username)\nThere is a 1 active match limit for normal users.",
    exec: (message, p1, p2) => {
      if(activeMatches[message.author.id] && !message.member.hasPermission('MANAGE_ROLES')) throw "Limit of 1 active match per user!";
      p1 = p1.replace(/;/g, ' ');
      p2 = p2.replace(/;/g, ' ');
      if(p1 == p2) throw "Cannot make VSmatch against same person!";
      let history = "";
      activeMatches[message.author.id] = 1;
      message.channel.send(`Opening a new match between **__${p1}__** and **__${p2}__**`).then(logMessage => {
        const defaultOptions = new refi.matchOptions(p1, p2, "AAT1", ["CCleanerShot", "silvermoonwolf"], 3, true, 0, 0, 3, 2);
        let update = false;
        const updateInterval = setInterval(() => {
          if(update){
            logMessage.edit({embed: {
              title: `(${p1}) vs. (${p2})`,
              description: history.slice(-400)
            }});
            update = false;
          }
        }, 5000);
        refi.VSmatch(JSON.parse(fs.readFileSync("./mappool.json"))["AAT1"], defaultOptions, v => {
          history += v+'\n';
          update = true;
        }).then(matchInfo => {
          message.channel.send({embed: {
            title: `(${matchInfo.options.P1}) vs. (${matchInfo.options.P2})`,
            url: matchInfo.link,
            description: matchInfo.outcome
          }}).then(message => message.channel.send('<@208963262094639104>'));
          delete activeMatches[message.author.id];
          logMessage.edit({embed: {
            title: `(${p1}) vs. (${p2})`,
            description: history.slice(-2000)
          }});
          clearInterval(updateInterval);
        }).catch(error => {
          message.channel.send(error);
          clearInterval(updateInterval);
        });
      });
    }
  },
  schedulevsmatch: {
    alias: ['svsmatch'],
    params: "[date] [time] [player1] [player2]",
    desc: "starts a new 1v1 NF!RX match (use ; for spaces in username) at the specified time. if the bot goes down before the time occurs, the room will not open!\n\nDate Format: `year-month-day`\nTime Format: `hour:minute`",
    permission: 1,
    exec: (message, date, time, p1, p2) => {
      if(p1 == p2) throw "Cannot make VSmatch against same person!";
      let startTime = new Date(date + " " + time + " UTC").getTime();
      if(isNaN(startTime)) throw "invalid date (please check format of both date and time)";
      message.channel.send(`Scheduled (${p1}) vs (${p2}) at [${date + " " + time + " UTC"}] in [${((startTime - Date.now())/1000/60/60).toFixed(1)} hours]`);
      setTimeout(() => {
        cmds.vsmatch.exec(message, p1, p2);
      }, startTime - Date.now());
    }
  },
  adduser: {
    params: "[osu username] [user link] [rank]",
    desc: "add player to tourney player list (use ; for spaces in username)",
    permission: 1,
    exec: (message, name, link, userrank) => {
      return message.channel.send({embed:{thumbnail:{url:"https://i.kym-cdn.com/entries/icons/original/000/028/207/Screen_Shot_2019-01-17_at_4.22.43_PM.jpg"}}});
      const rankval = parseInt(userrank.replace('#', '').replace(/,/g, ''));
      user = name.replace(/;/g, ' ');
      if(isNaN(rankval)) throw "invalid rank";
      data.players[name] = {
        rank: rankval,
    		username: name,
    		id: link.replace('https://', '').replace('http://', '').replace('osu.ppy.sh/users/', ''),
    		rankpts: 0,
    		scores: [0,0,0,0,0,0,0,0,0,0,0,0,0,0]
      }
      message.channel.send("Added " + name);
    }
  },
  mappool: {
    alias: ["mp"],
    params: "(mappool)",
    desc: "show mappool details, if no parameter if given, list all the mappools",
    exec: (message, mappool) => {
      if(!mappool) return message.channel.send({embed: { title: "Mappools", description: Object.keys(data.mappools).sort().join('\n') }});
      if(!data.mappools[mappool]) throw "invalid mappool, but here's the mappool link anyways lol: [https://docs.google.com/spreadsheets/d/1Yiz099jB_9TmFC6POADzpyPwZX0Wqy4i70A_y3fVnj4/edit#gid=2017003193](https://docs.google.com/spreadsheets/d/1Yiz099jB_9TmFC6POADzpyPwZX0Wqy4i70A_y3fVnj4/edit#gid=2017003193)";
      let dump = ""; // maybe improve display later ?
      for(let m in data.mappools[mappool]){
        dump += `[${m}](https://osu.ppy.sh/b/${data.mappools[mappool][m]})\n`;
      }
      message.channel.send({embed: {
        title: mappool + " Mappool",
        description: dump
      }});
    }
  },
  createmappool: {
    params: "[mappool]",
    desc: "create a new mappool, no spaces allowed",
    permission: 1,
    exec: (message, mappool) => {
      throw "you aren't supposed to use this";
      if(data.mappools[mappool]) throw "mappool already exists";
      data.mappools[mappool] = {};
      fs.writeFile(config.PATH.mappool_data, JSON.stringify(data.mappools), 'utf8', (err) => {
        if(err) throw err;
        message.channel.send("Created the mappool: __**`" + mappool + "`**__");
        console.log('Updated mappool list (new mappool)', new Date().toLocaleString());
      });
    }
  },
  listrounds: {
    alias: ["lr"],
    params: "",
    desc: "list all the tournament rounds",
    exec: (message) => message.channel.send({embed: { title: "Tournament Stages", description: Object.keys(data.matches).sort().join('\n') }})
  },
  createround: {
    params: "[roundname]",
    desc: "create a new tournament round (f.e RO64), please don't use spaces in the name (only the first word will appear)",
    permission: 1,
    exec: (message, round) => {
      round = round.replace(/;/g, ' ');
      if(data.matches[round]) throw "tournament round already exists";
      data.matches[round] = {};
      fs.writeFile(config.PATH.match_data, JSON.stringify(data.matches), 'utf8', (err) => {
        if(err) throw err;
        message.channel.send("Created the tournament round: __**`" + round + "`**__");
        console.log('Updated matches (new round)', new Date().toLocaleString());
      });
    }
  },
  reschedule: {
    alias: ["rs"],
    params: "[matchtype] [player1] [player2] [date] [UTC time]",
    desc: "schedule a match (user ; for spaces in username)\n\nDate Format: `year-month-day`\nTime Format: `hour:minute`",
    permission: 1,
    exec: (message, round, user1, user2, date, time) => {
      if(round == undefined) return cmds.schedules.exec(message);
      round = round.replace(/;/g, ' ');
      if(!data.matches[round]) throw "invalid tournament round (create one with `createround`)";
      user1 = user1.replace(/;/g, ' ');
      user2 = user2.replace(/;/g, ' ');
      if(!data.players[user1]) throw "invalid participant1";
      if(!data.players[user2]) throw "invalid participant2";
      let matchData = {
        time: new Date(date + " " + time + " UTC").getTime()
      };
      if(isNaN(matchData.time)) throw "invalid date (please check format of both date and time)";
      data.matches[round][user1] = Object.assign({opponent: user2}, matchData);
      data.matches[round][user2] = Object.assign({opponent: user1}, matchData);
      fs.writeFile(config.PATH.match_data, JSON.stringify(data.matches), 'utf8', (err) => {
        if(err) throw err;
        console.log('Updated matches (scheduled)', new Date().toLocaleString());
        message.channel.send("aight");
      });
    }
  },
  schedule: {
    alias: ["calendar"],
    params: "[date]",
    desc: "view all matches for a certain date (for one week)\n\nDate Format: `year-month-day`",
    exec: (message, date) => {
      let filter_start = date ? new Date(date).getTime() : Date.now();
      //if(date == "tomorrow" || date == "tmr") filter_start = Date.now() + 86400000;
      if(isNaN(filter_start)) throw "invalid date (please check format of date)";
      let filter_end = filter_start + 604799999; // 7*24*60*60*1000-1
      console.log(filter_start, filter_end);
      let matches = [];
      Object.keys(data.matches).forEach(round => {
        Object.keys(data.matches[round]).forEach(player => {
          let match = Object.assign({}, data.matches[round][player]);
          if(match.time <= 0) match.time = config.challonge.defaultTime[round];
          if(match.time >= filter_start && match.time <= filter_end && player < match.opponent) matches.push(Object.assign({user: player, round: round}, match));
        });
      });
      matches.sort((a, b) => a.time - b.time);
      message.channel.send("```md\n# Matches``````ml\n" + matches.map(e => `${e.round} '${e.user}' vs.'${e.opponent}' ${e.time ? new Date(e.time).toLocaleString() + " UTC" : "TBA"}`).join('\n\n').substring(0, 1900) + "```");
    }
  },
  setscores: {
    params: "[participant] [all_scores] (separator)",
    desc: "set the scores of a player. scores should be separated by nonspace separator (default, semicolon), commas will be automatically removed (use ; for spaces in username)",
    permission: 1,
    exec: (message, user, scores, separator) => {
      user = user.replace(/;/g, ' ');
      if(!data.players[user]) throw "invalid participant";
      separator = separator || ";";
      if(scores.split(separator).length != 14) throw "wrong amount of scores";
      data.players[user].scores = scores.replace(/,/g, '').split(separator).map(e => parseInt(e));
      message.channel.send("done!");
    }
  },
  updatescore: {
    params: "[participant] [mapcode] [new value]",
    desc: "updates the score of a player (use ; for spaces in username)",
    permission: 1,
    exec: (message, user, mapcode, newscore) => {
      user = user.replace(/;/g, ' ');
      if(!data.players[user]) throw "invalid participant";
      if(isNaN(data.mapcodes[mapcode])) throw "invalid mapcode";
      newscore = parseInt(newscore.replace(/,/g, ''));
      if(isNaN(newscore)) throw "invalid score value";
      separator = separator || ";";
      data.players[user].scores[data.mapcodes[mapcode]] = newscore;
    }
  },
  sync: {
    params: "[participant] [discord account]",
    desc: "sync a participant with a discord account (use ; for spaces in username)",
    permission: 1,
    exec: (message, user, discorduser) => {
      user = user.replace(/;/g, ' ');
      if(!data.players[user]) throw "invalid participant";
      client.fetchUser(discorduser.replace('<@', '').replace('!', '').replace('>', '')).then(discorduser => {
        data.players[user].discord = discorduser.id;
        if(!data.users[discorduser.id]) data.users[discorduser.id] = {};
        data.users[discorduser.id].participant = user;

        cmds.save.exec(message);
        message.channel.send({embed: {
          description: `Set ${user}'s associated discord account to ${discorduser}`
        }});
      });
    }
  },
  syncall: {
    params: "",
    desc: "syncs __ALL__ participants with a discord account of matching nickname (does not overwrite)",
    permission: 1,
    exec: (message) => {
      let synced = [];
      let alreadySynced = [];
      let players = Object.assign({}, data.players);
      message.guild.members.map(member => {
        let name = member.displayName;
        if(!data.players[name]) return;
        if(data.players[name].discord){
          alreadySynced.push(name);
          if(!data.users[players[name].discord]) data.users[players[name].discord] = {};
          data.users[players[name].discord].participant = name;

          delete players[name];
          return;
        }
        data.players[name].discord = member.id;
        synced.push(name);
        delete players[name];
      });
      Object.keys(players).forEach(name => {
        if(players[name].discord){
          alreadySynced.push(name + " *");
          if(!data.users[players[name].discord]) data.users[players[name].discord] = {};
          data.users[players[name].discord].participant = name;

          delete players[name];
        }
      });
      message.channel.send({embed: {
        title: "Syncing complete.",
        description: "```md\n# Synced Players\n" + synced.join('\n') + "```",
        fields: [
          {
            name: "Ignored",
            value: "```diff\n+ " + alreadySynced.join('\n+ ') + "\n- " + Object.keys(players).join('\n- ') + "```"
          }
        ]
      }});
    }
  },
  me: {
    params: "",
    desc: "view your stats",
    exec: (message) => {
      let user = data.users[message.author.id].participant;
      if(!data.players[user]) throw message.author + " isn't synced with a participant";
      cmds.view.exec(message, user);
    }
  },
  opponent: {
    alias: ["op"],
    params: "",
    desc: "view the stats of your opponent",
    exec: (message, username) => {
      let user = data.users[message.author.id].participant;
      if(username) message.author = user = username;
      if(!data.players[user]) throw message.author + " isn't synced with a participant";
      for(let round in data.matches)
        if(data.matches[round][user] && !((data.matches[round][user].time || config.challonge.defaultTime[round]) < Date.now() && data.matches[round][user].score)) return cmds.view.exec(message, data.matches[round][user].opponent);
      throw "No opponent found";
    }
  },
  view: {
    alias: ["v", "profile"],
    params: "[participant]",
    desc: "view the stats of a player",
    exec: function(message, user){
      if(!user) return cmds.me.exec(message);
      user = [...arguments].splice(1).join(' ').replace(/;/g, ' ');
      if(!data.players[user]) throw "invalid participant";
      let u = data.players[user];
      let matches = "", matchHistory = "";
      Object.keys(data.matches).forEach(round => {
        if(!data.matches[round][user]) return;
        let opponent = data.matches[round][user].opponent;
        let matchTime = data.matches[round][user].time||config.challonge.defaultTime[round];
        if(matchTime < Date.now() && data.matches[round][user].score){
          matchHistory += `${round} vs.'${opponent}'\n${data.matches[round][user].score}\n\n`;
          return;
        }
        matches += `${round} vs.'${opponent}'\n${matchTime > Date.now() ? new Date(matchTime).toLocaleString().split(' ').join('\n') : "TBA"} UTC\n\n`;
        //matches += `${round} vs.'${opponent.length > 8 ? opponent.substring(0, 8) + "'\n" + (" ".repeat(round.length + 4)) + "'" + opponent.substring(8, 16) : opponent}'\n${new Date(data.matches[round][user].time).toLocaleString().split(' ').join('\n')} UTC\n\n`;
      })
      client.fetchUser(u.discord).then(discorduser => {
        message.channel.send({
          embed: {
            title: `(#${u.rank.toLocaleString()}) ${u.username}'s Tourney Stats`,
            url: "https://osu.ppy.sh/users/" + u.id,
            thumbnail: {
              url: "https://a.ppy.sh/" + u.id
            },
            description: `Discord account: ${discorduser || "None"}`,
            fields: [
              {
                name: "Qualifier Seed",
                value: u.seed ? `\`\`\`md\n# ${u.seed}\`\`\`` : "uncalculated",
                inline: true
              },
              {
                name: "Qualifier Score",
                value: `\`\`\`ml\n${u.score || u.rankpts} pts.\`\`\``,
                inline: true
              },
              {
                name: "Scores",
                value: "```ml\n" + mapcodelist.map(e => `${e} =>${(u.scores[config.mapcodes[e]] || 0).toLocaleString().padStart(11, ' ')}`).join('\n') + "```",
                // mapcodelist.map(e => `**\`${e}\`**\`=>${(u.scores[config.mapcodes[e]] || 0).toLocaleString().padStart(10, '_')}\``).join('\n')
                inline: false
              },
              {
                name: "Upcoming Matches",
                value: `\`\`\`ml\n${matches || "None"}\`\`\``,
                inline: false
              },
              {
                name: "Match History",
                value: `\`\`\`ml\n${matchHistory || "None"}\`\`\``,
                inline: false
              },
            ],
            timestamp: new Date(),
          }
        });
      });
    }
  },
  calculate: {
    params: "",
    desc: "calculate the total points of each user",
    permission: 1,
    exec: message => {
      for(let j = 0; j < playerlist.length; j ++) playerlist[j].score = playerlist[j].rankpts;
      for(let i = 0; i < mapcount; i ++){
        playerlist.sort((a, b) => a.scores[i] - b.scores[i]);
        for(let j = 0; j < playerlist.length; j ++) playerlist[j].score += j;
      }
      playerlist.sort((a, b) => b.score - a.score);
      for(let i = 0; i < playerlist.length; i ++) playerlist[i].seed = (i+1);
      for(let i = 0; i < playerlist.length; i ++) playerlist[i].id = playerlist[i].id.replace('https://osu.ppy.sh/users/', '');
      message.channel.send("done!")
    }
  },
  viewseeding: {
    alias: ["vs"],
    params: "(range)",
    desc: "view all the seed values [specify range `x-y`]",
    exec: (message, range) => {
      let x = "";
      range = range ? range.split('-').map(e => parseInt(e)) : [1, playerlist.length-1];
      if(isNaN(range[0]) || isNaN(range[1])) throw "invalid range";
      playerlist.sort((a, b) => a.seed - b.seed);
      for(let i = Math.max(0, range[0]-1); i <= Math.min(range[1], playerlist.length-1); i ++){
        x += "**`[" + (i+1+'').padEnd(2, ' ').padStart(3, ' ') + "]`** `" + playerlist[i].username.padEnd(15, ' ') + " (" + (playerlist[i].score+'').padStart(3, ' ') + "pts.)`\n";
        if(x.length > 1950) break;
      }
      message.channel.send(x);
    }
  },
  challongesync: {
    alias: ["csync", "cs"],
    params: "",
    desc: "starts syncing process with challonge (automatically runs once every 4 hours)",
    permission: 1,
    exec: () => {
      let JSONdata = data;
      console.log("Starting challonge-sync process at " + new Date().toLocaleString());
      challongeClient.matches.index({
        id: config.challonge.id,
        callback: (err, data) => {
          countTarget = Object.keys(data).length;
          Object.keys(data).forEach(e => {
            e = data[e].match;
            if(!e) return;
            if(e.player1Id == null || e.player2Id == null) return;

            challongeClient.participants.show({
              id: config.challonge.id,
              participantId: e.player1Id,
              callback: (err, data) => {
                let p1name = data.participant.name;

                challongeClient.participants.show({
                  id: config.challonge.id,
                  participantId: e.player2Id,
                  callback: (err, data) => {
                    if(err) throw err;
                    let round = config.challonge.rounds[e.round];
                    let p2name = data.participant.name;
                    if(!JSONdata.matches[round]) return console.log("MISSING ROUND -> " + round);
                    let matchData = {
                      time: 0,
                    }
                    if(!JSONdata.matches[round][p1name]){
                      JSONdata.matches[round][p1name] = Object.assign({opponent: p2name}, matchData);
                      console.log(round, p1name, p2name, e.scoresCsv);
                    }
                    if(!JSONdata.matches[round][p2name]){
                      JSONdata.matches[round][p2name] = Object.assign({opponent: p1name}, matchData);
                      console.log(round, p1name, p2name, e.scoresCsv);
                    }
                    if(e.winnerId){
                      if(!JSONdata.matches[round][p1name].score) console.log(round, p1name, p2name, e.scoresCsv);
                      let p1won = e.player1Id == e.winnerId;
                      JSONdata.matches[round][p1name].won = p1won;
                      JSONdata.matches[round][p1name].score = e.scoresCsv;
                      JSONdata.matches[round][p2name].won = !p1won;
                      JSONdata.matches[round][p2name].score = e.scoresCsv.split('-').reverse().join('-');
                    }
                  }
                });
              }
            });
          })
        }
      });
    }
  },
  /*parsematch: {
    params: "[mappool] [osu match id]",
    desc: "parse the match to see who won",
    exec: (message, mappoolID, matchID) => {
      if(mappoolID)
      osu.apiCall('/get_match', {mp: matchID}).then(matches => {
        let m = matches.games.reverse();
        let scores = {};
        for(let i = 0; i < m.length; i ++){
          if(!data.mappools[mappoolID][m[i].beatmap_id]) continue;
          let winner = m[i].scores.sort((a, b) => b.score - a.score)[0].user_id;
          scores[winner] = scores[winner] ? scores[winner] + 1 : 1;
          if(scores[winner] >= 5) break;
        }
        let x = 0, x2 = Object.keys(scores).length;
        Object.keys(scores).forEach(e => {
          osu.getUser({u: e}).then(user => {
            scores[user.name] = scores[e];
            delete scores[e];
            if(++x >= x2){
              let s = [];
              Object.keys(scores).forEach(e =>
                s.push({
                  name: e,
                  score: scores[e]
                }));
              message.channel.send("```md\n# " + s.map(e => e.score + " - " + e.name).join('\n') + "```");
            }
          });
        });
      });
    }
  },*/
  save: {
    params: "[mode]",
    desc: "write the current data to disk",
    permission: 2,
    exec: (message, mode) => {
      switch(mode){
        case "p":
          fs.writeFile(config.PATH.player_data, JSON.stringify(data.players), 'utf8', (err) => {
            if(err) throw err;
            message.react("✅");
            console.log('Saved playerdata (force)', new Date().toLocaleString());
          });
          break;
        case "ma":
          fs.writeFile(config.PATH.match_data, JSON.stringify(data.matches), 'utf8', (err) => {
            if(err) throw err;
            message.react("✅");
            console.log('Saved matches (force)', new Date().toLocaleString());
          });
          break;
      }
    }
  },
  eval: {
    params: "[key]",
    desc: "evaluate code",
    permission: 2,
    exec: (message) => {
      try {
        eval(message.content.replace(config.prefix + "eval", ''));
      }catch(error){
        throw error;
      }
    }
  }
};
const _cmds = Object.assign({}, cmds);
