// AMBIENT_CONTROL_ENABLED turns the sensors on for staff and guests. Off (anything but "true",
// including unset) means: devices may keep reporting and their events and readings are still
// recorded, but nothing alerts staff (no AMBIENT_ALERT or DEVICE_OFFLINE notifications) and
// guests don't see the sensors. Read on every call, so changing .env and recreating the api
// container (`up -d api`) is enough.
export function isAmbientControlEnabled(): boolean {
  return process.env.AMBIENT_CONTROL_ENABLED === 'true';
}
