import { describe, expect, it } from "vitest";
import { resolveYourRosterId } from "./resolve-roster";

const teams = [
  { providerRosterId: "1", providerUserId: "u1" },
  { providerRosterId: "2", providerUserId: "u2" },
  { providerRosterId: "3", providerUserId: null },
];

describe("resolveYourRosterId", () => {
  it("matches the roster whose owner is the given user", () => {
    expect(resolveYourRosterId(teams, "u2")).toBe("2");
  });

  it("returns null when no roster matches", () => {
    expect(resolveYourRosterId(teams, "someone-else")).toBeNull();
  });

  it("returns null without throwing when userId is missing", () => {
    expect(resolveYourRosterId(teams, undefined)).toBeNull();
    expect(resolveYourRosterId(teams, null)).toBeNull();
  });

  it("never matches a roster with no owner on record", () => {
    // A null providerUserId must not accidentally match a null/undefined userId.
    expect(resolveYourRosterId(teams, null)).toBeNull();
    expect(resolveYourRosterId([{ providerRosterId: "9", providerUserId: null }], "u1")).toBeNull();
  });
});
