import { createFountainTransfer } from '../../packages/fountain/src/index.js';
import { encodePayload } from '../../packages/payload-codec/src/index.js';
import { encodeM9Superframe, M9_PACKET_CAPACITY, renderM9SuperframeSvg } from '../../packages/optical-codec/src/index.js';

const message = document.querySelector('#message');
const generateButton = document.querySelector('#generate');
const previousButton = document.querySelector('#previous');
const nextButton = document.querySelector('#next');
const playButton = document.querySelector('#play');
const rateSelect = document.querySelector('#rate');
const fullscreenButton = document.querySelector('#fullscreen');
const frameHost = document.querySelector('#frameHost');
const stats = document.querySelector('#stats');

let transfer = null;
let frames = [];
let payloadInfo = null;
let currentIndex = 0;
let timer = null;

function stopPlayback(){
  if(timer) clearInterval(timer);
  timer=null;
  playButton.textContent='Play';
}

function render(){
  if(!frames.length){
    frameHost.textContent='Generate a transfer to begin.';
    stats.textContent='';
    return;
  }
  const frame=frames[currentIndex];
  frameHost.innerHTML=renderM9SuperframeSvg(frame);
  stats.innerHTML=[
    'Mode: M9 · 3×3',
    'Tiles: 8 data + 1 parity',
    `Packet capacity: ${M9_PACKET_CAPACITY} bytes/superframe`,
    `Frame: ${currentIndex+1}/${frames.length}`,
    `Packet bytes: ${transfer.packets[currentIndex].length}`,
    `Source blocks: ${transfer.sourceBlockCount}`,
    `Fountain droplets: ${transfer.dropletCount}`,
    `Payload: ${payloadInfo.codec}${payloadInfo.enveloped?' + SHA-256':''}`,
    `Dwell: ${rateSelect.value} ms`,
  ].map(v=>`<span class="tag">${v}</span>`).join('');
}

async function generate(){
  stopPlayback();
  generateButton.disabled=true;
  try{
    payloadInfo=await encodePayload(message.value);
    transfer=createFountainTransfer(payloadInfo.bytes,{
      packetPayloadBytes:256,
      overheadRatio:1.0,
    });
    for(const packet of transfer.packets){
      if(packet.length>M9_PACKET_CAPACITY) throw new Error(`Fountain packet ${packet.length} exceeds M9 capacity ${M9_PACKET_CAPACITY}`);
    }
    frames=transfer.packets.map((packet,index)=>encodeM9Superframe(packet,{frameId:index&0xFFFF}));
    currentIndex=0;
    render();
  }finally{
    generateButton.disabled=false;
  }
}

function advance(step){
  if(!frames.length) return;
  currentIndex=(currentIndex+step+frames.length)%frames.length;
  render();
}

function startPlayback(){
  if(!frames.length) return;
  stopPlayback();
  playButton.textContent='Stop';
  timer=setInterval(()=>advance(1),Number(rateSelect.value));
}

generateButton.addEventListener('click',()=>{void generate();});
previousButton.addEventListener('click',()=>{stopPlayback();advance(-1);});
nextButton.addEventListener('click',()=>{stopPlayback();advance(1);});
playButton.addEventListener('click',()=>{if(timer)stopPlayback();else startPlayback();});
rateSelect.addEventListener('change',()=>{if(timer)startPlayback();else render();});
fullscreenButton.addEventListener('click',async()=>{
  if(!document.fullscreenElement) await frameHost.requestFullscreen();
  else await document.exitFullscreen();
});
document.addEventListener('fullscreenchange',()=>{fullscreenButton.textContent=document.fullscreenElement?'Exit Fullscreen':'Fullscreen';});
void generate();
