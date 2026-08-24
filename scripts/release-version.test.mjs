import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  chooseReleaseVersion,
  parseVersion,
  setWorkspaceVersion,
  updateCargoLock,
  updateCargoToml,
} from "./release-version.mjs";

test("uses the configured version when no semantic release tag exists", () => {
  assert.equal(chooseReleaseVersion("0.1.1", []), "0.1.1");
});

test("increments the patch component of the latest semantic release tag", () => {
  assert.equal(
    chooseReleaseVersion("0.1.1", ["wordsnap-v0.1.1", "wordsnap-v0.1.9", "wordsnap-v0.1.4"]),
    "0.1.10",
  );
});

test("uses a configured version that is newer than every release tag", () => {
  assert.equal(chooseReleaseVersion("0.2.0", ["wordsnap-v0.1.9"]), "0.2.0");
});

test("ignores legacy build tags and malformed versions", () => {
  assert.equal(
    chooseReleaseVersion("0.1.1", [
      "wordsnap-v0.1.1-build-15",
      "wordsnap-v0.1",
      "wordsnap-v01.1.2",
      "unrelated-v9.9.9",
    ]),
    "0.1.1",
  );
});

test("rejects versions outside the supported major.minor.patch format", () => {
  assert.throws(() => parseVersion("0.1"), /Invalid release version/);
  assert.throws(() => parseVersion("0.1.1-beta.1"), /Invalid release version/);
});

test("updates the package version in Cargo.toml without changing dependency versions", () => {
  const input = `[package]\nname = "wordsnap"\nversion = "0.1.1"\n\n[dependencies]\ntauri = { version = "2" }\n`;
  const expected = `[package]\nname = "wordsnap"\nversion = "0.1.2"\n\n[dependencies]\ntauri = { version = "2" }\n`;
  assert.equal(updateCargoToml(input, "0.1.2"), expected);
});

test("updates only the workspace package entry in Cargo.lock", () => {
  const input = `[[package]]\nname = "dependency"\nversion = "0.1.1"\n\n[[package]]\nname = "wordsnap"\nversion = "0.1.1"\n`;
  const expected = `[[package]]\nname = "dependency"\nversion = "0.1.1"\n\n[[package]]\nname = "wordsnap"\nversion = "0.1.2"\n`;
  assert.equal(updateCargoLock(input, "0.1.2"), expected);
});

test("sets every workspace version used by release builds", () => {
  const root = mkdtempSync(join(tmpdir(), "wordsnap-release-version-"));
  const tauriDirectory = join(root, "src-tauri");

  try {
    mkdirSync(tauriDirectory);
    writeFileSync(join(root, "package.json"), '{"name":"wordsnap","version":"0.1.1"}\n');
    writeFileSync(
      join(root, "package-lock.json"),
      '{"name":"wordsnap","version":"0.1.1","packages":{"":{"version":"0.1.1"}}}\n',
    );
    writeFileSync(join(tauriDirectory, "tauri.conf.json"), '{"version":"0.1.1"}\n');
    writeFileSync(
      join(tauriDirectory, "Cargo.toml"),
      '[package]\nname = "wordsnap"\nversion = "0.1.1"\n',
    );
    writeFileSync(
      join(tauriDirectory, "Cargo.lock"),
      '[[package]]\nname = "wordsnap"\nversion = "0.1.1"\n',
    );

    setWorkspaceVersion("0.1.2", root);

    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "0.1.2");
    assert.equal(
      JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages[""].version,
      "0.1.2",
    );
    assert.equal(
      JSON.parse(readFileSync(join(tauriDirectory, "tauri.conf.json"), "utf8")).version,
      "0.1.2",
    );
    assert.match(readFileSync(join(tauriDirectory, "Cargo.toml"), "utf8"), /version = "0\.1\.2"/);
    assert.match(readFileSync(join(tauriDirectory, "Cargo.lock"), "utf8"), /version = "0\.1\.2"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
