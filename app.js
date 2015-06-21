var _ = require('underscore');
var fs = require('fs');

var config = JSON.parse(fs.readFileSync("config/main.json", "utf8"));
global.config = config;

require("./app/bot").setup();
