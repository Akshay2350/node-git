/*
Copyright (c) 2010 Tim Caswell <tim@creationix.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var ChildProcess = require('child_process'),
    Path = require('path'),
    fs = require('fs');

var fileCache;
var dirCache;
var tagsCache;
var gitCommands, gitDir, workTree;

// Set up the git configs for the subprocess
var Git = module.exports = function (repo) {
  // Check the directory exists first.
  try {
    fs.statSync(repo);
  } catch (e) {
    throw new Error("Bad repo path: " + repo);
  }
  
  Git.clearCache();
  
  try {
    // Check is this is a working repo
    gitDir = Path.join(repo, ".git")
    fs.statSync(gitDir);
    workTree = repo;
    gitCommands = ["--git-dir=" + gitDir, "--work-tree=" + workTree];
  } catch (e) {
    gitDir = repo;
    gitCommands = ["--git-dir=" + gitDir];
  }
  
};


var execQueue = {};
// Internal helper to talk to the git subprocess
function gitExec(commands, callback) {
  var key = commands.join(' ');
  if (execQueue[key]) {
    execQueue[key].push(callback);
    return;
  }
  execQueue[key] = [callback];
  commands = gitCommands.concat(commands);
  var child = ChildProcess.spawn("git", commands);
  var stdout = "", stderr = "";
  child.stdout.setEncoding('binary');
  child.stdout.addListener('data', function (text) {
    stdout += text;
  });
  child.stderr.addListener('data', function (text) {
    stderr += text;
  });
  child.addListener('exit', function (code) {
    var args;
    if (code > 0) {
      args = [new Error("git " + commands.join(" ") + "\n" + stderr)];
    } else {
      args = [null, stdout];
    }
    execQueue[key].forEach(function (callback) {
      callback.apply(null, args);
    });
    delete execQueue[key];
  });
}

// Loads a file from a git repo
Git.readFile = function readFile(path, version, callback) {
  // version defaults to HEAD
  if (typeof version === 'function' && typeof callback === 'undefined') {
    callback = version;
    // Load raw files if we're in a working tree
    if (workTree) {
      fs.readFile(Path.join(workTree, path), 'binary', callback);
      return;
    }
    version = "HEAD";
  }
  path = version + ":" + path;
  if (path in fileCache) {
    callback(null, fileCache[path]);
    return;
  }
  gitExec(["show", path], function (err, text) {
    if (err) {
      callback(err);
      return;
    }
    fileCache[path] = text;
    callback(null, text);
  });
};

// Reads a directory at a given version and returns an objects with two arrays
// files and dirs.
Git.readDir = function readDir(path, version, callback) {
  // version defaults to HEAD
  if (typeof version === 'function' && typeof callback === 'undefined') {
    callback = version;
    version = "HEAD";
  }
  var combined = version + ":" + path;
  if (combined in dirCache) {
    callback(null, dirCache[combined]);
    return;
  }
  Git.readFile(path, version, function (err, text) {
    if (err) {
      callback(err);
      return;
    }
    if (!(/^tree .*\n\n/).test(text)) {
      callback(new Error(combined + " is not a directory"));
      return;
    }
    text = text.replace(/^tree .*\n\n/, '').trim();
    var files = [];
    var dirs = [];
    text.split("\n").forEach(function (entry) {
      if (/\/$/.test(entry)) {
        dirs[dirs.length] = entry.substr(0, entry.length - 1);
      } else {
        files[files.length] = entry;
      }
    })
    delete fileCache[combined];
    dirCache[combined] = {
      files: files,
      dirs: dirs
    };
    callback(null, dirCache[combined]);
  });
};

// Gets a list of tags from the repo. The result is an object with tag names
// as keys and their sha1 entries as the values
Git.getTags = function (callback) {
  if (tagsCache) {
    callback(null, tagsCache);
  } else {
    gitExec(["show-ref", "--tags"], function (err, text) {
      if (err) {
        callback(err);
        return;
      }
      tagsCache = {};
      text.trim().split("\n").forEach(function (line) {
        var match = line.match(/^([0-9a-f]+) refs\/tags\/(.*)$/);
        tagsCache[match[2]] = match[1];
      })
      callback(null, tagsCache);
    });
  }
}

// Returns the tags for which a path exists
Git.exists = function (path, callback) {
  Git.getTags(function (err, tags) {
    tags.HEAD = "HEAD";
    if (err) { throw err; }
    var exists = {};
    var count = Object.keys(tags).length;
    Object.keys(tags).forEach(function (tag) {
      Git.readFile(path, tags[tag], function (err, text) {
        if (!err) {
          exists[tag] = tags[tag];
        }
        count--;
        if (count <= 0) {
          callback(null, exists);
        }
      });
    });
  });
}

// Clears the caches so that we can load fresh content again.
Git.clearCache = function () {
  fileCache = {};
  dirCache = {};
  tagsCache = undefined;
};

