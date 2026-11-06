import { createHash } from 'node:crypto';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashValido = (value) => /^[0-9a-f]{64}$/.test(value ?? '');

export function validarInsumosDenoAvisos(lock, { license, cargo, cargoSources, v8, sources, denoSource, denoSourceSources, typescriptApache }) {
  const spec = lock?.deno?.avisosTerceiros;
  if (!spec) throw new Error('binarios.lock não fixa as fontes e os arquivos de avisos Deno.');
  if (lock.deno.versao !== '2.7.0' || spec.versao !== lock.deno.versao) throw new Error('Versão das licenças Deno não corresponde ao binário fixado.');
  if (lock.deno.licenca !== 'MIT' || spec.licenca?.sha256 !== sha256(license ?? Buffer.alloc(0))) throw new Error('LICENSE.md oficial ausente ou com hash diferente do lock.');
  if (!license?.length || !license.toString('utf8').startsWith('MIT License\n\nCopyright 2018-2026 the Deno authors')) throw new Error('LICENSE.md não contém o texto MIT oficial fixado do Deno 2.7.0.');

  for (const [name, bytes, expected] of [
    ['cargo-about', cargo, spec.cargoNoticeSha256],
    ['manifesto cargo-about', cargoSources, spec.cargoSourcesSha256],
    ['V8 third_party', v8, spec.v8?.noticeSha256],
    ['manifesto de fontes V8', sources, spec.v8?.sourcesSha256],
    ['avisos da fonte Deno/TypeScript', denoSource, spec.denoSource?.noticeSha256],
    ['manifesto da fonte Deno/TypeScript', denoSourceSources, spec.denoSource?.sourcesSha256],
    ['licença Apache TypeScript', typescriptApache, spec.denoSource?.typescriptLicenseSha256],
  ]) {
    if (!bytes?.length) throw new Error(`Insumo obrigatório de avisos Deno ausente: ${name}.`);
    if (!hashValido(expected) || sha256(bytes) !== expected) throw new Error(`Hash do insumo de avisos Deno divergente: ${name}.`);
  }
  const cargoText = cargo.toString('utf8');
  if (!cargoText.includes('Avisos de crates Rust embutidas no Deno 2.7.0') || !cargoText.includes('v8 145.0.0') || !cargoText.includes('OpenSSL') || !cargoText.includes('Texto de licença')) {
    throw new Error('Avisos cargo-about não cobrem o grafo Rust fixado do Deno 2.7.0.');
  }
  let cargoData;
  try {
    cargoData = JSON.parse(cargoSources.toString('utf8'));
  } catch (error) {
    throw new Error(`Manifesto cargo-about inválido: ${error.message}`);
  }
  if (cargoData.format !== 1 || !Number.isInteger(cargoData.packageCount) || cargoData.packageCount < 100 ||
      cargoData.associationCount !== cargoData.packageCount || !Number.isInteger(cargoData.distinctTextCount) || cargoData.distinctTextCount < 10 ||
      cargoData.textSha256 !== sha256(cargo)) {
    throw new Error('Manifesto cargo-about não comprova cobertura de todos os pacotes e o hash do texto.');
  }
  const v8Text = v8.toString('utf8');
  if (!v8Text.includes(`Rusty V8 commit: ${spec.v8?.rustyv8Commit}`) || !v8Text.includes(`V8 submodule commit: ${spec.v8?.v8Commit}`) || !v8Text.includes('third_party/icu/LICENSE') || !v8Text.includes('third_party/libc++/src/LICENSE.TXT')) {
    throw new Error('Avisos V8 não incluem as fontes V8/third_party fixadas.');
  }

  let sourceData;
  try {
    sourceData = JSON.parse(sources.toString('utf8'));
  } catch (error) {
    throw new Error(`Manifesto de fontes V8 inválido: ${error.message}`);
  }
  if (sourceData.format !== 1 || sourceData.rustyV8Commit !== spec.v8.rustyv8Commit || sourceData.v8Commit !== spec.v8.v8Commit ||
      !Number.isInteger(sourceData.licenseLikeFileCount) || sourceData.licenseLikeFileCount < 20 ||
      !Number.isInteger(sourceData.distinctTextCount) || sourceData.distinctTextCount < 10 ||
      !Array.isArray(sourceData.gitlinks) || !sourceData.gitlinks.some((link) => link.path === 'v8' && link.commit === spec.v8.v8Commit) ||
      !sourceData.gitlinks.some((link) => link.path === 'third_party/icu') ||
      sourceData.textSha256 !== sha256(v8) ||
      !Array.isArray(sourceData.files) || sourceData.files.length !== sourceData.licenseLikeFileCount) {
    throw new Error('Manifesto de fontes V8 não comprova a coleta recursiva fixada.');
  }
  let denoSourceData;
  try {
    denoSourceData = JSON.parse(denoSourceSources.toString('utf8'));
  } catch (error) {
    throw new Error(`Manifesto de fonte Deno inválido: ${error.message}`);
  }
  const requiredDenoPaths = ['cli/tsc/dts/node/LICENSE', 'cli/tsc/dts/node/undici/LICENSE', 'ext/webgpu/LICENSE.md', 'cli/tsc/00_typescript.js'];
  if (denoSourceData.format !== 1 || denoSourceData.typescriptVersion !== '5.9.2' ||
      denoSourceData.typescriptLicenseSha256 !== spec.denoSource.typescriptLicenseSha256 ||
      denoSourceData.typescriptFileSha256 !== spec.denoSource.typescriptFileSha256 ||
      denoSourceData.denoLicenseTextSha256 !== sha256(Buffer.from(license.toString('utf8').replace(/\r\n/g, '\n').trim())) ||
      denoSourceData.textSha256 !== sha256(denoSource) ||
      !Number.isInteger(denoSourceData.licenseLikeFileCount) || denoSourceData.licenseLikeFileCount < requiredDenoPaths.length - 1 ||
      !Array.isArray(denoSourceData.files) ||
      !Array.isArray(denoSourceData.keyFiles) || requiredDenoPaths.some((path) => !denoSourceData.keyFiles.some((file) => file.path === path)) ||
      !denoSourceData.keyFiles.some((file) => file.path === 'Cargo.lock' && file.sha256 === spec.cargoLockSha256) ||
      !denoSourceData.keyFiles.some((file) => file.path === 'LICENSE.md' && file.sha256 === spec.licenca.sha256) ||
      !denoSourceData.keyFiles.some((file) => file.path === 'microsoft-TypeScript-v5.9.2/LICENSE.txt' && file.sha256 === spec.denoSource.typescriptLicenseSha256)) {
    throw new Error('Manifesto da fonte Deno não comprova avisos Node/Undici/WebGPU e TypeScript 5.9.2.');
  }
  if (!/^https:\/\/codeload\.github\.com\/denoland\/deno\/tar\.gz\//.test(spec.denoSource.sourceArchiveUrl ?? '') || !hashValido(spec.denoSource.sourceArchiveSha256)) {
    throw new Error('Source archive Deno não tem origem/hash oficial fixados.');
  }
  const typescriptText = typescriptApache.toString('utf8');
  if (!typescriptText.includes('Apache License') || !typescriptText.includes('Version 2.0, January 2004') ||
      !denoSource.toString('utf8').includes(`cli/tsc/00_typescript.js — SHA-256 ${denoSourceData.typescriptFileSha256}`)) {
    throw new Error('Avisos Apache-2.0 do snapshot TypeScript não correspondem à fonte fixada.');
  }
  return {
    cargoPackages: Number(/(\d+) pacotes no grafo cargo-about/.exec(cargoText)?.[1] ?? 0),
    cargoLicenseTexts: cargoData.distinctTextCount,
    v8SourceFiles: sourceData.licenseLikeFileCount,
    v8DistinctTexts: sourceData.distinctTextCount,
    denoSourceFiles: denoSourceData.licenseLikeFileCount,
    typescriptVersion: denoSourceData.typescriptVersion,
  };
}
