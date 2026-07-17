import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tempDirs: string[] = [];

function findBash() {
  if (process.platform !== "win32") return "bash";

  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ];
  const candidate = candidates.find((item) => existsSync(item));
  if (!candidate) {
    throw new Error("Git Bash is required to run lite deploy shell tests on Windows.");
  }
  return candidate;
}

function toBashPath(filePath: string) {
  if (process.platform !== "win32") return filePath;

  const resolved = path.resolve(filePath);
  const drive = resolved[0]?.toLowerCase();
  return `/${drive}${resolved.slice(2).replace(/\\/g, "/")}`;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    try {
      // The directory only contains test env files created by this suite.
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup should not hide the real assertion result.
    }
  }
});

describe("lite deployment env validation", () => {
  function runValidation(envFile: string) {
    return spawnSync(findBash(), ["deploy/lite/deploy-release.sh", "validation-test"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DEPLOY_VALIDATE_ONLY: "1",
        ENV_FILE: toBashPath(envFile),
        SERVICE_USER: "test-user",
      },
      encoding: "utf8",
    });
  }

  it("accepts systemd-style env values that are not shell-sourceable", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "diffriendtiate-lite-env-"));
    tempDirs.push(tempDir);
    const envFile = path.join(tempDir, ".env");

    writeFileSync(
      envFile,
      [
        "SMTP_HOST=smtp-relay.brevo.com",
        "AUTH_EMAIL_FROM=Diffriendtiate <noreply@example.com>",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runValidation(envFile);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Production auth check passed");
    expect(result.stdout).toContain("Deployment env validation completed");
  });

  it("requires a service-role key when Supabase Auth is configured", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "diffriendtiate-lite-env-"));
    tempDirs.push(tempDir);
    const envFile = path.join(tempDir, ".env");

    writeFileSync(
      envFile,
      [
        "VITE_SUPABASE_URL=https://example.supabase.co",
        "VITE_SUPABASE_ANON_KEY=anon-key",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runValidation(envFile);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing SUPABASE_SERVICE_ROLE_KEY");
  });

  it("accepts Supabase Auth env when the service-role key is present", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "diffriendtiate-lite-env-"));
    tempDirs.push(tempDir);
    const envFile = path.join(tempDir, ".env");

    writeFileSync(
      envFile,
      [
        "VITE_SUPABASE_URL=https://example.supabase.co",
        "VITE_SUPABASE_ANON_KEY=anon-key",
        "SUPABASE_SERVICE_ROLE_KEY=service-role-key",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runValidation(envFile);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Supabase Auth client and server admin env is configured");
    expect(result.stdout).toContain("Deployment env validation completed");
  });
});
