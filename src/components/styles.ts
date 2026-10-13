// Shared class builders and the status table: buttons (as in UPOU OER: a maroon fill for the main
// action, a quiet surface for the rest) and the word, icon and tone each status shows.
import type { ComponentType, SVGProps } from 'react'
import type { Status } from '../engine/report'
import { CheckIcon, FixIcon, MinusIcon, ReviewIcon } from './icons'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap transition-[background-color,color,border-color,box-shadow,translate,filter] duration-200 ease-out-soft select-none disabled:pointer-events-none disabled:opacity-50 motion-safe:active:translate-y-px'
const LIFT = 'motion-safe:hover:-translate-y-0.5'
const VARIANT: Record<ButtonVariant, string> = {
  primary: `border border-transparent bg-action bg-(image:--gradient-action) text-on-action shadow-(--shadow-action) hover:brightness-110 focus-visible:brightness-110 ${LIFT}`,
  secondary: `border border-line bg-surface text-ink shadow-(--shadow-elev-1) hover:border-ink-3/50 hover:shadow-(--shadow-elev-2) ${LIFT}`,
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
}
// Heights keep every target at 40px or more.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-10 px-3.5 text-sm [&_svg]:size-4',
  md: 'h-11 px-5 text-sm [&_svg]:size-[1.125rem]',
  lg: 'h-13 px-7 text-base [&_svg]:size-5',
}

export const buttonClass = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
) => `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim()

export const STATUS: Record<
  Status,
  { label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; tone: string }
> = {
  fix: { label: 'Needs update', icon: FixIcon, tone: 'bg-fix-soft text-fix' },
  review: { label: 'To review', icon: ReviewIcon, tone: 'bg-review-soft text-review' },
  ok: { label: 'Passed', icon: CheckIcon, tone: 'bg-ok-soft text-ok' },
  na: { label: 'Not applicable', icon: MinusIcon, tone: 'bg-surface-2 text-ink-3' },
}
