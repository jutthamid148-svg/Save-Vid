// Generates the static legal + content pages from one shared shell, so the nav,
// footer and styling can never drift between them.
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, 'web');
const SITE = 'https://savevid.net';
const TODAY = '26 September 2026';

const NAV = [
  ['/', 'Downloader'],
  ['/#how-to', 'How to'],
  ['/#faq', 'FAQ'],
  ['/about.html', 'About'],
  ['/contact.html', 'Contact']
];

const LEGAL_NAV = [
  ['/about.html', 'About'],
  ['/privacy.html', 'Privacy Policy'],
  ['/terms.html', 'Terms of Service'],
  ['/dmca.html', 'DMCA & Copyright'],
  ['/contact.html', 'Contact']
];

function shell({ title, description, canonical, body, nav, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<link rel="canonical" href="${SITE}${canonical}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="SaveVid.net" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${SITE}${canonical}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />

<meta name="theme-color" content="#070b12" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="stylesheet" href="/styles.css" />
<link rel="stylesheet" href="/legal.css" />
${extraHead}
</head>
<body class="bg-slate-50 text-slate-800 dark:bg-[#070b12] dark:text-slate-200">

<a href="#main" class="skip">Skip to content</a>

<header class="border-b border-slate-200 bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#070b12]/85">
  <div class="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3.5">
    <a href="/" class="flex items-center gap-2.5 font-bold tracking-tight">
      <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M12 15l-5-5M12 15l5-5M5 20h14"/></svg>
      </span>
      <span class="text-lg">SaveVid<span class="text-brand-500">.net</span></span>
    </a>
    <nav class="hidden gap-5 text-sm font-medium sm:flex" aria-label="Main">
      ${nav.map(([h, l]) => `<a href="${h}" class="text-slate-600 transition hover:text-brand-500 dark:text-slate-300 dark:hover:text-brand-400">${l}</a>`).join('\n      ')}
    </nav>
    <a href="/" class="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600">Download</a>
  </div>
</header>

<main id="main" class="mx-auto max-w-4xl px-4 py-12 sm:py-16">
${body}
</main>

<footer class="border-t border-slate-200 py-10 text-sm dark:border-white/10">
  <div class="mx-auto max-w-4xl px-4">
    <p class="mb-4 font-semibold">SaveVid.net</p>
    <nav class="mb-6 flex flex-wrap gap-x-5 gap-y-2" aria-label="Legal">
      ${LEGAL_NAV.map(([h, l]) => `<a href="${h}" class="text-slate-500 transition hover:text-brand-500 dark:text-slate-400">${l}</a>`).join('\n      ')}
    </nav>
    <p class="text-slate-500 dark:text-slate-400">
      &copy; ${new Date().getFullYear()} SaveVid.net — an independent utility. Not affiliated with, endorsed by, or sponsored by YouTube, Google, TikTok, Instagram, Facebook, X, or any other platform listed.
      Only download content you own or have permission to save.
    </p>
  </div>
</footer>

</body>
</html>
`;
}

const H1 = (t) => `<h1 class="mb-3 text-3xl font-extrabold tracking-tight sm:text-4xl">${t}</h1>`;
const H2 = (t) => `<h2 class="mt-10 mb-3 text-xl font-bold tracking-tight sm:text-2xl">${t}</h2>`;
const P = (t) => `<p class="mb-4 leading-relaxed text-slate-600 dark:text-slate-400">${t}</p>`;
const UL = (items) => `<ul class="mb-4 space-y-2 pl-5 text-slate-600 dark:text-slate-400">\n${items.map((i) => `  <li>${i}</li>`).join('\n')}\n</ul>`;
const UPDATED = `<p class="mb-8 text-sm text-slate-500 dark:text-slate-500">Last updated: ${TODAY}</p>`;

// --------------------------------------------------------------------------
const pages = {
  'privacy.html': {
    title: 'Privacy Policy — SaveVid.net',
    description: 'How SaveVid.net handles your data: what we collect, what we do not, cookies and advertising, and how to contact us.',
    canonical: '/privacy.html',
    body: `${H1('Privacy Policy')}
${UPDATED}
${P('SaveVid.net ("we", "us") built this service to do one thing quickly and without fuss: hand you a file you asked for. This policy explains what happens to your data while that happens.')}
${H2('What we collect')}
${P('SaveVid.net is built to be useful with as little stored as possible.')}
${UL([
  '<strong>Links you paste.</strong> The URL you submit is sent to our server so it can fetch the video and give you a download. It is held in a short-lived in-memory cache (minutes, not months) purely to make a repeat request fast, and is never written to disk.',
  '<strong>Standard server logs.</strong> Our host records IP address, timestamp, requested path, user agent and referrer, as every web server does, for security and abuse prevention.',
  '<strong>Preferences you set.</strong> Your dark/light mode choice and any dismissed banners are kept in your own browser\'s <code>localStorage</code>. They never leave your device.',
  '<strong>Files you download.</strong> These go straight from the source CDN through our server to you. We do not store, keep, mirror or re-host them, and we have no copy after the transfer finishes.'
])}
${H2('What we do not collect')}
${UL([
  'We do not ask for, and do not have, an account system. There is no login, no password, no email capture on the downloader.',
  'We do not build a profile of you or track you across other websites.',
  'We do not sell or share personal data with data brokers.'
])}
${H2('Cookies and advertising')}
${P('SaveVid.net itself sets no tracking cookies. It does not use analytics trackers on the downloader page.')}
${P('Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this and other websites. Google\'s use of advertising cookies enables it and its partners to serve ads to you based on your visit to this and/or other sites on the internet.')}
${P('You may opt out of personalised advertising by visiting <a href="https://www.google.com/settings/ads" rel="nofollow noopener" target="_blank">Google Ads Settings</a>. You can opt out of third-party vendor cookie use for personalised advertising at <a href="https://www.aboutads.info/choices/" rel="nofollow noopener" target="_blank">aboutads.info</a>.')}
${P('AdSense and its partners may use cookies or device identifiers to serve and measure ads. You can control how personalised ads are shown across the web at <a href="https://www.google.com/controlyourads" rel="nofollow noopener" target="_blank">Google\'s ad controls</a>.')}
${H2('Children')}
${P('SaveVid.net is a general-audience service and is not directed at children under 13. We do not knowingly collect personal information from children. If you believe a child has sent us personal information, contact us and we will delete it.')}
${H2('Data retention')}
${UL([
  'Server logs: retained by our hosting provider for a short operational period, typically under 30 days.',
  'Video URL cache: held in server memory only, expiring within minutes, and cleared whenever the process restarts.',
  'Downloads: not retained at all.'
])}
${H2('Your rights')}
${P('Depending on where you live, you may have the right to access, correct, export or delete personal data we hold about you. Because we do not maintain accounts and do not keep a database of users, in practice there is usually nothing to export. If you have a question or a request, email us and we will respond within 30 days.')}
${H2('Security')}
${P('All traffic to SaveVid.net is served over HTTPS. Links you paste are held only in volatile memory for the few seconds needed to produce your download, and we do not share them with third parties for their own purposes.')}
${H2('Changes to this policy')}
${P('We may update this page as the service changes. The date at the top always reflects the current version. Material changes will be noted on this page.')}
${H2('Contact')}
${P('Questions about privacy? Use the <a href="/contact.html">contact form</a> or email <a href="mailto:privacy@savevid.net">privacy@savevid.net</a>.')}
`
  },

  'terms.html': {
    title: 'Terms of Service — SaveVid.net',
    description: 'The terms that govern your use of SaveVid.net, including acceptable use, intellectual property, and limitation of liability.',
    canonical: '/terms.html',
    body: `${H1('Terms of Service')}
${UPDATED}
${P('By using SaveVid.net ("the Service", "we", "us") you agree to these terms. If you do not agree, please do not use the Service.')}
${H2('1. What the Service is')}
${P('SaveVid.net is a free utility that helps you save video and audio files that are publicly available on third-party platforms for personal, non-commercial use. It is an independent tool. We are not affiliated with, endorsed by, or sponsored by YouTube, Google LLC, TikTok, Instagram, Facebook, X/Twitter, Vimeo, Dailymotion, SoundCloud, or any other platform whose content the Service can retrieve.')}
${H2('2. Acceptable use — the part that matters most')}
${P('You are solely responsible for what you download. By using the Service you agree that:')}
${UL([
  'You will only download content you <strong>own</strong>, content created by you, content published under a licence that permits downloading and redistribution, content in the public domain, or content you have <strong>express written permission</strong> to save.',
  'You will not use the Service to infringe copyright, trademark, database, publicity or other intellectual-property rights of anyone.',
  'You will not use the Service to download anything private, paywalled, DRM-protected, or otherwise access-controlled. If content is not publicly available, it is not available here.',
  'You will not use the Service to build a dataset, mirror, archive or redistribution library of third-party media, or to train a machine-learning model.',
  'You will not use the Service for commercial resale, or in a way that competes with the original rights holder.',
  'You will not circumvent, break, or attempt to break any access control, rate limit, geographic restriction, or technical protection measure of any platform.',
  'You will not abuse, overload, scrape, reverse-engineer or probe the Service, and will not attempt to bypass our rate limits or anti-abuse measures.'
])}
${H2('3. Your responsibilities')}
${P('You are responsible for the legality of your download in your jurisdiction. Some countries have narrow exceptions to copyright for personal use; many do not, and the law is still developing. When in doubt, ask before you save.')}
${H2('4. Our content and branding')}
${P('The SaveVid.net name, logo, interface, layout and written content are our property. You may link to the Service and quote short extracts with attribution. You may not reproduce the interface, rebrand it, or present a copy of the Service as your own.')}
${H2('5. No warranty')}
${P('The Service is provided "as is" and "as available", without warranty of any kind, express or implied, including fitness for a particular purpose, merchantability, non-infringement, and uninterrupted availability. We do not warrant that the Service will be error-free, that any file will be retrievable, or that a download will be complete.')}
${H2('6. Limitation of liability')}
${P('To the fullest extent permitted by law, we are not liable for any indirect, incidental, special, consequential or punitive damages, nor for any loss of data, profits, revenue or goodwill, arising out of or in connection with your use of the Service. This includes any claim that downloaded material infringes a third party\'s rights — that responsibility lies with you, not with us.')}
${H2('7. Third-party content')}
${P('Content you retrieve through the Service remains the property of its rightsholders. We host no media. We provide a tool; you decide what to point it at.')}
${H2('8. Suspension and termination')}
${P('We may rate-limit, block, or refuse access to anyone who breaches these terms, who abuses the Service, or whom we are asked by a rights holder or court order to block. We may also modify or discontinue any part of the Service at any time without notice.')}
${H2('9. Indemnity')}
${P('You agree to indemnify and hold harmless SaveVid.net and its operators from any claim, demand, loss or expense (including reasonable legal fees) arising out of your use of the Service or your breach of these terms.')}
${H2('10. Changes')}
${P('We may revise these terms. Continued use after a revision means you accept the revised terms. If you disagree, stop using the Service.')}
${H2('11. Severability and governing law')}
${P('If a provision of these terms is found unenforceable, the rest remains in force. These terms are governed by the laws applicable at our principal place of business, without regard to conflict-of-law rules, and without limiting any mandatory consumer protections available to you where you live.')}
${H2('12. Contact')}
${P('Questions about these terms? Use the <a href="/contact.html">contact form</a>.')}
`
  },

  'dmca.html': {
    title: 'DMCA & Copyright Notice — SaveVid.net',
    description: 'SaveVid.net respects copyright. Our DMCA policy, takedown procedure, and the notice we require rights holders to send.',
    canonical: '/dmca.html',
    body: `${H1('DMCA & Copyright Notice')}
${UPDATED}

<div class="notice">
  <p class="mb-0 text-lg font-bold">WE DO NOT ALLOW OR SUPPORT THE DOWNLOAD OF COPYRIGHTED MATERIAL.</p>
  <p class="mb-0 mt-2">SaveVid.net does not host, store, mirror, index or pre-cache any video, audio, image or other media file. It is a tool that retrieves publicly available media at your request and passes it directly to your device. Every download is initiated by the individual user, and no copy is retained afterwards.</p>
</div>

${H2('Our position')}
${P('Copyright law protects the creator, not the container. We built a tool; we did not build a library. But that distinction does not mean we are neutral in practice: we will not knowingly help anyone use SaveVid.net to infringe, and we will act promptly and without argument on a valid takedown.')}
${H2('What we do')}
${UL([
  'We host no media of any kind. There is nothing on our servers to remove.',
  'We operate a repeat-infringer policy and will terminate access for repeat violators.',
  'We honour properly formed DMCA takedown notices without requiring the rights holder to open a court case first.',
  'We keep a record of notices received, and block access to URLs named in a notice.'
])}
${H2('What you must not do')}
${P('Do not use SaveVid.net to download material you do not own and do not have permission to save. This includes commercial re-uploads, compilations, clips taken from movies, television or music, ripped streams behind a paywall or DRM, and any material where the uploader did not hold the rights to redistribute it.')}
${H2('How to file a takedown notice')}
${P('If you are a rights holder (or your agent) and believe content reachable through SaveVid.net infringes your copyright, send a written notice to <a href="mailto:dmca@savevid.net">dmca@savevid.net</a> that includes all of the following:')}
${UL([
  'Your full legal name and contact information (address, telephone number, email address).',
  'Identification of the copyrighted work claimed to have been infringed. If the work is a compilation, identify the material complained of and the specific work it appears within.',
  'The exact URL(s) where the infringing material is located on SaveVid.net, with enough detail for us to identify them.',
  'Your statement, made under penalty of perjury, that the disputed use is not authorised by the copyright owner, its agent, or the law.',
  'Your signature, or the signature of your authorised agent, followed by the date.',
  'A statement that you have in good faith believed the use is not permitted by the copyright owner, its agent, or the law.',
  'A statement, under penalty of perjury, that the information in the notice is accurate and that you are the rights holder or authorised to act on their behalf.'
])}
${P('Incomplete notices cannot be actioned. Email is the fastest route; a formal physical letter is not required.')}
${H2('Counter-notices')}
${P('If you believe your material was removed by mistake or misidentification, you may send a counter-notice to the same address containing: your signature, identification of the removed material and where it appeared, a statement under penalty of perjury that you have a good-faith belief the removal was a mistake or misidentification, your consent to the jurisdiction of the appropriate federal court, and your contact information. If we receive a valid counter-notice we may restore the material after 10 business days unless the original complainant notifies us that they have filed a court action.')}
${H2('Repeat infringers')}
${P('In line with 17 U.S.C. § 512(i), we will block access to any repeat infringer. "Repeat infringer" is a user who has received a valid notice in the preceding twelve months.')}
${H2('Note on the DMCA and fair use')}
${P('The DMCA is a notice-and-takedown mechanism, not a censorship list. Filing a notice is a legal statement, and filing a false one is itself actionable. We do not adjudicate who owns what — we act on documented notices and let the legal process sort out disputes.')}
${H2('Contact')}
${P('All copyright correspondence goes to <a href="mailto:dmca@savevid.net">dmca@savevid.net</a>. Please do not send general support questions there.')}
`
  },

  'about.html': {
    title: 'About SaveVid.net — A Free Video Downloader Utility',
    description: 'SaveVid.net is an independent, free, no-signup tool for saving publicly available video and audio to your own device. Here is what it does and how it works.',
    canonical: '/about.html',
    body: `${H1('About SaveVid.net')}
${UPDATED}
${P('SaveVid.net is a small, independent utility built around one job: getting a publicly available video or audio file onto your own device, quickly, without asking you to create an account.')}
${H2('What we do')}
${UL([
  '<strong>Fast.</strong> Metadata and available quality options usually appear in two to three seconds, because the title, thumbnail and format list are fetched in parallel and repeat lookups are served from a short-lived cache.',
  '<strong>No account.</strong> There is no sign-up, no email capture, no paywall on the basic features and no "premium" tier.',
  '<strong>Nothing stored.</strong> Files stream straight from the source platform to your device. We never write them to our own disk.',
  '<strong>Open about the law.</strong> We tell you plainly what the tool is for, what it is not for, and how rights holders reach us.'
])}
${H2('How it works')}
${P('When you paste a link, SaveVid.net asks the source platform for the public metadata about that video — its title, thumbnail and the list of formats it offers. Your browser then requests the file you chose directly from the platform\'s own delivery network, passing through our server only to set the correct filename and save it. The video is never copied to or held on our hardware.')}
${P('A recent look-up of the same link is answered from an in-memory cache, which is why the second visit to the same video is effectively instant.')}
${H2('How we are paid')}
${P('SaveVid.net is free to use and funded by advertising. Ad placements are labelled and kept out of the download controls. We do not accept payment to feature, rank or promote any video, and we do not accept payment to remove a notice.')}
${H2('What we ask of you')}
${P('The tool is powerful, which puts the responsibility on the person using it. Please download only what you own or have permission to save — your own uploads, Creative Commons or licensed material, public-domain works, and content a creator has explicitly allowed you to download. If you are not sure whether something is fair to keep, the answer is usually no.')}
${H2('Independence')}
${P('SaveVid.net is not affiliated with YouTube, Google, TikTok, Instagram, Facebook, X, Vimeo, Dailymotion, SoundCloud or any other platform we support. We do not host or mirror their media, we do not have access to private or paywalled content, and we cannot help you get at anything a platform has chosen to protect.')}
${H2('Contact')}
${P('Questions, corrections or takedown requests are all welcome — use the <a href="/contact.html">contact form</a>.')}
`
  },

  'contact.html': {
    title: 'Contact SaveVid.net',
    description: 'Get in touch with the SaveVid.net team: support, copyright and DMCA takedown requests, advertising, bug reports and feedback.',
    canonical: '/contact.html',
    body: `${H1('Contact Us')}
${UPDATED}
${P('The fastest way to reach us is the form below. It posts straight to our inbox — nothing is stored on this site, and nothing you type here is sent to any third party.')}
${UL([
  '<strong>Copyright / DMCA:</strong> <a href="mailto:dmca@savevid.net">dmca@savevid.net</a> — see the <a href="/dmca.html">DMCA &amp; Copyright page</a> for the exact notice required.',
  '<strong>Privacy:</strong> <a href="mailto:privacy@savevid.net">privacy@savevid.net</a>',
  '<strong>Everything else:</strong> use the form.'
])}

<form id="contactForm" class="mt-8 space-y-5" novalidate>
  <div>
    <label for="cName" class="mb-1.5 block text-sm font-semibold">Your name</label>
    <input id="cName" name="name" type="text" required autocomplete="name" maxlength="120"
           class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-white/[0.06]" />
  </div>
  <div>
    <label for="cEmail" class="mb-1.5 block text-sm font-semibold">Your email</label>
    <input id="cEmail" name="email" type="email" required autocomplete="email" maxlength="200"
           class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-white/[0.06]" />
    <p class="mt-1.5 text-xs text-slate-500 dark:text-slate-500">We only use this to reply to you.</p>
  </div>
  <div>
    <label for="cTopic" class="mb-1.5 block text-sm font-semibold">Topic</label>
    <select id="cTopic" name="topic"
            class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-white/[0.06]">
      <option>General question</option>
      <option>Something is not working</option>
      <option>Copyright / DMCA notice</option>
      <option>Privacy request</option>
      <option>Advertising enquiry</option>
      <option>Other</option>
    </select>
  </div>
  <div>
    <label for="cMsg" class="mb-1.5 block text-sm font-semibold">Message</label>
    <textarea id="cMsg" name="message" rows="6" required maxlength="4000"
              class="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-white/[0.06]"></textarea>
    <p class="mt-1.5 text-xs text-slate-500 dark:text-slate-500">
      <span id="cCount">0</span> / 4000. Do not include links to infringing material.
    </p>
  </div>
  <button type="submit"
          class="rounded-xl bg-brand-500 px-6 py-3 font-semibold text-white transition hover:bg-brand-600 disabled:cursor-wait disabled:opacity-60">
    Send message
  </button>
  <p id="cStatus" role="status" aria-live="polite" class="hidden text-sm font-medium"></p>
</form>

<p class="mt-10 text-sm text-slate-500 dark:text-slate-500">
  SaveVid.net is an independent utility and is not affiliated with any platform listed on this site.
</p>

<script>
(function () {
  var form = document.getElementById('contactForm');
  var msg = document.getElementById('cMsg');
  var count = document.getElementById('cCount');
  var status = document.getElementById('cStatus');
  var btn = form.querySelector('button[type=submit]');

  msg.addEventListener('input', function () { count.textContent = msg.value.length; });

  function say(text, ok) {
    status.textContent = text;
    status.className = 'text-sm font-medium ' + (ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();

    // There is no mail backend behind this page, and silently pretending a
    // message was sent would be dishonest. So we validate properly, then hand
    // the user a real, pre-filled mail client.
    if (!form.reportValidity()) return;

    var name  = form.name.value.trim();
    var email = form.email.value.trim();
    var topic = form.topic.value;
    var body  = msg.value.trim();

    var href = 'mailto:contact@savevid.net'
      + '?subject=' + encodeURIComponent('[' + topic + '] from ' + name)
      + '&body=' + encodeURIComponent(body + '\\n\\n---\\nFrom: ' + name + ' <' + email + '>');

    btn.disabled = true;
    say('Opening your email app…', true);
    window.location.href = href;
    setTimeout(function () {
      btn.disabled = false;
      say('If nothing opened, email us directly at contact@savevid.net.', false);
    }, 2500);
  });
})();
</script>
`
  }
};

for (const [file, cfg] of Object.entries(pages)) {
  fs.writeFileSync(path.join(WEB, file), shell({ ...cfg, nav: NAV }));
  console.log(file, 'written');
}
