import { useCallback, useEffect, useRef, useState } from "react";
import { mensagemDoErro } from "../erros/mensagens";
import { normalizarErro } from "../erros/normalizar";
import { servico as servicoPadrao } from "../servicos";
import type { ServicoClipora } from "../servicos/tipos";
import type { ItemHistorico, Previa } from "../tipos/contrato";

export function useHistorico(servico: ServicoClipora = servicoPadrao, previa: Previa | null = null) {
  const [itens, setItens] = useState<ItemHistorico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [erroConsultaDuplicidade, setErroConsultaDuplicidade] = useState<string | null>(null);
  const [contextoErro, setContextoErro] = useState<"carregar" | "registrar" | "limpar" | null>(null);
  const [avisoAcao, setAvisoAcao] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<ItemHistorico | null>(null);
  const geracaoLista = useRef(0);
  const geracaoConsulta = useRef(0);
  const limparEmAndamento = useRef(false);
  const recargaPendente = useRef(false);
  const consultaInterrompida = useRef(false);
  const [revisaoConsulta, setRevisaoConsulta] = useState(0);
  const contextoErroRef = useRef(contextoErro);
  contextoErroRef.current = contextoErro;
  const erroConsultaRef = useRef(erroConsultaDuplicidade);
  erroConsultaRef.current = erroConsultaDuplicidade;
  const previaRef = useRef(previa);
  previaRef.current = previa;

  const recarregar = useCallback(async (contexto: "carregar" | "registrar" = "carregar") => {
    if (limparEmAndamento.current) {
      recargaPendente.current = true;
      return;
    }
    const geracao = ++geracaoLista.current;
    setCarregando(true);
    try {
      const lista = await servico.obter_historico();
      if (geracao !== geracaoLista.current) return;
      setItens(lista);
      if (contextoErroRef.current !== "limpar") {
        setErro(null);
        setContextoErro(null);
        contextoErroRef.current = null;
      }
      if (previaRef.current && erroConsultaRef.current) {
        // A leitura pode ter gravado um item pendente. Reconsulte a prévia
        // ativa para restaurar o aviso de duplicidade após a recuperação.
        setRevisaoConsulta((revisao) => revisao + 1);
      }
    } catch (desconhecido) {
      if (geracao !== geracaoLista.current) return;
      contextoErroRef.current = contexto;
      setContextoErro(contexto);
      setErro(contexto === "registrar"
        ? "Não foi possível registrar este download no histórico. O vídeo foi concluído e pode ser aberto. Tente novamente."
        : "Não foi possível carregar o histórico. Tente novamente.");
    } finally {
      if (geracao === geracaoLista.current) setCarregando(false);
    }
  }, [servico]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  useEffect(() => {
    const token = ++geracaoConsulta.current;
    setDuplicado(null);
    setErroConsultaDuplicidade(null);
    if (!previa) return;
    if (limparEmAndamento.current) {
      consultaInterrompida.current = true;
      return;
    }
    void servico.consultar_historico({ url: previa.urlNormalizada }).then(
      (item) => {
        if (token === geracaoConsulta.current && previaRef.current?.urlNormalizada === previa.urlNormalizada) {
          setDuplicado(item);
          const contexto = contextoErroRef.current;
          if (contexto === "registrar" || contexto === "carregar") void recarregar(contexto);
        }
      },
      () => {
        // A consulta de duplicidade não pode transformar prévia/download em erro.
        if (token === geracaoConsulta.current) {
          setDuplicado(null);
          setErroConsultaDuplicidade("Não foi possível conferir se este vídeo já está no histórico. Você ainda pode baixar normalmente.");
        }
      },
    );
    return () => { if (token === geracaoConsulta.current) geracaoConsulta.current++; };
  }, [servico, previa?.urlNormalizada, previa?.urlOriginal, revisaoConsulta, recarregar]);

  const limpar = useCallback(async (): Promise<boolean> => {
    if (limparEmAndamento.current) return false;
    limparEmAndamento.current = true;
    const listaToken = ++geracaoLista.current;
    ++geracaoConsulta.current;
    consultaInterrompida.current = true;
    setCarregando(true);
    setAvisoAcao(null);
    try {
      await servico.limpar_historico();
      if (listaToken !== geracaoLista.current) return false;
      setItens([]);
      setErro(null);
      contextoErroRef.current = null;
      setContextoErro(null);
      setDuplicado(null);
      setErroConsultaDuplicidade(null);
      return true;
    } catch (desconhecido) {
      if (listaToken === geracaoLista.current) {
        contextoErroRef.current = "limpar";
        setContextoErro("limpar");
        setErro("Não foi possível limpar o histórico. Os registros anteriores foram mantidos. Tente novamente.");
      }
      return false;
    } finally {
      limparEmAndamento.current = false;
      if (listaToken === geracaoLista.current) setCarregando(false);
      if (recargaPendente.current) {
        recargaPendente.current = false;
        void recarregar(contextoErro === "registrar" ? "registrar" : "carregar");
      }
      if (consultaInterrompida.current) {
        consultaInterrompida.current = false;
        setRevisaoConsulta((revisao) => revisao + 1);
      }
    }
  }, [servico, recarregar, contextoErro]);

  const executarAcao = useCallback(async (acao: () => Promise<void>, falha: string) => {
    setAvisoAcao(null);
    try { await acao(); }
    catch (desconhecido) { setAvisoAcao(`${falha} ${mensagemDoErro(normalizarErro(desconhecido))}`); }
  }, []);
  const abrirArquivo = useCallback((downloadId: string) => executarAcao(
    () => servico.abrir_arquivo_download({ downloadId }), "Não foi possível abrir o vídeo.",
  ), [executarAcao, servico]);
  const abrirPasta = useCallback((downloadId: string) => executarAcao(
    () => servico.abrir_pasta_download({ downloadId }), "Não foi possível abrir a pasta.",
  ), [executarAcao, servico]);

  return { itens, carregando, erro, contextoErro, avisoAcao, erroConsultaDuplicidade, duplicado, recarregar, limpar, abrirArquivo, abrirPasta };
}
