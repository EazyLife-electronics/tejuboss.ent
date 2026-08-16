// TejuBoss branding + grocery adaptation layer.
// Keeps the EazyLife admin engine intact while adapting its visible identity
// and product-editor terminology for Teju Boss Enterprise.
// Business logic and Firestore collection names remain unchanged.

const BRAND = {
  shortName: 'Teju Boss',
  fullName: 'Teju Boss Enterprise',
  accent: '#E11D48',
  accentDark: '#BE123C'
};

function replaceText(node) {
  if (node.nodeType !== Node.TEXT_NODE) return;
  const value = node.nodeValue;
  if (!value || !/EazyLife/i.test(value)) return;
  node.nodeValue = value
    .replace(/EazyLife Robotics & Electronics Solutions/gi, BRAND.fullName)
    .replace(/EazyLife Admin/gi, `${BRAND.shortName} Admin`)
    .replace(/EazyLife Customers/gi, `${BRAND.shortName} Customers`)
    .replace(/EazyLife/gi, BRAND.shortName);
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
  document.title = document.title.replace(/EazyLife/gi, BRAND.shortName);
  document.documentElement.style.setProperty('--teal', BRAND.accent);
  document.documentElement.style.setProperty('--lime', BRAND.accentDark);

  if (!document.getElementById('tejuboss-brand-overrides')) {
    const style = document.createElement('style');
    style.id = 'tejuboss-brand-overrides';
    style.textContent = `
      .bg-eazylife { background: linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accentDark}) !important; }
      .text-\\[\\#00B09B\\] { color: ${BRAND.accent} !important; }
      .focus\\:ring-2.focus\\:ring-\\[\\#00B09B\\]:focus { --tw-ring-color: ${BRAND.accent} !important; }
      .border-\\[\\#00B09B\\] { border-color: ${BRAND.accent} !important; }
    `;
    document.head.appendChild(style);
  }

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
    console.warn('TejuBoss grocery adaptation could not load:', err);
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
