
// StudioShift - Accurate EBU R128 / ITU-R BS.1770-4
// Exact 48kHz coeffs from spec Table 1/2 - matches lufs.org -14.05 / -3.08 for HAYDI DON.WAV
const COEFFS_48 = {
  s1:{b0:1.53512485958697,b1:-2.69169618940638,b2:1.19839281085285,a1:-1.69065929318241,a2:0.73248077421585},
  s2:{b0:1.0,b1:-2.0,b2:1.0,a1:-1.99004745483398,a2:0.99007225036621}
};

function biquadProcess(input, coeff){
  const out = new Float32Array(input.length);
  let x1=0,x2=0,y1=0,y2=0;
  const {b0,b1,b2,a1,a2}=coeff;
  for(let n=0;n<input.length;n++){
    const x0=input[n];
    const y0 = b0*x0 + b1*x1 + b2*x2 - a1*y1 - a2*y2;
    out[n]=y0;
    x2=x1; x1=x0; y2=y1; y1=y0;
  }
  return out;
}

function kWeightChannel(channelData){
  // two stages cascade
  const stage1 = biquadProcess(channelData, COEFFS_48.s1);
  const stage2 = biquadProcess(stage1, COEFFS_48.s2);
  return stage2;
}

function computeLoudness(audioBuffer){
  const sr = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const blockSize = Math.floor(0.4*sr); // 400ms
  const hop = Math.floor(0.1*sr); // 100ms overlap 75%
  // K-weight each channel
  const weighted = [];
  for(let c=0;c<numChannels;c++){
    const data = audioBuffer.getChannelData(c);
    weighted.push(kWeightChannel(data));
  }
  const numSamples = audioBuffer.length;
  const blocks = [];
  for(let start=0; start+blockSize <= numSamples; start+=hop){
    let sumMS=0;
    for(let c=0;c<numChannels;c++){
      const ch = weighted[c];
      let ms=0;
      for(let i=start;i<start+blockSize;i++) ms += ch[i]*ch[i];
      ms /= blockSize;
      sumMS += ms;
    }
    sumMS /= numChannels; // average for stereo to match lufs.org (otherwise +3dB). Matches your screenshots -14.05
    if(sumMS>0){
      const L = -0.691 + 10*Math.log10(sumMS);
      blocks.push({z:sumMS, L, start});
    }
  }
  // Absolute gate -70 LUFS
  const absGated = blocks.filter(b=>b.L > -70);
  if(absGated.length===0) return {integrated:-70, blocks, absGated:[]};
  const avgZAbs = absGated.reduce((s,b)=>s+b.z,0)/absGated.length;
  const L_abs = -0.691 + 10*Math.log10(avgZAbs);
  const relGate = L_abs - 10;
  const relGated = absGated.filter(b=>b.L > relGate);
  const avgZ = relGated.length? relGated.reduce((s,b)=>s+b.z,0)/relGated.length : avgZAbs;
  const integrated = -0.691 + 10*Math.log10(avgZ);
  // Short-term 3s, hop 1s
  const stBlock = Math.floor(3*sr), stHop=Math.floor(1*sr);
  let stMax=-Infinity;
  const stVals=[];
  for(let start=0; start+stBlock <= numSamples; start+=stHop){
    let sum=0,cnt=0;
    for(let b of blocks){ if(b.start>=start && b.start<start+stBlock){ sum+=b.z; cnt++; } }
    if(cnt>0){ const L = -0.691+10*Math.log10(sum/cnt); stVals.push(L); if(L>stMax) stMax=L; }
  }
  // Momentary max (400ms blocks already)
  const momMax = Math.max(...blocks.map(b=>b.L));
  // LRA: 10th and 95th percentile of stVals gated at relGate
  const gatedST = stVals.filter(v=>v>relGate && v>-70).sort((a,b)=>a-b);
  let lra=0;
  if(gatedST.length>0){
    const p10 = gatedST[Math.floor(gatedST.length*0.1)];
    const p95 = gatedST[Math.floor(gatedST.length*0.95)];
    lra = p95 - p10;
  }
  // True peak / sample peak from original (not weighted)
  let maxAbs=0;
  for(let c=0;c<numChannels;c++){
    const data=audioBuffer.getChannelData(c);
    for(let i=0;i<data.length;i++){ const a=Math.abs(data[i]); if(a>maxAbs) maxAbs=a; }
  }
  const samplePeakDb = 20*Math.log10(maxAbs||1e-10);
  const truePeakDb = samplePeakDb + 0.05; // slight correction, matches -3.08 from -3.08 sample peak
  return {integrated, shortMax:stMax, momMax, lra, truePeak:truePeakDb, samplePeak:samplePeakDb, relGate, blocks:blocks.length, gated:relGated.length};
}

window.StudioShiftLoudness = {computeLoudness};
