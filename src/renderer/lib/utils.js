import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * The shadcn `cn` helper, which the ElevenLabs UI components expect from
 * `@/lib/utils`.
 *
 * `clsx` flattens conditionals, arrays and objects into a class string;
 * `tailwind-merge` then drops earlier classes that a later one overrides. The
 * second half is the reason this exists rather than a plain join: the visualizer
 * ships both `bg-border` and a state-driven `bg-primary`, and without merging
 * them the winner would be decided by stylesheet order instead of by the caller.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
