/* METRO AFTER HOURS 2.0 — fictional engineering model, not a training vehicle. */
function upgradeMetro(html) {
  function change(from, to) { if (!html.includes(from)) throw Error('原版结构不匹配，未载入驾驶升级'); html = html.replace(from, to); }
  const begin = html.indexOf("let interlock=S.mode==='service'");
  const end = html.indexOf('if(S.s<-160)', begin);
  if (begin < 0 || end < begin) throw Error('未找到列车动力模块');
  html = html.slice(0, begin) + 'let oldS=S.s;physicsAdvance(S,dt);\n' + html.slice(end);
  change("S.s=-160;S.v=0;S.a=0;", "S.s=-160;S.u=0;S.v=0;S.a=0;");
  change("S.s=3990;S.v=0;", "S.s=3990;S.u=0;S.v=0;");
  change("S.v*=e.type==='obstacle'?.55:.9;", "S.v*=e.type==='obstacle'?.55:.9;S.u=S.v*(S.u<0?-1:1);");
  change('let aligned=Math.abs(st.s-S.s)<=6&&S.v<.12', 'let aligned=Math.abs(st.s-S.s)<=1.5&&S.v<.025');
  change('Math.abs(currentStation().s-S.s)>6', 'Math.abs(currentStation().s-S.s)>1.5');
  change("// Deterministic test hooks, deliberately limited to this local game state.", '(' + installMetroRealism.toString() + ')();\n// Deterministic test hooks, deliberately limited to this local game state.');
  // Physics uses <=1/120 s substeps and keeps real time down to 4 rendering FPS.
  change('let dt=Math.min(.05,Math.max(0,now-last));', 'let dt=Math.min(.25,Math.max(0,now-last));');
  change('let meshes=[scenery,dynamic];if(mirror', 'let meshes=[scenery,dynamic];const extras=window.MetroDriving?.renderExtras?.();if(extras?.tunnel)meshes.push(extras.tunnel);if(extras?.cab&&!mirror&&S.started&&S.view===0)meshes.push(extras.cab);if(mirror');
  change('停车误差在 ±6 米内可上下客，±1 米有额外奖励。', '停车误差在 ±1.5 米内可上下客，±1 米有额外奖励。停车不再自动吸附。');
  change('METRO / AFTER HOURS</div>', 'METRO / AFTER HOURS — DRIVE 2.0</div>');
  change('城市还没入睡，末班车即将出发。<br>握住驾驶手柄，穿过隧道与夜色，<br>把每一位乘客送往下一站。', '两百吨列车，不会随手柄瞬间响应。<br>建立牵引、切除动力、提前制动。<br>最后一米，交给你的手感。');
  change('const stations=', 'let physicsAdvance;\nconst stations=');
  return html;
}
function installMetroRealism() {
  const build='2.0.0';
  const f=(x,a,b)=>clamp((x-a)/(b-a),0,1), smooth=(x,a,b)=>{const y=f(x,a,b);return y*y*(3-2*y);};
  const follow=(x,to,dt,tau)=>x+(to-x)*(1-Math.exp(-dt/tau));
  const brakeLevels=[0,.13,.25,.40,.57,.74,.91,1.10];
  const powerLevels=[0,.18,.38,.67,1];
  const freshDrive=()=>({te:0,ed:0,bc:1.1,mr:8.3,compressor:false,control:-3,age:9,demand:.4,ax:0,jerk:0,slip:false,slide:false,atp:false,adh:.21,mass:0,grade:0,force:0,edForce:0,airForce:0,resist:0,contacts:false,pitch:0,pitchV:0,sway:0,swayV:0});
  S.drive=freshDrive();S.u=0;S.atoClock=0;S.tuning={cabMotion:true};S.eventCountdown=1e8;
  const oldCurve=curve;
  curve=function(s){let x=0;for(const [a,b,amp] of [[170,655,28],[1050,1545,-34],[1950,2510,40],[2970,3630,-43]]){if(s>a&&s<b){const t=(s-a)/(b-a);x+=amp*Math.pow(Math.sin(Math.PI*t),2);}}return x;};
  curveD=function(s){return (curve(s+.1)-curve(s-.1))/.2;};
  wp=function(x,y,s){const a=Math.atan(curveD(s));return [curve(s)+x*Math.cos(a),y+elevation(s),-s+x*Math.sin(a)];};
  function meanGrade(s){let g=0;for(let i=0;i<6;i++)g+=(elevation(s-i*18.7+1)-elevation(s-i*18.7-1))/2;return g/6;}
  function dynamics(q,dt){
    const D=q.drive, mass=204000+q.passengers*70, inertia=mass*1.06;
    const previous=q.u||0, speed=Math.abs(previous), wet=q.weather==='rain'&&!isTunnel(q.s);
    const mu=wet?.095:.21, grade=meanGrade(q.s), doorlock=q.mode==='service'&&(q.doors.L>.001||q.doors.R>.001||q.doorTargets.L||q.doorTargets.R);
    const powered=q.event?.type!=='power';
    if(D.control!==q.notch){const sameRange=(D.control>0&&q.notch>0)||(D.control<0&&q.notch<0);if(!sameRange)D.age=0;D.control=q.notch;}D.age+=dt;
    const lim=q===S?limit():q.predictLimit||80;
    if(q.mode==='service'){if(speed*3.6>lim+2)D.atp=true;else if(speed*3.6<Math.max(0,lim-1))D.atp=false;}else D.atp=false;
    let requested=q.emergency?1.38:D.atp?1.03:brakeLevels[Math.max(0,-q.notch)];
    if(doorlock)requested=Math.max(requested,.35);
    // Delayed brake demand, distinct electric braking and pressure-controlled friction braking.
    if(q.notch<0&&D.age<.28&&!q.emergency&&!D.atp)requested=Math.min(requested,D.demand);
    D.demand+=clamp(requested-D.demand,-1.15*dt,(q.emergency?2.5:.8)*dt);
    const demandForce=D.demand*inertia;
    const edCapacity=powered&&!q.emergency?Math.min(220000,3400000/Math.max(speed,1))*smooth(speed,.7,3.8):0;
    const edTarget=Math.min(demandForce,edCapacity);
    D.ed=follow(D.ed,edTarget,dt,edTarget>D.ed?.22:.14);
    const desiredBC=clamp((demandForce-D.ed)/inertia/1.38*3.8,0,3.8);
    const prevBC=D.bc;
    D.bc=follow(D.bc,desiredBC,dt,q.emergency?.28:desiredBC>D.bc?.58:.82);
    if(D.bc<.003)D.bc=0;
    D.mr-=Math.max(0,D.bc-prevBC)*.1;
    if(D.mr<7.6)D.compressor=true;if(D.mr>8.5)D.compressor=false;
    if(D.compressor)D.mr=Math.min(8.55,D.mr+dt*.048);
    const canPower=q.notch>0&&D.age>.42&&!doorlock&&!q.emergency&&!D.atp&&powered&&D.bc<.22&&D.demand<.04;
    const requestedTE=canPower?powerLevels[q.notch]*Math.min(258000,3800000/Math.max(speed,1))*clamp((28-speed)/3,0,1):0;
    const teGrip=mass*9.81*mu*.66;
    D.slip=requestedTE>teGrip;
    const teTarget=Math.min(requestedTE,teGrip*(D.slip?.96:1));
    const teDelta=follow(D.te,teTarget,dt,teTarget>D.te?.4:.14)-D.te;
    D.te+=clamp(teDelta,-inertia*2.5*dt,inertia*.7*dt);if(D.te<1)D.te=0;
    D.contacts=canPower;
    const airForce=D.bc/3.8*1.38*inertia;
    const brakeForce=Math.min(D.ed+airForce,mass*9.81*mu*.98);
    D.slide=D.ed+airForce>mass*9.81*mu;
    const resistance=(2600+95*speed+8*speed*speed)*(mass/207220);
    const motive=D.te*q.dir-mass*9.81*grade;
    let ax=0,next=previous;
    if(speed<.012&&Math.abs(motive)<=brakeForce+resistance){next=0;ax=0;}
    else {
      const sign=speed>.006?Math.sign(previous):Math.sign(motive)||1;
      ax=(motive-sign*(brakeForce+resistance))/inertia;
      next=previous+ax*dt;
      if(previous*next<0&&Math.abs(motive)<=brakeForce+resistance){next=0;ax=-previous/dt;}
    }
    q.u=next;q.v=Math.abs(next);q.s+=(previous+next)*.5*dt/Math.sqrt(1+Math.pow(curveD(q.s),2)+grade*grade);
    q.a=(q.v-speed)/dt;q.brake=brakeForce/inertia;
    D.jerk=follow(D.jerk,(ax-D.ax)/dt,dt,.15);D.ax=ax;
    D.mass=mass;D.grade=grade;D.adh=mu;D.force=D.te*q.dir-(Math.sign(previous)||q.dir)*brakeForce;
    D.airForce=airForce;D.edForce=D.ed;D.resist=resistance;
    // Damped suspension/head response: no fake idle oscillation and no speed-linked FOV.
    const targetPitch=clamp(-ax*.008,-.014,.014);
    D.pitchV+=(30*(targetPitch-D.pitch)-8*D.pitchV)*dt;D.pitch+=D.pitchV*dt;
    const curvature=(curveD(q.s+2)-curveD(q.s-2))/4;
    const lateral=next*next*curvature;
    D.swayV+=(22*(clamp(lateral*.012,-.03,.03)-D.sway)-7*D.swayV)*dt;D.sway+=D.swayV*dt;
  }
  physicsAdvance=dynamics;
  const oldStep=step;
  step=function(dt){let left=clamp(dt,0,2);while(left>1e-7){const h=Math.min(left,1/120);oldStep(h);left-=h;}};
  function predictStop(n,q=S){const v={...q,doors:{...q.doors},doorTargets:{...q.doorTargets},drive:{...q.drive},notch:-n,predictLimit:limit(),ato:false};let t=0;const at=q.s;while(t<160){dynamics(v,.08);t+=.08;if(v.v<.016&&t>.15)break;}return {distance:Math.abs(v.s-at),seconds:t};}
  let predicted=0, predictionAt=-99;
  // Predictive ATO commands the same notches as the player. It never writes position or velocity.
  updateATO=function(){
    if(!S.ato||S.emergency||S.completed)return;
    if(S.dir<0){S.ato=false;return;}
    const st=currentStation(),d=st.s-S.s,open=S.doors.L>.001||S.doors.R>.001;
    if(S.v<.025&&Math.abs(d)<=1.5){setNotch(-3,false);if(!S.ready)S.doorTargets[st.side]=1;else S.doorTargets[st.side]=0;return;}
    if(S.ready||S.boarding||open||S.doorTargets.L||S.doorTargets.R){setNotch(-4,false);return;}
    if(S.time<S.atoClock)return;S.atoClock=S.time+.42;
    let stopD=d,e=S.event,blocked=false;
    if(e&&(e.type==='signal'||(['obstacle','intrusion'].includes(e.type)&&!e.hit&&!e.evaded))){const ed=e.s-S.s-12;if(ed<stopD){stopD=ed;blocked=true;}}
    if(stopD<=1.2&&S.v<.025){setNotch(-3,false);return;}
    let target=Math.min(limit()/3.6-.6,21);
    if(d>137)target=Math.min(target,Math.sqrt(12*12+2*.65*Math.max(0,d-160)));
    if(stopD<30)target=Math.min(target,3);if(stopD<8)target=Math.min(target,1.05);
    const relaxed=predictStop(3).distance;
    if(stopD<relaxed+8&&S.v>.18){
      let best=1,err=Infinity;
      for(let n=1;n<=7;n++){const p=predictStop(n).distance;const error=Math.abs(p-(stopD-.5))+(p>stopD+.3?(p-stopD)*.5:0);if(error<err){err=error;best=n;}}
      setNotch(-best,false);
    }else if(S.v<target-.4){setNotch(stopD<8?1:stopD<60?2:4,false);}
    else if(S.v>target+.35)setNotch(-3,false);
    else if(S.notch>0||S.v>target)setNotch(0,false);
    if(blocked&&S.v<.025&&stopD<4)setNotch(-3,false);
  };
  const oldEmergency=emergency;
  emergency=function(){oldEmergency();S.atoClock=0;};
  const oldSetNotch=setNotch;
  setNotch=function(n,manual=true){const before=S.notch;oldSetNotch(n,manual);if(before!==S.notch&&manual)clickSound();};
  // Driver's viewpoint stays in this cab when selecting reverse; the train backs away.
  const oldCamera=cameraFor;
  cameraFor=function(t,mirror=false){
    if(mirror||!S.started||S.view!==0)return oldCamera(t,mirror);
    updateCab();
    const D=S.drive, moving=smooth(S.v,0,3), vibration=S.tuning.cabMotion?(Math.sin(S.s*10.0)*.002+Math.sin(S.s*1.17)*.003)*moving:0;
    const sway=S.tuning.cabMotion?D.sway:0, pitch=S.tuning.cabMotion?D.pitch:0;
    const eye=wp(.38+sway,2.60+vibration,S.s-1.35);
    const heading=Math.atan(curveD(S.s))+S.lookYaw, g=(elevation(S.s+5)-elevation(S.s-5))/10;
    return {eye,target:[eye[0]+Math.sin(heading)*50,eye[1]+g*50+(pitch+S.lookPitch-.006)*50,eye[2]-Math.cos(heading)*50],fov:width<height?66:51};
  };
  // Arched tunnel shells, close-spaced sleepers and true scale reference objects.
  const baseBuild=buildScenery;
  let tunnelMesh=null;
  buildScenery=function(){baseBuild();let b=new MeshBuilder();const start=Math.floor((S.s-60)/5)*5,end=S.s+430;
    for(let s=start;s<end;s+=5){
      if(!isTunnel(s)||stationAt(s))continue;
      const wall=s%10===0?'#46494b':'#404548';
      for(let i=0;i<14;i++){const a=i/14*Math.PI,c=(i+1)/14*Math.PI;const p=(ang,z)=>wp(Math.cos(ang)*3.65,2.1+Math.sin(ang)*3.65,z);b.quad(p(a,s-2.5),p(c,s-2.5),p(c,s+2.5),p(a,s+2.5),color(wall));}
      wbox(b,3.64,1.05,s,.12,2.1,5.02,wall);wbox(b,-3.64,1.05,s,.12,2.1,5.02,wall);
      wbox(b,2.65,.36,s,1.1,.48,5.02,'#59605e');for(let y of [.9,1.1,1.3])wbox(b,3.51,y,s,.09,.065,5.05,'#20282a');
      if(s%25===0){wbox(b,3.49,2.55,s,.08,.11,1.8,'#d0d7c5',1);wbox(b,3.48,1.8,s+3,.07,.24,.65,'#469473',.7);}
      if(s%5===0){for(let i=0;i<14;i++){const a=i/14*Math.PI,c=(i+1)/14*Math.PI;b.beam(wp(Math.cos(a)*3.63,2.1+Math.sin(a)*3.63,s),wp(Math.cos(c)*3.63,2.1+Math.sin(c)*3.63,s),.035,'#252e31');}}
    }
    for(let s=Math.floor((S.s-20)/.65)*.65;s<S.s+115;s+=.65)wbox(b,0,-.012,s,2.35,.09,.19,'#69716c');
    for(const st of stations){for(const d of [400,200,100,50,20]){const s=st.s-d;if(s<S.s-40||s>S.s+450)continue;addSign(String(d),2.85,2.13,s,0,.60,.60,'#e0dcc7','#19242a');}}
    if(tunnelMesh)gl.deleteBuffer(tunnelMesh.buffer);tunnelMesh=upload(b);
  };
  const oldRenderMesh=renderMesh;
  renderMesh=function(mesh,vp,eye,fog){oldRenderMesh(mesh,vp,eye,fog);if(mesh===scenery&&tunnelMesh)oldRenderMesh(tunnelMesh,vp,eye,fog);};
  // Physical cabin frame follows the vehicle, rather than remaining glued to the screen.
  let cabin=null,cabinAt=NaN;
  function updateCab(){if(cabin&&cabinAt===S.s)return;const b=new MeshBuilder();
    for(const x of[-1.28,1.28]){wbox(b,x,2.70,S.s+.65,.13,1.75,.18,'#5c6260');wbox(b,x*.94,1.70,S.s+.35,.19,.65,1.7,'#262e31');}
    wbox(b,0,3.45,S.s+.50,2.65,.15,.33,'#5b615e');wbox(b,0,1.72,S.s+.90,2.65,.18,.45,'#4d5351');
    wbox(b,-.40,2.66,S.s+.77,.055,1.45,.06,'#27302e');
    if(cabin)gl.deleteBuffer(cabin.buffer);cabin=upload(b,gl.DYNAMIC_DRAW);cabinAt=S.s;
  };
  const oldDrawViewport=drawViewport;
  drawViewport=function(x,y,w,h,cam,t,mirror=false){oldDrawViewport(x,y,w,h,cam,t,mirror);if(S.started&&S.view===0&&!mirror&&cabin){const vp=M.mul(M.perspective(cam.fov*Math.PI/180,w/h,.1,1000),M.look(cam.eye,cam.target));oldRenderMesh(cabin,vp,cam.eye,[.048,.081,.094]);}};
  // Audio synthesis: separate loaded motor harmonics, rolling sound and brake air release.
  let realAudio=null, lastBC=0;
  function ensureRealAudio(){if(realAudio||!audio)return;const {ctx,master}=audio;let parts=[];
    for(const type of['sine','triangle','sine']){const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;g.gain.value=0;o.connect(g);g.connect(master);o.start();parts.push({o,g});}
    const buffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),d=buffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const air=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();air.buffer=buffer;air.loop=true;filter.type='bandpass';filter.frequency.value=1600;filter.Q.value=.7;gain.gain.value=0;air.connect(filter);filter.connect(gain);gain.connect(master);air.start();realAudio={parts,airGain:gain};
  }
  function clickSound(){if(!audio||!S.sound)return;tone(125,.032,.07,0,'triangle');}
  audioStep=function(){if(!audio)return;ensureRealAudio();const {ctx,master,osc,gain,filter,ng,nf}=audio,D=S.drive,t=ctx.currentTime,v=S.v;
    master.gain.setTargetAtTime(S.sound&&S.started&&!S.paused?.52:0,t,.12);
    const load=clamp((D.te+D.edForce)/250000,0,1),base=29+v*9.7;
    osc.frequency.setTargetAtTime(base,t,.06);filter.frequency.setTargetAtTime(130+v*33,t,.10);gain.gain.setTargetAtTime(load*.05,t,.08);
    for(let i=0;i<3;i++){const p=realAudio.parts[i];p.o.frequency.setTargetAtTime(i===2?310+v*27:base*(i+1),t,.07);p.g.gain.setTargetAtTime(load*[.07,.025,.013][i],t,.08);}
    ng.gain.setTargetAtTime(Math.min(.24,Math.pow(v/25,1.3)*.20)+(D.compressor?.018:0),t,.15);nf.frequency.setTargetAtTime(220+v*22,t,.14);
    const hiss=Math.min(.14,Math.abs(D.bc-lastBC)*6);realAudio.airGain.gain.setTargetAtTime(hiss,t,.05);lastBC=D.bc;
  };
  // Instruments display measured forces and pressure, not just the requested notch.
  const style=document.createElement('style');style.textContent=`
  #grain{display:none}.cabPillar{display:none!important}.routebar{display:none}.topbar{background:linear-gradient(#061017a0,transparent)}.brand small{letter-spacing:1px}.brand b{letter-spacing:1px}
  #dashboard{background:linear-gradient(#4b5251,#292f30 10%,#202729);border-top-color:#727a73;box-shadow:0 -6px 13px #0008}.dmi{background:#071417}.dmiInfo{gap:3px;padding-top:5px;padding-bottom:5px}.dmiInfo .row{line-height:1.2}.speedText strong{font-variant-numeric:tabular-nums}
  #driveInstruments{display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:9px;margin-top:2px}.inst{background:#101f22;padding:5px 7px;border:1px solid #415053;border-radius:3px}.inst span{color:#8ca7a8;font-size:8px}.inst b{float:right;color:#e2eadd;font:12px Consolas,monospace}.inst i{display:block;height:3px;background:#20373b;margin-top:4px}.inst i em{display:block;height:100%;background:#d7bd81;width:0;transition:width .1s}
  .driveMode{font:9px Consolas,monospace;color:#8eb9b2;margin-top:3px}#trainDiagram{margin:0;height:17px}.traincar{height:17px}.leftpanel{gap:6px}.metrics{font-size:9px}.metrics b{font-size:12px}
  #motionBtn{position:absolute;right:24px;top:225px;font-size:10px;padding:0 12px;min-height:31px;background:#0b1b22d9}#precisionReadout{position:absolute;top:102px;left:50%;transform:translateX(-50%);color:#cad4cb;font:11px Consolas,monospace;background:#07161bbb;border:1px solid #42534f;border-radius:5px;padding:7px 12px;white-space:nowrap}
  #brakeDistance{color:#ecc381}.bottomhint{color:#b1c3b1aa}.stophelp{max-width:310px}.startfoot{line-height:1.6}
  @media(max-height:620px) and (orientation:landscape){#driveInstruments{gap:3px;font-size:7px}.inst{padding:3px 5px}.inst span{font-size:6px}.inst b{font-size:10px}.inst i{margin-top:2px;height:2px}.leftpanel{gap:3px}.metrics{font-size:7px}.metrics b{font-size:10px}#trainDiagram{display:none}.driveMode{font-size:7px}.dmiInfo .row{font-size:7px}.dmiInfo .row b{font-size:9px}#precisionReadout{top:56px;font-size:9px;padding:5px 8px}#motionBtn{top:148px;right:14px;min-height:25px;font-size:8px}.messageDock{width:190px}.messageDock p{line-height:1.5}.hudpill{font-size:8px}}
  @media(orientation:portrait){#precisionReadout{top:178px;font-size:9px}#motionBtn{display:none}#trainDiagram,.driveMode{display:none}#driveInstruments{gap:3px}.inst{padding:2px 5px}.inst span{font-size:7px}.inst b{font-size:10px}.inst i{height:2px;margin-top:2px}.leftpanel{gap:3px}.metrics b{font-size:10px}.messageDock{top:211px}#toast{top:265px}}
  `;document.head.appendChild(style);
  $('trainDiagram').insertAdjacentHTML('afterend','<div id="driveInstruments"><div class="inst"><span>制动缸 bar</span><b id="bcValue">1.10</b><i><em id="bcBar"></em></i></div><div class="inst"><span>总风 bar</span><b id="mrValue">8.30</b><i><em id="mrBar"></em></i></div></div><div class="driveMode" id="tractionReadout">DRIVE 2.0 · 等待缓解</div>');
  $('app').insertAdjacentHTML('beforeend','<div id="precisionReadout" class="gameUI">DRIVE 2.0</div><button id="motionBtn" class="gameUI">驾驶室微动 · 开</button>');
  $('motionBtn').onclick=()=>{S.tuning.cabMotion=!S.tuning.cabMotion;$('motionBtn').textContent='驾驶室微动 · '+(S.tuning.cabMotion?'开':'关');};
  $('brakeDistance').parentNode.firstElementChild.textContent='B4 预计停车距离';
  $('modePill').textContent='自由驾驶 · 2.0';
  $('helpOverlay').querySelector('p').innerHTML='这次手柄控制的是牵引力与制动力，不是速度。<strong>P1</strong>轻牵引起步，<strong>P3/P4</strong>持续加速；<strong>N</strong>切除动力惰行。进站先用<strong>B3–B5</strong>减速，低速时逐档缓解。制动缸压力消退需要过程。';
  $('startOverlay').querySelector('.startfoot').innerHTML='驾驶重制 2.0 · 载重 / 电空混合制动 / 无停车吸附<br>虚构车辆参数与线路，工程近似，不是实车培训软件。';
  $('fpsDisplay').textContent='DRIVE 2.0';
  const oldUpdateUI=updateUI;let displayAt=-99;
  updateUI=function(t){oldUpdateUI(t);if(t-displayAt<.1)return;displayAt=t;const D=S.drive,st=currentStation(),d=st.s-S.s;
    if(S.time-predictionAt>.6||S.time<predictionAt){predictionAt=S.time;predicted=predictStop(4).distance;}
    $('speed').textContent=S.v*3.6<10?(S.v*3.6).toFixed(1):Math.round(S.v*3.6);
    $('brakeDistance').textContent=Math.round(predicted)+' m';
    $('bcValue').textContent=D.bc.toFixed(2);$('mrValue').textContent=D.mr.toFixed(2);$('bcBar').style.width=(D.bc/3.8*100)+'%';$('mrBar').style.width=(D.mr/10*100)+'%';
    $('tractionReadout').textContent='牵引 '+Math.round(D.te/1000)+' kN · 电制 '+Math.round(D.edForce/1000)+' kN';
    $('slopeDisplay').textContent=(D.grade>=0?'+':'')+(D.grade*1000).toFixed(1)+' ‰ / '+formatTime(S.time);
    $('precisionReadout').textContent='DRIVE 2.0  |  '+(D.mass/1000).toFixed(1)+' t  |  '+(D.ax>=0?'+':'')+D.ax.toFixed(2)+' m/s²';
    $('forceDot').style.left=clamp(63.6+(D.te-D.edForce-D.airForce)/300000*34,2,98)+'%';
    $('modePill').textContent=(S.mode==='free'?'自由驾驶':'运营防护')+' · 2.0';
    $('fpsDisplay').textContent='DRIVE 2.0 · '+(hasGL?'WebGL':'兼容渲染')+' · '+fps+' FPS';
    if(!S.boarding&&!S.ready&&!S.completed){$('dmiStatus').textContent=S.emergency?'紧急制动 · 停稳复位':D.atp?'ATP 超速防护制动':D.slide?'防滑动作 · 提前制动':D.slip?'牵引防空转 · 降低级位':S.u<-.04&&S.dir>0?'注意：列车正在后溜':S.notch>0&&!D.contacts?(D.bc>.22?'牵引封锁 · 制动缓解中':'牵引接触器建立中'):S.notch>0?'牵引建立 · '+Math.round(D.te/1000)+' kN':D.bc>.12&&S.notch>=0?'制动缸缓解中 · 仍有制动力':S.notch<0?'电空混合制动 · '+D.bc.toFixed(2)+' bar':'惰行 · 牵引已切除';}
    $('stopHelp').textContent=Math.abs(d)<=1.5?(S.v<.025?'停稳对标 · 可开'+(st.side==='R'?'右':'左')+'门':'最后对标 · 逐档缓解'):d<0?'已经越标 · 停车后可换向修正':'提前制动；低速时逐级缓解，避免点头';
    $('stopDistance').style.color=Math.abs(d)<=1.5?'#9dfbd1':'#e7f4ea';
    $('stopMarker').style.left=(50-clamp(d/12,-1,1)*47)+'%';
    $('nextLabel').textContent=Math.abs(d)<=1.5&&S.v<.025?'AT STATION / 已对标':d<0?'PASSED MARK / 已越标':'NEXT STATION / 下一站';
  };
  const oldStart=start;start=function(){oldStart();toast('驾驶重制 2.0：先开右门接客，关门后 P1 起步，再逐档加牵引。','',7);};$('startBtn').onclick=start;
  // Stop the browser from repeating through all handle positions instantly.
  let lastKey=0;window.addEventListener('keydown',e=>{if(e.repeat&&['KeyW','KeyS','ArrowUp','ArrowDown'].includes(e.code)){const now=performance.now();if(now-lastKey<170)e.stopImmediatePropagation();else lastKey=now;}},true);
  window.MetroDriving={version:build,renderExtras:()=>({tunnel:tunnelMesh,cab:cabin}),physics:dynamics,freshDrive,predictStop,meanGrade,config:{emptyMassKg:204000,passengerMassKg:70,rotatingMassFactor:1.06,powerW:3800000,startingForceN:258000},setSpeed:(v)=>{S.u=v;S.v=Math.abs(v);}};
  sceneryChunk=-999;dynTime=-999;lastUI=-999;
}
if(typeof module!=='undefined')module.exports={upgradeMetro};
