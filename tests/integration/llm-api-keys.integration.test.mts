import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiRequest, registerUser } from "../helpers/apiClient.mts";
import { startMockChatbot, startTestApp } from "../helpers/testServer.mts";

const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("LLM API key settings API", () => {
  let app;
  let chatbot;
  let owner;

  beforeAll(async () => {
    chatbot = await startMockChatbot();
    app = await startTestApp({
      chatbotUrl: chatbot.url,
      env: {
        LLM_API_KEY_ENCRYPTION_KEY: encryptionKey,
      },
    });
    owner = await registerUser(app.baseUrl, { name: "BYOK Owner" });
  });

  afterAll(async () => {
    await app?.stop();
    await chatbot?.stop();
  });

  it("lists the supported provider catalog without returning secrets", async () => {
    const response = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      token: owner.token,
    });

    expect(response.status).toBe(200);
    expect(response.payload.encryptionAvailable).toBe(true);
    expect(response.payload.providerCatalogAvailable).toBe(true);
    expect(response.payload.providers.map((provider) => provider.providerName)).toContain("OpenAI");
    expect(response.payload.providers.find((provider) => provider.id === "openai").models).toContain(
      "openai/gpt-4o-mini",
    );
    expect(response.payload.keys).toEqual([]);
  });

  it("encrypts saved keys, redacts responses, and reuses credentials for additional models", async () => {
    const secret = "sk-test-openai-secret-1234567890";
    const save = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "openai",
        label: "Seminar OpenAI",
        model: "openai/gpt-4o-mini",
        apiKey: secret,
      },
    });

    expect(save.status).toBe(201);
    expect(save.payload.key).toMatchObject({
      providerId: "openai",
      providerName: "OpenAI",
      label: "Seminar OpenAI",
      model: "openai/gpt-4o-mini",
    });
    expect(JSON.stringify(save.payload)).not.toContain(secret);

    const rawDb = await fs.readFile(path.join(app.dataDir, "db.json"), "utf8");
    expect(rawDb).not.toContain(secret);
    expect(rawDb).toContain("encryptedApiKey");
    expect(rawDb).toContain("v1:");

    const duplicate = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "openai",
        model: "openai/gpt-4o-mini",
        apiKey: secret,
      },
    });
    expect(duplicate.status).toBe(409);

    const reusedCredential = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "openai",
        model: "openai/gpt-4o",
        apiKey: "",
        reuseKeyId: save.payload.key.id,
      },
    });
    expect(reusedCredential.status).toBe(201);
    expect(reusedCredential.payload.key).toMatchObject({
      providerId: "openai",
      model: "openai/gpt-4o",
    });
    expect(JSON.stringify(reusedCredential.payload)).not.toContain(secret);

    const duplicateModel = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "openai",
        model: "openai/gpt-4o",
        apiKey: "",
        reuseKeyId: save.payload.key.id,
      },
    });
    expect(duplicateModel.status).toBe(409);

    const cleanup = await apiRequest(app.baseUrl, `/api/auth/llm-api-keys/${reusedCredential.payload.key.id}`, {
      method: "DELETE",
      token: owner.token,
    });
    expect(cleanup.status).toBe(200);
  });

  it("validates provider and secret shape before saving", async () => {
    const badProvider = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "unsupported-provider",
        model: "unsupported/model",
        apiKey: "secret-value",
      },
    });
    expect(badProvider.status).toBe(400);

    const blankKey = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "anthropic",
        model: "anthropic/claude-3-5-haiku-latest",
        apiKey: "",
      },
    });
    expect(blankKey.status).toBe(400);

    const badModel = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: owner.token,
      body: {
        providerId: "anthropic",
        model: "anthropic/not-in-catalog",
        apiKey: "secret-value",
      },
    });
    expect(badModel.status).toBe(400);
  });

  it("keeps each member's saved provider keys private to that account", async () => {
    const other = await registerUser(app.baseUrl, { name: "BYOK Other" });
    const ownerKeys = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      token: owner.token,
    });
    const keyId = ownerKeys.payload.keys[0].id;

    const otherKeys = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      token: other.token,
    });
    expect(otherKeys.status).toBe(200);
    expect(otherKeys.payload.keys).toEqual([]);

    const otherDelete = await apiRequest(app.baseUrl, `/api/auth/llm-api-keys/${keyId}`, {
      method: "DELETE",
      token: other.token,
    });
    expect(otherDelete.status).toBe(404);

    const ownerDelete = await apiRequest(app.baseUrl, `/api/auth/llm-api-keys/${keyId}`, {
      method: "DELETE",
      token: owner.token,
    });
    expect(ownerDelete.status).toBe(200);
    expect(ownerDelete.payload.keys).toEqual([]);
  });
});

describe("LLM API key provider catalog outage", () => {
  let app;
  let user;

  beforeAll(async () => {
    app = await startTestApp({
      env: {
        LLM_API_KEY_ENCRYPTION_KEY: encryptionKey,
      },
    });
    user = await registerUser(app.baseUrl, { name: "Catalog Outage User" });
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("keeps settings readable but blocks new keys when LiteLLM discovery is unavailable", async () => {
    const catalog = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      token: user.token,
    });
    expect(catalog.status).toBe(200);
    expect(catalog.payload.providerCatalogAvailable).toBe(false);
    expect(catalog.payload.providers).toEqual([]);

    const save = await apiRequest(app.baseUrl, "/api/auth/llm-api-keys", {
      method: "POST",
      token: user.token,
      body: {
        providerId: "openai",
        model: "openai/gpt-4o-mini",
        apiKey: "sk-test-openai-secret-1234567890",
      },
    });
    expect(save.status).toBe(503);
  });
});
