function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function hexToRgb(hex) {
  const bigint = parseInt(hex.replace('#', ''), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function contrast(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const l1 = getLuminance(r1, g1, b1);
  const l2 = getLuminance(r2, g2, b2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

console.log("White on #475569 (secondary):", contrast("#ffffff", "#475569").toFixed(2));
console.log("#475569 on #f1f5f9 (muted-foreground on muted):", contrast("#475569", "#f1f5f9").toFixed(2));
console.log("#94a3b8 on #1e293b (dark muted-foreground on muted):", contrast("#94a3b8", "#1e293b").toFixed(2));
console.log("#075985 on #f0f9ff (info text on info bg):", contrast("#075985", "#f0f9ff").toFixed(2));
console.log("#713f12 on #fef9c3 (medium text on medium bg):", contrast("#713f12", "#fef9c3").toFixed(2));
