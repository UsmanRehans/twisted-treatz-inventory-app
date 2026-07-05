// ─── Email template HTML escaping ───────────────────────────────────
// Admin-entered strings (product names, categories, member names) must
// arrive in the rendered email HTML escaped, never as live markup.

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  lowStockEmailHtml,
  passwordResetEmailHtml,
} from "../src/services/emailTemplates.js";

const xssName = `<img src=x onerror=alert(1)>Gummy "Bears" & Co`;
const xssNameEscaped =
  "&lt;img src=x onerror=alert(1)&gt;Gummy &quot;Bears&quot; &amp; Co";

function productWith(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "Candy Corn Bulk",
    category: "Candy Corn",
    currentQty: 4,
    alertThreshold: 10,
    ...overrides,
  } as {
    id: number;
    name: string;
    category: string;
    currentQty: number;
    alertThreshold: number;
  };
}

const removalInfo = {
  memberName: "Jess",
  qty: 3,
  removedAt: new Date("2026-07-05T15:00:00Z"),
};

describe("escapeHtml", () => {
  it("escapes all HTML metacharacters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Caramel Chews 5lb")).toBe("Caramel Chews 5lb");
  });
});

describe("lowStockEmailHtml escaping", () => {
  it("escapes a product name containing HTML metacharacters", () => {
    const html = lowStockEmailHtml(productWith({ name: xssName }), removalInfo, [
      productWith({ name: xssName }),
    ]);
    expect(html).not.toContain(xssName);
    expect(html).not.toContain("<img");
    expect(html).toContain(xssNameEscaped);
  });

  it("escapes the category", () => {
    const product = productWith({ category: `<script>alert(1)</script>` });
    const html = lowStockEmailHtml(product, removalInfo, [product]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes the member name", () => {
    const html = lowStockEmailHtml(
      productWith(),
      { ...removalInfo, memberName: `<b onmouseover=alert(1)>Jess</b>` },
      [],
    );
    expect(html).not.toContain("<b onmouseover");
    expect(html).toContain("&lt;b onmouseover=alert(1)&gt;Jess&lt;/b&gt;");
  });

  it("escapes names in the other-low-stock table rows", () => {
    const trigger = productWith();
    const other = productWith({ id: 2, name: xssName });
    const html = lowStockEmailHtml(trigger, removalInfo, [trigger, other]);
    expect(html).not.toContain(xssName);
    expect(html).toContain(xssNameEscaped);
  });

  it("still renders normal names verbatim", () => {
    const html = lowStockEmailHtml(productWith(), removalInfo, []);
    expect(html).toContain("Candy Corn Bulk");
    expect(html).toContain("Jess");
  });
});

describe("passwordResetEmailHtml escaping", () => {
  it("escapes the reset link when interpolated into the href", () => {
    const html = passwordResetEmailHtml(
      "https://twistedtreatz.com/reset?token=abc&sig=def",
    );
    expect(html).toContain("token=abc&amp;sig=def");
    expect(html).not.toContain("token=abc&sig=def");
  });
});
