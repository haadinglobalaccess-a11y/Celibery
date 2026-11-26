/**
 * Crawlers that read the HTML without running JavaScript (or render it late): search engines,
 * AI assistants / AI search, and link-preview bots (WhatsApp, X, Telegram, Slack…). They receive
 * the server-rendered page (modules/seo/prerender.ts); people get the normal storefront.
 *
 * Keep this list in sync with the `has` user-agent rule in vercel.json.
 */
export const BOT_TOKENS = [
  // Search engines
  'Googlebot', 'Google-InspectionTool', 'GoogleOther', 'Storebot-Google', 'AdsBot-Google', 'Mediapartners-Google', 'APIs-Google', 'FeedFetcher-Google',
  'bingbot', 'BingPreview', 'msnbot', 'adidxbot', 'DuckDuckBot', 'DuckAssistBot', 'YandexBot', 'Baiduspider', 'Applebot', 'Slurp', 'PetalBot', 'SeznamBot', 'Qwantify', 'Naver', 'Yeti',
  // AI assistants and AI search
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'CCBot', 'Bytespider', 'Amazonbot', 'cohere-ai', 'meta-externalagent', 'MistralAI-User', 'YouBot', 'Diffbot',
  // Link previews
  'facebookexternalhit', 'Facebot', 'Twitterbot', 'LinkedInBot', 'Slackbot', 'TelegramBot', 'WhatsApp', 'Discordbot', 'Pinterestbot', 'redditbot', 'Embedly', 'Iframely', 'SkypeUriPreview', 'Snapchat', 'vkShare', 'Viber',
];

const BOT_RE = new RegExp(BOT_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|'), 'i');

export const isBot = (ua: string | undefined | null) => Boolean(ua && BOT_RE.test(ua));
