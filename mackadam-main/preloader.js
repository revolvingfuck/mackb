// =====================================================================
// A brief loading screen over first paint.
//
// The heaviest things on this page are fetches sea.js and hand.js kick off
// themselves — hand-pose.bin, and, further out, a multi-megabyte
// ocean-cache.bin — plus the two custom @font-face files index.css declares.
// None of them block anything in sea.js by design: the sky and the analytic
// swell render before any of those land, so the page is never truly blank
// underneath this. This just keeps that bootstrap moment off screen instead
// of showing it happening.
//
// Dismissal waits for the brand fonts and the marble statue. The ocean sim is
// DELIBERATELY not on that list — it is a background enhancement over an
// already-correct analytic sea (see sea.js's own OCEAN_URL comment), and
// gating a preloader on a several-megabyte fetch is exactly the kind of thing
// this file avoids everywhere else. It fades in on its own once it lands.
//
// A hard timeout is the fallback: if a fetch stalls, or hand-pose.bin 404s
// somewhere this never gets re-tested, the preloader still clears and the
// visitor sees whatever loaded — never stuck behind a black screen because
// one asset had a bad day.
// =====================================================================

const el = document.getElementById('preloader');
if (el) {
  const MIN_MS = 350;    // long enough to read as a screen, not a flicker
  const MAX_MS = 6000;   // longer than that is the fetch's problem, not the visitor's

  const shownAt = performance.now();

  const fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();

  // hand.js assigns window.__hand synchronously and flips ready (or failed)
  // once its fetch settles — see the api object at the top of createMarbleHand.
  const handSettled = new Promise(resolve => {
    (function poll() {
      const h = window.__hand;
      if (h && (h.ready || h.failed)) resolve();
      else requestAnimationFrame(poll);
    })();
  });

  const timeout = new Promise(resolve => setTimeout(resolve, MAX_MS));

  Promise.race([Promise.all([fontsReady, handSettled]), timeout]).then(() => {
    const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
    setTimeout(hide, wait);
  });

  function hide() {
    el.classList.add('is-hidden');
    // The transitionend listener is the clean path; the timeout under it is
    // belt-and-braces for when no transition actually runs (reduced motion,
    // or a tab backgrounded through the fade, which some browsers pause).
    el.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 900);
  }

  function remove() {
    el.remove();
  }
}
