const dismissalKey = 'shelf-install-dismissed';
const phone = window.matchMedia('(max-width: 720px) and (pointer: coarse)');
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const applePhone = /iPhone|iPod/.test(navigator.userAgent);
let installPrompt;
let dismissed;
try { dismissed = localStorage.getItem(dismissalKey) === '1'; }
catch { dismissed = true; } // Don't repeat a recommendation when dismissal cannot be remembered.

function updateRecommendation() {
  const recommendation = document.querySelector('.install-recommendation');
  if (!recommendation) return;
  recommendation.hidden = dismissed || standalone() || !phone.matches || (!installPrompt && !applePhone);
  recommendation.querySelector('.install-app').hidden = !installPrompt;
  const message = applePhone && !installPrompt
    ? 'In your browser, open Share, then Add to Home Screen.'
    : 'Open the library from your home screen.';
  const paragraph = recommendation.querySelector('.install-message');
  if (paragraph.textContent !== message) paragraph.textContent = message;
}
function dismissRecommendation() {
  dismissed = true;
  try { localStorage.setItem(dismissalKey, '1'); } catch { /* Keep it dismissed for this visit. */ }
  updateRecommendation();
}
window.addEventListener('beforeinstallprompt', event => {
  if (standalone()) return;
  event.preventDefault();
  installPrompt = event;
  updateRecommendation();
});
window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  dismissRecommendation();
});
phone.addEventListener('change', updateRecommendation);
// The signed-in reader mounts after its session check, including after route changes.
new MutationObserver(updateRecommendation).observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', async event => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.dismiss-install')) { dismissRecommendation(); return; }
  if (!event.target.closest('button.install-app') || !installPrompt) return;
  const prompt = installPrompt;
  installPrompt = undefined;
  dismissRecommendation(); // Both acceptance and dismissal end this recommendation.
  try { await prompt.prompt(); }
  catch (error) { console.warn('Shelf installation prompt was unavailable.', error); }
});
let swipe;
document.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && event.target instanceof Element && event.target.closest('.install-recommendation')) swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
document.addEventListener('pointerup', event => {
  if (swipe?.id === event.pointerId && Math.abs(event.clientX - swipe.x) > 80 && Math.abs(event.clientY - swipe.y) < 50) dismissRecommendation();
  swipe = undefined;
});
document.addEventListener('pointercancel', () => { swipe = undefined; });
updateRecommendation();

if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch(error => console.warn('Shelf offline page could not be registered.', error));
}
