import { buildRssFeed, SUMMARIES, postHeadline } from '../lib/site';

const RSS_EXCERPT_LIMIT = 300;

function excerptFor(summary: string, blogSummary: string): string {
  const text = (summary || blogSummary || '').trim().replace(/\s+/g, ' ');
  if (text.length <= RSS_EXCERPT_LIMIT) return text;
  const cut = text.slice(0, RSS_EXCERPT_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > RSS_EXCERPT_LIMIT * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export const GET = () => {
  const posts = [...SUMMARIES]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200)
    .map(s => ({ date: s.date, title: postHeadline(s.date), excerpt: excerptFor(s.summary, s.blogSummary) }));
  return new Response(buildRssFeed(posts), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
