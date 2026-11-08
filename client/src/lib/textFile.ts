/**
 * Reads an uploaded text file (product CSV) in the encoding it was really saved in.
 *
 * `File.text()` always decodes UTF-8. Excel's plain "CSV (Comma delimited)" on Windows saves in the
 * system code page instead — Windows-1256 on Arabic Windows, Windows-1252 on English Windows — and
 * decoding those bytes as UTF-8 turns every Arabic letter into "\ufffd" for good. So: strict UTF-8 first
 * (what "CSV UTF-8" and the template produce); otherwise Windows-1256 when that yields Arabic letters;
 * otherwise Windows-1252.
 */
export type DecodedText = { text: string; encoding: 'utf-8' | 'windows-1256' | 'windows-1252' };

const ARABIC = /[ء-ي]/;

export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    /* not UTF-8: a legacy Windows code page */
  }
  try {
    const arabic = new TextDecoder('windows-1256').decode(body);
    if (ARABIC.test(arabic)) return { text: arabic, encoding: 'windows-1256' };
  } catch {
    /* decoder unavailable in this browser */
  }
  return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
}

export async function readTextFile(file: File): Promise<DecodedText> {
  return decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
}
