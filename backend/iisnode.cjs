'use strict';

import('./dist/server.js').catch((error) => {
  console.error('JobNest API failed to start.', error);
  process.exit(1);
});
