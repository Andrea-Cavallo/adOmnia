import type { Config } from 'tailwindcss'
import fluid, { extract, screens, fontSize } from 'fluid-tailwind'

const config: Config = {
  darkMode: 'class',
  content: {
    files: ['./index.html', './src/**/*.{ts,tsx}'],
    extract,
  },
  theme: {
    screens,
    fontSize,
    extend: {
      colors: {
        surface: {
          0: 'var(--color-surface-0)',
          1: 'var(--color-surface-1)',
          2: 'var(--color-surface-2)',
          3: 'var(--color-surface-3)',
          4: 'var(--color-surface-4)',
        },
        border: {
          1: 'var(--color-border-1)',
          2: 'var(--color-border-2)',
          3: 'var(--color-border-3)',
        },
        text: {
          1: 'var(--color-text-1)',
          2: 'var(--color-text-2)',
          3: 'var(--color-text-3)',
          4: 'var(--color-text-4)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          light: 'var(--color-accent-light)',
          dark: 'var(--color-accent-dark)',
          glow: 'var(--color-accent-glow)',
          hover: 'var(--color-accent-hover)',
        },
        method: {
          get: 'var(--color-method-get)',
          post: 'var(--color-method-post)',
          put: 'var(--color-method-put)',
          patch: 'var(--color-method-patch)',
          delete: 'var(--color-method-delete)',
          head: 'var(--color-method-head)',
        },
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
        status: {
          ok: 'var(--color-success)',
          warn: 'var(--color-warning)',
          err: 'var(--color-error)',
        },
        // JSON syntax highlight — theme-aware, override per skin
        json: {
          key:    'var(--color-json-key)',
          string: 'var(--color-json-string)',
          number: 'var(--color-json-number)',
          bool:   'var(--color-json-bool)',
          null:   'var(--color-json-null)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui)', 'var(--font-sans)'],
        mono: ['var(--font-mono)'],
        serif: ['var(--font-serif)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontSize: {
        ui: ['~13px/~18px'],
        mono: ['~12.5px/~17px'],
        xs: ['~11px/~15px'],
        sm: ['~12px/~16px'],
        base: ['~14px/~20px'],
        lg: ['~16px/~24px'],
        xl: ['~18px/~28px'],
        '2xl': ['~22px/~30px'],
        '3xl': ['~28px/~36px'],
      },
      spacing: {
        'fluid-1': '~4px/~8px',
        'fluid-2': '~8px/~12px',
        'fluid-3': '~12px/~16px',
        'fluid-4': '~16px/~24px',
        'fluid-5': '~20px/~32px',
        'fluid-6': '~24px/~40px',
        'fluid-8': '~32px/~56px',
        'fluid-10': '~40px/~72px',
      },
      width: {
        'modal-sm': '~320px/~420px',
        'modal-md': '~420px/~560px',
        'modal-lg': '~560px/~760px',
        'modal-xl': '~700px/~960px',
        'modal-full': '~800px/~1200px',
      },
      maxWidth: {
        'modal-sm': '~320px/~420px',
        'modal-md': '~420px/~560px',
        'modal-lg': '~560px/~760px',
        'modal-xl': '~700px/~960px',
        'modal-full': '~800px/~1200px',
      },
      height: {
        'modal-sm': '~240px/~320px',
        'modal-md': '~320px/~480px',
        'modal-lg': '~400px/~600px',
      },
      maxHeight: {
        'modal-content': '~400px/~680px',
      },
      gap: {
        'fluid-1': '~4px/~8px',
        'fluid-2': '~8px/~12px',
        'fluid-3': '~12px/~16px',
        'fluid-4': '~16px/~24px',
      },
    },
  },
  plugins: [fluid],
}

export default config
