'use strict';

/* Vercel entry point.

   Vercel routes every unmatched path into this function, so the static site is
   served from here too rather than through a second mechanism. That matters
   because /api/stream has to relay a large file and Vercel rewrites would strip
   the Content-Disposition header the browser needs to name the download.

   The handler in ../server.js is shared verbatim with the local `node server.js`
   path, so the two hosts cannot drift apart. This file only sets the two things
   that differ: where the web folder lives, and the timeout (the relay streams
   slower than the default 10s allowance on large files). */

process.env.WEB_ROOT = require('path').join(__dirname, '..');

const handler = require('../server.js');

module.exports = handler;

// Downloads are throttled on purpose -- see the relay in server.js -- so a 60s
// ceiling is generous for a 4K file while still failing loudly rather than
// hanging a function until Vercel kills it at 5 minutes.
module.exports.maxDuration = 60;
