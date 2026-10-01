// Run with Node's built-in test runner (no dependencies) — see the README's "Tests" section.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  confirmationCodeFromPath,
  parseDayMonth,
  parseLongSpanishDate,
  resolveStayDates,
  parseGuestCount,
} = require("../airbnb_stay_parsing.js");

test("confirmationCodeFromPath reads the code from a /hosting/stay/ URL", () => {
  assert.equal(confirmationCodeFromPath("/hosting/stay/HMTEST1234"), "HMTEST1234");
  assert.equal(confirmationCodeFromPath("/hosting/stay/HMTEST1234/details"), "HMTEST1234");
  assert.equal(confirmationCodeFromPath("/hosting/messages/1000000484"), null);
});

test("parseDayMonth reads Airbnb's short dates, ignoring the weekday", () => {
  assert.deepEqual(parseDayMonth("mar, 27 oct"), { day: 27, month: 10 });
  assert.deepEqual(parseDayMonth("sáb, 3 ene"), { day: 3, month: 1 });
  assert.equal(parseDayMonth("2:00 p. m."), null);
});

test("parseLongSpanishDate reads the booking date, which carries the year", () => {
  assert.equal(parseLongSpanishDate("miércoles, 16 de septiembre de 2026"), "2026-09-16");
  assert.equal(parseLongSpanishDate("Booking date"), null);
});

test("resolveStayDates takes the year from the booking date", () => {
  assert.deepEqual(resolveStayDates("mar, 27 oct", "sáb, 31 oct", "2026-09-16"), {
    checkIn: "2026-10-27",
    checkOut: "2026-10-31",
  });
});

test("resolveStayDates rolls into next year when the stay starts before the booking date's month/day", () => {
  assert.deepEqual(resolveStayDates("mié, 20 ene", "dom, 24 ene", "2026-09-16"), {
    checkIn: "2027-01-20",
    checkOut: "2027-01-24",
  });
});

test("resolveStayDates handles a stay that crosses New Year", () => {
  assert.deepEqual(resolveStayDates("mar, 29 dic", "sáb, 3 ene", "2026-09-16"), {
    checkIn: "2026-12-29",
    checkOut: "2027-01-03",
  });
});

test("resolveStayDates allows a same-day booking", () => {
  assert.deepEqual(resolveStayDates("mié, 16 sep", "vie, 18 sep", "2026-09-16"), {
    checkIn: "2026-09-16",
    checkOut: "2026-09-18",
  });
});

test("resolveStayDates returns nulls for dates it can't read", () => {
  assert.deepEqual(resolveStayDates(null, "sáb, 31 oct", "2026-09-16"), { checkIn: null, checkOut: null });
  assert.deepEqual(resolveStayDates("mar, 27 oct", "sáb, 31 oct", null), { checkIn: null, checkOut: null });
});

test("parseGuestCount reads the page heading", () => {
  assert.equal(parseGuestCount("Grupo de 3 huéspedes de María Laura"), 3);
  assert.equal(parseGuestCount("Grupo de 3 huéspedes de María Laura"), 3);
  assert.equal(parseGuestCount("1 huésped"), 1);
  assert.equal(parseGuestCount("María Laura"), null);
});
