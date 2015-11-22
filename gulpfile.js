/*
 * Copyright 2015 The Closure Compiler Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Build process for closure-compiler-npm package
 *
 * Since the package doesn't require building, this file runs
 * tests and auto-increments the version number. Auto-increment
 * is used to support continuous delivery.
 *
 * @author Chad Killingsworth (chadkillingsworth@gmail.com)
 */

'use strict';

var gulp = require('gulp');
var gutil = require('gulp-util');
var mocha = require('gulp-mocha');
var git = require('simple-git')(__dirname);
var Semver = require('semver');
var fs = require('fs');
var process = require('child_process');
var packageInfo = require('./package.json');
var currentVer = new Semver(packageInfo.version);

gulp.task('test', function() {
  return gulp.src('./test/**.js', {read: false})
      .pipe(mocha());
});
gulp('default', ['test']);

var didLastCommitChangeVersionNumber = function() {
  return new Promise(function (resolve, reject) {
    git.diff(['HEAD^', 'HEAD', 'package.json'], function(err, data) {
      if (err) {
        return reject(err);
      }

      var versionData = (data || '').match(/^[+-]\s*"version": "[^"]+",$/mg);
      var versionChanged = versionData === null ? false : versionData.length === 2;
      return resolve(versionChanged);
    });
  });
};

var getNextVersionNumber = function(alreadyChanged) {
  return new Promise(function(resolve, reject) {
    if (alreadyChanged) {
      gutil.log('Previous commit incremented version number. No changes needed.');
      return resolve(currentVer);
    }

    var Compiler = require('./lib/node/closure-compiler');
    var compiler = new Compiler({version: true});
    compiler.run(function(code, data, err) {
      if (code !== 0) {
        return reject(new Error('Non-zero exit code: ' + code));
      }

      var versionNum = (data || '').match(/Version:\sv(.*)$/m);
      if (versionNum.length !== 2) {
        return resolve(new Error('Unable to parse compiler version number'));
      }
      var compilerVer = new Semver(versionNum[1] + '.0.0');

      if (compilerVer.compare(currentVer) > 0) {
        gutil.log('New compiler version detected. Increment major release.');
        return resolve(compilerVer);
      }

      var nextVersion = new Semver(packageInfo.version);
      nextVersion.inc('minor');
      gutil.log('Changes detected. Increment minor release.');
      return resolve(nextVersion);
    });
  });
};

var updatePackageToNewVersion = function(newVersion) {
  return new Promise(function(resolve, reject) {
    if (currentVer.compare(newVersion) >= 0) {
      return resolve(false);
    }

    packageInfo.version = newVersion.version;
    fs.writeFileSync('./package.json', JSON.stringify(packageInfo, null, 2) + '\n');

    git.add('package.json', function(err, data) {})
        .commit('Increment version number to ' + newVersion.version, function(err, data) {
          gutil.log('New version committed: ' + newVersion.version);
          return resolve(true);
        });
  });
};

gulp.task('release-if-changed', ['test'], function(callback) {
  didLastCommitChangeVersionNumber()
      .then(getNextVersionNumber)
      .then(updatePackageToNewVersion)
      .catch(function(err) {
        throw err;
      });
});

/**
 * Task to see if a the current package version is newer than
 * the latest published version on npm
 */
gulp.task('is-release-needed', function(callback) {
  var https = require('https');

  // Check the npm registry for the newest version
  https.get('https://registry.npmjs.org/google-closure-compiler',
      function(res) {
     var respData = '';
    res.on('data', function (data) {
      respData += data;
    });
    res.on('end', function() {
      var verData = JSON.parse(respData);

      var versions = [];
      for(var version in verData.versions) {
        versions.push(verData.versions[version]);
      }
      versions.sort(function(a, b) {
        var verA = new Semver(a.version);
        var verB = new Semver(b.version);
        return verA.compare(verB);
      });

      var latestPublishedVersion = new Semver(versions[version.length - 1].version);

      if (currentVer.compare(latestPublishedVersion) > 0) {
        callback('Release needed');
      } else {
        callback();
      }
    });
  });
});
