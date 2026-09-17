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
// - No price/total amount is visible anywhere on this page.
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

  function runInspection() {
    const dump = {
      url: window.location.href,
      threadId: getThreadId(),
      capturedAt: new Date().toISOString(),
      headings: dumpHeadings(),
      guestCountMentions: dumpGuestCountMentions(),
      checkInLabelCandidates: dumpLabelCandidates(["check-in"]),
      checkOutLabelCandidates: dumpLabelCandidates(["check-out"]),
      possibleConfirmationCodes: dumpPossibleConfirmationCodes(),
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
    const heading = Array.from(document.querySelectorAll("h1, h2")).find((el) => el.textContent.trim());
    if (!heading) return null;
    // Every conversation in the inbox list carries the host's own name after a comma (e.g.
    // "María Laura, Ana") — confirmed by comparing multiple threads in the same
    // inbox, all sharing that same trailing name. The guest's name is the part before it.
    const text = heading.textContent.trim();
    return text.split(",")[0].trim() || null;
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

  function extractReservationFields() {
    const guestName = extractGuestName();
    const guests = extractGuestCount();
    const checkIn = toIsoDate(findValueNearLabel("check-in"));
    const checkOut = toIsoDate(findValueNearLabel("check-out"));

    return { guestName, guests, checkIn, checkOut };
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

  // Finds Airbnb's message compose box. Best-effort only — Airbnb's editor is very likely a
  // React-controlled contenteditable div, so this is tried as a bonus on top of the
  // clipboard copy (which always works), never relied on alone.
  function findComposeBox() {
    return (
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

  function sendToLaBrisa() {
    const threadId = getThreadId();
    if (!threadId) {
      showToast("No se pudo leer el id de esta conversación de la URL.", "error");
      return;
    }

    const { guestName, guests, checkIn, checkOut } = extractReservationFields();

    const unverifiedFields = ["total_price", "currency", "status"];
    if (!guestName) unverifiedFields.push("guest_name");
    if (!guests) unverifiedFields.push("guests");
    // Always unverified even when found — see the file-header comment (no confirmed real
    // capture yet, and the year is always inferred, never read).
    unverifiedFields.push("check_in", "check_out");

    const payload = {
      source: "airbnb",
      res_id: threadId,
      guest_name: guestName,
      guest_email: null,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      total_price: null,
      currency: null,
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
    debugButton.addEventListener("click", () => {
      const dump = runInspection();
      showInspectionPanel(dump);
    });
    document.body.appendChild(debugButton);
  }

  injectUI();
  runWhenStable(() => {
    runInspection();
    console.log(
      '%c[La Brisa] Airbnb auto-scan complete. Click "🔍 Escanear (debug)" to re-run manually.',
      "color:#0d6efd",
    );
  });
})();
