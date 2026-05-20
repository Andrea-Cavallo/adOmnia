import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: 'default' | 'ghost'
  size?: 'sm' | 'default'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 outline-none transition-colors',
          'focus:border-accent focus:ring-1 focus:ring-accent/30',
          variant === 'ghost' && 'bg-transparent border-transparent hover:border-border-2 focus:border-accent focus:bg-surface-2',
          size === 'sm' && 'h-7 px-2 text-xs',
          size === 'default' && 'h-9 px-3 text-sm',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    )
  },
)

Input.displayName = 'Input'
