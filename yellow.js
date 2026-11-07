#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { run } = require("./compiler.js");

function runFile(filename) {
    const source = fs.readFileSync(filename, "utf8");
    return run(source);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 1) {
        console.error("Usage: node yellow.js [script.yellow]");
        process.exitCode = 1;
    } else {
        const filename = path.resolve(process.cwd(), args[0] ?? "script.yellow");
        runFile(filename);
    }
}

module.exports = { runFile };
