import { normalizeOrcid, value, preferredSummary, dedupeWorks, doiOf, orcidToCsl, mergeCsl, issuesFor, yearOf, bibtex } from './core.js';
import { bibliography, parseBibtex } from './formatter.js';
const $ = id => document.getElementById(id);
const state = {records:[],selected:new Set(),entries:[],visible:[],name:'',orcid:'',filename:'',mode:'orcid',controller:null};
let toastTimer;
let assets;
const typeLabels = {'article-journal':'Journal article',chapter:'Book chapter','paper-conference':'Conference paper',book:'Book',thesis:'Thesis',report:'Report',article:'Other work',dataset:'Dataset',software:'Software'};
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
function safeUrl(raw) { try {const u=new URL(raw);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;} }
function cleanCitation(html) {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const walk=node=>{
    const fragment=document.createDocumentFragment();
    for(const child of node.childNodes){
      if(child.nodeType===3) {fragment.append(document.createTextNode(child.textContent));continue;}
      if(child.nodeType!==1) continue;
      if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(child.tagName)) continue;
      if(!['DIV','SPAN','I','EM','B','STRONG','SUP','SUB','A','BR'].includes(child.tagName)){fragment.append(walk(child));continue;}
      const el=document.createElement(child.tagName.toLowerCase());
      if(child.classList.contains('csl-entry')) el.className='csl-entry';
      if(child.tagName==='A'){const href=safeUrl(child.getAttribute('href'));if(href){el.href=href;el.target='_blank';el.rel='noopener noreferrer';}}
      el.append(walk(child));fragment.append(el);
    }return fragment;
  };
  const holder=document.createElement('div');holder.append(walk(doc.body));return holder.innerHTML;
}
function plain(html){const d=new DOMParser().parseFromString(html,'text/html');return d.body.textContent.trim();}
async function fetchJson(url, signal, accept='application/json') {
  const timeout=AbortSignal.timeout(25000);
  const joined=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try{response=await fetch(url,{headers:{Accept:accept},signal:joined});}
  catch(e){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(timeout.aborted)throw new Error('The data service took too long to respond. Please try again.');throw new Error('Could not connect to the data service. Check your connection and try again.');}
  if(!response.ok){const e=new Error(response.status===404?'No public ORCID record was found for this iD.':response.status===429||response.status===503?'The data service is busy or its request limit was reached. Please try again shortly.':`The data service returned an error (${response.status}). Please try again.`);e.status=response.status;throw e;}
  return response.json();
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function pool(items,worker,signal,concurrency=3){let next=0;return Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(next<items.length){if(signal.aborted)throw new DOMException('Cancelled','AbortError');const index=next++;await worker(items[index],index);await wait(300);}}));}
function setProgress(title,description,n){$('progress-title').textContent=title;$('progress-description').textContent=description;$('progress-bar').value=n;}
async function generate(input){
  let id;
  try{id=normalizeOrcid(input);}catch(e){$('error').textContent=e.message;$('error').hidden=false;$('orcid').setAttribute('aria-invalid','true');$('orcid').focus();return;}
  state.controller?.abort(); const controller=new AbortController();const {signal}=controller;state.controller=controller;
  $('orcid').value=id;$('orcid').removeAttribute('aria-invalid');$('error').hidden=true;setBusy(true);$('progress').hidden=false;$('results').hidden=true;$('start-state').hidden=true;
  setProgress('Finding public works…','Reading the public ORCID record.',5);
  try{
    loadAssets();
    const [works,person] = await Promise.all([fetchJson(`https://pub.orcid.org/v3.0/${id}/works`,signal),fetchJson(`https://pub.orcid.org/v3.0/${id}/person`,signal).catch(e=>{if(signal.aborted)throw e;return null;})]);
    if(works['bulk-error'])throw new Error('ORCID could not return this record. Please try again.');
    const summaries=dedupeWorks((works.group??[]).map(preferredSummary).filter(Boolean));
    const name=person?.name;state.name=value(name?.['credit-name'])||[value(name?.['given-names']),value(name?.['family-name'])].filter(Boolean).join(' ')||'Public ORCID record';state.orcid=id;
    let detailsDone=0,detailFailures=0;const raw=new Array(summaries.length);
    await pool(summaries,async(summary,i)=>{
      try{raw[i]=await fetchJson(`https://pub.orcid.org/v3.0/${id}/work/${summary['put-code']}`,signal);}catch(e){if(signal.aborted)throw e;raw[i]=summary;detailFailures++;}
      detailsDone++;setProgress('Reading publication details…',`${detailsDone} of ${summaries.length} works read.`,10+detailsDone/Math.max(1,summaries.length)*40);
    },signal);
    const records=raw.map(w=>({raw:w,item:orcidToCsl(w),source:'ORCID',detailUnavailable:!w.contributors,enrichmentFailed:false}));
    const enrich=$('enrich').checked;const withDoi=records.filter(r=>doiOf(r.raw));let done=0,enrichedCount=0;
    if(enrich)await pool(withDoi,async(record)=>{
      const doi=doiOf(record.raw);
      try{
        const metadata=await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/vnd.citationstyles.csl+json`,signal,'application/vnd.citationstyles.csl+json');
        // Never attach an unrelated citation if an upstream response is unexpected.
        if(!metadata.title||String(metadata.DOI??doi).toLowerCase()!==doi.toLowerCase())throw new Error('DOI metadata did not match');
        record.item=mergeCsl(record.item,metadata);record.source='ORCID + Crossref';enrichedCount++;
      }catch(e){if(signal.aborted)throw e;record.enrichmentFailed=true;}
      done++;setProgress('Completing citation details…',`${done} of ${withDoi.length} DOI records checked.`,50+done/Math.max(1,withDoi.length)*43);
    },signal);
    await showRecords(records,{mode:'orcid',name:state.name,orcid:id,notice:records.length?`${records.length} public works retrieved${enrich?`; ${enrichedCount} completed with Crossref metadata`:''}. ${detailFailures?`${detailFailures} full records could not be read; summary metadata was used. `:''}Review flagged references before using them in a submission. Public ORCID records may be incomplete.`:'This ORCID record has no publicly visible works. The researcher may not have added works, or may have chosen to keep them private.'},signal);
  }catch(e){
    if(e.name==='AbortError')toast('Lookup cancelled.');else{$('error').textContent=e.message||'Something went wrong. Please try again.';$('error').hidden=false;}
    $('start-state').hidden=false;assets=undefined;
  }finally{if(state.controller===controller){$('progress').hidden=true;setBusy(false);state.controller=null;}}
}
function loadAssets(){return assets ??= Promise.all([fetch('./apa.csl').then(r=>{if(!r.ok)throw new Error('Citation style unavailable.');return r.text();}),fetch('./locales-en-US.xml').then(r=>{if(!r.ok)throw new Error('Citation language unavailable.');return r.text();})]);}
function setBusy(busy){for(const id of ['generate','example','orcid-tab','bib-tab','bib-file'])$(id).disabled=busy;$('import-bib').disabled=busy||!selectedFile;}
async function showRecords(records,meta,signal){
  const [style,locale]=await loadAssets();
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  setProgress('Formatting your bibliography…','Applying APA 7 and checking for missing details.',97);
  for(const r of records){r.issues=issuesFor(r.item);if(r.enrichmentFailed)r.issues.push('DOI metadata unavailable; formatted from ORCID');}
  const entries=records.length?bibliography(records.map(r=>r.item),style,locale).map(e=>({...e,html:cleanCitation(e.html)})):[];
  const byId=new Map(records.map(r=>[r.item.id,r]));
  for(const e of entries){const r=byId.get(e.id);r.html=e.html;r.text=plain(e.html);}
  Object.assign(state,{records,entries,name:meta.name,orcid:meta.orcid??'',filename:meta.filename??'',mode:meta.mode,selected:new Set(records.map(r=>r.item.id))});
  const uploaded=meta.mode==='bib';
  $('researcher-name').textContent=state.name;$('profile-link').hidden=uploaded;$('file-source').hidden=!uploaded;
  if(uploaded)$('file-source').textContent=`${state.filename} · Processed locally in your browser`;
  else{$('profile-link').textContent=`orcid.org/${state.orcid} ↗`;$('profile-link').href=`https://orcid.org/${state.orcid}`;}
  $('works-label').textContent=uploaded?'imported works':'public works';
  $('source-note-title').textContent=uploaded?'From your BibTeX file':'From the public record';
  $('source-note-text').textContent=uploaded?'References use the metadata in your file. Missing citation details are flagged for review. Your file stays in this browser.':'ORCID may contain only part of a researcher’s output. Missing citation details are flagged for you to review.';
  $('source-note-link').hidden=uploaded;
  $('works-count').textContent=records.length;$('review-count').textContent=records.filter(r=>r.issues.length).length;$('notice').textContent=meta.notice;
  resetFilters(false);populateFilters();render();$('results').hidden=false;$('start-state').hidden=true;
  $('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
let selectedFile=null;
function selectFile(file){
  $('bib-error').hidden=true;selectedFile=null;$('import-bib').disabled=true;
  if(!file){$('file-status').textContent='No file selected';return;}
  let error='';if(!/\.bib$/i.test(file.name))error='Choose a file with a .bib extension.';else if(file.size>5*1024*1024)error='This file is too large. Choose a .bib file smaller than 5 MB.';else if(file.size===0)error='This file is empty. Choose a BibTeX file containing publications.';
  if(error){$('bib-error').textContent=error;$('bib-error').hidden=false;$('file-status').textContent='No file selected';return;}
  selectedFile=file;$('file-status').textContent=`${file.name} · ${Math.max(1,Math.ceil(file.size/1024))} KB`;$('import-bib').disabled=false;
}
function switchSource(mode){const bib=mode==='bib';for(const [id,active] of [['orcid-tab',!bib],['bib-tab',bib]]){$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;}$('orcid-panel').hidden=bib;$('bib-panel').hidden=!bib;}
$('orcid-tab').addEventListener('click',()=>switchSource('orcid'));
$('bib-tab').addEventListener('click',()=>switchSource('bib'));
for(const id of ['orcid-tab','bib-tab'])$(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const bib=e.key==='End'||(e.key!=='Home'&&id==='orcid-tab');switchSource(bib?'bib':'orcid');$(bib?'bib-tab':'orcid-tab').focus();}});
$('bib-file').addEventListener('change',e=>selectFile(e.target.files[0]));
for(const event of ['dragover','dragenter'])$('drop-zone').addEventListener(event,e=>{e.preventDefault();if(!state.controller)$('drop-zone').classList.add('dragging');});
for(const event of ['dragleave','drop'])$('drop-zone').addEventListener(event,e=>{e.preventDefault();$('drop-zone').classList.remove('dragging');});
$('drop-zone').addEventListener('drop',e=>{if(!state.controller){if(e.dataTransfer.files.length>1){$('bib-error').textContent='Please choose one bibliography file at a time.';$('bib-error').hidden=false;return;}selectFile(e.dataTransfer.files[0]);}});
$('bib-upload').addEventListener('submit',async e=>{
  e.preventDefault();if(!selectedFile||state.controller)return;
  const file=selectedFile;const controller=new AbortController();state.controller=controller;setBusy(true);$('bib-error').hidden=true;
  try{
    const text=await file.text();if(text.includes('\u0000'))throw new Error('This does not appear to be a text bibliography. Export the file as BibTeX and try again.');
    const {items,duplicates,total}=parseBibtex(text);
    const records=items.map(item=>({item,source:'BibTeX file',raw:null}));
    await showRecords(records,{mode:'bib',name:'Imported bibliography',filename:file.name,notice:`${items.length} works imported from ${total} entries${duplicates?`; ${duplicates} duplicate DOI record${duplicates===1?'':'s'} combined`:''}. Your file was processed locally. Review flagged references before using them in a submission.`},controller.signal);
  }catch(error){$('bib-error').textContent=error.message||'Could not read this bibliography. Please check the file and try again.';$('bib-error').hidden=false;assets=undefined;}
  finally{state.controller=null;setBusy(false);}
});

function populateFilters(){
  $('type').replaceChildren(new Option('All types',''));
  const types=[...new Set(state.records.map(r=>r.item.type))].sort();for(const t of types)$('type').add(new Option(typeLabels[t]??t,t));
  $('year').replaceChildren(new Option('All years',''));const years=[...new Set(state.records.map(r=>String(yearOf(r.item))))].filter(Boolean).sort((a,b)=>Number(b)-Number(a));for(const y of years)$('year').add(new Option(y,y));if(state.records.some(r=>!yearOf(r.item)))$('year').add(new Option('No date','undated'));
}
function resetFilters(rerender=true){$('search').value='';$('type').value='';$('year').value='';$('sort').value='apa';$('review-only').checked=false;if(rerender)render();}
function visibleRecords(){
  const q=$('search').value.trim().toLowerCase(),type=$('type').value,year=$('year').value;
  const map=new Map(state.records.map(r=>[r.item.id,r]));
  let records=state.entries.map(e=>map.get(e.id)).filter(r=>(!q||(r.text??r.item.title).toLowerCase().includes(q))&&(!type||r.item.type===type)&&(!year||(year==='undated'?!yearOf(r.item):String(yearOf(r.item))===year))&&(!$('review-only').checked||r.issues.length));
  if($('sort').value!=='apa'){const sign=$('sort').value==='newest'?-1:1;records.sort((a,b)=>{const ay=yearOf(a.item),by=yearOf(b.item);if(!ay)return by?1:0;if(!by)return -1;return (ay-by)*sign;});}
  return records;
}
function render(){
  state.visible=visibleRecords();const fragment=document.createDocumentFragment();
  for(const r of state.visible){
    const row=document.createElement('article');row.className='reference-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=state.selected.has(r.item.id);check.setAttribute('aria-label',`Include ${r.item.title}`);check.addEventListener('change',()=>{if(check.checked)state.selected.add(r.item.id);else state.selected.delete(r.item.id);updateSelection();});row.append(check);
    const content=document.createElement('div'),citation=document.createElement('div');citation.className='citation';citation.innerHTML=r.html;content.append(citation);
    const meta=document.createElement('div');meta.className='record-meta';const tag=document.createElement('span');tag.className='type-tag';tag.textContent=typeLabels[r.item.type]??r.item.type;meta.append(tag);
    const source=document.createElement('span');source.textContent=r.source;meta.append(source);
    const href=state.mode==='orcid'?`https://orcid.org/${state.orcid}/work/${r.raw['put-code']}`:safeUrl(r.item.DOI?`https://doi.org/${r.item.DOI}`:r.item.URL);if(href){const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener';link.textContent=state.mode==='orcid'?'ORCID record ↗':'Publication ↗';meta.append(link);}
    if(r.issues.length){const badge=document.createElement('span');badge.className='review-badge';badge.textContent='Needs review';meta.append(badge);const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${r.issues.length} detail${r.issues.length===1?'':'s'} to check`;details.append(summary);const ul=document.createElement('ul');for(const issue of r.issues){const li=document.createElement('li');li.textContent=issue;ul.append(li);}details.append(ul);meta.append(details);}
    content.append(meta);row.append(content);fragment.append(row);
  }
  $('references').replaceChildren(fragment);$('empty-filter').hidden=state.visible.length>0;$('empty-filter').querySelector('h3').textContent=state.records.length?'No matching publications':'No public publications';$('empty-filter').querySelector('p').textContent=state.records.length?'Try another search or reset the filters.':'Try another ORCID record to generate a publication list.';$('shown-count').textContent=`Showing ${state.visible.length} of ${state.records.length} works`;updateSelection();
}
function selectedVisible(){return state.visible.filter(r=>state.selected.has(r.item.id));}
function updateSelection(){const n=selectedVisible().length;$('selection-label').textContent=`${n} of ${state.visible.length} selected`;$('select-all').checked=state.visible.length>0&&n===state.visible.length;$('select-all').indeterminate=n>0&&n<state.visible.length;for(const id of ['copy','download-toggle'])$(id).disabled=n===0;}
function exportText(records){return records.map(r=>r.text).join('\n\n');}
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function exportHtml(records){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(state.name)} — References</title><style>body{font:12pt/2 Georgia,serif;max-width:800px;margin:50px auto;padding:0 25px}h1{text-align:center;font-size:14pt}header{font:10pt/1.6 Arial,sans-serif;color:#555;margin-bottom:35px}.csl-entry{padding-left:.5in;text-indent:-.5in;margin-bottom:1em}a{color:inherit;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}header{font-size:9pt}.csl-entry{break-inside:avoid}}</style></head><body><header>${escapeHtml(state.name)} · ${state.mode==='bib'?escapeHtml(state.filename):'ORCID '+state.orcid}<br>${state.mode==='bib'?'Imported bibliography':'Public works'} · APA 7 · Generated ${new Date().toLocaleDateString('en-GB')}<br>${records.filter(r=>r.issues.length).length} references flagged for review in Publication Studio. Metadata may be incomplete.</header><h1>References</h1>${records.map(r=>r.html).join('\n')}</body></html>`;}
function download(content,extension,mime){const url=URL.createObjectURL(new Blob([content],{type:mime}));const link=document.createElement('a');link.href=url;link.download=`publications-${state.mode==='bib'?state.filename.replace(/\.bib$/i,'').replace(/[^a-z0-9_-]/gi,'_'):state.orcid}.${extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function closeMenu(){$('download-menu').hidden=true;$('download-toggle').setAttribute('aria-expanded','false');}
$('lookup').addEventListener('submit',e=>{e.preventDefault();generate($('orcid').value);});
$('example').addEventListener('click',()=>generate('0000-0002-2559-0567'));
$('cancel').addEventListener('click',()=>state.controller?.abort());
for(const id of ['search','type','year','sort','review-only'])$(id).addEventListener(id==='search'?'input':'change',render);
$('reset').addEventListener('click',()=>resetFilters());
$('select-all').addEventListener('change',e=>{for(const r of state.visible){if(e.target.checked)state.selected.add(r.item.id);else state.selected.delete(r.item.id);}render();});
$('copy').addEventListener('click',async()=>{const records=selectedVisible();try{if(window.ClipboardItem&&navigator.clipboard?.write)await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([exportText(records)],{type:'text/plain'}),'text/html':new Blob([records.map(r=>r.html).join('\n')],{type:'text/html'})})]);else await navigator.clipboard.writeText(exportText(records));toast(`${records.length} references copied.`);}catch{toast('Clipboard access unavailable. Download the plain-text file instead.');}});
$('download-toggle').addEventListener('click',()=>{const open=$('download-menu').hidden;$('download-menu').hidden=!open;$('download-toggle').setAttribute('aria-expanded',String(open));});
document.addEventListener('click',e=>{if(!e.target.closest('.download-wrap'))closeMenu();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
for(const button of document.querySelectorAll('[data-format]'))button.addEventListener('click',()=>{const records=selectedVisible(),format=button.dataset.format;closeMenu();if(!records.length)return;
  if(format==='html')download(exportHtml(records),'html','text/html;charset=utf-8');
  if(format==='txt')download(exportText(records),'txt','text/plain;charset=utf-8');
  if(format==='bib')download(bibtex(records.map(r=>r.item)),'bib','application/x-bibtex;charset=utf-8');
  if(format==='json')download(JSON.stringify(records.map(r=>r.item),null,2),'json','application/json');
  if(format==='print'){const win=window.open('','_blank');if(!win){toast('Allow the print window, or download the formatted document.');return;}win.document.write(exportHtml(records));win.document.close();win.focus();setTimeout(()=>win.print(),250);}
});
