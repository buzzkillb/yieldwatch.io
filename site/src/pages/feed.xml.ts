import { buildRssFeed, SUMMARIES, postHeadline } from '../lib/site';

export const GET = () => {
  const posts = [...SUMMARIES]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200)
    .map(s => ({ date: s.date, title: postHeadline(s.date), excerpt: (s.summary || s.blogSummary || '').trim().replace(/\s+/g, ' ').slice(0, 300) }));
  return new Response(buildRssFeed(posts), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
