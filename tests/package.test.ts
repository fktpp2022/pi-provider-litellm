import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package gallery metadata", () => {
  it("does not expose the npm badge as gallery media", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).not.toContain("https://img.shields.io/npm/v/pi-provider-litellm.svg");
  });
});
