/* Tailwind build config.
   This file used to live inline in all six HTML pages as a `tailwind.config`
   global. It cannot stay there once Tailwind is compiled at build time: the
   runtime CDN script that read it is the 124 KiB render-blocking request that
   put mobile FCP at 4.4s, and a build has no browser to read an inline global
   from. One file, six pages, no chance of the copies drifting. */
module.exports = {
  darkMode: 'class',
  content: [
    './web/**/*.html',
    './web/app.js',
    // sw.js is included because it renders a few class names as strings when
    // it builds the offline fallback. Tailwind cannot see inside a string
    // unless the file is scanned, and a class it never saw is a class it never
    // emits.
    './web/sw.js'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef4ff',
          100: '#d9e5ff',
          400: '#4d86ff',
          500: '#2f6bff',
          600: '#1d4ff0'
        }
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui',
               '-apple-system', '"Helvetica Neue"', 'Arial', 'sans-serif']
      },
      keyframes: {
        // Slow, large-radius drift for the ambient background blobs.
        drift: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%':     { transform: 'translate(6%,-5%) scale(1.06)' },
          '66%':     { transform: 'translate(-5%,6%) scale(.95)' }
        },
        // Gentle bob for the floating hero icons.
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%':     { transform: 'translateY(-13px)' }
        },
        // Entrance for cards and sections, used with [animation-delay:].
        rise: {
          from: { opacity: '0', transform: 'translateY(26px)' },
          to:   { opacity: '1', transform: 'none' }
        },
        twinkle: {
          '0%,100%': { opacity: '.25', transform: 'scale(.85)' },
          '50%':     { opacity: '1',  transform: 'scale(1.1)' }
        },
        // The animated blue underline under the hero title. Named to match the
        // markup exactly (animate-drawLine), since a mismatch is silent.
        drawLine: {
          from: { strokeDashoffset: '340' },
          to:   { strokeDashoffset: '0' }
        },
        // Expanding ring on the live status dot.
        pulseRing: {
          '0%':   { transform: 'scale(.85)', opacity: '.7' },
          '100%': { transform: 'scale(2.2)', opacity: '0' }
        }
      },
      animation: {
        drift:     'drift 26s ease-in-out infinite',
        floaty:    'floaty 6s ease-in-out infinite',
        rise:      'rise .7s cubic-bezier(.22,1,.36,1) both',
        twinkle:   'twinkle 3.4s ease-in-out infinite',
        drawLine:  'drawLine 1.1s cubic-bezier(.22,1,.36,1) .35s both',
        pulseRing: 'pulseRing 2.4s ease-out infinite'
      }
    }
  }
};
