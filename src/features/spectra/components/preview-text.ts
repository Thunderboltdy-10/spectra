function decodeEntityCodePoint(rawCode: string, radix: 10 | 16) {
  const codePoint = Number.parseInt(rawCode, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : " ";
}

/** Plain-text boundary for every compact preview, card, row, and inspector. */
export function previewText(value: string | null | undefined, fallback = "") {
  if (!value) return fallback;
  if (!/[<&]/.test(value)) return value.trim() || fallback;
  const withSpacing = value
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6])\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /<(?:a|abbr|b|blockquote|br|code|div|em|h[1-6]|i|li|ol|p|pre|span|strong|table|tbody|td|th|thead|tr|u|ul)\b[^>]*$/gi,
      " ",
    );
  return (
    withSpacing
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:39|x27);/gi, "'")
      .replace(/&#(\d+);/g, (_match, code) => decodeEntityCodePoint(code, 10))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
        decodeEntityCodePoint(code, 16),
      )
      .replace(/\s+/g, " ")
      .trim() || fallback
  );
}
