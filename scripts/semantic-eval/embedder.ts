/**
 * A deterministic stand-in for the embedding model, for offline tests and the offline eval.
 *
 * Each word maps to a concept (a small English/Spanish lexicon, so "célula" and "cells" meet)
 * or to its own stem, plus character trigrams so typos land near the right word. Features are
 * hashed into EMBEDDING_DIMENSIONS signed buckets and normalised. It is not a language model:
 * it exercises the pipeline (chunking, partitions, fusion, signals, permissions) with stable
 * numbers. Real quality is measured by `npm run eval:semantic` with the configured model.
 */
import { EMBEDDING_DIMENSIONS } from "../../convex/embeddingProvider";
import { foldForSearch } from "../../shared/semantic-chunks";

const CONCEPTS: Record<string, string[]> = {
  cell: ["cell", "cells", "celula", "celulas", "cellular", "celular"],
  organelle: ["organelle", "organelles", "organulo", "organulos", "mitochondria", "mitocondria", "nucleus", "ribosomes", "chloroplasts"],
  photosynthesis: ["photosynthesis", "fotosintesis", "chlorophyll", "clorofila", "calvin"],
  light: ["light", "sunlight", "luz", "solar", "sun"],
  sugar: ["sugar", "sugars", "glucose", "glucosa", "azucar"],
  plant: ["plant", "plants", "planta", "plantas"],
  war: ["war", "wars", "guerra", "guerras", "wwi", "conflict", "conflicto"],
  world: ["world", "mundial", "mundo", "global"],
  first: ["first", "primera", "primer"],
  cause: ["cause", "causes", "causa", "causas", "start", "started", "why", "origins", "porque", "reasons"],
  acid: ["acid", "acids", "acidic", "acido", "acidos", "base", "bases", "basic", "ph", "neutralisation", "neutralization"],
  measure: ["measure", "measures", "measuring", "medir", "mide"],
  climate: ["climate", "climatico", "warming", "calentamiento", "greenhouse", "emissions"],
  force: ["force", "fuerza", "newton", "motion", "movimiento", "inertia"],
  acceleration: ["acceleration", "aceleracion", "mass", "masa"],
  quadratic: ["quadratic", "cuadratica", "cuadraticas", "discriminant", "discriminante"],
  solution: ["solutions", "roots", "raices", "soluciones"],
  enzyme: ["enzyme", "enzymes", "enzima", "enzimas", "catalyst", "catalysts", "catalizador", "catalase", "catalasa"],
  notes: ["notes", "note", "apuntes", "notas"],
  vocabulary: ["vocabulary", "vocabulario", "words", "palabras"],
  food: ["food", "comida", "alimentos", "bread", "pan", "milk", "leche", "cheese", "queso", "apple", "manzana"],
  revolution: ["revolution", "revolucion", "bastille", "bastilla"],
  french: ["french", "francesa", "frances", "france", "francia"],
  chemistry: ["chemistry", "quimica", "chemical"],
  essay: ["essay", "essays", "ensayo", "ensayos"],
  deck: ["deck", "slides", "presentation", "presentacion", "diapositivas", "pitch"],
  test: ["test", "exam", "examen", "prueba"],
  ask: ["ask", "asked", "pregunte", "preguntar", "question", "questions", "help", "ayuda"],
  titration: ["titration", "titracion", "valoracion", "endpoint", "molarity", "concentration"],
  volcano: ["volcano", "volcanoes", "volcanes", "volcan", "magma", "eruption"],
  tectonic: ["tectonic", "tectonica", "plates", "placas"],
  guilt: ["guilt", "culpa", "guilty"],
  energy: ["energy", "energia", "renewable", "renovable", "wind", "turbines"],
  budget: ["budget", "presupuesto", "expenses", "gastos", "savings", "ahorro"],
  lab: ["lab", "laboratory", "laboratorio", "experiment", "experimento"],
  report: ["report", "informe", "writeup"],
  reflection: ["reflection", "reflexion", "reflect", "learned", "aprendi"],
};
const CONCEPT_OF = new Map(Object.entries(CONCEPTS).flatMap(([concept, words]) => words.map((word) => [word, concept] as const)));
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "is", "are", "my", "i", "it", "that", "this", "for", "with",
  "de", "la", "el", "los", "las", "y", "o", "en", "un", "una", "que", "mi", "sobre", "del", "about", "how", "what", "did", "does"]);

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

const stem = (word: string) => word.length > 4 ? word.replace(/(es|s)$/, "") : word;

export function deterministicEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const add = (feature: string, weight: number) => {
    const bucket = hash(feature);
    vector[bucket % EMBEDDING_DIMENSIONS]! += (bucket & 0x8000_0000 ? -1 : 1) * weight;
  };
  const words = foldForSearch(text).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1 && !STOP.has(word));
  for (const word of words) {
    const concept = CONCEPT_OF.get(word) ?? CONCEPT_OF.get(stem(word));
    add(`c:${concept ?? stem(word)}`, 1);
    const padded = ` ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) add(`g:${padded.slice(index, index + 3)}`, 0.3);
  }
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector.map((_, index) => index === 0 ? 1 : 0);
}

/**
 * A `fetch` replacement answering OpenRouter embedding requests with `embed`, in the response
 * shape convex/embeddingProvider.ts validates. Other URLs fail loudly.
 */
export function embeddingFetch(embed: (texts: string[]) => number[][] | Promise<number[][]>) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).endsWith("/embeddings")) throw new Error(`Unexpected request in semantic eval: ${String(url)}`);
    const body = JSON.parse(String(init?.body)) as { input: string | string[] };
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const vectors = await embed(inputs);
    return Response.json({ model: "text-embedding-3-small", provider: "OpenAI",
      data: vectors.map((embedding, index) => ({ index, embedding })) });
  };
}
