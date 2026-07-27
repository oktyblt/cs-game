import{a as ea}from"./serverSettings-CNF3aRkF.js";import"./supabase-B05oRxV8.js";function ta(){return window.location.search.includes("admin=1")||window.location.hash==="#csadmin"}function ia({API_URL:m,$:i,notify:Ct,supabase:Me,getSessionToken:aa}){i("btn-master-admin");const U=i("admin-login-modal"),Ce=i("btn-admin-login-cancel"),ze=i("btn-admin-login-submit"),zt=i("admin-password-input"),V=i("master-admin-panel"),Ne=i("btn-admin-panel-close"),G=i("master-admin-table-body");let b=sessionStorage.getItem("cs_master_admin_token")||null,Oe=null;function l(e,t="info"){try{Ct(e,t)}catch{}const a=i("ma-feedback");a&&(a.textContent=String(e||""),a.dataset.type=t||"info",clearTimeout(Oe),Oe=setTimeout(()=>{a.textContent="",delete a.dataset.type},5e3))}function x(){return b?!0:(l("Admin oturumu yok — tekrar giriş yapın","error"),!1)}async function Nt(){try{if(!Me)return!1;const{data:e,error:t}=await Me.auth.getSession();return!t&&!!e?.session?.user}catch{return!1}}async function De(){if(!ta())return;if(!await Nt()){sessionStorage.removeItem("cs_master_admin_token"),b=null,l("Master admin paneli için önce giriş yapmalısınız!","error"),setTimeout(()=>{window.location.href="/oyna"},1500);return}b?Ge():U&&(U.style.display="flex")}document.readyState==="loading"?window.addEventListener("DOMContentLoaded",()=>{De()}):De(),Ce&&Ce.addEventListener("click",()=>{U.style.display="none"}),ze&&ze.addEventListener("click",async()=>{const e=zt.value;if(!e)return l("Şifre giriniz","error");try{const a=await(await fetch(`${m}/api/admin/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:e})})).json();a.success&&a.token?(b=a.token,sessionStorage.setItem("cs_master_admin_token",b),U.style.display="none",l("Admin girişi başarılı!","success"),Ge()):l("Hatalı şifre!","error")}catch{l("Sunucu bağlantı hatası","error")}}),Ne&&Ne.addEventListener("click",()=>{V.style.display="none"});let A="dashboard",J=[],je=null,Z=[];function s(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function C(e){if(!e)return"—";try{const t=new Date(e);return Number.isNaN(t.getTime())?"—":t.toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return"—"}}function u(e={}){return ea(b,e)}function ce(e){A==="visitors"&&e!=="visitors"&&be(),A=e,document.querySelectorAll("#master-admin-panel .ma-nav-btn").forEach(t=>{t.classList.toggle("active",t.dataset.maView===e)}),document.querySelectorAll("#master-admin-panel .ma-view").forEach(t=>{t.classList.toggle("active",t.id===`ma-view-${e}`)}),me(e)}async function me(e=A){if(b){if(e==="dashboard")await le();else if(e==="servers")await N();else if(e==="orders")await he();else if(e==="users")await O(),await ke(),await Ae();else if(e==="admins")await Se();else if(e==="visitors")await se();else if(e==="commerce")await _e();else if(e==="site")await Ot();else if(e==="maps")await Rt();else if(e==="system"){const t=i("btn-ma-sitemap-open");t&&(t.href=`${m}/api/site/sitemap.xml`)}}}let T=[],z=[],E="";function W(e){const t=i("ma-pages-table-body");t&&(z=Array.isArray(e)?e.map(a=>({...a})):[],t.innerHTML=z.map((a,r)=>`
      <tr data-ma-page-idx="${r}" style="border-top:1px solid rgba(255,255,255,0.06);">
        <td style="padding:0.3rem;"><input class="room-input ma-page-path" value="${s(a.path||"")}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-page-title" value="${s(a.title||"")}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-page-freq" value="${s(a.changefreq||"weekly")}" style="width:5rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-page-prio" value="${s(a.priority||"0.5")}" style="width:3.2rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-page-sitemap" ${a.in_sitemap!==!1?"checked":""} /></td>
        <td style="padding:0.3rem;"><button type="button" class="toolbar-btn danger ma-page-del" data-idx="${r}" style="padding:0.2rem 0.45rem;font-size:0.65rem;">Sil</button></td>
      </tr>
    `).join(""),t.querySelectorAll(".ma-page-del").forEach(a=>{a.addEventListener("click",()=>{const r=parseInt(a.dataset.idx,10);z.splice(r,1),W(z),l("Sayfa satırı silindi. Kalıcı olması için KAYDET’e basın.","info")})}))}function He(){const e=i("ma-pages-table-body");return e?Array.from(e.querySelectorAll("tr[data-ma-page-idx]")).map(t=>{let a=t.querySelector(".ma-page-path")?.value?.trim()||"";return a&&!a.startsWith("/")&&(a=`/${a}`),{path:a,title:t.querySelector(".ma-page-title")?.value?.trim()||"",changefreq:t.querySelector(".ma-page-freq")?.value?.trim()||"weekly",priority:t.querySelector(".ma-page-prio")?.value?.trim()||"0.5",in_sitemap:!!t.querySelector(".ma-page-sitemap")?.checked}}).filter(t=>t.path):z}async function Ot(){try{const t=await(await fetch(`${m}/api/admin/site-content`,{headers:u()})).json();if(!t.success)throw new Error(t.error||"Yüklenemedi");const a=t.content?.settings||{},r=(o,c)=>{const f=i(o);f&&(f.value=c??"")},n=(o,c)=>{const f=i(o);f&&(f.checked=!!c)};r("ma-site-name",a.siteName),r("ma-site-tagline",a.siteTagline),r("ma-site-seo-title",a.seoTitle),r("ma-site-seo-desc",a.seoDescription),r("ma-site-motd-title",a.motdTitle),r("ma-site-motd-body",a.motdBody),r("ma-site-promo-title",a.promoTitle),r("ma-site-promo-sub",a.promoSub),r("ma-site-announce",a.announceBanner),r("ma-site-discord",a.discordUrl),r("ma-site-maintenance-msg",a.maintenanceMessage),n("ma-site-announce-on",a.announceEnabled),n("ma-site-maintenance",a.maintenanceMode),W(t.content?.staticPages||[]);const d=i("ma-site-updated");d&&(d.textContent=t.content?.updatedAt?`Son güncelleme: ${C(t.content.updatedAt)}`:"")}catch(e){l("Site ayarları yüklenemedi: "+e.message,"error")}}async function Dt(){if(x())try{const e={siteName:i("ma-site-name")?.value?.trim()||"",siteTagline:i("ma-site-tagline")?.value?.trim()||"",seoTitle:i("ma-site-seo-title")?.value?.trim()||"",seoDescription:i("ma-site-seo-desc")?.value?.trim()||"",motdTitle:i("ma-site-motd-title")?.value?.trim()||"",motdBody:i("ma-site-motd-body")?.value?.trim()||"",promoTitle:i("ma-site-promo-title")?.value?.trim()||"",promoSub:i("ma-site-promo-sub")?.value?.trim()||"",announceBanner:i("ma-site-announce")?.value?.trim()||"",announceEnabled:!!i("ma-site-announce-on")?.checked,discordUrl:i("ma-site-discord")?.value?.trim()||"",maintenanceMode:!!i("ma-site-maintenance")?.checked,maintenanceMessage:i("ma-site-maintenance-msg")?.value?.trim()||"",staticPages:He()},a=await(await fetch(`${m}/api/admin/site-settings`,{method:"PUT",headers:u({"Content-Type":"application/json"}),body:JSON.stringify(e)})).json();if(!a.success)throw new Error(a.error||"Kayıt başarısız");Array.isArray(a.staticPages)&&W(a.staticPages),l("Site ayarları kaydedildi","success");const r=i("ma-site-updated");r&&a.updatedAt&&(r.textContent=`Son güncelleme: ${C(a.updatedAt)}`)}catch(e){l("Site kaydı hata: "+e.message,"error")}}let L=[],X={silver:{},gold:{},platinum:{}},Q=[];function jt(e){return e?/^https?:\/\//i.test(e)?e:e.startsWith("/media/")?`${m}${e}`:e:""}function S(e,t){const a=i("ma-commerce-status");a&&(a.textContent=e||"",a.style.color=t?"var(--cs-red)":"var(--text-dim)")}function ee(e){const t=i("ma-rental-tiers-body");t&&(L=Array.isArray(e)?e.map(a=>({...a})):[],t.innerHTML=L.map((a,r)=>`
      <tr data-idx="${r}" style="border-top:1px solid rgba(255,255,255,0.06);">
        <td style="padding:0.35rem;"><input type="number" class="room-input ma-rt-slots" value="${a.maxPlayers||16}" style="width:4.5rem;padding:0.25rem;" /></td>
        <td style="padding:0.35rem;"><input class="room-input ma-rt-label" value="${s(a.label||"")}" style="min-width:7rem;padding:0.25rem;" /></td>
        <td style="padding:0.35rem;"><input type="number" class="room-input ma-rt-price" value="${a.priceTry??0}" style="width:5.5rem;padding:0.25rem;" /></td>
        <td style="padding:0.35rem;text-align:center;"><input type="checkbox" class="ma-rt-on" ${a.enabled!==!1?"checked":""} /></td>
        <td style="padding:0.35rem;"><button type="button" class="toolbar-btn danger ma-rt-del" data-idx="${r}" style="padding:0.2rem 0.45rem;font-size:0.65rem;">Sil</button></td>
      </tr>
    `).join(""),t.querySelectorAll(".ma-rt-del").forEach(a=>{a.addEventListener("click",()=>{ue(),L.splice(parseInt(a.dataset.idx,10),1),ee(L),S("Satır silindi — KAYDET ile kalıcı yap"),l("Tier silindi. Kalıcı olması için KAYDET’e basın.","info")})}))}function ue(){const e=i("ma-rental-tiers-body");return e&&(L=Array.from(e.querySelectorAll("tr[data-idx]")).map(t=>({maxPlayers:parseInt(t.querySelector(".ma-rt-slots")?.value,10)||16,label:t.querySelector(".ma-rt-label")?.value?.trim()||"",priceTry:Number(t.querySelector(".ma-rt-price")?.value)||0,enabled:!!t.querySelector(".ma-rt-on")?.checked}))),L}function Ke(e){const t=i("ma-vip-packs");t&&(X={silver:{...e?.silver||{}},gold:{...e?.gold||{}},platinum:{...e?.platinum||{}}},t.innerHTML=["silver","gold","platinum"].map(a=>{const r=X[a]||{},n=Array.isArray(r.features)?r.features.join(`
`):"";return`
        <div data-vip-tier="${a}" style="border:1px solid var(--border-bright);border-radius:6px;padding:0.7rem;background:rgba(255,255,255,0.02);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;">
            <strong style="color:var(--text-bright);text-transform:uppercase;font-family:var(--font-hud);font-size:0.75rem;">${a}</strong>
            <label style="display:flex;gap:0.3rem;align-items:center;font-size:0.7rem;color:var(--text-dim);">
              <input type="checkbox" class="ma-vip-on" ${r.enabled!==!1?"checked":""} /> Aktif
            </label>
          </div>
          <label class="ma-field"><span>Etiket</span><input class="room-input ma-vip-label" value="${s(r.label||"")}" /></label>
          <label class="ma-field" style="margin-top:0.4rem;"><span>Fiyat ₺/ay</span><input type="number" class="room-input ma-vip-price" value="${r.priceTry??0}" /></label>
          <label class="ma-field" style="margin-top:0.4rem;"><span>Özellikler (satır satır)</span>
            <textarea class="room-input ma-vip-feats" rows="7" style="font-size:0.72rem;line-height:1.35;">${s(n)}</textarea>
          </label>
        </div>
      `}).join(""))}function Ht(){const e=i("ma-vip-packs");if(!e)return X;const t={};return e.querySelectorAll("[data-vip-tier]").forEach(a=>{const r=a.getAttribute("data-vip-tier"),n=a.querySelector(".ma-vip-feats")?.value||"";t[r]={enabled:!!a.querySelector(".ma-vip-on")?.checked,label:a.querySelector(".ma-vip-label")?.value?.trim()||"",priceTry:Number(a.querySelector(".ma-vip-price")?.value)||0,features:n.split(`
`).map(d=>d.trim()).filter(Boolean)}}),X=t,t}function pe(e){const t=i("ma-ann-list");if(t){if(Q=Array.isArray(e)?e.map(a=>({...a})):[],!Q.length){t.innerHTML='<div style="color:var(--text-dim);font-size:0.75rem;padding:0.6rem;">Henüz duyuru yok.</div>';return}t.innerHTML=Q.map(a=>`
      <div style="display:grid;grid-template-columns:72px 1fr auto;gap:0.65rem;align-items:center;border:1px solid var(--border);border-radius:6px;padding:0.55rem;background:rgba(0,0,0,0.2);opacity:${a.enabled===!1?"0.55":"1"};">
        <img src="${s(jt(a.imageUrl))}" alt="" style="width:72px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--border);" onerror="this.style.opacity=0.2" />
        <div style="min-width:0;">
          <div style="font-family:var(--font-hud);font-size:0.78rem;color:var(--text-bright);">${s(a.title||"")}</div>
          <div style="font-size:0.68rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s(a.subtitle||"")}</div>
          <div style="font-size:0.62rem;color:var(--cs-yellow);margin-top:0.15rem;">${s(a.ctaType||"")} · sıra ${a.sort??0}${a.enabled===!1?" · kapalı":""}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.3rem;">
          <button type="button" class="toolbar-btn ma-ann-edit" data-id="${s(a.id)}" style="padding:0.2rem 0.5rem;font-size:0.65rem;">Düzenle</button>
          <button type="button" class="toolbar-btn danger ma-ann-del" data-id="${s(a.id)}" style="padding:0.2rem 0.5rem;font-size:0.65rem;">Sil</button>
        </div>
      </div>
    `).join(""),t.querySelectorAll(".ma-ann-edit").forEach(a=>{a.addEventListener("click",()=>Be(Q.find(r=>r.id===a.dataset.id)))}),t.querySelectorAll(".ma-ann-del").forEach(a=>{a.addEventListener("click",async()=>{if(await window.customConfirm("Bu duyuru silinsin mi?","Sil"))try{const n=await(await fetch(`${m}/api/admin/announcements/${encodeURIComponent(a.dataset.id)}`,{method:"DELETE",headers:u()})).json();if(!n.success)throw new Error(n.error||"Silinemedi");pe(n.announcements),l("Duyuru silindi","success")}catch(r){l(r.message,"error")}})})}}function Be(e){const t=i("ma-ann-modal");if(!t)return;const a=e||{id:"",title:"",subtitle:"",ribbon:"",imageUrl:"",ctaLabel:"Detay →",ctaType:"url",ctaUrl:"",sort:100,enabled:!0};i("ma-ann-id").value=a.id||"",i("ma-ann-title").value=a.title||"",i("ma-ann-sub").value=a.subtitle||"",i("ma-ann-ribbon").value=a.ribbon||"",i("ma-ann-image").value=a.imageUrl||"",i("ma-ann-cta-label").value=a.ctaLabel||"",i("ma-ann-cta-type").value=a.ctaType||"url",i("ma-ann-cta-url").value=a.ctaUrl||"",i("ma-ann-sort").value=a.sort??100,i("ma-ann-enabled").checked=a.enabled!==!1,t.style.display="flex"}function fe(){const e=i("ma-ann-modal");e&&(e.style.display="none")}async function _e(){try{S("Yükleniyor…");const[e,t]=await Promise.all([fetch(`${m}/api/admin/commerce`,{headers:u()}),fetch(`${m}/api/admin/announcements`,{headers:u()})]),a=await e.json(),r=await t.json();if(!a.success)throw new Error(a.error||"Commerce yüklenemedi");if(!r.success)throw new Error(r.error||"Duyurular yüklenemedi");const n=a.commerce||{},d=n.bank||{},o=(c,f)=>{const v=i(c);v&&(v.value=f??"")};o("ma-bank-name",d.bankName),o("ma-bank-holder",d.bankHolder),o("ma-bank-iban",d.bankIban),o("ma-bank-note",d.note),o("ma-rental-default",n.rental?.defaultMaxPlayers??16),ee(n.rental?.tiers||[]),Ke(n.vip||{}),pe(r.announcements||[]),S("Hazır")}catch(e){S(e.message,!0),l("Ticaret yükleme hatası: "+e.message,"error")}}async function Kt(){if(!x())return;const e=i("btn-ma-bank-save");e&&(e.disabled=!0,e.textContent="KAYDEDİLİYOR…");try{const a=await(await fetch(`${m}/api/admin/commerce`,{method:"PUT",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({bank:{bankName:i("ma-bank-name")?.value?.trim(),bankHolder:i("ma-bank-holder")?.value?.trim(),bankIban:i("ma-bank-iban")?.value?.trim(),note:i("ma-bank-note")?.value?.trim()}})})).json();if(!a.success)throw new Error(a.error||"Kayıt başarısız");S("Banka kaydedildi"),l("Banka bilgileri kaydedildi","success")}catch(t){S(t.message,!0),l(t.message,"error")}finally{e&&(e.disabled=!1,e.textContent="KAYDET")}}async function Bt(){if(!x())return;const e=i("btn-ma-rental-save");e&&(e.disabled=!0,e.textContent="KAYDEDİLİYOR…");try{const t=ue(),r=await(await fetch(`${m}/api/admin/commerce`,{method:"PUT",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({rental:{defaultMaxPlayers:parseInt(i("ma-rental-default")?.value,10)||16,tiers:t}})})).json();if(!r.success)throw new Error(r.error||"Kayıt başarısız");ee(r.commerce?.rental?.tiers||t),S("Kiralama fiyatları kaydedildi"),l("Kiralama fiyatları kaydedildi","success")}catch(t){S(t.message,!0),l(t.message,"error")}finally{e&&(e.disabled=!1,e.textContent="KAYDET")}}async function _t(){if(!x())return;const e=i("btn-ma-vip-save");e&&(e.disabled=!0,e.textContent="KAYDEDİLİYOR…");try{const t=Ht(),r=await(await fetch(`${m}/api/admin/commerce`,{method:"PUT",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({vip:t})})).json();if(!r.success)throw new Error(r.error||"Kayıt başarısız");Ke(r.commerce?.vip||t),S("VIP paketleri kaydedildi"),l("VIP paketleri kaydedildi","success")}catch(t){S(t.message,!0),l(t.message,"error")}finally{e&&(e.disabled=!1,e.textContent="KAYDET")}}async function Pt(){if(x())try{const e={id:i("ma-ann-id")?.value||void 0,title:i("ma-ann-title")?.value?.trim(),subtitle:i("ma-ann-sub")?.value?.trim(),ribbon:i("ma-ann-ribbon")?.value?.trim(),imageUrl:i("ma-ann-image")?.value?.trim(),ctaLabel:i("ma-ann-cta-label")?.value?.trim(),ctaType:i("ma-ann-cta-type")?.value||"url",ctaUrl:i("ma-ann-cta-url")?.value?.trim(),sort:Number(i("ma-ann-sort")?.value)||100,enabled:!!i("ma-ann-enabled")?.checked},t=e.id?"PATCH":"POST",a=e.id?`${m}/api/admin/announcements/${encodeURIComponent(e.id)}`:`${m}/api/admin/announcements`,n=await(await fetch(a,{method:t,headers:u({"Content-Type":"application/json"}),body:JSON.stringify(e)})).json();if(!n.success)throw new Error(n.error||"Kayıt başarısız");pe(n.announcements),fe(),l("Duyuru kaydedildi","success")}catch(e){l(e.message,"error")}}async function Yt(){const e=i("ma-ann-file")?.files?.[0];if(!e){l("Dosya seçin","error");return}try{const t=await new Promise((n,d)=>{const o=new FileReader;o.onload=()=>n(o.result),o.onerror=()=>d(new Error("Dosya okunamadı")),o.readAsDataURL(e)}),r=await(await fetch(`${m}/api/admin/uploads`,{method:"POST",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({dataUrl:t})})).json();if(!r.success)throw new Error(r.error||"Yükleme başarısız");i("ma-ann-image")&&(i("ma-ann-image").value=r.url||r.absoluteUrl||""),l("Görsel yüklendi","success")}catch(t){l(t.message,"error")}}function te(e){const t=i("ma-maps-table-body");t&&(T=Array.isArray(e)?e.map(a=>({...a})):[],t.innerHTML=T.map((a,r)=>`
      <tr data-ma-map-idx="${r}" style="border-top:1px solid rgba(255,255,255,0.06);">
        <td style="padding:0.3rem;"><input class="room-input ma-map-name" value="${s(a.name||"")}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-slug" value="${s(a.slug||"")}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-desc" value="${s(a.description||"")}" style="min-width:8rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-mode" value="${s(a.mode||"")}" style="width:3rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-seo" value="${s(a.seo_title||"")}" style="min-width:8rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-map-play" ${a.playable!==!1?"checked":""} /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-map-sitemap" ${a.in_sitemap!==!1?"checked":""} /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-map-featured" ${a.featured?"checked":""} /></td>
        <td style="padding:0.3rem;"><button type="button" class="toolbar-btn danger ma-map-del" data-idx="${r}" style="padding:0.2rem 0.45rem;font-size:0.65rem;">Sil</button></td>
      </tr>
    `).join(""),t.querySelectorAll(".ma-map-del").forEach(a=>{a.addEventListener("click",()=>{const r=parseInt(a.dataset.idx,10);T.splice(r,1),te(T),l("Harita satırı silindi. Kalıcı olması için KAYDET’e basın.","info")})}))}function Pe(){const e=i("ma-maps-table-body");return e?Array.from(e.querySelectorAll("tr[data-ma-map-idx]")).map(t=>({...T[parseInt(t.dataset.maMapIdx,10)]||{},name:t.querySelector(".ma-map-name")?.value?.trim()||"",slug:t.querySelector(".ma-map-slug")?.value?.trim()||"",description:t.querySelector(".ma-map-desc")?.value?.trim()||"",mode:t.querySelector(".ma-map-mode")?.value?.trim()||"de",seo_title:t.querySelector(".ma-map-seo")?.value?.trim()||"",playable:!!t.querySelector(".ma-map-play")?.checked,in_sitemap:!!t.querySelector(".ma-map-sitemap")?.checked,featured:!!t.querySelector(".ma-map-featured")?.checked})).filter(t=>t.name):T}async function Rt(){try{const t=await(await fetch(`${m}/api/admin/maps`,{headers:u()})).json();if(!t.success)throw new Error(t.error||"Yüklenemedi");te(t.maps||[])}catch(e){l("Harita kataloğu yüklenemedi: "+e.message,"error")}}async function Vt(){if(x())try{const e=Pe(),a=await(await fetch(`${m}/api/admin/maps`,{method:"PUT",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({maps:e})})).json();if(!a.success)throw new Error(a.error||"Kayıt başarısız");te(a.maps||[]),l(`Harita kataloğu kaydedildi (${(a.maps||[]).length})`,"success")}catch(e){l("Harita kaydı hata: "+e.message,"error")}}async function ye(){if(x())try{const t=await(await fetch(`${m}/api/admin/sitemap/regenerate`,{method:"POST",headers:u()})).json();if(!t.success)throw new Error(t.error||"Üretilemedi");E=t.xml||"";const a=i("ma-sitemap-preview");a&&(a.style.display="block",a.textContent=E.slice(0,4e3)+(E.length>4e3?`
…`:"")),l(`Sitemap hazır · ${t.urlCount||0} URL`,"success")}catch(e){l("Sitemap hata: "+e.message,"error")}}function qt(e){if(!e)return"—";try{return new Date(e).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch{return"—"}}let K=null,ae=null,h={range:7,type:"all",search:"",page:"",sortKey:"ts",sortDir:"desc",logPage:0,pageSize:25};function It(e){const t=String(e||"real"),a=t==="ai"?"AI":t==="bot"?"BOT":"GERÇEK";return`<span class="ma-vis-badge" data-t="${s(t)}">${a}</span>`}function q(e={}){return(e.real||0)+(e.bot||0)+(e.ai||0)}function Ye(e){return{desktop:"Masaüstü",mobile:"Mobil",tablet:"Tablet",bot:"Bot / Crawler"}[e]||e||"—"}function Re(e,t=h){const a=String(t.search||"").trim().toLowerCase(),r=t.type||"all",n=t.page||"";return(e||[]).filter(d=>r!=="all"&&d.type!==r||n&&String(d.path||"")!==n?!1:a?[d.name,d.path,d.referrer,d.country,d.city,d.ip,d.ua,d.device].map(c=>String(c||"").toLowerCase()).join(" ").includes(a):!0)}function Ft(e,t="ts",a="desc"){const r=a==="asc"?1:-1;return[...e].sort((n,d)=>{let o=n?.[t],c=d?.[t];return t==="ts"?(o=Number(o)||0,c=Number(c)||0,(o-c)*r):(o=String(o??"").toLowerCase(),c=String(c??"").toLowerCase(),o<c?-1*r:o>c?1*r:0)})}function Ut(e,t){return t>=30?{paths:e.topPathsMonth||e.topPaths||[],refs:e.topReferrersMonth||e.topReferrers||[],countries:e.topCountriesMonth||e.topCountries||[],agents:e.botNamesMonth||e.botNamesWeek||[],periodLabel:"30 gün"}:t<=1?{paths:e.topPaths||[],refs:e.topReferrers||[],countries:e.topCountries||[],agents:e.botNamesToday||e.botNamesWeek||[],periodLabel:"bugün / hafta"}:{paths:e.topPaths||[],refs:e.topReferrers||[],countries:e.topCountries||[],agents:e.botNamesWeek||[],periodLabel:"7 gün"}}function Gt(e,t){const a=Array.isArray(e)?e:[];return t>=30?a:a.slice(-Math.max(1,t))}function Ve(e,{height:t=160,showTypes:a=!0}={}){const r=e||[];if(!r.length)return'<div class="ma-vis-empty">Zaman serisi verisi henüz yok.</div>';const n=560,d=t,o=28,c=8,f=12,v=28,y=Math.max(1,...r.map(p=>p.total||(p.real||0)+(p.bot||0)+(p.ai||0))),B=2,D=n-o-c,k=Math.max(3,D/r.length-B),w=d-f-v,P=r.map((p,$)=>{const j=p.total||(p.real||0)+(p.bot||0)+(p.ai||0),M=o+$*(k+B),H=a?w*((p.real||0)/y):0,I=a?w*((p.bot||0)/y):0,Y=a?w*((p.ai||0)/y):0,Lt=w*(j/y),Mt=f+w,Qt=p.date?String(p.date).slice(5):p.hour!=null?`${p.hour}:00`:"",de=p.date?`${p.date}: ${j} (G:${p.real||0} B:${p.bot||0} AI:${p.ai||0})`:`${p.hour}:00 → ${j}`;if(!a)return`<rect x="${M}" y="${Mt-Lt}" width="${k}" height="${Math.max(Lt,0)}" fill="rgba(240,160,0,0.75)" rx="1"><title>${s(de)}</title></rect>`;let R=Mt;const F=[];return H>0&&(R-=H,F.push(`<rect x="${M}" y="${R}" width="${k}" height="${H}" fill="rgba(57,255,20,0.8)" rx="0"><title>${s(de)}</title></rect>`)),I>0&&(R-=I,F.push(`<rect x="${M}" y="${R}" width="${k}" height="${I}" fill="rgba(245,158,11,0.8)"><title>${s(de)}</title></rect>`)),Y>0&&(R-=Y,F.push(`<rect x="${M}" y="${R}" width="${k}" height="${Y}" fill="rgba(125,211,252,0.85)"><title>${s(de)}</title></rect>`)),($===0||$===r.length-1||$%Math.ceil(r.length/6)===0)&&F.push(`<text x="${M+k/2}" y="${d-8}" text-anchor="middle" fill="rgba(160,176,192,0.65)" font-size="9" font-family="var(--font-hud)">${s(Qt)}</text>`),F.join("")}).join(""),Le=[.25,.5,.75,1].map(p=>{const $=f+w*(1-p);return`<line x1="${o}" y1="${$}" x2="${n-c}" y2="${$}" stroke="rgba(255,255,255,0.05)" /><text x="${o-4}" y="${$+3}" text-anchor="end" fill="rgba(160,176,192,0.45)" font-size="8">${Math.round(y*p)}</text>`}).join("");return`
      <svg class="ma-vis-chart-svg${t<150?" tall":""}" viewBox="0 0 ${n} ${d}" preserveAspectRatio="none" role="img" aria-label="Ziyaretçi grafiği">
        ${Le}
        ${P}
      </svg>
      <div class="ma-vis-legend">
        <span><i style="background:rgba(57,255,20,0.85)"></i>Gerçek</span>
        <span><i style="background:rgba(245,158,11,0.85)"></i>Bot</span>
        <span><i style="background:rgba(125,211,252,0.85)"></i>AI</span>
      </div>`}function _(e,t,a,r=""){const n=Math.max(1,...(t||[]).map(o=>Number(o.count)||0)),d=(t||[]).length?t.map(o=>{const c=Math.round((Number(o.count)||0)/n*100);return`
          <div class="ma-vis-rank-row" title="${s(o.name)}">
            <span class="ma-vis-rank-name">${s(o.name)}</span>
            <span class="ma-vis-rank-bar"><span class="ma-vis-rank-fill" style="width:${c}%"></span></span>
            <span class="ma-vis-rank-count">${o.count}</span>
          </div>`}).join(""):`<div class="ma-vis-empty">${a}</div>`;return`
      <div class="ma-vis-panel">
        <div class="ma-vis-panel-head">
          <h4 class="ma-vis-panel-title">${e}</h4>
          ${r?`<span class="ma-vis-panel-hint">${r}</span>`:""}
        </div>
        ${d}
      </div>`}function ve(e,t,{emptyText:a,sortable:r=!1,pager:n=null,hint:d=""}={}){const o=[{key:"ts",label:"ZAMAN"},{key:"type",label:"TÜR"},{key:"name",label:"AJAN"},{key:"device",label:"CİHAZ"},{key:"country",label:"KONUM"},{key:"path",label:"SAYFA"},{key:"referrer",label:"KAYNAK"},{key:"ip",label:"IP"}];if(!(t||[]).length)return`
        <div class="ma-vis-table-wrap">
          <div class="ma-vis-panel-head">
            <h4 class="ma-vis-panel-title">${e}</h4>
            ${d?`<span class="ma-vis-panel-hint">${d}</span>`:""}
          </div>
          <div style="padding:0.85rem;"><div class="ma-vis-empty">${a}</div></div>
        </div>`;const c=o.map(y=>{if(!r)return`<th>${y.label}</th>`;const D=h.sortKey===y.key?h.sortDir==="asc"?" ↑":" ↓":"";return`<th class="ma-vis-sortable" data-vis-sort="${y.key}">${y.label}${D}</th>`}).join(""),f=t.map(y=>`
      <tr title="${s(y.ua||"")}">
        <td class="ma-vis-mono">${s(qt(y.ts))}</td>
        <td>${It(y.type)}</td>
        <td style="color:var(--text-bright);max-width:140px;overflow:hidden;text-overflow:ellipsis;">${s(y.name||"?")}</td>
        <td>${s(Ye(y.device))}</td>
        <td>${s([y.country,y.city].filter(Boolean).join(" · ")||"??")}</td>
        <td style="color:var(--cs-yellow);">${s(y.path||"/")}</td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;">${s(y.referrer||"—")}</td>
        <td class="ma-vis-mono">${s(y.ip||"—")}</td>
      </tr>`).join(""),v=n?`
      <div class="ma-vis-pager">
        <span>${n.label}</span>
        <div class="ma-vis-pager-btns">
          <button type="button" data-vis-page="prev" ${n.page<=0?"disabled":""}>ÖNCEKİ</button>
          <button type="button" data-vis-page="next" ${n.page>=n.pages-1?"disabled":""}>SONRAKİ</button>
        </div>
      </div>`:"";return`
      <div class="ma-vis-table-wrap">
        <div class="ma-vis-panel-head">
          <h4 class="ma-vis-panel-title">${e} <span style="color:var(--text-dim);font-size:0.65rem;">(${t.length}${n?` / ${n.total}`:""})</span></h4>
          ${d?`<span class="ma-vis-panel-hint">${d}</span>`:""}
        </div>
        <div class="ma-vis-table-scroll${r?" tall":""}">
          <table class="ma-table" style="font-size:0.68rem;">
            <thead><tr>${c}</tr></thead>
            <tbody>${f}</tbody>
          </table>
        </div>
        ${v}
      </div>`}function ne(e){const t=h,a=Number(t.range)||7,r=e.active||{},n=e.daily||{},d=e.weekly||{},o=e.monthly||{},c=e.totals||{},f=c.live??q(r),v=Ut(e,a),y=Gt(e.series||[],a),B=new Date(e.generatedAt||Date.now()).toLocaleString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit"}),D=a<=1?n:a<=7?d:o,k=q(D),w=k>0?Math.round((D.real||0)/k*100):0,P=v.countries[0]&&v.countries[0].name||"—",Le=(e.topDevices||[]).map(Y=>({name:Ye(Y.name),count:Y.count})),p=e.topBrowsers||e.topAgentsWeek||[],$=Re(e.activeList||[],t),j=Ft(Re(e.recent||[],t),t.sortKey,t.sortDir),M=t.pageSize||25,H=Math.max(1,Math.ceil(j.length/M));t.logPage>=H&&(t.logPage=Math.max(0,H-1));const I=j.slice(t.logPage*M,(t.logPage+1)*M);return`
      <section class="ma-vis-hero">
        <div class="ma-vis-hero-inner">
          <div>
            <p class="ma-vis-kicker">BROWSERCS · TRAFİK ANALİTİĞİ</p>
            <h3 class="ma-vis-h1">ZİYARETÇİ TAKİP KONSOLU</h3>
            <p class="ma-vis-sub">Benzersiz ziyaretçi (IP/gün), canlı oturumlar (5 dk) ve kaynak dağılımı. Son güncelleme: ${s(B)}</p>
          </div>
          <div class="ma-dash-pulse" title="Son 5 dakikadaki aktif oturum">
            <span class="ma-dash-pulse-dot" aria-hidden="true"></span>
            <div>
              <div class="ma-dash-pulse-label">ŞU AN AKTİF</div>
              <div class="ma-dash-pulse-value">${f}</div>
            </div>
          </div>
        </div>
      </section>

      <div class="ma-vis-kpi">
        ${g({label:"CANLI",value:f,tone:"green",foot:`G ${r.real||0} · B ${r.bot||0} · AI ${r.ai||0}`})}
        ${g({label:"BUGÜN",value:c.today??q(n),tone:"yellow",foot:`Gerçek ${n.real||0}`})}
        ${g({label:"7 GÜN",value:c.week??q(d),tone:"blue",foot:`Gerçek ${d.real||0}`})}
        ${g({label:"30 GÜN",value:c.month??q(o),tone:"yellow",foot:`Gerçek payı %${c.realShare??w}`})}
        ${g({label:"GERÇEK ORANI",value:`%${w}`,tone:w>=40?"green":"muted",foot:`Seçili aralık · ${k} tekil`})}
        ${g({label:"1. ÜLKE",value:P,tone:"muted",foot:v.periodLabel})}
      </div>

      <div class="ma-vis-charts">
        <div class="ma-vis-panel">
          <div class="ma-vis-panel-head">
            <h4 class="ma-vis-panel-title">GÜNLÜK ZİYARET SERİSİ</h4>
            <span class="ma-vis-panel-hint">Son ${a} gün · benzersiz IP</span>
          </div>
          ${Ve(y)}
        </div>
        <div class="ma-vis-panel">
          <div class="ma-vis-panel-head">
            <h4 class="ma-vis-panel-title">SAATLİK AKTİVİTE</h4>
            <span class="ma-vis-panel-hint">Son 24 saat · TR saati</span>
          </div>
          ${Ve(e.hourly||[],{height:140})}
        </div>
      </div>

      <div class="ma-vis-grid4">
        ${_("SAYFALAR",v.paths,"Sayfa kaydı yok.",v.periodLabel)}
        ${_("KAYNAKLAR",v.refs,"Referrer kaydı yok.",v.periodLabel)}
        ${_("ÜLKELER",v.countries,"Ülke kaydı yok.",v.periodLabel)}
        ${_("AJANLAR / BOTLAR",v.agents,"Ajan kaydı yok.",v.periodLabel)}
        ${_("CİHAZLAR",Le,"Cihaz verisi birikiyor…","KV + canlı")}
        ${_("TARAYICI / AJAN (SON)",p,"Henüz örnek yok.","recent")}
      </div>

      <div class="ma-vis-split">
        ${ve("CANLI OTURUMLAR",$,{emptyText:"Şu an aktif ziyaretçi yok. Yeni girişler burada görünür.",hint:"Son 5 dakika"})}
        ${ve("SON AKTİVİTE",(e.recent||[]).slice(0,12),{emptyText:"Henüz detaylı kayıt yok.",hint:"En son 12 olay"})}
      </div>

      ${ve("ZİYARETÇİ GÜNLÜĞÜ",I,{emptyText:"Filtreyle eşleşen kayıt yok.",sortable:!0,hint:"Sırala · sayfala · filtrele",pager:{page:t.logPage,pages:H,total:j.length,label:`Sayfa ${t.logPage+1} / ${H} · ${j.length} kayıt`}})}
    `}function re(e){e&&(e.querySelectorAll("[data-vis-sort]").forEach(t=>{t.addEventListener("click",()=>{const a=t.getAttribute("data-vis-sort");a&&(h.sortKey===a?h.sortDir=h.sortDir==="asc"?"desc":"asc":(h.sortKey=a,h.sortDir=a==="ts"?"desc":"asc"),K&&(e.innerHTML=ne(K)),re(e))})}),e.querySelectorAll("[data-vis-page]").forEach(t=>{t.addEventListener("click",()=>{const a=t.getAttribute("data-vis-page");a==="prev"&&(h.logPage=Math.max(0,h.logPage-1)),a==="next"&&(h.logPage+=1),K&&(e.innerHTML=ne(K)),re(e)})}))}function Jt(e){const t=i("ma-vis-page");if(!t)return;const a=new Set;(e.topPathsMonth||e.topPaths||[]).forEach(d=>{d?.name&&a.add(d.name)}),(e.recent||[]).forEach(d=>{d?.path&&a.add(d.path)}),(e.activeList||[]).forEach(d=>{d?.path&&a.add(d.path)});const r=h.page||t.value||"",n=['<option value="">Tüm sayfalar</option>'].concat([...a].sort().map(d=>`<option value="${s(d)}"${d===r?" selected":""}>${s(d)}</option>`));t.innerHTML=n.join("")}function qe(){const e=i("ma-vis-range"),t=i("ma-vis-type"),a=i("ma-vis-search"),r=i("ma-vis-page");e&&(h.range=parseInt(e.value,10)||7),t&&(h.type=t.value||"all"),a&&(h.search=a.value||""),r&&(h.page=r.value||"")}function ie(){const e=i("admin-visitor-stats");!e||!K||(qe(),e.innerHTML=ne(K),re(e))}function be(){ae&&(clearInterval(ae),ae=null)}function Ie(){be();const e=i("ma-vis-autorefresh");e?.checked&&(ae=setInterval(()=>{A==="visitors"&&e.checked&&se({silent:!0})},3e4))}async function se({silent:e=!1}={}){const t=i("admin-visitor-stats");if(!b)return t&&(t.innerHTML='<div class="ma-vis-error">Admin girişi gerekli.</div>'),null;t&&A==="visitors"&&!e&&(t.innerHTML='<div class="ma-vis-loading">Trafik analitikleri yükleniyor…</div>');try{const r=await(await fetch("/api/admin/visitor-stats",{headers:u()})).json();if(!r.success)throw new Error(r.error||"API hatası");return K=r,Jt(r),t&&A==="visitors"&&(qe(),t.innerHTML=ne(r),re(t),Ie()),r}catch(a){return t&&A==="visitors"&&(t.innerHTML=`<div class="ma-vis-error">Hata: ${s(a.message)}</div>`),null}}function g({label:e,value:t,tone:a="yellow",foot:r=""}){return`
      <div class="ma-metric" data-tone="${s(a)}">
        <div class="ma-metric-label">${s(e)}</div>
        <div class="ma-metric-value">${t??0}</div>
        ${r?`<div class="ma-metric-foot">${s(r)}</div>`:""}
      </div>`}function oe(e,t){const a=(t.real||0)+(t.bot||0)+(t.ai||0);return`
      <div class="ma-traffic-card">
        <div class="t-label">${s(e)}</div>
        <div class="t-value">${a}</div>
        <div class="t-split">
          <span>Gerçek <b>${t.real||0}</b></span>
          <span>Bot <b>${t.bot||0}</b></span>
          <span>AI <b>${t.ai||0}</b></span>
        </div>
      </div>`}function Fe({overview:e={},visitors:t=null,error:a=""}={}){const r=i("ma-dashboard-root");if(!r)return;if(a){r.innerHTML=`<div class="ma-dash-error">${s(a)}</div>`;return}const n=e,d=Math.max(0,(n.totalContainers||0)-(n.activeServers||0)),o=n.pendingOrders||0,c=t||{},f=c.active||{real:0,bot:0,ai:0},v=c.daily||{real:0,bot:0,ai:0},y=c.weekly||{real:0,bot:0,ai:0},B=c.monthly||{real:0,bot:0,ai:0},D=(f.real||0)+(f.bot||0)+(f.ai||0),k=new Date().toLocaleString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});r.innerHTML=`
      <section class="ma-dash-hero">
        <div class="ma-dash-hero-inner">
          <div>
            <p class="ma-dash-kicker">BROWSERCS · CSADMIN</p>
            <h2 class="ma-dash-title">GENEL BAKIŞ</h2>
            <p class="ma-dash-sub">Filo, platform ve site trafiği tek ekranda. Son güncelleme: ${s(k)}</p>
          </div>
          <div class="ma-dash-pulse" title="Son 5 dakikadaki benzersiz ziyaretçi">
            <span class="ma-dash-pulse-dot" aria-hidden="true"></span>
            <div>
              <div class="ma-dash-pulse-label">CANLI TRAFİK</div>
              <div class="ma-dash-pulse-value">${D}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">FİLO</h3>
          <span class="ma-dash-section-hint">Docker / oyun sunucuları</span>
        </div>
        <div class="ma-dash-grid">
          ${g({label:"AKTİF SUNUCU",value:n.activeServers??0,tone:"green",foot:"Çalışan container"})}
          ${g({label:"GERÇEK OYUNCU",value:n.realPlayers??0,tone:"green",foot:`Toplam slot: ${n.totalPlayers??0}`})}
          ${g({label:"BOT OYUNCU",value:n.botPlayers??0,tone:"yellow",foot:"YaPB / ping=Bot"})}
          ${g({label:"TOPLAM CONTAINER",value:n.totalContainers??0,tone:"blue",foot:d?`${d} kapalı / durmuş`:"Hepsi ayakta"})}
          ${g({label:"DB SUNUCU",value:n.dbServersCount??0,tone:"muted",foot:"purchased_servers"})}
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">PLATFORM</h3>
          <span class="ma-dash-section-hint">Hesaplar ve siparişler</span>
        </div>
        <div class="ma-dash-grid">
          ${g({label:"KULLANICI",value:n.usersCount??0,tone:"yellow",foot:"Kayıtlı profil"})}
          ${g({label:"BEKLEYEN ÖDEME",value:o,tone:o>0?"red":"muted",foot:o>0?"Onay bekliyor":"Kuyruk boş"})}
          ${g({label:"SİTE ADMİN",value:n.adminProfiles??0,tone:"blue",foot:"role = admin"})}
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">TRAFİK</h3>
          <span class="ma-dash-section-hint">Gerçek · Bot · AI ayrımı</span>
        </div>
        <div class="ma-traffic">
          ${oe("CANLI (5 DK)",f)}
          ${oe("BUGÜN",v)}
          ${oe("BU HAFTA",y)}
          ${oe("BU AY",B)}
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">HIZLI GEÇİŞ</h3>
        </div>
        <div class="ma-dash-actions">
          <button type="button" class="ma-dash-action" data-ma-jump="servers">Sunucular</button>
          <button type="button" class="ma-dash-action" data-ma-jump="orders" ${o>0?'data-warn="1"':""}>Siparişler${o>0?` (${o})`:""}</button>
          <button type="button" class="ma-dash-action" data-ma-jump="visitors">Ziyaretçi detayı</button>
          <button type="button" class="ma-dash-action" data-ma-jump="users">Kullanıcılar</button>
        </div>
      </section>
    `,r.querySelectorAll("[data-ma-jump]").forEach(w=>{w.addEventListener("click",()=>{const P=w.getAttribute("data-ma-jump");P&&ce(P)})})}async function le(){const e=i("ma-dashboard-root");e&&(e.innerHTML='<div class="ma-dash-loading">Filo ve trafik yükleniyor...</div>');try{const[t,a]=await Promise.all([fetch(`${m}/api/admin/overview`,{headers:u()}).then(r=>r.json()),se({silent:!0})]);if(!t.success)throw new Error(t.error||"API hatası");Fe({overview:t.overview||{},visitors:a})}catch(t){Fe({error:`Overview hatası: ${t.message}`})}}function Ue(e){const t=G;if(!t)return;const a=(i("ma-servers-filter")?.value||"").trim().toLowerCase(),r=a?e.filter(n=>[n.name,n.port,n.owner_username,n.owner_id,n.map,n.status].some(d=>String(d||"").toLowerCase().includes(a))):e;if(!r.length){t.innerHTML='<tr><td colspan="10" style="padding:1rem;text-align:center;color:var(--text-dim);">Kayıt yok.</td></tr>';return}t.innerHTML=r.map(n=>{const d=n.serverId||n.id,o=n.containerId||n.serverId||n.id,c=n.serverId||n.containerId||n.id,f=n.state==="running"?"ÇALIŞIYOR":"KAPALI",v=n.expires_at&&new Date(n.expires_at)<new Date;return`<tr style="${n.state==="running"?"":"opacity:0.72;"}">
      <td style="font-weight:bold;color:var(--text-bright);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${s(n.name)}</td>
      <td><span style="background:${n.isOfficial?"rgba(33,150,243,0.1)":"rgba(255,152,0,0.1)"};color:${n.isOfficial?"#2196f3":"#ff9800"};padding:2px 6px;border-radius:3px;font-size:0.65rem;">${n.isOfficial?"RESMİ":"OYUNCU"}</span></td>
      <td><span style="color:${n.state==="running"?"var(--cs-green)":"var(--cs-red)"};font-weight:700;">${s(f)}</span></td>
      <td style="color:var(--cs-yellow);">${s(n.map||"?")}</td>
      <td title="Gerçek: ${n.realPlayers??0} · Bot: ${n.botPlayers??0} · Toplam: ${n.players??0}">
        <span style="color:var(--cs-green);font-weight:700;">${n.realPlayers??0}</span>
        <span style="color:var(--text-dim);">+</span>
        <span style="color:#f59e0b;font-weight:700;">${n.botPlayers??0}</span>
        <span style="color:var(--text-dim);font-size:0.7rem;"> / ${n.maxplayers??"?"}</span>
      </td>
      <td>${s(n.port||"—")}</td>
      <td title="${s(n.owner_id||"")}">${s(n.owner_username||(n.owner_id?String(n.owner_id).slice(0,8)+"…":"—"))}</td>
      <td style="color:var(--text-dim);">${C(n.created_at)}</td>
      <td style="color:${v?"var(--cs-red)":"var(--text-dim)"};">${C(n.expires_at)}</td>
      <td style="white-space:nowrap;">
        <button class="toolbar-btn" style="border-color:var(--cs-green);color:var(--cs-green);padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="window.openServerSettings('${s(d)}')">AYAR</button>
        ${n.state==="running"?`<button class="toolbar-btn" style="border-color:#f87171;color:#f87171;padding:0.25rem 0.45rem;font-size:0.65rem;" title="Sunucuyu kapat" onclick="masterAdminAction('stop','${s(o)}')">KAPAT</button>`:`<button class="toolbar-btn" style="border-color:#4ade80;color:#4ade80;padding:0.25rem 0.45rem;font-size:0.65rem;" title="Sunucuyu aç" onclick="masterAdminAction('start','${s(o)}')">AÇ</button>`}
        <button class="toolbar-btn" style="border-color:#60a5fa;color:#60a5fa;padding:0.25rem 0.4rem;font-size:0.65rem;" title="Bot ekle" onclick="masterAdminBots('${s(o)}','add')" ${n.state==="running"?"":"disabled"}>+BOT</button>
        <button class="toolbar-btn" style="border-color:#f59e0b;color:#f59e0b;padding:0.25rem 0.4rem;font-size:0.65rem;" title="Bot çıkar" onclick="masterAdminBots('${s(o)}','remove')" ${n.state==="running"?"":"disabled"}>-BOT</button>
        <button class="toolbar-btn" style="border-color:var(--cs-yellow);color:var(--cs-yellow);padding:0.25rem 0.45rem;font-size:0.65rem;" title="Sunucuyu yeniden başlat" onclick="masterAdminAction('restart','${s(o)}')" ${n.state==="running"?"":"disabled"}>YENİDEN BAŞLAT</button>
        <button class="toolbar-btn" style="padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminExtend('${s(n.serverId||"")}')" ${n.serverId?"":"disabled"}>+30G</button>
        <button class="toolbar-btn danger" style="padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminAction('delete','${s(c)}')">SİL</button>
      </td>
    </tr>`}).join("")}async function N(){if(G){G.innerHTML='<tr><td colspan="10" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';try{let e=await fetch(`${m}/api/admin/servers`,{headers:u()}),t=await e.json();if(t.success||(e=await fetch(`${m}/api/servers`),t=await e.json()),!t.success)throw new Error(t.error||"API hatası");J=t.servers||[],Ue(J)}catch(e){G.innerHTML=`<tr><td colspan="10" style="padding:1rem;text-align:center;color:var(--cs-red);">${s(e.message)}</td></tr>`}}}async function he(){const e=i("admin-rental-orders-list");if(e){if(!b){e.innerHTML='<div style="color:var(--cs-red);font-size:0.75rem;">Admin girişi gerekli.</div>';return}e.innerHTML='<div style="color:var(--text-dim);font-size:0.75rem;">Yükleniyor...</div>';try{const t=i("ma-orders-status")?.value,a=t?`?status=${encodeURIComponent(t)}`:"",n=await(await fetch(`${m}/api/admin/rental-orders${a}`,{headers:u()})).json();if(!n.success)throw new Error(n.error||"API hatası");const d=n.orders||[];if(!d.length){e.innerHTML='<div style="color:var(--text-dim);font-size:0.75rem;font-family:var(--font-ui);">Sipariş yok.</div>';return}e.innerHTML=d.map(o=>{const c=["pending_payment","paid","failed"].includes(o.status);return`<div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem;">
          <div style="font-family:var(--font-hud);color:var(--cs-yellow);font-size:0.85rem;">${s(o.order_code||o.id)}</div>
          <div style="font-size:0.65rem;color:var(--text-dim);">${s(o.status)}</div>
        </div>
        <div style="font-family:var(--font-ui);font-size:0.7rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.35rem;">
          ${s(o.server_name||"?")} · ${s(o.map||"?")} · ${o.amount_try||350} ₺ · max ${o.max_players||16}
        </div>
        <div style="font-family:var(--font-ui);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.35rem;word-break:break-all;">
          Owner: ${s(o.owner_id||"?")} · ${C(o.created_at)}
        </div>
        ${o.admin_note?`<div style="font-size:0.65rem;color:var(--cs-yellow);margin-bottom:0.5rem;">Not: ${s(o.admin_note)}</div>`:""}
        ${c?`<div style="display:flex;gap:0.4rem;">
          <button class="toolbar-btn" style="flex:1;border-color:var(--cs-green);color:var(--cs-green);padding:0.4rem;font-size:0.7rem;" onclick="adminRentalOrderAction('approve','${s(o.id)}')">ONAYLA</button>
          <button class="toolbar-btn danger" style="flex:1;padding:0.4rem;font-size:0.7rem;" onclick="adminRentalOrderAction('reject','${s(o.id)}')">REDDET</button>
        </div>`:""}
      </div>`}).join("")}catch(t){e.innerHTML=`<div style="color:var(--cs-red);font-size:0.75rem;">Siparişler yüklenemedi: ${s(t.message)}</div>`}}}window.adminRentalOrderAction=async function(e,t){if(!b)return l("Yetkisiz işlem!","error");const a=e==="approve"?"onaylamak":"reddetmek";if(await window.customConfirm(`Bu siparişi ${a} istediğine emin misin?`,"ONAY"))try{const n=await(await fetch(`${m}/api/admin/rental-orders/${t}/${e}`,{method:"POST",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({})})).json();n.success?(l(e==="approve"?"Sipariş onaylandı, sunucu kuruluyor.":"Sipariş reddedildi.","success"),he(),le(),window.loadServerList&&window.loadServerList()):l((e==="approve"?"Onay":"Red")+" başarısız: "+(n.error||"?"),"error")}catch(r){l("Bağlantı hatası: "+r.message,"error")}};function Zt(e){const t=String(e.vip_tier||"none").toLowerCase();return e.vip_active?`<span class="ma-vip-tier ${s(t)}">${s(we(t))}</span>`+(e.vip_days_left!=null?` <span style="font-size:0.58rem;color:var(--text-dim);">${e.vip_days_left}g</span>`:""):(e.role||"")==="vip"&&t==="none"?'<span class="ma-vip-tier legacy" title="Eski rol=vip, abonelik paketi yok">rol:vip · paket yok</span>':'<span class="ma-vip-tier none">Yok</span>'}async function O(e=""){const t=i("ma-users-table-body");if(t){t.innerHTML='<tr><td colspan="8" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';try{const a=e?`?q=${encodeURIComponent(e)}`:"",n=await(await fetch(`${m}/api/admin/users${a}`,{headers:u()})).json();if(!n.success)throw new Error(n.error||"API hatası");const d=n.users||[];if(Z=d,!d.length){t.innerHTML='<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--text-dim);">Kullanıcı yok.</td></tr>';return}t.innerHTML=d.map(o=>{const c=!!o.is_banned;return`<tr>
        <td style="color:var(--text-bright);font-weight:bold;">${s(o.username||"—")}<div style="font-size:0.58rem;color:var(--text-dim);font-weight:normal;">${s(o.id)}</div></td>
        <td>${Zt(o)}</td>
        <td style="color:var(--text-dim);">${o.vip_active?C(o.vip_expires_at):"—"}</td>
        <td style="color:var(--text-dim);">${s(o.role||"user")}</td>
        <td>${c?`<span class="ma-ban-badge" title="${s(o.ban_reason||"")}">YASAKLI</span>`:'<span class="ma-ok-badge">aktif</span>'}</td>
        <td>${Number(o.wallet_balance||0)}</td>
        <td>${o.servers_count||0}</td>
        <td><div class="ma-user-actions">
          <button class="toolbar-btn" style="padding:0.22rem 0.4rem;font-size:0.62rem;border-color:var(--cs-green);color:var(--cs-green);" onclick="masterAdminEditUser('${s(o.id)}')">DÜZENLE</button>
          <button class="toolbar-btn" style="padding:0.22rem 0.4rem;font-size:0.62rem;border-color:var(--cs-yellow);color:var(--cs-yellow);" onclick="masterAdminToggleBan('${s(o.id)}')">${c?"AÇ":"BAN"}</button>
          <button class="toolbar-btn danger" style="padding:0.22rem 0.4rem;font-size:0.62rem;" onclick="masterAdminDeleteUser('${s(o.id)}')">SİL</button>
        </div></td>
      </tr>`}).join("")}catch(a){t.innerHTML=`<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--cs-red);">${s(a.message)}</td></tr>`}}}function ge(){const e=i("ma-user-edit-modal");e&&(e.style.display="none",e.setAttribute("aria-hidden","true"))}function Wt(e){if(!e)return"";try{const t=new Date(e);if(Number.isNaN(t.getTime()))return"";const a=r=>String(r).padStart(2,"0");return`${t.getFullYear()}-${a(t.getMonth()+1)}-${a(t.getDate())}T${a(t.getHours())}:${a(t.getMinutes())}`}catch{return""}}window.masterAdminEditUser=function(e){if(!b||!e)return;const t=Z.find(r=>r.id===e);if(!t)return l("Kullanıcı bulunamadı — yenile","error");const a=i("ma-user-edit-modal");if(!a)return l("Düzenleme formu yok","error");i("ma-edit-user-id").value=t.id,i("ma-edit-username").value=t.username||"",i("ma-edit-role").value=t.role||"user",i("ma-edit-wallet").value=Number(t.wallet_balance||0),i("ma-edit-premium").checked=!!t.is_premium,i("ma-edit-vip-tier").value=t.vip_active?t.vip_tier||"none":t.vip_tier==="none"||!t.vip_tier?"none":t.vip_tier,!t.vip_active&&t.vip_tier&&t.vip_tier!=="none"&&(i("ma-edit-vip-tier").value=t.vip_tier),i("ma-edit-vip-days").value="30",i("ma-edit-vip-expires").value=Wt(t.vip_expires_at),i("ma-edit-vip-notes").value=t.vip_notes||"",i("ma-edit-admin-notes").value=t.admin_notes||"",a.style.display="flex",a.setAttribute("aria-hidden","false")};async function Xt(){if(!b)return l("Yetkisiz!","error");const e=i("ma-edit-user-id")?.value;if(!e)return;const t=i("ma-edit-vip-tier")?.value||"none",a={username:(i("ma-edit-username")?.value||"").trim(),role:i("ma-edit-role")?.value||"user",wallet_balance:Number(i("ma-edit-wallet")?.value||0),is_premium:!!i("ma-edit-premium")?.checked,vip_tier:t,vip_notes:(i("ma-edit-vip-notes")?.value||"").trim()||null,admin_notes:(i("ma-edit-admin-notes")?.value||"").trim()||null},r=i("ma-edit-vip-expires")?.value;t!=="none"&&(r?a.vip_expires_at=new Date(r).toISOString():a.vip_days=parseInt(i("ma-edit-vip-days")?.value,10)||30);try{const d=await(await fetch(`${m}/api/admin/users/${e}`,{method:"PATCH",headers:u({"Content-Type":"application/json"}),body:JSON.stringify(a)})).json();if(!d.success)throw new Error(d.error||"Hata");l(t==="none"?"Kullanıcı kaydedildi (VIP yok)":`Kaydedildi → ${we(t)}`,"success"),ge(),O((i("ma-users-search")?.value||"").trim()),A==="users"&&ke()}catch(n){l("Kayıt hatası: "+n.message,"error")}}window.masterAdminToggleBan=async function(e){if(!b||!e)return;const t=Z.find(o=>o.id===e);if(!t)return;if(t.is_banned){if(!await window.customConfirm(`${t.username||"Kullanıcı"} yasağı kaldırılsın mı?`,"YASAĞI KALDIR"))return;try{const c=await(await fetch(`${m}/api/admin/users/${e}/unban`,{method:"POST",headers:u({"Content-Type":"application/json"}),body:"{}"})).json();if(!c.success)throw new Error(c.error||"Hata");l("Yasak kaldırıldı","success"),O((i("ma-users-search")?.value||"").trim())}catch(o){l("Unban hatası: "+o.message,"error")}return}const a=await window.customPrompt("Kaç gün yasak? (boş = kalıcı)","7","BAN SÜRESİ");if(a===null)return;const r=await window.customPrompt("Ban nedeni (kullanıcıya gösterilir)","Kurallara aykırı davranış","BAN NEDENİ");if(r===null)return;const n=!String(a||"").trim(),d=n?void 0:Math.max(1,parseInt(a,10)||7);try{const c=await(await fetch(`${m}/api/admin/users/${e}/ban`,{method:"POST",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({permanent:n,days:d,reason:r||"Yönetici tarafından yasaklandı"})})).json();if(!c.success)throw new Error(c.error||"Hata");l(n?"Kalıcı ban uygulandı":`${d} gün ban`,"success"),O((i("ma-users-search")?.value||"").trim())}catch(o){l("Ban hatası: "+o.message,"error")}},window.masterAdminDeleteUser=async function(e){if(!b||!e)return;const a=Z.find(n=>n.id===e)?.username||e;if(!await window.customConfirm(`${a} hesabı kapatılsın mı?

Varsayılan: pasifleştir (kalıcı ban + VIP iptal).
Auth silmek için bir sonraki soruda EVET deyin.`,"HESABI KAPAT"))return;const r=await window.customConfirm("Auth kullanıcısını da tamamen silmek istiyor musun? (Geri alınamaz — genelde HAYIR)","KALICI SİL?");try{const o=await(await fetch(`${m}/api/admin/users/${e}${r?"?hard=1":""}`,{method:"DELETE",headers:u()})).json();if(!o.success)throw new Error(o.error||"Hata");l(r?"Kullanıcı kalıcı silindi":"Hesap pasifleştirildi","success"),O((i("ma-users-search")?.value||"").trim())}catch(n){l("Silme hatası: "+n.message,"error")}};function we(e){const t=String(e||"").toLowerCase();return t==="platinum"?"Platinum":t==="gold"?"Gold":t==="silver"?"Silver":t||"—"}async function ke(){try{const t=await(await fetch(`${m}/api/admin/vip/subscribers`,{headers:u()})).json();if(!t.success)throw new Error(t.error||"API hatası");const a=t.stats||{},r=(o,c)=>{const f=i(o);f&&(f.textContent=String(c??0))};r("ma-vip-kpi-silver",a.silver),r("ma-vip-kpi-gold",a.gold),r("ma-vip-kpi-platinum",a.platinum),r("ma-vip-kpi-soon",a.expiringSoon);const n=t.prices||{},d=i("ma-vip-prices");d&&n.silver!=null&&(d.innerHTML=`
          <span class="ma-vip-price-chip silver">Silver <b>${s(n.silver)}₺</b>/ay</span>
          <span class="ma-vip-price-chip gold">Gold <b>${s(n.gold)}₺</b>/ay</span>
          <span class="ma-vip-price-chip platinum">Platinum <b>${s(n.platinum)}₺</b>/ay</span>`)}catch(e){l("VIP istatistik hatası: "+e.message,"error")}}async function Ae(){const e=i("admin-vip-orders-list");if(e){if(!b){e.innerHTML='<div style="color:var(--cs-red);font-size:0.75rem;">Admin girişi gerekli.</div>';return}e.innerHTML='<div style="color:var(--text-dim);font-size:0.75rem;">Yükleniyor...</div>';try{const a=await(await fetch(`${m}/api/admin/vip-orders?status=pending_payment`,{headers:u()})).json();if(!a.success)throw new Error(a.error||"API hatası");const r=a.orders||[];if(!r.length){e.innerHTML='<div style="color:var(--text-dim);font-size:0.75rem;font-family:var(--font-ui);">Bekleyen sipariş yok.</div>';return}e.innerHTML=r.map(n=>`<div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem;">
          <div style="font-family:var(--font-hud);color:var(--cs-yellow);font-size:0.85rem;">${s(n.order_code||n.id)}</div>
          <div style="font-size:0.65rem;color:var(--text-dim);">${s(n.status)}</div>
        </div>
        <div style="font-family:var(--font-ui);font-size:0.7rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.35rem;">
          ${s(n.username||n.owner_id||"?")} · <span class="ma-vip-tier ${s(n.tier)}">${s(we(n.tier))}</span> · ${n.amount_try} ₺ · ${n.days||30} gün
        </div>
        <div style="font-family:var(--font-ui);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.5rem;">${C(n.created_at)}</div>
        <div style="display:flex;gap:0.4rem;">
          <button class="toolbar-btn" style="flex:1;border-color:var(--cs-green);color:var(--cs-green);padding:0.4rem;font-size:0.7rem;" onclick="adminVipOrderAction('approve','${s(n.id)}')">ONAYLA</button>
          <button class="toolbar-btn danger" style="flex:1;padding:0.4rem;font-size:0.7rem;" onclick="adminVipOrderAction('reject','${s(n.id)}')">REDDET</button>
        </div>
      </div>`).join("")}catch(t){e.innerHTML=`<div style="color:var(--cs-red);font-size:0.75rem;">Siparişler yüklenemedi: ${s(t.message)}</div>`}}}window.adminVipOrderAction=async function(e,t){if(!b)return l("Yetkisiz işlem!","error");const a=e==="approve"?"onaylamak":"reddetmek";if(await window.customConfirm(`Bu VIP siparişini ${a} istediğine emin misin?`,"ONAY"))try{const n=await(await fetch(`${m}/api/admin/vip-orders/${t}/${e}`,{method:"POST",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({})})).json();if(!n.success)throw new Error(n.error||"Hata");l(e==="approve"?"Sipariş onaylandı, VIP tanımlandı.":"Sipariş reddedildi.","success"),Ae(),ke(),O((i("ma-users-search")?.value||"").trim())}catch(r){l((e==="approve"?"Onay":"Red")+" başarısız: "+r.message,"error")}};async function Se(){const e=i("ma-admins-table-body");if(e){e.innerHTML='<tr><td colspan="8" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';try{const a=await(await fetch(`${m}/api/admin/server-admins`,{headers:u()})).json();if(!a.success)throw new Error(a.error||"API hatası");const r=a.admins||[];if(!r.length){e.innerHTML='<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--text-dim);">Admin kaydı yok.</td></tr>';return}e.innerHTML=r.map(n=>`
      <tr>
        <td>${s(n.server_name||n.server_id||"—")}</td>
        <td>${s(n.port||"—")}</td>
        <td style="color:var(--cs-yellow);">${s(n.game_name||"—")}</td>
        <td>${s(n.username||"—")}</td>
        <td><code>${s(n.flags||"")}</code></td>
        <td><code style="font-size:0.65rem;">${s(n.amx_password||"")}</code></td>
        <td style="color:var(--text-dim);">${C(n.created_at)}</td>
        <td>${n.id?`<button class="toolbar-btn danger" style="padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminDeleteAmx('${s(n.id)}')">SİL</button>`:"—"}</td>
      </tr>`).join("")}catch(t){e.innerHTML=`<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--cs-red);">${s(t.message)}</td></tr>`}}}window.masterAdminDeleteAmx=async function(e){if(x()&&await window.customConfirm("Bu AMXX admin kaydını silmek istediğine emin misin?","ONAY"))try{const a=await(await fetch(`${m}/api/admin/server-admins/${e}`,{method:"DELETE",headers:u()})).json();if(!a.success)throw new Error(a.error||"Hata");l("Admin silindi","success"),Se()}catch(t){l("Silinemedi: "+t.message,"error")}},window.masterAdminExtend=async function(e){if(!(!b||!e)&&await window.customConfirm("Süre +30 gün uzatılsın mı?","ONAY"))try{const t=J.find(d=>d.serverId===e||d.id===e),a=t?.expires_at?new Date(t.expires_at):new Date;a<new Date&&a.setTime(Date.now()),a.setDate(a.getDate()+30);const n=await(await fetch(`${m}/api/admin/servers/${e}`,{method:"PATCH",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({expires_at:a.toISOString(),status:"running"})})).json();if(!n.success)throw new Error(n.error||"Hata");l("Süre 30 gün uzatıldı","success"),N()}catch(t){l("Uzatma hatası: "+t.message,"error")}},window.masterAdminBots=async function(e,t){if(!b||!e)return l("Yetkisiz!","error");const a=t==="add"?"Bot eklendi":t==="kickall"?"Tüm botlar atıldı":"Bot çıkarıldı";try{const n=await(await fetch(`${m}/api/admin/servers/${encodeURIComponent(e)}/bots`,{method:"POST",headers:u({"Content-Type":"application/json"}),body:JSON.stringify({action:t})})).json();if(!n.success)throw new Error(n.error||"Hata");l(`${a} (port ${n.port||"?"})`,"success"),setTimeout(()=>N(),1200)}catch(r){l("Bot işlemi başarısız: "+r.message,"error")}};async function Ge(){V&&(V.style.display="flex",ce(A||"dashboard"))}window.masterAdminAction=async function(e,t){if(!b)return l("Yetkisiz işlem!","error");if(e==="delete"){if(!await window.customConfirm("Bu sunucuyu tamamen silmek istediğine emin misin? (Docker + DB)","ONAY"))return;try{const r=await(await fetch(`${m}/api/admin/servers/${t}`,{method:"DELETE",headers:u()})).json();r.success?(l("Sunucu silindi!","success"),N(),le()):l("Silinemedi: "+r.error,"error")}catch{l("Silme hatası","error")}}else if(e==="restart"){if(!await window.customConfirm("Bu sunucuyu yeniden başlatmak istediğine emin misin?","ONAY"))return;try{const r=await(await fetch(`${m}/api/admin/servers/${encodeURIComponent(t)}/restart`,{method:"POST",headers:u()})).json();r.success?(l(`Sunucu yeniden başlatılıyor${r.port?` (port ${r.port})`:""}...`,"success"),setTimeout(()=>N(),2500)):l("Restart başarısız: "+(r.error||"?"),"error")}catch(a){l("Restart hatası: "+a.message,"error")}}else if(e==="stop"){if(!await window.customConfirm("Bu sunucuyu kapatmak istediğine emin misin? Oyuncular düşecek.","ONAY"))return;try{const r=await(await fetch(`${m}/api/admin/servers/${encodeURIComponent(t)}/stop`,{method:"POST",headers:u()})).json();r.success?(l(`Sunucu kapatıldı${r.port?` (port ${r.port})`:""}`,"success"),setTimeout(()=>N(),1200)):l("Kapatılamadı: "+(r.error||"?"),"error")}catch(a){l("Kapatma hatası: "+a.message,"error")}}else if(e==="start"){if(!await window.customConfirm("Bu sunucuyu açmak istediğine emin misin?","ONAY"))return;try{const r=await(await fetch(`${m}/api/admin/servers/${encodeURIComponent(t)}/start`,{method:"POST",headers:u()})).json();r.success?(l(`Sunucu açılıyor${r.port?` (port ${r.port})`:""}...`,"success"),setTimeout(()=>N(),2500)):l("Açılamadı: "+(r.error||"?"),"error")}catch(a){l("Açma hatası: "+a.message,"error")}}};async function Je(){if(!b)return l("Yetkisiz işlem!","error");if(await window.customConfirm("TÜM oyun sunucuları yeniden başlatılacak. Oyuncular düşecek. Emin misin?","ONAY")&&await window.customConfirm("Son onay: tüm Docker sunucularını şimdi yeniden başlat?","SON ONAY"))try{l("Tüm sunucular yeniden başlatılıyor...","info");const t=await(await fetch(`${m}/api/admin/servers/restart-all`,{method:"POST",headers:u()})).json();if(!t.success)throw new Error(t.error||"Hata");l(`Yeniden başlatıldı: ${t.restarted}/${t.total}`+(t.failed?` · hata: ${t.failed}`:""),"success"),setTimeout(()=>{N(),le()},3e3)}catch(e){l("Toplu restart hatası: "+e.message,"error")}}window.masterAdminRestartAllServers=Je,document.querySelectorAll("#master-admin-panel .ma-nav-btn").forEach(e=>{e.addEventListener("click",()=>ce(e.dataset.maView))});const Ze=i("btn-admin-panel-refresh");Ze&&Ze.addEventListener("click",()=>me());const We=i("ma-servers-filter");We&&We.addEventListener("input",()=>Ue(J));const Xe=i("ma-orders-status");Xe&&Xe.addEventListener("change",()=>he());const $e=i("ma-users-search");$e&&$e.addEventListener("input",()=>{clearTimeout(je),je=setTimeout(()=>O($e.value.trim()),300)});const Qe=i("btn-admin-refresh-users");Qe&&Qe.addEventListener("click",()=>O((i("ma-users-search")?.value||"").trim()));const et=i("btn-ma-edit-cancel");et&&et.addEventListener("click",()=>ge());const tt=i("btn-ma-edit-save");tt&&tt.addEventListener("click",()=>Xt());const xe=i("ma-user-edit-modal");xe&&xe.addEventListener("click",e=>{e.target===xe&&ge()});const at=i("btn-admin-refresh-vip-orders");at&&at.addEventListener("click",()=>Ae());const nt=i("btn-admin-refresh-visitors");nt&&nt.addEventListener("click",()=>se());const rt=i("ma-vis-range");rt&&rt.addEventListener("change",()=>{h.logPage=0,ie()});const it=i("ma-vis-type");it&&it.addEventListener("change",()=>{h.logPage=0,ie()});const st=i("ma-vis-page");st&&st.addEventListener("change",()=>{h.logPage=0,ie()});const ot=i("ma-vis-search");if(ot){let e=null;ot.addEventListener("input",()=>{clearTimeout(e),e=setTimeout(()=>{h.logPage=0,ie()},200)})}const Te=i("ma-vis-autorefresh");Te&&Te.addEventListener("change",()=>{Te.checked&&A==="visitors"?Ie():be()});const lt=i("btn-admin-refresh-amx");lt&&lt.addEventListener("click",()=>Se());const dt=e=>{e&&e.addEventListener("click",()=>Je())};dt(i("btn-admin-restart-all-servers")),dt(i("btn-admin-restart-all-servers-system"));const ct=i("btn-admin-purge-rentals");ct&&ct.addEventListener("click",async()=>{if(x()&&await window.customConfirm("TÜM kiralık sunucular ve DB kayıtları silinecek. Emin misin?","TEHLİKE")&&await window.customConfirm("Son onay: bu işlem geri alınamaz.","SON ONAY"))try{const t=await(await fetch(`${m}/api/admin/rentals/purge`,{method:"DELETE",headers:u()})).json();if(!t.success)throw new Error(t.error||"Hata");l(`Temizlendi: ${t.removedContainers||0} container`,"success"),me("servers")}catch(e){l("Purge hatası: "+e.message,"error")}});const mt=i("btn-admin-logout");mt&&mt.addEventListener("click",()=>{sessionStorage.removeItem("cs_master_admin_token"),b=null,V&&(V.style.display="none"),l("Admin oturumu kapatıldı","success")});const ut=i("btn-ma-site-save");ut&&ut.addEventListener("click",()=>Dt());const pt=i("btn-ma-commerce-reload");pt&&pt.addEventListener("click",()=>_e());const ft=i("btn-ma-bank-save");ft&&ft.addEventListener("click",()=>Kt());const yt=i("btn-ma-rental-save");yt&&yt.addEventListener("click",()=>Bt());const vt=i("btn-ma-rental-add");vt&&vt.addEventListener("click",()=>{ue(),L.push({maxPlayers:16,label:"Yeni",priceTry:350,enabled:!0}),ee(L)});const bt=i("btn-ma-vip-save");bt&&bt.addEventListener("click",()=>_t());const ht=i("btn-ma-ann-add");ht&&ht.addEventListener("click",()=>Be(null));const gt=i("btn-ma-ann-cancel");gt&&gt.addEventListener("click",()=>fe());const wt=i("btn-ma-ann-save");wt&&wt.addEventListener("click",()=>Pt());const kt=i("btn-ma-ann-upload");kt&&kt.addEventListener("click",()=>Yt());const Ee=i("ma-ann-modal");Ee&&Ee.addEventListener("click",e=>{e.target===Ee&&fe()});const At=i("btn-ma-page-add");At&&At.addEventListener("click",()=>{z=He(),z.push({path:"/",title:"Yeni sayfa",changefreq:"weekly",priority:"0.5",in_sitemap:!0}),W(z)});const St=i("btn-ma-maps-save");St&&St.addEventListener("click",()=>Vt());const $t=i("btn-ma-map-add");$t&&$t.addEventListener("click",()=>{T=Pe(),T.push({name:"new_map",slug:"new-map",description:"",mode:"de",seo_title:"",playable:!0,in_sitemap:!0,featured:!1,size:0,priority:"0.75"}),te(T)});const xt=i("btn-ma-sitemap-regen");xt&&xt.addEventListener("click",()=>ye());const Tt=i("btn-ma-sitemap-copy");Tt&&Tt.addEventListener("click",async()=>{if(E||await ye(),!!E)try{await navigator.clipboard.writeText(E),l("Sitemap XML panoya kopyalandı","success")}catch{l("Kopyalama başarısız — önizlemeyi seçip kopyala","error")}});const Et=i("btn-ma-sitemap-download");Et&&Et.addEventListener("click",async()=>{if(E||await ye(),!E)return;const e=new Blob([E],{type:"application/xml"}),t=URL.createObjectURL(e),a=document.createElement("a");a.href=t,a.download="sitemap.xml",a.click(),URL.revokeObjectURL(t),l("sitemap.xml indirildi — public/ altına koyup deploy et","success")})}export{ia as initMasterAdmin,ta as shouldOpenMasterAdmin};
