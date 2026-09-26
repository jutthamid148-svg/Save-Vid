// Verifies that every animate-* class in the markup actually resolves to an
// entry in the tailwind config. A mismatch is silent: the element just renders
// unanimated, with nothing in the console to explain why.
const fs = require('fs');
const s = fs.readFileSync('web/index.html', 'utf8');

const used = [...new Set([...s.matchAll(/animate-([a-zA-Z]+)/g)].map(m => m[1]))];
const start = s.indexOf('tailwind.config');
const cfg = s.slice(start, s.indexOf('</script>', start));

const bad = used.filter(a => !new RegExp('\\b' + a + "\\s*:\\s*'").test(cfg));
console.log('animate classes used:', used.join(', '));
console.log(bad.length ? 'UNRESOLVED: ' + bad.join(', ') : 'all resolve to config');

// Same check for the custom colour utilities, which are also config-only.
const colors = [...new Set([...s.matchAll(/\bbrand-(\d+)/g)].map(m => m[1]))];
const badC = colors.filter(c => !new RegExp('\\b' + c + ":\\s*'#").test(cfg));
console.log('brand colours used:', colors.join(', '));
console.log(badC.length ? 'UNRESOLVED COLOURS: ' + badC.join(', ') : 'all brand colours resolve');

// Every inline SVG needs either a sizing class or explicit width/height, or it
// stretches to fill its container.
const bare = [...s.matchAll(/<svg (?![^>]*(?:class=|width=))[^>]*>/g)];
console.log(bare.length ? 'UNSIZED SVGS: ' + bare.length : 'every svg is sized');

// And the skip link must stay hidden until focused.
console.log(s.includes('class="sr-only focus:not-sr-only')
  ? 'skip link classes intact'
  : 'SKIP LINK CLASSES LOST');
