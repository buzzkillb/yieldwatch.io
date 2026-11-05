import fs from 'fs'; import path from 'path';
const root='dist';
const htmls=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory())w(p); else if(e.name.endsWith('.html'))htmls.push(p);}})(root);
const urlOf=f=>'/'+path.relative(root,f).replace(/index\.html$/,'').replace(/\.html$/,'');
const titles=new Map(), descs=new Map(), links=new Map(), canonicals=new Map();
for(const f of htmls){
  const h=fs.readFileSync(f,'utf8'), u=urlOf(f);
  const t=(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[,''])[1].trim();
  const d=(h.match(/<meta\s+name="description"\s+content="([^"]*)"/i)||[,''])[1];
  const c=(h.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)||[,''])[1];
  titles.set(u,t); descs.set(u,d); canonicals.set(u,c);
  links.set(u,[...h.matchAll(/<a\b[^>]*href="(\/[^"#?]*)/gi)].map(m=>m[1]));
}
const dupT=[...titles].filter(([u,t])=>t&&[...titles.values()].filter(x=>x===t).length>1);
const dupD=[...descs].filter(([u,d])=>d&&[...descs.values()].filter(x=>x===d).length>1);
// canonical mismatches
const cm=[...canonicals].filter(([u,c])=>c && !c.endsWith(u) && !(u==='/'&&c==='https://yieldwatch.io/'));
// broken internal links
const broken=[];
for(const [u,ls] of links) for(const l of new Set(ls)){
  const clean=l.replace(/\/$/,'')||'/';
  const target=path.join(root, clean==='/'?'index.html':clean.replace(/^\//,'')+'/index.html');
  const target2=path.join(root, clean.replace(/^\//,''));
  if(!fs.existsSync(target)&&!fs.existsSync(target2)&&!fs.existsSync(target2+'.html')) broken.push([u,l]);
}
// orphan pages (no inbound internal link), excluding homepage
const inbound=new Map(htmls.map(f=>[urlOf(f),0]));
for(const [u,ls] of links) for(const l of new Set(ls)){ const k=l.replace(/\/$/,'')+'/'||'/'; if(inbound.has(k)) inbound.set(k,inbound.get(k)+1); }
const orphans=[...inbound].filter(([u,n])=>u!=='/'&&n===0);
console.log(JSON.stringify({pages:htmls.length,dupTitles:dupT.length,dupDescs:dupD.length,canonicalMismatch:cm.length,broken:broken.length,orphans:orphans.length},null,2));
console.log('DUP TITLES',dupT.slice(0,6).map(x=>x[0]+' :: '+x[1]));
console.log('DUP DESCS',dupD.slice(0,6).map(x=>x[0]+' :: '+x[1].slice(0,60)));
console.log('CANON',cm.slice(0,6));
console.log('BROKEN',broken.slice(0,12));
console.log('ORPHANS',orphans.slice(0,12));
