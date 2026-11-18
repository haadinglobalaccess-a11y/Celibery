import { describe, expect, it } from 'vitest';
import { classifyShowcaseUrl, embedUrlFor, fileUrlFor, providerPoster } from '../../src/lib/showcase-video';
import { cspDirectives } from '../../src/lib/csp';

const ok = (url: string) => {
  const r = classifyShowcaseUrl(url);
  if (!r.ok) throw new Error(`expected ok: ${url} → ${r.reason}`);
  return r.source;
};
const bad = (url: string) => {
  const r = classifyShowcaseUrl(url);
  expect(r.ok, url).toBe(false);
  return r.ok ? '' : r.reason;
};

describe('homepage showcase video links', () => {
  it('YouTube: watch, short, shorts, embed, mobile', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ']) {
      expect(ok(u)).toMatchObject({ provider: 'youtube', id: 'dQw4w9WgXcQ', canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    }
    expect(bad('https://www.youtube.com/playlist?list=PL123')).toMatch(/single video/);
    expect(bad('https://www.youtube.com/@celibery')).toMatch(/single video/);
  });

  it('Vimeo: public and unlisted (hash) links', () => {
    expect(ok('https://vimeo.com/76979871')).toMatchObject({ provider: 'vimeo', id: '76979871' });
    expect(ok('https://vimeo.com/76979871/abcdef1234')).toMatchObject({ id: '76979871', hash: 'abcdef1234' });
    expect(ok('https://player.vimeo.com/video/76979871?h=abcdef1234')).toMatchObject({ hash: 'abcdef1234' });
    expect(bad('https://vimeo.com/channels/staffpicks')).toMatch(/Vimeo/);
  });

  it('Facebook: full video, watch, reel links; short/share links refused with an explanation', () => {
    expect(ok('https://www.facebook.com/celibery/videos/1234567890123456/')).toMatchObject({ provider: 'facebook', id: '1234567890123456', canonicalUrl: 'https://www.facebook.com/celibery/videos/1234567890123456/' });
    expect(ok('https://www.facebook.com/celibery/videos/launch-film/1234567890123456')).toMatchObject({ id: '1234567890123456' });
    expect(ok('https://m.facebook.com/watch/?v=1234567890')).toMatchObject({ canonicalUrl: 'https://www.facebook.com/watch/?v=1234567890' });
    expect(ok('https://www.facebook.com/reel/987654321098')).toMatchObject({ canonicalUrl: 'https://www.facebook.com/reel/987654321098' });
    expect(bad('https://fb.watch/abcDEF123/')).toMatch(/cannot be embedded/);
    expect(bad('https://www.facebook.com/share/v/1AbCdEf/')).toMatch(/cannot be embedded/);
    expect(bad('https://www.facebook.com/celibery')).toMatch(/not a video link/);
  });

  it('direct files and invalid links', () => {
    expect(ok('https://cdn.example.com/films/launch.mp4')).toMatchObject({ provider: 'file' });
    expect(ok('/media/2026/11/video-abc.webm')).toMatchObject({ provider: 'file' });
    expect(bad('http://cdn.example.com/x.mp4')).toMatch(/https/);
    expect(bad('https://example.com/page.html')).toMatch(/YouTube, Vimeo or Facebook/);
    expect(bad('not a url')).toBeTruthy();
    expect(bad('javascript:alert(1)')).toBeTruthy();
    expect(bad('https://user:pw@cdn.example.com/x.mp4')).toBeTruthy();
  });

  it('official click-to-play embeds', () => {
    expect(embedUrlFor(ok('https://youtu.be/dQw4w9WgXcQ'), { startAt: 12 })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&modestbranding=1&playsinline=1&start=12');
    expect(embedUrlFor(ok('https://vimeo.com/76979871/abcdef1234'))).toBe('https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&title=0&byline=0&portrait=0&h=abcdef1234');
    const fb = embedUrlFor(ok('https://www.facebook.com/celibery/videos/1234567890123456/'))!;
    expect(fb.startsWith('https://www.facebook.com/plugins/video.php?')).toBe(true);
    expect(new URL(fb).searchParams.get('href')).toBe('https://www.facebook.com/celibery/videos/1234567890123456/');
    expect(embedUrlFor(ok('https://cdn.example.com/a.mp4'))).toBeNull();
    expect(fileUrlFor('https://cdn.example.com/a.mp4', 5)).toBe('https://cdn.example.com/a.mp4#t=5');
    expect(providerPoster(ok('https://youtu.be/dQw4w9WgXcQ'))).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('the site policy allows exactly the official player frames', () => {
    expect(cspDirectives()['frame-src']).toEqual(['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.facebook.com']);
  });
});
