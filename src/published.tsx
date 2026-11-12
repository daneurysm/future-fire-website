import {useEffect, useState} from 'react';

export function useContent() {
  const [content,setContent]=useState<any>(null);
  useEffect(()=>{const controller=new AbortController();fetch('/api/content',{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('Unavailable');return response.json();}).then(setContent).catch(()=>{});return()=>controller.abort();},[]);
  const keys=['news','reviews','wiki','tour','livestream','matrix'];
  const settings=(active:number)=>content?.sections?.find((section:any)=>section.section===keys[active]);
  const hasContent=(active:number)=>{
    if(!content||active===2)return false;
    const section=settings(active);
    if(section&&(section.heading||section.description||section.eyebrow||section.image_media_id))return true;
    if(active===0)return content.articles.some((article:any)=>article.section!=='review');
    if(active===1)return content.articles.some((article:any)=>article.section==='review');
    if(active===3)return content.tours.length>0;
    if(active===4)return !!(content.livestream.stream_url||content.livestream.description||content.livestream.schedule_text||content.livestream.image_media_id);
    return active===5;
  };
  return {content,hasContent,settings};
}
function paragraphs(text:string){return text?.split(/\n\s*\n/).map((paragraph,index)=><p key={index} className="managed-text">{paragraph}</p>);}
export function PublishedContent({content,active,settings}:{content:any,active:number,settings:any}){
  const [expanded,setExpanded]=useState<string|null>(null);
  if(!content)return null;
  const headings=['FROM THE CLUB.','IN THE GROOVE.','','SEE YOU AT THE FRONT.','YOUR NEXT FREQUENCY.','ENTER THE MATRIX.'];
  const section=settings||{};const stream=content.livestream;
  const articles=content.articles.filter((article:any)=>active===1?article.section==='review':article.section!=='review');
  return <div className="section-page managed-content"><span className="eyebrow">{section.eyebrow||'FUTUREFIRE / INDEPENDENT SOUNDS'}</span><h1>{section.heading||headings[active]}</h1>{paragraphs(section.description)}{section.image_media_id&&<img className="managed-cover" src={'/media/'+section.image_media_id} alt=""/>}
    {(active===0||active===1)&&<div className="managed-articles">{articles.length?articles.map((article:any)=><article key={article.id}>
      <span className="meta">{article.section==='weekly_report'?'WEEKLY REPORT':article.section.toUpperCase()} / {new Date(article.published_at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}</span>
      <h2>{article.title}</h2>{article.section==='review'&&<p>{[article.artist,article.release_title,article.label,article.rating!==null&&article.rating!==undefined?`${article.rating}/10`:''].filter(Boolean).join(' / ')}</p>}{article.cover_media_id&&<figure><img className="managed-cover" src={'/media/'+article.cover_media_id} alt={article.cover_alt||''}/>{article.cover_credit&&<figcaption>{article.cover_credit}</figcaption>}</figure>}{paragraphs(article.summary)}
      {article.listen_url&&<a href={article.listen_url} target="_blank" rel="noopener noreferrer">LISTEN ↗</a>}
      {expanded===article.id&&paragraphs(article.body_markdown)}{article.body_markdown&&<button className="text-button" aria-expanded={expanded===article.id} onClick={()=>setExpanded(expanded===article.id?null:article.id)}>{expanded===article.id?'CLOSE −':'READ MORE ↗'}</button>}
    </article>):<p>New transmissions coming soon.</p>}</div>}
    {active===3&&<div className="managed-articles">{content.tours.length?content.tours.map((show:any)=><article key={show.id}><span className="meta">{new Date(show.starts_at).toLocaleString(undefined,{timeZone:show.timezone,dateStyle:'medium',timeStyle:'short'})} / {show.timezone}</span><h2>{show.artist}</h2><p>{[show.venue,show.city,show.region,show.country].filter(Boolean).join(' / ')}</p>{show.image_media_id&&<img className="managed-cover" src={'/media/'+show.image_media_id} alt=""/>}{paragraphs(show.body_markdown)}{show.ticket_url&&<a className="text-button" href={show.ticket_url} target="_blank" rel="noopener noreferrer">TICKETS ↗</a>}</article>):<p>No dates announced.</p>}</div>}
    {active===4&&<><h2>{stream.title}</h2><span className="pending">{stream.is_live?'LIVE NOW':'OFF AIR'}</span>{paragraphs(stream.description)}{stream.image_media_id&&<img className="managed-cover" src={'/media/'+stream.image_media_id} alt="Show artwork"/>}{stream.stream_url&&<audio controls preload="none" src={stream.stream_url}>Your browser does not support audio playback.</audio>}<p>{stream.schedule_text}</p><div className="station"><b>{stream.station_frequency}</b><span>{stream.station_name} / {stream.station_location}</span></div></>}
    {active===5&&<div className="social-grid">{content.socials.map((social:any,index:number)=><a key={social.id} href={social.url} className="social-link" target="_blank" rel="noopener noreferrer"><span className="meta">NETWORK / {String(index+1).padStart(2,'0')}</span><h2>{social.name}</h2><span className="social-handle">{social.handle}</span><span className="social-arrow" aria-hidden="true">↗</span></a>)}</div>}
  </div>;
}
