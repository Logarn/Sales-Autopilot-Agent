#!/usr/bin/env node

const fs = require("node:fs");
const dotenv = require("dotenv");

const envFile = process.argv[2] || ".env";
const requestedKeys = process.argv.slice(3);
const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

if (!fs.existsSync(envFile)) {
  process.exit(0);
}

let parsed;
try {
  parsed = dotenv.parse(fs.readFileSync(envFile));
} catch (error) {
  console.error(`Failed to parse dotenv file ${envFile}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const keys = requestedKeys.length ? requestedKeys : Object.keys(parsed);
for (const key of keys) {
  if (!keyPattern.test(key)) {
    console.error(`Refusing to export invalid dotenv key: ${key}`);
    process.exit(2);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, key)) {
    process.stdout.write(`export ${key}=${shellQuote(parsed[key])}\n`);
  }
}
