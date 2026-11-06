import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const canonical = (text) => String(text).replace(/\r\n/g, '\n').trim();

export function renderCargoAbout(data) {
  if (!Array.isArray(data?.crates) || !data.crates.length || !Array.isArray(data?.licenses) || !data.licenses.length) {
    throw new Error('cargo-about JSON sem crates/licenses; aviso Deno obrigatório não pode ser gerado.');
  }

  const associados = new Set();
  const grupos = new Map();
  for (const license of data.licenses) {
    const text = canonical(license.text);
    if (!license.id || !text || !Array.isArray(license.used_by) || !license.used_by.length) {
      throw new Error(`cargo-about retornou licença sem id/texto/associação: ${license.id ?? '(sem id)'}`);
    }
    const hash = sha256(text);
    let grupo = grupos.get(hash);
    if (!grupo) {
      grupo = { text, entries: new Map() };
      grupos.set(hash, grupo);
    } else if (grupo.text !== text) {
      throw new Error(`Colisão SHA-256 ao deduplicar aviso cargo-about: ${hash}`);
    }
    for (const item of license.used_by) {
      const crate = item.crate;
      if (!crate?.name || !crate?.version || !crate?.id) throw new Error(`Associação cargo-about inválida em ${license.id}.`);
      associados.add(crate.id);
      const metadata = `${crate.name} ${crate.version} — ${crate.license || license.id}${crate.authors?.length ? ` — ${crate.authors.join(', ')}` : ''}`;
      grupo.entries.set(metadata, metadata);
    }
  }

  const ausentes = data.crates
    .filter(({ package: p }) => p?.name !== 'deno')
    .filter(({ package: p }) => !associados.has(p?.id))
    .map(({ package: p }) => `${p?.name ?? '(sem nome)'} ${p?.version ?? ''}`);
  if (ausentes.length) throw new Error(`Crates Deno sem aviso de licença identificado: ${ausentes.slice(0, 20).join(', ')}${ausentes.length > 20 ? ` e mais ${ausentes.length - 20}` : ''}.`);

  const ordered = [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const blocks = ordered.map(([hash, group], index) => [
    '-'.repeat(100),
    `Texto de licença ${index + 1} — SHA-256 ${hash}`,
    'Pacotes associados (nome, versão, expressão declarada/identificada e autores Cargo):',
    ...[...group.entries.keys()].sort((a, b) => a.localeCompare(b)).map((entry) => `- ${entry}`),
    '',
    group.text,
    '',
  ].join('\n'));

  const text = [
      '='.repeat(100),
      `Avisos de crates Rust embutidas no Deno ${data.crates.find((c) => c.package?.name === 'deno')?.package?.version ?? '(versão ausente)'}`,
      '='.repeat(100),
      `${data.crates.length} pacotes no grafo cargo-about; ${associados.size} associações cobertas por ${grupos.size} textos de licença distintos (deduplicação por texto integral idêntico).`,
      'As versões, expressões de licença, autores e textos abaixo foram obtidos do grafo Cargo/Cargo.lock e dos arquivos de licença dos pacotes. Cargo metadata ausente não é tratado como licença ausente quando o texto local permite identificação; texto não identificado causa erro.',
      '',
      ...blocks,
    ].join('\n');
  return {
    text,
    packageCount: data.crates.length,
    associationCount: associados.size,
    licenseTextCount: grupos.size,
    sha256: sha256(text),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = process.argv[2];
    const output = process.argv[3];
    if (!input || !output) throw new Error('Uso: node scripts/licencas/deno/render-cargo-about.mjs <cargo-about.json> <CARGO-THIRD_PARTY_LICENSES.txt>');
    const rendered = renderCargoAbout(JSON.parse(await readFile(input, 'utf8')));
    await writeFile(output, `${rendered.text}\n`);
    await writeFile(output.replace(/\.txt$/, '.sources.json'), `${JSON.stringify({
      format: 1,
      packageCount: rendered.packageCount,
      associationCount: rendered.associationCount,
      distinctTextCount: rendered.licenseTextCount,
      textSha256: sha256(`${rendered.text}\n`),
    }, null, 2)}\n`);
    console.log(`rendered ${rendered.packageCount} Cargo packages as ${rendered.licenseTextCount} distinct license texts: ${output}`);
  } catch (error) {
    console.error(`[deno-cargo-avisos] ${error.message}`);
    process.exitCode = 1;
  }
}
