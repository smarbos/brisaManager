// Text parsing for Airbnb's reservation page (/hosting/stay/<confirmation code>), used by
// content_script_airbnb_stay.js. Plain functions, exported for Node's test runner
// (tests/airbnb_stay_parsing.test.js).
//
// Unlike the messages thread, this page has a "Booking date" row that includes the year
// ("miércoles, 16 de septiembre de 2026"), so the stay's year doesn't have to be guessed:
// the check-in is the first occurrence of its day/month on or after the booking date.
(function (root) {
  const MONTHS = {
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
    jan: 1, apr: 4, aug: 8, dec: 12,
  };

  function monthFromText(text) {
    return MONTHS[String(text).slice(0, 3).toLowerCase()] || null;
  }

  function isoDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function confirmationCodeFromPath(pathname) {
    const match = pathname.match(/\/hosting\/stay\/([A-Z0-9]{6,})/i);
    return match ? match[1].toUpperCase() : null;
  }

  // "mar, 27 oct" -> { day: 27, month: 10 }; the weekday is ignored.
  function parseDayMonth(raw) {
    if (!raw) return null;
    const match = String(raw).match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]{3,})/i);
    if (!match) return null;
    const month = monthFromText(match[2]);
    return month ? { day: parseInt(match[1], 10), month } : null;
  }

  // "miércoles, 16 de septiembre de 2026" -> "2026-09-16".
  function parseLongSpanishDate(raw) {
    if (!raw) return null;
    const match = String(raw).match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
    if (!match) return null;
    const month = monthFromText(match[2]);
    return month ? isoDate(parseInt(match[3], 10), month, parseInt(match[1], 10)) : null;
  }

  // Check-in: the first occurrence of its day/month on or after the booking date (a stay is
  // never booked after it starts). Check-out: the first occurrence after the check-in.
  // Returns nulls when any input can't be read, so the review panel asks the operator instead
  // of guessing.
  function resolveStayDates(checkInText, checkOutText, bookingDateIso) {
    const checkIn = parseDayMonth(checkInText);
    const checkOut = parseDayMonth(checkOutText);
    if (!checkIn || !checkOut || !bookingDateIso) return { checkIn: null, checkOut: null };

    const bookingYear = parseInt(bookingDateIso.slice(0, 4), 10);
    let checkInIso = isoDate(bookingYear, checkIn.month, checkIn.day);
    if (checkInIso < bookingDateIso) checkInIso = isoDate(bookingYear + 1, checkIn.month, checkIn.day);

    const checkInYear = parseInt(checkInIso.slice(0, 4), 10);
    let checkOutIso = isoDate(checkInYear, checkOut.month, checkOut.day);
    if (checkOutIso <= checkInIso) checkOutIso = isoDate(checkInYear + 1, checkOut.month, checkOut.day);

    return { checkIn: checkInIso, checkOut: checkOutIso };
  }

  // "Grupo de 3 huéspedes de María Laura" -> 3 (Airbnb uses a non-breaking space).
  function parseGuestCount(text) {
    if (!text) return null;
    const match = String(text).match(/(\d+)\s*huésped(?:es)?/i);
    return match ? parseInt(match[1], 10) : null;
  }

  const api = { confirmationCodeFromPath, parseDayMonth, parseLongSpanishDate, resolveStayDates, parseGuestCount };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.LaBrisaAirbnbStay = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
