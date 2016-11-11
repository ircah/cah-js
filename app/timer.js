var _ = require('underscore');

class Timer {
	constructor(time) {
		this.time = time;
		this.timeout = null;
		this.events = []; // array cuz integer dict keys are not a thing in JSs
		this.elapsed_events = [];
	}
	_getNextEvents(events, current) {
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
	_eventFunction(curtime) {
		_.each(this.events[curtime], function(func) {
			func(curtime, this);
		});
		var tmp = this._getNextEvents(this.events, curtime);
		if(tmp == null)
			this.timeout = setTimeout(this._endFunction.bind(this), (this.time - curtime) * 1000);
		else
			this.timeout = setTimeout(this._eventFunction.bind(this, tmp[0]), (tmp[0] - curtime) * 1000);
	}
	_endFunction() {
		this.timeout = null; // make sure .isRunning() returns false
		_.each(this.elapsed_events, function(func) {
			func(this);
		});
	}
	on(time, func) { // func = function(timeElapsed, timer)
		if(time < 0)
			time = this.time + time;
		else if(time == this.time)
			return this.onElapsed(function(timer) { func(time, timer); });
		if(!this.events[time])
			this.events[time] = [];
		this.events[time].push(func);
	}
	onElapsed(func) { // func = function(timer)
		this.elapsed_events.push(func);
		return true;
	}
	start() {
		if(this.isRunning())
			return false;
		var tmp = this._getNextEvents(this.events);
		if(tmp == null)
			this.timeout = setTimeout(this._endFunction.bind(this), this.time * 1000);
		else
			this.timeout = setTimeout(this._eventFunction.bind(this, tmp[0]), tmp[0] * 1000);
		return true;
	}
	stop() {
		if(!this.isRunning())
			return false;
		clearTimeout(this.timeout);
		this.timeout = null;
		return true;
	}
	isRunning() {
		return (this.timeout != null);
	}
	resumeFrom(time) {
		if(this.isRunning())
			return false;
		if(time < 0)
			time = this.time + time;
		else if(time == 0)
			return this.start();
		else if(time == this.time)
			return this._endFunction() || true;
		if(time < 0) // happens when time < 0 && -time > this.time (time being the original arg)
			return false;
		var tmp = this._getNextEvents(this.events, time);
		if(tmp == null)
			this.timeout = setTimeout(this._endFunction.bind(this), (this.time - time) * 1000);
		else
			this.timeout = setTimeout(this._eventFunction.bind(this, tmp[0]), (tmp[0] - time) * 1000);
		return true;
	}
}

exports.Timer = Timer;
