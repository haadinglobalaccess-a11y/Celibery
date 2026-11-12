import { describe, expect, it } from 'vitest';
import { cleanFaqText, faqTextProblem, isSafeFaqLink } from '../../src/lib/faq-content';

describe('FAQ text rules', () => {
  it('accepts plain Arabic / English text and the Markdown subset', () => {
    for (const s of ['نعم، التوصيل مجاني داخل الرياض.', '**Bold** and [a link](https://celibery.example/x?y=1#z)', '- one\n- two\n\n1. first\n2. second', 'See [tracking](/ar/track)', 'Price < 100 SAR and > 50'])
      expect(faqTextProblem(s, { rich: true }), s).toBeNull();
  });

  it('refuses HTML, comments and unsafe link targets', () => {
    for (const s of ['<p>x</p>', '<script>alert(1)</script>', 'x <img src=x onerror=1>', '<!-- hidden -->', '< svg onload=1>', '[x](javascript:alert(1))', '[x](JAVASCRIPT:alert(1))', '[x](//evil.example)', '[x](/\\evil.example)', '[x](data:text/html;base64,AAAA)', '[x]()', '[x](ftp://host/file)'])
      expect(faqTextProblem(s, { rich: true }), s).not.toBeNull();
  });

  it('keeps questions on one line', () => {
    expect(faqTextProblem('One line?', { rich: false })).toBeNull();
    expect(faqTextProblem('Two\nlines', { rich: false })).not.toBeNull();
  });

  it('normalises line endings, removes control characters, keeps Unicode', () => {
    expect(cleanFaqText('  a\r\nb\u0000c\u0007\n\n\n\nd  ')).toBe('a\nbc\n\nd');
    expect(cleanFaqText('مرحبا 👋 café')).toBe('مرحبا 👋 café');
  });

  it('link rule matches the admin link rule', () => {
    expect(isSafeFaqLink('https://a.example')).toBe(true);
    expect(isSafeFaqLink('/en/faq')).toBe(true);
    expect(isSafeFaqLink('//a.example')).toBe(false);
    expect(isSafeFaqLink('https://')).toBe(false);
  });
});
