import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const assets=JSON.parse(await readFile(resolve(root,'assets-manifest.json'),'utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
async function ensureAsset(asset){
 const path=resolve(root,asset.path);
 try{const cached=await readFile(path);if(hash(cached)===asset.sha256)return;}catch{}
 let failure;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(asset.url,{signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const bytes=Buffer.from(await response.arrayBuffer());
   if(hash(bytes)!==asset.sha256)throw new Error('SHA-256 integrity mismatch');
   await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);return;
  }catch(error){failure=error;}
 }
 throw new Error(`Asset failed: ${asset.path}: ${failure.message}`);
}
// Bounded downloads; all versions and expected bytes are pinned.
for(let index=0;index<assets.length;index+=3)await Promise.all(assets.slice(index,index+3).map(ensureAsset));
await rm(resolve(root,'dist'),{recursive:true,force:true});
await cp(resolve(root,'public'),resolve(root,'dist'),{recursive:true});
console.log(`Built static artwork with ${assets.length} verified vendor assets.`);
