var _ = require('underscore');

exports.Timer = function(time) {
	this.time = time;
	this.timeout = null;
	this.events = []; // array cuz integer dict keys are not a thing in JSs
	this.elapsed_events = [];

	function getNextEvents(events, current) {
		if(current === undefined)
			current = -1;
		var n = Infinity;
		_.each(events, function(val, idx) {
			if(val === undefined)
				return;
			if(idx < n && idx > current)
				n = idx;
		});
		if(n == Infinity)
			return null;
		return [n, events[n]];
	}
	function eventFunction(timer, curtime) {
		_.each(timer.events[curtime], function(func) {
			func(curtime, timer);
		});
		var tmp = getNextEvents(timer.events, curtime);
		if(tmp == null)
			timer.timeout = setTimeout(function() { endFunction(timer); }, (timer.time - curtime) * 1000);
		else
			timer.timeout = setTimeout(function() { eventFunction(timer, tmp[0]); }, (tmp[0] - curtime) * 1000);
	}
	function endFunction(timer) {
		timer.timeout = null; // make sure .isRunning() returns false
		_.each(timer.elapsed_events, function(func) {
			func(timer);
		});
	}
	this.on = function(time, func) { // func = function(timeElapsed, timer)
		if(time < 0)
			time = this.time + time;
		else if(time == this.time)
			return this.onElapsed(function(timer) { func(time, timer); });
		if(!this.events[time])
			this.events[time] = [];
		this.events[time].push(func);
	};
	this.onElapsed = function(func) { // func = function(timer)
		this.elapsed_events.push(func);
		return true;
	}
	this.start = function() {
		if(this.isRunning())
			return false;
		var tmp = getNextEvents(this.events);
		var timer = this;
		if(tmp == null) {
			this.timeout = setTimeout(function() { endFunction(timer); }, this.time * 1000);
			return true;
		}
		this.timeout = setTimeout(function() { eventFunction(timer, tmp[0]); }, tmp[0] * 1000);
		return true;
	}
	this.stop = function() {
		if(!this.isRunning())
			return false;
		clearTimeout(this.timeout);
		this.timeout = null;
		return true;
	};
	this.isRunning = function() {
		return (this.timeout != null);
	};
	this.resumeFrom = function(time) {
		if(this.isRunning())
			return false;
		if(time < 0)
			time = this.time + time;
		else if(time == 0)
			return this.start();
		else if(time == this.time)
			return endFunction(this) || true;
		if(time < 0) // happens when time < 0 && -time > this.time (time being the original arg)
			return false;
		var tmp = getNextEvents(this.events, time);
		var timer = this;
		if(tmp == null) {
			this.timeout = setTimeout(function() { endFunction(timer); }, (this.time - time) * 1000);
			return true;
		}
		this.timeout = setTimeout(function() { eventFunction(timer, tmp[0]); }, (tmp[0] - time) * 1000);
		return true;
	};
}

/* vim: set ts=4 sw=4 sts=0 noet: */
