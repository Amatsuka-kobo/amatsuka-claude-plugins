#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateSpec } from './lib/validate.mjs';
import { layoutEr } from './lib/layout/er.mjs';
import { layoutScreenFlow } from './lib/layout/screen-flow.mjs';
import { layoutArchitecture } from './lib/layout/architecture.mjs';
import { layoutSequence } from './lib/layout/sequence.mjs';
import { renderDrawio } from './lib/render/drawio.mjs';
import { renderHtml } from './lib/render/html.mjs';

const LAYOUTS = {
  er: layoutEr,
  'screen-flow': layoutScreenFlow,
  architecture: layoutArchitecture,
  sequence: layoutSequence,
};
const FORMATS = ['drawio', 'html', 'both'];

function fail(errors) {
  process.stdout.write(JSON.stringify({ ok: false, errors }) + '\n');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const formatIndex = args.indexOf('--format');
  const specArg = args.find((a, i) => !a.startsWith('--') && (formatIndex === -1 || i !== formatIndex + 1));
  const format = formatIndex === -1 ? 'both' : args[formatIndex + 1];

  if (!specArg) {
    fail(['usage: node design-gen.mjs <spec.json> --format <drawio|html|both>']);
  }
  if (!FORMATS.includes(format)) {
    fail([`--format: "${format}" は不正です(対応: ${FORMATS.join(', ')})`]);
  }

  let spec;
  try {
    spec = JSON.parse(readFileSync(specArg, 'utf8'));
  } catch (err) {
    fail([`spec ファイルを読めません: ${err.message}`]);
  }

  const errors = validateSpec(spec);
  if (errors.length > 0) fail(errors);

  const layout = LAYOUTS[spec.type](spec);

  const dir = path.dirname(path.resolve(specArg));
  const filename = path.basename(specArg);
  const base = filename.endsWith('.spec.json')
    ? filename.slice(0, -'.spec.json'.length)
    : filename.replace(/\.json$/, '');

  const files = [];
  if (format === 'drawio' || format === 'both') {
    const outPath = path.join(dir, `${base}.drawio`);
    writeFileSync(outPath, renderDrawio(layout));
    files.push(outPath);
  }
  if (format === 'html' || format === 'both') {
    const outPath = path.join(dir, `${base}.html`);
    writeFileSync(outPath, renderHtml(layout, spec));
    files.push(outPath);
  }
  process.stdout.write(JSON.stringify({ ok: true, files }) + '\n');
}

main();
