
var fs     = require('fs');
var path   = require('path');
var nopt   = require('nopt');
var util   = require('util');
var events = require('events');

module.exports = noptify;
noptify.Noptify = Noptify;

// XXX consider splitting the API in multiple mixins: collectable, commandable, etc.

// noptify is a little wrapper around `nopt` module adding a more expressive,
// commander-like, API and few helpers.
//
// Examples
//
//     var program = noptify(process.argv, { program: 'name' })
//       .version('0.0.1')
//       .option('port', '-p', 'Port to listen on (default: 35729)', Number)
//       .option('pid', 'Path to the generated PID file', String)
//
//     var opts = program.parse();
//
// Returns an instance of `Noptify`
function noptify(args, options) {
  return new Noptify(args, options);
}

// Noptify provides the API to parse out option, shorthands and generate the
// proper generic help output.
//
// - args     - The Array of arguments to parse (default: `process.argv`);
// - options  - An hash of options with the following properties
//  - program - The program name to use in usage output
//
// Every noptify instance is created with two options, `-h, --help` and `-v,
// --version`.
function Noptify(args, options) {
  events.EventEmitter.call(this);
  options = this.options = options || {};
  this.args = args || process.argv;
  this.program = options.program || (path.basename(this.args[this.args[0] === 'node' ? 1 : 0]));

  this._shorthands = {};
  this._commands = {};
  this._routes = [];
  this._steps = [];
  this.nopt = {};

  this.option('help', '-h', 'Show help usage');
  this.option('version', '-v', 'Show package version');
}

util.inherits(Noptify, events.EventEmitter);

// Parse the provided options and shorthands, pass them through `nopt` and
// return the result.
//
// When `opts.help` is set, the help output is displayed and `help`
// event is emitted. The process exists with `0` status, the help output is
// automatically displayed and the `help` event is emitted.
//
// Examples
//
//    var program = noptify(['foo', '--help'])
//      .on('help', function() {
//        console.log('Examples');
//        console.log('');
//        console.log('  foo bar --baz > foo.txt');
//      });
//
//    var opts = program.parse();
//    // ... Help output ...
//    // ... Custom help output ...
//    // ... Exit ...
//
//
Noptify.prototype.parse = function parse(argv) {
  argv = argv || this.args;
  var options = this._options.reduce(function(opts, opt) {
    opts[opt.name] = opt.type;
    return opts;
  }, {});

  this._options.forEach(function(opt) {
    if(!opt.shorthand) return;
    this.shorthand(opt.shorthand, '--' + opt.name);
  }, this);

  var opts = nopt(options, this._shorthands, argv);
  if(opts.version) {
    console.log(this._version);
    process.exit(0);
  }

  if(opts.help) {
    this.help();
    this.emit('help');
    process.exit(0);
  }

  this.nopt = opts;

  // check remaining args and registered command, for each match, remove the
  // argument from remaining args and trigger the handler, ideally the handler
  // can be another subprogram, for now simple functions

  process.nextTick(this.routeCommand.bind(this));
  return opts;
};

// Define the program version.
Noptify.prototype.version = function(ver) {
  this._version = ver;
  return this;
};

// Define `name` option with optional shorthands, optional description and optional type.
Noptify.prototype.option = function option(name, shorthand, description, type) {
  this._options = this._options || [];
  if(!description) {
    description = shorthand;
    shorthand = '';
  }

  if(!type) {
    if(typeof description === 'function') {
      type = description;
      description = shorthand;
      shorthand = '';
    } else {
      type = String;
    }
  }

  shorthand = shorthand.replace(/^-*/, ''),

  this._options.push({
    name: name,
    shorthand: shorthand.replace(/^-*/, ''),
    description: description,
    usage: (shorthand ? '-' + shorthand + ', ': '' ) + '--' + name,
    type: type
  });

  return this;
};

// Stores the given `shorthands` Hash of options to be `parse()`-d by nopt
// later on.

Noptify.prototype.shorthand =
Noptify.prototype.shorthands = function shorthands(options, value) {
  if(typeof options === 'string' && value) {
    this._shorthands[options] = value;
    return this;
  }

  Object.keys(options).forEach(function(shorthand) {
    this._shorthands[shorthand] = options[shorthand];
  }, this);
  return this;
};

// Simply output to stdout the Usage and Help output.
Noptify.prototype.help = function help() {
  var buf = '';
  buf += '\n  Usage: ' + this.program + ' [options]';
  buf += '\n';
  buf += '\n  Options:\n';

  var maxln = Math.max.apply(Math, this._options.map(function(opts) {
    return opts.usage.length;
  }));

  var options = this._options.map(function(opts) {
    return '    ' + pad(opts.usage, maxln + 5) + '\t- ' + opts.description;
  });

  buf += options.join('\n');

  // part of help input ? --list-shorthands ?
  var shorthands = Object.keys(this._shorthands);
  if(shorthands.length) {
    buf += '\n\n  Shorthands:\n';
    maxln = Math.max.apply(Math, Object.keys(this._shorthands).map(function(key) {
      return key.length;
    }));
    buf += Object.keys(this._shorthands).map(function(shorthand) {
      return '    --' + pad(shorthand, maxln + 1) + '\t\t' + this._shorthands[shorthand];
    }, this).join('\n');
  }

  buf += '\n';

  console.log(buf);
};

// Helpers

Noptify.prototype.stdin = function stdin(force, done) {
  if(!done) done = force, force = false;
  var argv = this.nopt.argv;

  // not parsed, register done to be read when parse is called
  if(!argv) {
    this.once('stdin', done);
    return this;
  }

  // only read from stdin when no reamining args and not forced
  if(!argv.remain.length || force) {
    this.readStdin(done);
  }

  return this;
};

// Read files from remaining args, concat the result and call back the `done`
// function with the concatanated result and the list of files.
Noptify.prototype.files = function files(done) {
  var argv = this.nopt.argv;

  // not parsed, register done to be read when parse is called
  if(!argv) {
    this.once('files', done);
    return this;
  }

  // only read files when we actually have files to read from
  if(argv.remain.length) {
    this.readFiles(argv.remain, done);
  }

  return this;
};

Noptify.prototype.readStdin = function readStdin(done) {
  var data = '';
  var self = this;
  done = done || function(err) { err && self.emit('error', err); };
  process.stdin.setEncoding('utf8');
  process.stdin.on('error', done);
  process.stdin.on('data', function(chunk){
    data += chunk;
    self.emit('stdin:data', chunk);
  }).on('end', function(){
    self.emit('stdin', null, data);
    done(null, data);
  }).resume();
  return this;
};

// Asynchronous walk of the remaining args, reading the content and returns
// the concatanated result.
Noptify.prototype.readFiles = function readFiles(filepaths, done) {
  var data = '';
  var self = this;
  var files = filepaths.slice(0);
  done = done || function(err) { err && self.emit('error', err); };
  (function read(file) {
    if(!file) {
      self.emit('files', null, data, filepaths);
      return done(null, data, filepaths);
    }
    fs.readFile(file, 'utf8', function(err, body) {
      if(err) return done(err);
      data += body;
      self.emit('files:data', body);
      read(files.shift());
    });
  })(files.shift());
  return this;
};

// Collect data either from stdin or the list of remaining args
Noptify.prototype.collect = function collect(done) {
  return this.stdin(done).files(done);
};

// command API

Noptify.prototype.cmd =
Noptify.prototype.command = function command(name, fn) {
  this._commands[name] = fn;
  this.on(name, fn instanceof Noptify ? fn.parse.bind(fn) : fn);
  return this;
};

Noptify.prototype.route = function route(pattern, fn) {
  pattern = pattern instanceof RegExp ? pattern : new RegExp('^' + pattern + '$');
  this._routes.push({
    pattern: pattern,
    fn: fn
  });
  return this;
};

Noptify.prototype.routeCommand = function routeCommand(opts) {
  opts = opts || this.nopt;
  var args = opts.argv.remain;
  var commands = Object.keys(this._commands);

  // firt try to find a route, then fallback to command
  var route = this._routes.filter(function(route) {
    return route.pattern.test(args.join(' '));
  });

  if(route.length) return route[0].fn();

  var first = 0;
  var registered = args.filter(function(arg, i) {
    var match = ~commands.indexOf(arg);
    if(match) first = first || i;
    return match;
  });

  if(!registered[0]) return this.run();

  opts.argv.remain = args.slice(0, first);
  registered.forEach(function(command) {
    var position = opts.argv.original.indexOf(command);
    var options = nopt({}, {}, opts.argv.original.slice(position));
    this.emit(command, options.argv.original, options);
  }, this);
};

Noptify.prototype.run = function run(fn) {
  if(fn) {
    this._steps.push(fn);
    return this;
  }

  var steps = this._steps;
  var self = this;
  (function next(step) {
    if(!step) return;
    var async = /function\s*\(\w+/.test(step + '');
    if(!async) {
      step();
      return next(steps.shift());
    }

    step(function(err) {
      if(err) return self.emit('error', err);
      next(steps.shift());
    });
  })(steps.shift());
};

function pad(str, max) {
  var ln = max - str.length;
  return ln > 0 ? str + new Array(ln).join(' ') : str;
}
