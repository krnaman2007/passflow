import React from 'react';
import { useApp } from '../context/AppContext';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export default function Toast() {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {toast.type === 'success' && <CheckCircle2 size={18} color="#10b981" />}
            {toast.type === 'error' && <AlertCircle size={18} color="#f43f5e" />}
            {toast.type === 'warning' && <AlertTriangle size={18} color="#f97316" />}
            {toast.type === 'info' && <Info size={18} color="#3b82f6" />}
            <span style={{ fontSize: 13, fontWeight: 500 }}>{toast.message}</span>
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            style={{ color: 'var(--text-dim)', padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
