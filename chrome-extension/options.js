const apiBaseUrlInput = document.getElementById("apiBaseUrl");
const apiTokenInput = document.getElementById("apiToken");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || "";
}

async function loadSettings() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get([
    "apiBaseUrl",
    "apiToken",
  ]);
  if (apiBaseUrl) apiBaseUrlInput.value = apiBaseUrl;
  if (apiToken) apiTokenInput.value = apiToken;
}

function normalizeBaseUrl(raw) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "Ingresá una URL válida, por ejemplo https://api.labrisa.com.ar" };
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    return { error: "La URL debe usar https:// (se permite http://localhost para pruebas)." };
  }
  return { value: trimmed, origin: url.origin };
}

async function handleSave() {
  const apiToken = apiTokenInput.value.trim();
  const { error, value: apiBaseUrl, origin } = normalizeBaseUrl(apiBaseUrlInput.value);

  if (error) {
    setStatus(error, "error");
    return;
  }
  if (!apiToken) {
    setStatus("Ingresá el token de acceso.", "error");
    return;
  }

  saveButton.disabled = true;
  setStatus("Solicitando permiso para contactar ese dominio...", "");

  try {
    const granted = await chrome.permissions.request({
      origins: [`${origin}/*`],
    });

    if (!granted) {
      setStatus(
        "No se otorgó permiso para contactar ese dominio. No se puede guardar.",
        "error",
      );
      return;
    }

    await chrome.storage.local.set({ apiBaseUrl, apiToken });
    setStatus("Guardado correctamente.", "success");
  } catch (err) {
    setStatus(`No se pudo guardar: ${err.message || err}`, "error");
  } finally {
    saveButton.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", loadSettings);
saveButton.addEventListener("click", handleSave);
