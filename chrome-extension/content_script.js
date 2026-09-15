// PHASE 2 — real extraction, calibrated against real reservation page dumps for the same
// reservation (res_id 6148496412) captured on both an English-labeled load (2026-09-15,
// `lang=xu`) and the real Spanish locale staff actually use (2026-09-15, `lang=es`). Every
// field below is confirmed against real captured text in at least one language; where a
// field's label differs by language, both are tried. The inspection scanner below
// (runInspection / the "🔍 Escanear (debug)" button) is kept in place: it's what produced
// these dumps, and it's the tool to re-run against a future reservation type we haven't
// seen yet (multi-room, cancelled, etc.) if extraction turns out wrong for it.
//
// Known gaps, not yet resolved:
// - `status` (reservation confirmed/cancelled) is confirmed ABSENT as label text anywhere
//   on this page for a normal reservation (checked via `allLabelValuePairs`, an unfiltered
//   dump of every label — not just an unmatched guess). The only status-adjacent label
//   found is "Estado del pago" (payment status — a different concept), which itself has no
//   value next to it either. This may only appear on a cancelled reservation's page, which
//   hasn't been captured yet.
// - The room-table total price summing (below) handles a multi-room booking by adding up
//   each room's row, but this is untested against a real multi-room reservation — both
//   real samples so far were single-room.

(function () {
  "use strict";

  const FIELD_LABELS = {
    guestName: ["nombre", "guest name", "huésped", "huesped", "cliente"],
    checkIn: ["entrada", "check-in", "check in", "llegada"],
    checkOut: ["salida", "check-out", "check out"],
    guests: ["huéspedes", "huespedes", "guests", "adultos", "adults", "niños", "children"],
    price: ["precio", "total", "importe", "payout", "monto"],
    status: ["estado", "status"],
  };

  const MAX_LABEL_TEXT_LENGTH = 60;

  // ---------------------------------------------------------------------
  // URL params — these are read from the URL, never scraped from the DOM.
  // ---------------------------------------------------------------------
  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      resId: params.get("res_id"),
      hotelId: params.get("hotel_id"),
    };
  }

  // ---------------------------------------------------------------------
  // Selector helpers — used to describe WHERE a match was found, so a human
  // reading the console dump can turn it into a real CSS selector later.
  // ---------------------------------------------------------------------
  function shortSelector(el, depth = 4) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && depth > 0) {
      let piece = node.tagName.toLowerCase();
      if (node.id) {
        piece += `#${node.id}`;
        parts.unshift(piece);
        break; // an id is unique enough to stop climbing
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

  function ownText(el) {
    let text = "";
    for (const child of el.childNodes) {
      if (child.nodeType === 3) text += child.textContent;
    }
    return text.trim();
  }

  function preview(el, max = 200) {
    if (!el) return null;
    const html = el.outerHTML || "";
    return html.length > max ? html.slice(0, max) + "…" : html;
  }

  function describeCandidate(strategy, el) {
    if (!el) return null;
    const text = el.textContent ? el.textContent.trim() : "";
    if (!text) return null;
    return {
      strategy,
      selector: shortSelector(el),
      text: text.length > 200 ? text.slice(0, 200) + "…" : text,
      html: preview(el),
    };
  }

  // ---------------------------------------------------------------------
  // Value-guessing strategies. Several are tried per label since we don't
  // know which layout Booking.com uses (label/value siblings, dt/dd,
  // table rows, etc.) — all candidates are logged so a human picks the
  // right one instead of us silently guessing wrong in Phase 2.
  // ---------------------------------------------------------------------
  function guessValueCandidates(labelEl) {
    const candidates = [];

    candidates.push(describeCandidate("nextElementSibling", labelEl.nextElementSibling));

    const parent = labelEl.parentElement;
    if (parent) {
      candidates.push(
        describeCandidate("parent.nextElementSibling", parent.nextElementSibling),
      );

      if (parent.children.length > 1 && parent.children[0] === labelEl) {
        candidates.push(
          describeCandidate("parent.secondChild", parent.children[1]),
        );
      }
    }

    if (labelEl.tagName === "DT") {
      let sib = labelEl.nextElementSibling;
      while (sib && sib.tagName !== "DD") sib = sib.nextElementSibling;
      candidates.push(describeCandidate("dt -> following dd", sib));
    }

    const row = labelEl.closest("tr");
    if (row) {
      const cells = Array.from(row.children);
      const idx = cells.indexOf(labelEl.closest("td, th"));
      if (idx !== -1 && cells[idx + 1]) {
        candidates.push(describeCandidate("table row -> next cell", cells[idx + 1]));
      }
    }

    return candidates.filter(Boolean);
  }

  function matchLabel(text) {
    const normalized = text.trim().toLowerCase();
    if (!normalized || normalized.length > MAX_LABEL_TEXT_LENGTH) return null;
    for (const [field, variants] of Object.entries(FIELD_LABELS)) {
      if (variants.some((v) => normalized === v || normalized.startsWith(v + ":") || normalized.startsWith(v))) {
        return field;
      }
    }
    return null;
  }

  // Confirmed real from two prior captures (English and Spanish) — every label on this
  // page lives inside one of these three containers, regardless of language.
  const LABEL_CONTAINER_SELECTORS = [
    "p.res-content__label > span",
    "p.res-print-one-pager__content-label > span",
    "p.res-room-block-overview__label > span",
  ];

  // Structural dump: every label found under a known label CSS class, paired with its
  // value via the same "parent's next sibling" layout used everywhere else on this page
  // — with NO keyword filtering. Exists because the keyword-guess approach in
  // runInspection() below has already been proven to miss real fields (e.g. no Spanish
  // guess for "guests" matched anything, even though the field almost certainly exists).
  function dumpAllStructuralLabels() {
    const seen = new Set();
    const pairs = [];
    for (const selector of LABEL_CONTAINER_SELECTORS) {
      document.querySelectorAll(selector).forEach((labelEl) => {
        const labelText = labelEl.textContent.trim();
        const key = labelText.toLowerCase();
        if (!labelText || seen.has(key)) return;
        seen.add(key);

        const valueEl = labelEl.parentElement && labelEl.parentElement.nextElementSibling;
        const valueText = valueEl
          ? valueEl.textContent
              .split("\n")
              .map((s) => s.trim())
              .find(Boolean) || null
          : null;

        pairs.push({ label: labelText, value: valueText });
      });
    }
    return pairs;
  }

  const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

  // Emails don't need label matching at all — the shape (user@domain.tld) is distinctive
  // enough to find directly. Confirmed necessary: a real guest email
  // ("znoemi.737138@guest.booking.com") is visible on the page next to the guest name, but
  // it wasn't part of that label's own textContent when scanned — it renders as a separate
  // link, not folded into the "Guest name:" value the way the flag/country code is. This
  // scans for both a real `mailto:` link (most reliable) and any plain text that merely
  // looks like an email, in case it's rendered without one.
  function findEmailsOnPage() {
    const found = [];
    const seen = new Set();

    document.querySelectorAll('a[href^="mailto:"]').forEach((el) => {
      const email = el.getAttribute("href").replace(/^mailto:/i, "").split("?")[0].trim();
      if (email && !seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        found.push({ email, selector: shortSelector(el), strategy: "mailto-href" });
      }
    });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      const match = text && text.match(EMAIL_PATTERN);
      if (match && !seen.has(match[0].toLowerCase())) {
        seen.add(match[0].toLowerCase());
        found.push({ email: match[0], selector: shortSelector(node), strategy: "text-match" });
      }
      node = walker.nextNode();
    }

    return found;
  }

  // ---------------------------------------------------------------------
  // Main scan: walk every element, test its OWN direct text (not
  // descendants' text, to avoid matching giant containers) against known
  // labels.
  // ---------------------------------------------------------------------
  function runInspection() {
    const results = {};
    for (const field of Object.keys(FIELD_LABELS)) results[field] = [];
    results._unmatchedButShort = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    let scanned = 0;

    while (node) {
      scanned += 1;
      const text = ownText(node);
      if (text) {
        const field = matchLabel(text);
        if (field) {
          results[field].push({
            labelText: text,
            selector: shortSelector(node),
            html: preview(node),
            candidates: guessValueCandidates(node),
          });
        }
      }
      node = walker.nextNode();
    }

    const dump = {
      url: window.location.href,
      ...getUrlParams(),
      scannedElementCount: scanned,
      capturedAt: new Date().toISOString(),
      matches: results,
      // Unlike `matches` above (which only lists labels matching a guessed keyword —
      // proven to miss real fields, e.g. "Total guests" wasn't caught by any Spanish
      // guess), this lists EVERY label+value pair found under the label CSS classes
      // confirmed real from prior captures, with no keyword filtering. This is what
      // reveals a field's real text when a keyword guess comes up empty.
      allLabelValuePairs: dumpAllStructuralLabels(),
      emailsFound: findEmailsOnPage(),
    };

    window.__laBrisaInspection = dump;

    console.groupCollapsed(
      "%c[La Brisa] Inspection dump ready",
      "color:#0d6efd;font-weight:bold",
    );
    console.log(dump);
    console.log(
      "%cTo copy this for feedback, run:\ncopy(JSON.stringify(window.__laBrisaInspection, null, 2))",
      "color:#666",
    );
    console.groupEnd();

    return dump;
  }

  // ---------------------------------------------------------------------
  // Wait for the extranet's client-rendered content to settle before the
  // first automatic scan (it's a JS admin panel, so document_idle can fire
  // well before the reservation detail actually renders).
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  // UI: floating buttons + toast. This part is NOT a placeholder — it's the
  // real Phase 2 plumbing, usable as-is once extractReservationFields() is
  // filled in with real selectors.
  // ---------------------------------------------------------------------
  function showToast(message, kind = "info") {
    document.querySelectorAll(".la-brisa-toast").forEach((el) => el.remove());
    const toast = document.createElement("div");
    toast.className = `la-brisa-toast la-brisa-toast--${kind}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // Shows the inspection dump as selectable text right on the page, so it can be copied with
  // a normal right-click "Copiar" or Ctrl+A/Ctrl+C — no DevTools console commands required.
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

  // Maps our internal camelCase field names to the payload's snake_case names, for
  // reporting which fields came back null in `unverified_fields`.
  const FIELD_KEY_TO_PAYLOAD_KEY = {
    guestName: "guest_name",
    checkIn: "check_in",
    checkOut: "check_out",
    guests: "guests",
    totalPrice: "total_price",
    currency: "currency",
    status: "status",
  };

  // Month abbreviations in both languages the extranet might render in. "mar", "may",
  // "jun" and "jul" mean the same month in English and Spanish, so merging both sets has
  // no colliding meanings.
  const MONTHS = {
    jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, ago: 8, sep: 9, oct: 10, nov: 11, dec: 12, dic: 12,
  };

  // Builds an index of every short label-like text on the page (own text only, same as
  // the inspection scan) to its element, so multiple fields can be looked up without
  // re-walking the whole DOM once per field. First occurrence of a given label wins —
  // the top-of-page reservation summary appears before the print/one-pager duplicate
  // section that repeats several of the same labels.
  function buildLabelIndex() {
    const index = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const text = ownText(node);
      if (text && text.length <= MAX_LABEL_TEXT_LENGTH) {
        const key = text.toLowerCase().replace(/:$/, "");
        if (key && !index.has(key)) index.set(key, node);
      }
      node = walker.nextNode();
    }
    return index;
  }

  // Reads the value next to a known label, using the same "parent's next sibling"
  // layout confirmed against the real page dump for Check-in/Check-out/Total guests/
  // Total price. Takes only the first non-empty line, since some value cells carry
  // trailing junk on later lines (e.g. guest name's country code).
  function valueAfterLabel(index, labelText) {
    const label = index.get(labelText.toLowerCase().replace(/:$/, ""));
    if (!label || !label.parentElement) return null;
    const valueEl = label.parentElement.nextElementSibling;
    if (!valueEl) return null;
    const firstLine = valueEl.textContent
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean);
    return firstLine || null;
  }

  function firstMatch(index, labels) {
    for (const label of labels) {
      const value = valueAfterLabel(index, label);
      if (value) return value;
    }
    return null;
  }

  function extractGuestName(index) {
    // Most reliable: a stable, language-independent test id on the primary name.
    const byTestId = document.querySelector('[data-test-id="reservation-overview-name"]');
    if (byTestId && byTestId.textContent.trim()) return byTestId.textContent.trim();

    // Fallback: label-based lookup. "guest name" covers the English layout; "nombre del
    // cliente" and "nombre del huésped" are the two confirmed real Spanish labels (top
    // overview and room-block/print sections respectively).
    return firstMatch(index, ["guest name", "nombre del cliente", "nombre del huésped"]);
  }

  // English: "Mon, Oct 5, 2026" / "Oct 5, 2026" -> "2026-10-05" (month name comes first).
  // Spanish, long form: "lunes, 5 de octubre de 2026" (day, "de", month, "de", year) —
  // this is what Booking.com's own date-format templates predicted
  // (window.booking.env.b_date_format.date_with_weekday), but the ACTUAL Check-in/
  // Check-out fields turned out to use a different, shorter template — see below.
  // Pure string parsing (no Date object), so it can't be shifted by the browser's local
  // timezone the way new Date(text).toISOString() could be.
  function parseBookingDate(raw) {
    if (!raw) return null;

    const monthFirst = raw.match(/([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})/);
    if (monthFirst) {
      const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
      if (month) {
        const day = monthFirst[2].padStart(2, "0");
        return `${monthFirst[3]}-${String(month).padStart(2, "0")}-${day}`;
      }
    }

    const dayFirst = raw.match(/(\d{1,2})\s+de\s+([A-Za-z]{3,})\s+de\s+(\d{4})/i);
    if (dayFirst) {
      const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
      if (month) {
        const day = dayFirst[1].padStart(2, "0");
        return `${dayFirst[3]}-${String(month).padStart(2, "0")}-${day}`;
      }
    }

    // Spanish, short form — CONFIRMED live on the real Check-in/Check-out fields:
    // "lun, 5 oct 2026" (short weekday, day, short month, year — no "de" connectors,
    // unlike the long-form template above). Tried last since it's the most permissive
    // pattern (no comma/connector required), so the more specific patterns above get
    // first chance at English/long-Spanish strings.
    const dayMonthYear = raw.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (dayMonthYear) {
      const month = MONTHS[dayMonthYear[2].slice(0, 3).toLowerCase()];
      if (month) {
        const day = dayMonthYear[1].padStart(2, "0");
        return `${dayMonthYear[3]}-${String(month).padStart(2, "0")}-${day}`;
      }
    }

    return null;
  }

  // The top-of-page "Total price" summary showed "US$0" on the one real reservation
  // captured so far, while the room-block table's per-room total showed the real
  // "US$218.70" — Booking.com appears to zero the summary field for this reservation
  // type (likely "pay at property"). Reading from the table instead. If there are
  // multiple room rows (a multi-room/group booking), sum them into one total rather
  // than reporting only the first room's price — untested against a real multi-room
  // sample, but fails back to null (not a wrong number) if any row can't be parsed.
  function extractTotalRoomPrice() {
    const cells = Array.from(document.querySelectorAll("tr.res-room-row-total td.bui-table__cell--align-end"));
    if (cells.length === 0) return null;
    if (cells.length === 1) return cells[0].textContent.trim();

    let currencyPrefix = null;
    let sum = 0;
    for (const cell of cells) {
      const match = cell.textContent.trim().match(/([A-Za-z]*\$)\s*([\d.,]+)/);
      if (!match) return null;
      currencyPrefix = currencyPrefix || match[1];
      const normalized = match[2].replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
      const value = Number(normalized);
      if (!Number.isFinite(value)) return null;
      sum += value;
    }
    return `${currencyPrefix}${sum.toFixed(2)}`;
  }

  // Booking.com prefixes USD amounts with "US$" (confirmed on the real sample); a bare
  // "$" is assumed to be the property's local currency (ARS). Returns the raw amount
  // text unparsed — the backend already does best-effort numeric cleanup on arrival.
  function parsePriceAndCurrency(raw) {
    if (!raw) return { amount: null, currency: null };
    const currency = /US\$/.test(raw) ? "USD" : /\$/.test(raw) ? "ARS" : null;
    return { amount: raw.trim(), currency };
  }

  // Prefers Booking.com's guest-relay domain (confirmed real: "znoemi.737138@guest.
  // booking.com") since that's specifically the guest's contact address; falls back to
  // whatever email is found first if that domain isn't present for some reason. Not
  // folded into `unverified_fields`/the core-fields gate below — email is a separate
  // concern (guest CRM) from whether the reservation's own dates/price/etc. are trusted,
  // so a missing email shouldn't block a Google Calendar push, and a present email
  // doesn't skip the "wait for verified data" gate on actually sending it.
  function extractGuestEmail() {
    const emails = findEmailsOnPage();
    const guestRelay = emails.find((e) => /@guest\.booking\.com$/i.test(e.email));
    return (guestRelay || emails[0] || {}).email || null;
  }

  function extractReservationFields() {
    const { resId, hotelId } = getUrlParams();
    const index = buildLabelIndex();

    const guestName = extractGuestName(index);
    const guestEmail = extractGuestEmail();
    const checkIn = parseBookingDate(firstMatch(index, ["check-in", "entrada"]));
    const checkOut = parseBookingDate(firstMatch(index, ["check-out", "salida"]));
    // "número de huéspedes" and "ocupación real" (e.g. "3 adultos") are confirmed real
    // Spanish labels; "total guests" covers English. The earlier Spanish guesses ("total
    // de huéspedes", "huéspedes totales") were wrong — this field simply had zero
    // matches under those, which is what prompted capturing the real label instead.
    const guestsRaw = firstMatch(index, ["total guests", "número de huéspedes", "ocupación real"]);
    const guests = guestsRaw ? parseInt(guestsRaw.replace(/\D/g, ""), 10) : NaN;
    const priceRaw = extractTotalRoomPrice() || firstMatch(index, ["total price", "precio total"]);
    const { amount: totalPrice, currency } = parsePriceAndCurrency(priceRaw);

    const fields = {
      guestName,
      checkIn,
      checkOut,
      guests: Number.isInteger(guests) ? guests : null,
      totalPrice,
      currency,
      // Confirmed absent, not just unguessed: an unfiltered dump of every label on this
      // page (both languages) found no reservation-status text at all for this normal
      // reservation — only "Estado del pago" (payment status, a different concept, with
      // no value next to it either). May only appear on a cancelled reservation's page,
      // which hasn't been captured yet.
      status: null,
    };

    const unverifiedFields = Object.entries(fields)
      .filter(([, value]) => value === null)
      .map(([key]) => FIELD_KEY_TO_PAYLOAD_KEY[key]);

    return { resId, hotelId, guestEmail, fields, unverifiedFields };
  }

  function sendToLaBrisa() {
    const { resId, hotelId, guestEmail, fields, unverifiedFields } = extractReservationFields();

    if (!resId || !hotelId) {
      showToast(
        "No se pudo leer res_id/hotel_id de la URL de esta página.",
        "error",
      );
      return;
    }

    const payload = {
      source: "booking.com",
      hotel_id: hotelId,
      res_id: resId,
      guest_name: fields.guestName,
      guest_email: guestEmail,
      check_in: fields.checkIn,
      check_out: fields.checkOut,
      guests: fields.guests,
      total_price: fields.totalPrice,
      currency: fields.currency,
      status: fields.status,
      unverified_fields: unverifiedFields,
    };

    showToast("Enviando a La Brisa...", "info");

    chrome.runtime.sendMessage(
      { type: "labrisa:send-reservation", payload },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast(`Error interno de la extensión: ${chrome.runtime.lastError.message}`, "error");
          return;
        }
        if (response && response.ok) {
          showToast("Reserva enviada a La Brisa correctamente.", "success");
        } else {
          const detail = response && (response.body || response.detail);
          showToast(
            `${(response && response.message) || "No se pudo enviar."}${detail ? " — " + detail : ""}`,
            "error",
          );
        }
      },
    );
  }

  function injectUI() {
    if (document.querySelector(".la-brisa-fab")) return; // already injected

    const sendButton = document.createElement("button");
    sendButton.className = "la-brisa-fab";
    sendButton.type = "button";
    sendButton.textContent = "Enviar a La Brisa";
    sendButton.title =
      "Extrae los datos de esta página y los envía a La Brisa. El estado de la reserva no se puede leer todavía (no encontrado en la página), así que ese campo siempre queda sin verificar.";
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
    const dump = runInspection();
    const totalMatches = Object.values(dump.matches).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    );
    console.log(
      `%c[La Brisa] Auto-scan complete: ${totalMatches} label match(es) found. Click "🔍 Escanear (debug)" to re-run manually.`,
      "color:#0d6efd",
    );
  });
})();
