#!/usr/bin/env node
// Pré-assinatura do yt-dlp onedir para macOS (docs/distribuicao.md §4.5 item 4).
// O Tauri NÃO assina o conteúdo de bundle.resources (Contents/Resources/yt-dlp), então cada Mach-O do
// onedir precisa ser assinado ANTES do `tauri build`, de dentro para fora (_internal/** e, por último,
// o executável), com Hardened Runtime. Depois, o `tauri build` assina o .app, cujo selo cobre Resources/.
//
// Uso:
//   node scripts/assinar-yt-dlp.mjs --identidade "<Developer ID Application: …>" [opções]
//   node scripts/assinar-yt-dlp.mjs --identidade -          # ad-hoc (teste local; sem notarização;
//                                                           # sem Hardened Runtime, ver `runtime` abaixo)
// Opções:
//   --identidade <id>        padrão: APPLE_SIGNING_IDENTITY. "-" = ad-hoc.
//   --dir <onedir>           padrão: src-tauri/binaries/yt-dlp
//   --entitlements <plist>   entitlements do executável principal (padrão: nenhum; ver abaixo)
//   --keychain <arquivo>     keychain a usar no codesign
//   --importar-certificado   (CI) importa APPLE_CERTIFICATE (.p12 em base64) com
//                            APPLE_CERTIFICATE_PASSWORD num keychain temporário só para esta execução
//
// Com identidade real, usa --timestamp (exigido pela notarização); com "-", --timestamp=none.
// Entitlements: nenhum por padrão. Com Developer ID, todos os Mach-O ficam com o mesmo Team ID e a
// validação de bibliotecas do Hardened Runtime deve passar sem entitlements [validar com certificado
// real]. Se precisar, os entitlements valem SÓ para o processo do yt-dlp (não para o Clipora), ex.:
// com.apple.security.cs.allow-unsigned-executable-memory ou, em último caso, disable-library-validation.
//
// O zip oficial não tem links simbólicos e traz Python.framework com 3 cópias idênticas do
// conteúdo de Versions/<v>; o codesign recusa isso ("bundle format is ambiguous"). Antes de
// assinar, as duplicatas são removidas (deduplicarFrameworks) e registradas em
// manifesto.assinatura.removidos. Isto é uma modificação da distribuição do yt-dlp (permitida pela
// GPLv3) e está declarada em THIRD_PARTY_LICENSES (docs/licencas.md §2.3).
//
// Local no .app: Contents/Resources/yt-dlp (bundle.resources). Contents/Helpers NÃO serve: lá tudo
// é tratado como código, e os arquivos de dados do onedir (cacert.pem, .py, base_library.zip)
// fazem o codesign do .app falhar ("code object is not signed at all", verificado em 2026-11-05).
//
// Atualiza o manifesto clipora-yt-dlp.json com `assinatura` (identidade, data e SHA-256 de cada
// arquivo assinado), para que `pnpm binarios` reconheça a cópia assinada como íntegra e não a
// substitua. Idempotente: se a assinatura registrada é da mesma identidade e tudo confere, não faz nada.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DIR_BINARIOS, ErroBinarios, RAIZ, argumento, log, principal, sha256Arquivo, temFlag } from './comum.mjs';

const MANIFESTO = 'clipora-yt-dlp.json';

/** É Mach-O? Thin (32/64 bits, as duas ordens de bytes) ou fat (universal). */
function ehMachO(arquivo) {
  const fd = openSync(arquivo, 'r');
  try {
    const b = Buffer.alloc(8);
    if (readSync(fd, b, 0, 8, 0) < 8) return false;
    const magico = b.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magico)) return true;
    // Fat: 0xcafebabe também é o mágico de .class do Java; no fat, o 2º campo (nº de arquiteturas) é pequeno.
    if (magico === 0xcafebabe || magico === 0xcafebabf) return b.readUInt32BE(4) > 0 && b.readUInt32BE(4) < 20;
    return false;
  } finally {
    closeSync(fd);
  }
}

function listar(dir) {
  const saida = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue; // só os links de framework criados por normalizarFrameworks
    if (e.isDirectory()) saida.push(...listar(p));
    else if (e.isFile()) saida.push(p);
  }
  return saida;
}

/** SHA-256 de todos os arquivos (seguindo links) de um diretório, por caminho relativo. */
async function hashesDir(dir) {
  const r = {};
  for (const p of listarSeguindo(dir)) r[relative(dir, p).split(sep).join('/')] = await sha256Arquivo(p);
  return r;
}
function listarSeguindo(dir) {
  const saida = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) saida.push(...listarSeguindo(p));
    else if (st.isFile()) saida.push(p);
  }
  return saida;
}

/**
 * O zip oficial do yt-dlp não guarda links simbólicos: Python.framework vem com CÓPIAS
 * (Versions/Current = cópia de Versions/<v>; Python e Resources na raiz = cópias de Current).
 * Para o codesign isso é “bundle format is ambiguous”, e links simbólicos não resolvem: o
 * `bundle.resources` do Tauri descarta links de diretório e copia o conteúdo dos links de arquivo,
 * produzindo cópias cuja assinatura de bundle não confere fora do lugar (verificado em 2026-11-05).
 * Como o yt-dlp carrega `_internal/Python` (não o framework) e funciona sem as cópias (verificado),
 * remove as duplicatas — só depois de confirmar que são idênticas byte a byte — e mantém
 * `Versions/<v>`, assinado como bundle. Devolve [{ fw, versao, removidos }].
 */
async function deduplicarFrameworks(dir) {
  const frameworks = [];
  const procurar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory() && e.name.endsWith('.framework')) frameworks.push(p);
      else if (e.isDirectory()) procurar(p);
    }
  };
  procurar(dir);
  const resultado = [];
  for (const fw of frameworks) {
    const versoes = join(fw, 'Versions');
    const nomes = readdirSync(versoes).filter((n) => n !== 'Current');
    if (nomes.length !== 1) throw new ErroBinarios(`${fw}: esperava uma versão em Versions/, achei ${nomes.join(', ')}`);
    const versao = nomes[0];
    const real = join(versoes, versao);
    const removidos = [];
    const atual = join(versoes, 'Current');
    if (existsSync(atual)) {
      if (lstatSync(atual).isSymbolicLink()) throw new ErroBinarios(`${atual}: link simbólico inesperado.`);
      if (JSON.stringify(await hashesDir(real)) !== JSON.stringify(await hashesDir(atual))) {
        throw new ErroBinarios(`${fw}: Versions/Current difere de Versions/${versao}; não removo.`);
      }
      removidos.push(atual);
    }
    // Itens da raiz do framework (Python, Resources…) precisam ser cópias de Versions/<v>.
    for (const n of readdirSync(fw).filter((x) => x !== 'Versions')) {
      const p = join(fw, n);
      const alvo = join(real, n);
      if (!existsSync(alvo)) throw new ErroBinarios(`${p} não existe em Versions/${versao}; não removo.`);
      const igual = statSync(p).isDirectory()
        ? JSON.stringify(await hashesDir(p)) === JSON.stringify(await hashesDir(alvo))
        : (await sha256Arquivo(p)) === (await sha256Arquivo(alvo));
      if (!igual) throw new ErroBinarios(`${p} difere de Versions/${versao}/${n}; não removo.`);
      removidos.push(p);
    }
    for (const p of removidos) await rm(p, { recursive: true });
    if (removidos.length) log(`framework sem duplicatas: ${relative(dir, fw)} (mantido Versions/${versao}; removidos ${removidos.map((p) => relative(fw, p)).join(', ')})`);
    resultado.push({ fw, versao, removidos: removidos.map((p) => relative(dir, p).split(sep).join('/')) });
  }
  return resultado;
}

function codesign(args) {
  const r = spawnSync('codesign', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new ErroBinarios(`codesign ${args.join(' ')} falhou:\n${r.stderr}`);
  return r.stderr;
}

/** Keychain temporário com o certificado do CI; devolve { keychain, limpar }. */
async function importarCertificado() {
  const p12b64 = process.env.APPLE_CERTIFICATE;
  const senha = process.env.APPLE_CERTIFICATE_PASSWORD ?? '';
  if (!p12b64) throw new ErroBinarios('--importar-certificado sem APPLE_CERTIFICATE.');
  const dir = await mkdtemp(join(tmpdir(), 'clipora-assinar-'));
  const keychain = join(dir, 'clipora.keychain-db');
  const senhaKc = randomBytes(24).toString('hex');
  const p12 = join(dir, 'cert.p12');
  await writeFile(p12, Buffer.from(p12b64, 'base64'), { mode: 0o600 });
  const sec = (...a) => {
    const r = spawnSync('security', a, { encoding: 'utf8' });
    if (r.status !== 0) throw new ErroBinarios(`security ${a[0]} falhou: ${r.stderr}`);
    return r.stdout;
  };
  let criada = false;
  let atuais = [];
  let adicionadaNaBusca = false;
  const limpar = async () => {
    if (adicionadaNaBusca) spawnSync('security', ['list-keychains', '-d', 'user', '-s', ...atuais]);
    if (criada) spawnSync('security', ['delete-keychain', keychain]);
    await rm(dir, { recursive: true, force: true });
  };
  try {
    sec('create-keychain', '-p', senhaKc, keychain);
    criada = true;
    sec('set-keychain-settings', '-lut', '3600', keychain);
    sec('unlock-keychain', '-p', senhaKc, keychain);
    sec('import', p12, '-k', keychain, '-P', senha, '-T', '/usr/bin/codesign');
    sec('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', senhaKc, keychain);
    // Acrescenta à lista de busca (o codesign procura a identidade nela), preservando as existentes.
    atuais = sec('list-keychains', '-d', 'user').split('\n').map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean);
    sec('list-keychains', '-d', 'user', '-s', keychain, ...atuais);
    adicionadaNaBusca = true;
    await rm(p12, { force: true });
    return { keychain, limpar };
  } catch (e) {
    await limpar();
    throw e;
  }
}

async function identificadorBase() {
  try {
    const conf = JSON.parse(await readFile(join(RAIZ, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    return conf.identifier ?? 'app.clipora.desktop';
  } catch {
    return 'app.clipora.desktop';
  }
}

principal(async () => {
  if (process.platform !== 'darwin') throw new ErroBinarios('A assinatura do onedir é só para macOS (host macOS).');
  const identidade = argumento('identidade') ?? process.env.APPLE_SIGNING_IDENTITY;
  if (!identidade) throw new ErroBinarios('Informe --identidade "<Developer ID Application: …>" ou "-" (ad-hoc).');
  const dir = argumento('dir') ?? join(DIR_BINARIOS, 'yt-dlp');
  const entitlements = argumento('entitlements');
  const adhoc = identidade === '-';
  // Hardened Runtime liga a validação de bibliotecas: o processo só carrega dylibs do MESMO Team ID.
  // Assinaturas ad-hoc não têm Team ID, então ad-hoc + runtime NÃO carrega o próprio Python
  // ("mapping process and mapped file (non-platform) have different Team IDs", verificado em
  // 2026-11-05). Como o runtime só é exigido pela notarização (que exige Developer ID), o modo ad-hoc
  // assina sem runtime; --runtime força (diagnóstico). Com Developer ID: sempre runtime + timestamp.
  const runtime = adhoc ? temFlag('runtime') : !temFlag('sem-runtime');
  const mostrar = (p) => (p.startsWith(RAIZ) ? relative(RAIZ, p) : p);
  const arqManifesto = join(dir, MANIFESTO);
  if (!existsSync(arqManifesto)) throw new ErroBinarios(`${relative(RAIZ, arqManifesto)} ausente: rode pnpm binarios antes.`);
  const manifesto = JSON.parse(await readFile(arqManifesto, 'utf8'));
  const exe = join(dir, manifesto.executavel);
  if (!manifesto.triple?.endsWith('apple-darwin')) throw new ErroBinarios(`onedir é de ${manifesto.triple}, não macOS.`);

  const rel = (p) => relative(dir, p).split(sep).join('/');

  // Idempotência: mesma identidade/entitlements e todos os arquivos com o hash assinado registrado.
  const reg = manifesto.assinatura;
  if (
    !temFlag('forcar') &&
    reg?.identidade === identidade &&
    reg?.hardenedRuntime === runtime &&
    reg?.entitlements === (entitlements ?? null)
  ) {
    const atuais = await hashesDir(dir);
    delete atuais[MANIFESTO];
    const esperado = reg.arquivos ?? {};
    const ok =
      Object.keys(atuais).length === Object.keys(esperado).length &&
      Object.entries(esperado).every(([k, h]) => atuais[k] === h);
    if (ok && spawnSync('codesign', ['--verify', '--strict', exe]).status === 0) {
      log(`onedir já assinado com "${identidade}" (${Object.keys(atuais).length} arquivos conferem). Nada a fazer.`);
      return;
    }
  }

  const fws = await deduplicarFrameworks(dir);
  const dentroDeFramework = (p) => fws.some(({ fw }) => p.startsWith(fw + sep));
  const machos = listar(dir).filter((p) => !p.endsWith(MANIFESTO) && ehMachO(p));
  if (!machos.includes(exe)) throw new ErroBinarios(`executável ${exe} não é Mach-O.`);
  // De dentro para fora: Mach-O soltos (mais profundos primeiro), depois cada framework como bundle
  // (Versions/<v>), por último o executável principal.
  const soltos = machos
    .filter((p) => p !== exe && !dentroDeFramework(p))
    .sort((a, b) => b.split(sep).length - a.split(sep).length || a.localeCompare(b));
  const versoesFw = fws.map(({ fw, versao }) => join(fw, 'Versions', versao));
  const ordem = [...soltos, ...versoesFw, exe];

  let kc = null;
  if (temFlag('importar-certificado') && !adhoc) kc = await importarCertificado();
  try {
    const keychain = argumento('keychain') ?? kc?.keychain;
    const base = await identificadorBase();
    const comuns = ['--force', '--sign', identidade, adhoc ? '--timestamp=none' : '--timestamp'];
    if (runtime) comuns.push('--options', 'runtime');
    if (keychain) comuns.push('--keychain', keychain);
    log(`assinando ${ordem.length} Mach-O em ${mostrar(dir)} com "${identidade}" (${runtime ? 'Hardened Runtime' : 'sem Hardened Runtime'}${adhoc ? ', ad-hoc' : ', com carimbo de tempo'})`);
    const inicio = Date.now();
    for (const p of ordem) {
      const args = [...comuns];
      if (p === exe) {
        args.push('--identifier', `${base}.yt-dlp`);
        if (entitlements) args.push('--entitlements', entitlements);
      }
      codesign([...args, p]);
    }
    for (const p of ordem) codesign(['--verify', '--strict', p]);
    log(`assinatura e verificação (--strict) de ${ordem.length} arquivos em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
  } finally {
    await kc?.limpar();
  }

  // Árvore completa depois da assinatura: é o que `pnpm binarios` confere (exatamente, sem extras).
  const arquivos = await hashesDir(dir);
  delete arquivos[MANIFESTO];
  const removidos = fws.flatMap((f) => f.removidos);
  for (const k of Object.keys(manifesto.arquivos)) {
    const foiRemovido = removidos.some((r) => k === r || k.startsWith(`${r}/`));
    if (!arquivos[k] && !foiRemovido) throw new ErroBinarios(`${k} sumiu depois da assinatura.`);
  }
  manifesto.assinatura = {
    identidade,
    removidos,
    hardenedRuntime: runtime,
    timestamp: !adhoc,
    entitlements: entitlements ?? null,
    data: new Date().toISOString(),
    arquivos,
  };
  await writeFile(arqManifesto, `${JSON.stringify(manifesto, null, 2)}\n`);
  const info = codesign(['-dv', exe]);
  log(`executável: ${info.split('\n').filter((l) => /^(Identifier|Signature|TeamIdentifier|CodeDirectory)/.test(l)).join(' | ')}`);
  log(`manifesto atualizado com a assinatura (${Object.keys(arquivos).length} arquivos): ${mostrar(arqManifesto)}`);
});
