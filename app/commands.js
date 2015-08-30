var _ = require('underscore');
var util = require('util');

var commands = [];

exports.setup = function() {
};

exports.register = function(tbl) {
	_.each(tbl, function(v, k) {
		commands[k] = v;
	});
};

exports._handle = function(evt, msg) {
	if(msg.slice(0, 1) != "!")
		return;
	var m = msg.match(/^!([A-Za-z0-9]+)(?: (.*))?$/);
	if(!m)
		return;
	if(commands[m[1].toLowerCase()])
		commands[m[1].toLowerCase()](evt, m[2]);
	else
		console.log("[commands.js] unknown command: '!%s'", m[1]);
};
