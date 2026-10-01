// Operator review step, shared by both content scripts (loaded before them — see
// manifest.json). Scraping is best-effort (Airbnb's guest-name guess has matched a page
// heading before, and its check-in/check-out year is always inferred), and sending a
// reservation to La Brisa is what triggers the guest's check-in link (email for Booking.com,
// WhatsApp when there's a phone). So nothing is sent until the operator has seen every
// picked-up field, corrected it if needed, and confirmed.
//
// validateReview() and buildReviewedPayload() are plain functions, exported for Node's test
// runner (tests/review_panel.test.js); openReviewPanel() is the DOM part.
(function (root) {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === "";
  }

  // Returns a list of Spanish error messages; empty means the values can be sent.
  function validateReview(values) {
    const errors = [];
    if (isBlank(values.guest_name)) errors.push("Falta el nombre del huésped.");

    const checkIn = String(values.check_in || "").trim();
    const checkOut = String(values.check_out || "").trim();
    if (!ISO_DATE.test(checkIn)) errors.push("Falta la fecha de check-in.");
    if (!ISO_DATE.test(checkOut)) errors.push("Falta la fecha de check-out.");
    // ISO dates compare correctly as strings.
    if (ISO_DATE.test(checkIn) && ISO_DATE.test(checkOut) && checkOut <= checkIn) {
      errors.push("El check-out tiene que ser posterior al check-in.");
    }

    if (!isBlank(values.guests) && !/^[1-9]\d*$/.test(String(values.guests).trim())) {
      errors.push("La cantidad de huéspedes tiene que ser un número entero mayor a 0.");
    }

    if (!isBlank(values.guest_email) && !String(values.guest_email).includes("@")) {
      errors.push("El email no parece válido.");
    }

    return errors;
  }

  // Applies the operator's edited values (all strings, as read from the inputs) over the
  // scraped payload. A shown field the operator confirmed with a value counts as verified; one
  // left empty is sent as null and stays in unverified_fields. Fields that weren't shown
  // (e.g. "status", which neither page exposes) keep whatever the scraper said.
  function buildReviewedPayload(basePayload, values, shownKeys) {
    const payload = { ...basePayload };
    const emptyShownKeys = [];

    for (const key of shownKeys) {
      const raw = values[key];
      if (isBlank(raw)) {
        payload[key] = null;
        emptyShownKeys.push(key);
      } else if (key === "guests") {
        payload[key] = parseInt(String(raw).trim(), 10);
      } else {
        payload[key] = String(raw).trim();
      }
    }

    const stillUnverified = (basePayload.unverified_fields || []).filter((key) => !shownKeys.includes(key));
    payload.unverified_fields = [...new Set([...stillUnverified, ...emptyShownKeys])];
    return payload;
  }

  // Shows the review panel over the page. `fields` is a list of
  // { key, label, type: "text" | "date" | "number" | "email", value }; `describeAction(values)`
  // returns the line telling the operator what confirming will do (it may depend on the
  // edited values, e.g. whether a phone is still filled in). Calls onConfirm(payload) with
  // the reviewed payload, or nothing at all if the operator cancels.
  function openReviewPanel({ title, basePayload, fields, describeAction, onConfirm }) {
    document.querySelectorAll(".la-brisa-review").forEach((el) => el.remove());

    const overlay = document.createElement("div");
    overlay.className = "la-brisa-review";

    const panel = document.createElement("form");
    panel.className = "la-brisa-review__panel";
    panel.noValidate = true;
    overlay.appendChild(panel);

    const heading = document.createElement("h2");
    heading.className = "la-brisa-review__title";
    heading.textContent = title;
    panel.appendChild(heading);

    const intro = document.createElement("p");
    intro.className = "la-brisa-review__intro";
    intro.textContent = "Revisá lo que levantó la extensión y corregí lo que haga falta antes de enviarlo.";
    panel.appendChild(intro);

    const inputs = {};
    for (const field of fields) {
      const row = document.createElement("label");
      row.className = "la-brisa-review__field";

      const label = document.createElement("span");
      label.className = "la-brisa-review__label";
      label.textContent = field.label;
      row.appendChild(label);

      const input = document.createElement("input");
      input.className = "la-brisa-review__input";
      input.type = field.type || "text";
      input.value = field.value === null || field.value === undefined ? "" : String(field.value);
      if (field.type === "number") input.min = "1";
      row.appendChild(input);

      if (isBlank(field.value)) {
        row.classList.add("la-brisa-review__field--missing");
        const missing = document.createElement("span");
        missing.className = "la-brisa-review__missing";
        missing.textContent = "No se encontró en la página";
        row.appendChild(missing);
      }

      inputs[field.key] = input;
      panel.appendChild(row);
    }

    const errorList = document.createElement("ul");
    errorList.className = "la-brisa-review__errors";
    panel.appendChild(errorList);

    const actionNote = document.createElement("p");
    actionNote.className = "la-brisa-review__action";
    panel.appendChild(actionNote);

    const buttons = document.createElement("div");
    buttons.className = "la-brisa-review__buttons";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "la-brisa-review__cancel";
    cancelButton.textContent = "Cancelar";
    const confirmButton = document.createElement("button");
    confirmButton.type = "submit";
    confirmButton.className = "la-brisa-review__confirm";
    confirmButton.textContent = "Confirmar y enviar";
    buttons.appendChild(cancelButton);
    buttons.appendChild(confirmButton);
    panel.appendChild(buttons);

    function currentValues() {
      const values = {};
      for (const [key, input] of Object.entries(inputs)) values[key] = input.value;
      return values;
    }

    function refresh() {
      const values = currentValues();
      const errors = validateReview(values);
      errorList.replaceChildren(
        ...errors.map((message) => {
          const item = document.createElement("li");
          item.textContent = message;
          return item;
        }),
      );
      confirmButton.disabled = errors.length > 0;
      actionNote.textContent = describeAction(values);
    }

    function close() {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }

    panel.addEventListener("input", refresh);
    cancelButton.addEventListener("click", close);
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = currentValues();
      if (validateReview(values).length > 0) return;
      close();
      onConfirm(buildReviewedPayload(basePayload, values, Object.keys(inputs)));
    });
    document.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    refresh();
    const firstInput = Object.values(inputs)[0];
    if (firstInput) firstInput.focus();
  }

  const api = { validateReview, buildReviewedPayload, openReviewPanel };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.LaBrisaReview = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
