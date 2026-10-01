// Airbnb's reservation page (/hosting/stay/<confirmation code>) — the page reached from
// Airbnb's own host UI ("Hoy" → a reservation), as opposed to the messages thread reached from
// Airbnb's email (content_script_airbnb.js). Both feed the same import; this page keys the
// reservation by its confirmation code, and the API links a stay imported from both pages by
// matching dates (see channel-import.service.ts).
//
// Calibrated against a real capture of this page:
// - Guest's full name: first entry under "¿Quién viene?" (data-testid hosting-details-whos-coming).
// - Guest count: the page heading, "Grupo de 3 huéspedes de <name>".
// - Check-in/Check-out: "mar, 27 oct" next to those labels — no year; the year comes from the
//   "Booking date" row, which has one (see airbnb_stay_parsing.js).
// - Price: data-testid hosting-details-payment-info, "$ 270.400,00".
// - Phone: a "Número de teléfono de <name>" row, revealed by clicking "Administrá la reserva".
//
// Airbnb's host UI is a single-page app: going from "Hoy" to a reservation changes the URL
// without a page load, so this script is injected on every /hosting/ page (see manifest.json)
// and watches the URL, showing its button only while on a /hosting/stay/ page.
(function () {
  const parse = globalThis.LaBrisaAirbnbStay;

  function ownText(el) {
    let text = "";
    for (const child of el.childNodes) {
      if (child.nodeType === 3) text += child.textContent;
    }
    return text.trim();
  }

  function normalizeText(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }

  // Unicode bidi-embedding marks Airbnb wraps phone numbers in — not part of the number.
  function stripBidiMarks(s) {
    return s.replace(/[‎‏‪-‮⁦-⁩]/g, "").trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitUntil(predicate, { intervalMs = 200, timeoutMs = 6000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await delay(intervalMs);
    }
    return predicate();
  }

  // The first element whose own text matches `predicate`.
  function findByOwnText(predicate) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && predicate(normalizeText(text))) return node;
      node = walker.nextNode();
    }
    return null;
  }

  function hasStayDetails() {
    return Boolean(document.querySelector('[data-testid="hosting-details-whos-coming"]'));
  }

  function findPhoneRowTitle() {
    return findByOwnText((text) => text.startsWith("numero de telefono de"));
  }

  // The phone only appears after clicking "Administrá la reserva". Skipped when it's already
  // visible; best-effort otherwise — if it never shows, the field stays empty and the review
  // panel asks the operator for it.
  async function revealPhone() {
    if (findPhoneRowTitle()) return;
    const row = findByOwnText((text) => text.includes("administra la reserva"));
    if (!row) return;
    (row.closest('button, [role="button"], a') || row).click();
    await waitUntil(() => Boolean(findPhoneRowTitle()));
  }

  // The first guest row holds the name in its own element, sometimes followed by a profile
  // line in another one ("Maika Diaz" + "Intereses: animales") — so take the row's first piece
  // of text, not the whole row's text.
  function firstOwnText(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      const text = ownText(node).replace(/\s+/g, " ").trim();
      if (text) return text;
      node = walker.nextNode();
    }
    return "";
  }

  function extractGuestName() {
    const firstGuest = document.querySelector('[data-testid="hosting-details-whos-coming"] li');
    const fromList = firstGuest ? firstOwnText(firstGuest) : "";
    if (fromList && !/^\+?\d/.test(fromList)) return fromList;

    const heading = document.querySelector("h1");
    const match = heading && heading.textContent.match(/huésped(?:es)?\s+de\s+(.+)$/i);
    return match ? match[1].trim() : null;
  }

  function textNextToLabel(label) {
    const labelEl = findByOwnText((text) => text === label);
    return labelEl && labelEl.nextElementSibling ? labelEl.nextElementSibling.textContent.trim() : null;
  }

  function extractBookingDate() {
    const title =
      document.querySelector('[id$="booking-date-row-title"]') ||
      findByOwnText((text) => text === "booking date" || text === "fecha de reserva" || text === "fecha de la reserva");
    return title && title.nextElementSibling ? parse.parseLongSpanishDate(title.nextElementSibling.textContent) : null;
  }

  function extractTotalPrice() {
    const container = document.querySelector('[data-testid="hosting-details-payment-info"]');
    const match = container && container.textContent.match(/\$\s*[\d.,]+/);
    return match ? match[0].replace(/\s+/g, " ").trim() : null;
  }

  function extractGuestPhone() {
    const title = findPhoneRowTitle();
    return title && title.nextElementSibling ? stripBidiMarks(title.nextElementSibling.textContent) || null : null;
  }

  function extractReservationFields() {
    const heading = document.querySelector("h1");
    const { checkIn, checkOut } = parse.resolveStayDates(
      textNextToLabel("check-in"),
      textNextToLabel("check-out"),
      extractBookingDate(),
    );
    return {
      guestName: extractGuestName(),
      guests: parse.parseGuestCount(heading ? heading.textContent : null),
      checkIn,
      checkOut,
      totalPrice: extractTotalPrice(),
      guestPhone: extractGuestPhone(),
    };
  }

  // ---------------------------------------------------------------------
  // UI — same classnames as the other content scripts (styles.css is shared).
  // ---------------------------------------------------------------------
  function showToast(message, kind = "info") {
    document.querySelectorAll(".la-brisa-toast").forEach((el) => el.remove());
    const toast = document.createElement("div");
    toast.className = `la-brisa-toast la-brisa-toast--${kind}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function reportExtensionError(operation, { resId, message, detail } = {}) {
    chrome.runtime.sendMessage({
      type: "labrisa:log-error",
      payload: {
        source: "airbnb",
        resId: resId || null,
        operation,
        message,
        detail: detail || null,
        url: window.location.href,
      },
    });
  }

  // After sending: the message with the check-in link (same text the messages page pastes into
  // the chat), already copied, plus a button to copy it again — this page has no chat box.
  function showResultPanel(message, created) {
    document.querySelectorAll(".la-brisa-panel").forEach((el) => el.remove());
    const panel = document.createElement("div");
    panel.className = "la-brisa-panel";

    const hint = document.createElement("p");
    hint.className = "la-brisa-panel__hint";
    hint.textContent = created
      ? "¡Reserva creada! El mensaje con el link de check-in ya está copiado — pegalo en el chat con el huésped si querés mandárselo por Airbnb."
      : "Reserva actualizada. El mensaje con el link de check-in ya está copiado, por si lo necesitás.";
    panel.appendChild(hint);

    const textarea = document.createElement("textarea");
    textarea.className = "la-brisa-panel__textarea";
    textarea.readOnly = true;
    textarea.value = message;
    panel.appendChild(textarea);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "la-brisa-panel__close";
    copyButton.textContent = "Copiar";
    copyButton.addEventListener("click", () => {
      navigator.clipboard.writeText(message).then(
        () => showToast("Mensaje copiado.", "success"),
        () => {
          textarea.select();
          showToast("No se pudo copiar automáticamente — apretá Ctrl+C.", "error");
        },
      );
    });
    panel.appendChild(copyButton);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "la-brisa-panel__close";
    closeButton.textContent = "Cerrar";
    closeButton.addEventListener("click", () => panel.remove());
    panel.appendChild(closeButton);

    document.body.appendChild(panel);
  }

  // Whether La Brisa already has this reservation — decides the button label and what the
  // review panel says confirming will do.
  let knownExisting = false;

  function renderStatusBadge(text, kind) {
    document.querySelectorAll(".la-brisa-status").forEach((el) => el.remove());
    const badge = document.createElement("div");
    badge.className = `la-brisa-status la-brisa-status--${kind}`;
    badge.textContent = text;
    document.body.appendChild(badge);
  }

  function showStatusBadge(status) {
    knownExisting = Boolean(status && status.exists);
    const sendButton = document.querySelector(".la-brisa-fab--send");
    if (!knownExisting) {
      document.querySelectorAll(".la-brisa-status").forEach((el) => el.remove());
      if (sendButton) sendButton.textContent = "Generar link de check-in";
      return;
    }
    renderStatusBadge(`✓ Ya cargada en La Brisa${status.guestName ? ` — ${status.guestName}` : ""}`, "success");
    if (sendButton) sendButton.textContent = "Actualizar datos de la reserva";
  }

  function checkExistingReservation(code) {
    renderStatusBadge("Verificando estado en La Brisa...", "loading");
    chrome.runtime.sendMessage(
      {
        type: "labrisa:check-reservation-status",
        payload: { source: "airbnb", resId: code, airbnbReference: "confirmation_code" },
      },
      (response) => {
        if (code !== currentCode) return; // the operator already moved to another reservation
        if (chrome.runtime.lastError || !response || !response.ok) {
          renderStatusBadge("No se pudo verificar el estado en La Brisa", "error");
          reportExtensionError("check_status", {
            resId: code,
            message:
              (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              (response && response.message) ||
              "No se pudo verificar el estado de la reserva.",
            detail: response && (response.body || response.detail),
          });
          return;
        }
        try {
          showStatusBadge(JSON.parse(response.body));
        } catch {
          renderStatusBadge("No se pudo verificar el estado en La Brisa", "error");
        }
      },
    );
  }

  function submitReservation(code, payload) {
    showToast("Generando link de check-in...", "info");
    chrome.runtime.sendMessage({ type: "labrisa:send-reservation", payload }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        const detail = response && (response.body || response.detail);
        const message = chrome.runtime.lastError
          ? `Error interno de la extensión: ${chrome.runtime.lastError.message}`
          : `${(response && response.message) || "No se pudo generar el link."}${detail ? " — " + detail : ""}`;
        showToast(message, "error");
        reportExtensionError("submit_reservation", { resId: code, message, detail });
        return;
      }

      let body;
      try {
        body = JSON.parse(response.body);
      } catch {
        const message = "La Brisa respondió pero no se pudo leer el link generado.";
        showToast(message, "error");
        reportExtensionError("submit_reservation", { resId: code, message, detail: response.body });
        return;
      }

      const message = body.message || body.confirmationUrl;
      navigator.clipboard.writeText(message).catch(() => {});
      showResultPanel(message, body.created);
      showStatusBadge({ exists: true, guestName: body.guestName, status: body.status });
    });
  }

  async function sendToLaBrisa() {
    const code = currentCode;
    if (!code) return;

    showToast("Buscando los datos de la reserva...", "info");
    await waitUntil(hasStayDetails, { timeoutMs: 8000 });
    await revealPhone();

    const { guestName, guests, checkIn, checkOut, totalPrice, guestPhone } = extractReservationFields();
    const payload = {
      source: "airbnb",
      res_id: code,
      airbnb_reference: "confirmation_code",
      guest_name: guestName,
      guest_email: null,
      guest_phone: guestPhone,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      total_price: totalPrice,
      currency: totalPrice ? "ARS" : null,
      status: null,
      // Everything starts unverified; the operator's review is what verifies each field.
      unverified_fields: ["guest_name", "guest_phone", "guests", "check_in", "check_out", "total_price", "currency", "status"],
    };

    globalThis.LaBrisaReview.openReviewPanel({
      title: knownExisting ? `Actualizar reserva de Airbnb ${code}` : `Nueva reserva de Airbnb ${code}`,
      basePayload: payload,
      fields: [
        { key: "guest_name", label: "Nombre del huésped", type: "text", value: guestName },
        { key: "guest_phone", label: "Teléfono", type: "text", value: guestPhone },
        { key: "check_in", label: "Check-in", type: "date", value: checkIn },
        { key: "check_out", label: "Check-out", type: "date", value: checkOut },
        { key: "guests", label: "Huéspedes", type: "number", value: guests },
        { key: "total_price", label: "Precio total", type: "text", value: totalPrice },
        { key: "currency", label: "Moneda", type: "text", value: payload.currency },
      ],
      describeAction: (values) => {
        if (knownExisting) {
          return "Al confirmar se actualizan los datos de la reserva ya cargada en La Brisa (no se le reenvía nada al huésped).";
        }
        return values.guest_phone && values.guest_phone.trim()
          ? "Al confirmar se crea la reserva en La Brisa (o se actualiza, si ya se cargó desde los mensajes con las mismas fechas) y, si es nueva, se le envía el link de check-in al huésped por WhatsApp."
          : "Al confirmar se crea la reserva en La Brisa (o se actualiza, si ya se cargó desde los mensajes con las mismas fechas). Sin teléfono, no se envía por WhatsApp.";
      },
      onConfirm: (reviewedPayload) => submitReservation(code, reviewedPayload),
    });
  }

  function removeUI() {
    document
      .querySelectorAll(".la-brisa-fab--send, .la-brisa-status, .la-brisa-review, .la-brisa-panel")
      .forEach((el) => el.remove());
    knownExisting = false;
  }

  function injectUI() {
    const sendButton = document.createElement("button");
    sendButton.className = "la-brisa-fab la-brisa-fab--send";
    sendButton.type = "button";
    sendButton.textContent = "Generar link de check-in";
    sendButton.title =
      "Lee los datos de esta reserva, te los muestra para revisarlos y crea (o actualiza) la reserva en La Brisa.";
    sendButton.addEventListener("click", sendToLaBrisa);
    document.body.appendChild(sendButton);
  }

  // Follows Airbnb's in-app navigation: shows the button on a reservation page, removes it
  // elsewhere, and re-checks the status whenever the operator moves to another reservation.
  let currentCode = null;
  async function onLocationChange() {
    const code = parse.confirmationCodeFromPath(window.location.pathname);
    if (code === currentCode) return;
    // Only clear UI this script put up: on a messages thread (also under /hosting/), the
    // button and badge belong to content_script_airbnb.js.
    const hadUI = currentCode !== null;
    currentCode = code;
    if (hadUI) removeUI();
    if (!code) return;
    injectUI();
    await waitUntil(hasStayDetails, { timeoutMs: 15000 });
    if (code === currentCode) checkExistingReservation(code);
  }

  onLocationChange();
  setInterval(onLocationChange, 1000);
})();
