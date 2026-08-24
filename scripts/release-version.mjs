#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG_PREFIX = "wordsnap-v";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG_PATTERN = /^wordsnap-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, "..");

export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid release version: ${value}`);
  }

  return match.slice(1).map(Number);
}

function formatVersion(version) {
  return version.join(".");
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

export function chooseReleaseVersion(configuredVersion, tagNames) {
  const configured = parseVersion(configuredVersion);
  const taggedVersions = tagNames.flatMap((tagName) => {
    const match = TAG_PATTERN.exec(tagName.trim());
    return match ? [match.slice(1).map(Number)] : [];
  });

  if (taggedVersions.length === 0) {
    return formatVersion(configured);
  }

  const latest = taggedVersions.reduce((current, candidate) =>
    compareVersions(candidate, current) > 0 ? candidate : current,
  );

  if (compareVersions(configured, latest) > 0) {
    return formatVersion(configured);
  }

  return formatVersion([latest[0], latest[1], latest[2] + 1]);
}

export function updateCargoToml(content, version) {
  parseVersion(version);
  const pattern = /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m;
  if (!pattern.test(content)) {
    throw new Error("Could not find the package version in Cargo.toml");
  }
  return content.replace(pattern, (_match, start, end) => `${start}${version}${end}`);
}

export function updateCargoLock(content, version) {
  parseVersion(version);
  const pattern = /(\[\[package\]\]\r?\nname = "wordsnap"\r?\nversion = ")[^"]+(")/;
  if (!pattern.test(content)) {
    throw new Error("Could not find the wordsnap package version in Cargo.lock");
  }
  return content.replace(pattern, (_match, start, end) => `${start}${version}${end}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function setWorkspaceVersion(version, root = DEFAULT_ROOT) {
  parseVersion(version);

  const packageJsonPath = resolve(root, "package.json");
  const packageLockPath = resolve(root, "package-lock.json");
  const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");
  const cargoTomlPath = resolve(root, "src-tauri/Cargo.toml");
  const cargoLockPath = resolve(root, "src-tauri/Cargo.lock");

  const packageJson = readJson(packageJsonPath);
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson);

  const packageLock = readJson(packageLockPath);
  packageLock.version = version;
  packageLock.packages[""].version = version;
  writeJson(packageLockPath, packageLock);

  const tauriConfig = readJson(tauriConfigPath);
  tauriConfig.version = version;
  writeJson(tauriConfigPath, tauriConfig);

  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  writeFileSync(cargoTomlPath, updateCargoToml(cargoToml, version));

  const cargoLock = readFileSync(cargoLockPath, "utf8");
  writeFileSync(cargoLockPath, updateCargoLock(cargoLock, version));
}

function configuredVersion(root) {
  return readJson(resolve(root, "src-tauri/tauri.conf.json")).version;
}

function repositoryTags(root) {
  return execFileSync("git", ["tag", "--list", `${TAG_PREFIX}*`], {
    cwd: root,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

function run() {
  const [command, argument] = process.argv.slice(2);

  if (command === "next") {
    console.log(chooseReleaseVersion(configuredVersion(DEFAULT_ROOT), repositoryTags(DEFAULT_ROOT)));
    return;
  }

  if (command === "set" && argument) {
    setWorkspaceVersion(argument);
    console.log(`Prepared workspace version ${argument}`);
    return;
  }

  throw new Error("Usage: release-version.mjs next | set <major.minor.patch>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
