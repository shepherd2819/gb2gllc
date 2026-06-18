// Converts tool-result strings into TTS-friendly spoken form. Raw text to a
// TTS engine ($42.50, phone digits, 2:30pm) is a top robotic "tell"; normalizing
// here makes Hollis read like a person. Each pass is pure and order-independent
// enough to chain. Applied to every tool result before it returns to Retell.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

function under1000(n: number): string {
  if (n < 100) return under100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return r ? `${ONES[h]} hundred ${under100(r)}` : `${ONES[h]} hundred`;
}

export function numberToWords(n: number): string {
  if (n < 0) return `negative ${numberToWords(-n)}`;
  if (n < 1000) return under1000(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const thWords = `${under1000(th)} thousand`;
  return r ? `${thWords} ${under1000(r)}` : thWords;
}

function spokenCurrency(text: string): string {
  return text.replace(/\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/g, (_m, dollarsStr: string, centsStr?: string) => {
    const dollars = parseInt(dollarsStr.replace(/,/g, ""), 10);
    let out = `${numberToWords(dollars)} dollar${dollars === 1 ? "" : "s"}`;
    if (centsStr) {
      const cents = parseInt(centsStr, 10);
      if (cents > 0) out += ` and ${numberToWords(cents)} cents`;
    }
    return out;
  });
}

function spokenTime(text: string): string {
  return text.replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/gi, (_m, h: string, min: string, ap: string) => {
    const hour = numberToWords(parseInt(h, 10));
    const m = parseInt(min, 10);
    const period = ap.toLowerCase() === "a" ? "AM" : "PM";
    if (m === 0) return `${hour} ${period}`;
    const minWords = m < 10 ? `oh ${numberToWords(m)}` : numberToWords(m);
    return `${hour} ${minWords} ${period}`;
  });
}

function spokenPhone(text: string): string {
  return text.replace(/\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g, (m) => {
    const digits = m.replace(/\D/g, "");
    const words = digits.split("").map((d) => ONES[parseInt(d, 10)]);
    const area = words.slice(0, 3).join(" ");
    const prefix = words.slice(3, 6).join(" ");
    const line = words.slice(6, 10).join(" ");
    return `${area}, ${prefix}, ${line}`;
  });
}

export function toSpokenForm(text: string): string {
  let out = text;
  out = spokenCurrency(out);
  out = spokenTime(out);
  out = spokenPhone(out);
  return out;
}
