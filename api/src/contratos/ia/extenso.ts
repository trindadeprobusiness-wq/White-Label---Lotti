// Copiado literalmente de supabase/functions/gerar-contrato/index.ts.
/** Valor em reais por extenso (português do Brasil). */
export function valorParaExtenso(valor: number): string {
  const unidades = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const especiais = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const dezenas = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const centenas = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

  if (valor === 0) return "zero reais";
  if (valor === 100) return "cem reais";

  const partes: string[] = [];
  
  const milhoes = Math.floor(valor / 1000000);
  const milhares = Math.floor((valor % 1000000) / 1000);
  const reais = Math.floor(valor % 1000);
  const centavos = Math.round((valor % 1) * 100);

  const converterGrupo = (n: number): string => {
    if (n === 0) return "";
    if (n === 100) return "cem";
    
    const c = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const u = n % 10;
    
    let resultado = "";
    if (c > 0) resultado += centenas[c];
    
    if (d === 1) {
      if (resultado) resultado += " e ";
      resultado += especiais[u];
    } else {
      if (d > 0) {
        if (resultado) resultado += " e ";
        resultado += dezenas[d];
      }
      if (u > 0) {
        if (resultado) resultado += " e ";
        resultado += unidades[u];
      }
    }
    
    return resultado;
  };

  if (milhoes > 0) {
    partes.push(converterGrupo(milhoes) + (milhoes === 1 ? " milhão" : " milhões"));
  }
  if (milhares > 0) {
    if (milhares === 1) {
      partes.push("mil");
    } else {
      partes.push(converterGrupo(milhares) + " mil");
    }
  }
  if (reais > 0) {
    partes.push(converterGrupo(reais));
  }

  let resultado = partes.join(", ");
  
  if (valor >= 1) {
    resultado += valor === 1 ? " real" : " reais";
  }
  
  if (centavos > 0) {
    if (resultado) resultado += " e ";
    resultado += converterGrupo(centavos) + (centavos === 1 ? " centavo" : " centavos");
  }

  return resultado;
}
