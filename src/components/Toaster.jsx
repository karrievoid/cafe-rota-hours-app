import React, { useEffect, useState } from 'react';

// Listens for 'app-toast' events and shows a small stack of messages that
// auto-dismiss. Kept dependency-free on purpose.
export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    function onToast(e) {
      const t = e.detail;
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== t.id));
      }, 2500);
    }
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toaster">
      {items.map((i) => (
        <div key={i.id} className={`toast ${i.type === 'error' ? 'toast-error' : 'toast-ok'}`}>
          {i.message}
        </div>
      ))}
    </div>
  );
}