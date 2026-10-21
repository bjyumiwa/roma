/* Optional offline support. Increase version when changing published files. */
const CACHE='vienna-speak-coach-uk-v2';
const FILES=[
  './','./index.html','./app.js','./data.js','./style.css','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
  ...Array.from({length:16},(_,i)=>'./slides/slide-'+String(i+1).padStart(2,'0')+'.webp')
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
    return res;
  })));
});
