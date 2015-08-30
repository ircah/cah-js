var _ = require('underscore');
var util = require('util');

var commands = [];
var eventsPart = [];
var eventsQuit = [];
var eventsKick = [];

exports.setup = function() {
};

exports.register = function(tbl) {
	_.each(tbl, function(v, k) {
		commands[k] = v;
	});
};

exports.onPart = function(fct) {
	eventsPart.push(fct);
};

exports.onQuit = function(fct) {
	eventsQuit.push(fct);
};

exports.onKick = function(fct) {
	eventsKick.push(fct);
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

exports._eventPart = function(e) {
	_.each(eventsPart, function(f) {
		f(e);
	});
};

exports._eventQuit = function(e) {
	_.each(eventsQuit, function(f) {
		f(e);
	});
};

exports._eventKick = function(e) {
	_.each(eventsKick, function(f) {
		f(e);
	});
};
