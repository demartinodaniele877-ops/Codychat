<?php
// Lightweight host page to embed mediasoup-based broadcaster/viewer
// Here we only pass-through parameters; your existing mediasoup app should handle room/peer based on uid.
// This page can be replaced by a more advanced integration.

// Inputs: uid (int), wss (string)
$uid = isset($_GET['uid']) ? (int) $_GET['uid'] : 0;
$wss = isset($_GET['wss']) ? $_GET['wss'] : '';
?>
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Public Cam</title>
  <style>
    html, body { margin:0; padding:0; height:100%; background:#000; }
    #app { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; }
    video { max-width:100%; max-height:100%; background:#000; }
    .ctrl { position:fixed; top:8px; right:8px; z-index:10 }
    .btn { background:#111; color:#fff; border:1px solid #444; padding:8px 10px; margin-left:6px; cursor:pointer }
  </style>
</head>
<body>
  <div class="ctrl">
    <button class="btn" onclick="window.parent.postMessage('endCall', window.origin)">Chiudi</button>
  </div>
  <div id="app">
    <video id="v" playsinline autoplay controls></video>
  </div>
  <script type="module">
  import * as mediasoupClient from 'https://cdn.jsdelivr.net/npm/mediasoup-client@3/+esm';
  import * as protooClient   from 'https://cdn.jsdelivr.net/npm/protoo-client@4/+esm';

  const params = new URLSearchParams(location.search);
  const uid   = params.get('uid') || String(Math.random()).slice(2);
  const room  = params.get('room') || ('public-' + uid);
  const wss   = params.get('wss') || '';
  const mode  = params.get('mode') || 'consume'; // 'produce' | 'consume'

  const video = document.getElementById('v');
  let device;
  let localStream;

  // Improve autoplay behavior on mobile/desktop
  video.muted = (mode === 'produce');
  video.playsInline = true;

  function ensureAutoplay(){
    const p = video.play();
    if(p && typeof p.catch === 'function'){
      p.catch(()=>{ video.muted = true; video.play().catch(()=>{}); });
    }
  }

  function protooUrl(){
    const url = new URL(wss);
    url.searchParams.set('roomId', room);
    url.searchParams.set('peerId', uid + '-' + mode + '-' + String(Math.random()).slice(2,8));
    return url.toString();
  }

  async function join(peer){
    const routerRtpCapabilities = await peer.request('getRouterRtpCapabilities');
    device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities });
    await peer.request('join', {
      displayName: String(uid),
      device: { name: navigator.userAgent },
      rtpCapabilities: device.rtpCapabilities,
      sctpCapabilities: { numStreams: { OS: 1024, MIS: 1024 } }
    });
  }

  async function produceFlow(peer){
    // Get local media first and show preview immediately
    try{
      if(!localStream){
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      }
      if(localStream){
        video.srcObject = localStream;
        ensureAutoplay();
      }
    }catch(e){ console.error('getUserMedia error', e); }

    const transportInfo = await peer.request('createWebRtcTransport', {
      forceTcp: false,
      producing: true,
      consuming: false,
      sctpCapabilities: { numStreams: { OS: 1024, MIS: 1024 } }
    });
    const sendTransport = device.createSendTransport(transportInfo);
    sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      peer.request('connectWebRtcTransport', {
        transportId: sendTransport.id, dtlsParameters
      }).then(callback).catch(errback);
    });
    sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try{
        const { id } = await peer.request('produce', {
          transportId: sendTransport.id,
          kind, rtpParameters, appData: { mediaTag: 'cam' }
        });
        callback({ id });
      }catch (e){ errback(e); }
    });

    const stream = localStream || await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    ensureAutoplay();
    const trackV = stream.getVideoTracks()[0];
    const trackA = stream.getAudioTracks()[0];
    if(trackV) await sendTransport.produce({ track: trackV });
    if(trackA) await sendTransport.produce({ track: trackA });
  }

  async function consumeFlow(peer){
    const transportInfo = await peer.request('createWebRtcTransport', {
      forceTcp: false,
      producing: false,
      consuming: true,
      sctpCapabilities: { numStreams: { OS: 1024, MIS: 1024 } }
    });
    const recvTransport = device.createRecvTransport(transportInfo);
    recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      peer.request('connectWebRtcTransport', {
        transportId: recvTransport.id, dtlsParameters
      }).then(callback).catch(errback);
    });

    const consumers = [];
    async function consumeProducer(producerId){
      try{
        const { id, kind, rtpParameters } = await peer.request('consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
          transportId: recvTransport.id
        });
        const consumer = await recvTransport.consume({ id, kind, rtpParameters });
        consumers.push(consumer);
        const ms = new MediaStream();
        ms.addTrack(consumer.track);
        // merge tracks from multiple consumers
        const cur = video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream();
        cur.addTrack(consumer.track);
        video.srcObject = cur;
        ensureAutoplay();
        await peer.request('resumeConsumer', { consumerId: id }).catch(async ()=>{
          // some servers use 'resume'
          try{ await peer.request('resume', { consumerId: id }); }catch(_){ }
        });
      }catch(e){ console.error('consume error', e); }
    }

    // Try to get current producers list
    try{
      const data = await peer.request('getProducers');
      if(Array.isArray(data)){
        for(const pid of data){ await consumeProducer(pid); }
      }
    }catch(_){ /* server may not support */ }

    peer.on('notification', async (notification) => {
      if(notification.method === 'newProducers' && Array.isArray(notification.data)){
        for(const p of notification.data){ await consumeProducer(p.id || p); }
      }
    });
  }

  async function run(){
    if(!wss){ console.error('Missing wss'); return; }
    const peer = new protooClient.Peer(protooUrl());
    peer.on('open', async () => {
      try{
        await join(peer);
        if(mode === 'produce') await produceFlow(peer);
        else await consumeFlow(peer);
      }catch(e){ console.error(e); }
    });
    peer.on('failed', () => console.error('protoo failed'));
    peer.on('disconnected', () => console.warn('protoo disconnected'));
    peer.on('close', () => console.warn('protoo closed'));
  }

  run();
  </script>
</body>
<scrip></scrip>
</html>
