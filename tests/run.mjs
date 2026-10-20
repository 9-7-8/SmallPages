#!/usr/bin/env node
/* Runs the suites. Starts the one static server they all point at, and the
   caption stub for the four that need it, so nothing has to be started by
   hand and nothing is left running afterwards.

       node tests/run.mjs              every suite
       node tests/run.mjs rain noise   the ones whose name contains either

   A suite is a file that prints a PASS/FAIL line per check and exits non-zero
   if any failed; this only starts them, reads the exit code, and adds up. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { PORT, REPO, TESTS } from "./lib/env.mjs";

const STUB_PORT = 8098;
const RELAY_PORT = 8787;
const WANTS_STUB = /^test-caps-(diag|fetch|relay|slow)\.mjs$/;
const WANTS_RELAY = /^test-caps-relay\.mjs$/;

const asked = process.argv.slice(2);
const suites = fs.readdirSync(TESTS)
  .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
  .filter((f) => !asked.length || asked.some((want) => f.includes(want)))
  .sort();

if (!suites.length) {
  console.error(asked.length ? `nothing matches ${asked.join(", ")}` : "no suites here");
  process.exit(1);
}

const free = (port) => new Promise((settle) => {
  const probe = net.connect(port, "127.0.0.1");
  probe.on("connect", () => { probe.destroy(); settle(false); });
  probe.on("error", () => settle(true));
});

async function serve(port, args, cwd) {
  if (!await free(port)) {
    console.log(`  (something already answers on ${port} — using it)`);
    return null;
  }
  const child = spawn("python3", args, { cwd, stdio: "ignore", detached: true });
  for (let tries = 0; tries < 100; tries++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!await free(port)) return child;
  }
  throw new Error(`nothing came up on ${port}`);
}

const run = (file) => new Promise((settle) => {
  const child = spawn(process.execPath, [path.join(TESTS, file)],
    { cwd: TESTS, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stdout.on("data", (d) => { said += d; process.stdout.write(d); });
  child.stderr.on("data", (d) => { said += d; process.stderr.write(d); });
  child.on("close", (code) => settle({ code, said }));
});

const site = await serve(PORT, ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], REPO);
const stub = suites.some((f) => WANTS_STUB.test(f))
  ? await serve(STUB_PORT, [path.join(TESTS, "stubs", "stub-yt.py")], TESTS)
  : null;
const relay = suites.some((f) => WANTS_RELAY.test(f))
  ? await serve(RELAY_PORT, [path.join(TESTS, "stubs", "stub-relay.py")], TESTS)
  : null;

const over = [];
try {
  for (const file of suites) {
    console.log(`\n── ${file} ${"─".repeat(Math.max(0, 60 - file.length))}`);
    const { code, said } = await run(file);
    const passed = (said.match(/^ {0,2}(PASS|ok) /gm) || []).length;
    const failed = (said.match(/^ {0,2}FAIL /gm) || []).length;
    const skipped = /^SKIP /m.test(said);
    over.push({ file, code, passed, failed, skipped });
  }
} finally {
  for (const child of [site, stub, relay]) {
    if (child) { try { process.kill(-child.pid); } catch { child.kill(); } }
  }
}

console.log("\n" + "=".repeat(64));
let bad = 0;
let skipped = 0;
for (const r of over) {
  const sick = !r.skipped && (r.code !== 0 || r.failed > 0);
  if (sick) bad++;
  if (r.skipped) skipped++;
  const mark = r.skipped ? "skip" : sick ? "FAIL" : "ok  ";
  console.log(`${mark}  ${r.file.padEnd(26)} `
    + (r.skipped ? "no fixture for it here" : `${r.passed} passing`
        + (r.failed ? `, ${r.failed} failing` : "")
        + (r.code !== 0 && !r.failed ? `  (exit ${r.code})` : "")));
}
const checks = over.reduce((n, r) => n + r.passed, 0);
console.log(`\n${over.length} suites, ${checks} checks, ${bad} unhappy`
  + (skipped ? `, ${skipped} skipped for want of a fixture` : ""));
process.exit(bad ? 1 : 0);
