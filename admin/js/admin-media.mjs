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
  const token=await idToken();
  const response=await fetch(WORKER_URL+'/files?path='+encodeURIComponent(folder)+'&limit=100&skip=0',{headers:{Authorization:'Bearer '+token}});
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error||'Could not load media ('+response.status+').');
  const list=Array.isArray(data)?data:(data.files||data.images||data.results||data.items||[]);
  return list.filter(x=>x.type!=='folder'&&(x.fileType==='image'||!x.fileType)&&(x.url||x.thumbnail));
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
    const actions=document.createElement('div'); actions.className='flex gap-1 mt-2';
    const copy=document.createElement('button'); copy.type='button'; copy.className='flex-1 bg-gray-100 rounded-lg py-2 text-[10px] font-bold'; copy.textContent='Copy URL';
    copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy URL',1200);}catch{window.prompt('Copy image URL',url);}});
    const open=document.createElement('a'); open.href=url; open.target='_blank'; open.rel='noopener'; open.className='flex-1 text-center bg-gray-100 rounded-lg py-2 text-[10px] font-bold'; open.textContent='Preview';
    actions.append(copy,open); info.append(name,actions); card.append(img,info); grid.append(card);
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
      $('tbMediaUploadBtn')?.addEventListener('click',uploadFiles);
      $('tbMediaRefreshBtn')?.addEventListener('click',loadLibrary);
      $('tbMediaBrowseFolder')?.addEventListener('change',loadLibrary);
      $('tbMediaSearch')?.addEventListener('input',renderLibrary);
      document.querySelector('[data-tab="media"]')?.addEventListener('click',loadLibrary);
    }
  });
  window.openTejuBossMediaPicker=openPicker;
}
