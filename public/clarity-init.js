// Arquivo local para manter a CSP sem permitir JavaScript inline.
(function (c, l, a, r, i, t, y) {
  // Contact details and commercial answers stay out of third-party session recording.
  if (c.location.pathname === '/diagnostico' || c.location.pathname.startsWith('/diagnostico/')) return;
  c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
  t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
  y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
})(window, document, 'clarity', 'script', 'yg895f90xc');
