/**
 * División de texto en fragmentos para búsqueda. Basado en caracteres,
 * respetando párrafos cuando es posible, con solapamiento moderado y sin
 * fragmentos vacíos.
 */

export type TextChunk = {
  index: number;
  content: string;
  tokenCount: number;
};

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 200;

/** Estimación aproximada de tokens (~4 caracteres por token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

/** Parte un párrafo más largo que `size` por oraciones y, si hace falta, por palabras. */
function splitLongParagraph(paragraph: string, size: number): string[] {
  const parts: string[] = [];
  const sentences = paragraph.split(/(?<=[.!?…])\s+/);
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) parts.push(buffer.trim());
    buffer = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > size) {
      flush();
      let word = "";
      for (const token of sentence.split(/\s+/)) {
        if ((`${word} ${token}`).trim().length > size) {
          if (word) parts.push(word);
          word = token;
        } else {
          word = word ? `${word} ${token}` : token;
        }
      }
      if (word) buffer = word;
    } else if ((`${buffer} ${sentence}`).trim().length > size && buffer) {
      flush();
      buffer = sentence;
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }
  flush();
  return parts;
}

export function chunkText(
  text: string,
  options?: { chunkSize?: number; overlap?: number }
): TextChunk[] {
  const size = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(options?.overlap ?? DEFAULT_OVERLAP, Math.floor(size / 2));

  const clean = text.trim();
  if (!clean) return [];

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      units.push(...splitLongParagraph(paragraph, size));
    } else {
      units.push(paragraph);
    }
  }

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length > size && current) {
      chunks.push(current.trim());
      const tail = overlap > 0 ? current.slice(-overlap).trim() : "";
      current = tail ? `${tail}\n\n${unit}` : unit;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .map((content, index) => ({
      index,
      content,
      tokenCount: estimateTokens(content),
    }));
}
