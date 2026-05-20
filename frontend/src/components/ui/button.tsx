import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-fluid-1 whitespace-nowrap rounded font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white hover:bg-accent-light',
        secondary: 'bg-surface-3 text-text-1 hover:bg-surface-4',
        ghost: 'text-text-2 hover:bg-surface-2 hover:text-text-1',
        destructive: 'bg-status-err text-white hover:bg-status-err/80',
        outline: 'border border-border-2 text-text-2 hover:bg-surface-2 hover:text-text-1',
      },
      size: {
        sm: 'h-7 px-fluid-2 text-xs',
        default: 'h-8 px-fluid-3 text-sm',
        lg: 'h-10 px-fluid-4 text-base',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'
