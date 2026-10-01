// Run with Node's built-in test runner (no dependencies) — see the README's "Tests" section.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReview, buildReviewedPayload } = require("../review_panel.js");

const validValues = {
  guest_name: "María Laura",
  guest_phone: "+591 75278095",
  check_in: "2026-12-12",
  check_out: "2026-12-15",
  guests: "2",
  total_price: "$ 270.400,00",
  currency: "ARS",
};

test("validateReview accepts a complete, consistent reservation", () => {
  assert.deepEqual(validateReview(validValues), []);
});

test("validateReview requires the guest name and both dates", () => {
  const errors = validateReview({ ...validValues, guest_name: "  ", check_in: "", check_out: "" });
  assert.deepEqual(errors, [
    "Falta el nombre del huésped.",
    "Falta la fecha de check-in.",
    "Falta la fecha de check-out.",
  ]);
});

test("validateReview rejects a check-out that is not after the check-in", () => {
  assert.deepEqual(validateReview({ ...validValues, check_out: "2026-12-12" }), [
    "El check-out tiene que ser posterior al check-in.",
  ]);
});

test("validateReview rejects a guest count that is not a positive whole number", () => {
  for (const guests of ["0", "-1", "dos", "1.5"]) {
    assert.deepEqual(validateReview({ ...validValues, guests }), [
      "La cantidad de huéspedes tiene que ser un número entero mayor a 0.",
    ]);
  }
  assert.deepEqual(validateReview({ ...validValues, guests: "" }), []);
});

test("validateReview rejects an email without an @", () => {
  assert.deepEqual(validateReview({ ...validValues, guest_email: "not-an-email" }), [
    "El email no parece válido.",
  ]);
});

const airbnbBase = {
  source: "airbnb",
  res_id: "1000000484",
  guest_name: "Mensajes",
  guest_email: null,
  guest_phone: "+591 75278095",
  check_in: "2025-12-12",
  check_out: "2025-12-15",
  guests: 2,
  total_price: "$ 270.400,00",
  currency: "ARS",
  status: null,
  unverified_fields: ["guest_name", "guest_phone", "guests", "check_in", "check_out", "total_price", "currency", "status"],
};
const airbnbShown = ["guest_name", "guest_phone", "check_in", "check_out", "guests", "total_price", "currency"];

test("buildReviewedPayload applies the operator's edits over the scraped payload", () => {
  const payload = buildReviewedPayload(
    airbnbBase,
    { ...validValues, guest_name: " María Laura ", check_in: "2026-12-12", check_out: "2026-12-15" },
    airbnbShown,
  );
  assert.equal(payload.source, "airbnb");
  assert.equal(payload.res_id, "1000000484");
  assert.equal(payload.guest_name, "María Laura");
  assert.equal(payload.check_in, "2026-12-12");
  assert.equal(payload.check_out, "2026-12-15");
  assert.equal(payload.guests, 2);
  assert.equal(payload.total_price, "$ 270.400,00");
});

test("buildReviewedPayload marks only fields left empty (and unshown ones still unverified) as unverified", () => {
  const payload = buildReviewedPayload(
    airbnbBase,
    { ...validValues, guest_phone: "", total_price: "  " },
    airbnbShown,
  );
  assert.equal(payload.guest_phone, null);
  assert.equal(payload.total_price, null);
  assert.deepEqual([...payload.unverified_fields].sort(), ["guest_phone", "status", "total_price"]);
});

test("buildReviewedPayload turns an empty guest count into null", () => {
  const payload = buildReviewedPayload(airbnbBase, { ...validValues, guests: "" }, airbnbShown);
  assert.equal(payload.guests, null);
  assert.ok(payload.unverified_fields.includes("guests"));
});

test("buildReviewedPayload leaves fields that were not shown untouched", () => {
  const payload = buildReviewedPayload(airbnbBase, validValues, airbnbShown);
  assert.equal(payload.guest_email, null);
  assert.equal(payload.status, null);
});
