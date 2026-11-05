#!/usr/bin/env node
// Conferência forte dos pacotes gerados pelo `tauri build` (docs/verificacao.md V7-11, V7-12, V7-13).
//
// Uso: node scripts/conferir-pacote.mjs --target <triple> [--bundle-dir <dir>]
//   padrão de --bundle-dir: src-tauri/target/<triple>/release/bundle (ou $CARGO_TARGET_DIR/…)
//
// Para cada pacote encontrado, obtém a árvore REAL de arquivos instalados e confere:
//   - obrigatórios: executável do app, clipora-ffmpeg[.exe], clipora-ffprobe[.exe],
//     yt-dlp/yt-dlp[.exe] + manifesto, licencas/THIRD_PARTY_LICENSES.txt e licencas.json;
//   - LISTA PERMITIDA nas pastas do próprio app (binários e recursos): qualquer extra falha
//     (onefile clipora-yt-dlp-<triple>, ffmpeg-build-info solto, .antigo/.novo, Helpers/ …);
//   - yt-dlp/: exatamente os arquivos do manifesto (estado assinado, se houver), com SHA-256;
//   - executa (quando o host roda o alvo) yt-dlp --version e clipora-ffmpeg -version;
//   - macOS: lipo -info no universal (app, ffmpeg, ffprobe, yt-dlp com arm64 + x86_64) e
//     LSMinimumSystemVersion do app ≥ minos dos sidecars (LC_BUILD_VERSION).
// Como obtém a árvore: .app direto; .deb `dpkg-deb -x`; .rpm `rpm2cpio | cpio`; AppImage
// `--appimage-extract`; MSI `msiexec /a` (instalação administrativa); NSIS instalação silenciosa
// `/S /D=<dir>` num diretório temporário. O .dmg contém o mesmo .app (conferido `hdiutil verify`).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { ErroBinarios, RAIZ, argumento, detectarTriple, lerLock, log, principal } from './comum.mjs';

const falhas = [];
const falhar = (m) => falhas.push(m);
const ok = (m) => log(`ok: ${m}`);

function rodar(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opcoes });
  if (r.error || r.status !== 0) throw new ErroBinarios(`${cmd} ${args.join(' ')} falhou: ${r.error?.message ?? ''}${r.stderr ?? ''}`);
  return r.stdout;
}

async function sha256(p) {
  const h = createHash('sha256');
  await pipeline(createReadStream(p), h);
  return h.digest('hex');
}

/** Lista arquivos (relativos, com /) sob `dir`; links simbólicos aparecem como arquivos. */
function arvore(dir) {
  const r = [];
  const andar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) andar(p);
      else r.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) andar(dir);
  return r;
}

/** Itens de primeiro nível (arquivos e pastas) de `dir`. */
const nivel1 = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

function hostRoda(triple) {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (triple === 'universal-apple-darwin') return process.platform === 'darwin';
  const so = triple.includes('apple-darwin') ? 'darwin' : triple.includes('windows') ? 'win32' : 'linux';
  return so === process.platform && triple.startsWith(arch);
}

export function validarInfoFfmpeg(texto, triple, lock) {
  const erros = [];
  const esperadoTarball = `Código-fonte: ${lock.ffmpeg.tarball.url}`;
  const esperadoHash = `SHA-256 do código-fonte: ${lock.ffmpeg.tarball.sha256}`;
  if (!texto.includes(`FFmpeg mínimo (remux) — ${triple}`)) erros.push('alvo ausente/incorreto');
  if (!texto.includes(esperadoTarball)) erros.push('origem não corresponde a binarios.lock');
  if (!texto.includes(esperadoHash)) erros.push('hash da fonte não corresponde a binarios.lock');
  const configs = texto.split('\n').filter((l) => /^configure \(/.test(l));
  if (!configs.length) erros.push('linhas configure ausentes');
  for (const linha of configs) {
    if (!/\s--disable-gpl(?:\s|$)/.test(linha)) erros.push('configure sem --disable-gpl');
    if (!/\s--disable-nonfree(?:\s|$)/.test(linha)) erros.push('configure sem --disable-nonfree');
    if (/\s--enable-(?:gpl|nonfree|version3)(?:=|\s|$)/.test(linha)) erros.push('configure contém flag GPL/nonfree/version3 proibida');
  }
  return erros;
}

export function arquiteturaPe(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') return null;
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 6 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') return null;
  return ({ 0x8664: 'x86_64', 0xaa64: 'aarch64', 0x14c: 'i686' })[bytes.readUInt16LE(pe + 4)] ?? `machine-0x${bytes.readUInt16LE(pe + 4).toString(16)}`;
}

export function classificarSeloCodesign(status, texto) {
  if (/Sealed Resources=none/.test(texto) || /Info\.plist=not bound/.test(texto)) return 'unsigned';
  if (status === 0) return 'signed';
  return 'unknown-error';
}

function arquiteturaElf(bytes) {
  if (bytes.length < 20 || bytes.toString('hex', 0, 4) !== '7f454c46') return null;
  const le = bytes[5] === 1;
  const machine = le ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
  return ({ 62: 'x86_64', 183: 'aarch64' })[machine] ?? `machine-${machine}`;
}

function arquiteturasEsperadas(triple) {
  if (triple.startsWith('universal-')) return ['x86_64', 'arm64'];
  if (triple.includes('apple-darwin')) return [triple.startsWith('aarch64-') ? 'arm64' : 'x86_64'];
  return [triple.startsWith('aarch64-') ? 'aarch64' : 'x86_64'];
}

function conferirArquitetura(p, triple, rotulo) {
  if (!existsSync(p)) return;
  const desejadas = arquiteturasEsperadas(triple);
  if (triple.includes('apple-darwin')) {
    const r = spawnSync('lipo', ['-archs', p], { encoding: 'utf8' });
    const obtidas = r.status === 0 ? r.stdout.trim().split(/\s+/) : [];
    if (desejadas.every((a) => obtidas.includes(a))) ok(`${rotulo}: arquitetura ${obtidas.join('+')}`);
    else falhar(`${rotulo}: arquitetura esperada ${desejadas.join('+')}, obtida ${obtidas.join('+') || r.stderr.trim() || 'inválida'}`);
  } else {
    const bytes = readFileSync(p);
    const obtida = triple.includes('windows') ? arquiteturaPe(bytes) : arquiteturaElf(bytes);
    if (desejadas.includes(obtida)) ok(`${rotulo}: arquitetura ${obtida}`);
    else falhar(`${rotulo}: arquitetura esperada ${desejadas.join('+')}, obtida ${obtida ?? 'formato binário inválido'}`);
  }
}

async function conferirYtDlp(dirYt, ext, versao, triple, rotulo) {
  const manifestoArq = join(dirYt, 'clipora-yt-dlp.json');
  if (!existsSync(manifestoArq)) return falhar(`${rotulo}: yt-dlp/clipora-yt-dlp.json ausente`);
  const m = JSON.parse(await readFile(manifestoArq, 'utf8'));
  if (m.versao !== versao) falhar(`${rotulo}: yt-dlp ${m.versao} no pacote, lock fixa ${versao}`);
  const esperado = m.assinatura?.arquivos ?? m.arquivos ?? {};
  const atual = arvore(dirYt).filter((r) => r !== 'clipora-yt-dlp.json');
  const extras = atual.filter((r) => !(r in esperado));
  const faltando = Object.keys(esperado).filter((r) => !atual.includes(r));
  if (extras.length) falhar(`${rotulo}: arquivos EXTRAS em yt-dlp/: ${extras.slice(0, 8).join(', ')}`);
  if (faltando.length) falhar(`${rotulo}: faltam em yt-dlp/: ${faltando.slice(0, 8).join(', ')}`);
  let divergentes = 0;
  for (const r of atual) if (r in esperado && (await sha256(join(dirYt, ...r.split('/')))) !== esperado[r]) divergentes++;
  if (divergentes) falhar(`${rotulo}: ${divergentes} arquivo(s) de yt-dlp/ com SHA-256 diferente do manifesto`);
  if (!extras.length && !faltando.length && !divergentes) {
    ok(`${rotulo}: yt-dlp/ = manifesto (${atual.length} arquivos, SHA-256 conferidos${m.assinatura ? `, assinado com "${m.assinatura.identidade}"` : ''})`);
  }
  const exe = join(dirYt, `yt-dlp${ext}`);
  if (hostRoda(triple) && existsSync(exe)) {
    const v = spawnSync(exe, ['--ignore-config', '--no-update', '--version'], { encoding: 'utf8', timeout: 120_000 });
    if (v.stdout?.trim() === versao) ok(`${rotulo}: yt-dlp --version = ${versao}`);
    else falhar(`${rotulo}: yt-dlp --version falhou (${v.status}): ${v.stdout}${v.stderr}`);
  }
}

function conferirLicencas(dirLic, rotulo) {
  const itens = nivel1(dirLic).sort();
  const esperado = ['THIRD_PARTY_LICENSES.txt', 'licencas.json'];
  if (JSON.stringify(itens) !== JSON.stringify(esperado)) {
    falhar(`${rotulo}: licencas/ deveria ter exatamente ${esperado.join(', ')}; tem: ${itens.join(', ') || '(nada)'}`);
  } else if (statSync(join(dirLic, 'THIRD_PARTY_LICENSES.txt')).size < 10_000) {
    falhar(`${rotulo}: THIRD_PARTY_LICENSES.txt pequeno demais`);
  } else ok(`${rotulo}: licencas/ com THIRD_PARTY_LICENSES.txt e licencas.json`);
}

function conferirPermitidos(dir, permitidos, rotulo, ignorar = () => false) {
  const extras = nivel1(dir).filter((n) => !permitidos.includes(n) && !ignorar(n));
  const faltando = permitidos.filter((n) => !nivel1(dir).includes(n));
  if (extras.length) falhar(`${rotulo}: itens NÃO permitidos em ${basename(dir)}/: ${extras.join(', ')}`);
  return faltando;
}

function conferirFfmpeg(dirBin, ext, triple, rotulo, lock) {
  const ff = join(dirBin, `clipora-ffmpeg${ext}`);
  const fp = join(dirBin, `clipora-ffprobe${ext}`);
  conferirArquitetura(ff, triple, `${rotulo}: clipora-ffmpeg`);
  conferirArquitetura(fp, triple, `${rotulo}: clipora-ffprobe`);
  if (hostRoda(triple) && existsSync(ff)) {
    const v = spawnSync(ff, ['-hide_banner', '-version'], { encoding: 'utf8' });
    const out = v.stdout ?? '';
    const primeira = out.split('\n')[0];
    const configuracao = out.split('\n').find((l) => /^configuration:/.test(l)) ?? '';
    if (new RegExp(`^ffmpeg version ${lock.ffmpeg.versao.replaceAll('.', '\\.')}\\-clipora\\b`).test(primeira)) ok(`${rotulo}: ${primeira}`);
    else falhar(`${rotulo}: versão FFmpeg esperada ${lock.ffmpeg.versao}-clipora, obtida: ${primeira || '(vazio)'}`);
    if (!configuracao.includes('--disable-gpl') || !configuracao.includes('--disable-nonfree') || /--enable-(gpl|nonfree|version3)(?:=|\s|$)/.test(configuracao)) {
      falhar(`${rotulo}: configuração FFmpeg não comprova build LGPL sem GPL/nonfree`);
    } else ok(`${rotulo}: configuração LGPL (disable-gpl/nonfree; sem enable-gpl/nonfree/version3)`);
  }
}

// ── macOS ───────────────────────────────────────────────────────────────────────────────────
function versaoNum(v) {
  return v.split('.').map(Number).reduce((a, n, i) => a + n * 1000 ** (2 - i), 0);
}

async function conferirApp(app, triple, versaoYt) {
  const rotulo = basename(app);
  const c = join(app, 'Contents');
  conferirPermitidos(c, ['Info.plist', 'MacOS', 'Resources'], rotulo, (n) => n === '_CodeSignature' || n === 'PkgInfo');
  const bins = ['clipora', 'clipora-ffmpeg', 'clipora-ffprobe'];
  const faltaBin = conferirPermitidos(join(c, 'MacOS'), bins, `${rotulo}/MacOS`);
  if (faltaBin.length) falhar(`${rotulo}: faltam em MacOS/: ${faltaBin.join(', ')}`);
  const faltaRes = conferirPermitidos(join(c, 'Resources'), ['icon.icns', 'yt-dlp', 'licencas'], `${rotulo}/Resources`);
  if (faltaRes.length) falhar(`${rotulo}: faltam em Resources/: ${faltaRes.join(', ')}`);
  if (!faltaBin.length) ok(`${rotulo}: MacOS/ = ${bins.join(', ')}`);
  await conferirYtDlp(join(c, 'Resources', 'yt-dlp'), '', versaoYt, triple, rotulo);
  conferirLicencas(join(c, 'Resources', 'licencas'), rotulo);

  conferirArquitetura(join(c, 'MacOS', 'clipora'), triple, `${rotulo}: clipora`);
  conferirArquitetura(join(c, 'Resources', 'yt-dlp', 'yt-dlp'), triple, `${rotulo}: yt-dlp`);
  conferirFfmpeg(join(c, 'MacOS'), '', triple, rotulo, globalThis.__cliporaLock);
  // Versão mínima: Info.plist do app ≥ minos dos sidecars.
  const plist = join(c, 'Info.plist');
  const lsmin = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', plist], { encoding: 'utf8' });
  const minosSidecar = Math.max(
    ...['clipora-ffmpeg', 'clipora-ffprobe']
      .map((b) => join(c, 'MacOS', b))
      .filter(existsSync)
      .flatMap((p) => [...rodar('otool', ['-l', p]).matchAll(/minos (\d+(?:\.\d+)*)/g)].map((x) => versaoNum(x[1]))),
  );
  if (lsmin.status !== 0) falhar(`${rotulo}: Info.plist sem LSMinimumSystemVersion (pedir bundle.macOS.minimumSystemVersion "11.0" a Ferrugem; C1)`);
  else if (versaoNum(lsmin.stdout.trim()) < minosSidecar) falhar(`${rotulo}: LSMinimumSystemVersion ${lsmin.stdout.trim()} < minos dos sidecars`);
  else ok(`${rotulo}: LSMinimumSystemVersion ${lsmin.stdout.trim()} ≥ minos dos sidecars`);
  // Só evidências conhecidas de ausência de selo permitem pacote unsigned; erros desconhecidos falham.
  const detalhe = spawnSync('codesign', ['-dv', '--verbose=2', app], { encoding: 'utf8' });
  const descricao = `${detalhe.stdout ?? ''}\n${detalhe.stderr ?? ''}`;
  const selo = classificarSeloCodesign(detalhe.status, descricao);
  if (selo === 'unsigned') {
    ok(`${rotulo}: pacote sem selo de assinatura de bundle (build sem certificado)`);
  } else if (selo === 'signed') {
    const v = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
    if (v.status === 0) ok(`${rotulo}: codesign --verify --deep --strict`);
    else falhar(`${rotulo}: codesign --verify --deep --strict falhou: ${v.stderr.trim()}`);
  } else falhar(`${rotulo}: codesign -dv falhou sem evidência reconhecida de pacote unsigned: ${descricao.trim()}`);
}

// ── Linux / Windows: árvore instalada ───────────────────────────────────────────────────────
async function conferirArvoreInstalada({ raiz, dirBin, dirRes, ext, triple, versaoYt, rotulo, binsPermitidos, resPermitidos, ignorarBin }) {
  const bins = ['clipora', 'clipora-ffmpeg', 'clipora-ffprobe'].map((b) => `${b}${ext}`);
  const faltaBin = conferirPermitidos(join(raiz, dirBin), binsPermitidos ?? bins, `${rotulo}:${dirBin}`, ignorarBin);
  const faltaObrig = bins.filter((b) => faltaBin.includes(b));
  if (faltaObrig.length) falhar(`${rotulo}: faltam em ${dirBin}/: ${faltaObrig.join(', ')}`);
  else ok(`${rotulo}: ${dirBin}/ tem ${bins.join(', ')}`);
  if (dirRes !== dirBin) {
    const faltaRes = conferirPermitidos(join(raiz, dirRes), resPermitidos ?? ['yt-dlp', 'licencas'], `${rotulo}:${dirRes}`);
    if (faltaRes.length) falhar(`${rotulo}: faltam em ${dirRes}/: ${faltaRes.join(', ')}`);
  }
  await conferirYtDlp(join(raiz, dirRes, 'yt-dlp'), ext, versaoYt, triple, rotulo);
  conferirLicencas(join(raiz, dirRes, 'licencas'), rotulo);
  const baseBin = join(raiz, dirBin);
  const baseRes = join(raiz, dirRes);
  for (const n of [`clipora${ext}`, `clipora-ffmpeg${ext}`, `clipora-ffprobe${ext}`, `yt-dlp${ext}`]) {
    const p = n.startsWith('yt-dlp') ? join(baseRes, 'yt-dlp', n) : join(baseBin, n);
    conferirArquitetura(p, triple, `${rotulo}: ${n}`);
  }
  conferirFfmpeg(baseBin, ext, triple, rotulo, globalThis.__cliporaLock);
}

async function conferirLinux(bundle, triple, versaoYt, nomeProduto) {
  const tmp = await mkdtemp(join(tmpdir(), 'clipora-pacote-'));
  const pacotes = [];
  const achar = (sub, re) => (existsSync(join(bundle, sub)) ? readdirSync(join(bundle, sub)).filter((n) => re.test(n)).map((n) => join(bundle, sub, n)) : []);
  try {
    for (const deb of achar('deb', /\.deb$/)) {
      const d = join(tmp, 'deb');
      rodar('dpkg-deb', ['-x', deb, d]);
      pacotes.push({ raiz: d, rotulo: basename(deb) });
    }
    for (const rpm of achar('rpm', /\.rpm$/)) {
      const d = join(tmp, 'rpm');
      rodar('mkdir', ['-p', d]);
      rodar('sh', ['-c', 'rpm2cpio "$1" | cpio -idm --quiet', 'sh', rpm], { cwd: d });
      pacotes.push({ raiz: d, rotulo: basename(rpm) });
    }
    for (const img of achar('appimage', /\.AppImage$/)) {
      const d = join(tmp, 'appimage');
      rodar('mkdir', ['-p', d]);
      rodar(img, ['--appimage-extract'], { cwd: d, env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' } });
      pacotes.push({ raiz: join(d, 'squashfs-root'), rotulo: basename(img) });
    }
    if (!pacotes.length) falhar(`nenhum .deb/.rpm/.AppImage em ${bundle}`);
    for (const p of pacotes) {
      await conferirArvoreInstalada({
        ...p,
        dirBin: 'usr/bin',
        dirRes: `usr/lib/${nomeProduto}`,
        ext: '',
        triple,
        versaoYt,
      });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function conferirWindows(bundle, triple, versaoYt) {
  const tmp = await mkdtemp(join(tmpdir(), 'clipora-pacote-'));
  const pacotes = [];
  const achar = (sub, re) => (existsSync(join(bundle, sub)) ? readdirSync(join(bundle, sub)).filter((n) => re.test(n)).map((n) => join(bundle, sub, n)) : []);
  try {
    for (const msi of achar('msi', /\.msi$/)) {
      const d = resolve(join(tmp, 'msi'));
      rodar('msiexec', ['/a', msi, '/qn', `TARGETDIR=${d}${sep}`]);
      // A instalação administrativa reproduz a árvore de ProgramFiles; o app fica num subdiretório.
      const exe = arvore(d).find((r) => /(^|\/)clipora\.exe$/i.test(r));
      if (!exe) throw new ErroBinarios(`${basename(msi)}: clipora.exe não apareceu na extração administrativa MSI`);
      pacotes.push({ raiz: exe ? join(d, ...exe.split('/').slice(0, -1)) : d, rotulo: basename(msi) });
    }
    for (const nsis of achar('nsis', /\.exe$/)) {
      const d = join(tmp, 'nsis');
      // /D= precisa ser o último argumento e sem aspas.
      rodar(nsis, ['/S', `/D=${d}`]);
      pacotes.push({ raiz: d, rotulo: basename(nsis), nsis: true });
    }
    if (!pacotes.length) falhar(`nenhum .msi/.exe em ${bundle}`);
    for (const p of pacotes) {
      await conferirArvoreInstalada({
        ...p,
        dirBin: '.',
        dirRes: '.',
        ext: '.exe',
        triple,
        versaoYt,
        binsPermitidos: ['clipora.exe', 'clipora-ffmpeg.exe', 'clipora-ffprobe.exe', 'yt-dlp', 'licencas', ...(p.nsis ? ['uninstall.exe'] : [])],
      });
      if (p.nsis) spawnSync(join(p.raiz, 'uninstall.exe'), ['/S']);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function executarConferencia() {
  const triple = detectarTriple();
  const lock = await lerLock();
  globalThis.__cliporaLock = lock;
  const infoPath = join(RAIZ, 'src-tauri', 'binaries', `ffmpeg-build-info-${triple}.txt`);
  if (!existsSync(infoPath)) throw new ErroBinarios(`registro LGPL do FFmpeg ausente: ${infoPath}`);
  const infoErros = validarInfoFfmpeg(readFileSync(infoPath, 'utf8'), triple, lock);
  if (infoErros.length) throw new ErroBinarios(`registro FFmpeg inválido para ${triple}: ${infoErros.join('; ')}`);
  ok(`registro FFmpeg: fonte ${lock.ffmpeg.versao}, configure LGPL válido para ${triple}`);
  const conf = JSON.parse(await readFile(join(RAIZ, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const alvoDir = process.env.CARGO_TARGET_DIR ?? join(RAIZ, 'src-tauri', 'target');
  const bundle = argumento('bundle-dir') ?? join(alvoDir, triple, 'release', 'bundle');
  if (!existsSync(bundle)) throw new ErroBinarios(`diretório de pacotes não encontrado: ${bundle}`);
  log(`conferindo pacotes de ${triple} em ${bundle}`);
  const versaoYt = lock.ytDlp.versao;

  if (triple.includes('apple-darwin')) {
    const apps = existsSync(join(bundle, 'macos')) ? readdirSync(join(bundle, 'macos')).filter((n) => n.endsWith('.app')) : [];
    if (!apps.length) falhar('nenhum .app em bundle/macos');
    for (const a of apps) await conferirApp(join(bundle, 'macos', a), triple, versaoYt);
    const dmgs = existsSync(join(bundle, 'dmg')) ? readdirSync(join(bundle, 'dmg')).filter((n) => n.endsWith('.dmg')) : [];
    for (const d of dmgs) {
      const v = spawnSync('hdiutil', ['verify', join(bundle, 'dmg', d)], { encoding: 'utf8' });
      if (v.status === 0) ok(`${d}: hdiutil verify`);
      else falhar(`${d}: hdiutil verify falhou`);
    }
  } else if (triple.includes('linux')) {
    await conferirLinux(bundle, triple, versaoYt, conf.productName);
  } else {
    await conferirWindows(bundle, triple, versaoYt);
  }

  if (falhas.length) {
    throw new ErroBinarios(`conferência do pacote FALHOU (${falhas.length}):\n  - ${falhas.join('\n  - ')}`);
  }
  log('conferência do pacote: tudo certo.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  principal(executarConferencia);
}
