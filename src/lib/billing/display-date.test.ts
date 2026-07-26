import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBillingDate,
  formatBillingDeadline,
} from "@/lib/billing/display-date";

const DEADLINE = "2026-07-30T02:25:02.487Z";

test("el aviso de facturación hidrata con el mismo texto en UTC y Argentina", () => {
  const originalTimeZone = process.env.TZ;

  try {
    process.env.TZ = "UTC";
    const serverDeadline = formatBillingDeadline(DEADLINE);
    const serverDate = formatBillingDate(DEADLINE);

    process.env.TZ = "America/Argentina/Buenos_Aires";
    const clientDeadline = formatBillingDeadline(DEADLINE);
    const clientDate = formatBillingDate(DEADLINE);

    assert.equal(serverDeadline, clientDeadline);
    assert.equal(serverDate, clientDate);
    assert.equal(clientDeadline, "29/7, 23:25");
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
});
