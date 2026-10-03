/* Service worker: casca do app em cache (abre instantâneo/offline); dados sempre da rede, com reserva do último cache. */
const V='mapa-v4', SHELL=['/','/index.html','/style.css','/app.js','/geo.js','/mapPaths.js','/baseline2022.js','/icon-192.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return; const u=new URL(r.url); if(u.origin!==location.origin || u.pathname.startsWith('/api/auth') || u.pathname==='/api/audit') return;
  e.respondWith(fetch(r).then(res=>{ if(res.ok){ const cp=res.clone(); caches.open(V).then(c=>c.put(r,cp)); } return res; }).catch(()=>caches.match(r).then(m=>m||caches.match('/index.html'))));
});
