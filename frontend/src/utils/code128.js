// Code 128 symbol patterns (values 0–106), represented as alternating bar/space widths.
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

const digitRunLength = (value, start) => {
  let end = start;
  while (end < value.length && value.charCodeAt(end) >= 48 && value.charCodeAt(end) <= 57) end += 1;
  return end - start;
};

/** Use Code Set C for useful even-length digit runs, while preserving text. */
const encodeCodewords = (value) => {
  let index = 0;
  let set = digitRunLength(value, 0) >= 4 ? "C" : "B";
  const codes = [set === "C" ? 105 : 104];

  while (index < value.length) {
    const runLength = digitRunLength(value, index);
    if (set === "B") {
      const pairedDigits = runLength - (runLength % 2);
      const savesCodewords = runLength % 2 === 0 ? runLength >= 4 : runLength >= 7;
      if (savesCodewords && pairedDigits >= 4) {
        codes.push(99); // Code Set C
        set = "C";
        continue;
      }
      codes.push(value.charCodeAt(index) - 32);
      index += 1;
      continue;
    }

    if (runLength >= 2) {
      const pairedDigits = runLength - (runLength % 2);
      for (let offset = 0; offset < pairedDigits; offset += 2) {
        codes.push(Number(value.slice(index + offset, index + offset + 2)));
      }
      index += pairedDigits;
      continue;
    }

    codes.push(100); // Return to Code Set B.
    set = "B";
  }

  return codes;
};

/** Return black bar segments for a scannable Code 128 SVG. */
export const code128Bars = (input) => {
  const value = String(input ?? "");
  if (!value || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126)) {
    return null;
  }

  const codes = encodeCodewords(value);
  // Code 128 includes the start code once, then weights each data/code-set
  // value by its 1-based position after the start code.
  const checksum = codes.reduce((sum, code, index) => sum + code * Math.max(index, 1), 0) % 103;
  codes.push(checksum, 106);

  let x = 0;
  const bars = [];
  for (const code of codes) {
    const pattern = PATTERNS[code];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return { bars, width: x };
};
