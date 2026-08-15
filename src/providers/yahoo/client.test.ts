import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureYahooApi, createHttpYahooApi } from "./client";

describe("createHttpYahooApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a bearer token and hits the expected Yahoo endpoints", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      );
    const api = createHttpYahooApi("test-token");

    await api.getLeague("423.l.11184");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://fantasysports.yahooapis.com/fantasy/v2/league/423.l.11184;out=settings,standings?format=json",
      { headers: { authorization: "Bearer test-token", accept: "application/json" } },
    );

    await api.getScoreboard("423.l.11184", 5);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://fantasysports.yahooapis.com/fantasy/v2/league/423.l.11184/scoreboard;week=5?format=json",
      { headers: { authorization: "Bearer test-token", accept: "application/json" } },
    );

    await api.getRoster("423.l.11184.t.1", 5);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://fantasysports.yahooapis.com/fantasy/v2/team/423.l.11184.t.1/roster;week=5/players;out=stats?format=json",
      { headers: { authorization: "Bearer test-token", accept: "application/json" } },
    );
  });

  it("retries on 429/5xx and throws after repeated failure", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => Promise.resolve(new Response("rate limited", { status: 429 })));
    const api = createHttpYahooApi("test-token");

    const promise = api.getLeague("423.l.11184").catch((e) => e);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});

describe("createFixtureYahooApi", () => {
  it("reads recorded payloads from disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yahoo-fixture-"));
    await fs.writeFile(path.join(dir, "league.json"), JSON.stringify({ name: "Test League" }));
    await fs.writeFile(path.join(dir, "scoreboard-5.json"), JSON.stringify({ week: "5" }));

    const api = createFixtureYahooApi(dir);
    expect(await api.getLeague("423.l.11184")).toEqual({ name: "Test League" });
    expect(await api.getScoreboard("423.l.11184", 5)).toEqual({ week: "5" });
    await expect(api.getUserLeagues()).rejects.toThrow("not recorded in fixtures");
  });
});
