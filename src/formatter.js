import CSL from 'citeproc';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';

export function parseBibtex(text) {
  const input=String(text).replace(/^\uFEFF/,'').trim();
  if(!input || !/@[a-z]+\s*[{(]/i.test(input)) throw new Error('No BibTeX entries found. Choose a .bib bibliography file.');
  let data;
  try { data=new Cite(input,{forceType:'@bibtex/text'}).data; }
  catch { throw new Error('This BibTeX file could not be read. Check for missing braces, commas, or quotation marks and try again.'); }
  if(!data.length)throw new Error('This file has no publication entries. Comments and string definitions alone cannot generate a bibliography.');
  if(data.length>5000)throw new Error('Please import no more than 5,000 publications at a time.');
  const seen=new Set();let duplicates=0;
  const items=data.filter(item=>{
    const doi=String(item.DOI??'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase();
    if(!doi)return true;
    item.DOI=doi;
    if(seen.has(doi)){duplicates++;return false;}seen.add(doi);return true;
  }).map((item,i)=>{const {_graph,...fields}=item;return {...fields,'citation-key':item['citation-key']??String(item.id??''),id:`bib_${i+1}`};});
  return {items,duplicates,total:data.length};
}
export function bibliography(items, style, locale) {
  const byId = new Map(items.map(i => [String(i.id),i]));
  const engine = new CSL.Engine({retrieveLocale:()=>locale,retrieveItem:id=>byId.get(String(id))},style,'en-US');
  engine.updateItems([...byId.keys()]);
  const result = engine.makeBibliography();
  if (!result) return [];
  const [params, entries] = result;
  return entries.map((html,i)=>({id:String(params.entry_ids[i][0]),html}));
}
