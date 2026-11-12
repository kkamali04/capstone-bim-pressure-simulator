import {workspaceSimulation} from './workspace-simulation.js';
import {pressureRoomView,pressureColor} from './pressure-view.js';
import {validateEngineering,roomId,projectPackage} from './engineering.js';
import {engineeringUI} from './engineering-ui.js';
import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {SVGRenderer} from './vendor/SVGRenderer.js';
const $=s=>document.querySelector(s),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let pressureOverlay=null, pressureRoom=null;
let model=null,selected=null,meshes=[],hidden=new Set,isolation=null,worker=null,importSerial=0,software=false;
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,1,.001,100000),view=$('#viewport');let renderer;
try{renderer=new T.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));}catch{renderer=new SVGRenderer();software=true;}
renderer.setClearColor(0xf2f4f0,1);view.prepend(renderer.domElement);$('#rendererNote').textContent=software?'Compatibility renderer':'WebGL renderer';
scene.add(new T.AmbientLight(0xffffff,software?.7:1.8));const light=new T.DirectionalLight(0xffffff,software?.5:2.2);light.position.set(5,20,10);scene.add(light);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.maxPolarAngle=Math.PI*.95;
const group=new T.Group();scene.add(group);let grid=null,box=null;
function status(t,error=false){$('#status').textContent=t;$('#status').classList.toggle('error',error);}
function validate(m){if(m?.schema!=='pci-bim-1'||!Array.isArray(m.entities)||!m.entities.length)throw Error('No supported geometry found in this PCI package.');if(m.source?.geometry_units!=='m')throw Error('Geometry JSON must use meters.');if(m.entities.length>2000)throw Error('More than 2,000 objects. Export a smaller building subset.');let triangles=0;const ids=new Set;for(const e of m.entities){if(typeof e.id!=='string'||ids.has(e.id)||typeof e.class!=='string'||typeof e.name!=='string')throw Error('Missing or duplicate object metadata.');ids.add(e.id);if(!Array.isArray(e.bbox)||e.bbox.length!==2||e.bbox.some(b=>!Array.isArray(b)||b.length!==3||b.some(v=>!Number.isFinite(v)))||e.bbox[0].some((v,i)=>v>e.bbox[1][i]))throw Error('Invalid object bounds.');if(e.properties!=null&&(typeof e.properties!=='object'||Array.isArray(e.properties)||Object.values(e.properties).some(v=>!v||typeof v!=='object'||Array.isArray(v))))throw Error('Invalid property-set structure.');if(e.storey!=null&&typeof e.storey!=='string')throw Error('Invalid floor metadata.');if(!Array.isArray(e.vertices)||!e.vertices.length||e.vertices.length%3||e.vertices.some(v=>!Number.isFinite(v))||!Array.isArray(e.faces)||!e.faces.length||e.faces.length%3||e.faces.some(i=>!Number.isInteger(i)||i<0||i>=e.vertices.length/3))throw Error('Invalid geometry in '+e.name);triangles+=e.faces.length/3;}if(triangles>600000)throw Error('More than 600,000 triangles. Export a smaller subset.');return triangles;}
function meshFor(e){const g=new T.BufferGeometry(),a=[];for(let k=0;k<e.vertices.length;k+=3)a.push(e.vertices[k],e.vertices[k+2],-e.vertices[k+1]);g.setAttribute('position',new T.Float32BufferAttribute(a,3));g.setIndex(e.faces);g.computeVertexNormals();const space=e.class==='IfcSpace',equipment=/Flow|Air|Fan|Duct|Pump|Unitary|Energy|Furnish/.test(e.class),c=space?0xaac4aa:equipment?0x8caa93:/Door/.test(e.class)?0xb6a588:/Window/.test(e.class)?0xb1cbc8:0xd6d8cf;const mat=new T.MeshLambertMaterial({color:c,side:T.DoubleSide,transparent:space||/Window/.test(e.class),opacity:space?.13:/Window/.test(e.class)?.45:1,depthWrite:!space});const mesh=new T.Mesh(g,mat);mesh.userData={entity:e,color:c,raw:a,faces:e.faces};return mesh;}
function install(m){const triangles=validate(m),annotations=validateEngineering(m),next=[];try{for(const e of m.entities)next.push(meshFor(e));}catch(e){next.forEach(o=>{o.geometry.dispose();o.material.dispose();});throw e;}meshes.forEach(o=>{group.remove(o);o.geometry.dispose();o.material.dispose();});model=m;model.engineering=annotations;engineering.clear();engineering.modelChanged();$('#saveProject').disabled=false;$('#spaces').checked=m.entities.every(e=>e.class==='IfcSpace');meshes=next;next.forEach(o=>group.add(o));selected=null;hidden.clear();isolation=null;$('#empty').hidden=true;$('#axes').hidden=false;$('#details').innerHTML='<p class="quiet">Select an object to inspect its properties.</p>';for(const id of ['fit','planView','orbitView','section','reset','export'])$('#'+id).disabled=false;$('#isolate').disabled=$('#hide').disabled=true;$('#fileTitle').textContent=m.source.name||'Imported model';$('#total').textContent=meshes.length;$('#counts').textContent=meshes.length+' objects / '+m.entities.filter(e=>e.class==='IfcSpace').length+' rooms / '+triangles.toLocaleString()+' triangles';const floors=[...new Set(m.entities.map(e=>e.storey).filter(Boolean))];$('#floor').replaceChildren(new Option('All floors',''),...floors.map(f=>new Option(f,f)));const types=[...new Set(m.entities.map(e=>e.class))].sort();$('#type').replaceChildren(new Option('All types',''),...types.map(f=>new Option(f.replace(/^Ifc/,''),f)));$('#search').value='';$('#section').value=100;box=new T.Box3().setFromObject(group);if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}const size=box.getSize(new T.Vector3());grid=new T.GridHelper(Math.max(size.x,size.y,size.z)*1.4,20,0xd2d8ce,0xe1e6dc);grid.position.copy(box.getCenter(new T.Vector3()));grid.position.y=box.min.y-.01;scene.add(grid);simulation.loadModel();refresh();fit();const issues=m.import_report?.geometry_missing?.length??0;status('Opened '+meshes.length+' represented objects. '+(/^Duplex_[AM]_/.test(m.source.name)?'Public buildingSMART residential research model, not a laboratory. ':'')+(issues?issues+' geometry issues reported. ':'')+(m.entities.some(e=>e.class==='IfcSpace')?'':'No room spaces supplied; geometry inspection is available. ')+'Only content represented in the file is shown.');}
function filtered(e){return(!$('#floor').value||e.storey===$('#floor').value)&&(!$('#type').value||e.class===$('#type').value)&&(!$('#search').value||[e.name,e.class,e.id,e.longName,e.metadata?.model].join(' ').toLowerCase().includes($('#search').value.toLowerCase()));}
function clip(mesh,limit){const a=mesh.userData.raw,faces=mesh.userData.faces,out=[];for(let k=0;k<faces.length;k+=3){const poly=faces.slice(k,k+3).map(i=>a.slice(3*i,3*i+3)),v=[];for(let j=0;j<3;j++){const x=poly[j],y=poly[(j+1)%3],inside=x[1]<=limit,next=y[1]<=limit;if(inside)v.push(x);if(inside!==next){const t=(limit-x[1])/(y[1]-x[1]);v.push(x.map((n,i)=>n+t*(y[i]-n)));}}for(let j=1;j<v.length-1;j++)out.push(...v[0],...v[j],...v[j+1]);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(out,3));g.computeVertexNormals();mesh.geometry.dispose();mesh.geometry=g;}
function refresh(){if(!model)return;const limit=box.min.y+(box.max.y-box.min.y)*Number($('#section').value)/100,fragment=document.createDocumentFragment();for(const mesh of meshes){const e=mesh.userData.entity,match=filtered(e);mesh.visible=pressureOverlay?.id===e.id||((!pressureOverlay||pressureOverlay.showBuilding)&&match&&!hidden.has(e.id)&&(!isolation||isolation.has(e.id))&&(e.class!=='IfcSpace'||$('#spaces').checked||selected===e.id));clip(mesh,limit);if(match){const b=document.createElement('button');b.className='object'+(selected===e.id?' active':'');b.dataset.id=e.id;b.textContent=e.name;const sm=document.createElement('small');sm.textContent=e.class.replace(/^Ifc/,'')+' / '+(e.storey||'Unassigned');b.append(sm);b.onclick=()=>select(e.id);fragment.append(b);}}if(!fragment.childNodes.length){const p=document.createElement('p');p.className='quiet';p.textContent='No objects match these filters.';fragment.append(p);}$('#objects').replaceChildren(fragment);applyPressureCut(limit);render();}
function select(id){const changedSelection=selected!==id;selected=id;const e=model.entities.find(e=>e.id===id);applyRoomColors();simulation.setRoom(id);$('#isolate').disabled=$('#hide').disabled=false;const metadata=e.metadata??{},properties=e.properties??{},b=e.bbox??[[],[]],dims=b[1].map((v,i)=>(v-b[0][i]).toFixed(2)).join(' × ');$('#details').innerHTML='<h3>'+escape(e.name)+'</h3><p class="quiet">'+escape(e.class)+'</p><dl><dt>IFC identity</dt><dd>'+escape(e.id)+'</dd><dt>Floor</dt><dd>'+escape(e.storey||'Unassigned')+'</dd><dt>Dimensions</dt><dd>'+escape(dims)+' m</dd><dt>Manufacturer</dt><dd>'+escape(metadata.manufacturer??'Not supplied')+'</dd><dt>Model / type</dt><dd>'+escape(metadata.model??metadata.typeName??'Not supplied')+'</dd><dt>Room membership</dt><dd>'+escape(roomId(model,e)?model.entities.find(x=>x.id===roomId(model,e))?.name||roomId(model,e):'Not explicitly assigned')+'</dd></dl>'+Object.entries(properties).map(([name,values])=>'<details class="propertySet"><summary>'+escape(name)+'</summary><dl>'+Object.entries(values).map(([k,v])=>'<dt>'+escape(k)+'</dt><dd>'+escape(typeof v==='object'?JSON.stringify(v):v)+'</dd>').join('')+'</dl></details>').join('');engineering.show(id);if(changedSelection)document.querySelector('.inspector').scrollTop=0;refresh();}
function fit(plan=false,roomOnly=false){if(!box)return;const visible=meshes.filter(m=>m.visible);const bounds=new T.Box3();visible.forEach(m=>bounds.expandByObject(m));if(pressureRoom){if(roomOnly||!pressureOverlay.showBuilding)bounds.makeEmpty();bounds.union(pressureRoom.bounds).expandByObject(pressureRoom.group);}if(bounds.isEmpty())bounds.copy(box);const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),r=Math.max(size.x,size.y,size.z,.1)*Math.max(1,1/Math.max(.35,camera.aspect));controls.target.copy(center);camera.near=Math.max(.0001,r/10000);camera.far=Math.max(100,r*100);camera.updateProjectionMatrix();camera.position.set(center.x+(plan?.00001:r),center.y+r*(plan?2:1.15),center.z+(plan?.00001:r*1.3));controls.update();render();}
function render(){renderer.render(scene,camera);}
controls.addEventListener('change',render);new ResizeObserver(()=>{renderer.setSize(view.clientWidth,view.clientHeight);camera.aspect=view.clientWidth/view.clientHeight;camera.updateProjectionMatrix();render();}).observe(view);
for(const id of ['search','floor','type'])$('#'+id).addEventListener(id==='search'?'input':'change',refresh);$('#spaces').onchange=refresh;$('#section').oninput=refresh;$('#fit').onclick=()=>fit();$('#planView').onclick=()=>fit(true);$('#orbitView').onclick=()=>fit();$('#simFocus').onclick=()=>fit(false,true);$('#hide').onclick=()=>{hidden.add(selected);refresh();};$('#isolate').onclick=()=>{const e=model.entities.find(e=>e.id===selected);isolation=new Set([selected,...model.entities.filter(x=>roomId(model,x)===selected).map(x=>x.id)]);if(e.class==='IfcSpace')$('#spaces').checked=true;refresh();fit();status('Selection isolated. Room contents included from IFC relationships or reviewed manual assignments.');};$('#reset').onclick=()=>{hidden.clear();isolation=null;$('#search').value='';$('#floor').value='';$('#type').value='';$('#section').value=100;$('#spaces').checked=model.entities.every(e=>e.class==='IfcSpace');selected=null;engineering.clear();$('#hide').disabled=$('#isolate').disabled=true;$('#details').innerHTML='<p class="quiet">Select an object to inspect its properties.</p>';applyRoomColors();refresh();fit();};
let start;renderer.domElement.addEventListener('pointerdown',e=>start=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!model||!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>4)return;const b=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(2*(e.clientX-b.left)/b.width-1,1-2*(e.clientY-b.top)/b.height),camera);const hit=ray.intersectObjects(meshes.filter(m=>m.visible))[0];if(hit)select(hit.object.userData.entity.id);});
function download(name,text,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('#export').onclick=()=>download('PCI_object_inventory.json',JSON.stringify({source:model.source,objects:model.entities.map(({vertices,faces,...e})=>e),import_report:model.import_report},null,2));
function applyRoomColors(){
  const seeThrough=Boolean(pressureOverlay?.showBuilding&&pressureRoom);
  for(const mesh of meshes){
    const {entity,color}=mesh.userData;
    const space=entity.class==='IfcSpace',window=/Window/.test(entity.class);
    const tinted=pressureOverlay?.id===entity.id;
    const material=mesh.material;
    const transparent=space||window||seeThrough;
    if(material.transparent!==transparent){
      material.transparent=transparent;
      material.needsUpdate=true;
    }
    material.depthWrite=!space&&!seeThrough;
    material.color.setHex(entity.id===selected?0xd3a761:color);
    material.opacity=space?.13:window?.45:seeThrough?.28:1;
    if(tinted){
      material.color.copy(pressureColor(pressureOverlay.pressure));
      material.opacity=pressureOverlay.showCells&&pressureRoom.cellCount?.06:.43;
    }
  }
}
function applyPressureCut(limit){
  if(!pressureRoom)return;
  const {showCells}=pressureOverlay;
  pressureRoom.cut(limit,showCells);
  const {cellCount,visibleCells,footprint}=pressureRoom;
  $('#pressureCellsNote').textContent=!showCells?'One simulated value for the room.':!cellCount
    ? 'Room tint shown. No reliable cells fit this geometry.'
    : visibleCells+' cells · '+footprint.toFixed(1)+' ft² each · one room pressure';
}
const simulation=workspaceSimulation({
  getModel:()=>model,
  overlay:next=>{
    const previous=pressureOverlay;
    if(!previous&&!next)return;
    const roomChanged=previous?.id!==next?.id;
    const visibilityChanged=roomChanged||previous?.showBuilding!==next?.showBuilding;
    pressureOverlay=next;
    if(roomChanged){
      if(pressureRoom){
        scene.remove(pressureRoom.group);
        pressureRoom.dispose();
        pressureRoom=null;
      }
      const room=next&&meshes.find(mesh=>mesh.userData.entity.id===next.id);
      if(room){
        pressureRoom=pressureRoomView(room);
        scene.add(pressureRoom.group);
      }
    }
    $('#pressureHud').hidden=!pressureRoom;
    if(pressureRoom){
      const direction=pressureRoom.update(next.pressure,next.flow);
      $('#pressureRoomName').textContent=next.name;
      $('#pressureRoomValue').textContent=next.pressure.toFixed(2)+' Pa';
      $('#pressureReference').textContent=direction==='near zero'?'Reference leakage: near zero':direction==='outward'
        ? 'Symbolic arrow: room → reference'
        : 'Symbolic arrow: reference → room';
    }
    applyRoomColors();
    if(visibilityChanged)refresh();
    else if(model){
      applyPressureCut(box.min.y+(box.max.y-box.min.y)*Number($('#section').value)/100);
      render();
    }
  },
  download
});
const engineering=engineeringUI({getModel:()=>model,onChange:()=>{
  simulation.loadModel({preserveRecording:true});
  if(selected)select(selected);
},onSelect:select,onStatus:status,download});
$('#saveProject').onclick=()=>{try{const text=JSON.stringify(projectPackage(model));if(new Blob([text]).size>30e6)throw Error('Project exceeds the 30 MB reopen limit. Remove attachments or use a smaller model.');download('PCI_reviewed_project.json',text);status('Project downloaded with geometry, reviewed assignments, specifications and attached PDFs. Keep this file to retain your work.');}catch(e){status(e.message,true);}};
function stop(){if(worker)worker.terminate();worker=null;importSerial++;$('#busy').hidden=true;}$('#cancel').onclick=()=>{stop();status('Import canceled. Previous model retained.');};
async function openFile(file){if(!file)return;stop();const serial=importSerial;try{if(file.size>30e6)throw Error('File exceeds 30 MB. Export a floor or smaller subset.');if(!/\.(ifc|json)$/i.test(file.name))throw Error('Unsupported format. Export this BIM to IFC2x3 or IFC4 (.ifc).');$('#busy').hidden=false;$('#progress').textContent='Reading '+file.name+'…';let m;if(/\.json$/i.test(file.name)){const v=JSON.parse(await file.text());m=v.schema==='pci-project-1'?v.model:v;}else{const buffer=await file.arrayBuffer();if(serial!==importSerial)return;worker=new Worker(new URL('./ifc-worker.js',import.meta.url),{type:'module'});m=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Import exceeded 90 seconds. Export a smaller subset.')),90000);worker.onmessage=({data})=>{if(data.progress){$('#progress').textContent=data.progress;return;}clearTimeout(timeout);data.error?reject(Error(data.error)):resolve(data.model);};worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message||'IFC import failed.'));};worker.postMessage({buffer,name:file.name},[buffer]);});}if(serial!==importSerial)return;install(m);}catch(e){if(serial===importSerial)status(e.message+' Previous model retained.',true);}finally{if(serial===importSerial)stop();}}
for(const id of ['openFile','emptyFile'])$('#'+id).onchange=e=>{openFile(e.target.files[0]);e.target.value='';};document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();openFile(e.dataTransfer.files[0]);});
fetch('./downloads/sample-manifest.json').then(r=>r.json()).then(m=>{for(const s of m.samples??m){if(s.file?.endsWith('.ifc')&&!s.expected_error)$('#sample').add(new Option(s.name||s.file,s.file));}}).catch(()=>{$('#sample').add(new Option('Public Duplex building','../../models/duplex-source.ifc'));});
$('#sample').onchange=async e=>{const name=e.target.value;if(!name)return;try{const r=await fetch('./downloads/samples/'+name);if(!r.ok)throw Error('Sample download failed. Use the sample ZIP or upload a file.');await openFile(new File([await r.blob()],name.split('/').at(-1)));}catch(err){status(err.message,true);}e.target.value='';};
