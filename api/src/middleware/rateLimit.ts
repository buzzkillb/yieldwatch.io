import { Elysia } from 'elysia';
import type { Context } from 'elysia';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_STORE_SIZE = 10000;
const rateLimitStore = new Map<string, RateLimitEntry>();

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '100');
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
const CLEANUP_INTERVAL_MS = 30000;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getClientIP(context: Context): string {
  if (IS_PRODUCTION) {
    const forwarded = context.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const firstIP = ips.split(',')[0].trim();
      if (firstIP && isValidPublicIP(firstIP)) {
        return firstIP;
      }
    }
    const realIP = context.headers['x-real-ip'];
    if (realIP && isValidPublicIP(realIP)) {
      return realIP;
    }
  }
  const remoteAddr = context.headers['x-forwarded-peer'] || 
                     context.headers['fly-client-ip'] ||
                     context.request.headers.get('host')?.split(':')[0] ||
                     'unknown';
  return typeof remoteAddr === 'string' ? remoteAddr.split(',')[0].trim() : 'unknown';
}

function isValidPublicIP(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  if (isPrivateIP(ip)) return false;
  return true;
}

function isPrivateIP(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function cleanExpiredEntries(): void {
  const now = Date.now();
  let deleted = 0;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
      deleted++;
    }
  }
  if (rateLimitStore.size > MAX_STORE_SIZE) {
    const entries = Array.from(rateLimitStore.entries());
    entries.slice(0, entries.length - MAX_STORE_SIZE).forEach(([key]) => {
      rateLimitStore.delete(key);
    });
  }
}

setInterval(cleanExpiredEntries, CLEANUP_INTERVAL_MS);

export const rateLimit = () => {
  return (app: Elysia) => {
    return app.onBeforeHandle(async (context) => {
      const ip = getClientIP(context);
      if (ip === 'unknown') {
        return;
      }
      
      const now = Date.now();
      
      let entry = rateLimitStore.get(ip);
      
      if (!entry || entry.resetAt <= now) {
        entry = {
          count: 0,
          resetAt: now + WINDOW_MS,
        };
        rateLimitStore.set(ip, entry);
      }
      
      entry.count++;
      
      if (entry.count > MAX_REQUESTS) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        
        return new Response(
          JSON.stringify({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Treasury data updates daily, please cache responses.',
            retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': MAX_REQUESTS.toString(),
              'X-RateLimit-Remaining': '0',
              'Retry-After': retryAfter.toString(),
            },
          }
        );
      }
      
      context.set.headers = {
        ...context.set.headers,
        'X-RateLimit-Limit': MAX_REQUESTS.toString(),
        'X-RateLimit-Remaining': String(MAX_REQUESTS - entry.count),
      };
    });
  };
};
