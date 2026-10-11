// The status pill every checklist item wears: always a word and an icon, never colour alone.
import type { Status } from '../engine/report'
import { STATUS } from './styles'

export function StatusPill({ status, className = '' }: { status: Status; className?: string }) {
  const { label, icon: Icon, tone } = STATUS[status]
  return (
    <span
      data-status={status}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-xs font-semibold tracking-wide whitespace-nowrap [&_svg]:size-3.5 ${tone} ${className}`}
    >
      <Icon strokeWidth={2.5} />
      {label}
    </span>
  )
}
