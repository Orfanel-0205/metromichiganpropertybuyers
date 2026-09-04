// backend/tests/run-all.js
// Runs every test file in this directory. Kept as a script rather than a bare
// `node --test` so `npm test` works the same way on every Node 20+ machine.

const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn(
    process.execPath,
    ['--test', path.join(__dirname)],
    { stdio: 'inherit' }
);

child.on('exit', (code) => process.exit(code ?? 1));
