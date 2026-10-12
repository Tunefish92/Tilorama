import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface ToolButtonProps {
  icon?: LucideIcon
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children?: ReactNode
  tooltipAlign?: 'center' | 'end'
}

/** Square icon button with a tooltip that shows the label and keyboard shortcut. */
export function ToolButton({ icon: Icon, label, shortcut, onClick, disabled, active, children, tooltipAlign }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={shortcut ? `${label}  ·  ${shortcut}` : label}
      data-tooltip-align={tooltipAlign}
    >
      {Icon ? <Icon size={18} strokeWidth={1.8} /> : children}
    </button>
  )
}
