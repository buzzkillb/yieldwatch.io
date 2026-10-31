// Raw template imports handled by Vite. Importing with `?raw` keeps the build
// independent of process.cwd() and lets the bundler track these files, unlike
// readFileSync(join(process.cwd(), ...)).
import blogPostHtml from '../templates/blog-post.html?raw';
import blogHtml from '../templates/blog.html?raw';
import indexHtml from '../templates/index.html?raw';

export const TEMPLATES: Record<string, string> = {
  'blog-post.html': blogPostHtml,
  'blog.html': blogHtml,
  'index.html': indexHtml,
};
