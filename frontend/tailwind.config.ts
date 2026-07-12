import type { Config } from 'tailwindcss'

const fluid = (min: number, max: number) => `clamp(${min}px, ${min}px + ${(max - min).toFixed(2)} * ((100vw - 320px) / 1120), ${max}px)`

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
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
        ui: [fluid(13, 18)],
        mono: [fluid(12.5, 17)],
        xs: [fluid(11, 15)],
        sm: [fluid(12, 16)],
        base: [fluid(14, 20)],
        lg: [fluid(16, 24)],
        xl: [fluid(18, 28)],
        '2xl': [fluid(22, 30)],
        '3xl': [fluid(28, 36)],
      },
      spacing: {
        'fluid-1': fluid(4, 8),
        'fluid-2': fluid(8, 12),
        'fluid-3': fluid(12, 16),
        'fluid-4': fluid(16, 24),
        'fluid-5': fluid(20, 32),
        'fluid-6': fluid(24, 40),
        'fluid-8': fluid(32, 56),
        'fluid-10': fluid(40, 72),
      },
      width: {
        'modal-sm': fluid(320, 420),
        'modal-md': fluid(420, 560),
        'modal-lg': fluid(560, 760),
        'modal-xl': fluid(700, 960),
        'modal-full': fluid(800, 1200),
      },
      maxWidth: {
        'modal-sm': fluid(320, 420),
        'modal-md': fluid(420, 560),
        'modal-lg': fluid(560, 760),
        'modal-xl': fluid(700, 960),
        'modal-full': fluid(800, 1200),
      },
      height: {
        'modal-sm': fluid(240, 320),
        'modal-md': fluid(320, 480),
        'modal-lg': fluid(400, 600),
      },
      maxHeight: {
        'modal-content': fluid(400, 680),
      },
      gap: {
        'fluid-1': fluid(4, 8),
        'fluid-2': fluid(8, 12),
        'fluid-3': fluid(12, 16),
        'fluid-4': fluid(16, 24),
      },
    },
  },
  plugins: [],
}

export default config
