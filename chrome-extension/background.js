// Service worker: owns all network access to La Brisa's API.
//
// Requests are made here instead of in the content script because a content
// script's fetch() runs inside admin.booking.com's page context and can be
// blocked by that site's Content-Security-Policy. A background service
// worker isn't part of any web page, so it's never subject to a third
// party's CSP.

const SEND_TIMEOUT_MS = 10_000;

async function getSettings() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get([
    "apiBaseUrl",
    "apiToken",
  ]);
  return { apiBaseUrl: apiBaseUrl || "", apiToken: apiToken || "" };
}

async function sendReservation(payload) {
  const { apiBaseUrl, apiToken } = await getSettings();

  if (!apiBaseUrl) {
    return {
      ok: false,
      kind: "not-configured",
      message:
        "No hay una URL de API configurada. Abrí las opciones de la extensión.",
    };
  }

  const url = `${apiBaseUrl.replace(/\/+$/, "")}/reservations/import`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        kind: "http-error",
        status: response.status,
        message: `La Brisa respondió con un error (${response.status}).`,
        body: bodyText,
      };
    }

    return { ok: true, status: response.status, body: bodyText };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        ok: false,
        kind: "timeout",
        message: "No pudimos conectar con La Brisa — revisá tu conexión.",
      };
    }
    return {
      ok: false,
      kind: "network-error",
      message: "No pudimos conectar con La Brisa — revisá tu conexión.",
      detail: String(error && error.message ? error.message : error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "labrisa:send-reservation") {
    return false;
  }

  sendReservation(message.payload).then(sendResponse);
  return true; // keep the message channel open for the async sendResponse
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
