// THROWAWAY. Synthetic conversation and source data, held only in memory.
const icons = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 14h8M8 17h6"/>',
  'arrow-up': '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  'chevron-left': '<path d="m14 5-7 7 7 7"/>',
  'chevron-right': '<path d="m10 5 7 7-7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>'
};
const svg = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const sources = {
  '2025': { title:'Reading task study · 2025', origin:'Study report', locator:'Page 2, Results', excerpt:'At week 24, the reading-task group scored 79 on the retention task and the comparison group scored 70. The primary endpoint was the between-group difference in retention score.', note:'assets/reading-task-2025.html', pdf:'assets/reading-task-study.pdf#page=2' },
  '2023': { title:'Reading task study · 2023', origin:'Study report', locator:'Page 1, Methods and results', excerpt:'Participants completed the same retention task at week 12. The reading-task group scored 74 and the comparison group scored 70. The study did not collect a week-24 retention score.', note:'assets/reading-task-2023.html', pdf:'assets/reading-task-study.pdf#page=1' },
  'notes': { title:'Reading task comparison', origin:'Saved note', locator:'Follow-up', excerpt:'The studies share an endpoint but report it at different times. The observed group difference alone cannot identify whether follow-up duration caused the difference.', note:'assets/reading-task-comparison.html', pdf:null }
};
const variants = { A:'A · Margin history', B:'B · Conversation', C:'C · Source rail' };
const citation = (id,label) => `<button type="button" class="citation" data-source="${id}" aria-haspopup="dialog" aria-label="Source: ${escapeHTML(sources[id].title)}">${label}</button>`;
const activity = () => `<details class="tool-activity"><summary>Searched 3 sources</summary><ul><li><code>reading task follow-up primary endpoint</code></li><li>Reading task study · 2025</li><li>Reading task study · 2023</li><li>Reading task comparison</li></ul></details>`;
const image = () => `<figure class="returned-image"><button type="button" class="image-open" data-action="image" aria-label="Open image: Retention by study week"><img src="assets/retention-chart.svg" alt="Synthetic chart. The reading-task group scores 74 at week 12 and 79 at week 24; the comparison group scores 70 at both weeks."></button><figcaption><span>Retention by study week</span><a href="assets/reading-task-study.pdf#page=2" target="_blank" rel="noopener">PDF · page 2</a></figcaption></figure>`;
const comparisons = `${activity()}<p>The 2025 study used a longer follow-up. Participants completed the retention task at <strong>24 weeks</strong>, compared with <strong>12 weeks</strong> in 2023. The primary endpoint stayed the same. ${citation('2025','1 · 2025 study')} ${citation('2023','2 · 2023 study')}</p><h2>Main differences</h2><ul><li><strong>Follow-up:</strong> 24 weeks rather than 12.</li><li><strong>Observed difference:</strong> 9 points rather than 4 points on the retention task.</li><li><strong>Comparison:</strong> Both studies used the same task and scoring method.</li></ul><p>The chart shows the reported values. ${citation('2025','1 · 2025 study')}</p>${image()}<div class="media-links"><a href="assets/reading-task-study.pdf#page=2" target="_blank" rel="noopener">${svg('file')}Reading task study.pdf</a><a href="assets/reading-task-2025.html" target="_blank" rel="noopener">${svg('link')}Study page</a></div>`;
const discussion = `<p>It could, but these two studies don't isolate the effect of follow-up duration. The groups differ more at 24 weeks, yet the 2023 study did not measure that time point. ${citation('2023','2 · 2023 study')}</p><p>I would compare the 2025 study's week-12 and week-24 results before attributing the change to time. The saved comparison note makes the same distinction. ${citation('notes','3 · Comparison note')}</p>`;
const initialMessages = [
  {role:'user',content:'What changed between the 2023 and 2025 reading task studies?'},
  {role:'assistant',content:comparisons},
  {role:'user',content:'Could the longer follow-up explain the change?'},
  {role:'assistant',content:discussion}
];
let chats = [
  {id:'comparison',title:'2023 and 2025 studies',messages:initialMessages.map(message=>({...message}))},
  {id:'figures',title:'Retention chart',messages:[{role:'user',content:'Show me the retention chart.'},{role:'assistant',content:`<p>The saved study includes this chart. ${citation('2025','1 · 2025 study')}</p>${image()}`}]},
  {id:'notes',title:'Follow-up methods',messages:[{role:'user',content:'What is the primary endpoint?'},{role:'assistant',content:`<p>The primary endpoint is the between-group difference in retention score. Both reports use the same retention task. ${citation('2025','1 · 2025 study')} ${citation('2023','2 · 2023 study')}</p>`}]}
];
let currentChat = 'comparison';
let variant = new URLSearchParams(location.search).get('variant') || 'A';
if (!variants[variant]) variant = 'A';
let pending = false;
let pendingTimer;
let hoverTimer;
let sourceId = '';
let sourceAnchor = null;
const transcript = document.getElementById('transcript');
const messageInput = document.getElementById('message');
const sendButton = document.getElementById('send');
const popover = document.getElementById('evidence');
const scroll = document.getElementById('conversation');
const isPhone = () => window.matchMedia('(max-width:720px)').matches;
const activeChat = () => chats.find(chat=>chat.id===currentChat);
const stampIcons = root => root.querySelectorAll('[data-icon]').forEach(element=>{element.innerHTML=svg(element.dataset.icon);});

function renderState() {
  const total = activeChat()?.messages.length || 0;
  document.getElementById('prototype-state').textContent = `${isPhone()?'Phone':'Desktop'} · ${total} messages · ${pending?'searching':sourceId?'source open':'idle'}`;
}
function renderChats() {
  document.getElementById('chat-list').innerHTML = chats.map(chat=>`<button type="button" data-chat="${chat.id}" aria-current="${chat.id===currentChat}">${escapeHTML(chat.title)}</button>`).join('');
}
function renderMessages({bottom=false}={}) {
  transcript.innerHTML = activeChat().messages.map((message,index)=>message.role==='user'
    ? `<article class="message user" aria-label="You"><div class="user-content">${escapeHTML(message.content)}</div></article>`
    : `<article class="message assistant" aria-label="Assistant"><div class="assistant-content">${message.content}</div><div class="message-actions"><button type="button" class="icon-button" data-copy="${index}" aria-label="Copy response">${svg('copy')}</button></div></article>`).join('');
  if (pending) transcript.insertAdjacentHTML('beforeend','<article class="message assistant" aria-label="Assistant"><div class="tool-activity" role="status">Searching</div></article>');
  if (bottom) scroll.scrollTop = scroll.scrollHeight;
  renderState();
}
function setVariant(next) {
  variant = next;
  const url = new URL(location.href);
  url.searchParams.set('variant',variant);
  history.replaceState(null,'',url);
  document.body.dataset.variant = variant;
  document.body.classList.remove('rail-open','rail-closed');
  document.getElementById('source-rail').classList.remove('is-closed');
  document.getElementById('variant-label').textContent = variants[variant];
  closeHistory();
  renderState();
}
function cycle(direction) {
  const keys = Object.keys(variants);
  setVariant(keys[(keys.indexOf(variant)+direction+keys.length)%keys.length]);
}
function closeHistory() {
  document.getElementById('history').classList.remove('is-open');
  document.querySelector('.drawer-backdrop').hidden = true;
  document.querySelector('.history-button').setAttribute('aria-expanded','false');
}
function cancelPending() {
  if (!pending) return;
  clearTimeout(pendingTimer);
  pending = false;
  renderMessages();
  updateComposer();
  document.getElementById('chat-status').textContent = 'Stopped';
}
function newChat() {
  cancelPending();
  currentChat = `chat-${Date.now()}`;
  chats.unshift({id:currentChat,title:'New chat',messages:[]});
  messageInput.value = '';
  closeHistory();
  closeEvidence();
  renderChats();
  renderMessages();
  updateComposer();
  messageInput.focus();
}
function updateComposer() {
  messageInput.style.height='auto';
  messageInput.style.height=`${Math.min(messageInput.scrollHeight,160)}px`;
  sendButton.disabled = !pending && !messageInput.value.trim();
  sendButton.setAttribute('aria-label',pending?'Stop response':'Send');
  sendButton.innerHTML=svg(pending?'stop':'arrow-up');
}
function showEvidence(id,anchor,focus=false) {
  const source=sources[id];
  sourceId=id;
  sourceAnchor=anchor;
  popover.innerHTML=`<div class="evidence-header"><h2>${source.title}</h2><button type="button" class="icon-button" data-action="close-evidence" aria-label="Close source">${svg('close')}</button></div><p class="evidence-meta">${source.origin} · ${source.locator}</p><p class="evidence-excerpt">${source.excerpt}</p><div class="evidence-links"><a href="${source.note}" target="_blank" rel="noopener">Open source</a>${source.pdf?`<a href="${source.pdf}" target="_blank" rel="noopener">Open PDF</a>`:''}</div>`;
  if (isPhone()) {popover.style.left='';popover.style.top='';popover.style.bottom='0';}
  else {
    const bounds=anchor.getBoundingClientRect();
    const left=Math.min(Math.max(bounds.left,12),innerWidth-362);
    const height=300;
    const top=bounds.bottom+10+height>innerHeight ? Math.max(12,bounds.top-height-10) : bounds.bottom+10;
    popover.style.left=`${left}px`;popover.style.top=`${top}px`;popover.style.bottom='auto';
  }
  if (!popover.matches(':popover-open')) popover.showPopover();
  if (focus) popover.focus({preventScroll:true});
  renderState();
}
function closeEvidence() {
  clearTimeout(hoverTimer);
  if (popover.matches(':popover-open')) popover.hidePopover();
  sourceId='';
  renderState();
}
const sourceItem = ([id,source]) => `<section class="source-item"><h3>${source.title}</h3><p>${source.origin}</p><button type="button" class="text-button" data-source="${id}">${source.locator}</button><a href="${source.note}" target="_blank" rel="noopener">Open source</a>${source.pdf?`<a href="${source.pdf}" target="_blank" rel="noopener">Open PDF</a>`:''}</section>`;
document.getElementById('rail-sources').innerHTML = Object.entries(sources).map(sourceItem).join('');
document.getElementById('library-sources').innerHTML = Object.entries(sources).map(sourceItem).join('');
document.getElementById('chat-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (pending) return cancelPending();
  const content=messageInput.value.trim();
  if (!content) return;
  const chat=activeChat();
  if (!chat.messages.length) chat.title=content.length>32?content.slice(0,32)+'…':content;
  chat.messages.push({role:'user',content});
  messageInput.value='';
  pending=true;
  document.getElementById('chat-status').textContent='';
  renderChats();renderMessages({bottom:true});updateComposer();
  pendingTimer=setTimeout(()=>{
    const response = /image|chart|figure|pdf/i.test(content)
      ? `${activity()}<p>The chart and study PDF are available below. ${citation('2025','1 · 2025 study')}</p>${image()}<div class="media-links"><a href="assets/reading-task-study.pdf#page=2" target="_blank" rel="noopener">${svg('file')}Reading task study.pdf</a></div>`
      : /why|explain|longer|think|cause/i.test(content) ? discussion : comparisons;
    chat.messages.push({role:'assistant',content:response});
    pending=false;
    renderMessages({bottom:true});updateComposer();
  },900);
});
messageInput.addEventListener('input',updateComposer);
messageInput.addEventListener('keydown',event=>{
  if(event.key==='Enter' && !event.shiftKey && !event.isComposing && !isPhone()) {event.preventDefault();document.getElementById('chat-form').requestSubmit();}
});
document.addEventListener('click',event=>{
  const source=event.target.closest('[data-source]');
  if(source) {showEvidence(source.dataset.source,source,true);return;}
  const chat=event.target.closest('[data-chat]');
  if(chat) {cancelPending();currentChat=chat.dataset.chat;closeHistory();closeEvidence();renderChats();renderMessages();return;}
  const copy=event.target.closest('[data-copy]');
  if(copy) {
    const node=document.createElement('div');node.innerHTML=activeChat().messages[Number(copy.dataset.copy)].content;
    navigator.clipboard?.writeText(node.textContent).then(()=>{document.getElementById('chat-status').textContent='Copied';});return;
  }
  const button=event.target.closest('[data-action]');
  if(!button) return;
  const action=button.dataset.action;
  if(action==='previous') cycle(-1);
  if(action==='next') cycle(1);
  if(action==='new-chat') newChat();
  if(action==='history') {const history=document.getElementById('history');const open=!history.classList.contains('is-open');history.classList.toggle('is-open',open);document.querySelector('.drawer-backdrop').hidden=!open;button.setAttribute('aria-expanded',String(open));if(open)history.querySelector('button').focus();}
  if(action==='close-history') closeHistory();
  if(action==='close-evidence') {closeEvidence();sourceAnchor?.focus({preventScroll:true});}
  if(action==='image') {document.getElementById('image-dialog').showModal();}
  if(action==='close-image') document.getElementById('image-dialog').close();
  if(action==='sources') document.getElementById('sources-dialog').showModal();
  if(action==='close-library') document.getElementById('sources-dialog').close();
  if(action==='source-rail') {
    if(isPhone()){document.getElementById('sources-dialog').showModal();return;}
    if(variant==='C'){document.body.classList.remove('rail-closed');document.getElementById('source-rail').classList.remove('is-closed');}
    else document.body.classList.toggle('rail-open');
    button.setAttribute('aria-expanded',String(!document.body.classList.contains('rail-closed')&&(variant==='C'||document.body.classList.contains('rail-open'))));
  }
  if(action==='close-sources') {document.body.classList.remove('rail-open');if(variant==='C'){document.body.classList.add('rail-closed');document.getElementById('source-rail').classList.add('is-closed');}}
  if(action==='signout') {document.getElementById('chat-status').textContent='Prototype. No signed-in session.';}
});
document.addEventListener('pointerover',event=>{
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  const citationButton=event.target.closest('.citation');
  if(citationButton){clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>showEvidence(citationButton.dataset.source,citationButton),280);}
  if(event.target.closest('#evidence')) clearTimeout(hoverTimer);
});
document.addEventListener('pointerout',event=>{
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if(event.target.closest('.citation,#evidence')&&!event.relatedTarget?.closest('.citation,#evidence')) {clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(!popover.contains(document.activeElement))closeEvidence();},500);}
});
popover.addEventListener('toggle',event=>{if(event.newState==='closed'){sourceId='';renderState();}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape') closeHistory();
  if(event.target.closest('input,textarea,[contenteditable="true"]')) return;
  if(event.key==='ArrowLeft') cycle(-1);
  if(event.key==='ArrowRight') cycle(1);
});
function resizeViewport() {
  if(window.visualViewport?.scale===1) document.documentElement.style.setProperty('--viewport-height',`${window.visualViewport.height}px`);
  if(sourceId&&sourceAnchor) showEvidence(sourceId,sourceAnchor);
  renderState();
}
window.addEventListener('resize',resizeViewport);
window.visualViewport?.addEventListener('resize',resizeViewport);
if(new URLSearchParams(location.search).get('production')==='1') document.body.dataset.production='true';
stampIcons(document);
document.querySelector('.drawer-close').innerHTML=svg('close');
setVariant(variant);
renderChats();renderMessages();updateComposer();resizeViewport();
