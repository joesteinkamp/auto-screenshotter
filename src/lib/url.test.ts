import { describe, expect, it } from "vitest";
import { hasSkippedExtension, isHttpUrl, normalizeUrl, sameOrigin, urlToSlug } from "./url";

describe("normalizeUrl", () => {
  it("strips fragments and lowercases host", () => {
    expect(normalizeUrl("https://Example.com/Foo#section")).toBe("https://example.com/Foo");
  });

  it("sorts query parameters", () => {
    expect(normalizeUrl("https://example.com/?b=2&a=1")).toBe("https://example.com/?a=1&b=2");
  });

  it("drops trailing slash except for root", () => {
    expect(normalizeUrl("https://example.com/foo/")).toBe("https://example.com/foo");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("https://example.com")).toBe(true);
  });
  it("rejects mailto/tel/javascript", () => {
    expect(isHttpUrl("mailto:a@b.com")).toBe(false);
    expect(isHttpUrl("tel:123")).toBe(false);
    expect(isHttpUrl("javascript:void(0)")).toBe(false);
  });
});

describe("sameOrigin", () => {
  it("matches same origin", () => {
    expect(sameOrigin("https://a.com/x", "https://a.com/y")).toBe(true);
  });
  it("rejects different origins", () => {
    expect(sameOrigin("https://a.com/x", "https://b.com/x")).toBe(false);
  });
});

describe("hasSkippedExtension", () => {
  it("detects pdf/zip/images", () => {
    expect(hasSkippedExtension("https://a.com/x.pdf")).toBe(true);
    expect(hasSkippedExtension("https://a.com/x.zip")).toBe(true);
    expect(hasSkippedExtension("https://a.com/x.png")).toBe(true);
  });
  it("ignores html/dirs", () => {
    expect(hasSkippedExtension("https://a.com/x.html")).toBe(false);
    expect(hasSkippedExtension("https://a.com/x/")).toBe(false);
  });
});

describe("urlToSlug", () => {
  it("slugifies paths", () => {
    expect(urlToSlug("https://example.com/Pricing/Plans")).toBe("pricing-plans");
  });
  it("maps root to 'home'", () => {
    expect(urlToSlug("https://example.com/")).toBe("home");
  });
});
