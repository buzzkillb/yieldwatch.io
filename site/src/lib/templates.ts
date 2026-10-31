// Raw template imports handled by Vite. Importing with `?raw` keeps the build
// independent of process.cwd() and lets the bundler track these files, unlike
// readFileSync(join(process.cwd(), ...)).
import apiDocsHtml from '../templates/api-docs.html?raw';
import blogPostHtml from '../templates/blog-post.html?raw';
import blogHtml from '../templates/blog.html?raw';
import faqHtml from '../templates/faq.html?raw';
import indexHtml from '../templates/index.html?raw';

export const TEMPLATES: Record<string, string> = {
  'api-docs.html': apiDocsHtml,
  'blog-post.html': blogPostHtml,
  'blog.html': blogHtml,
  'faq.html': faqHtml,
  'index.html': indexHtml,
};
