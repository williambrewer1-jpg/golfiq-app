// BreakingPar Garmin export bookmarklet — readable source.
// WHAT IT DOES: runs only on connect.garmin.com while you are signed in. It reads your golf
// scorecards, shot data and club list from the same endpoints the Garmin Connect website uses
// (same-origin requests with your existing session + the page's CSRF token), packs them into
// one JSON file and offers it to save. It sends nothing anywhere else, stores nothing, and never
// sees your password. You import the saved file into the BreakingPar app.
export const BOOKMARKLET_SRC = String.raw`(async function(){
var H=location.hostname;
if(H.indexOf('connect.garmin.com')<0){alert('BreakingPar: open connect.garmin.com (signed in), then tap this bookmark again.');return;}
var box=document.createElement('div');
box.style.cssText='position:fixed;z-index:2147483647;left:8px;right:8px;top:8px;padding:14px;background:#1b5e20;color:#fff;font:15px -apple-system,system-ui,sans-serif;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.45);white-space:pre-wrap;max-height:70vh;overflow:auto';
document.body.appendChild(box);
function say(t){box.textContent='BreakingPar export\n'+t;}
var lim=prompt('BreakingPar: export how many of your most recent rounds? Leave blank for ALL rounds.','');
if(lim===null){box.remove();return;}
lim=parseInt(lim,10)||0;
var csrf=(document.querySelector('meta[name="csrf-token"]')||{}).content||null;
if(!csrf){try{var html=await (await fetch('/app/',{credentials:'include'})).text();var m=html.match(/name="csrf-token"\s+content="([^"]+)"/);if(m)csrf=m[1];}catch(e){}}
var bases=['/gc-api/gcs-golfcommunity/api/v2','/modern/proxy/gcs-golfcommunity/api/v2'],base=null;
async function get(path){
 var tries=base?[base]:bases,last='';
 for(var i=0;i<tries.length;i++){
  var hdr={'Accept':'application/json'};
  if(csrf)hdr['Connect-Csrf-Token']=csrf;
  if(tries[i].indexOf('/modern/')===0)hdr['NK']='NT';
  try{var r=await fetch(tries[i]+path,{credentials:'include',headers:hdr});
   if(r.ok){base=tries[i];var t=await r.text();return t?JSON.parse(t):null;}
   last='HTTP '+r.status+' at '+tries[i]+path;}catch(e){last=e.message+' at '+tries[i]+path;}
 }
 throw new Error(last+(csrf?'':' (no CSRF token found - open connect.garmin.com/app/ first)'));
}
try{
 say('Listing your rounds…');
 var s=await get('/scorecard/summary?per-page=10000&user-locale=en');
 var sums=(s&&s.scorecardSummaries)||[];
 sums.sort(function(a,b){return String(b.startTime||'').localeCompare(String(a.startTime||''));});
 if(lim)sums=sums.slice(0,lim);
 var clubs=null,types=null;
 try{clubs=await get('/club/player?per-page=1000&include-stats=false&maxClubTypeId=128');}catch(e){}
 try{types=await get('/club/types?maxClubTypeId=128');}catch(e){}
 var holes=[];for(var h=1;h<=18;h++)holes.push(h);
 var rounds=[],fails=[];
 for(var i=0;i<sums.length;i++){
  var id=sums[i].id;say('Round '+(i+1)+' of '+sums.length+'…');
  try{
   var d=await get('/scorecard/detail?scorecard-ids='+id+'&include-longest-shot-distance=true');
   var sh=null;try{sh=await get('/shot/scorecard/'+id+'/hole?hole-numbers='+holes.join('-')+'&image-size=IMG_730X730');}catch(e){fails.push(id+' shots: '+e.message);}
   rounds.push({golfiq_bundle_version:1,kind:'round',source:'garmin_connect_bookmarklet',scorecard_id:String(id),fetched_at:new Date().toISOString(),summary:sums[i],detail:d,shots:sh});
  }catch(e){fails.push(id+': '+e.message);}
 }
 var out={golfiq_export:1,source:'garmin_connect_bookmarklet',endpoint:base,exported_at:new Date().toISOString(),
  clubs:{golfiq_bundle_version:1,kind:'clubs',clubs:clubs,club_types:types},rounds:rounds,failures:fails};
 var name='breakingpar-garmin-'+new Date().toISOString().slice(0,10)+'.json';
 var file=new File([JSON.stringify(out)],name,{type:'application/json'});
 say(rounds.length+' rounds ready'+(fails.length?' ('+fails.length+' problems: '+fails.slice(0,3).join('; ')+')':'')+'.\nTap Save, choose "Save to Files", then import the file in BreakingPar.\n');
 var btn=document.createElement('button');btn.textContent='Save file';
 btn.style.cssText='margin-top:10px;padding:10px 18px;font:600 16px -apple-system,sans-serif;border:0;border-radius:10px;background:#fff;color:#1b5e20';
 btn.onclick=async function(){
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});return;}catch(e){}}
  var a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=name;document.body.appendChild(a);a.click();
 };
 var close=document.createElement('button');close.textContent='Close';
 close.style.cssText='margin:10px 0 0 10px;padding:10px 18px;font:16px -apple-system,sans-serif;border:0;border-radius:10px;background:transparent;color:#fff;text-decoration:underline';
 close.onclick=function(){box.remove();};
 box.appendChild(btn);box.appendChild(close);
}catch(e){say('Export failed:\n'+e.message+'\n\nTake a screenshot and send it to Claude so the endpoints can be adjusted.');}
})();`;

// Minimal javascript: URL (line breaks removed; encodeURI keeps it a single valid URL).
export function bookmarkletUrl() {
  return 'javascript:' + encodeURI(BOOKMARKLET_SRC.split('\n').map((l) => l.trim()).join(''));
}
