# Histórico local, abrir vídeo e aviso de duplicidade

## Intenção e autorização

O usuário aprovou histórico local + abrir vídeo + aviso de link já baixado para o público geral e ordenou planejar e desenvolver até terminar. Esta evolução complementa o MVP; `projeto-aplicativo.md` e `plano-clipora.md` continuam preservados. Não inclui fila, edição, novas plataformas, conta ou sincronização.

## Comportamento

- Registrar somente downloads concluídos, com ID, link original/normalizado, título, plataforma, nome/caminho do arquivo e data. Persistir localmente entre reinícios, sem guardar capas nem enviar dados.
- Exibir histórico do mais recente para o mais antigo numa seção recolhível, com estado vazio, carregamento, erro recuperável, data, nome e plataforma. Abrir vídeo no aplicativo padrão e revelar na pasta. Botão Abrir vídeo também na conclusão do download.
- Arquivo movido, removido ou inacessível continua no histórico como indisponível; não procurar automaticamente pelo disco. Revalidar ao listar e ao abrir, com mensagem compreensível.
- Limpar histórico pede confirmação dentro da interface e remove apenas registros. Nunca apaga vídeos. O texto explica essa diferença. Operação é serializada com registro de downloads.
- Quando a prévia atual corresponder a download anterior, mostrar aviso discreto e permitir abrir a cópia disponível ou baixar novamente. Não bloquear download. Se o arquivo faltar, explicar que é possível baixá-lo novamente.
- Comparar IDs de vídeo das URLs suportadas, ignorando rastreamento, fragmentos, aliases de host e formatos equivalentes Instagram. TikTok canônico usa ID de vídeo, independente de usuário; links curtos têm correspondência pelo endereço salvo, ou pelo endereço resolvido na prévia quando disponível. Nunca prometer equivalência de links curtos diferentes sem resolução.
- Respostas atrasadas de consultas não podem aplicar aviso a outro link, restaurar registros limpos ou reverter lista mais recente. Recarregar histórico após conclusão inclusive de download recuperado.
- Falha do histórico nunca converte vídeo salvo em download falho. A interface comunica que o histórico não pôde ser atualizado, com opção de tentar novamente. JSON corrompido não deve ser sobrescrito silenciosamente.
- Histórico inicial fica vazio; não importar downloads antigos nem varrer a pasta. Abrir o vídeo recém-concluído continua possível mesmo se o registro falhar.

## Abordagens e decisão técnica

1. LocalStorage: simples, mas duplicaria no frontend os caminhos e o conhecimento dos downloads e dificultaria validar abertura. Descartado.
2. SQLite: permite consultas sofisticadas, com custo de nova dependência e migrações para uma lista simples. Adiado.
3. JSON versionado no diretório local do app, com gravação atômica, sincronização no Rust e comandos por ID. Escolha do coordenador por aproveitar a estrutura atual, sem dependências novas.

As operações de arquivos e abertura ficam no Rust. O arquivo é `app_local_data_dir/historico.json`. O frontend nunca envia caminho para abrir. O histórico tem módulo próprio e não amplia a máquina de estados do download com estados de navegação. A UI respeita os temas e o teclado existentes. O checkout compartilhado continua sendo o local de desenvolvimento por instrução da equipe; o pacote de aceitação é gerado de commit em worktree isolado.

## Fechamento da revisão de desenho

- Registro pendente retido em memória é tentado novamente pelas consultas, que rejeitam enquanto a gravação não puder terminar. Vídeo e resultado terminal continuam concluídos. Erro ao carregar, registrar ou limpar recebe contexto próprio; limpar com falha preserva a lista visível.
- Operações do JSON têm ordem total pelo mutex; nenhuma gravação usa snapshot anterior à limpeza. A verificação de disponibilidade de cada vídeo ocorre depois de soltar esse mutex.
- Caminhos canônicos são registrados na conclusão para aceitar pastas legitimamente acessadas por alias do sistema. Na abertura são revalidados arquivo regular, nome/extensão MP4 e ausência de symlinks. Isso não autentica o conteúdo do vídeo nem descobre arquivos movidos.
- Quando falta o vídeo, o fallback de pasta deve revelar o diretório pai validado no gerenciador de arquivos, sem `open_path` nesse diretório: pacotes `.app` no macOS não podem ser executados por essa ação.
- A prévia atual não resolve links curtos para URLs longas; a garantia desta evolução para links curtos é a repetição do mesmo endereço salvo. O simulador respeita caixa do shortcode Instagram, valida formatos suportados e reproduz falha/recuperação do histórico sem repetir o download.

## Contrato da evolução

```ts
type ItemHistorico = {
  downloadId: string;
  urlOriginal: string;
  urlNormalizada: string;
  titulo: string | null;
  plataforma: 'instagram' | 'tiktok';
  caminho: string;
  nomeArquivo: string;
  concluidoEm: number; // Unix em milissegundos
  disponivel: boolean; // calculado ao consultar; não é garantia de abertura futura
};
obter_historico(): Promise<ItemHistorico[]>;
consultar_historico(args: { url: string }): Promise<ItemHistorico | null>;
limpar_historico(): Promise<void>;
abrir_arquivo_download(args: { downloadId: string }): Promise<void>;
abrir_pasta_download(args: { downloadId: string }): Promise<void>; // estendido para IDs persistidos
```

Erros adicionais: `HISTORICO_INDISPONIVEL` (ler/gravar/limpar), `ARQUIVO_AUSENTE` (registro sem arquivo acessível). A implementação deve preservar a mensagem de falha de persistência até recarregamento/reparação bem-sucedidos, sem mentir sobre registro salvo. IDs e caminhos recuperados são validados; abertura de vídeo limitada a arquivo regular de vídeo produzido pelo Clipora, sem executar caminhos arbitrários.

## Aceitação

Testes Rust para persistência/reinício, ordenação, equivalência, indisponibilidade, limpar sem apagar, erro de disco/corrupção e concorrência; testes React para estados, ações, aviso não bloqueante, mudança de URL e respostas atrasadas. Revisão independente da integração. Verificação própria frontend/Rust, scripts/CI, build e uso real local. Windows/Linux continuam pendentes de máquinas e não autorizam push/publicação antes da verificação exigida pelo usuário.
