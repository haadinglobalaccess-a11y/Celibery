import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanLineText, cleanRichText, decodeEntities, decodeTextBytes as decodeServer, hasReplacementChar, repairMojibake } from '../../src/lib/text';

// Damaged text is produced the way it happens in real life — UTF-8 bytes read in another encoding —
// so the repository itself never contains literal mojibake (see encoding-guard.test.ts).
const cp1252 = new TextDecoder('windows-1252');
const asCp1252 = (s: string) => cp1252.decode(Buffer.from(s, 'utf8'));
const asLatin1 = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
const ch = (...cps: number[]) => String.fromCodePoint(...cps);

/** Bytes of `s` in Windows-1256 (Arabic Windows), built by inverting the platform decoder. */
function cp1256Bytes(s: string): Buffer {
  const dec = new TextDecoder('windows-1256');
  const map = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) map.set(dec.decode(Uint8Array.of(b)), b);
  return Buffer.from([...s].map((c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : map.get(c)!)));
}

describe('product text normalisation', () => {
  it('turns Shopify-style HTML into paragraphs and bullet points (no markup survives)', () => {
    const html =
      '<p>Fast charging for <strong>every</strong> device.</p><ul><li>65W USB-C PD</li><li>3 ports &amp; foldable plug</li></ul><h3>In the box</h3><p>Charger<br>Manual</p><script>alert(1)</script>';
    expect(cleanRichText(html)).toBe('Fast charging for **every** device.\n\n- 65W USB-C PD\n- 3 ports & foldable plug\n\n### In the box\n\nCharger\nManual');
  });

  it('keeps clean Arabic and English text exactly as written (idempotent)', () => {
    const ar = 'شاحن سريع بقدرة 65 واط.\n\n- منفذان USB-C\n- منفذ USB-A';
    const en = 'Line one\nLine two\n\n**Bold** start';
    expect(cleanRichText(ar)).toBe(ar);
    expect(cleanRichText(en)).toBe(en);
    expect(cleanRichText(cleanRichText(ar))).toBe(ar);
  });

  it('unifies bullet styles and spacing, and drops invisible characters', () => {
    expect(cleanRichText('• one\n* two\n– three\n·four')).toBe('- one\n- two\n- three\n- four');
    expect(cleanRichText(`  a   b\t c \r\n\r\n\r\n\r\nd${ch(0xfeff)}${ch(0x200b)}`)).toBe('a b c\n\nd');
    expect(cleanRichText('Temperature -5°C')).toBe('Temperature -5°C'); // a minus sign is not a bullet
  });

  it('decodes entities but never produces HTML', () => {
    expect(decodeEntities('A &amp; B &#39;x&#x27; &nbsp;&unknown;')).toBe("A & B 'x'  &unknown;");
    expect(cleanRichText('&lt;b&gt;not bold&lt;/b&gt;')).toBe('<b>not bold</b>'); // shown as text: React escapes it
  });

  it('makes single-line text for names and short descriptions', () => {
    expect(cleanLineText('<p>Wall charger</p>\n<p>65W</p>')).toBe('Wall charger 65W');
    expect(cleanLineText('- **USB-C** cable')).toBe('USB-C cable');
    expect(cleanLineText(undefined)).toBe('');
  });
});

describe('encoding repair (mojibake)', () => {
  const samples = [
    'It’s fast — “quick” charge…',
    'شاحن سريع 65 واط',
    'Settings → Warranty ← Back ↗',
    'Price: SAR 99.00 · ر.س ٩٩',
    'Café, naïve, résumé, ×2, °C, ™, €',
    'یہ چارجر تیز ہے', // Urdu
    'Mixed: كابل USB-C بطول 1 م',
  ];

  it('restores text damaged by Windows-1252 and by Latin-1 decoding', () => {
    for (const s of samples) {
      expect(repairMojibake(asCp1252(s))).toBe(s);
      expect(repairMojibake(asLatin1(s))).toBe(s);
      expect(cleanRichText(asCp1252(s))).toBe(s);
    }
  });

  it('restores double-encoded text', () => {
    for (const s of samples) expect(repairMojibake(asCp1252(asCp1252(s)))).toBe(s);
  });

  it('repairs only the damaged part of a mixed string (the Admin hint case)', () => {
    expect(repairMojibake(`e.g. Riyadh and ${asCp1252('الريا')}ض.`)).toBe('e.g. Riyadh and الرياض.');
    expect(repairMojibake(`شاحن ${asCp1252('سريع')}`)).toBe('شاحن سريع');
  });

  it('removes leftover control characters after an already-correct quote', () => {
    expect(repairMojibake(`“Shop now”${ch(0x9d)}`)).toBe('“Shop now”');
  });

  it('never changes legitimate text', () => {
    for (const s of [...samples, 'Ã is a letter in Portuguese: São Tomé', 'Ø is Danish', 'Emoji 🔌⚡ and ✓', '']) expect(repairMojibake(s)).toBe(s);
  });

  it('flags characters that were already lost (not repairable)', () => {
    expect(hasReplacementChar(`Name ${ch(0xfffd)}${ch(0xfffd)}`)).toBe(true);
    expect(hasReplacementChar('شاحن')).toBe(false);
  });
});

// The Admin upload decoder lives in the client bundle; it is loaded at run time (the server's typecheck
// only covers server/) so the same fixtures prove both copies behave identically.
type Decoder = (bytes: Uint8Array) => { text: string; encoding: string };
const clientModule = path.resolve(__dirname, '../../../client/src/lib/textFile.ts');
const decodeClient: Decoder = (bytes) => clientDecoder!(bytes);
let clientDecoder: Decoder | undefined;

describe('CSV file decoding (Admin upload and npm run import:products)', () => {
  beforeAll(async () => {
    clientDecoder = ((await import(/* @vite-ignore */ clientModule)) as { decodeTextBytes: Decoder }).decodeTextBytes;
  });
  const csv = 'sku,name_ar,name_en\nA-1,شاحن جداري,Wall charger\nA-2,كابل,Câble';
  for (const [label, decode] of [['server', decodeServer], ['client', decodeClient]] as const) {
    it(`${label}: UTF-8 (with or without BOM), Arabic Windows-1256 and Western Windows-1252`, () => {
      expect(decode(Buffer.from(csv, 'utf8'))).toEqual({ text: csv, encoding: 'utf-8' });
      expect(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]))).toEqual({ text: csv, encoding: 'utf-8' });
      // Excel "CSV (Comma delimited)" on Arabic Windows.
      const arabicOnly = 'sku,name_ar\nA-1,شاحن جداري\nA-2,كابل';
      expect(decode(cp1256Bytes(arabicOnly))).toEqual({ text: arabicOnly, encoding: 'windows-1256' });
      // Excel on English Windows.
      expect(decode(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toEqual({ text: 'Café', encoding: 'windows-1252' });
    });
  }
});
