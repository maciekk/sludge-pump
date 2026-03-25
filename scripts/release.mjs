#!/usr/bin/env node
import { execSync } from "child_process";
import { readFileSync } from "fs";

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));

console.log(`Releasing version ${version}...`);

execSync("node esbuild.config.mjs production", { stdio: "inherit" });
execSync(`git tag ${version}`, { stdio: "inherit" });
execSync(`git push origin ${version}`, { stdio: "inherit" });
execSync(
  `gh release create ${version} main.js manifest.json --title "${version}" --notes ""`,
  { stdio: "inherit" }
);

console.log(`Done: https://github.com/maciekk/sludge-pump/releases/tag/${version}`);
