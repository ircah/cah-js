var _ = require('underscore');
var fs = require('fs');
var JSON5 = require('json5');

var config = JSON5.parse(fs.readFileSync("config/main.json5", "utf8"));
global.config = config;

require("./app/bot").setup();
