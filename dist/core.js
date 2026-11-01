export function normalizeOrcid(input) {
  let id = String(input).trim().replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '').replace(/\/$/, '').toUpperCase();
  if (/^\d{15}[\dX]$/.test(id)) id = id.match(/.{4}/g).join('-');
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) throw new Error('Enter a 16-character ORCID iD or an orcid.org profile URL.');
  const digits = id.replaceAll('-', '');
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - total % 11) % 11;
  if (digits[15] !== (check === 10 ? 'X' : String(check))) throw new Error('That ORCID iD has an invalid check digit. Please check the number.');
  return id;
}
export const value = x => x?.value ?? '';
export function doiOf(work) {
  const ids = work?.['external-ids']?.['external-id'] ?? [];
  const item = ids.find(x => x['external-id-type']?.toLowerCase() === 'doi' && (!x['external-id-relationship'] || x['external-id-relationship'] === 'self'));
  return item ? String(item['external-id-value'] ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase() : '';
}
export function preferredSummary(group) {
  return [...(group['work-summary'] ?? [])].sort((a,b) => Number(b['display-index'] ?? 0) - Number(a['display-index'] ?? 0))[0];
}
export function dedupeWorks(works) {
  const seen = new Map();
  for (const w of works) {
    const doi = doiOf(w);
    // ORCID groups are authoritative for non-DOI works. Avoid merging distinct works by title alone.
    const key = doi ? `doi:${doi}` : `put:${w['put-code']}`;
    if (!seen.has(key)) seen.set(key, w);
  }
  return [...seen.values()];
}
export function orcidToCsl(w) {
  const map = {'journal-article':'article-journal','book-chapter':'chapter','conference-paper':'paper-conference','conference-abstract':'paper-conference','dissertation-thesis':'thesis','preprint':'article','edited-book':'book','book':'book','report':'report','working-paper':'report','data-set':'dataset','software':'software','other':'article'};
  const type = map[w.type] ?? 'article';
  const item = {id:String(w['put-code']),type,title:value(w.title?.title), DOI:doiOf(w)};
  const sub = value(w.title?.subtitle);
  if (sub) item.title += `: ${sub}`;
  if (value(w['journal-title'])) item['container-title'] = value(w['journal-title']);
  if (value(w.url)) item.URL = value(w.url);
  const date = w['publication-date'];
  const parts = ['year','month','day'].map(k=>Number(value(date?.[k]))).filter(Boolean);
  if (parts.length) item.issued = {'date-parts':[parts]};
  for (const contributor of w.contributors?.contributor ?? []) {
    const name = value(contributor['credit-name']);
    if (!name) continue;
    const role = contributor['contributor-attributes']?.['contributor-role'];
    if (role && !['author','editor'].includes(role)) continue;
    const key = role === 'editor' ? 'editor' : 'author';
    // ORCID credit-name is unstructured. Preserve it rather than guess surname boundaries.
    (item[key] ??= []).push({literal:name});
  }
  return item;
}
export function mergeCsl(base, enriched) {
  const out = {...base};
  for (const [key,v] of Object.entries(enriched ?? {})) {
    if (['id','abstract','reference'].includes(key) || v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[key] = v;
  }
  out.id = base.id;
  const types = {'journal-article':'article-journal','book-chapter':'chapter','proceedings-article':'paper-conference','book-section':'chapter','edited-book':'book','monograph':'book','posted-content':'article','dissertation':'thesis','dataset':'dataset','book-series':'book','reference-entry':'entry-encyclopedia'};
  out.type = types[out.type] ?? out.type;
  if (Array.isArray(out.title)) out.title = out.title[0] ?? base.title;
  if (Array.isArray(out['container-title'])) out['container-title'] = out['container-title'][0];
  // Crossref's issued date can be the online-first date even after issue assignment.
  if (out.type === 'article-journal' && out.volume && enriched?.['published-print']?.['date-parts']?.[0]?.[0]) out.issued = enriched['published-print'];
  if (out['article-number']) {out.number=out['article-number'];if(out.page===String(out['article-number'])) delete out.page;}
  // Metadata often contains pre-escaped XML entities. Decode before citeproc escapes it.
  const decode = s => typeof s === 'string' ? s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}) : s;
  for (const key of ['title','container-title','publisher','collection-title']) if(out[key])out[key]=decode(out[key]);
  return out;
}
export function issuesFor(item) {
  const issues = [];
  if (!item.author?.length && !item.editor?.length) issues.push('Author information missing');
  if ([...(item.author ?? []), ...(item.editor ?? [])].some(n=>n.literal)) issues.push('Names supplied as free text; check APA name formatting');
  if (!item.issued?.['date-parts']?.[0]?.[0]) issues.push('Publication year missing');
  if (['article-journal','chapter','paper-conference'].includes(item.type) && !item['container-title']) issues.push('Journal or proceedings title missing');
  if (item.type === 'article-journal' && !item.volume) issues.push('Volume missing; may be an advance online publication');
  if (['book','chapter','report'].includes(item.type) && !item.publisher) issues.push('Publisher missing');
  if (item.type === 'chapter' && !item.editor?.length) issues.push('Book editors missing; verify the book title and editors');
  const titleWords=String(item.title??'').split(/\s+/).filter(w=>/^[A-Za-z]/.test(w));
  if(titleWords.length>5&&titleWords.filter(w=>/^[A-Z][a-z]/.test(w)).length/titleWords.length>.55) issues.push('Title appears in title case; check APA sentence capitalization');
  if (['article-journal','chapter','paper-conference'].includes(item.type) && !item.page && !item['article-number']) issues.push('Pages or article number missing; check publication record');
  return issues;
}
export function authorKey(item) {const n=item.author?.[0] ?? item.editor?.[0]; return n?.family ?? n?.literal ?? item.title ?? '';}
export function yearOf(item) {return item.issued?.['date-parts']?.[0]?.[0] ?? '';}
export function bibtex(items) {
  const esc = x => String(x).replace(/\\/g,'\\textbackslash{}').replace(/[{}]/g,m=>'\\'+m).replace(/[%&#_$]/g,m=>'\\'+m);
  const name = n => n.literal ? `{${esc(n.literal)}}` : [esc([n['non-dropping-particle'],n.family].filter(Boolean).join(' ')),...(n.suffix?[esc(n.suffix)]:[]),esc([n.given,n['dropping-particle']].filter(Boolean).join(' '))].join(', ');
  const types={'article-journal':'article','paper-conference':'inproceedings',chapter:'incollection',book:'book',thesis:'phdthesis',report:'techreport'};
  return items.map(i=>{
    const f={title:i.title,author:i.author?.map(name).join(' and '),editor:i.editor?.map(name).join(' and '),year:yearOf(i),journal:i.type==='article-journal'?i['container-title']:null,booktitle:['chapter','paper-conference'].includes(i.type)?i['container-title']:null,volume:i.volume,number:i.issue,pages:i.page,publisher:i.publisher,doi:i.DOI,url:i.URL};
    return `@${types[i.type] ?? 'misc'}{${String(i.id).startsWith('bib_')?i.id:'orcid_'+i.id},\n`+Object.entries(f).filter(([,v])=>v).map(([k,v])=>`  ${k} = {${['author','editor'].includes(k)?v:esc(v)}}`).join(',\n')+'\n}';
  }).join('\n\n');
}
