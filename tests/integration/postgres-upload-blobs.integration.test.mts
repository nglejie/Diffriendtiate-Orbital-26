import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  apiRequest,
  createRoom,
  registerUser,
  uploadTextResource,
} from "../helpers/apiClient.mjs";
import { startTestApp } from "../helpers/testServer.mjs";

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Unable to allocate a test port."));
      });
    });
  });
}

function runDocker(args: string[]) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function waitForPostgres(databaseUrl: string) {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < 30_000) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for PostgreSQL.");
}

function dockerAvailable() {
  try {
    runDocker(["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())("PostgreSQL upload blob persistence", () => {
  const postgresUser = "diffriendtiate";
  const postgresPassword = "diffriendtiate_password";
  const postgresDb = "diffriendtiate";
  const containerName = `diffriendtiate-pg-upload-${process.pid}-${Date.now()}`;
  let app: Awaited<ReturnType<typeof startTestApp>> | null = null;

  beforeAll(async () => {
    const postgresPort = await getFreePort();
    const databaseUrl = `postgres://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDb}`;

    runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_USER=${postgresUser}`,
      "-e",
      `POSTGRES_PASSWORD=${postgresPassword}`,
      "-e",
      `POSTGRES_DB=${postgresDb}`,
      "-p",
      `127.0.0.1:${postgresPort}:5432`,
      "postgres:16-alpine",
    ]);

    await waitForPostgres(databaseUrl);

    app = await startTestApp({
      env: {
        DATABASE_URL: databaseUrl,
        DATABASE_SSL: "false",
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.stop();
    try {
      runDocker(["rm", "-f", containerName]);
    } catch {
      // The container may already be gone if Docker cleaned it up after failure.
    }
  });

  it("serves uploaded resources from PostgreSQL when local container storage is missing", async () => {
    expect(app).toBeTruthy();
    const owner = await registerUser(app!.baseUrl, { name: "Postgres Blob Owner" });
    const room = await createRoom(app!.baseUrl, owner.token, {
      name: "Postgres Blob Domain",
    });

    const upload = await uploadTextResource(
      app!.baseUrl,
      owner.token,
      room.id,
      "postgres-persisted-notes.txt",
      "Postgres-backed file bytes",
      "Reference",
    );
    const storageName = upload.resource.storageName;
    expect(storageName).toMatch(/\.txt$/);

    await fs.rm(path.join(process.cwd(), "apps/server/uploads", storageName), { force: true });

    const publicRead = await fetch(`${app!.baseUrl}${upload.resource.url}`);
    expect(publicRead.status).toBe(200);
    expect(await publicRead.text()).toBe("Postgres-backed file bytes");

    const apiRead = await fetch(`${app!.baseUrl}/api/resources/${upload.resource.id}/file`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(apiRead.status).toBe(200);
    expect(await apiRead.text()).toBe("Postgres-backed file bytes");

    const deleteResult = await apiRequest(app!.baseUrl, `/api/resources/${upload.resource.id}/permanent`, {
      method: "DELETE",
      token: owner.token,
    });
    expect(deleteResult.status).toBe(204);

    const deletedRead = await fetch(`${app!.baseUrl}${upload.resource.url}`);
    expect(deletedRead.status).toBe(404);
  }, 30_000);
});
