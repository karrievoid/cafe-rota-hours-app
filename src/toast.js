// toast.js - fire-and-forget notifications. Any component can call toast('Saved').
// A single <Toaster/> mounted in App listens and renders them.
export function toast(message, type = 'ok') {
  window.dispatchEvent(new CustomEvent('app-toast', {
    detail: { message, type, id: `${Date.now()}-${Math.random()}` },
  }));
}