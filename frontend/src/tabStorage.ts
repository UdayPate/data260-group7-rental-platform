// Values that belong to ONE browser tab, like who we're acting as (team decision R8a).
//
// - sessionStorage is separate for each tab and survives a reload of that tab.
// - localStorage is shared by all tabs; we also write there so a NEW tab starts with the last choice.
//
// So two tabs can be two different guests, even after reloads. The login token (JWT) in
// the next chunk is meant to be stored the same way.

export function readTabValue(key: string): string | null {
  return sessionStorage.getItem(key) ?? localStorage.getItem(key)
}

export function writeTabValue(key: string, value: string) {
  sessionStorage.setItem(key, value)
  localStorage.setItem(key, value)
}

