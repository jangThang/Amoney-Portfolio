import fs from 'node:fs/promises';

const enhancementSource = await fs.readFile(new URL('../portfolio-enhancements.js', import.meta.url), 'utf8');
new Function(enhancementSource);

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean);

scripts.forEach((script, index) => {
  try {
    new Function(script);
  } catch (error) {
    throw new Error(`index.html inline script ${index + 1}: ${error.message}`);
  }
});

console.log(`OK portfolio-enhancements.js and ${scripts.length} inline scripts`);

