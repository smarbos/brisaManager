// PHASE 1-REAL — best-effort extraction against Airbnb's hosting/messages page, calibrated
// only against one real screenshot + a partial HTML dump (res_id/thread 1000000484 and
// 1000000088), never a live page. Every scraped field is therefore always listed in
// unverified_fields, unlike Booking.com's content_script.js where only fields that
// genuinely couldn't be found are unverified — until a real capture from the "🔍 Escanear
// (debug)" button below confirms the real selectors, staff must review every Airbnb-sourced
// import regardless of whether extraction happened to guess right.
//
// Known gaps, not yet resolved:
// - No Airbnb reservation confirmation code (the human-readable code guests/hosts normally
//   reference, distinct from the numeric messages-thread id in the URL) has been located on
//   this page. The thread id is used as the dedupe key instead (see EXTERNAL_REFERENCE_PREFIX
//   in the API's channel-import.service.ts) — stable for a given conversation, but not the
//   same identifier Airbnb shows the guest elsewhere.
// - Airbnb never shows the reservation year next to Check-in/Check-out on this page (only
//   "mar, 27 oct" — weekday, day, month). The year is inferred (see inferYear() below) and
//   check_in/check_out are always unverified as a result.
// - Total price is confirmed real: `data-testid="hosting-details-payment-info"` contains
//   the amount (e.g. "$ 270.400,00") in Argentine peso formatting (dot thousands separator,
//   comma decimal separator) — the same raw-string-passthrough convention Booking.com's
//   total_price already uses, parsed server-side by channel-import.service.ts's
//   parseAmount(), which already handles this exact format correctly.
// - The guest's phone number is confirmed real too, inside a "Número de teléfono de
//   <guest name>" row — wrapped in Unicode bidi-embedding marks (U+202A/U+202C) that force
//   LTR rendering regardless of page direction, stripped before use (see stripBidiMarks()).
// - Both the price and the phone number live behind collapsed disclosure rows — "Mostrar
//   reserva" and "Administrá la reserva" respectively — that are not necessarily present/
//   populated in the DOM until clicked. expandReservationDetails() below clicks both
//   (matched by their visible label text, accent/case-insensitive, so it still finds them if
//   Airbnb re-cases or re-accents the label) before extraction runs — a disclosure-row click
//   only reveals information the host already has permission to see, it never submits or
//   sends anything, so this is safe to do on the host's behalf. If a row can't be found (already
//   expanded, or Airbnb changed the label), extraction just falls back to null for that field,
//   same as always.
// - The guest's real email is never shown here (Airbnb's messaging UI doesn't expose it) —
//   this is *why* the extension writes a message into the chat instead of relying on the
//   automatic confirmation email Booking.com imports get.

(function () {
  "use strict";

  const MAX_LABEL_TEXT_LENGTH = 60;

  const MONTHS = {
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
    jan: 1, apr: 4, aug: 8, dec: 12,
  };

  function getThreadId() {
    const match = window.location.pathname.match(/\/hosting\/messages\/(\d+)/);
    return match ? match[1] : null;
  }

  function ownText(el) {
    let text = "";
    for (const child of el.childNodes) {
      if (child.nodeType === 3) text += child.textContent;
    }
    return text.trim();
  }

  // Strips accents and case so label matching survives Airbnb re-casing/re-accenting text
  // (e.g. matching "administra la reserva" against the real "Administrá la reserva").
  function normalizeText(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }

  // Unicode bidi-embedding marks Airbnb wraps phone numbers in to force LTR rendering
  // regardless of page direction — not part of the actual number.
  function stripBidiMarks(s) {
    return s.replace(/[‎‏‪-‮⁦-⁩]/g, "").trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Condition-based waiting, not a fixed delay or a generic "DOM went quiet" heuristic —
  // this page is busy enough (message-thread updates, read receipts, etc.) that a
  // MutationObserver-based "wait until nothing moves for 600ms" essentially never fires
  // before its own hard timeout, regardless of whether the specific content we're waiting
  // for has actually rendered yet. Polling for the exact thing we need is slower to write
  // but far more reliable — confirmed necessary: a debug scan run moments *after* a failed
  // "Generar link" click found every field correctly, meaning the data reliably shows up
  // eventually, just not within whatever the old fixed-style wait allowed for.
  async function waitUntil(predicate, { intervalMs = 200, timeoutMs = 6000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await delay(intervalMs);
    }
    return predicate();
  }

  function hasPaymentInfo() {
    return Boolean(document.querySelector('[data-testid="hosting-details-payment-info"]'));
  }

  // A minimal signal that the page's own reservation panel has rendered at all — checked
  // before touching anything disclosure-row-specific, since "dates came back wrong" has
  // happened on the same click where price/phone also failed, suggesting the whole panel
  // (not just the two collapsed rows) can still be mid-render right after a fresh page
  // load/reload.
  function hasReservationPanel() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (ownText(node).toLowerCase() === "check-in") return true;
      node = walker.nextNode();
    }
    return false;
  }

  function hasPhoneRow() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (normalizeText(ownText(node)).startsWith("numero de telefono de")) return true;
      node = walker.nextNode();
    }
    return false;
  }

  // Finds a collapsed disclosure row by its visible label text and clicks it. Returns
  // whether a match was found/clicked — never throws, since the row may simply not exist
  // (already expanded, or this reservation type doesn't have it).
  function clickRowByLabel(labelSubstring) {
    const target = normalizeText(labelSubstring);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && normalizeText(text).includes(target)) {
        const clickable = node.closest('button, [role="button"], [tabindex]') || node;
        clickable.click();
        return true;
      }
      node = walker.nextNode();
    }
    return false;
  }

  // Both "Mostrar reserva" (check-in/check-out + price) and "Administrá la reserva" (phone
  // number) are collapsed disclosure rows — see the file-header comment for why clicking
  // them on the host's behalf is safe. Skips the click entirely when the target content is
  // already present (a second click on an already-open row would toggle it closed again),
  // and after clicking, polls for that exact content rather than guessing how long to wait.
  // Best-effort throughout: if a row can't be found or its content never appears within the
  // timeout, the corresponding fields just stay null, same as before.
  async function expandReservationDetails() {
    if (!hasPaymentInfo() && clickRowByLabel("mostrar reserva")) {
      await waitUntil(hasPaymentInfo);
    }
    if (!hasPhoneRow() && clickRowByLabel("administra la reserva")) {
      await waitUntil(hasPhoneRow);
    }
  }

  function shortSelector(el, depth = 4) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && depth > 0) {
      let piece = node.tagName.toLowerCase();
      if (node.id) {
        piece += `#${node.id}`;
        parts.unshift(piece);
        break;
      }
      if (node.classList && node.classList.length) {
        piece += "." + Array.from(node.classList).slice(0, 2).join(".");
      }
      parts.unshift(piece);
      node = node.parentElement;
      depth -= 1;
    }
    return parts.join(" > ");
  }

  // ---------------------------------------------------------------------
  // Debug/inspection scanner — same purpose as Booking.com's: dump candidate
  // text on the page into a copyable panel so a real capture can be used to
  // confirm/replace the guesses in extractReservationFields() below.
  // ---------------------------------------------------------------------
  function dumpHeadings() {
    return Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: el.textContent.trim(), selector: shortSelector(el) }))
      .filter((h) => h.text);
  }

  function dumpGuestCountMentions() {
    const found = [];
    const pattern = /\d+\s*huésped(?:es)?/gi;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && text.length <= MAX_LABEL_TEXT_LENGTH && pattern.test(text)) {
        found.push({ text, selector: shortSelector(node) });
      }
      pattern.lastIndex = 0;
      node = walker.nextNode();
    }
    return found;
  }

  function dumpLabelCandidates(labelWords) {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node).toLowerCase();
      if (labelWords.includes(text)) {
        found.push({
          labelText: ownText(node),
          selector: shortSelector(node),
          nextSiblingText: node.nextElementSibling ? node.nextElementSibling.textContent.trim() : null,
          parentNextSiblingText:
            node.parentElement && node.parentElement.nextElementSibling
              ? node.parentElement.nextElementSibling.textContent.trim()
              : null,
          parentInnerText: node.parentElement ? node.parentElement.textContent.trim() : null,
        });
      }
      node = walker.nextNode();
    }
    return found;
  }

  // Confirmation codes are typically a short run of uppercase letters/digits (Airbnb's own
  // codes look like "HMWQPXYK2Y") — scanned opportunistically in case one is present
  // somewhere on this page even though none has been confirmed yet.
  function dumpPossibleConfirmationCodes() {
    const found = [];
    const pattern = /\b[A-Z0-9]{8,12}\b/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && text.length <= MAX_LABEL_TEXT_LENGTH) {
        const matches = text.match(pattern);
        if (matches) {
          matches.forEach((m) => found.push({ code: m, selector: shortSelector(node) }));
        }
      }
      node = walker.nextNode();
    }
    return found;
  }

  function dumpPaymentInfo() {
    const container = document.querySelector('[data-testid="hosting-details-payment-info"]');
    return container ? { text: container.textContent.trim(), selector: shortSelector(container) } : null;
  }

  function dumpPhoneCandidates() {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && normalizeText(text).startsWith("numero de telefono de")) {
        found.push({
          labelText: text,
          selector: shortSelector(node),
          nextSiblingText: node.nextElementSibling ? node.nextElementSibling.textContent.trim() : null,
        });
      }
      node = walker.nextNode();
    }
    return found;
  }

  // Reveals both collapsed disclosure rows before scanning (unless explicitly skipped, e.g.
  // the passive auto-scan on page load — clicking things without the operator having asked
  // for anything yet would be surprising, unlike the explicit debug-button click or the
  // "Generar link" flow), so the dump reflects what's actually extractable, not just
  // whatever happened to already be open.
  async function runInspection({ expand = true } = {}) {
    if (expand) {
      await waitUntil(hasReservationPanel, { timeoutMs: 8000 });
      await expandReservationDetails();
    }

    const dump = {
      url: window.location.href,
      threadId: getThreadId(),
      capturedAt: new Date().toISOString(),
      headings: dumpHeadings(),
      guestCountMentions: dumpGuestCountMentions(),
      checkInLabelCandidates: dumpLabelCandidates(["check-in"]),
      checkOutLabelCandidates: dumpLabelCandidates(["check-out"]),
      possibleConfirmationCodes: dumpPossibleConfirmationCodes(),
      paymentInfo: dumpPaymentInfo(),
      phoneCandidates: dumpPhoneCandidates(),
    };

    window.__laBrisaAirbnbInspection = dump;

    console.groupCollapsed(
      "%c[La Brisa] Airbnb inspection dump ready",
      "color:#0d6efd;font-weight:bold",
    );
    console.log(dump);
    console.log(
      "%cTo copy this for feedback, run:\ncopy(JSON.stringify(window.__laBrisaAirbnbInspection, null, 2))",
      "color:#666",
    );
    console.groupEnd();

    return dump;
  }

  // ---------------------------------------------------------------------
  // Real (best-effort) extraction.
  // ---------------------------------------------------------------------
  function extractGuestName() {
    // Confirmed wrong once already: `h1, h2` alone also matches page-chrome headings like
    // "Mensajes" (the inbox nav item), which sorts before the real conversation header in
    // DOM order. Every real conversation heading carries the host's own name after a comma
    // (e.g. "María Laura, Ana" — confirmed against multiple threads in the same
    // inbox, all sharing that same trailing name), and generic page-chrome headings never
    // contain a comma, so requiring one filters those false matches out.
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]')).find((el) => {
      const text = el.textContent.trim();
      return text && text.includes(",") && text.length <= MAX_LABEL_TEXT_LENGTH;
    });
    if (!heading) return null;
    return heading.textContent.trim().split(",")[0].trim() || null;
  }

  function extractGuestCount() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      const match = text && text.match(/(\d+)\s*huésped(?:es)?/i);
      if (match) return parseInt(match[1], 10);
      node = walker.nextNode();
    }
    return null;
  }

  // "27 oct" -> { day: 27, month: 10 }, tolerant of a leading weekday and a trailing time
  // ("mar, 27 oct 2:00 p.m."), since neither is needed.
  function parseDayMonth(raw) {
    if (!raw) return null;
    const match = raw.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]{3,})|(\d{1,2})\s+([a-záéíóúñ]{3,})/i);
    if (!match) return null;
    const day = match[1] || match[3];
    const monthText = (match[2] || match[4] || "").slice(0, 3).toLowerCase();
    const month = MONTHS[monthText];
    if (!month) return null;
    return { day: parseInt(day, 10), month };
  }

  // Airbnb never shows a year next to these dates on this page. Assumes the nearest
  // occurrence of that day/month isn't more than ~60 days in the past (covers a checkout
  // that just happened) — otherwise rolls forward to next year. Always paired with marking
  // the field unverified regardless, since this is a guess, not a read.
  function inferYear(day, month) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const candidate = new Date(currentYear, month - 1, day);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    return candidate < sixtyDaysAgo ? currentYear + 1 : currentYear;
  }

  function toIsoDate(dayMonth) {
    if (!dayMonth) return null;
    const year = inferYear(dayMonth.day, dayMonth.month);
    return `${year}-${String(dayMonth.month).padStart(2, "0")}-${String(dayMonth.day).padStart(2, "0")}`;
  }

  function findValueNearLabel(labelText) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (ownText(node).toLowerCase() === labelText) {
        const candidates = [
          node.nextElementSibling ? node.nextElementSibling.textContent : null,
          node.parentElement && node.parentElement.nextElementSibling
            ? node.parentElement.nextElementSibling.textContent
            : null,
          node.parentElement ? node.parentElement.textContent.replace(new RegExp(labelText, "i"), "") : null,
        ];
        for (const candidate of candidates) {
          const parsed = parseDayMonth(candidate);
          if (parsed) return parsed;
        }
      }
      node = walker.nextNode();
    }
    return null;
  }

  // Confirmed real via a captured DOM dump: `[data-testid="hosting-details-payment-info"]`
  // contains a "$ 270.400,00" style amount alongside a separate "Total por N noches" line —
  // only the amount is extracted; the nights count is already covered by check-in/check-out.
  function extractTotalPrice() {
    const container = document.querySelector('[data-testid="hosting-details-payment-info"]');
    if (!container) return null;
    const match = container.textContent.match(/\$\s*[\d.,]+/);
    return match ? match[0].replace(/\s+/g, " ").trim() : null;
  }

  // Confirmed real via a captured DOM dump: a row titled "Número de teléfono de <guest
  // name>" (revealed by expandReservationDetails() above) has the number in the very next
  // sibling element, wrapped in bidi marks. Matched by prefix so it works for any guest
  // name, not just the one captured.
  function extractGuestPhone() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && normalizeText(text).startsWith("numero de telefono de")) {
        const valueEl = node.nextElementSibling;
        if (valueEl) return stripBidiMarks(valueEl.textContent) || null;
      }
      node = walker.nextNode();
    }
    return null;
  }

  function extractReservationFields() {
    const guestName = extractGuestName();
    const guests = extractGuestCount();
    const checkIn = toIsoDate(findValueNearLabel("check-in"));
    const checkOut = toIsoDate(findValueNearLabel("check-out"));
    const totalPrice = extractTotalPrice();
    const guestPhone = extractGuestPhone();

    return { guestName, guests, checkIn, checkOut, totalPrice, guestPhone };
  }

  // ---------------------------------------------------------------------
  // UI: floating buttons + toast (identical classnames/behavior to
  // content_script.js, styles.css is shared between both).
  // ---------------------------------------------------------------------
  function showToast(message, kind = "info") {
    document.querySelectorAll(".la-brisa-toast").forEach((el) => el.remove());
    const toast = document.createElement("div");
    toast.className = `la-brisa-toast la-brisa-toast--${kind}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function showInspectionPanel(dump) {
    document.querySelectorAll(".la-brisa-panel").forEach((el) => el.remove());

    const panel = document.createElement("div");
    panel.className = "la-brisa-panel";

    const hint = document.createElement("p");
    hint.className = "la-brisa-panel__hint";
    hint.textContent =
      "Hacé clic adentro del cuadro, apretá Ctrl+A (seleccionar todo) y después Ctrl+C (copiar). Pegalo donde me estés escribiendo.";
    panel.appendChild(hint);

    const textarea = document.createElement("textarea");
    textarea.className = "la-brisa-panel__textarea";
    textarea.readOnly = true;
    textarea.value = JSON.stringify(dump, null, 2);
    panel.appendChild(textarea);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "la-brisa-panel__close";
    closeButton.textContent = "Cerrar";
    closeButton.addEventListener("click", () => panel.remove());
    panel.appendChild(closeButton);

    document.body.appendChild(panel);
    textarea.focus();
    textarea.select();
  }

  // Finds Airbnb's message compose box. Confirmed real (from a captured DOM dump of the
  // compose bar): `id="message_input"`, `data-testid="messaging-composebar"`,
  // `contenteditable="plaintext-only"` — NOT `contenteditable="true"`, which a first version
  // of this selector assumed. That mismatch meant the old selector never matched the real
  // compose box at all and silently fell through to some *other* editable element on the
  // page instead (e.g. the "Tus notas" panel), which is where a generated message actually
  // ended up once. The specific selectors are tried first for exactly that reason; the
  // generic contenteditable/textarea fallbacks only exist in case Airbnb changes these
  // attributes later.
  function findComposeBox() {
    return (
      document.querySelector('[data-testid="messaging-composebar"]') ||
      document.querySelector("#message_input") ||
      document.querySelector('div[contenteditable="plaintext-only"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("textarea")
    );
  }

  // execCommand is deprecated but still the most reliable way to insert text into a
  // contenteditable field such that a React-controlled editor's own input/beforeinput
  // listeners pick it up — directly setting .textContent does not fire those and the
  // framework silently reverts it (the same class of problem as our own controlled
  // <input type="number"> bug elsewhere in this codebase).
  function tryInsertIntoComposeBox(message) {
    const box = findComposeBox();
    if (!box) return false;
    try {
      box.focus();
      if (box.tagName === "TEXTAREA") {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeSetter.call(box, message);
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return document.execCommand("insertText", false, message);
    } catch {
      return false;
    }
  }

  async function sendToLaBrisa() {
    const threadId = getThreadId();
    if (!threadId) {
      showToast("No se pudo leer el id de esta conversación de la URL.", "error");
      return;
    }

    showToast("Buscando los datos de la reserva...", "info");
    await waitUntil(hasReservationPanel, { timeoutMs: 8000 });
    await expandReservationDetails();

    const { guestName, guests, checkIn, checkOut, totalPrice, guestPhone } = extractReservationFields();

    // Every field is always unverified, found or not — see the file-header comment. This
    // isn't theoretical: the guest-name guess has already been confirmed wrong once in real
    // use (it matched a page-chrome heading instead of the conversation's), so "found
    // something" is not the same as "found correctly" until real captures confirm the
    // selectors.
    const unverifiedFields = [
      "guest_name",
      "guest_phone",
      "guests",
      "check_in",
      "check_out",
      "total_price",
      "currency",
      "status",
    ];

    const payload = {
      source: "airbnb",
      res_id: threadId,
      guest_name: guestName,
      guest_email: null,
      guest_phone: guestPhone,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      total_price: totalPrice,
      currency: totalPrice ? "ARS" : null,
      status: null,
      unverified_fields: unverifiedFields,
    };

    showToast("Generando link de check-in...", "info");

    chrome.runtime.sendMessage(
      { type: "labrisa:send-reservation", payload },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast(`Error interno de la extensión: ${chrome.runtime.lastError.message}`, "error");
          return;
        }
        if (!response || !response.ok) {
          const detail = response && (response.body || response.detail);
          showToast(
            `${(response && response.message) || "No se pudo generar el link."}${detail ? " — " + detail : ""}`,
            "error",
          );
          return;
        }

        let body;
        try {
          body = JSON.parse(response.body);
        } catch {
          showToast("La Brisa respondió pero no se pudo leer el link generado.", "error");
          return;
        }

        const message = body.message || body.confirmationUrl;
        navigator.clipboard.writeText(message).catch(() => {});
        const inserted = tryInsertIntoComposeBox(message);

        showToast(
          inserted
            ? "¡Listo! El mensaje se completó abajo — revisalo antes de enviarlo."
            : "Mensaje copiado al portapapeles — pegalo (Ctrl+V) en el cuadro de mensaje y revisalo antes de enviar.",
          "success",
        );
      },
    );
  }

  function runWhenStable(callback, { quietMs = 800, maxWaitMs = 15000 } = {}) {
    let settleTimer = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(hardStop);
      callback();
    };

    const observer = new MutationObserver(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, quietMs);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    settleTimer = setTimeout(finish, quietMs);
    const hardStop = setTimeout(finish, maxWaitMs);
  }

  function injectUI() {
    if (document.querySelector(".la-brisa-fab")) return;

    const sendButton = document.createElement("button");
    sendButton.className = "la-brisa-fab";
    sendButton.type = "button";
    sendButton.textContent = "Generar link de check-in";
    sendButton.title =
      "Extrae los datos de esta conversación, crea (o encuentra) la reserva en La Brisa y prepara un mensaje con el link de check-in para pegar en el chat.";
    sendButton.addEventListener("click", sendToLaBrisa);
    document.body.appendChild(sendButton);

    const debugButton = document.createElement("button");
    debugButton.className = "la-brisa-fab la-brisa-fab--secondary";
    debugButton.type = "button";
    debugButton.textContent = "🔍 Escanear (debug)";
    debugButton.title = "Vuelve a correr el escaneo de inspección y lo muestra en un cuadro para copiar.";
    debugButton.addEventListener("click", async () => {
      const dump = await runInspection();
      showInspectionPanel(dump);
    });
    document.body.appendChild(debugButton);
  }

  injectUI();
  runWhenStable(() => {
    runInspection({ expand: false });
    console.log(
      '%c[La Brisa] Airbnb auto-scan complete. Click "🔍 Escanear (debug)" to re-run manually.',
      "color:#0d6efd",
    );
  });
})();
