import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseBibtex,bibliography} from '../dist/formatter.js';
import {bibtex} from '../dist/core.js';
const style=fs.readFileSync(new URL('../dist/apa.csl',import.meta.url),'utf8');
const locale=fs.readFileSync(new URL('../dist/locales-en-US.xml',import.meta.url),'utf8');
test('parses nested braces, LaTeX accents, surname particles and APA output',()=>{
 const {items}=parseBibtex(String.raw`@article{test, title={A {Nested} study}, author={de Cesare, Sergio and M{\"u}ller, Anna}, year={2020}, journal={Journal}, volume={2}, number={1}, pages={1--9}}`);
 assert.equal(items[0].author[1].family,'Müller');assert(!items[0]._graph);
 const formatted=bibliography(items,style,locale)[0].html;
 assert.match(formatted,/de Cesare, S\./);assert.match(formatted,/2020/);assert.match(formatted,/Journal/);
 assert.match(bibtex(items),/de Cesare, Sergio/);
});
test('supports string macros and corporate authors',()=>{
 const {items}=parseBibtex('@string{j = "Research Journal"}\n@article{a,author={{World Health Organization}}, title={A report}, journal=j, year={2024}}');
 assert.equal(items[0]['container-title'],'Research Journal');assert.match(bibliography(items,style,locale)[0].html,/World Health Organization/);
});
test('deduplicates equivalent DOIs while preserving separate no-DOI records',()=>{
 const {items,duplicates,total}=parseBibtex('@article{a,title={One},doi={10.1234/ABC}}\n@article{b,title={One},doi={https://doi.org/10.1234/abc}}\n@book{a,title={One}}\n@book{b,title={One}}');
 assert.equal(total,4);assert.equal(duplicates,1);assert.equal(items.length,3);assert.equal(new Set(items.map(x=>x.id)).size,3);
});
test('rejects empty, non-BibTeX, comments-only, and unbalanced files',()=>{
 for(const text of ['', 'plain text', '@comment{no works}', '@article{bad,title={Unclosed']) assert.throws(()=>parseBibtex(text));
});
