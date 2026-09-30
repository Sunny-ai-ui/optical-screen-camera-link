import { decodePacket, FRAME_TYPES, PacketError } from '../../packages/protocol/src/index.js';
import { FountainReassembler } from '../../packages/fountain/src/index.js';
import { decodePayload } from '../../packages/payload-codec/src/index.js';
import { M9_RENDER_LAYOUT, recoverM9Packet } from '../../packages/optical-codec/src/index.js';
import { describeCameraError, listVideoInputs, openCameraWithFallback } from '../receiver-web/camera.js';
import { drawAutoFiducialOverlay, drawVideoFrame } from '../receiver-web/vision.js';
import { rectifyV3LogicalRoi, trackOrAcquireV3Fiducials } from '../receiver-v3/vision-v3.js';

const M9_PROFILE={
  totalSize:M9_RENDER_LAYOUT.totalSize,
  quietZone:M9_RENDER_LAYOUT.quietZone,
  logicalSize:M9_RENDER_LAYOUT.logicalSize,
  gridSize:M9_RENDER_LAYOUT.logicalSize/M9_RENDER_LAYOUT.tileCellSize,
};

const video=document.querySelector('#video');
const source=document.querySelector('#source');
const highSource=document.querySelector('#highSource');
const roi=document.querySelector('#roi');
const startButton=document.querySelector('#start');
const stopButton=document.querySelector('#stop');
const resetButton=document.querySelector('#reset');
const cameraSelect=document.querySelector('#cameraSelect');
const showRoi=document.querySelector('#showRoi');
const roiPanel=document.querySelector('#roiPanel');
const cameraState=document.querySelector('#cameraState');
const trackingState=document.querySelector('#trackingState');
const decodeState=document.querySelector('#decodeState');
const transferState=document.querySelector('#transferState');
const metricsHost=document.querySelector('#metrics');
const output=document.querySelector('#output');
const logHost=document.querySelector('#log');

let stream=null;
let running=false;
let timer=null;
let lastDetection=null;
let detectorMisses=0;
let worker=null;
let workerBusy=false;
let workerSeq=0;
let decoderLatency=0;
let currentFrameId=null;
let currentPacketLength=0;
let tileCache=new Map();
let acceptedFrameId=null;
let fountain=new FountainReassembler();
let lastSession=null;
let firstAcceptedAt=null;
let completedAt=null;
const metrics={
  samples:0,tracked:0,global:0,misses:0,headers:0,tilesDecoded:0,tileFailures:0,
  parityRecoveries:0,packetsAccepted:0,duplicates:0,workerSkips:0,rotation:0,headerContrast:0,
  currentFrame:'—',cachedTiles:0,lastFailures:'—',fountainProgress:0,recoveredBlocks:0,sourceBlocks:0,
  payloadIntegrity:'—',
};

function log(message){
  const row=document.createElement('div');row.textContent=`[${new Date().toLocaleTimeString()}] ${message}`;
  logHost.prepend(row);while(logHost.children.length>35)logHost.lastElementChild.remove();
}
function pill(el,text,kind=''){el.textContent=text;el.className=`pill ${kind}`;}
function renderMetrics(){
  const values=[
    ['Camera samples',metrics.samples],['Tracked frames',metrics.tracked],['Global acquires',metrics.global],
    ['Tracker misses',metrics.misses],['Header locks',metrics.headers],['Current frame',metrics.currentFrame],
    ['Cached tiles',`${metrics.cachedTiles}/9`],['Tiles decoded total',metrics.tilesDecoded],
    ['Tile failures',metrics.tileFailures],['Last failed tiles',metrics.lastFailures],
    ['Parity recoveries',metrics.parityRecoveries],['Packets accepted',metrics.packetsAccepted],
    ['Duplicates',metrics.duplicates],['Decoder latency',decoderLatency?`${decoderLatency.toFixed(0)} ms`:'—'],
    ['Worker skips',metrics.workerSkips],['Rotation',`${metrics.rotation}°`],
    ['Header contrast',metrics.headerContrast?metrics.headerContrast.toFixed(1):'—'],
    ['Fountain progress',metrics.sourceBlocks?`${(metrics.fountainProgress*100).toFixed(1)}%`:'—'],
    ['Recovered blocks',metrics.sourceBlocks?`${metrics.recoveredBlocks}/${metrics.sourceBlocks}`:'—'],
    ['Payload integrity',metrics.payloadIntegrity],
  ];
  metricsHost.innerHTML=values.map(([k,v])=>`<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join('');
}
function resetFrameCache(frameId=null,packetLength=0){
  currentFrameId=frameId;currentPacketLength=packetLength;tileCache=new Map();acceptedFrameId=null;
  metrics.currentFrame=frameId??'—';metrics.cachedTiles=0;
}
function resetTransfer(){
  fountain=new FountainReassembler();lastSession=null;firstAcceptedAt=null;completedAt=null;
  resetFrameCache();metrics.packetsAccepted=0;metrics.duplicates=0;metrics.parityRecoveries=0;
  metrics.fountainProgress=0;metrics.recoveredBlocks=0;metrics.sourceBlocks=0;metrics.payloadIntegrity='—';
  output.textContent='Waiting for M9 fountain transfer…';pill(transferState,'Waiting');renderMetrics();log('M9 transfer reset.');
}
async function refreshCameras(preferred=''){
  const devices=await listVideoInputs(navigator.mediaDevices);const previous=preferred||cameraSelect.value;
  cameraSelect.innerHTML='';for(const [index,d] of devices.entries()){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Camera ${index+1}`;cameraSelect.append(o);}
  cameraSelect.disabled=!devices.length;if(previous&&devices.some(d=>d.deviceId===previous))cameraSelect.value=previous;
}
function ensureWorker(){
  if(worker)return;worker=new Worker('./m9-decoder-worker.js',{type:'module'});
}
function decodeInWorker(imageData,unresolved){
  ensureWorker();if(workerBusy)return Promise.resolve(null);workerBusy=true;const id=++workerSeq;const started=performance.now();
  return new Promise((resolve,reject)=>{
    const handler=(event)=>{if(event.data?.id!==id)return;worker.removeEventListener('message',handler);workerBusy=false;decoderLatency=performance.now()-started;if(event.data.ok)resolve(event.data.result);else reject(Object.assign(new Error(event.data.error?.message||'M9 worker failed'),event.data.error||{}));};
    worker.addEventListener('message',handler);worker.postMessage({id,imageData,unresolvedTileIndexes:unresolved},[imageData.data.buffer]);
  });
}
async function finishPayload(){
  const data=fountain.getData();if(!data)return;
  try{const payload=await decodePayload(data);metrics.payloadIntegrity=payload.verified===true?'SHA-256 verified':'transport CRC32';output.textContent=payload.text;pill(transferState,`Complete · ${payload.originalBytes} bytes · ${metrics.payloadIntegrity}`,'good');log(`M9 fountain transfer complete: ${payload.originalBytes} bytes; ${metrics.payloadIntegrity}.`);}
  catch(error){metrics.payloadIntegrity='verification failed';pill(transferState,'Payload verification failed','bad');log(error.message);}
  renderMetrics();
}
function acceptPacket(packetBytes){
  let decoded;try{decoded=decodePacket(packetBytes);}catch(error){if(error instanceof PacketError)log(`M9 packet rejected: ${error.code}`);return false;}
  if(decoded.frameType!==FRAME_TYPES.FOUNTAIN)return false;
  if(lastSession!==null&&decoded.sessionId!==lastSession){fountain=new FountainReassembler();lastSession=null;firstAcceptedAt=null;completedAt=null;}
  lastSession=decoded.sessionId;
  try{
    const status=fountain.addPacket(packetBytes);
    if(status.event==='duplicate'){metrics.duplicates+=1;return true;}
    metrics.packetsAccepted+=1;if(firstAcceptedAt===null)firstAcceptedAt=performance.now();
    metrics.fountainProgress=status.progress??0;metrics.recoveredBlocks=status.recoveredSourceBlocks??0;metrics.sourceBlocks=status.sourceBlockCount??0;
    pill(transferState,`Fountain ${decoded.sessionId} · ${metrics.recoveredBlocks}/${metrics.sourceBlocks||'?'} blocks`,'work');
    if(status.complete){completedAt=performance.now();void finishPayload();}
    return true;
  }catch(error){log(`Fountain reject: ${error.message}`);return false;}
}
async function processObservation(result){
  if(!result)return;
  const {header,decodedTiles,failures}=result;metrics.headers+=1;metrics.rotation=header.rotation;metrics.headerContrast=header.contrast;
  if(currentFrameId!==header.frameId){resetFrameCache(header.frameId,header.packetLength);}
  for(const tile of decodedTiles){if(!tileCache.has(tile.tileIndex)){tileCache.set(tile.tileIndex,tile);metrics.tilesDecoded+=1;}}
  metrics.tileFailures+=failures.length;metrics.lastFailures=failures.length?failures.map(f=>f.tileIndex).join(','):'—';metrics.cachedTiles=tileCache.size;
  if(acceptedFrameId===header.frameId){pill(decodeState,`Frame ${header.frameId} accepted · waiting next`,'good');return;}
  const hasAllData=Array.from({length:8},(_,i)=>tileCache.has(i)).every(Boolean);
  const missingData=Array.from({length:8},(_,i)=>i).filter(i=>!tileCache.has(i));
  const canRecover=hasAllData||(missingData.length===1&&tileCache.has(8));
  if(!canRecover){pill(decodeState,`Frame ${header.frameId} · tiles ${tileCache.size}/9`,'work');return;}
  try{
    const recovered=recoverM9Packet([...tileCache.values()],header.packetLength);
    if(recovered.recoveredTileIndex!==null)metrics.parityRecoveries+=1;
    if(acceptPacket(recovered.packetBytes)){acceptedFrameId=header.frameId;pill(decodeState,`Frame ${header.frameId} packet OK`,'good');}
  }catch(error){pill(decodeState,'M9 packet assembly failed','bad');log(error.message);}
}
function nextDelay(){return workerBusy?Math.max(250,Math.min(1200,decoderLatency*0.8||600)):120;}
function schedule(delay=nextDelay()){if(running)timer=setTimeout(loop,delay);}
async function loop(){
  if(!running||video.readyState<2){schedule();return;}
  let scheduled=false;
  try{
    metrics.samples+=1;drawVideoFrame(video,source);const detection=trackOrAcquireV3Fiducials(source,lastDetection);
    if(!detection){detectorMisses+=1;metrics.misses+=1;if(detectorMisses>=3)lastDetection=null;pill(trackingState,'Searching 4 locators','work');drawAutoFiducialOverlay(source,null,'searching');renderMetrics();schedule();return;}
    detectorMisses=0;lastDetection=detection;if(detection.mode==='tracked'){metrics.tracked+=1;pill(trackingState,'4 locators tracked','good');}else{metrics.global+=1;pill(trackingState,'4 locators acquired','work');}
    rectifyV3LogicalRoi(video,source,detection,highSource,roi,M9_PROFILE);
    if(workerBusy){metrics.workerSkips+=1;schedule();return;}
    const imageData=roi.getContext('2d',{willReadFrequently:true}).getImageData(0,0,768,768);
    const unresolved=acceptedFrameId===currentFrameId?[]:Array.from({length:9},(_,i)=>i).filter(i=>!tileCache.has(i));
    const promise=decodeInWorker(imageData,unresolved);schedule();scheduled=true;const result=await promise;await processObservation(result);drawAutoFiducialOverlay(source,detection,acceptedFrameId===currentFrameId?'decoded':'found');
  }catch(error){pill(decodeState,error.code==='M9_HEADER_NOT_FOUND'?'Searching M9 header':'M9 decode error','work');}
  renderMetrics();if(!scheduled)schedule();
}
async function startCamera(){
  if(running)return;startButton.disabled=true;pill(cameraState,'Requesting camera…','work');
  try{
    const opened=await openCameraWithFallback(navigator.mediaDevices,cameraSelect.value||'',label=>pill(cameraState,`Trying ${label}…`,'work'));
    stream=opened.stream;video.srcObject=stream;await video.play();running=true;stopButton.disabled=false;const settings=stream.getVideoTracks()[0]?.getSettings?.()||{};await refreshCameras(settings.deviceId||'');pill(cameraState,`${video.videoWidth}×${video.videoHeight} active`,'good');ensureWorker();schedule(0);log('M9 camera started.');
  }catch(error){startButton.disabled=false;pill(cameraState,describeCameraError(error).title,'bad');}
}
function stopCamera(){running=false;if(timer)clearTimeout(timer);if(stream)for(const t of stream.getTracks())t.stop();stream=null;video.srcObject=null;startButton.disabled=false;stopButton.disabled=true;pill(cameraState,'Stopped');}
startButton.addEventListener('click',startCamera);stopButton.addEventListener('click',stopCamera);resetButton.addEventListener('click',resetTransfer);
showRoi.addEventListener('change',()=>{roiPanel.hidden=!showRoi.checked;});cameraSelect.addEventListener('change',()=>{if(running){stopCamera();void startCamera();}});
window.addEventListener('beforeunload',stopCamera);resetTransfer();void refreshCameras();
