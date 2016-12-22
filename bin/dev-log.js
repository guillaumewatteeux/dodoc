var gutil = require('gulp-util');
var logger = require('electron-log');

var dev = (function() {
  let isDebugMode = false;
  let isVerboseMode = false;
  let logToFile = false;

  logger.transports.console = false;

  const API = {
    init        : (isDebug, isVerbose)   => { return initModule(isDebug, isVerbose) },
    log         : log,
    logverbose  : logverbose,
    logpackets  : logpackets,
    logfunction : logfunction,
    error       : error,
    isDebug     : ()   => { return isDebugMode; },
  };

  function initModule(d, v) {
    isDebugMode = d;
    isVerboseMode = v
    if(isDebugMode) {
      console.log('Debug mode is Enabled');
      console.log('---');
      dev.logfunction('(log) magenta is for functions');
      dev.logpackets('(log) green is for packets');
      dev.logpackets('(log) green is for packets');
      if(isVerboseMode) {
        dev.logverbose('(dev and verbose) gray for regular parsing data');
      }
    }
    return;
  }

  function log() {
    var args = Array.prototype.slice.call(arguments);
    var logArgs = args;
    _sendToLogFile(logArgs);
    _sendToConsole(logArgs, gutil.colors.white);
  }
  function logverbose() { // gray
    var args = Array.prototype.slice.call(arguments);
    var logArgs = '- '.concat(args);

    _sendToLogFile(logArgs);
    if(isDebugMode && isVerboseMode)
      _sendToConsole(logArgs, gutil.colors.gray);
  }
  function logpackets() { // green
    var args = Array.prototype.slice.call(arguments);
    var logArgs = '* '.concat(args);

    _sendToLogFile(logArgs);
    if(isDebugMode)
      _sendToConsole(logArgs, gutil.colors.green);
  }
  function logfunction() { // magenta
    var args = Array.prototype.slice.call(arguments);
    var logArgs = '~ '.concat(args);

    _sendToLogFile(logArgs);
    if(isDebugMode)
      _sendToConsole(logArgs, gutil.colors.magenta);
  }
  function error() { // red
    var args = Array.prototype.slice.call(arguments);
    var logArgs = 'ERROR! '.concat(args);

    _sendToLogFile(logArgs);
    _sendToConsole(logArgs, gutil.colors.red);
  }

  function _sendToLogFile(logArgs) {
    if(!logToFile)
      return;
    logger.info(logArgs.toString());
  }
  function _sendToConsole(logArgs, color = gutil.colors.white) {
    gutil.log(color(logArgs));
  }

  return API;
})();

module.exports = dev;