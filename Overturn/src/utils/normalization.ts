export const normalizeCode = (rawCode: string): string => {
  const cleaned = rawCode.trim().toUpperCase().split(/\s+/).join("");
  const trailingDigitsRegex = /(\d{1,3})$/;
  const digits = trailingDigitsRegex.exec(cleaned)?.[1];
  return digits ?? cleaned;
};
