import React, { useState } from 'react';

// Compact per-person monthly totals. `summary` is computed live from the
// working edits so it always matches what you see in the cards.
export default function Summary({ month, summary }) {
  const [copied, setCopied] = useState(false);

  const grandTotal = summary.reduce((s, p) => s + p.hours, 0);
  const hasUnparsed = summary.some((p) => p.unparsed > 0);
  const name = (p) => p.personLabel || p.personName;

  const rows = () => summary.map((p) => [name(p), p.hours.toFixed(2)]);

  async function copyTable() {
    const text = ['Name\tHours', ...rows().map((r) => r.join('\t'))].join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  }
  function downloadCsv() {
    const csv = ['Name,Hours', ...rows().map((r) => r.map(csvCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(month.label || 'period').replace(/\s+/g, '_')}_hours.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card summary">
      <div className="summary-head">
        <h2>Monthly totals</h2>
        <div className="summary-actions">
          <button onClick={copyTable}>{copied ? 'Copied!' : 'Copy'}</button>
          <button onClick={downloadCsv}>CSV</button>
        </div>
      </div>

      {hasUnparsed && (
        <div className="warn">Some shifts could not be read - marked amber below. Check them before trusting totals.</div>
      )}

      <table className="summary-table">
        <thead>
          <tr><th>Name</th><th className="num">Days</th><th className="num">Leave</th><th className="num">Hours</th></tr>
        </thead>
        <tbody>
          {summary.map((p) => (
            <tr key={p.personKey}>
              <td className="sname">{name(p)}{p.unparsed > 0 && <span className="badge">check</span>}</td>
              <td className="num">{p.workDays || ''}</td>
              <td className="num leavecell">{p.leaveDays || ''}</td>
              <td className="num total">{p.hours.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>All staff</td><td className="num" /><td className="num" /><td className="num total">{grandTotal.toFixed(2)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}