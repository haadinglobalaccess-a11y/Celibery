import { describe, expect, it } from 'vitest';
import { cleanLineText, cleanRichText, decodeEntities, repairMojibake } from '../../src/lib/text';

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
    expect(cleanRichText('  a   b\t c \r\n\r\n\r\n\r\nd﻿​')).toBe('a b c\n\nd');
    expect(cleanRichText('Temperature -5°C')).toBe('Temperature -5°C'); // a minus sign is not a bullet
  });

  it('repairs UTF-8 text that was decoded as Windows-1252 (English and Arabic)', () => {
    const broken = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
    expect(repairMojibake('Itâ€™s fast')).toBe('It’s fast');
    expect(cleanRichText(broken('شاحن سريع'))).toBe('شاحن سريع');
    // Genuine non-Latin text and ordinary accented words are never touched.
    expect(repairMojibake('شاحن â€')).toBe('شاحن â€');
    expect(repairMojibake('Café')).toBe('Café');
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
