// TejuBoss ImageKit media library.
// All privileged media operations are proxied through the TejuBoss Cloudflare Worker.
// The ImageKit private key is never sent to the browser.
import { initFirebase } from '../../js/firebase.mjs';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const WORKER_URL = 'https://tejuboss-media.damzyeazy.workers.dev';
const UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const ROOT = '/tejuboss';
const FOLDERS = [
  { value: '/tejuboss/products', label: 'Products' },
  { value: '/tejuboss/heroes', label: 'Heroes' },
  { value: '/tejuboss/branding', label: 'Branding' },
  { value: '/tejuboss/categories', label: 'Categories' },
  { value: '/tejuboss/general', label: 'General' }
];
const TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const $ = id => document.getElementById(id);
const { auth } = initFirebase();
let user = null, assets = [], pickerTarget = null, pickerFolder = '';
let loaded = false;
let selectedMediaIds = new Set();

function status(id, message, kind='muted') {
  const el=$(id); if (!el) return;
  el.textContent=message;
  el.className='text-xs '+(kind==='error'?'text-red-600':kind==='success'?'text-green-700':'text-gray-500');
}
async function idToken() {
  if (!user) throw new Error('Please log in as an administrator first.');
  return user.getIdToken();
}
async function requestFiles(folder) {
  const token=await idToken(), found=[]; let skip=0;
  while(true) {
    const response=await fetch(WORKER_URL+'/files?path='+encodeURIComponent(folder)+'&limit=100&skip='+skip,{headers:{Authorization:'Bearer '+token}});
    const data=await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error||'Could not load media ('+response.status+').');
    const list=Array.isArray(data)?data:(data.files||data.images||data.results||data.items||[]);
    const batch=list.filter(x=>x.type!=='folder'&&(x.fileType==='image'||!x.fileType)&&(x.url||x.thumbnail));
    found.push(...batch);
    if(batch.length<100) break;
    skip+=batch.length;
  }
  return found;
}
function ensureDiagnostics() {
  const panel=$('tbMediaDiagnostics'); if(panel) return;
  const wrap=document.createElement('section'); wrap.id='tbMediaDiagnostics';
  wrap.className='bg-white p-5 rounded-[24px] shadow-sm mb-5';
  wrap.innerHTML='<div class="flex items-center justify-between gap-2 mb-3"><div><h3 class="font-black text-base">Media service verification</h3><p class="text-xs text-gray-500">Check each connection without uploading or changing files.</p></div><button id="tbMediaVerifyBtn" type="button" class="border px-3 py-2 rounded-lg text-xs font-bold">Run checks</button></div><div id="tbMediaChecks" class="grid gap-2"><p class="text-xs text-gray-500">Checks have not run yet.</p></div>';
  $('panel-media').prepend(wrap);
  $('tbMediaVerifyBtn').addEventListener('click',runDiagnostics);
}
function diagnosticRow(label,state,detail) {
  const row=document.createElement('div'); row.className='flex flex-wrap justify-between gap-2 border-b border-gray-100 py-2 text-xs';
  const left=document.createElement('span'); left.className='font-bold text-gray-700'; left.textContent=label;
  const right=document.createElement('span'); right.className=state==='Verified'?'text-green-700':state==='Failed'?'text-red-600':'text-gray-500'; right.textContent=state+(detail?' · '+detail:'');
  row.append(left,right); $('tbMediaChecks').append(row);
}
async function runDiagnostics() {
  ensureDiagnostics(); const btn=$('tbMediaVerifyBtn'); btn.disabled=true; btn.textContent='Checking…';
  const box=$('tbMediaChecks'); box.replaceChildren();
  diagnosticRow('Admin authentication',user&&user.email==='damzyeazy@gmail.com'?'Verified':'Failed',user?.email||'No authenticated admin');
  try {
    const health=await fetch(WORKER_URL+'/health');
    if(!health.ok) throw new Error('HTTP '+health.status);
    diagnosticRow('Cloudflare Worker','Verified','Health endpoint reachable');
  } catch(e) { diagnosticRow('Cloudflare Worker','Failed',e.message); }
  try {
    const token=await idToken();
    const response=await fetch(WORKER_URL+'/auth',{headers:{Authorization:'Bearer '+token}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.token||!data.signature||!data.expire||!data.publicKey) throw new Error(data.error||'Upload credentials unavailable');
    diagnosticRow('ImageKit upload authorization','Verified','Temporary credentials issued');
  } catch(e) { diagnosticRow('ImageKit upload authorization','Failed',e.message); }
  try {
    await requestFiles('/tejuboss/products');
    diagnosticRow('TejuBoss folder access','Verified','Products folder readable');
  } catch(e) { diagnosticRow('TejuBoss folder access','Failed',e.message); }
  diagnosticRow('Actual file upload','Not tested','Run a real upload to verify ImageKit accepts the file');
  btn.disabled=false; btn.textContent='Run checks';
}
async function requestMediaAction(action,payload) {
  const token=await idToken();
  const response=await fetch(WORKER_URL+'/manage',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.success) throw new Error(result.error||'Media '+action+' failed ('+response.status+').');
  return result;
}
async function manageAsset(asset,action) {
  if(action==='delete'&&!confirm('Permanently delete '+(asset.name||'this image')+'? Any website content using its URL may stop displaying. This cannot be undone.')) return;
  let newName='';
  if(action==='rename') {
    newName=prompt('New filename, including extension:',asset.name||asset.filePath?.split('/').pop()||'');
    if(newName===null||!newName.trim()||newName.trim()===(asset.name||'')) return;
    if(!confirm('Renaming changes the image URL and may break existing website content. Continue?')) return;
  }
  try {
    status('tbMediaLibraryStatus',(action==='delete'?'Deleting ':'Renaming ')+(asset.name||'image')+'…');
    await requestMediaAction(action,action==='delete'?{fileId:asset.fileId}:{filePath:asset.filePath,newFileName:newName.trim()});
    selectedMediaIds.delete(asset.fileId); await loadLibrary();
    status('tbMediaLibraryStatus','Image '+(action==='delete'?'deleted':'renamed')+'.','success');
  } catch(e) { status('tbMediaLibraryStatus',e.message,'error'); }
}
async function loadLibrary() {
  if (!user) return;
  const grid=$('tbMediaGrid'); if (!grid) return;
  grid.replaceChildren(); status('tbMediaLibraryStatus','Loading TejuBoss media…');
  try {
    const folder=$('tbMediaBrowseFolder').value;
    const folders=folder==='all'?FOLDERS:FOLDERS.filter(x=>x.value===folder);
    const groups=await Promise.all(folders.map(x=>requestFiles(x.value)));
    assets=groups.flat();
    renderLibrary();
    status('tbMediaLibraryStatus',assets.length+' image(s) loaded.','success');
    const bulk=document.getElementById('tbMediaBulkDelete');
    if(bulk) bulk.textContent='Delete selected ('+selectedMediaIds.size+')';
  } catch(error) {
    status('tbMediaLibraryStatus',error.message||'Could not load media.','error');
  }
}
function renderLibrary() {
  const grid=$('tbMediaGrid'); if (!grid) return;
  const term=($('tbMediaSearch')?.value||'').trim().toLowerCase();
  const visible=assets.filter(a=>(a.name||a.filePath||'').toLowerCase().includes(term));
  grid.replaceChildren();
  if (!visible.length) {
    const p=document.createElement('p'); p.className='col-span-full text-center text-sm text-gray-500 py-8'; p.textContent='No images found.'; grid.appendChild(p); return;
  }
  visible.forEach(asset=>{
    const url=asset.url||asset.thumbnail;
    const card=document.createElement('div'); card.className='border border-gray-200 rounded-xl overflow-hidden bg-white';
    const img=document.createElement('img'); img.src=asset.thumbnail||url; img.alt=asset.name||'TejuBoss image'; img.loading='lazy'; img.className='w-full aspect-square object-cover bg-gray-50';
    const info=document.createElement('div'); info.className='p-2';
    const name=document.createElement('p'); name.className='text-[10px] font-bold text-gray-700 truncate'; name.textContent=asset.name||asset.filePath?.split('/').pop()||'Image';
    const actions=document.createElement('div'); actions.className='grid grid-cols-2 gap-1 mt-2';
    const selectLabel=document.createElement('label'); selectLabel.className='col-span-2 flex items-center gap-2 text-[10px] text-gray-600';
    const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=selectedMediaIds.has(asset.fileId); checkbox.disabled=!asset.fileId;
    checkbox.addEventListener('change',()=>{checkbox.checked?selectedMediaIds.add(asset.fileId):selectedMediaIds.delete(asset.fileId);});
    selectLabel.append(checkbox,document.createTextNode('Select for bulk delete'));
    const rename=document.createElement('button'); rename.type='button'; rename.className='bg-gray-100 rounded-lg py-2 text-[10px] font-bold'; rename.textContent='Rename'; rename.disabled=!asset.filePath; rename.addEventListener('click',()=>manageAsset(asset,'rename'));
    const remove=document.createElement('button'); remove.type='button'; remove.className='bg-red-50 text-red-700 rounded-lg py-2 text-[10px] font-bold'; remove.textContent='Delete'; remove.disabled=!asset.fileId; remove.addEventListener('click',()=>manageAsset(asset,'delete'));
    const copy=document.createElement('button'); copy.type='button'; copy.className='flex-1 bg-gray-100 rounded-lg py-2 text-[10px] font-bold'; copy.textContent='Copy URL';
    copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy URL',1200);}catch{window.prompt('Copy image URL',url);}});
    const open=document.createElement('a'); open.href=url; open.target='_blank'; open.rel='noopener'; open.className='flex-1 text-center bg-gray-100 rounded-lg py-2 text-[10px] font-bold'; open.textContent='Preview';
    actions.append(copy,open,selectLabel,rename,remove); info.append(name,actions); card.append(img,info); grid.append(card);
  });
}
async function uploadFiles() {
  const input=$('tbMediaFiles'), button=$('tbMediaUploadBtn');
  const files=Array.from(input.files||[]);
  if (!files.length) { status('tbMediaUploadStatus','Choose one or more images first.','error'); return; }
  const valid=files.filter(f=>TYPES.has(f.type)&&f.size<=25*1024*1024);
  const invalid=files.length-valid.length;
  if (!valid.length) { status('tbMediaUploadStatus','No valid images. Use JPG, PNG, WebP, GIF or AVIF under 25 MB.','error'); return; }
  button.disabled=true; input.disabled=true; let uploaded=0; const failures=[];
  try {
    for (let i=0;i<valid.length;i++) {
      const file=valid[i]; status('tbMediaUploadStatus','Uploading '+(i+1)+' of '+valid.length+': '+file.name+'…');
      try {
        const token=await idToken();
        const authResponse=await fetch(WORKER_URL+'/auth',{headers:{Authorization:'Bearer '+token}});
        const authData=await authResponse.json().catch(()=>({}));
        if (!authResponse.ok) throw new Error(authData.error||'Upload authorization failed ('+authResponse.status+').');
        if (!authData.token||!authData.signature||!authData.expire||!authData.publicKey) throw new Error('Worker returned incomplete upload credentials.');
        const form=new FormData();
        form.append('file',file); form.append('fileName',file.name); form.append('folder',$('tbMediaUploadFolder').value);
        form.append('publicKey',authData.publicKey); form.append('token',authData.token); form.append('expire',String(authData.expire)); form.append('signature',authData.signature); form.append('useUniqueFileName','true');
        const response=await fetch(UPLOAD_URL,{method:'POST',body:form});
        const result=await response.json().catch(()=>({}));
        if (!response.ok) throw new Error(result.message||result.error||'ImageKit upload failed ('+response.status+').');
        uploaded++;
      } catch(error) { failures.push(file.name+': '+error.message); }
    }
    if (uploaded) { $('tbMediaBrowseFolder').value='all'; await loadLibrary(); }
    input.value='';
    status('tbMediaUploadStatus',uploaded+' uploaded'+(invalid?' · '+invalid+' invalid file(s) skipped':'')+(failures.length?' · Failed: '+failures.join(' | '):''),failures.length||invalid?'error':'success');
  } finally { button.disabled=false; input.disabled=false; }
}
async function bulkDeleteSelected() {
  const selected=assets.filter(x=>selectedMediaIds.has(x.fileId));
  if(!selected.length){status('tbMediaLibraryStatus','Select at least one image first.','error');return;}
  if(!confirm('Permanently delete '+selected.length+' selected image(s)? This cannot be undone and may break website images.')) return;
  let done=0;
  for(const asset of selected){try{status('tbMediaLibraryStatus','Deleting '+(done+1)+' of '+selected.length+'…');await requestMediaAction('delete',{fileId:asset.fileId});done++;}catch(e){status('tbMediaLibraryStatus',done+' deleted; stopped: '+e.message,'error');await loadLibrary();return;}}
  selectedMediaIds.clear(); await loadLibrary(); status('tbMediaLibraryStatus',done+' image(s) deleted.','success');
}
function ensurePicker() {
  let modal=$('tbMediaPicker');
  if (modal) return modal;
  modal=document.createElement('div'); modal.id='tbMediaPicker';
  modal.className='hidden fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm p-3 flex items-end sm:items-center justify-center';
  modal.innerHTML=`<div class="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] flex flex-col"><div class="flex justify-between items-center mb-3"><h3 class="font-black">Choose TejuBoss image</h3><button type="button" id="tbPickerClose" class="text-2xl text-gray-400">&times;</button></div><p id="tbPickerHint" class="text-xs text-gray-500 mb-2"></p><select id="tbPickerFolder" class="p-2 border rounded-lg text-xs mb-3"></select><div id="tbPickerGrid" class="grid grid-cols-2 sm:grid-cols-4 gap-2 overflow-y-auto"></div></div>`;
  document.body.append(modal);
  $('tbPickerClose').addEventListener('click',()=>modal.classList.add('hidden'));
  $('tbPickerFolder').addEventListener('change',loadPicker);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden');});
  return modal;
}
async function loadPicker() {
  const grid=$('tbPickerGrid'); grid.replaceChildren();
  const p=document.createElement('p'); p.className='col-span-full text-center text-sm text-gray-500 py-6'; p.textContent='Loading…'; grid.append(p);
  try {
    const items=await requestFiles($('tbPickerFolder').value); grid.replaceChildren();
    if (!items.length) { p.textContent='No images in this folder yet.'; grid.append(p); return; }
    items.forEach(asset=>{
      const url=asset.url||asset.thumbnail;
      const btn=document.createElement('button'); btn.type='button'; btn.className='border rounded-xl overflow-hidden text-left';
      const img=document.createElement('img'); img.src=asset.thumbnail||url; img.alt=asset.name||'Image'; img.className='w-full aspect-square object-cover';
      const label=document.createElement('span'); label.className='block p-2 text-[10px] truncate'; label.textContent=asset.name||'Image'; btn.append(img,label);
      btn.addEventListener('click',()=>{
        const target=$(pickerTarget); if (!target) return;
        target.value=url; target.dispatchEvent(new Event('input',{bubbles:true}));
        const previewId=pickerTarget==='hImage'?'hImagePreview':pickerTarget.endsWith('_image')?pickerTarget.replace('_image','_preview'):'';
        const preview=previewId&&$(previewId); if(preview){preview.src=url;preview.classList.remove('hidden');}
        $('tbMediaPicker').classList.add('hidden');
      });
      grid.append(btn);
    });
  } catch(error) { grid.replaceChildren(); const msg=document.createElement('p'); msg.className='col-span-full text-sm text-red-600'; msg.textContent=error.message; grid.append(msg); }
}
function openPicker(targetId,multiple=false,folder='') {
  if (!user) { alert('Please log in as an administrator first.'); return; }
  if (multiple) { alert('Multi-image selection is not enabled in this TejuBoss form yet.'); return; }
  pickerTarget=targetId; pickerFolder=folder||'/tejuboss/products';
  const modal=ensurePicker();
  $('tbPickerHint').textContent='Select an image to place its public ImageKit URL in the form.';
  const select=$('tbPickerFolder'); select.replaceChildren();
  FOLDERS.forEach(f=>{const option=document.createElement('option');option.value=f.value;option.textContent=f.label;select.append(option);});
  select.value=pickerFolder; modal.classList.remove('hidden'); loadPicker();
}
export function initTejuBossMedia() {
  onAuthStateChanged(auth, nextUser=>{
    user=nextUser;
    if (!user) { loaded=false; return; }
    if (!loaded) {
      loaded=true;
      ensureDiagnostics();
      const toolbar=document.createElement('div'); toolbar.className='flex flex-wrap items-center gap-2 mb-3';
      const bulk=document.createElement('button'); bulk.id='tbMediaBulkDelete'; bulk.type='button'; bulk.className='bg-red-50 text-red-700 px-3 py-2 rounded-lg text-xs font-bold'; bulk.textContent='Delete selected (0)'; bulk.addEventListener('click',bulkDeleteSelected);
      toolbar.append(bulk); $('tbMediaGrid').before(toolbar);
      $('tbMediaUploadBtn')?.addEventListener('click',uploadFiles);
      $('tbMediaRefreshBtn')?.addEventListener('click',loadLibrary);
      $('tbMediaBrowseFolder')?.addEventListener('change',loadLibrary);
      $('tbMediaSearch')?.addEventListener('input',renderLibrary);
      document.querySelector('[data-tab="media"]')?.addEventListener('click',()=>{loadLibrary();runDiagnostics();});
    }
  });
  window.openTejuBossMediaPicker=openPicker;
}
