'use strict';

/**
 * frontend-helpers.js — Carrega scripts browser em JSDOM via <script> tags.
 *
 * Usando <script> inline no HTML garante que function declarations e
 * window.xxx = xxx fiquem acessíveis via dom.window mesmo em 'use strict'.
 */

const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CLIENT = path.join(__dirname, '../../client');

/**
 * Cria JSDOM com os scripts carregados como <script> tags inline.
 * @param {string[]} scripts — arquivos relativos a client/
 * @param {string}   [html]  — HTML base (sem scripts)
 */
function createDom(scripts = [], html = '<!DOCTYPE html><html><head></head><body></body></html>') {
  // Embute cada script como <script> inline antes de </body>
  const scriptTags = scripts.map(name => {
    const code = fs.readFileSync(path.join(CLIENT, name), 'utf8');
    // Escapa </script> dentro do código para não encerrar a tag prematuramente
    const escaped = code.replace(/<\/script>/gi, '<\\/script>');
    return `<script>${escaped}</script>`;
  }).join('\n');

  const fullHtml = html.replace('</body>', scriptTags + '\n</body>');

  const dom = new JSDOM(fullHtml, {
    runScripts: 'dangerously',
    url: 'http://localhost:3001',
  });

  // Stubs básicos
  dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  dom.window.BRANDING = undefined;

  return dom;
}

module.exports = { createDom, CLIENT };
