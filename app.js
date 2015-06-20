var _ = require('underscore');
var coffea = require('coffea');
var fs = require('fs');
var util = require('util');

var config = JSON.parse(fs.readFileSync("config/main.json", "utf8"));

var client = coffea(config.irc);

client.on("motd", function(motd) {
	client.join(config.channels);
});

client.on("message", function(event) {
	console.log(util.format("irc msg on %s: <%s> %s", event.channel.getName(), event.user.getNick(), event.message));
});


