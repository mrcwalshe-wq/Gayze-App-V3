import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { loadModule } from '../recovery-tests/load-module.mjs';

const dom=new JSDOM('<!doctype html><html><body></body></html>', {url:'https://gayze.co.uk/', pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','localStorage']) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,cleanup,fireEvent,waitFor}=await import('@testing-library/react');
afterEach(cleanup);
const user='00000000-0000-4000-8000-000000000001';
const id='10000000-0000-4000-8000-000000000001';
const room='20000000-0000-4000-8000-000000000001';

function worker(receipts=new Map()) {
  const events={},shown=[],messages=[],opened=[];
  let windows=[];
  const self={location:new URL('https://gayze.co.uk/service-worker.js'),navigator:{},
    addEventListener(type,handler){events[type]=handler;},
    registration:{async showNotification(title,options){shown.push({title,options});}},
    clients:{async matchAll(){return windows;},async openWindow(url){opened.push(url);}},
  };
  const cache={async match(key){return receipts.get(String(key));},async put(key,value){receipts.set(String(key),value);},async keys(){return [...receipts.keys()];},async delete(key){return receipts.delete(String(key));}};
  vm.runInNewContext(readFileSync('public/service-worker.js','utf8'),{self,caches:{open:async()=>cache},URL,Response,Request,MessageChannel,setTimeout,clearTimeout,console});
  return {shown,messages,opened,setForeground(){windows=[{url:'https://gayze.co.uk/',focus:async()=>{},postMessage(value,ports){messages.push(value);ports?.[0]?.postMessage({handled:true});ports?.[0]?.close();}}];},
    async fire(type,data){let work;events[type]({waitUntil(p){work=p;},...data});await work;}};
}

test('real worker shows Gayze/message, quietly replaces replay across restart and routes warm/cold clicks',async()=>{
  const receipts=new Map(),w=worker(receipts);
  const payload={type:'gaze',notificationId:id,url:`/notifications?notification=${id}`,tag:`gayze-${id}`};
  await Promise.all([w.fire('push',{data:{json:()=>payload}}),w.fire('push',{data:{json:()=>payload}})]);
  assert.equal(w.shown.length,2); assert.equal(w.shown[0].title,'New Gayze');
  assert.equal(w.shown[0].options.tag,w.shown[1].options.tag);assert.equal(w.shown[1].options.silent,true);
  const restarted=worker(receipts);await restarted.fire('push',{data:{json:()=>payload}});assert.equal(restarted.shown.length,1);assert.equal(restarted.shown[0].options.silent,true);
  await w.fire('notificationclick',{notification:{data:w.shown[0].options.data,close(){}}});
  assert.equal(w.opened[0],`https://gayze.co.uk/notifications?notification=${id}`);
  w.setForeground();
  await w.fire('push',{data:{json:()=>({type:'message',notificationId:room,url:`/messages/${room}?notification=${room}`})}});
  assert.equal(w.shown.length,3);assert(w.messages.some(m=>m.type==='PUSH_RECEIVED'));
  await w.fire('notificationclick',{notification:{data:w.shown[2].options.data,close(){}}});
  assert.equal(w.messages.at(-1).url,`/messages/${room}?notification=${room}`);
  await w.fire('notificationclick',{notification:{data:{type:'gaze',url:'https://evil.example'},close(){}}});
  assert.equal(w.messages.at(-1).url,'/notifications');
});

test('notification destinations survive login reload and reject off-origin/auth callbacks',async()=>{
  const routes=await loadModule('src/services/notificationRouting.ts');
  window.sessionStorage.clear();
  routes.rememberNotificationPath(`/messages/${room}?notification=${id}`);
  window.history.replaceState({},'', '/auth/callback');
  const path=routes.consumeNotificationPath();assert.equal(path,`/messages/${room}?notification=${id}`);
  assert.deepEqual(routes.routeFromPath(path),{tab:'swarms',conversationId:room});
  assert.equal(routes.consumeNotificationPath(),null);
  routes.rememberNotificationPath('https://evil.example/notifications');assert.equal(routes.consumeNotificationPath(),null);
  routes.rememberNotificationPath('/auth/callback?notification='+id);assert.equal(routes.consumeNotificationPath(),null);
  assert.deepEqual(routes.routeFromPath('/notifications'),{tab:'profile',openNotifications:true});
  window.history.replaceState({},'','/');
});

test('notification list renders database unread state and opens the selected stable record',async()=>{
  const backend={auth:{async getSession(){return {data:{session:null}};}}};
  const {NotificationsModal}=await loadModule('src/components/NotificationsModal.tsx',backend);
  const notice={id,user_id:user,actor_id:null,category:'gaze',created_at:new Date().toISOString(),read_at:null,url:'/notifications'};
  const opened=[];
  const props={isOpen:true,onClose(){},inboxStatus:'connected',inbox:{rows:[notice],unread:1,messageUnread:0},onOpenNotification:n=>opened.push(n.id)};
  const ui=render(React.createElement(NotificationsModal,props));
  await waitFor(()=>assert(ui.container.textContent.includes('1 unread')));
  fireEvent.click(ui.getByRole('button',{name:'Unread: Someone sent you a Gayze'}));assert.deepEqual(opened,[id]);
  assert(ui.container.textContent.includes('1 unread'),'click alone must not locally clear DB state');
  ui.rerender(React.createElement(NotificationsModal,{...props,inbox:{rows:[{...notice,read_at:new Date().toISOString()}],unread:0,messageUnread:0}}));
  assert(ui.container.textContent.includes('0 unread'));assert(ui.getByRole('button',{name:'Read: Someone sent you a Gayze'}));
  ui.rerender(React.createElement(NotificationsModal,{...props,inboxStatus:'offline'}));
  assert(ui.container.textContent.includes('Saved notifications are retained'));assert(ui.getByRole('button',{name:'Unread: Someone sent you a Gayze'}));
});

test('actual PushManager registration stores the authenticated owner and replaces an unowned endpoint',async()=>{
  const persisted=[],registered=[];let revoked=0,subscribed=0;
  const fresh={endpoint:'https://fcm.googleapis.com/new',getKey:()=>new Uint8Array([1,2,3]).buffer};
  const old={endpoint:'https://fcm.googleapis.com/old',async unsubscribe(){revoked++;return true;}};
  const registration={pushManager:{async getSubscription(){return old;},async subscribe(options){subscribed++;assert.equal(options.userVisibleOnly,true);return fresh;}}};
  const oldSW=Object.getOwnPropertyDescriptor(navigator,'serviceWorker');
  const oldNotification=window.Notification;
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async(...args)=>{registered.push(args);return registration;},ready:Promise.resolve(registration)}});
  window.PushManager=class {};
  window.Notification={permission:'granted',async requestPermission(){return 'granted';}};
  globalThis.Notification=window.Notification;
  const backend={auth:{async getSession(){return {data:{session:{user:{id:user}}}};}},from(table){assert.equal(table,'push_subscriptions');return {
    select(){return this;},eq(){return this;},async maybeSingle(){return {data:persisted.length ? {id:'owned-registration',...persisted.at(-1)} : null,error:null};},async upsert(value){persisted.push(value);return {error:null};},
  };}};
  try{
    const service=await loadModule('src/services/pushService.ts',backend,{VITE_VAPID_PUBLIC_KEY:Buffer.from([4, ...new Uint8Array(64).fill(1)]).toString('base64url')});
    assert.equal((await service.subscribeToPush()).ok,true);assert.equal(revoked,1);assert.equal(subscribed,1);
    assert.deepEqual(registered,[['/service-worker.js',{scope:'/'}]]);assert.equal(persisted[0].user_id,user);assert.equal(persisted[0].endpoint,fresh.endpoint);
    assert(!JSON.stringify(persisted).includes('PRIVATE'));
  }finally{
    if(oldSW)Object.defineProperty(navigator,'serviceWorker',oldSW);else delete navigator.serviceWorker;
    delete window.PushManager;window.Notification=oldNotification;delete globalThis.Notification;
  }
});

test('inbox uses database pagination/counts, receives new rows and ignores late callbacks after stop',async()=>{
  let stateRows=[{id,user_id:user,actor_id:null,category:'gaze',url:'/notifications',created_at:new Date().toISOString(),read_at:null}];
  const channels=[],results=[],states=[];
  const backend={auth:{async getSession(){return {data:{session:{user:{id:user},expires_at:Date.now()/1000+3600}},error:null};},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}},
    realtime:{async disconnect(){},connect(){}},
    channel(){const channel={on(_type,_filter,cb){channel.change=cb;return channel;},subscribe(cb){channel.status=cb;queueMicrotask(()=>cb('SUBSCRIBED'));return channel;},async unsubscribe(){},teardown(){}};channels.push(channel);return channel;},
    from(table){assert.equal(table,'gayze_notifications');let head=false,cursor=false,messageOnly=false;const q={
      select(_fields,opts){head=opts?.head;return q;},eq(field,value){if(field==='category')messageOnly=value==='message';return q;},order(){return q;},limit(){return q;},is(){return q;},or(){cursor=true;return q;},
      async abortSignal(){return head?{count:stateRows.filter(r=>!r.read_at&&(!messageOnly||r.category==='message')).length,error:null}:{data:cursor?[]:stateRows,error:null};},
    };return q;},
  };
  const {watchNotificationInbox}=await loadModule('src/services/notificationInbox.ts',backend);
  const owner=watchNotificationInbox(user,value=>results.push(value),value=>states.push(value));
  try{
    await waitFor(()=>assert.equal(results.at(-1)?.unread,1));assert.equal(results.at(-1).messageUnread,0);
    stateRows=[...stateRows,{...stateRows[0],id:room,category:'message',url:`/messages/${room}`}];
    channels[0].change();
    await waitFor(()=>assert.equal(results.at(-1)?.unread,2),{timeout:2500});assert.equal(results.at(-1).messageUnread,1);
    assert.equal(states.at(-1),'connected');const count=results.length;owner.stop();channels[0].change();channels[0].status('CLOSED');
    await new Promise(r=>setTimeout(r,200));assert.equal(results.length,count);
  }finally{owner.stop();}
});

test('two matching display names cannot redirect a Gayze to the wrong stable user; failed sends stay unconfirmed',async()=>{
  const {DiscoverView}=await loadModule('src/components/DiscoverView.tsx');
  const calls=[];let succeeds=false;
  const pulse={peerName:'Alex',intent:'Chat',description:'Say hello',expiresAt:Date.now()+60000,neighborhood:'London',approxDistanceKm:1};
  const props={profiles:[],pulses:[{...pulse,id:'supabase_'+id,peerId:user},{...pulse,id:'supabase_'+room,peerId:room}],userNeighborhood:'London',onOpenDirectChat(){},onOpenDirectChatWithProfile(){},
    async onGazeAtPeer(...args){calls.push(args);return succeeds;}};
  const ui=render(React.createElement(DiscoverView,props));
  fireEvent.click(ui.getAllByText('Alex')[1].closest('button'));
  fireEvent.click(ui.getByRole('button',{name:'Gaze'}));
  await waitFor(()=>assert.equal(calls.length,1));assert.deepEqual(calls[0],['Alex',room,room]);
  assert(!ui.getByRole('button',{name:'Gaze'}).textContent.includes('Gazed'));
  succeeds=true;fireEvent.click(ui.getByRole('button',{name:'Gaze'}));
  await waitFor(()=>assert(ui.getByRole('button',{name:'Gaze'}).textContent.includes('Gazed')));
});

test('navigation exposes the database notification total separately from message unread state',async()=>{
  const {Navbar}=await loadModule('src/components/Navbar.tsx');
  const props={activeTab:'profile',onTabChange(){},unreadCount:1,notificationCount:3,onOpenMask(){},onOpenIdentity(){},onOpenSafetyTimer(){},onOpenQR(){},isSafetyTimerActive:false};
  const ui=render(React.createElement(Navbar,props));
  assert(ui.getAllByLabelText('3 unread notifications').length>0);assert(ui.getAllByLabelText('1 unread messages').length>0);
  ui.rerender(React.createElement(Navbar,{...props,notificationCount:0,unreadCount:0}));
  assert.equal(ui.queryAllByLabelText(/unread notifications/).length,0);
});
