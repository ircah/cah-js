var _ = require('underscore');
var util = require('util');

exports.setup = function() {
	global.commands = {};
};

exports.handle = function(evt, msg) {
	if(msg.slice(0, 1) != "!")
		return;
	var m = msg.match(/^!([A-Za-z0-9]+)(?: (.+))?$/);
	if(!m)
		return;
	if(global.commands[m[1].lower()])
		global.commands[m[1].lower()](evt, m[2]);
	else
		console.log("[commands.js] unknown command: '!%s'", m[1]);
};
