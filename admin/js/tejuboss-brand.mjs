// Teju Boss Enterprise — admin theme + defensive text safety net.
// The storefront and admin HTML/CSS already carry Teju Boss branding directly
// in source. This file just (a) sets the CSS accent variables the admin shell
// reads, and (b) catches any stray "EazyLife" text that might still surface
// from old cached data (e.g. a product typed before the rename), so nothing
// EazyLife-branded is ever shown to a Teju Boss customer or admin.

const BRAND = {
  shortName: 'Teju Boss',
  accent: '#DC2626',
  accentDark: '#B91C1C'
};

function replaceText(node) {
  if (node.nodeType !== Node.TEXT_NODE) return;
  const value = node.nodeValue;
  if (!value || !/EazyLife/i.test(value)) return;
  node.nodeValue = value.replace(/EazyLife/gi, BRAND.shortName);
}

function replaceAttributes(root) {
  root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const value = el.getAttribute(attr);
      if (value && /EazyLife/i.test(value)) {
        el.setAttribute(attr, value.replace(/EazyLife/gi, BRAND.shortName));
      }
    }
  });
}

function applyBranding() {
  document.documentElement.style.setProperty('--teal', BRAND.accent);
  document.documentElement.style.setProperty('--lime', BRAND.accentDark);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceText);
  replaceAttributes(document);
}

async function loadGroceryAdaptation() {
  try {
    await import('./tejuboss-grocery.mjs');
  } catch (err) {
    console.warn('Teju Boss grocery adaptation could not load:', err);
  }
}

if (typeof document !== 'undefined' && location.pathname.includes('/admin/')) {
  const start = () => {
    applyBranding();
    loadGroceryAdaptation();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) replaceText(node);
        else if (node.nodeType === Node.ELEMENT_NODE) {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          nodes.forEach(replaceText);
          replaceAttributes(node);
        }
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}
