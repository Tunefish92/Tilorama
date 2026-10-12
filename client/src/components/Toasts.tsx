import { CircleCheck, CircleX, Info, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useAppStore, type Toast } from '../store/useAppStore'
import './Toasts.css'

const ICONS = { info: Info, success: CircleCheck, error: CircleX }

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast)
  const Icon = ICONS[toast.kind]
  return (
    <li className={`toast is-${toast.kind} card`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} className="toast__icon" />
      <div className="toast__body">
        <strong>{toast.title}</strong>
        {toast.message && <p>{toast.message}</p>}
        {toast.action && (
          <button
            type="button"
            className="btn btn--small toast__action"
            onClick={() => {
              toast.action?.run()
              dismiss(toast.id)
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
        <X size={14} />
      </button>
      {/* The lifetime bar doubles as the timer: it pauses on hover and dismisses when its animation ends. */}
      <span
        className="toast__life"
        style={{ '--life': `${toast.duration}ms` } as CSSProperties}
        onAnimationEnd={() => dismiss(toast.id)}
      />
    </li>
  )
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  return (
    <ol className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ol>
  )
}
